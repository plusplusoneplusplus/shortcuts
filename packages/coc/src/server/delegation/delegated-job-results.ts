import { toQueueProcessId, toTaskId, type AIProcess, type ProcessStore, type QueuedTask } from '@plusplusoneplusplus/forge';
import { onTaskTerminal } from '../messaging/chat-target';
import { isTerminalStatus } from '../messaging/relay-answer';
import type { ScheduleQueueEventBus } from '../schedule/schedule-queue-await';
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
 * Record ordinary delegated results before any parent review is admitted.
 * Only registered relationships are reconciled; Ralph and remote jobs have
 * separate terminal boundaries and cannot be settled by these queue events.
 */
export class DelegatedJobResults {
    private readonly unsubscribe: () => void;
    private disposed = false;

    constructor(private readonly deps: {
        jobs: DelegatedJobStore;
        store: Pick<ProcessStore, 'getWorkspaces' | 'getProcess'>;
        queue: Pick<ScheduleQueueEventBus, 'on' | 'off' | 'getTask'>;
    }) {
        this.unsubscribe = onTaskTerminal(deps.queue, task => {
            // Queue task objects can be reused by follow-ups before async reads finish.
            const terminal = { ...task, payload: { ...task.payload }, result: responseText(task.result) };
            void this.recordTerminal(terminal).catch(error =>
                console.error('[delegated-job-results] Could not record terminal result:', error));
        });
    }

    dispose(): void {
        this.disposed = true;
        this.unsubscribe();
    }

    /** Run during startup, with restored queues stopped and before new dispatch. */
    async restore(): Promise<void> {
        for (const workspace of await this.deps.store.getWorkspaces()) {
            if (this.disposed) return;
            try {
                for (const job of this.deps.jobs.list(workspace.id)) {
                    if (!this.isOrdinaryPending(job)) continue;
                    try {
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
                            this.saveResult(job, process.status, storedResponse(process), process.error, process.resultFilePath);
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

    private isOrdinaryPending(job: DelegatedJob): boolean {
        return !job.terminal && !job.child.sessionId && !job.child.serverId;
    }

    private async recordTerminal(task: QueuedTask): Promise<void> {
        if (!isTerminalStatus(task.status) || task.type !== 'chat' || getRalphContext(task)) return;
        for (const workspace of await this.deps.store.getWorkspaces()) {
            if (this.disposed) return;
            try {
                const job = this.deps.jobs.list(workspace.id).find(row =>
                    this.isOrdinaryPending(row) && matchesChild(row, task));
                if (job) await this.recordJob(job, task);
            } catch (error) {
                console.error(`[delegated-job-results] Could not record workspace ${workspace.id}:`, error);
            }
        }
    }

    private async recordJob(job: DelegatedJob, task: QueuedTask): Promise<void> {
        if (!isTerminalStatus(task.status)) return;
        const outcome = task.status;
        const summary = responseText(task.result);
        const reason = task.error;
        const process = await this.deps.store.getProcess(job.child.processId, job.child.workspaceId);
        if (this.disposed) return;
        this.saveResult(job, outcome, summary ?? storedResponse(process),
            reason ?? process?.error, process?.resultFilePath);
    }

    private saveResult(
        job: DelegatedJob,
        outcome: 'completed' | 'failed' | 'cancelled',
        summary?: string,
        reason?: string,
        resultFilePath?: string,
    ): void {
        this.deps.jobs.recordResult(job.parent.workspaceId, job.id, {
            terminalEventId: this.terminalEventId(job), outcome,
            // A cancelled job receives a notice, never a review of partial output.
            summary: outcome === 'cancelled' ? 'The user cancelled the delegated job.'
                : summary || `The delegated job ${outcome}; no result summary was stored.`,
            ...(outcome === 'failed' && reason ? { reason } : {}),
            links: this.links(job, resultFilePath),
        });
    }

    private terminalEventId(job: DelegatedJob): string {
        return `ordinary:${job.child.workspaceId}:${job.child.processId}:terminal`;
    }

    private links(job: DelegatedJob, resultFilePath?: string): string[] {
        return [`#/process/${encodeURIComponent(job.child.processId)}`,
            ...(resultFilePath ? [resultFilePath.slice(0, 2_000)] : [])];
    }
}
