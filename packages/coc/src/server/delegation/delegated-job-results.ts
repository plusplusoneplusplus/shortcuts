import { toQueueProcessId, toTaskId, type AIProcess, type ProcessStore, type QueuedTask, type TaskQueueManager } from '@plusplusoneplusplus/forge';
import { onTaskTerminal } from '../messaging/chat-target';
import { findRequestAnswer, findRequestFailureEvidence, findRequestTurn, isTerminalStatus } from '../messaging/relay-answer';
import type { ScheduleQueueEventBus } from '../schedule/schedule-queue-await';
import type { RalphSessionCompleteEvent } from '../queue/queue-executor-bridge';
import type { RalphSessionRecord } from '../ralph/types';
import type { RalphSessionStore } from '../ralph/ralph-session-store';
import { getRalphTaskKind } from '../ralph/task-kind';
import { buildDashboardChatReference } from '../shared/chat-reference';
import { isRalphFinalCheckRepairTurn, getRalphContext } from '../tasks/task-types';
import { RalphGrillingStore, reconcileRalphGoal } from '../ralph/grilling-state';
import { resolveRalphExecutionOwner } from '../ralph/ralph-execution-owner';
import { DelegatedJobStore, grillingResultJob, type DelegatedJob } from './delegated-job-store';

function responseText(result: unknown): string | undefined {
    if (typeof result === 'string') return result;
    if (result && typeof result === 'object' && 'response' in result && typeof result.response === 'string') {
        return result.response;
    }
    return undefined;
}

/** Only the last request's finished assistant output is eligible as a summary. */
function storedResponse(process: AIProcess | undefined): string | undefined {
    const turns = process?.conversationTurns ?? [];
    for (let i = turns.length - 1; i >= 0; i--) {
        const turn = turns[i];
        if (turn.role === 'user') break;
        if (turn.role === 'assistant' && !turn.streaming && !turn.displayOnly && turn.content) return turn.content;
    }
    if (turns.length || !process?.result) return undefined;
    // ProcessLifecycleRunner persists ChatModeExecutionResult as JSON.
    try {
        return responseText(JSON.parse(process.result)) ?? process.result;
    } catch {
        return process.result;
    }
}

function matchesChild(job: DelegatedJob, task: QueuedTask): boolean {
    return task.type === 'chat'
        && (task.processId ?? toQueueProcessId(task.id)) === job.child.processId
        && (task.payload.workspaceId ?? task.repoId) === job.child.workspaceId;
}

/**
 * Record delegated results before any parent review is admitted.
 * Only registered relationships are reconciled. Ralph uses whole-session events
 * and journal recovery; individual step events never settle a session.
 */
export class DelegatedJobResults {
    private readonly unsubscribe: () => void;
    private readonly sessionListener: (event: RalphSessionCompleteEvent) => void;
    private disposed = false;

    constructor(private readonly deps: {
        jobs: Pick<DelegatedJobStore, 'list' | 'recordResult' | 'serverIdentity'>;
        /** Remote return captures whole sessions only, without a spec-ready milestone. */
        wholeSessionOnly?: boolean;
        getRetainedTask?: (workspaceId: string, taskId: string) => QueuedTask | undefined;
        dataDir?: string;
        store: Pick<ProcessStore, 'getWorkspaces' | 'getProcess'> & Partial<Pick<ProcessStore, 'updateProcess'>>;
        queue: Pick<ScheduleQueueEventBus, 'on' | 'off' | 'getTask'> & Pick<TaskQueueManager, 'getHistory' | 'getQueued' | 'getRunning'>;
        sessions?: Pick<RalphSessionStore, 'readSessionRecord' | 'getProgressPath' | 'recordCompletion'>;
        onResult?: (job: DelegatedJob) => Promise<void>;
    }) {
        this.unsubscribe = onTaskTerminal(deps.queue, task => {
            // Queue task objects can be reused by follow-ups before async reads finish.
            const terminal = { ...task, payload: { ...task.payload }, result: responseText(task.result) };
            void this.recordTerminal(terminal).catch(error =>
                console.error('[delegated-job-results] Could not record terminal result:', error));
        });
        this.sessionListener = event => {
            const terminal = { ...event };
            void this.recordSessionTerminal(terminal).catch(error =>
                console.error('[delegated-job-results] Could not record Ralph result:', error));
        };
        deps.queue.on('ralphSessionComplete', this.sessionListener);
    }

    dispose(): void {
        this.disposed = true;
        this.unsubscribe();
        this.deps.queue.off('ralphSessionComplete', this.sessionListener);
    }

    /** Run during startup, with restored queues stopped and before new dispatch. */
    async restore(): Promise<void> {
        for (const workspace of await this.deps.store.getWorkspaces()) {
            if (this.disposed) return;
            try {
                for (const job of this.deps.jobs.list(workspace.id)) {
                    try {
                        if (job.grilling) await this.deps.onResult?.(grillingResultJob(job)!);
                        if (job.terminal) {
                            await this.deps.onResult?.(job);
                            continue;
                        }
                        if (job.child.requestId) {
                            if (!job.child.serverId && !job.child.sessionId) await this.restoreRequest(job);
                            continue;
                        }
                        if (job.child.sessionId && !job.child.serverId) {
                            await this.restoreSession(job);
                            continue;
                        }
                        if (!this.isOrdinaryPending(job)) continue;
                        const task = this.deps.queue.getTask(toTaskId(job.child.processId));
                        if (task && matchesChild(job, task)) {
                            if (getRalphContext(task)) continue;
                            if (isTerminalStatus(task.status)) await this.recordJob(job, task);
                            // A restored queued/running task wins over stale process status.
                            continue;
                        }
                        const process = await this.childProcess(job);
                        if (this.disposed) return;
                        if (getRalphContext(process)) continue;
                        if (process && isTerminalStatus(process.status)) {
                            await this.saveResult(job, process.status, storedResponse(process), process.error, process.resultFilePath);
                        } else if (!process) {
                            // Registration is durable before admission. A crash in that gap
                            // must not leave an undeliverable job pending indefinitely.
                            this.deps.jobs.recordResult(workspace.id, job.id, {
                                terminalEventId: this.terminalEventId(job), outcome: 'failed',
                                summary: 'The delegated job is unavailable after restart.',
                                reason: 'Neither its queue task nor its process exists in the recorded workspace.',
                                links: this.links(job),
                            }, { state: 'failed', reason: 'Delegated child unavailable during startup recovery.' });
                        }
                    } catch (error) {
                        console.error(`[delegated-job-results] Could not recover job ${job.id}:`, error);
                    }
                }
            } catch (error) {
                // One damaged workspace must not hide other workspaces' results.
                console.error(`[delegated-job-results] Could not read workspace ${workspace.id}:`, error);
            }
        }
    }

    /** A fast cross-workspace child can finish before its source pointer is saved. */
    async reconcileExecutionOwner(workspaceId: string, processId: string): Promise<void> {
        for (const workspace of await this.deps.store.getWorkspaces()) {
            if (this.disposed) return;
            for (const job of this.deps.jobs.list(workspace.id)) {
                if (job.child.workspaceId === workspaceId && job.child.processId === processId && job.child.sessionId) {
                    await this.restoreSession(job);
                }
            }
        }
    }

    private async recordSessionTerminal(event: RalphSessionCompleteEvent): Promise<void> {
        if (!event.sessionId) return; // A process/step ID cannot identify the entire session.
        for (const workspace of await this.deps.store.getWorkspaces()) {
            if (this.disposed) return;
            try {
                for (const job of this.deps.jobs.list(workspace.id)) {
                    if (job.child.serverId || !job.child.sessionId) continue;
                    const owner = await this.executionOwner(job);
                    if (!owner || owner.workspaceId !== event.workspaceId || owner.sessionId !== event.sessionId) continue;
                    const session = await this.deps.sessions?.readSessionRecord(owner.workspaceId, owner.sessionId);
                    if (this.disposed) return;
                    await this.saveSessionResult(job, event.reason, event.totalIterations, session ?? undefined, event.processId);
                }
            } catch (error) {
                console.error(`[delegated-job-results] Could not record Ralph workspace ${workspace.id}:`, error);
            }
        }
    }

    private async restoreSession(job: DelegatedJob): Promise<void> {
        if (!this.deps.sessions) return;
        const owner = await this.executionOwner(job);
        if (!owner) return; // Remote execution retains the explicit unavailable result boundary.
        const session = await this.deps.sessions.readSessionRecord(owner.workspaceId, owner.sessionId);
        if (this.disposed) return;
        if (!session || session.workspaceId !== owner.workspaceId || session.sessionId !== owner.sessionId) {
            this.deps.jobs.recordResult(job.parent.workspaceId, job.id, {
                terminalEventId: this.sessionEventId(job), outcome: 'failed',
                summary: 'The delegated Ralph session is unavailable after restart.',
                reason: 'Its recorded session is missing or belongs to another workspace.', links: this.sessionLinks(job),
            }, { state: 'failed', reason: 'Delegated Ralph session unavailable during startup recovery.' });
            return;
        }
        if (session.phase === 'grilling') {
            const process = await this.childProcess(job);
            const task = this.deps.queue.getTask(toTaskId(job.child.processId));
            if (task && !isTerminalStatus(task.status)) return;
            if (process || task) await this.recordGrilling(job, process, task?.status);
            return;
        }
        if (session.phase === 'awaiting-input') return;
        if (session.completion && session.terminalReason !== 'USER_STOPPED') {
            await this.saveSessionResult(job, session.completion.reason, session.completion.totalIterations,
                session, session.completion.processId);
            return;
        }
        if (session.phase === 'executing' || session.phase === 'complete') {
            for (const task of this.deps.queue.getHistory()) {
                if (await this.recordQueuedSessionCancellation(job, task, session)) return;
            }
        }
        let reason: string | undefined;
        if (session.terminalReason === 'USER_STOPPED') reason = 'user-stopped';
        else {
            const check = session.finalChecks?.at(-1);
            // Failed gap-loop admission may leave phase executing. A later loop with
            // real iterations wins over the previous check's failure record.
            if (check?.status === 'failed' && check.sourceIteration >= session.currentIteration) reason = 'final-check-failed';
            else if (session.phase === 'complete') {
                if (check && check.sourceIteration >= session.currentIteration) {
                    if (check.status === 'completed' && !check.gapLoopStarted) {
                        if (check.capReached) reason = 'cap';
                        else if (check.hasGaps === false) reason = 'signal';
                    }
                } else if (!['RALPH_COMPLETE', 'MANUAL_VERIFICATION_ONLY'].includes(session.terminalReason ?? '')) {
                    // Successful iteration loops require a final check. Their complete
                    // phase alone is not evidence that the whole session is finished.
                    if (session.terminalReason === 'CAP_REACHED') reason = 'cap';
                    if (session.terminalReason === 'NO_SIGNAL') reason = 'no-signal';
                    if (session.terminalReason === 'CANCELLED') reason = 'cancelled';
                }
            }
        }
        if (reason) {
            const check = session.finalChecks?.at(-1);
            const finalProcessId = check && check.sourceIteration >= session.currentIteration
                ? check.processId : session.iterations.at(-1)?.processId;
            await this.saveSessionResult(job, reason, session.currentIteration, session, finalProcessId);
        }
    }

    /** Queued iterations/checks never enter the executor's interrupted-turn settlement. */
    private async recordQueuedSessionCancellation(
        job: DelegatedJob, task: QueuedTask, storedSession?: RalphSessionRecord,
    ): Promise<boolean> {
        const owner = await this.executionOwner(job);
        if (!owner) return false;
        const ctx = getRalphContext(task);
        const repair = isRalphFinalCheckRepairTurn(task.payload);
        const kind = getRalphTaskKind(ctx ?? undefined);
        if (!this.deps.sessions || task.status !== 'cancelled' || task.startedAt !== undefined
            || task.type !== 'chat' || task.payload.mode !== 'ralph' || (task.payload.processId && !repair)
            || !ctx?.sessionId || ctx.sessionId !== owner.sessionId
            || (task.payload.workspaceId ?? task.repoId) !== owner.workspaceId
            || kind === 'submit' || ctx.phase === 'grilling') return false;
        const session = storedSession ?? await this.deps.sessions.readSessionRecord(owner.workspaceId, ctx.sessionId);
        if (this.disposed || !session || session.workspaceId !== owner.workspaceId
            || session.sessionId !== ctx.sessionId
            || !['executing', 'complete'].includes(session.phase)
            || session.terminalReason === 'USER_STOPPED') return false;
        const processId = typeof task.payload.processId === 'string' ? task.payload.processId
            : task.processId ?? toQueueProcessId(task.id);
        const check = ctx.finalCheck;
        const iteration = check?.sourceIteration ?? ctx.currentIteration ?? 1;
        if (kind === 'final-check') {
            const saved = session.finalChecks?.at(-1);
            // A complete iteration phase may still be waiting on its checker/repair.
            // Match its durable admission so stale step cancellations remain silent.
            if (!check || !saved || !['queued', 'running'].includes(saved.status)
                || saved.checkIndex !== check.checkIndex || saved.loopIndex !== check.loopIndex
                || saved.sourceIteration !== check.sourceIteration || iteration !== session.currentIteration
                || (saved.processId && saved.processId !== processId)
                || (repair ? !saved.repairAttempted || saved.processId !== processId : saved.taskId !== task.id)) return false;
        } else {
            // The journal records finished iterations; a queued continuation can be one ahead.
            if (session.phase !== 'executing' || iteration !== session.currentIteration + 1) return false;
        }
        // Explicit resume can reuse the iteration number. Its live task wins over history.
        if ([...this.deps.queue.getQueued(), ...this.deps.queue.getRunning()].some(active => {
            const activeContext = getRalphContext(active);
            return active.id !== task.id && activeContext?.sessionId === ctx.sessionId
                && (active.payload.workspaceId ?? active.repoId) === owner.workspaceId
                && (activeContext?.currentIteration ?? 1) >= iteration;
        })) return false;
        const record = await this.deps.sessions.recordCompletion(owner.workspaceId, ctx.sessionId, {
            reason: 'user-stopped', processId,
            totalIterations: session.currentIteration, completedAt: new Date().toISOString(),
        });
        if (this.disposed) return true;
        const completion = record.completion!;
        await this.saveSessionResult(job, completion.reason, completion.totalIterations, record, completion.processId);
        return true;
    }

    private async executionOwner(job: DelegatedJob): Promise<{ workspaceId: string; sessionId: string } | undefined> {
        return resolveRalphExecutionOwner(this.deps.dataDir, job.child);
    }

    private sessionEventId(job: DelegatedJob): string {
        return `ralph:${job.child.workspaceId}:${job.child.sessionId}:terminal`;
    }

    private sessionLinks(job: DelegatedJob): string[] {
        return [...this.links(job),
            ...(this.deps.sessions ? [this.deps.sessions.getProgressPath(job.child.workspaceId, job.child.sessionId!).slice(0, 2_000)] : [])];
    }

    private async saveSessionResult(
        job: DelegatedJob, reason: string, iterations: number, session?: RalphSessionRecord, processId?: string,
    ): Promise<void> {
        const outcome = reason === 'user-stopped' || reason === 'cancelled' ? 'cancelled'
            : reason === 'cap' && session?.terminalReason !== 'NO_SIGNAL' ? 'capped'
            : reason === 'signal' || reason === 'manual-verification-only' ? 'completed' : 'failed';
        const process = outcome !== 'cancelled' && processId
            ? await this.deps.store.getProcess(processId, session?.workspaceId ?? job.child.workspaceId) : undefined;
        if (this.disposed) return;
        const summary = process?.metadata?.workspaceId === (session?.workspaceId ?? job.child.workspaceId) ? storedResponse(process) : undefined;
        this.deps.jobs.recordResult(job.parent.workspaceId, job.id, {
            terminalEventId: this.sessionEventId(job), outcome, reason,
            summary: outcome === 'cancelled' ? 'The user stopped the delegated Ralph session.'
                : `The delegated Ralph session ${outcome} after ${iterations} iterations (${reason}).`
                    + (outcome === 'capped' ? ' The automation limit was reached; goal completion is not confirmed.' : '')
                    + (summary ? `\n${summary}` : ''),
            links: session ? [
                buildDashboardChatReference(this.deps.jobs.serverIdentity, processId ? session.workspaceId : job.child.workspaceId, processId ?? job.child.processId),
                ...(this.deps.sessions ? [this.deps.sessions.getProgressPath(session.workspaceId, session.sessionId)] : []),
            ] : this.sessionLinks(job),
        });
        const recorded = this.deps.jobs.list(job.parent.workspaceId).find(row => row.id === job.id);
        if (recorded && !this.disposed) await this.deps.onResult?.(recorded);
    }

    private async recordGrilling(job: DelegatedJob, process?: AIProcess, status?: string): Promise<void> {
        if (this.deps.wholeSessionOnly) return;
        if (!this.deps.dataDir || !job.child.sessionId) return;
        const grilling = new RalphGrillingStore(this.deps.dataDir);
        const state = process && this.deps.store.updateProcess
            ? await reconcileRalphGoal(process, { dataDir: this.deps.dataDir, store: this.deps.store as Pick<ProcessStore, 'getProcess' | 'updateProcess'> })
            : await grilling.read(job.child.workspaceId, job.child.sessionId);
        const goal = state && await grilling.validatedGoal(state);
        const outcome = status === 'cancelled' || process?.status === 'cancelled' ? 'cancelled'
            : status === 'failed' || process?.status === 'failed' ? 'failed' : goal ? 'completed' : undefined;
        if (!outcome) return;
        this.deps.jobs.recordResult(job.parent.workspaceId, job.id, {
            terminalEventId: `ralph:${job.child.workspaceId}:${job.child.sessionId}:grill`, outcome,
            reason: goal && outcome === 'completed' ? 'spec-ready' : 'grilling-incomplete',
            summary: outcome === 'completed' ? 'Goal spec ready; awaiting explicit user implementation approval. No execution has started.'
                : `The grilling interview ${outcome}. No execution has started.`,
            links: [...this.links(job), ...(goal && state?.goal ? [state.goal.path] : [])],
        }, { state: 'pending' }, 'grill');
        const recorded = this.deps.jobs.list(job.parent.workspaceId).find(row => row.id === job.id);
        if (recorded?.grilling) await this.deps.onResult?.(grillingResultJob(recorded)!);
    }

    private isOrdinaryPending(job: DelegatedJob): boolean {
        return !job.terminal && !job.child.sessionId && !job.child.serverId && !job.child.requestId;
    }

    /** Request rows settle from their own task, or from that request's turns after restart. */
    private async restoreRequest(job: DelegatedJob): Promise<void> {
        const requestId = job.child.requestId!;
        const task = [
            ...this.deps.queue.getQueued(), ...this.deps.queue.getRunning(),
            this.deps.queue.getTask(requestId), this.deps.queue.getTask(`pending-${job.child.processId}-${requestId}`),
            this.deps.getRetainedTask?.(job.child.workspaceId, requestId),
            this.deps.getRetainedTask?.(job.child.workspaceId, `pending-${job.child.processId}-${requestId}`),
            ...this.deps.queue.getHistory(),
        ].find((candidate): candidate is QueuedTask => !!candidate && candidate.payload.relayRequestId === requestId
            && matchesChild(job, candidate));
        if (task) {
            // A restored queued/running task wins over stale process status.
            if (isTerminalStatus(task.status)) await this.recordRequest(job, task);
            return;
        }
        const process = await this.childProcess(job);
        if (this.disposed) return;
        // Still buffered: its drained task will settle it.
        if (process?.pendingMessages?.some(message => message.id === requestId || message.relayRequestId === requestId)) return;
        const turns = process?.conversationTurns ?? [];
        const start = findRequestTurn(turns, requestId);
        if (!process || start < 0) {
            this.deps.jobs.recordResult(job.parent.workspaceId, job.id, {
                terminalEventId: this.terminalEventId(job), outcome: 'failed',
                summary: 'The follow-up request is unavailable after restart.',
                reason: 'Neither its queue task nor its conversation turn exists in the recorded workspace.',
                links: this.links(job),
            }, { state: 'failed', reason: 'Follow-up request unavailable during startup recovery.' });
            return;
        }
        const { answer, closed } = findRequestAnswer(turns, start);
        // Only an unclosed request is still described by the process status.
        if (!closed && !isTerminalStatus(process.status)) return;
        const failure = findRequestFailureEvidence(turns, start);
        const outcome = failure ? 'failed' : answer ? 'completed'
            : !closed && isTerminalStatus(process.status) ? process.status : 'failed';
        await this.saveResult(job, outcome, answer?.content, failure?.interruptionReason, process.resultFilePath);
    }

    private async recordRequest(job: DelegatedJob, task: QueuedTask): Promise<void> {
        if (!isTerminalStatus(task.status)) return;
        if (job.terminal) {
            await this.deps.onResult?.(job);
            return;
        }
        const process = await this.childProcess(job);
        if (this.disposed) return;
        const turns = process?.conversationTurns ?? [];
        const start = findRequestTurn(turns, job.child.requestId!);
        const answer = start >= 0 ? findRequestAnswer(turns, start).answer?.content : undefined;
        // Later turns may already exist, so never read the process's last response.
        await this.saveResult(job, task.status, responseText(task.result) ?? answer, task.error);
    }

    private async recordTerminal(task: QueuedTask): Promise<void> {
        if (!isTerminalStatus(task.status) || task.type !== 'chat') return;
        const ctx = getRalphContext(task);
        for (const workspace of await this.deps.store.getWorkspaces()) {
            if (this.disposed) return;
            try {
                if (ctx) {
                    for (const sessionJob of this.deps.jobs.list(workspace.id)) {
                        if (sessionJob.child.serverId || !sessionJob.child.sessionId) continue;
                        if (ctx.phase === 'grilling' && sessionJob.child.sessionId === ctx.sessionId
                            && sessionJob.child.workspaceId === (task.payload.workspaceId ?? task.repoId)) {
                            await this.recordGrilling(sessionJob, await this.childProcess(sessionJob), task.status);
                        } else if (ctx.phase !== 'grilling') {
                            await this.recordQueuedSessionCancellation(sessionJob, task);
                        }
                    }
                    continue;
                }
                const rows = this.deps.jobs.list(workspace.id).filter(row =>
                    !row.child.sessionId && !row.child.serverId && matchesChild(row, task));
                const requestId = task.payload.relayRequestId;
                const request = typeof requestId === 'string'
                    ? rows.find(row => row.child.requestId === requestId) : undefined;
                if (request) {
                    await this.recordRequest(request, task);
                    continue;
                }
                const job = rows.find(row => !row.child.requestId);
                if (job) await this.recordJob(job, task);
            } catch (error) {
                console.error(`[delegated-job-results] Could not record workspace ${workspace.id}:`, error);
            }
        }
    }

    private async recordJob(job: DelegatedJob, task: QueuedTask): Promise<void> {
        if (!isTerminalStatus(task.status)) return;
        if (job.terminal) {
            await this.deps.onResult?.(job);
            return;
        }
        const outcome = task.status;
        const summary = responseText(task.result);
        const reason = task.error;
        const process = await this.childProcess(job);
        if (this.disposed) return;
        await this.saveResult(job, outcome, summary ?? storedResponse(process),
            reason ?? process?.error, process?.resultFilePath);
    }

    private async saveResult(
        job: DelegatedJob,
        outcome: 'completed' | 'failed' | 'cancelled',
        summary?: string,
        reason?: string,
        resultFilePath?: string,
    ): Promise<void> {
        this.deps.jobs.recordResult(job.parent.workspaceId, job.id, {
            terminalEventId: this.terminalEventId(job), outcome,
            // A cancelled job receives a notice, never a review of partial output.
            summary: outcome === 'cancelled' ? 'The user cancelled the delegated job.'
                : summary || `The delegated job ${outcome}; no result summary was stored.`,
            ...(outcome === 'failed' && reason ? { reason } : {}),
            links: this.links(job, resultFilePath),
        });
        const recorded = this.deps.jobs.list(job.parent.workspaceId).find(row => row.id === job.id);
        if (recorded) await this.deps.onResult?.(recorded);
    }

    private async childProcess(job: DelegatedJob): Promise<AIProcess | undefined> {
        const process = await this.deps.store.getProcess(job.child.processId, job.child.workspaceId);
        // The native store looks up by ID and ignores the optional workspace scope.
        return process?.id === job.child.processId && process.metadata?.workspaceId === job.child.workspaceId
            ? process : undefined;
    }

    private terminalEventId(job: DelegatedJob): string {
        if (job.child.requestId) return `request:${job.child.workspaceId}:${job.child.processId}:${job.child.requestId}:terminal`;
        return `ordinary:${job.child.workspaceId}:${job.child.processId}:terminal`;
    }

    private links(job: DelegatedJob, resultFilePath?: string): string[] {
        return [buildDashboardChatReference(this.deps.jobs.serverIdentity, job.child.workspaceId, job.child.processId),
            ...(resultFilePath ? [resultFilePath.slice(0, 2_000)] : [])];
    }
}
