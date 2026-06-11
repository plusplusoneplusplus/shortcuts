import type { QueuedTask } from '@plusplusoneplusplus/forge';
import type { DreamRunExecutor, DreamRunExecutionResult, DreamRunRequestOptions } from '../dreams/dream-runner';
import type { DreamRunPayload, ReasoningEffort } from '../tasks/task-types';
import { isDreamRunPayload } from '../tasks/task-types';

export interface DreamTaskExecutorOptions {
    getRunner: () => DreamRunExecutor | undefined;
    cancelledTasks: Set<string>;
}

export class DreamTaskExecutor {
    private readonly getRunner: () => DreamRunExecutor | undefined;
    private readonly cancelledTasks: Set<string>;

    constructor(options: DreamTaskExecutorOptions) {
        this.getRunner = options.getRunner;
        this.cancelledTasks = options.cancelledTasks;
    }

    async execute(task: QueuedTask): Promise<Record<string, unknown>> {
        if (!isDreamRunPayload(task.payload)) {
            throw new Error('Dream task executor received a non-dream task payload');
        }
        const runner = this.getRunner();
        if (!runner) {
            throw new Error('Dream run executor is not configured');
        }

        const payload = task.payload as unknown as DreamRunPayload;
        const abortController = new AbortController();
        if (this.cancelledTasks.has(task.id)) {
            abortController.abort();
        }
        const cancelPoll = setInterval(() => {
            if (this.cancelledTasks.has(task.id)) {
                abortController.abort();
            }
        }, 250);
        cancelPoll.unref?.();

        try {
            const result = await runner.runQueued(payload.workspaceId, payload.trigger, {
                ...dreamOptionsFromPayload(payload, task),
                ...(task.processId ? { parentProcessId: task.processId } : {}),
                signal: abortController.signal,
            });
            return summarizeDreamRun(result);
        } finally {
            clearInterval(cancelPoll);
        }
    }
}

function dreamOptionsFromPayload(payload: DreamRunPayload, task: QueuedTask): DreamRunRequestOptions {
    const reasoningEffort = typeof task.config.reasoningEffort === 'string'
        ? task.config.reasoningEffort as ReasoningEffort
        : payload.reasoningEffort;
    return {
        ...(payload.provider ? { provider: payload.provider } : {}),
        ...(typeof task.config.model === 'string' ? { model: task.config.model } : payload.model ? { model: payload.model } : {}),
        ...(reasoningEffort ? { reasoningEffort } : {}),
        ...(typeof payload.timeoutMs === 'number' ? { timeoutMs: payload.timeoutMs } : typeof task.config.timeoutMs === 'number' ? { timeoutMs: task.config.timeoutMs } : {}),
        ...(typeof payload.confidenceThreshold === 'number' ? { confidenceThreshold: payload.confidenceThreshold } : {}),
        ...(typeof payload.maxCandidates === 'number' ? { maxCandidates: payload.maxCandidates } : {}),
        ...(typeof payload.conversationLimit === 'number' ? { conversationLimit: payload.conversationLimit } : {}),
        ...(typeof payload.minIdleMs === 'number' ? { minIdleMs: payload.minIdleMs } : {}),
    };
}

function summarizeDreamRun(result: DreamRunExecutionResult): Record<string, unknown> {
    const acceptedCount = result.analysis.candidates.length;
    const rejectedCount = result.analysis.rejected.length;
    const response = [
        `Dream run ${result.run.id} completed.`,
        `Trigger: ${result.run.trigger}.`,
        `Sources: ${result.selection.conversations.length}.`,
        `Accepted: ${acceptedCount}.`,
        `Rejected: ${rejectedCount}.`,
    ].join(' ');

    return {
        response,
        run: result.run,
        processes: {
            ...(result.run.analyzerProcessId ? { analyzerProcessId: result.run.analyzerProcessId } : {}),
            ...(result.run.criticProcessId ? { criticProcessId: result.run.criticProcessId } : {}),
        },
        cardCount: result.cards.length,
        cardIds: result.cards.map(card => card.id),
        selection: {
            workspaceId: result.selection.workspaceId,
            conversationCount: result.selection.conversations.length,
            scannedProcessCount: result.selection.scannedProcessCount,
            skipped: result.selection.skipped,
        },
        analysis: {
            sourceRanges: result.analysis.sourceRanges,
            rawCandidateCount: result.analysis.rawCandidateCount,
            deterministicCandidateCount: result.analysis.deterministicCandidateCount,
            acceptedCandidateCount: acceptedCount,
            rejectedCandidateCount: rejectedCount,
        },
    };
}
