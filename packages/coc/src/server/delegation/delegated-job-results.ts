import { toQueueProcessId, toTaskId, type AIProcess, type ProcessStore, type QueuedTask } from '@plusplusoneplusplus/forge';
import { onTaskTerminal } from '../messaging/chat-target';
import { isTerminalStatus } from '../messaging/relay-answer';
import type { ScheduleQueueEventBus } from '../schedule/schedule-queue-await';
import type { RalphSessionCompleteEvent } from '../queue/queue-executor-bridge';
import type { RalphSessionRecord } from '../ralph/types';
import type { RalphSessionStore } from '../ralph/ralph-session-store';
import { getRalphContext } from '../tasks/task-types';
import { DelegatedJobStore, type DelegatedJob } from './delegated-job-store';

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
        jobs: DelegatedJobStore;
        store: Pick<ProcessStore, 'getWorkspaces' | 'getProcess'>;
        queue: Pick<ScheduleQueueEventBus, 'on' | 'off' | 'getTask'>;
        sessions?: Pick<RalphSessionStore, 'readSessionRecord' | 'getProgressPath'>;
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
                        if (job.terminal) {
                            await this.deps.onResult?.(job);
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
                        const process = await this.deps.store.getProcess(job.child.processId, job.child.workspaceId);
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

    private async recordSessionTerminal(event: RalphSessionCompleteEvent): Promise<void> {
        if (!event.sessionId) return; // A process/step ID cannot identify the entire session.
        for (const workspace of await this.deps.store.getWorkspaces()) {
            if (this.disposed) return;
            try {
                const job = this.deps.jobs.list(workspace.id).find(row => !row.child.serverId
                    && row.child.workspaceId === event.workspaceId && row.child.sessionId === event.sessionId);
                if (!job) continue;
                const session = await this.deps.sessions?.readSessionRecord(event.workspaceId, event.sessionId);
                if (this.disposed) return;
                // The final process usually differs from the first registered iteration.
                await this.saveSessionResult(job, event.reason, event.totalIterations, session ?? undefined, event.processId);
            } catch (error) {
                console.error(`[delegated-job-results] Could not record Ralph workspace ${workspace.id}:`, error);
            }
        }
    }

    private async restoreSession(job: DelegatedJob): Promise<void> {
        if (!this.deps.sessions) return;
        const session = await this.deps.sessions.readSessionRecord(job.child.workspaceId, job.child.sessionId!);
        if (this.disposed) return;
        if (!session || session.workspaceId !== job.child.workspaceId || session.sessionId !== job.child.sessionId) {
            this.deps.jobs.recordResult(job.parent.workspaceId, job.id, {
                terminalEventId: this.sessionEventId(job), outcome: 'failed',
                summary: 'The delegated Ralph session is unavailable after restart.',
                reason: 'Its recorded session is missing or belongs to another workspace.', links: this.sessionLinks(job),
            }, { state: 'failed', reason: 'Delegated Ralph session unavailable during startup recovery.' });
            return;
        }
        if (session.phase === 'awaiting-input' || session.phase === 'grilling') return;
        if (session.completion && session.terminalReason !== 'USER_STOPPED') {
            await this.saveSessionResult(job, session.completion.reason, session.completion.totalIterations,
                session, session.completion.processId);
            return;
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

    private sessionEventId(job: DelegatedJob): string {
        return `ralph:${job.child.workspaceId}:${job.child.sessionId}:terminal`;
    }

    private sessionLinks(job: DelegatedJob): string[] {
        return [`/api/workspaces/${encodeURIComponent(job.child.workspaceId)}/ralph-sessions/${encodeURIComponent(job.child.sessionId!)}`,
            ...(this.deps.sessions ? [this.deps.sessions.getProgressPath(job.child.workspaceId, job.child.sessionId!).slice(0, 2_000)] : [])];
    }

    private async saveSessionResult(
        job: DelegatedJob, reason: string, iterations: number, session?: RalphSessionRecord, processId?: string,
    ): Promise<void> {
        const outcome = reason === 'user-stopped' || reason === 'cancelled' ? 'cancelled'
            : reason === 'cap' && session?.terminalReason !== 'NO_SIGNAL' ? 'capped'
            : reason === 'signal' || reason === 'manual-verification-only' ? 'completed' : 'failed';
        const process = outcome !== 'cancelled' && processId
            ? await this.deps.store.getProcess(processId, job.child.workspaceId) : undefined;
        if (this.disposed) return;
        const summary = process?.metadata?.workspaceId === job.child.workspaceId ? storedResponse(process) : undefined;
        this.deps.jobs.recordResult(job.parent.workspaceId, job.id, {
            terminalEventId: this.sessionEventId(job), outcome, reason,
            summary: outcome === 'cancelled' ? 'The user stopped the delegated Ralph session.'
                : `The delegated Ralph session ${outcome} after ${iterations} iterations (${reason}).`
                    + (outcome === 'capped' ? ' The automation limit was reached; goal completion is not confirmed.' : '')
                    + (summary ? `\n${summary}` : ''),
            links: this.sessionLinks(job),
        });
        const recorded = this.deps.jobs.list(job.parent.workspaceId).find(row => row.id === job.id);
        if (recorded && !this.disposed) await this.deps.onResult?.(recorded);
    }

    private isOrdinaryPending(job: DelegatedJob): boolean {
        return !job.terminal && !job.child.sessionId && !job.child.serverId;
    }

    private async recordTerminal(task: QueuedTask): Promise<void> {
        if (!isTerminalStatus(task.status) || task.type !== 'chat' || getRalphContext(task)) return;
        for (const workspace of await this.deps.store.getWorkspaces()) {
            if (this.disposed) return;
            try {
                const job = this.deps.jobs.list(workspace.id).find(row =>
                    !row.child.sessionId && !row.child.serverId && matchesChild(row, task));
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
        const process = await this.deps.store.getProcess(job.child.processId, job.child.workspaceId);
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

    private terminalEventId(job: DelegatedJob): string {
        return `ordinary:${job.child.workspaceId}:${job.child.processId}:terminal`;
    }

    private links(job: DelegatedJob, resultFilePath?: string): string[] {
        return [`#/process/${encodeURIComponent(job.child.processId)}`,
            ...(resultFilePath ? [resultFilePath.slice(0, 2_000)] : [])];
    }
}
