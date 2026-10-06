import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SqliteProcessStore, TaskQueueManager, type CreateTaskInput } from '@plusplusoneplusplus/forge';
import { ProcessMessageDeliveryService } from '../../src/server/processes/process-message-delivery-service';
import type { QueueExecutorBridge } from '../../src/server/core/api-handler';
import { CLITaskExecutor } from '../../src/server/queue/queue-executor-bridge';
import { createMockSDKService } from '../helpers/mock-sdk-service';
import { ProcessLifecycleRunner } from '../../src/server/executors/process-lifecycle-runner';

const workspaceId = 'ws-parent';
const processId = 'queue_parent';
const receiptId = 'delegated-result:ws-child:child:terminal';
const review = { content: 'Review delegated job result', displayContent: 'Job result' };

describe('durable review admission', () => {
    let directory: string;
    let store: SqliteProcessStore;
    let queue: TaskQueueManager;
    let bridge: QueueExecutorBridge;
    let service: ProcessMessageDeliveryService;

    beforeEach(async () => {
        directory = fs.mkdtempSync(path.join(os.tmpdir(), 'review-receipts-'));
        store = new SqliteProcessStore({ dbPath: path.join(directory, 'processes.db') });
        await store.addProcess({
            id: processId, type: 'chat', status: 'completed', promptPreview: 'Dispatch', startTime: new Date(),
            workingDirectory: path.join(directory, 'parent'),
            metadata: { workspaceId, mode: 'sentinel', provider: 'copilot' },
        });
        queue = new TaskQueueManager();
        bridge = {
            enqueue: vi.fn(async (input: CreateTaskInput) => queue.enqueue(input)),
            getTask: id => queue.getTask(id),
            findTaskByProcessId: id => {
                const tasks = queue.getAll().filter(task => task.processId === id);
                return tasks.find(task => task.status === 'running' || task.status === 'queued') ?? tasks[0];
            },
            steerProcess: vi.fn(), executeFollowUp: vi.fn(),
        } as unknown as QueueExecutorBridge;
        service = new ProcessMessageDeliveryService({ store, bridge });
    });

    afterEach(() => { store.close(); fs.rmSync(directory, { recursive: true, force: true }); });

    function restart(clearQueue = false) {
        store.close();
        store = new SqliteProcessStore({ dbPath: path.join(directory, 'processes.db') });
        if (clearQueue) queue = new TaskQueueManager();
        service = new ProcessMessageDeliveryService({ store, bridge });
    }

    function deliver(id = receiptId) { return service.deliverOnce(workspaceId, processId, id, review); }

    function drain() {
        const executor = new CLITaskExecutor(store, { aiService: createMockSDKService().service });
        executor.setQueueManager(queue);
        return (executor as unknown as { drainPendingMessages(id: string, taskId: string): Promise<void> })
            .drainPendingMessages(processId, 'prior-turn');
    }

    async function recover(owner = workspaceId) {
        const executor = new CLITaskExecutor(store, { aiService: createMockSDKService().service });
        executor.setQueueManager(queue);
        await executor.recoverPendingMessages(owner, processId);
    }

    it.each(['cancelled', 'cancelling', 'running', 'queued', 'created'] as const)(
        'does not recover buffers for a %s parent', async status => {
            await store.updateProcess(processId, { status: 'running' });
            await deliver();
            await store.updateProcess(processId, { status });
            await recover();
            expect(queue.getAll()).toEqual([]);
            expect((await store.getProcess(processId))?.pendingMessages).toHaveLength(1);
        });

    it('does not recover a foreign workspace or a parent awaiting an answer', async () => {
        await store.updateProcess(processId, { status: 'running' });
        await deliver();
        await store.updateProcess(processId, { status: 'completed' });
        await recover('foreign');
        expect(queue.getAll()).toEqual([]);
        await store.updateProcess(processId, { pendingAskUser: [{ toolCallId: 'question', questions: [] }] } as any);
        await recover();
        expect(queue.getAll()).toEqual([]);
    });

    it('leaves a persisted answer for ask-user resume before draining reviews', async () => {
        await store.updateProcess(processId, { status: 'running' });
        await deliver();
        await store.updateProcess(processId, { status: 'failed', pendingAskUserAnswer: {
            batchId: 'batch', submittedAt: new Date().toISOString(), answers: [],
        } });
        await recover();
        expect(queue.getAll()).toEqual([]);
        expect((await store.getProcess(processId))?.pendingMessages).toHaveLength(1);
    });

    it('recovers a failed parent after a transient enqueue failure without duplicating its turn', async () => {
        await store.updateProcess(processId, { status: 'running' });
        await deliver();
        await store.updateProcess(processId, { status: 'failed' });
        vi.spyOn(queue, 'enqueue').mockImplementationOnce(() => { throw new Error('queue write'); });
        await expect(recover()).rejects.toThrow('queue write');
        restart();
        await recover();
        expect(queue.getTask(receiptId)).toBeDefined();
        expect((await store.getProcess(processId))?.conversationTurns).toHaveLength(1);
        expect((await store.getProcess(processId))?.pendingMessages ?? []).toEqual([]);
    });

    it.each(['queued', 'running'] as const)('leaves an idle snapshot with a %s task alone', async status => {
        await store.updateProcess(processId, { status: 'running' });
        await deliver();
        await store.updateProcess(processId, { status: 'completed' });
        queue.enqueue({ id: 'human', processId, type: 'chat', priority: 'normal', payload: { kind: 'chat' } });
        if (status === 'running') queue.markStarted('human');
        await recover();
        expect(queue.getAll()).toHaveLength(1);
        expect(queue.getTask(receiptId)).toBeUndefined();
    });

    it('serializes concurrent idle recovery without duplicate reviews', async () => {
        await store.updateProcess(processId, { status: 'running' });
        await deliver();
        await store.updateProcess(processId, { status: 'completed' });
        await Promise.all([recover(), recover(), recover()]);
        expect(queue.getAll()).toHaveLength(1);
        expect((await store.getProcess(processId))?.conversationTurns).toHaveLength(1);
    });

    it('reconciles a terminal head receipt before recovering the next review', async () => {
        await store.updateProcess(processId, { status: 'running' });
        await deliver();
        await deliver('second');
        vi.spyOn(store, 'updateProcess').mockRejectedValueOnce(new Error('remove failed'));
        await expect(drain()).rejects.toThrow('remove failed');
        queue.markStarted(receiptId);
        queue.markCompleted(receiptId, {});
        await store.updateProcess(processId, { status: 'completed' });
        await recover();
        expect(queue.getTask('second')).toBeDefined();
        expect((await store.getProcess(processId))?.pendingMessages ?? []).toEqual([]);
        expect((await store.getProcess(processId))?.conversationTurns).toHaveLength(2);
    });

    it('admits an idle review in the parent workspace and preserves its mode', async () => {
        expect(await deliver()).toMatchObject({ path: 'enqueued', taskId: receiptId, turnIndex: 0 });
        expect(queue.getTask(receiptId)).toMatchObject({
            processId, payload: { processId, workspaceId, relayRequestId: receiptId, deliveryMode: 'enqueue' },
        });
        expect(queue.getTask(receiptId)?.payload.mode).toBe('sentinel');
        const proc = await store.getProcess(processId, workspaceId);
        expect(proc?.metadata?.mode).toBe('sentinel');
        expect(proc?.conversationTurns?.[0]).toMatchObject({ role: 'user', content: review.displayContent, relayRequestId: receiptId });
        expect(await store.getAllProcesses({ workspaceId: 'ws-child' })).toEqual([]);
        expect(bridge.steerProcess).not.toHaveBeenCalled();
    });

    it('serializes simultaneous duplicates with user-message admission', async () => {
        await store.updateProcess(processId, { status: 'running' });
        const proc = (await store.getProcess(processId))!;
        const human = service.deliver(proc, { content: 'Later instruction', displayContent: 'Later instruction', deliveryMode: 'enqueue', pasteExternalized: false });
        const results = await Promise.all([human, deliver(), deliver()]);
        expect(results[2]).toMatchObject({ reused: true, events: [] });
        expect((await store.getProcess(processId))?.pendingMessages?.map(message => message.content))
            .toEqual(['Later instruction', review.content]);
        expect(bridge.enqueue).not.toHaveBeenCalled();
    });

    it('recovers a buffered receipt after SQLite restart without duplicating or overtaking human messages', async () => {
        await store.updateProcess(processId, { status: 'running' });
        await store.appendPendingMessage(processId, { id: 'human', content: 'User first', createdAt: new Date().toISOString() });
        expect(await deliver()).toMatchObject({ path: 'buffered', pendingMessageId: receiptId });
        restart(true);
        expect(await deliver()).toMatchObject({ reused: true, pendingMessageId: receiptId, events: [] });
        expect((await store.getProcess(processId))?.pendingMessages?.map(message => message.id)).toEqual(['human', receiptId]);
        await drain();
        expect(queue.getAll()[0].payload.prompt).toBe('User first');
        expect((await store.getProcess(processId))?.pendingMessages?.map(message => message.id)).toEqual([receiptId]);
    });

    it('recovers a persisted turn after restart and cleared queue history', async () => {
        await deliver();
        restart(true);
        expect(await deliver()).toMatchObject({ reused: true, turnIndex: 0, events: [] });
        expect(bridge.enqueue).toHaveBeenCalledOnce();
        expect((await store.getProcess(processId))?.conversationTurns).toHaveLength(1);
    });

    it('recovers queue admission when appending the turn fails', async () => {
        vi.spyOn(store, 'appendConversationTurn').mockRejectedValueOnce(new Error('disk failure'));
        await expect(deliver()).rejects.toThrow('disk failure');
        expect(queue.getTask(receiptId)).toBeDefined();
        restart();
        expect(await deliver()).toMatchObject({ reused: true, taskId: receiptId });
        expect(bridge.enqueue).toHaveBeenCalledOnce();
    });

    it('serializes executor correlation repair with review turn persistence', async () => {
        const append = store.appendConversationTurn.bind(store);
        let entered!: () => void;
        const appending = new Promise<void>(resolve => { entered = resolve; });
        let release!: () => void;
        const held = new Promise<void>(resolve => { release = resolve; });
        const spy = vi.spyOn(store, 'appendConversationTurn').mockImplementationOnce(async (...args) => {
            entered();
            await held;
            return append(...args);
        });
        const delivery = deliver();
        await appending;
        const followUp = vi.fn().mockResolvedValue(undefined);
        const runner = new ProcessLifecycleRunner(store, undefined, () => undefined);
        const execution = runner.run(queue.getTask(receiptId)!, {
            cancelledTasks: new Set(), getWorkingDirectoryFn: () => undefined,
            executeByTypeFn: vi.fn(), executeFollowUpFn: followUp,
        });
        await new Promise<void>(resolve => setImmediate(resolve));
        expect(followUp).not.toHaveBeenCalled();
        release();
        await delivery;
        expect((await execution).success).toBe(true);
        expect(spy).toHaveBeenCalledOnce();
        expect((await store.getProcess(processId))?.conversationTurns?.filter(turn => turn.role === 'user')).toHaveLength(1);
    });

    it('retains accepted admission when taskAdded observers throw', async () => {
        queue.on('taskAdded', () => { throw new Error('observer'); });
        expect(await deliver()).toMatchObject({ taskId: receiptId, turnIndex: 0 });
        expect(await deliver()).toMatchObject({ reused: true });
        expect((await store.getProcess(processId))?.conversationTurns).toHaveLength(1);
    });

    it('allows retry after a rejected admission without writing a receipt', async () => {
        vi.mocked(bridge.enqueue!).mockRejectedValueOnce(new Error('queue persistence'));
        await expect(deliver()).rejects.toThrow('Failed to enqueue follow-up');
        expect((await store.getProcess(processId))?.conversationTurns ?? []).toHaveLength(0);
        expect((await store.getProcess(processId))?.status).toBe('completed');
        expect(await deliver()).toMatchObject({ taskId: receiptId });
    });

    it.each(['cancelled', 'cancelling'] as const)('does not revive a %s parent', async status => {
        await store.updateProcess(processId, { status });
        await expect(deliver()).rejects.toThrow('stopped');
        expect(bridge.enqueue).not.toHaveBeenCalled();
    });

    it('rejects missing and wrongly scoped parents without redirecting', async () => {
        await expect(service.deliverOnce('ws-child', processId, receiptId, review)).rejects.toThrow('unavailable');
        await store.removeProcess(processId);
        await expect(deliver()).rejects.toThrow('unavailable');
        expect(bridge.enqueue).not.toHaveBeenCalled();
    });

    it('rejects a conflicting queue receipt', async () => {
        queue.enqueue({ id: receiptId, processId: 'other', type: 'chat', priority: 'normal', payload: { kind: 'chat', prompt: 'Other job' } });
        await expect(deliver()).rejects.toThrow('conflicts');
        expect((await store.getProcess(processId))?.conversationTurns ?? []).toHaveLength(0);
    });

    it('requires durable queue capabilities and a nonempty receipt', async () => {
        const unsupported = new ProcessMessageDeliveryService({ store, bridge: { executeFollowUp: vi.fn() } as unknown as QueueExecutorBridge });
        await expect(unsupported.deliverOnce(workspaceId, processId, receiptId, review)).rejects.toThrow('requires queue');
        await expect(deliver(' ')).rejects.toThrow('stable review receipt');
    });

    it('buffers behind an unanswered question and pending messages even on a terminal parent', async () => {
        await store.appendPendingMessage(processId, { id: 'human', content: 'Waiting user', createdAt: new Date().toISOString() });
        expect(await deliver()).toMatchObject({ path: 'buffered' });
        await store.updateProcess(processId, { pendingMessages: [], pendingAskUser: [{ id: 'question' }] as never });
        expect(await deliver('question-review')).toMatchObject({ path: 'buffered' });
        expect(bridge.enqueue).not.toHaveBeenCalled();
    });

    it('retries drain after turn append succeeds but queue admission fails, without another turn', async () => {
        await store.updateProcess(processId, { status: 'running' });
        await deliver();
        vi.spyOn(queue, 'enqueue').mockImplementationOnce(() => { throw new Error('queue write'); });
        await expect(drain()).rejects.toThrow('queue write');
        restart();
        await drain();
        expect(queue.getAll()).toHaveLength(1);
        expect(queue.getTask(receiptId)?.payload).toMatchObject({ processId, workspaceId, relayRequestId: receiptId, historyCutoffTurnIndex: 0 });
        expect((await store.getProcess(processId))?.conversationTurns).toHaveLength(1);
        expect((await store.getProcess(processId))?.pendingMessages ?? []).toEqual([]);
    });

    it('reconciles drain after queue admission succeeds but pending removal fails', async () => {
        await store.updateProcess(processId, { status: 'running' });
        await deliver();
        vi.spyOn(store, 'updateProcess').mockRejectedValueOnce(new Error('pending write'));
        await expect(drain()).rejects.toThrow('pending write');
        expect(queue.getTask(receiptId)).toBeDefined();
        restart();
        await drain();
        expect(queue.getAll()).toHaveLength(1);
        expect((await store.getProcess(processId))?.conversationTurns).toHaveLength(1);
        expect((await store.getProcess(processId))?.pendingMessages ?? []).toEqual([]);
    });

    it('retains a review drained through a throwing admission observer', async () => {
        await store.updateProcess(processId, { status: 'running' });
        await deliver();
        queue.on('taskAdded', () => { throw new Error('observer'); });
        await drain();
        expect(queue.getTask(receiptId)).toBeDefined();
        expect((await store.getProcess(processId))?.pendingMessages ?? []).toEqual([]);
    });
});
