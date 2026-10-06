import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import path from 'path';
import os from 'os';
import { RepoQueueRegistry, type AIProcessStatus } from '@plusplusoneplusplus/forge';
import { createMockSDKService } from '../../helpers/mock-sdk-service';
import { createMockProcessStore } from '../../helpers/mock-process-store';
import { MultiRepoQueueRouter } from '../../../src/server/queue/multi-repo-queue-router';
import { createSendToConversationTool } from '../../../src/server/llm-tools/send-to-conversation-tool';
import { cancelConversation } from '../../../src/server/processes/cancel-conversation';
import type { QueueExecutorBridge } from '../../../src/server/core/api-handler';

const sdk = createMockSDKService();
const rootA = path.join(os.tmpdir(), 'coc-cancel-a');
const rootB = path.join(os.tmpdir(), 'coc-cancel-b');

describe('send_to_conversation cancellation lifecycle', () => {
    const routers: MultiRepoQueueRouter[] = [];

    beforeEach(() => sdk.resetAll());
    afterEach(() => {
        vi.useRealTimers();
        for (const router of routers.splice(0)) router.dispose();
    });

    function setup() {
        const store = createMockProcessStore();
        vi.mocked(store.getWorkspaces).mockResolvedValue([
            { id: 'ws-a', name: 'a', rootPath: rootA },
            { id: 'ws-b', name: 'b', rootPath: rootB },
        ]);
        const router = new MultiRepoQueueRouter(new RepoQueueRegistry(), store, { autoStart: false, aiService: sdk.service });
        routers.push(router);
        router.registerRepoId('ws-a', rootA);
        router.registerRepoId('ws-b', rootB);
        const enqueueChat = vi.fn();
        const sendMessage = vi.fn();
        const { tool } = createSendToConversationTool({
            store, workspaceId: 'ws-a', enqueueChat, sendMessage,
            runtime: { cancelConversation: (id, workspaceId) => cancelConversation(store, router, id, workspaceId) },
        });
        return { store, router, tool, enqueueChat, sendMessage };
    }

    async function seed(store: ReturnType<typeof createMockProcessStore>, id = 'queue_target', status: AIProcessStatus = 'running') {
        await store.addProcess({
            id, status, type: 'chat', promptPreview: 'test', startTime: new Date(), workingDirectory: rootB,
            metadata: { workspaceId: 'ws-b', provider: 'copilot', mode: 'ask' },
            conversationTurns: [{ role: 'user', content: 'original', timestamp: new Date(), turnIndex: 0 }],
        });
    }

    async function enqueue(router: MultiRepoQueueRouter, id: string, workspaceId = 'ws-b', processId?: string) {
        await router.enqueue({
            id, type: 'chat', repoId: workspaceId,
            payload: { kind: 'chat', mode: 'ask', prompt: 'test', workspaceId, ...(processId ? { processId } : {}) },
        });
    }

    it.each(['queued', 'running'] as const)('cancels a %s task before process materialization and retains queue history', async status => {
        const { store, router, tool, enqueueChat, sendMessage } = setup();
        await enqueue(router, 'target');
        if (status === 'running') router.findManagerForTask('target')!.markStarted('target');
        const result = await tool.handler({ action: 'cancel', processId: 'queue_target' });
        expect(result).toMatchObject({ processId: 'queue_target', workspaceId: 'ws-b', cancelled: true, status: 'cancelled' });
        expect(router.getTask('target')?.status).toBe('cancelled');
        expect(router.findManagerForTask('target')?.getHistory()).toHaveLength(1);
        expect(await store.getProcess('queue_target')).toBeUndefined();
        expect(enqueueChat).not.toHaveBeenCalled();
        expect(sendMessage).not.toHaveBeenCalled();
        expect(sdk.mockSendMessage).not.toHaveBeenCalled();
        expect(await tool.handler({ action: 'cancel', processId: 'queue_target' })).toMatchObject({ cancelled: false, status: 'cancelled' });
    });

    it('cancels without a per-repo executor using the existing queue manager', async () => {
        const store = createMockProcessStore();
        const registry = new RepoQueueRegistry();
        const manager = registry.getQueueForRepo(rootB);
        const id = manager.enqueue({ id: 'pending', type: 'chat', repoId: 'ws-b', payload: { kind: 'chat', prompt: 'test' } });
        const router = new MultiRepoQueueRouter(registry, store, { autoStart: false, aiService: sdk.service });
        routers.push(router);
        expect(await cancelConversation(store, router, `queue_${id}`)).toMatchObject({ cancelled: true, status: 'cancelled' });
        expect(manager.getTask(id)?.status).toBe('cancelled');
    });

    it.each(['completed', 'failed'] as const)('returns a terminal no-op for a %s task without a process', async status => {
        const { router, tool } = setup();
        await enqueue(router, 'target');
        const manager = router.findManagerForTask('target')!;
        manager.markStarted('target');
        if (status === 'completed') manager.markCompleted('target');
        else manager.markFailed('target', 'fixture failure');
        const abort = vi.spyOn(router, 'cancelProcess');
        expect(await tool.handler({ action: 'cancel', processId: 'queue_target' })).toMatchObject({ cancelled: false, status });
        expect(abort).not.toHaveBeenCalled();
    });

    it.each([false, true])('aborts active work before a session ID exists, preserves cancellation on provider success=%s, and isolates workspaces', async success => {
        const { store, router, tool } = setup();
        await seed(store);
        await seed(store, 'other');
        await store.updateProcess('other', { workingDirectory: rootA, metadata: { workspaceId: 'ws-a', provider: 'copilot' } });
        await enqueue(router, 'target');
        router.findManagerForTask('target')!.markStarted('target');
        await enqueue(router, 'unrelated', 'ws-a');
        let signal: AbortSignal | undefined;
        const started = Promise.withResolvers<void>();
        vi.spyOn(sdk.service, 'sendMessage').mockImplementation(async options => {
            signal = options.signal;
            started.resolve();
            await new Promise<void>(resolve => options.signal!.addEventListener('abort', () => resolve(), { once: true }));
            return success ? { success: true, response: 'partial' } : { success: false, error: 'aborted' };
        });
        const execution = router.getOrCreateBridge(rootB).executeFollowUp('queue_target', 'fixture follow-up');
        await started.promise;
        expect(signal?.aborted).toBe(false);
        const result = await tool.handler({ action: 'cancel', processId: 'queue_target', workspaceId: 'ws-b' });
        expect(result).not.toHaveProperty('error');
        expect(signal?.aborted).toBe(true);
        await execution;
        expect(result).toMatchObject({ cancelled: true, status: 'cancelled' });
        expect(router.getTask('target')?.status).toBe('cancelled');
        expect((await store.getProcess('queue_target'))?.status).toBe('cancelled');
        expect(store.completions.get('queue_target')?.status).toBe('cancelled');
        expect((await store.getProcess('other'))?.status).toBe('running');
        expect(router.getTask('unrelated')?.status).toBe('queued');
        expect(sdk.mockSoftAbortSession).not.toHaveBeenCalled();
        expect(store.removeProcess).not.toHaveBeenCalled();
    });

    it('cancels linked follow-up tasks and pending messages, not a fork source task', async () => {
        const { store, router, tool } = setup();
        await seed(store, 'fork');
        await store.updateProcess('fork', { metadata: { workspaceId: 'ws-b', queueTaskId: 'source' } });
        await store.appendPendingMessage('fork', { id: 'message', content: 'pending', createdAt: new Date().toISOString() });
        await enqueue(router, 'source');
        await enqueue(router, 'followup', 'ws-b', 'fork');
        router.findManagerForTask('followup')!.markStarted('followup');
        await enqueue(router, 'later', 'ws-b', 'fork');
        expect(await tool.handler({ action: 'cancel', processId: 'fork' })).toMatchObject({ processId: 'fork', cancelled: true });
        expect(router.getTask('source')?.status).toBe('queued');
        expect(router.getTask('followup')?.status).toBe('cancelled');
        expect(router.getTask('later')?.status).toBe('cancelled');
        expect((await store.getProcess('fork'))?.pendingMessages).toEqual([]);
        expect((await store.getProcess('fork'))?.conversationTurns).toHaveLength(1);
    });

    it.each(['completed', 'failed', 'cancelled'] as const)('returns a distinct no-op for terminal %s processes', async status => {
        const { store, router, tool } = setup();
        await seed(store, 'terminal', status);
        const abort = vi.spyOn(router, 'cancelProcess');
        expect(await tool.handler({ action: 'cancel', processId: 'terminal' })).toMatchObject({ cancelled: false, status });
        expect(abort).not.toHaveBeenCalled();
        expect(store.updateProcess).not.toHaveBeenCalled();
    });

    it('still cancels admitted follow-ups when the process has a terminal status', async () => {
        const { store, router, tool } = setup();
        await seed(store, 'terminal', 'completed');
        await enqueue(router, 'followup', 'ws-b', 'terminal');
        expect(await tool.handler({ action: 'cancel', processId: 'terminal' })).toMatchObject({ cancelled: true, status: 'completed' });
        expect(router.getTask('followup')?.status).toBe('cancelled');
    });

    it('resolves prefixed bare process IDs and serializes concurrent cancellation', async () => {
        const { store, router, tool } = setup();
        await seed(store, 'bare');
        const abort = vi.spyOn(router, 'cancelProcess');
        const results = await Promise.all([
            tool.handler({ action: 'cancel', processId: 'queue_bare' }),
            tool.handler({ action: 'cancel', processId: 'bare' }),
        ]);
        expect(results.map(result => 'cancelled' in result ? result.cancelled : undefined).sort()).toEqual([false, true]);
        expect(abort).toHaveBeenCalledExactlyOnceWith('bare');
    });

    it.each(['missing', '../target', 'queue_', 'remote:server:target', 'queue_target/other'])('errors for unknown or invalid ID %s without mutation', async processId => {
        const { store, router, tool } = setup();
        const abort = vi.spyOn(router, 'cancelProcess');
        expect(await tool.handler({ action: 'cancel', processId })).toHaveProperty('error');
        expect(abort).not.toHaveBeenCalled();
        expect(store.updateProcess).not.toHaveBeenCalled();
    });

    it.each([false, true])('does not cross an explicit workspace boundary (materialized=%s)', async materialized => {
        const { store, router, tool } = setup();
        await enqueue(router, 'target');
        if (materialized) await seed(store);
        expect(await tool.handler({ action: 'cancel', processId: 'queue_target', workspaceId: 'ws-a' })).toMatchObject({ code: 'NOT_FOUND' });
        expect(router.getTask('target')?.status).toBe('queued');
    });

    it('rejects follow-up task aliases and non-cancellable running operations', async () => {
        const { router, tool } = setup();
        await enqueue(router, 'followup', 'ws-b', 'target');
        expect(await tool.handler({ action: 'cancel', processId: 'queue_followup' })).toHaveProperty('error');
        const task = router.getTask('followup')!;
        task.config.cancelRunning = false;
        router.findManagerForTask('followup')!.markStarted('followup');
        expect(router.getTask('followup')?.status).toBe('running');
        await expect(router.cancelProcess('target')).rejects.toThrow('cannot be cancelled');
    });

    it('reports protected running task conflicts before changing process or task state', async () => {
        const { store, router, tool } = setup();
        await enqueue(router, 'protected');
        router.getTask('protected')!.config.cancelRunning = false;
        router.findManagerForTask('protected')!.markStarted('protected');
        const abort = vi.spyOn(router, 'cancelProcess');
        expect(await tool.handler({ action: 'cancel', processId: 'queue_protected' })).toMatchObject({ code: 'CONFLICT' });
        expect(router.getTask('protected')?.status).toBe('running');
        expect(abort).not.toHaveBeenCalled();
        expect(store.updateProcess).not.toHaveBeenCalled();
    });

    it('checks protected linked operations before marking their conversation cancelling', async () => {
        const { store, router, tool } = setup();
        await seed(store);
        await enqueue(router, 'protected', 'ws-b', 'queue_target');
        router.getTask('protected')!.config.cancelRunning = false;
        router.findManagerForTask('protected')!.markStarted('protected');
        expect(await tool.handler({ action: 'cancel', processId: 'queue_target' })).toMatchObject({ code: 'CONFLICT' });
        expect((await store.getProcess('queue_target'))?.status).toBe('running');
        expect(router.getTask('protected')?.status).toBe('running');
    });

    it('surfaces provider abort failure without claiming cancellation succeeded', async () => {
        const { store, tool } = setup();
        await seed(store);
        await store.updateProcess('queue_target', { sdkSessionId: 'fixture-session' });
        vi.spyOn(sdk.service, 'softAbortSession').mockRejectedValue(new Error('provider abort failed'));
        expect(await tool.handler({ action: 'cancel', processId: 'queue_target' })).toEqual({ error: 'Failed to cancel conversation: provider abort failed' });
        expect((await store.getProcess('queue_target'))?.status).toBe('cancelling');
    });

    it('surfaces persistence errors rather than dispatching or claiming success', async () => {
        const { store, router, tool } = setup();
        await seed(store);
        vi.mocked(store.updateProcess).mockRejectedValueOnce(new Error('write failed'));
        const abort = vi.spyOn(router, 'cancelProcess');
        expect(await tool.handler({ action: 'cancel', processId: 'queue_target' })).toEqual({ error: 'Failed to cancel conversation: write failed' });
        expect(abort).not.toHaveBeenCalled();
    });

    it('rejects a no-op cancellation bridge when queued work remains executable', async () => {
        const { store, router } = setup();
        await enqueue(router, 'target');
        const bridge: QueueExecutorBridge = {
            executeFollowUp: vi.fn(), isSessionAlive: vi.fn(),
            getTask: id => router.getTask(id),
            findTaskByProcessId: id => router.findTaskByProcessId(id),
            cancelProcess: vi.fn().mockResolvedValue(undefined),
        };
        await expect(cancelConversation(store, bridge, 'queue_target')).rejects.toMatchObject({ code: 'CANCEL_FAILED' });
        expect(router.getTask('target')?.status).toBe('queued');
    });

    it('surfaces cancellation timeouts and clears its timer', async () => {
        vi.useFakeTimers();
        const store = createMockProcessStore();
        await seed(store);
        const bridge: QueueExecutorBridge = {
            executeFollowUp: vi.fn(), isSessionAlive: vi.fn(),
            cancelProcess: vi.fn(() => new Promise<void>(() => {})),
        };
        const cancellation = cancelConversation(store, bridge, 'queue_target');
        const assertion = expect(cancellation).rejects.toMatchObject({ code: 'CANCEL_TIMEOUT' });
        await vi.advanceTimersByTimeAsync(30_000);
        await assertion;
        expect((await store.getProcess('queue_target'))?.status).toBe('cancelling');
        expect(vi.getTimerCount()).toBe(0);
    });
});
