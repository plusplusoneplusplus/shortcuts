import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SqliteProcessStore, TaskQueueManager, type CreateTaskInput } from '@plusplusoneplusplus/forge';
import type { QueueExecutorBridge } from '../../../src/server/core/api-handler';
import { createTriggerInfrastructure, type TriggerInfrastructure } from '../../../src/server/infrastructure/trigger-infrastructure';
import { SentinelTodoStore } from '../../../src/server/sentinel-todos/sentinel-todo-store';
import { TriggerStore } from '../../../src/server/triggers/trigger-store';
import type { Trigger } from '../../../src/server/triggers/trigger-types';

const owner = { workspaceId: 'ws-owner', processId: 'queue_sentinel-owner' };
const BASE = Date.parse('2026-01-01T00:00:00.000Z');
const timestamp = new Date(BASE).toISOString();

describe('Sentinel trigger durable delivery infrastructure', () => {
    let store: SqliteProcessStore;
    let queue: TaskQueueManager;
    let todos: SentinelTodoStore;
    let triggers: TriggerStore;
    let rule: Trigger;
    let infra: TriggerInfrastructure | undefined;
    let bridge: QueueExecutorBridge;
    const fetchPr = vi.fn();
    const recover = vi.fn();

    beforeEach(async () => {
        vi.useFakeTimers();
        vi.setSystemTime(BASE);
        fetchPr.mockReset().mockResolvedValue({ status: 'merged', title: 'Merged PR', mergeCommit: 'commit-1' });
        recover.mockReset().mockResolvedValue(undefined);
        store = new SqliteProcessStore({ dbPath: ':memory:' });
        await store.addProcess({
            ...owner, id: owner.processId, type: 'chat', status: 'completed',
            promptPreview: '', startTime: new Date(BASE),
            metadata: { mode: 'sentinel', workspaceId: owner.workspaceId },
        });
        queue = new TaskQueueManager();
        bridge = {
            executeFollowUp: vi.fn(), isSessionAlive: vi.fn(),
            enqueue: vi.fn(async (input: CreateTaskInput) => queue.enqueue(input)),
            enqueueAdmitted: vi.fn(async (input: CreateTaskInput) => queue.enqueue(input)),
            getTask: id => queue.getTask(id),
            findTaskByProcessId: processId => queue.getAll().find(task =>
                task.processId === processId && (task.status === 'running' || task.status === 'queued')),
        };
        todos = new SentinelTodoStore(store.getDatabase());
        triggers = new TriggerStore(store.getDatabase());
        const { item } = todos.create(owner, { title: 'Item' }, { actor: 'user' });
        rule = {
            ...owner, id: 'rule-1', status: 'active', revision: 1, expiresAt: null,
            createdAt: timestamp, lastTickAt: null, nextTickAt: timestamp, inFlight: false,
            binding: { kind: 'sentinel-todo', itemId: item.id, armedBy: 'sentinel', armedAt: timestamp },
            event: {
                type: 'condition-monitor', monitor: 'pr-merged', consecutiveErrors: 0, pollIntervalMs: 300_000,
                pr: { provider: 'github', host: 'github.com', repoPath: 'example/repo', number: 1, url: 'https://github.com/example/repo/pull/1' },
            },
            action: { type: 'send-message', processId: owner.processId, mode: 'inherit', prompt: '' },
        };
        triggers.insert(rule);
    });
    afterEach(() => {
        infra?.dispose();
        infra = undefined;
        store.close();
        vi.useRealTimers();
    });

    async function start() {
        infra?.dispose();
        infra = await createTriggerInfrastructure({
            dataDir: '', store, queueFacade: queue, deliveryBridge: bridge,
            recoverPendingMessages: recover, emit: vi.fn(),
            ciChecksFetcher: vi.fn(), prStatusFetcher: fetchPr, now: () => Date.now(),
        });
        return infra;
    }

    function seedPending() {
        triggers.update({
            ...rule, status: 'disarmed', outcome: 'fired', revision: 2, nextTickAt: null,
            action: { ...rule.action, prompt: 'Durably saved wake snapshot' },
            delivery: { deliveryId: 'delivery-1', firedAt: timestamp, state: 'pending', reason: 'merged', itemRevision: 1 },
        });
    }

    it('wires the evaluator to the one-shot firer and owner-routed durable queue admission', async () => {
        const initial = todos.get(owner);
        await start();
        await vi.advanceTimersByTimeAsync(1);
        const saved = triggers.getById(rule.id)!;
        expect(saved).toMatchObject({ status: 'disarmed', outcome: 'fired', delivery: { state: 'delivered' } });
        const task = queue.getTask(saved.delivery!.deliveryId)!;
        expect(task.payload).toMatchObject({
            mode: 'sentinel', processId: owner.processId, workspaceId: owner.workspaceId,
            context: { deliveryId: saved.delivery!.deliveryId, triggerId: rule.id, source: 'trigger' },
        });
        expect(bridge.enqueueAdmitted).toHaveBeenCalledTimes(1);
        expect(bridge.enqueue).not.toHaveBeenCalled();
        expect(todos.get(owner)).toEqual(initial);
        await vi.advanceTimersByTimeAsync(300_000);
        expect(fetchPr).toHaveBeenCalledTimes(1);
        expect(queue.getAll()).toHaveLength(1);
    });

    it('reconciles a crash between the fire write and enqueue before polling', async () => {
        seedPending();
        await start();
        expect(queue.getAll()).toHaveLength(1);
        expect(queue.getTask('delivery-1')?.payload.prompt).toBe('Durably saved wake snapshot');
        expect(triggers.getById(rule.id)?.delivery?.state).toBe('delivered');
        expect(fetchPr).not.toHaveBeenCalled();
    });

    it.each(['queue', 'pending', 'turn'])('reconciles a crash after %s persistence without duplicating', async kind => {
        seedPending();
        const context = { source: 'trigger' as const, triggerId: rule.id, deliveryId: 'delivery-1' };
        if (kind === 'queue') queue.enqueue({
            id: 'delivery-1', processId: owner.processId, type: 'chat', priority: 'normal',
            payload: { kind: 'chat', workspaceId: owner.workspaceId, processId: owner.processId, context, relayRequestId: 'delivery-1' },
        });
        if (kind === 'pending') await store.appendPendingMessage(owner.processId, {
            id: 'delivery-1', relayRequestId: 'delivery-1', context,
            content: 'Saved wake', createdAt: timestamp,
        });
        if (kind === 'turn') await store.appendConversationTurn(owner.processId, index => ({
            role: 'user', turnIndex: index, content: 'Saved wake', timestamp: new Date(BASE),
            turnSource: context, relayRequestId: 'delivery-1',
        }));
        await start();
        expect(bridge.enqueueAdmitted).not.toHaveBeenCalled();
        expect(triggers.getById(rule.id)?.delivery?.state).toBe('delivered');
        expect(fetchPr).not.toHaveBeenCalled();
    });

    it('retries visible transient errors with backoff on the existing trigger timer', async () => {
        seedPending();
        vi.mocked(bridge.enqueueAdmitted!).mockRejectedValueOnce(new Error('Queue unavailable'));
        const current = await start();
        expect(triggers.getById(rule.id)).toMatchObject({
            outcome: 'fired', outcomeReason: 'Failed to enqueue follow-up',
            delivery: { state: 'pending', consecutiveErrors: 1 },
        });
        expect(current.timerRegistry.has(rule.id)).toBe(true);
        await vi.advanceTimersByTimeAsync(599_999);
        expect(queue.getAll()).toEqual([]);
        await vi.advanceTimersByTimeAsync(1);
        expect(queue.getAll()).toHaveLength(1);
        expect(triggers.getById(rule.id)).toMatchObject({ delivery: { state: 'delivered' }, nextTickAt: null });
        expect(triggers.getById(rule.id)?.outcomeReason).toBeUndefined();
        expect(fetchPr).not.toHaveBeenCalled();
    });

    it('keeps missing owner deliveries pending and never targets another workspace', async () => {
        seedPending();
        await store.updateProcess(owner.processId, { metadata: { mode: 'sentinel', workspaceId: 'foreign' } });
        await start();
        expect(queue.getAll()).toEqual([]);
        expect(triggers.getById(rule.id)?.delivery?.state).toBe('pending');
        expect(triggers.getById(rule.id)?.outcomeReason).toContain('unavailable');
        await vi.advanceTimersByTimeAsync(600_000);
        expect(queue.getAll()).toEqual([]);
        expect(fetchPr).not.toHaveBeenCalled();
    });

    it('retains busy wakes durably and invokes existing buffer recovery on restart', async () => {
        seedPending();
        await store.updateProcess(owner.processId, { status: 'running' });
        await start();
        expect((await store.getProcess(owner.processId))?.pendingMessages).toHaveLength(1);
        expect(triggers.getById(rule.id)?.delivery?.state).toBe('delivered');
        expect(queue.getAll()).toEqual([]);
        await store.updateProcess(owner.processId, { status: 'completed' });
        recover.mockClear();
        await start();
        expect(recover).toHaveBeenCalledWith(owner.workspaceId, owner.processId);
        expect((await store.getProcess(owner.processId))?.pendingMessages).toHaveLength(1);
        expect(bridge.enqueueAdmitted).not.toHaveBeenCalled();
    });

    it('does not retry after disposal', async () => {
        seedPending();
        vi.mocked(bridge.enqueueAdmitted!).mockRejectedValue(new Error('Queue unavailable'));
        const current = await start();
        current.dispose();
        await vi.advanceTimersByTimeAsync(3_600_000);
        expect(bridge.enqueueAdmitted).toHaveBeenCalledTimes(1);
    });

    it('retries failed recovery of an already-accepted busy wake without another enqueue', async () => {
        seedPending();
        const pending = triggers.getById(rule.id)!;
        triggers.update({ ...pending, delivery: { ...pending.delivery!, state: 'delivered' } });
        await store.appendPendingMessage(owner.processId, {
            id: 'delivery-1', relayRequestId: 'delivery-1', content: 'Saved wake', createdAt: timestamp,
            context: { source: 'trigger', triggerId: rule.id, deliveryId: 'delivery-1' },
        });
        recover.mockRejectedValueOnce(new Error('Drain unavailable'));
        await start();
        expect(triggers.getById(rule.id)).toMatchObject({
            delivery: { state: 'pending' }, outcomeReason: 'Drain unavailable',
        });
        await vi.advanceTimersByTimeAsync(300_000);
        expect(triggers.getById(rule.id)?.delivery?.state).toBe('delivered');
        expect(bridge.enqueueAdmitted).not.toHaveBeenCalled();
        expect(recover).toHaveBeenCalledTimes(2);
    });
});
