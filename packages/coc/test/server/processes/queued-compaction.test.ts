import { beforeEach, describe, expect, it, vi } from 'vitest';
import { RepoQueueRegistry, TaskQueueManager, type AIProcess, type QueuedTask } from '@plusplusoneplusplus/forge';
import { MultiRepoQueueRouter } from '../../../src/server/queue/multi-repo-queue-router';
import { compactProcess, cancelQueuedCompaction } from '../../../src/server/processes/compact-process';
import { ProcessMessageDeliveryService } from '../../../src/server/processes/process-message-delivery-service';
import { CLITaskExecutor } from '../../../src/server/queue/queue-executor-bridge';
import { createMockProcessStore } from '../helpers/mock-process-store';
import { createMockSDKService } from '../../helpers/mock-sdk-service';

const sdk = createMockSDKService();
const compactSession = vi.fn();
vi.mock('@plusplusoneplusplus/forge', async importOriginal => ({
    ...await importOriginal<typeof import('@plusplusoneplusplus/forge')>(),
    sdkServiceRegistry: { getOrThrow: () => ({ ...sdk.service, compactSession }) },
}));

const message = (id: string) => ({ id, content: id, createdAt: new Date().toISOString(), provider: 'copilot' as const });

describe('queued conversation compaction admission', () => {
    let store: ReturnType<typeof createMockProcessStore>;
    let queue: TaskQueueManager;
    let executor: CLITaskExecutor;
    let bridge: any;
    let delivery: ProcessMessageDeliveryService;
    let proc: AIProcess;
    let executed: string[];

    beforeEach(async () => {
        compactSession.mockReset().mockResolvedValue({ success: true, messagesRemoved: 2, tokensRemoved: 100 });
        store = createMockProcessStore();
        queue = new TaskQueueManager({ keepHistory: true });
        executor = new CLITaskExecutor(store as any, { aiService: sdk.service });
        executor.setQueueManager(queue);
        executed = [];
        proc = { id: 'queue-origin', type: 'chat', status: 'running', startTime: new Date(),
            promptPreview: 'original', sdkSessionId: 'session-original', currentTokens: 500,
            workingDirectory: process.cwd(), metadata: { type: 'chat', workspaceId: 'ws-a', provider: 'copilot' },
            pendingMessages: [message('before-1'), message('before-2')], conversationTurns: [],
        };
        await store.addProcess(proc);
        queue.enqueue({ id: 'origin', processId: proc.id, type: 'chat', priority: 'normal', payload: { kind: 'chat' }, config: {} });
        queue.markStarted('origin');
        bridge = {
            enqueue: vi.fn(async input => queue.enqueue(input)),
            getTask: (id: string) => queue.getTask(id),
            findTaskByProcessId: (id: string) => queue.getAll().find(task => task.processId === id && ['queued', 'running'].includes(task.status)),
            findCompactionTask: (id: string) => queue.getAll().find(task => task.processId === id && task.payload.kind === 'compact' && ['queued', 'running'].includes(task.status)),
            cancelQueuedTask: (id: string) => queue.getTask(id)?.status === 'queued' && queue.cancelTask(id),
            steerProcess: vi.fn().mockResolvedValue(true),
        };
        delivery = new ProcessMessageDeliveryService({ store: store as any, bridge });
        vi.spyOn((executor as any).executors.runner, 'run').mockImplementation(async (value: unknown) => {
            const task = value as QueuedTask;
            executed.push(task.payload.prompt as string);
            await store.appendConversationTurn(proc.id, index => ({ role: 'assistant', content: `answer:${task.payload.prompt}`,
                timestamp: new Date(), turnIndex: index, timeline: [] }), { additionalUpdates: { status: 'completed', sdkSessionId: `session-${task.payload.prompt}` } });
            return { success: true, durationMs: 0 };
        });
    });

    async function arrive(content: string, mode: 'immediate' | 'enqueue' = 'immediate') {
        return delivery.deliver((await store.getProcess(proc.id))!, {
            content, displayContent: content, deliveryMode: mode, pasteExternalized: false,
            provider: 'copilot',
        });
    }

    async function finishActive() {
        await store.updateProcess(proc.id, { status: 'completed' });
        queue.markCompleted('origin');
    }

    async function runNext() {
        const next = queue.peek() as QueuedTask | undefined;
        expect(next).toBeDefined();
        queue.markStarted(next!.id);
        const result = await executor.execute(next!);
        if (result.success) queue.markCompleted(next!.id, result.result);
        else queue.markFailed(next!.id, result.error!);
        return next!;
    }

    it('finishes existing queued and buffered turns, compacts the latest session, then runs new arrivals', async () => {
        queue.enqueue({ id: 'already-queued', processId: proc.id, type: 'chat', priority: 'normal',
            payload: { kind: 'chat', processId: proc.id, prompt: 'already-queued' }, config: {} });
        const outcome = await compactProcess(store as any, proc, 'keep decisions', bridge);
        expect(outcome.result).toMatchObject({ state: 'queued', taskId: outcome.taskId });
        expect(queue.peek()).toBeUndefined();
        const arrival = await arrive('after');
        expect(arrival.path).toBe('buffered');
        expect(bridge.steerProcess).not.toHaveBeenCalled();
        // Priority and manual reorder cannot cross the durable admission dependency.
        queue.updateTask(arrival.taskId!, { priority: 'high' });
        queue.moveToTop(arrival.taskId!);
        await finishActive();
        for (let n = 0; n < 3; n++) await runNext();
        expect(executed).toEqual(['already-queued', 'before-1', 'before-2']);
        expect((await runNext()).id).toBe(outcome.taskId);
        expect(compactSession).toHaveBeenCalledWith('session-before-2', 'keep decisions');
        await runNext();
        expect(executed).toEqual(['already-queued', 'before-1', 'before-2', 'after']);
        expect((await store.getProcess(proc.id))!.pendingMessages).toEqual([]);
        const turns = (await store.getProcess(proc.id))!.conversationTurns!;
        const compactIndex = turns.findIndex(turn => turn.displayOnly);
        expect(turns[compactIndex + 1].content).toBe('after');
    });

    it('preserves buffered admission order through the real workspace router', async () => {
        const router = new MultiRepoQueueRouter(new RepoQueueRegistry(), store as any, { aiService: sdk.service, autoStart: false });
        try {
            router.registerRepoId('ws-a', proc.workingDirectory!);
            const manager = router.registry.getQueueForRepo(proc.workingDirectory!);
            manager.enqueue({ id: 'origin', processId: proc.id, type: 'chat', priority: 'normal', payload: { kind: 'chat' }, config: {} });
            manager.markStarted('origin');
            const compact = await compactProcess(store as any, proc, 'keep order', router);
            const service = new ProcessMessageDeliveryService({ store: store as any, bridge: router });
            const later = await service.deliver((await store.getProcess(proc.id))!, {
                content: 'later', displayContent: 'later', deliveryMode: 'immediate', pasteExternalized: false,
            });
            expect(manager.getQueued().map(task => task.id)).toEqual([
                `pending-${proc.id}-before-1`, `pending-${proc.id}-before-2`, compact.taskId, later.taskId,
            ]);
            expect(manager.getTask(compact.taskId!)!.config.processPredecessorId).toBe(`pending-${proc.id}-before-2`);
            expect(manager.getTask(later.taskId!)!.config.processPredecessorId).toBe(compact.taskId);
        } finally { router.dispose(); }
    });

    it('deduplicates concurrent idle requests before their state write and preserves idle results', async () => {
        await finishActive();
        await store.updateProcess(proc.id, { pendingMessages: [] });
        const idle = (await store.getProcess(proc.id))!;
        let finish!: (value: any) => void;
        compactSession.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
        const first = compactProcess(store as any, idle, 'original', bridge);
        const repeated = compactProcess(store as any, idle, 'replacement', bridge);
        await vi.waitFor(() => expect(compactSession).toHaveBeenCalledTimes(1));
        finish({ success: true, tokensRemoved: 20, messagesRemoved: 1 });
        expect(await repeated).toEqual(await first);
        expect(compactSession).toHaveBeenCalledWith('session-original', 'original');
        expect(queue.getQueued()).toHaveLength(0);
    });

    it('deduplicates simultaneous requests and retains the original instructions', async () => {
        const outcomes = await Promise.all(['original', 'replacement', 'third'].map(instructions =>
            compactProcess(store as any, proc, instructions, bridge)));
        expect(new Set(outcomes.map(outcome => outcome.taskId)).size).toBe(1);
        expect(queue.getQueued().filter(task => task.payload.kind === 'compact')).toHaveLength(1);
        expect((await store.getProcess(proc.id))!.metadata!.compaction!.customInstructions).toBe('original');
    });

    it('cancel removes only compaction and preserves earlier turn dependencies', async () => {
        const outcome = await compactProcess(store as any, proc, undefined, bridge);
        const after = await arrive('after');
        queue.moveToTop(after.taskId!);
        expect(await cancelQueuedCompaction(store as any, proc, bridge)).toBe(true);
        expect(queue.getTask('origin')!.status).toBe('running');
        expect(queue.peek()).toBeUndefined();
        await finishActive();
        await runNext(); await runNext(); await runNext();
        expect(executed).toEqual(['before-1', 'before-2', 'after']);
        expect(queue.getTask(outcome.taskId!)!.status).toBe('cancelled');
        expect(compactSession).not.toHaveBeenCalled();
    });

    it('failure keeps valid context and releases later messages without retry or repo pause', async () => {
        const outcome = await compactProcess(store as any, proc, undefined, bridge);
        await arrive('after');
        await finishActive(); await runNext(); await runNext();
        compactSession.mockRejectedValueOnce(new Error('summary failed'));
        await runNext();
        const failed = (await store.getProcess(proc.id))!;
        expect(failed.metadata!.compaction).toMatchObject({ state: 'failed', error: 'summary failed' });
        expect(failed.currentTokens).toBe(500);
        expect(failed.sdkSessionId).toBe('session-before-2');
        expect(queue.getTask(outcome.taskId!)!.config).toMatchObject({ retryOnFailure: false, pauseOnFailure: false });
        await runNext();
        expect(executed.at(-1)).toBe('after');
        expect(queue.peek()).toBeUndefined();
        expect(compactSession).toHaveBeenCalledTimes(1);
    });

    it('admits later messages while the provider is compacting and rejects running Cancel', async () => {
        const outcome = await compactProcess(store as any, proc, undefined, bridge);
        await finishActive(); await runNext(); await runNext();
        let finish!: (value: any) => void;
        compactSession.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
        const next = queue.peek() as QueuedTask;
        queue.markStarted(next.id);
        const running = executor.execute(next);
        await vi.waitFor(() => expect(compactSession).toHaveBeenCalled());
        const arrival = await arrive('during');
        expect(arrival.taskId).toBeDefined();
        expect(await cancelQueuedCompaction(store as any, proc, bridge)).toBe(false);
        expect(queue.peek()).toBeUndefined();
        finish({ success: true, tokensRemoved: 10 });
        const result = await running;
        // Provider completion precedes task settlement; arrivals must still cross the barrier.
        const lateArrival = await arrive('after-sdk');
        expect(lateArrival.taskId).toBeDefined();
        expect(bridge.steerProcess).not.toHaveBeenCalled();
        queue.markCompleted(outcome.taskId!, result.result);
        await runNext();
        expect(executed.at(-1)).toBe('during');
        await runNext();
        expect(executed.at(-1)).toBe('after-sdk');
    });

    it('does not block another conversation or workspace', async () => {
        await compactProcess(store as any, proc, undefined, bridge);
        queue.enqueue({ id: 'other', processId: 'other-process', repoId: 'ws-b', type: 'chat', priority: 'normal', payload: {}, config: {} });
        expect(queue.peek()!.id).toBe('other');
        expect((await store.getProcess(proc.id))!.metadata!.workspaceId).toBe('ws-a');
        expect(queue.getQueued().find(task => task.payload.kind === 'compact')!.payload.workspaceId).toBe('ws-a');
    });
});
