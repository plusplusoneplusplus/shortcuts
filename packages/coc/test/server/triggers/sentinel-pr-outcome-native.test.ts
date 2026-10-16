import { randomUUID } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SqliteProcessStore, TaskQueueManager, type CreateTaskInput, type QueuedTask } from '@plusplusoneplusplus/forge';
import type { QueueExecutorBridge } from '../../../src/server/core/api-handler';
import { DelegatedJobStore } from '../../../src/server/delegation/delegated-job-store';
import { SentinelTodoStore } from '../../../src/server/sentinel-todos/sentinel-todo-store';
import { createTriggerInfrastructure, type TriggerInfrastructure } from '../../../src/server/infrastructure/trigger-infrastructure';
import { CLITaskExecutor } from '../../../src/server/queue/queue-executor-bridge';
import { createMockSDKService } from '../../helpers/mock-sdk-service';
import { DEFAULT_PR_MERGE_POLL_INTERVAL_MS, MAX_ACTIVE_TRIGGERS } from '../../../src/server/triggers/trigger-types';

const owner = { workspaceId: 'parent-workspace', processId: 'parent-sentinel' };
const child = { workspaceId: 'child-workspace', processId: 'child-job' };
const url = 'https://github.com/example/repo/pull/42';

describe('native delegated PR outcomes across observation, admission and restart', () => {
    let store: SqliteProcessStore;
    let queue: TaskQueueManager;
    let dataDir: string;
    let infra: TriggerInfrastructure;
    let itemId: string;
    let status: 'open' | 'merged' | 'closed';
    let enabled: boolean;
    let executor: CLITaskExecutor | undefined;
    const fetchPr = vi.fn();

    const start = () => createTriggerInfrastructure({
        dataDir, store, queueFacade: queue, emit: vi.fn(),
        deliveryBridge: {
            enqueue: async (input: CreateTaskInput) => queue.enqueue(input),
            getTask: id => queue.getTask(id),
            findTaskByProcessId: id => queue.getAll().find(task => task.processId === id),
            executeFollowUp: vi.fn(),
        } as unknown as QueueExecutorBridge,
        ciChecksFetcher: vi.fn(), prStatusFetcher: fetchPr, getPrOutcomeEnabled: () => enabled,
        recoverPendingMessages: async (workspaceId, processId) => executor?.recoverPendingMessages(workspaceId, processId),
    });

    beforeEach(async () => {
        dataDir = path.join(process.cwd(), 'test', '.native-pr-outcomes', randomUUID());
        fs.mkdirSync(dataDir, { recursive: true });
        store = new SqliteProcessStore({ dbPath: ':memory:' });
        queue = new TaskQueueManager();
        status = 'open';
        enabled = true;
        executor = undefined;
        fetchPr.mockImplementation(async () => ({ status, title: 'External PR title', url }));
        for (const workspaceId of [owner.workspaceId, child.workspaceId]) {
            await store.registerWorkspace({ id: workspaceId, name: 'Example', rootPath: dataDir });
        }
        await store.addProcess({
            id: owner.processId, type: 'chat', status: 'cancelled', promptPreview: '',
            startTime: new Date(), metadata: { workspaceId: owner.workspaceId, mode: 'sentinel' },
        });
        const todos = new SentinelTodoStore(store.getDatabase());
        itemId = todos.create(owner, { title: 'Ship', completionCondition: 'Merged AND deployed AND accepted' }, { actor: 'user' }).item.id;
        const jobs = new DelegatedJobStore(dataDir);
        jobs.register({ id: child.processId, parent: owner, child, title: 'Implementation' });
        todos.linkJob(owner, itemId, { ...child, kind: 'local', openLink: '/chat/child' });
        infra = await start();
    });

    afterEach(() => {
        vi.restoreAllMocks();
        infra?.dispose();
        vi.useRealTimers();
        store?.close();
        fs.rmSync(dataDir, { recursive: true, force: true });
        try { fs.rmdirSync(path.dirname(dataDir)); } catch { /* Parallel runs may own other fixtures. */ }
    });

    it.each(['merged', 'closed'] as const)('observes %s natively and admits only one review to the stopped parent', async outcome => {
        const registration = await infra.sentinelPrOutcomes.registerSubmission(child.workspaceId, child.processId, url);
        expect(registration.registered).toBe(true);
        status = outcome;
        await infra.triggerManager.checkOutcome(registration.triggerId!);
        const trigger = infra.triggerStore.getById(registration.triggerId!)!;
        expect(trigger).toMatchObject({
            ...owner, status: 'disarmed',
            event: { terminalObservation: { status: outcome } },
            delivery: { reason: outcome, state: 'delivered' },
        });
        expect(queue.getAll()).toHaveLength(1);
        expect(queue.getAll()[0]).toMatchObject({
            processId: owner.processId,
            payload: { workspaceId: owner.workspaceId,
                context: { source: 'trigger', sentinelPrOutcomeReview: true, sentinelPrOutcomeStopped: true } },
        });
        expect(new SentinelTodoStore(store.getDatabase()).get(owner).items[0].status).toBe('in_progress');
        infra.dispose();
        infra = await start();
        await infra.triggerManager.checkOutcome(trigger.id);
        expect(queue.getAll()).toHaveLength(1);
    });

    it('retains paused first-terminal evidence across restart, refresh and reopen then delivers once on resume', async () => {
        await infra.sentinelPrOutcomes.control(owner, itemId, 'pause', { expectedRevision: 0 });
        const registration = await infra.sentinelPrOutcomes.registerSubmission(child.workspaceId, child.processId, url);
        status = 'closed';
        await infra.sentinelPrOutcomes.control(owner, itemId, 'check', { expectedRevision: 1 });
        expect(queue.getAll()).toHaveLength(0);
        expect(infra.triggerStore.getById(registration.triggerId!)?.delivery?.state).toBe('pending');
        infra.dispose();
        infra = await start();
        status = 'open';
        await infra.sentinelPrOutcomes.control(owner, itemId, 'check', { expectedRevision: 1 });
        expect(queue.getAll()).toHaveLength(0);
        expect(await infra.sentinelPrOutcomes.list(owner, itemId)).toMatchObject({
            paused: true, outcomes: [{ status: 'closed', delivery: 'pending' }],
        });
        await infra.sentinelPrOutcomes.control(owner, itemId, 'resume', { expectedRevision: 1 });
        await infra.sentinelPrOutcomes.control(owner, itemId, 'check', { expectedRevision: 2 });
        expect(queue.getAll()).toHaveLength(1);
        expect(infra.triggerStore.getById(registration.triggerId!)?.delivery?.reason).toBe('closed');
    });

    function executionBridge() {
        executor = new CLITaskExecutor(store, {
            aiService: createMockSDKService().service,
            runtime: { getTriggerInfra: () => ({
                manager: infra.triggerManager, sentinelPrOutcomes: infra.sentinelPrOutcomes,
            }) },
        });
        executor.setQueueManager(queue);
        return vi.spyOn(executor, 'executeFollowUp').mockImplementation(async processId => {
            await store.updateProcess(processId, { status: 'completed' });
        });
    }

    async function executeNext() {
        const queued = queue.getAll().find(task => task.status === 'queued')!;
        const task = queue.markStarted(queued.id)! as QueuedTask;
        expect(task).toBeDefined();
        const result = await executor!.execute(task);
        expect(result.success).toBe(true);
        queue.markCompleted(task.id, result.result);
        return task;
    }

    it.each([
        ['pause', 'cancelled'], ['disable', 'cancelled'],
        ['pause', 'completed'], ['disable', 'completed'],
    ] as const)('retains an admitted queued review after %s for a %s parent and resumes once', async (action, parentStatus) => {
        const executeReview = executionBridge();
        await store.updateProcess(owner.processId, { status: parentStatus });
        const registration = await infra.sentinelPrOutcomes.registerSubmission(child.workspaceId, child.processId, url);
        status = 'merged';
        await infra.triggerManager.checkOutcome(registration.triggerId!);
        const receiptId = infra.triggerStore.getById(registration.triggerId!)!.delivery!.deliveryId;
        if (action === 'pause') await infra.sentinelPrOutcomes.control(owner, itemId, 'pause', { expectedRevision: 0 });
        else enabled = false;
        const original = await executeNext();
        expect(executeReview).not.toHaveBeenCalled();
        expect((await store.getProcess(owner.processId))?.pendingMessages).toEqual([
            expect.objectContaining({ id: receiptId, relayRequestId: receiptId }),
        ]);
        expect((await store.getProcess(owner.processId))?.status).toBe(parentStatus);
        if (action === 'pause') await infra.sentinelPrOutcomes.control(owner, itemId, 'resume', { expectedRevision: 1 });
        else { enabled = true; await infra.sentinelPrOutcomes.restore(); }
        expect(queue.getTask(original.id)?.status).toBe('queued');
        const resumed = await executeNext();
        expect(resumed.id).toBe(original.id);
        expect(executeReview).toHaveBeenCalledTimes(1);
        expect(executeReview.mock.calls[0][11]).toMatchObject({ sentinelPrOutcomeReview: true });
        if (parentStatus === 'cancelled') expect(executeReview.mock.calls[0][11]).toMatchObject({ sentinelPrOutcomeStopped: true });
        else expect(executeReview.mock.calls[0][11]).not.toHaveProperty('sentinelPrOutcomeStopped');
        expect((await store.getProcess(owner.processId))?.status).toBe(parentStatus);
        expect(infra.triggerStore.getById(registration.triggerId!)!.delivery!.deliveryId).toBe(receiptId);
        await executor!.recoverPendingMessages(owner.workspaceId, owner.processId);
        expect(queue.getAll().filter(task => task.status === 'queued')).toHaveLength(0);
    });

    it('keeps busy buffered evidence parked after pause, then drains it only once on resume', async () => {
        const executeReview = executionBridge();
        await store.updateProcess(owner.processId, { status: 'running' });
        const registration = await infra.sentinelPrOutcomes.registerSubmission(child.workspaceId, child.processId, url);
        status = 'closed';
        await infra.triggerManager.checkOutcome(registration.triggerId!);
        await infra.sentinelPrOutcomes.control(owner, itemId, 'pause', { expectedRevision: 0 });
        await store.updateProcess(owner.processId, { status: 'completed' });
        await executor!.recoverPendingMessages(owner.workspaceId, owner.processId);
        expect(queue.getAll()).toHaveLength(0);
        expect((await store.getProcess(owner.processId))?.pendingMessages).toHaveLength(1);
        await infra.sentinelPrOutcomes.control(owner, itemId, 'resume', { expectedRevision: 1 });
        await executeNext();
        expect(executeReview).toHaveBeenCalledTimes(1);
        expect((await store.getProcess(owner.processId))?.pendingMessages ?? []).toHaveLength(0);
    });

    it.each([{ status: 'done' as const }, { archived: true }])('observes a newly submitted PR without AI review for a settled item: %j', async verdict => {
        const todos = new SentinelTodoStore(store.getDatabase());
        const current = todos.get(owner).items.find(item => item.id === itemId)!;
        todos.update(owner, itemId, current.revision, verdict, 'user');
        const registration = await infra.sentinelPrOutcomes.registerSubmission(child.workspaceId, child.processId, url);
        status = 'closed';
        await infra.triggerManager.checkOutcome(registration.triggerId!);
        expect(infra.triggerStore.getById(registration.triggerId!)).toMatchObject({
            event: { terminalObservation: { status: 'closed' } }, outcome: 'skipped',
        });
        expect(queue.getAll()).toEqual([]);
        expect(todos.get(owner).items.find(item => item.id === itemId)).toMatchObject(verdict);
    });

    it('rechecks pause immediately before follow-up execution after earlier queue eligibility passed', async () => {
        const executeReview = executionBridge();
        const registration = await infra.sentinelPrOutcomes.registerSubmission(child.workspaceId, child.processId, url);
        status = 'merged';
        await infra.triggerManager.checkOutcome(registration.triggerId!);
        const update = store.updateProcess.bind(store);
        let paused = false;
        const intercept = vi.spyOn(store, 'updateProcess').mockImplementation(async (processId, changes) => {
            await update(processId, changes);
            if (changes.status === 'running' && !paused) {
                paused = true;
                await infra.sentinelPrOutcomes.control(owner, itemId, 'pause', { expectedRevision: 0 });
            }
        });
        await executeNext();
        expect(executeReview).not.toHaveBeenCalled();
        expect((await store.getProcess(owner.processId))?.pendingMessages).toHaveLength(1);
        intercept.mockRestore();
        await infra.sentinelPrOutcomes.control(owner, itemId, 'resume', { expectedRevision: 1 });
        await executeNext();
        expect(executeReview).toHaveBeenCalledTimes(1);
    });

    it.each([{ status: 'done' as const }, { archived: true }])('skips buffered reviews after current item eligibility changes: %j', async change => {
        const executeReview = executionBridge();
        await store.updateProcess(owner.processId, { status: 'running' });
        const registration = await infra.sentinelPrOutcomes.registerSubmission(child.workspaceId, child.processId, url);
        status = 'merged';
        await infra.triggerManager.checkOutcome(registration.triggerId!);
        const todos = new SentinelTodoStore(store.getDatabase());
        todos.update(owner, itemId, todos.get(owner).items[0].revision, change, 'user');
        await store.updateProcess(owner.processId, { status: 'completed' });
        await executor!.recoverPendingMessages(owner.workspaceId, owner.processId);
        expect(executeReview).not.toHaveBeenCalled();
        expect(queue.getAll()).toHaveLength(0);
        expect((await store.getProcess(owner.processId))?.pendingMessages ?? []).toHaveLength(0);
        expect(infra.triggerStore.getById(registration.triggerId!)).toMatchObject({ outcome: 'skipped' });
    });

    it('shows a capacity-blocked exact receipt and Check reconstructs it without bypassing pause', async () => {
        await infra.sentinelPrOutcomes.control(owner, itemId, 'pause', { expectedRevision: 0 });
        const capacity = vi.spyOn(infra.triggerStore, 'getActive').mockReturnValue(Array(MAX_ACTIVE_TRIGGERS).fill({}));
        await expect(infra.sentinelPrOutcomes.registerSubmission(child.workspaceId, child.processId, url)).rejects.toThrow('capacity');
        const receipt = new DelegatedJobStore(dataDir).list(owner.workspaceId)[0].pullRequests![0];
        const failed = await infra.sentinelPrOutcomes.list(owner, itemId);
        expect(failed).toMatchObject({
            paused: true, outcomes: [{ receiptId: receipt.id, pr: receipt.pr, delivery: 'error', error: expect.stringContaining('capacity') }],
        });
        expect(receipt.outcomeWatchRequestedAt).toBeDefined();
        capacity.mockRestore();
        status = 'closed';
        const checked = await infra.sentinelPrOutcomes.control(owner, itemId, 'check', { expectedRevision: 1 });
        expect(checked).toMatchObject({ paused: true, outcomes: [{ id: failed.outcomes[0].id, receiptId: receipt.id, status: 'closed', delivery: 'pending' }] });
        expect(queue.getAll()).toHaveLength(0);
        expect(new DelegatedJobStore(dataDir).list(owner.workspaceId)[0].pullRequests![0].outcomeWatchError).toBeUndefined();
        await infra.sentinelPrOutcomes.control(owner, itemId, 'resume', { expectedRevision: 1 });
        expect(queue.getAll()).toHaveLength(1);
    });

    it('reconstructs only requested exact receipts after a native insert failure and restart', async () => {
        vi.spyOn(infra.triggerStore, 'insert').mockImplementationOnce(() => { throw new Error('Native insert failed'); });
        await expect(infra.sentinelPrOutcomes.registerSubmission(child.workspaceId, child.processId, url)).rejects.toThrow('insert failed');
        const before = await infra.sentinelPrOutcomes.list(owner, itemId);
        expect(before.outcomes[0]).toMatchObject({ delivery: 'error', error: 'Native insert failed' });
        new DelegatedJobStore(dataDir).recordPullRequest(owner.workspaceId, child.processId, itemId, url.replace('/42', '/41'));
        infra.dispose();
        infra = await start();
        const after = await infra.sentinelPrOutcomes.list(owner, itemId);
        expect(after.outcomes).toEqual([expect.objectContaining({
            id: before.outcomes[0].id, receiptId: before.outcomes[0].receiptId, pr: before.outcomes[0].pr, delivery: 'none',
        })]);
        expect(infra.triggerStore.getAll()).toHaveLength(1);
    });

    it('surfaces and repairs a timer-arm failure after the native watch was persisted', async () => {
        await infra.sentinelPrOutcomes.control(owner, itemId, 'pause', { expectedRevision: 0 });
        vi.spyOn(infra.triggerManager, 'arm').mockImplementationOnce(() => { throw new Error('Native arm failed'); });
        await expect(infra.sentinelPrOutcomes.registerSubmission(child.workspaceId, child.processId, url)).rejects.toThrow('arm failed');
        expect(infra.triggerStore.getAll()).toHaveLength(1);
        expect((await infra.sentinelPrOutcomes.list(owner, itemId)).outcomes).toEqual([
            expect.objectContaining({ delivery: 'error', error: 'Native arm failed' }),
        ]);
        expect(infra.sentinelPrOutcomes.registrationPolling.entries()).toHaveLength(1);
        status = 'merged';
        const checked = await infra.sentinelPrOutcomes.control(owner, itemId, 'check', { expectedRevision: 1 });
        expect(checked).toMatchObject({ paused: true, outcomes: [{ status: 'merged', delivery: 'pending' }] });
        expect(checked.outcomes[0].error).toBeUndefined();
        expect(queue.getAll()).toHaveLength(0);
    });

    it('retries an isolated insert failure on the existing native merge-monitor cadence', async () => {
        vi.useFakeTimers();
        vi.spyOn(infra.triggerStore, 'insert').mockImplementationOnce(() => { throw new Error('Native insert failed'); });
        await expect(infra.sentinelPrOutcomes.registerSubmission(child.workspaceId, child.processId, url)).rejects.toThrow('insert failed');
        expect(infra.sentinelPrOutcomes.registrationPolling.entries()).toHaveLength(1);
        await vi.advanceTimersByTimeAsync(DEFAULT_PR_MERGE_POLL_INTERVAL_MS);
        expect(infra.triggerStore.getAll()).toHaveLength(1);
        expect(infra.sentinelPrOutcomes.registrationPolling.entries()).toHaveLength(0);
        expect((await infra.sentinelPrOutcomes.list(owner, itemId)).outcomes[0]).toMatchObject({ delivery: 'none' });
    });

    it('persists permanent missing-owner recovery failures without an endless native retry', async () => {
        vi.spyOn(infra.triggerStore, 'insert').mockImplementationOnce(() => { throw new Error('Native insert failed'); });
        await expect(infra.sentinelPrOutcomes.registerSubmission(child.workspaceId, child.processId, url)).rejects.toThrow('insert failed');
        await store.removeProcess(owner.processId);
        await infra.sentinelPrOutcomes.restore();
        const receipt = new DelegatedJobStore(dataDir).list(owner.workspaceId)[0].pullRequests![0];
        expect(receipt.outcomeWatchError).toMatchObject({ permanent: true });
        expect(infra.sentinelPrOutcomes.registrationPolling.entries()).toHaveLength(0);
        expect(infra.triggerStore.getAll()).toHaveLength(0);
    });
});
