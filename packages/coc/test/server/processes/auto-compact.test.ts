import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CompactUnsupportedError, TaskQueueManager, type AIProcess, type QueuedTask } from '@plusplusoneplusplus/forge';
import { CLITaskExecutor } from '../../../src/server/queue/queue-executor-bridge';
import { cancelQueuedCompaction, compactProcess } from '../../../src/server/processes/compact-process';
import {
    autoCompactCancelledMetadata, maybeAutoCompactAfterResponse, parseAutoCompactSettings, readAutoCompact,
    resumeAutoCompact, saveAutoCompactSettings,
} from '../../../src/server/processes/auto-compact';
import { createMockProcessStore } from '../helpers/mock-process-store';
import { createMockSDKService } from '../../helpers/mock-sdk-service';

const sdk = createMockSDKService();
const compactSession = vi.fn();
vi.mock('@plusplusoneplusplus/forge', async importOriginal => ({
    ...await importOriginal<typeof import('@plusplusoneplusplus/forge')>(),
    sdkServiceRegistry: { getOrThrow: () => ({ ...sdk.service, compactSession }) },
}));

const LIMIT = 1000;

describe('Sentinel auto-compact lifecycle', () => {
    let store: ReturnType<typeof createMockProcessStore>;
    let queue: TaskQueueManager;
    let executor: CLITaskExecutor;
    let proc: AIProcess;
    let nextUsage: { currentTokens?: number; tokenLimit?: number };
    let bridge: any;

    beforeEach(async () => {
        compactSession.mockReset().mockResolvedValue({ success: true, messagesRemoved: 4, tokensRemoved: 600 });
        store = createMockProcessStore();
        queue = new TaskQueueManager({ keepHistory: true });
        executor = new CLITaskExecutor(store as any, { aiService: sdk.service });
        executor.setQueueManager(queue);
        nextUsage = { currentTokens: 900, tokenLimit: LIMIT };
        proc = {
            id: 'queue_sentinel', type: 'chat', status: 'completed', startTime: new Date(), promptPreview: 'watch',
            sdkSessionId: 'session-1', workingDirectory: process.cwd(), conversationTurns: [],
            metadata: { type: 'chat', workspaceId: 'ws-a', provider: 'copilot', mode: 'sentinel' },
        };
        await store.addProcess(proc);
        bridge = {
            enqueue: vi.fn(async input => queue.enqueue(input)),
            getTask: (id: string) => queue.getTask(id),
            findTaskByProcessId: (id: string) => queue.getAll().find(task => task.processId === id && ['queued', 'running'].includes(task.status)),
            findCompactionTask: (id: string) => queue.getAll().find(task => task.processId === id && task.payload.kind === 'compact' && ['queued', 'running'].includes(task.status)),
            cancelQueuedTask: (id: string) => queue.getTask(id)?.status === 'queued' && queue.cancelTask(id),
        };
        // A response: persist the assistant turn and usage, then run the real post-response hook.
        vi.spyOn((executor as any).executors.runner, 'run').mockImplementation(async (_task: unknown, opts: any) => {
            await store.appendConversationTurn(proc.id, index => ({ role: 'assistant', content: 'reply', timestamp: new Date(),
                turnIndex: index, timeline: [] }), { additionalUpdates: { status: 'completed', ...nextUsage } });
            await opts.onResponseCompleted?.(proc.id);
            return { success: true, durationMs: 0 };
        });
    });

    const current = async () => (await store.getProcess(proc.id))!;
    const autoState = async () => readAutoCompact((await current()).metadata);
    const enable = (thresholdPercent = 80) => saveAutoCompactSettings(store as any, proc.id, 'ws-a', { enabled: true, thresholdPercent });

    async function run(task: QueuedTask) {
        queue.markStarted(task.id);
        const result = await executor.execute(task);
        if (result.success) queue.markCompleted(task.id, result.result);
        else queue.markFailed(task.id, result.error!);
        return result;
    }

    /** Execute one chat turn through the executor so the real hook runs. */
    async function respond(usage: { currentTokens?: number; tokenLimit?: number } = nextUsage) {
        nextUsage = usage;
        const id = queue.enqueue({ processId: proc.id, type: 'chat', priority: 'normal', payload: { kind: 'chat', processId: proc.id, prompt: 'go' }, config: {} });
        await run(queue.getTask(id)!);
    }

    const compactTasks = () => queue.getAll().filter(task => task.payload.kind === 'compact');
    const queuedCompact = () => queue.getQueued().find(task => task.payload.kind === 'compact');

    it('stays off by default and when only enabling', async () => {
        await respond();
        expect(compactTasks()).toHaveLength(0);
        await enable();
        expect(compactTasks()).toHaveLength(0);
        expect(await autoState()).toMatchObject({ enabled: true, thresholdPercent: 80, consecutiveFailures: 0 });
    });

    it('queues one background compaction after a response strictly exceeds the threshold, then succeeds', async () => {
        await enable();
        await respond({ currentTokens: 800, tokenLimit: LIMIT });
        expect(compactTasks()).toHaveLength(0);
        await respond({ currentTokens: 900, tokenLimit: LIMIT });
        const task = queuedCompact()!;
        expect(task.payload).toMatchObject({ kind: 'compact', trigger: 'auto', processId: proc.id, workspaceId: 'ws-a' });
        expect(await autoState()).toMatchObject({ taskId: task.id, lastEvaluatedTurnIndex: 1 });
        expect((await current()).metadata?.compaction).toMatchObject({ state: 'queued', taskId: task.id });
        expect(compactSession).not.toHaveBeenCalled();

        await run(task);
        expect(compactSession).toHaveBeenCalledWith('session-1', undefined);
        const state = await autoState();
        expect(state).toMatchObject({ consecutiveFailures: 0, lastResult: { outcome: 'succeeded', tokensBefore: 900, tokensAfter: 300, tokenLimit: LIMIT, turnIndex: 1 } });
        expect(state?.taskId).toBeUndefined();
        // The display-only result turn is not a response: no recursive trigger.
        expect(await maybeAutoCompactAfterResponse(store as any, bridge, proc.id)).toEqual({ action: 'skipped', reason: 'already-evaluated' });
    });

    it('skips non-Sentinel chats, unknown usage, and recomputes the percent when the limit changes', async () => {
        await enable();
        await respond({ currentTokens: 900 });
        await store.updateProcess(proc.id, { tokenLimit: undefined });
        expect(await maybeAutoCompactAfterResponse(store as any, bridge, proc.id)).toEqual({ action: 'skipped', reason: 'unknown-usage' });
        // Same usage on a smaller model limit crosses the threshold.
        await respond({ currentTokens: 700, tokenLimit: 2000 });
        expect(compactTasks()).toHaveLength(0);
        await respond({ currentTokens: 700, tokenLimit: 800 });
        expect(compactTasks()).toHaveLength(1);

        await store.updateProcess(proc.id, { metadata: { ...(await current()).metadata!, mode: 'ask' } });
        expect(await maybeAutoCompactAfterResponse(store as any, bridge, proc.id)).toEqual({ action: 'skipped', reason: 'not-sentinel' });
    });

    it('admits at most one attempt per response across concurrent checks', async () => {
        await enable();
        await respond({ currentTokens: 500, tokenLimit: LIMIT });
        await store.updateProcess(proc.id, { currentTokens: 950 });
        const results = await Promise.all([1, 2, 3].map(() => maybeAutoCompactAfterResponse(store as any, bridge, proc.id)));
        expect(results.filter(result => result.action === 'queued')).toHaveLength(1);
        expect(compactTasks()).toHaveLength(1);
    });

    it('does not add an automatic compaction while a manual one is pending', async () => {
        await enable();
        await respond({ currentTokens: 100, tokenLimit: LIMIT });
        await store.updateProcess(proc.id, { status: 'running' });
        const manual = await compactProcess(store as any, await current(), 'manual', bridge);
        expect(manual.taskId).toBeDefined();
        await respond({ currentTokens: 950, tokenLimit: LIMIT });
        expect(compactTasks().map(task => task.id)).toEqual([manual.taskId]);
        expect(await autoState()).toMatchObject({ lastEvaluatedTurnIndex: 1 });
        expect((await autoState())?.taskId).toBeUndefined();
    });

    it('keeps already-buffered turns ahead of the automatic compaction', async () => {
        await enable();
        await store.updateProcess(proc.id, { pendingMessages: [
            { id: 'p1', content: 'p1', createdAt: new Date().toISOString(), provider: 'copilot' },
        ] } as any);
        await respond({ currentTokens: 950, tokenLimit: LIMIT });
        expect(queue.getQueued().map(task => task.payload.kind === 'compact' ? 'compact' : task.id)).toEqual([`pending-${proc.id}-p1`, 'compact']);
    });

    it('counts insufficient and failed attempts, pauses after two, and resumes explicitly', async () => {
        await enable();
        compactSession.mockResolvedValueOnce({ success: true, messagesRemoved: 1, tokensRemoved: 10 });
        await respond({ currentTokens: 900, tokenLimit: LIMIT });
        await run(queuedCompact()!);
        expect(await autoState()).toMatchObject({ consecutiveFailures: 1, lastResult: { outcome: 'insufficient', tokensAfter: 890 } });
        expect((await autoState())?.paused).toBeUndefined();

        compactSession.mockRejectedValueOnce(new Error('provider exploded'));
        await respond({ currentTokens: 900, tokenLimit: LIMIT });
        await run(queuedCompact()!);
        expect(await autoState()).toMatchObject({ consecutiveFailures: 2, paused: { reason: 'failures' },
            lastResult: { outcome: 'failed', error: expect.stringContaining('provider exploded') } });

        await respond({ currentTokens: 950, tokenLimit: LIMIT });
        expect(queuedCompact()).toBeUndefined();

        const resumed = await resumeAutoCompact(store as any, proc.id, 'ws-a');
        expect(resumed?.paused).toBeUndefined();
        expect(resumed?.consecutiveFailures).toBe(0);
        expect(queuedCompact()).toBeUndefined();
        await respond({ currentTokens: 950, tokenLimit: LIMIT });
        await run(queuedCompact()!);
        expect(await autoState()).toMatchObject({ consecutiveFailures: 0, lastResult: { outcome: 'succeeded' } });
    });

    it('pauses immediately for an unsupported provider; changing the setting re-arms it', async () => {
        await enable();
        compactSession.mockRejectedValueOnce(new CompactUnsupportedError('codex'));
        await respond({ currentTokens: 900, tokenLimit: LIMIT });
        await run(queuedCompact()!);
        expect(await autoState()).toMatchObject({ paused: { reason: 'unsupported' }, lastResult: { outcome: 'unsupported' } });
        await saveAutoCompactSettings(store as any, proc.id, 'ws-a', { enabled: true, thresholdPercent: 85 });
        expect((await autoState())?.paused).toBeUndefined();
    });

    it('settles a cancelled queued automatic compaction without counting a failure', async () => {
        await enable();
        await respond({ currentTokens: 900, tokenLimit: LIMIT });
        const task = queuedCompact()!;
        expect(await cancelQueuedCompaction(store as any, await current(), bridge)).toBe(true);
        // The next response reconciles the stale automatic task and may retry.
        await respond({ currentTokens: 900, tokenLimit: LIMIT });
        const state = await autoState();
        expect(state?.consecutiveFailures).toBe(0);
        expect(state?.taskId).not.toBe(task.id);
        expect(queuedCompact()).toBeDefined();
        expect(autoCompactCancelledMetadata({ type: 'chat', autoCompact: { enabled: true, thresholdPercent: 80, taskId: 'x' } }, 'x').autoCompact)
            .toMatchObject({ lastResult: { outcome: 'cancelled' } });
    });

    it('settles an attempt interrupted by a restart as failed on the next response', async () => {
        await enable();
        const meta = (await current()).metadata!;
        await store.updateProcess(proc.id, { metadata: { ...meta,
            autoCompact: { ...(meta.autoCompact as object), taskId: 'gone', lastEvaluatedTurnIndex: -1 },
            compaction: { state: 'failed', taskId: 'gone', priorStatus: 'completed', startedAt: new Date().toISOString(), error: 'Compaction interrupted by server restart' },
        } as any });
        await respond({ currentTokens: 100, tokenLimit: LIMIT });
        expect(await autoState()).toMatchObject({ consecutiveFailures: 1,
            lastResult: { outcome: 'failed', error: 'Compaction interrupted by server restart' } });
        expect((await autoState())?.taskId).toBeUndefined();
    });

    it('validates settings', () => {
        expect(parseAutoCompactSettings({ enabled: true, thresholdPercent: 80 })).toEqual({ enabled: true, thresholdPercent: 80 });
        for (const thresholdPercent of [45, 100, 82, 80.5, '80']) {
            expect(typeof parseAutoCompactSettings({ enabled: true, thresholdPercent })).toBe('string');
        }
        expect(typeof parseAutoCompactSettings({ thresholdPercent: 80 })).toBe('string');
    });
});

describe('auto-compact queued cancellation through the workspace router', () => {
    it('records a router-cancelled automatic task as cancelled', async () => {
        const { MultiRepoQueueRouter } = await import('../../../src/server/queue/multi-repo-queue-router');
        const { RepoQueueRegistry } = await import('@plusplusoneplusplus/forge');
        const store = createMockProcessStore();
        const router = new MultiRepoQueueRouter(new RepoQueueRegistry(), store as any, { aiService: sdk.service, autoStart: false });
        try {
            await store.addProcess({ id: 'queue_s', type: 'chat', status: 'completed', startTime: new Date(), promptPreview: 's',
                sdkSessionId: 'sess', currentTokens: 900, tokenLimit: 1000, workingDirectory: process.cwd(),
                conversationTurns: [{ role: 'assistant', content: 'r', timestamp: new Date(), turnIndex: 0, timeline: [] }],
                metadata: { type: 'chat', workspaceId: 'ws-a', mode: 'sentinel' } });
            router.registerRepoId('ws-a', process.cwd());
            await saveAutoCompactSettings(store as any, 'queue_s', 'ws-a', { enabled: true, thresholdPercent: 80 });
            const result = await maybeAutoCompactAfterResponse(store as any, router, 'queue_s');
            expect(result.action).toBe('queued');
            const taskId = (result as { taskId: string }).taskId;
            expect(router.cancelQueuedTask(taskId)).toBe(true);
            await vi.waitFor(async () => expect(readAutoCompact((await store.getProcess('queue_s'))!.metadata))
                .toMatchObject({ consecutiveFailures: 0, lastResult: { outcome: 'cancelled', turnIndex: 0 } }));
            expect((await store.getProcess('queue_s'))!.metadata!.compaction).toMatchObject({ state: 'cancelled' });
        } finally { router.dispose(); }
    });
});
