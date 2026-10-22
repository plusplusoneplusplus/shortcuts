import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SqliteProcessStore, TaskQueueManager, RepoQueueRegistry, type CreateTaskInput } from '@plusplusoneplusplus/forge';
import { ProcessMessageDeliveryService, ReviewDeliveryRejectedError } from '../../src/server/processes/process-message-delivery-service';
import { processOperationAdmission } from '../../src/server/processes/process-operation-admission';
import type { QueueExecutorBridge } from '../../src/server/core/api-handler';
import { CLITaskExecutor } from '../../src/server/queue/queue-executor-bridge';
import { createMockSDKService } from '../helpers/mock-sdk-service';
import { MultiRepoQueueRouter } from '../../src/server/queue/multi-repo-queue-router';
import { ProcessLifecycleRunner, type LifecycleRunnerOptions } from '../../src/server/executors/process-lifecycle-runner';

const workspaceId = 'ws-parent';
const processId = 'queue_parent';
const receiptId = 'delegated-result:ws-child:child:terminal';
const review = { content: 'Review delegated job result', displayContent: 'Job result' };
// Eligibility is exercised by native lifecycle tests; this suite isolates admission and drain.
const reviewRuntime = { getTriggerInfra: () => ({
    manager: { onActionComplete() {} },
    sentinelPrOutcomes: { async reviewExecutionDisposition() { return 'execute' as const; } },
} as never) };

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
        service = new ProcessMessageDeliveryService({ store, bridge, listTasks: () => queue.getAll() });
    });

    afterEach(() => { store.close(); fs.rmSync(directory, { recursive: true, force: true }); });

    function restart(clearQueue = false) {
        store.close();
        store = new SqliteProcessStore({ dbPath: path.join(directory, 'processes.db') });
        if (clearQueue) queue = new TaskQueueManager();
        service = new ProcessMessageDeliveryService({ store, bridge, listTasks: () => queue.getAll() });
    }

    function deliver(id = receiptId) { return service.deliverOnce(workspaceId, processId, id, review); }
    const wakeSource = { source: 'trigger' as const, triggerId: 'rule-1', deliveryId: 'wake-1' };
    function wake() {
        return service.deliverOnce(workspaceId, processId, wakeSource.deliveryId, { ...review, turnSource: wakeSource });
    }
    function prOutcome(id = 'pr-outcome-1') {
        return service.deliverSentinelPrOutcomeOnce(workspaceId, processId, id, {
            ...review, turnSource: { source: 'trigger', triggerId: 'pr-watch', deliveryId: id },
        });
    }

    it.each(['waiting', 'mode', 'buffer'] as const)('revalidates guarded wakes after %s admission waits', async boundary => {
        let enabled = true;
        const validate = vi.fn((proc: Awaited<ReturnType<typeof store.getProcess>>) => {
            if (!enabled || proc?.metadata?.mode !== 'sentinel') throw new ReviewDeliveryRejectedError('Revoked');
        });
        bridge.enqueueAdmitted = async (input, guard) => {
            guard?.(await store.getProcess(processId, workspaceId));
            return bridge.enqueue!(input);
        };
        const getProcess = store.getProcess.bind(store);
        let reads = 0;
        const spy = vi.spyOn(store, 'getProcess').mockImplementation(async (...args) => {
            if (++reads === (boundary === 'mode' ? 2 : 3)) enabled = false;
            return getProcess(...args);
        });
        let release!: () => void;
        let entered!: () => void;
        const ready = new Promise<void>(resolve => { entered = resolve; });
        const held = boundary === 'waiting'
            ? processOperationAdmission.runExclusive(processId, () => {
                entered();
                return new Promise<void>(resolve => { release = resolve; });
            })
            : undefined;
        if (boundary === 'buffer') await store.updateProcess(processId, { status: 'running' });
        try {
            if (held) await ready;
            const pending = service.deliverOnce(workspaceId, processId, wakeSource.deliveryId,
                { ...review, turnSource: wakeSource }, validate);
            if (held) { enabled = false; release(); }
            await expect(pending).rejects.toThrow('Revoked');
            expect(queue.getAll()).toEqual([]);
            expect((await getProcess(processId))?.conversationTurns ?? []).toEqual([]);
            expect((await getProcess(processId))?.pendingMessages ?? []).toEqual([]);
        } finally {
            spy.mockRestore();
            await held;
        }
    });

    it('rejects guarded delivery without admitted routing rather than silently dropping its guard', async () => {
        const validate = vi.fn();
        await expect(service.deliverOnce(workspaceId, processId, wakeSource.deliveryId,
            { ...review, turnSource: wakeSource }, validate)).rejects.toThrow('admitted queue routing');
        expect(queue.getAll()).toEqual([]);
        expect(validate).not.toHaveBeenCalled();
    });

    it('serializes PR repair receipts with human delivery in an ordinary owner chat', async () => {
        await store.updateProcess(processId, { metadata: { workspaceId, mode: 'ask', provider: 'copilot' } });
        const source = { source: 'trigger' as const, triggerId: 'repair-monitor', deliveryId: 'repair-1' };
        const repair = () => service.deliverPrRepairOnce(workspaceId, processId, source.deliveryId, { ...review, turnSource: source });
        await Promise.all([repair(), repair(), repair()]);
        expect(queue.getAll()).toHaveLength(1);
        expect(queue.getTask('repair-1')).toMatchObject({ priority: 'high', config: { respectQueueBarriers: true } });
        expect(queue.getTask('repair-1')?.payload).toMatchObject({ workspaceId, mode: 'autopilot', context: source });
        expect((await store.getProcess(processId))?.conversationTurns).toHaveLength(1);
        restart();
        expect(await repair()).toMatchObject({ reused: true });
        expect((await store.getProcess(processId))?.conversationTurns).toHaveLength(1);
        await expect(service.deliverPrRepairOnce('foreign', processId, 'repair-2', { ...review, turnSource: {
            ...source, deliveryId: 'repair-2',
        } })).rejects.toThrow('originating workspace');
        await expect(wake()).rejects.toThrow('Sentinel wake');
    });

    function repair(id = 'repair-1', owner = processId) {
        return service.deliverPrRepairOnce(workspaceId, owner, id, {
            ...review, turnSource: { source: 'trigger', triggerId: `monitor-${owner}`, deliveryId: id },
        });
    }

    function normal(id: string, owner = `queue_${id}`) {
        return queue.enqueue({ id, processId: owner, type: 'chat', priority: 'normal',
            payload: { kind: 'chat', mode: 'autopilot', processId: owner, workspaceId }, config: {} });
    }

    it('puts repairs ahead of waiting work, FIFO, without interrupting the running task', async () => {
        let timestamp = Date.now();
        const clock = vi.spyOn(Date, 'now').mockImplementation(() => timestamp++);
        try {
            const running = normal('active');
            queue.markStarted(running);
            normal('waiting');
            await store.addProcess({ id: 'queue_second', type: 'chat', status: 'completed', startTime: new Date(),
                promptPreview: 'Second PR', metadata: { workspaceId, mode: 'ask' } });
            await repair();
            await repair('repair-2', 'queue_second');
            expect(queue.getQueued().map(task => task.id)).toEqual(['repair-1', 'repair-2', 'waiting']);
            expect(queue.getRunning().map(task => task.id)).toEqual(['active']);
            expect(bridge.steerProcess).not.toHaveBeenCalled();
            queue.markStarted('repair-1');
            queue.markRetry('repair-1');
            expect(queue.getQueued().map(task => task.id)).toEqual(['repair-1', 'repair-2', 'waiting']);
        } finally { clock.mockRestore(); }
    });

    it('respects existing pause markers during admission and retry', async () => {
        normal('before');
        const marker = queue.insertPauseMarker(1);
        normal('after');
        await repair();
        expect(queue.getQueueItems().map(item => item.id)).toEqual(['before', marker, 'repair-1', 'after']);
        queue.markStarted('before');
        queue.markCompleted('before', {});
        expect(queue.peek()?.id).toBe(marker);
        queue.removePauseMarker(marker);
        queue.markStarted('repair-1');
        const retryMarker = queue.insertPauseMarker(-1);
        queue.markRetry('repair-1');
        expect(queue.peek()?.id).toBe(retryMarker);
        queue.removePauseMarker(retryMarker);
        expect(queue.peek()?.id).toBe('repair-1');
    });

    it('keeps repairs subject to pauses, cooldowns, freezes and PR gates', async () => {
        queue = new TaskQueueManager({ isExclusive: task => task.payload.mode === 'autopilot', getTaskRepoId: task => task.payload.workspaceId as string });
        await repair();
        queue.pause();
        expect(queue.isPaused()).toBe(true);
        queue.resume();
        queue.pauseAutopilot();
        expect(queue.peek()).toBeUndefined();
        queue.resumeAutopilot();
        queue.pauseRepo(workspaceId);
        expect(queue.peek()).toBeUndefined();
        queue.resumeRepo(workspaceId);
        queue.freezeTask('repair-1');
        expect(queue.peek()).toBeUndefined();
        queue.unfreezeTask('repair-1');
        normal('prior');
        queue.markStarted('prior');
        queue.markCompleted('prior', {});
        for (const scope of ['all', 'autopilot'] as const) {
            queue.setTaskDelayMinutes(scope, 1);
            expect(queue.peek()).toBeUndefined();
            queue.setTaskDelayMinutes(scope, null);
        }
        queue.restoreRepoGate(workspaceId, { chainId: 'other-chain', implementTaskId: 'implement' });
        expect(queue.peek()).toBeUndefined();
        queue.releaseRepoGate(workspaceId, 'other-chain');
        expect(queue.peek()?.id).toBe('repair-1');
    });

    it('retains buffered repair priority through persistence, failed drain and recovery', async () => {
        await store.updateProcess(processId, { status: 'running' });
        await Promise.all([repair(), repair(), repair()]);
        expect(queue.getAll()).toEqual([]);
        expect((await store.getProcess(processId))?.pendingMessages).toHaveLength(1);
        restart();
        expect((await store.getProcess(processId))?.pendingMessages?.[0]).toMatchObject({ queuePriority: 'high', respectQueueBarriers: true });
        normal('waiting');
        await store.updateProcess(processId, { status: 'completed' });
        await recover('foreign');
        expect(queue.getTask('repair-1')).toBeUndefined();
        vi.spyOn(queue, 'enqueue').mockImplementationOnce(() => { throw new Error('queue write'); });
        await expect(recover()).rejects.toThrow('queue write');
        await recover();
        expect(queue.peek()?.id).toBe('repair-1');
        expect(queue.getTask('repair-1')).toMatchObject({ priority: 'high', config: { respectQueueBarriers: true } });
        expect(await repair()).toMatchObject({ reused: true });
        expect((await store.getProcess(processId))?.conversationTurns).toHaveLength(1);
    });

    it('drains earlier human messages before buffered repairs without elevating later human turns or reviews', async () => {
        await store.updateProcess(processId, { status: 'running' });
        const proc = (await store.getProcess(processId))!;
        await service.deliver(proc, { content: 'Human first', displayContent: 'Human first', deliveryMode: 'enqueue', pasteExternalized: false });
        await repair();
        await drain();
        const human = queue.getQueued()[0];
        expect(human.priority).toBe('normal');
        expect(queue.getTask('repair-1')).toBeUndefined();
        queue.markStarted(human.id);
        queue.markCompleted(human.id, {});
        await drain();
        expect(queue.peek()?.id).toBe('repair-1');
        queue.markStarted('repair-1');
        queue.markCompleted('repair-1', {});
        await store.updateProcess(processId, { status: 'completed' });
        await service.deliver((await store.getProcess(processId))!, {
            content: 'Human after', displayContent: 'Human after', deliveryMode: 'enqueue', pasteExternalized: false,
        });
        expect(queue.getQueued()[0].priority).toBe('normal');
        queue.markStarted(queue.getQueued()[0].id);
        queue.markCompleted(queue.getRunning()[0].id, {});
        await store.updateProcess(processId, { status: 'completed' });
        await deliver();
        expect(queue.getTask(receiptId)?.priority).toBe('normal');
        expect((await store.getProcess(processId))?.conversationTurns?.map(turn => turn.content)).toEqual([
            'Human first', review.displayContent, 'Human after', review.displayContent,
        ]);
    });

    it('preserves priority and conversation dependencies when the router promotes pending turns', async () => {
        const registry = new RepoQueueRegistry();
        const router = new MultiRepoQueueRouter(registry, store, { autoStart: false, aiService: createMockSDKService().service });
        const root = path.join(directory, 'parent');
        router.registerRepoId(workspaceId, root);
        try {
            service = new ProcessMessageDeliveryService({ store, bridge: router });
            await store.updateProcess(processId, { status: 'running' });
            await service.deliver((await store.getProcess(processId))!, {
                content: 'Earlier human', displayContent: 'Earlier human', deliveryMode: 'enqueue', pasteExternalized: false,
            });
            await repair();
            await router.enqueue({ id: 'later-human', processId, type: 'chat', priority: 'normal',
                payload: { kind: 'chat', processId, workingDirectory: root, workspaceId, prompt: 'Later human' }, config: {} });
            const ownerQueue = registry.getQueueForRepo(root)!;
            const tasks = ownerQueue.getQueued();
            const repairTask = tasks.find(task => task.payload.relayRequestId === 'repair-1')!;
            const earlier = tasks.find(task => task.payload.prompt === 'Earlier human')!;
            expect(repairTask).toMatchObject({ priority: 'high', repoId: workspaceId,
                config: { respectQueueBarriers: true, processPredecessorId: earlier.id } });
            expect(ownerQueue.peek()?.id).toBe(earlier.id);
            ownerQueue.markStarted(earlier.id);
            expect(ownerQueue.peek()).toBeUndefined();
            ownerQueue.markCompleted(earlier.id, {});
            expect(ownerQueue.peek()?.id).toBe(repairTask.id);
            ownerQueue.markStarted(repairTask.id);
            ownerQueue.markCompleted(repairTask.id, {});
            expect(ownerQueue.peek()?.id).toBe('later-human');
            expect(ownerQueue.getTask('later-human')?.priority).toBe('normal');
        } finally { router.dispose(); }
    });

    function drain() {
        const executor = new CLITaskExecutor(store, { aiService: createMockSDKService().service, runtime: reviewRuntime });
        executor.setQueueManager(queue);
        return (executor as unknown as { drainPendingMessages(id: string, taskId: string): Promise<void> })
            .drainPendingMessages(processId, 'prior-turn');
    }

    async function recover(owner = workspaceId) {
        const executor = new CLITaskExecutor(store, { aiService: createMockSDKService().service, runtime: reviewRuntime });
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
        vi.spyOn(store, 'removePendingMessage').mockRejectedValueOnce(new Error('remove failed'));
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
        const runner = new ProcessLifecycleRunner(store, undefined, () => undefined, undefined, reviewRuntime);
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

    it('admits exactly one read-only PR outcome review into a stopped Sentinel without resuming parked work', async () => {
        await store.updateProcess(processId, { status: 'cancelled' });
        await store.appendPendingMessage(processId, { id: 'parked-human', content: 'Old implementation request', createdAt: new Date().toISOString() });
        await expect(wake()).rejects.toThrow('stopped');
        await expect(repair()).rejects.toThrow('stopped');
        await Promise.all([prOutcome(), prOutcome(), prOutcome()]);
        expect(queue.getAll()).toHaveLength(1);
        expect(queue.getTask('pr-outcome-1')).toMatchObject({
            priority: 'normal', config: { respectQueueBarriers: true },
            payload: { workspaceId, processId, readonly: true, mode: 'sentinel',
                context: { sentinelPrOutcomeReview: true, sentinelPrOutcomeStopped: true } },
        });
        expect((await store.getProcess(processId))?.pendingMessages?.map(message => message.id)).toEqual(['parked-human']);
        const followUp = vi.fn<LifecycleRunnerOptions['executeFollowUpFn']>(async () => {
            await store.updateProcess(processId, { status: 'completed' });
        });
        const runner = new ProcessLifecycleRunner(store, undefined, () => undefined, undefined, reviewRuntime);
        const onResponseCompleted = vi.fn();
        expect(await runner.run(queue.getTask('pr-outcome-1')!, {
            cancelledTasks: new Set(), getWorkingDirectoryFn: () => undefined,
            executeByTypeFn: vi.fn(), executeFollowUpFn: followUp, onResponseCompleted,
            onDrainPendingMessages: () => drain(),
        })).toMatchObject({ success: true });
        expect(followUp.mock.calls[0]?.[11]).toMatchObject({
            sentinelPrOutcomeReview: true, sentinelPrOutcomeStopped: true,
        });
        expect((await store.getProcess(processId))?.status).toBe('cancelled');
        expect((await store.getProcess(processId))?.pendingMessages?.map(message => message.id)).toEqual(['parked-human']);
        expect(onResponseCompleted).not.toHaveBeenCalled();
        restart(true);
        expect(await prOutcome()).toMatchObject({ reused: true, events: [] });
        expect(queue.getAll()).toEqual([]);
    });

    it('restores the stopped state when a PR review fails instead of enabling normal notifications', async () => {
        await store.updateProcess(processId, { status: 'cancelled' });
        await prOutcome();
        const runner = new ProcessLifecycleRunner(store, undefined, () => undefined, undefined, reviewRuntime);
        expect(await runner.run(queue.getTask('pr-outcome-1')!, {
            cancelledTasks: new Set(), getWorkingDirectoryFn: () => undefined,
            executeByTypeFn: vi.fn(), executeFollowUpFn: vi.fn().mockRejectedValue(new Error('provider unavailable')),
        })).toMatchObject({ success: false });
        expect((await store.getProcess(processId))?.status).toBe('cancelled');
        await expect(deliver()).rejects.toThrow('stopped');
    });

    it('preserves stop when a queued outcome review is cancelled before starting', async () => {
        await store.updateProcess(processId, { status: 'cancelled' });
        await prOutcome();
        const runner = new ProcessLifecycleRunner(store, undefined, () => undefined, undefined, reviewRuntime);
        const executeFollowUpFn = vi.fn();
        expect(await runner.run(queue.getTask('pr-outcome-1')!, {
            cancelledTasks: new Set(['pr-outcome-1']), getWorkingDirectoryFn: () => undefined,
            executeByTypeFn: vi.fn(), executeFollowUpFn,
        })).toMatchObject({ success: false });
        expect(executeFollowUpFn).not.toHaveBeenCalled();
        expect((await store.getProcess(processId))?.status).toBe('cancelled');
    });

    it('does not promote parked human messages through the real owner-routed queue', async () => {
        const registry = new RepoQueueRegistry();
        const router = new MultiRepoQueueRouter(registry, store, { autoStart: false, aiService: createMockSDKService().service });
        const root = path.join(directory, 'parent');
        router.registerRepoId(workspaceId, root);
        try {
            service = new ProcessMessageDeliveryService({ store, bridge: router,
                listTasks: () => Array.from(registry.getAllQueues().values()).flatMap(ownerQueue => ownerQueue.getAll()),
            });
            await store.updateProcess(processId, { status: 'cancelled' });
            await store.appendPendingMessage(processId, { id: 'parked-human', content: 'Old implementation', createdAt: new Date().toISOString() });
            await prOutcome();
            const ownerQueue = registry.getQueueForRepo(root)!;
            expect(ownerQueue.getAll()).toHaveLength(1);
            expect(ownerQueue.getTask('pr-outcome-1')).toMatchObject({
                repoId: workspaceId, payload: { readonly: true, context: { sentinelPrOutcomeStopped: true } },
            });
            expect((await store.getProcess(processId))?.pendingMessages?.map(message => message.id)).toEqual(['parked-human']);
        } finally { router.dispose(); }
    });

    it('defers PR outcome reviews behind busy turns and preserves the review scope through drain', async () => {
        await store.updateProcess(processId, { status: 'running' });
        expect(await prOutcome()).toMatchObject({ path: 'buffered' });
        expect(bridge.enqueue).not.toHaveBeenCalled();
        expect(bridge.steerProcess).not.toHaveBeenCalled();
        expect((await store.getProcess(processId))?.pendingMessages?.[0].context).toMatchObject({
            sentinelPrOutcomeReview: true,
        });
        await store.updateProcess(processId, { status: 'completed' });
        await recover();
        expect(queue.getTask('pr-outcome-1')?.payload).toMatchObject({ readonly: true,
            context: { sentinelPrOutcomeReview: true } });
        expect(queue.getTask('pr-outcome-1')?.payload.context).not.toHaveProperty('sentinelPrOutcomeStopped');
    });

    it('recovers only PR outcome reviews after a stop and restart, leaving earlier normal buffers parked', async () => {
        await store.updateProcess(processId, { status: 'running' });
        await store.appendPendingMessage(processId, { id: 'parked-human', content: 'User work', createdAt: new Date().toISOString() });
        await deliver();
        await prOutcome();
        await store.updateProcess(processId, { status: 'cancelled' });
        restart(true);
        await recover();
        expect(queue.getAll()).toHaveLength(1);
        expect(queue.getTask('pr-outcome-1')?.payload).toMatchObject({
            readonly: true, context: { sentinelPrOutcomeReview: true, sentinelPrOutcomeStopped: true },
        });
        expect((await store.getProcess(processId))?.pendingMessages?.map(message => message.id)).toEqual(['parked-human', receiptId]);
    });

    it('delivers a second outcome after a stopped review without draining parked ordinary messages', async () => {
        await store.updateProcess(processId, { status: 'cancelled' });
        await prOutcome();
        queue.markStarted('pr-outcome-1');
        await store.appendPendingMessage(processId, { id: 'parked-human', content: 'Old work', createdAt: new Date().toISOString() });
        expect(await prOutcome('pr-outcome-2')).toMatchObject({ path: 'buffered' });
        expect((await store.getProcess(processId))?.pendingMessages?.[1].context).toMatchObject({
            sentinelPrOutcomeReview: true, sentinelPrOutcomeStopped: true,
        });
        const runner = new ProcessLifecycleRunner(store, undefined, () => undefined, undefined, reviewRuntime);
        expect(await runner.run(queue.getTask('pr-outcome-1')!, {
            cancelledTasks: new Set(), getWorkingDirectoryFn: () => undefined,
            executeByTypeFn: vi.fn(), executeFollowUpFn: vi.fn(async () => {
                await store.updateProcess(processId, { status: 'completed' });
            }), onDrainPendingMessages: () => drain(),
        })).toMatchObject({ success: true });
        expect(queue.getTask('pr-outcome-2')?.payload).toMatchObject({
            readonly: true, context: { sentinelPrOutcomeStopped: true },
        });
        expect((await store.getProcess(processId))?.pendingMessages?.map(message => message.id)).toEqual(['parked-human']);
    });

    it('waits for cancellation to finish without treating it as permanent routing failure', async () => {
        await store.updateProcess(processId, { status: 'cancelling' });
        await expect(prOutcome()).rejects.toThrow('stop to finish');
        expect(queue.getAll()).toEqual([]);
        await store.updateProcess(processId, { status: 'cancelled' });
        expect(await prOutcome()).toMatchObject({ path: 'enqueued' });
    });

    it('does not overlap a cancelled process whose earlier queue task is still unwinding', async () => {
        normal('old-turn', processId);
        queue.markStarted('old-turn');
        await store.updateProcess(processId, { status: 'cancelled' });
        await expect(prOutcome()).rejects.toThrow('stop to finish');
        expect(queue.getTask('pr-outcome-1')).toBeUndefined();
        queue.markCompleted('old-turn', {});
        expect(await prOutcome()).toMatchObject({ path: 'enqueued' });
    });

    it('recovers only PR review after stop despite an unanswered question from the stopped turn', async () => {
        await store.updateProcess(processId, { status: 'running' });
        await prOutcome();
        await store.updateProcess(processId, { status: 'cancelled',
            pendingAskUser: [{ toolCallId: 'old-question', questions: [] }],
        });
        await recover();
        expect(queue.getTask('pr-outcome-1')?.payload).toMatchObject({
            readonly: true, context: { sentinelPrOutcomeReview: true, sentinelPrOutcomeStopped: true },
        });
        expect((await store.getProcess(processId))?.pendingAskUser).toHaveLength(1);
    });

    it('does not revive stale compaction metadata when admitting a stopped review', async () => {
        await store.updateProcess(processId, { status: 'cancelled', metadata: {
            workspaceId, mode: 'sentinel', compaction: { state: 'queued', requestId: 'old-compaction' },
        } });
        expect(await prOutcome()).toMatchObject({ path: 'enqueued' });
        expect(queue.getTask('pr-outcome-1')?.payload).toMatchObject({ readonly: true });
        expect((await store.getProcess(processId))?.metadata?.compaction).toMatchObject({ state: 'queued' });
    });

    it('requires exact Sentinel ownership and trusted trigger attribution for stopped review admission', async () => {
        await expect(service.deliverSentinelPrOutcomeOnce(workspaceId, processId, 'review-1', review))
            .rejects.toThrow('trigger-owned');
        await expect(service.deliverSentinelPrOutcomeOnce('foreign', processId, 'review-1', {
            ...review, turnSource: { source: 'trigger', triggerId: 'watch', deliveryId: 'review-1' },
        })).rejects.toThrow('originating workspace');
        await store.updateProcess(processId, { status: 'cancelled', metadata: { workspaceId, mode: 'ask' } });
        await expect(prOutcome()).rejects.toThrow('owning chat');
        expect(queue.getAll()).toEqual([]);
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
        vi.spyOn(store, 'removePendingMessage').mockRejectedValueOnce(new Error('pending write'));
        await expect(drain()).rejects.toThrow('pending write');
        expect(queue.getTask(receiptId)).toBeDefined();
        restart();
        await drain();
        expect(queue.getAll()).toHaveLength(1);
        expect((await store.getProcess(processId))?.conversationTurns).toHaveLength(1);
        expect((await store.getProcess(processId))?.pendingMessages ?? []).toEqual([]);
    });

    it('preserves a human message appended while a review is being drained', async () => {
        await store.updateProcess(processId, { status: 'running' });
        await deliver();
        const remove = store.removePendingMessage.bind(store);
        vi.spyOn(store, 'removePendingMessage').mockImplementationOnce(async (id, messageId) => {
            await store.appendPendingMessage(id, {
                id: 'later-human', content: 'Follow-up', createdAt: new Date().toISOString(),
            });
            return remove(id, messageId);
        });
        await drain();
        expect(queue.getTask(receiptId)).toBeDefined();
        expect((await store.getProcess(processId))?.pendingMessages?.map(message => message.id))
            .toEqual(['later-human']);
    });

    it('retains a review drained through a throwing admission observer', async () => {
        await store.updateProcess(processId, { status: 'running' });
        await deliver();
        queue.on('taskAdded', () => { throw new Error('observer'); });
        await drain();
        expect(queue.getTask(receiptId)).toBeDefined();
        expect((await store.getProcess(processId))?.pendingMessages ?? []).toEqual([]);
    });

    it('persists wake attribution on admission, buffered drain and executor repair', async () => {
        await wake();
        expect(queue.getTask('wake-1')?.payload.context).toEqual(wakeSource);
        expect((await store.getProcess(processId))?.conversationTurns?.[0].turnSource).toEqual(wakeSource);
        await store.truncateConversationTurns(processId, 0);
        await store.updateProcess(processId, { pendingMessages: [], status: 'completed' });
        const followUp = vi.fn().mockResolvedValue(undefined);
        const runner = new ProcessLifecycleRunner(store, undefined, () => undefined);
        const result = await runner.run(queue.getTask('wake-1')!, {
            cancelledTasks: new Set(), getWorkingDirectoryFn: () => undefined,
            executeByTypeFn: vi.fn(), executeFollowUpFn: followUp,
        });
        expect(result.success).toBe(true);
        expect(followUp.mock.calls[0][8]).toEqual(wakeSource);
        expect((await store.getProcess(processId))?.conversationTurns?.[0].turnSource).toEqual(wakeSource);
        queue = new TaskQueueManager();
        await store.truncateConversationTurns(processId, 0);
        await store.updateProcess(processId, { status: 'running' });
        await wake();
        expect((await store.getProcess(processId))?.pendingMessages?.[0].context).toEqual(wakeSource);
        await store.updateProcess(processId, { status: 'completed' });
        await recover();
        expect(queue.getTask('wake-1')?.payload.context).toEqual(wakeSource);
        expect((await store.getProcess(processId))?.conversationTurns?.[0].turnSource).toEqual(wakeSource);
    });

    it('serializes duplicate wakes with human follow-ups without losing either', async () => {
        await store.updateProcess(processId, { status: 'running' });
        const proc = (await store.getProcess(processId))!;
        await Promise.all([
            wake(), wake(),
            service.deliver(proc, { content: 'Human', displayContent: 'Human', deliveryMode: 'enqueue', pasteExternalized: false }),
        ]);
        const messages = (await store.getProcess(processId))?.pendingMessages ?? [];
        expect(messages.map(message => message.content)).toEqual([review.content, 'Human']);
        expect(messages[0].context).toEqual(wakeSource);
        expect(queue.getAll()).toEqual([]);
    });

    it.each(['pending', 'turn', 'task'])('dedupes wakes by deliveryId on an existing %s', async kind => {
        service = new ProcessMessageDeliveryService({ store, bridge, listTasks: () => queue.getAll() });
        if (kind === 'pending') await store.appendPendingMessage(processId, {
            id: 'other-id', content: 'Saved wake', createdAt: new Date().toISOString(), context: wakeSource,
        });
        if (kind === 'turn') await store.appendConversationTurn(processId, index => ({
            role: 'user', content: 'Saved wake', timestamp: new Date(), turnIndex: index, turnSource: wakeSource,
        }));
        if (kind === 'task') queue.enqueue({
            id: 'other-task-id', type: 'chat', priority: 'normal', processId,
            payload: { kind: 'chat', processId, workspaceId, context: wakeSource },
        });
        expect(await wake()).toMatchObject({ reused: true, events: [] });
        expect(bridge.enqueue).not.toHaveBeenCalled();
    });

    it('rejects a foreign task carrying a wake delivery identity', async () => {
        service = new ProcessMessageDeliveryService({ store, bridge, listTasks: () => queue.getAll() });
        queue.enqueue({
            id: 'foreign-task', type: 'chat', priority: 'normal', processId: 'foreign',
            payload: { kind: 'chat', processId: 'foreign', workspaceId: 'foreign', context: wakeSource },
        });
        await expect(wake()).rejects.toThrow('conflicts');
        expect(bridge.enqueue).not.toHaveBeenCalled();
    });

    it('rejects wake admission into a non-Sentinel owner without changing item or chat mode', async () => {
        await store.updateProcess(processId, { metadata: { mode: 'ask', workspaceId } });
        await expect(wake()).rejects.toThrow('owning chat');
        expect(queue.getAll()).toEqual([]);
        expect((await store.getProcess(processId))?.metadata?.mode).toBe('ask');
    });
});
