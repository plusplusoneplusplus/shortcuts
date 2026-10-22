import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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
    let dataDir: string;
    const fetchPr = vi.fn();
    const recover = vi.fn();
    let dateTimeEnabled = false;

    beforeEach(async () => {
        vi.useFakeTimers();
        vi.setSystemTime(BASE);
        dateTimeEnabled = false;
        fetchPr.mockReset().mockResolvedValue({ status: 'merged', title: 'Merged PR', mergeCommit: 'commit-1' });
        recover.mockReset().mockResolvedValue(undefined);
        dataDir = mkdtempSync(join(tmpdir(), 'sentinel-trigger-'));
        store = new SqliteProcessStore({ dbPath: join(dataDir, 'processes.db') });
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
        rmSync(dataDir, { recursive: true, force: true });
        vi.useRealTimers();
    });

    async function start() {
        infra?.dispose();
        infra = await createTriggerInfrastructure({
            dataDir, store, queueFacade: queue, deliveryBridge: bridge,
            recoverPendingMessages: recover, emit: vi.fn(),
            ciChecksFetcher: vi.fn(), prStatusFetcher: fetchPr, now: () => Date.now(),
            getDateTimeEnabled: () => dateTimeEnabled,
        });
        return infra;
    }

    function seedPending() {
        triggers.update({
            ...rule, status: 'disarmed', outcome: 'fired', revision: 2, nextTickAt: null,
            action: { ...rule.action, prompt: 'Durably saved wake snapshot' },
            delivery: { deliveryId: 'delivery-1', firedAt: timestamp, state: 'pending',
                reason: rule.event.type === 'date-time' ? 'due' : 'merged', itemRevision: 1 },
        });
    }

    function dateRule(delay = 60_000) {
        dateTimeEnabled = true;
        rule = { ...rule, event: { type: 'date-time', firesAt: new Date(BASE + delay).toISOString(), timeZone: 'UTC' },
            nextTickAt: new Date(BASE + delay).toISOString() };
        triggers.update(rule);
    }

    it('delivers a future date once to the exact Sentinel without PR polling or item changes', async () => {
        dateRule();
        const initial = todos.get(owner);
        await start();
        await vi.advanceTimersByTimeAsync(59_999);
        expect(queue.getAll()).toEqual([]);
        await vi.advanceTimersByTimeAsync(1);
        const fired = triggers.getById(rule.id)!;
        expect(fired).toMatchObject({ outcome: 'fired', delivery: { reason: 'due', state: 'delivered' } });
        expect(queue.getAll()).toHaveLength(1);
        expect(queue.getAll()[0]).toMatchObject({ processId: owner.processId, payload: {
            workspaceId: owner.workspaceId, mode: 'sentinel', processId: owner.processId,
            context: { triggerId: rule.id, deliveryId: fired.delivery!.deliveryId },
        } });
        expect(queue.getAll()[0].payload.prompt).toContain('grants no new authorization');
        expect(todos.get(owner)).toEqual(initial);
        await start();
        await vi.advanceTimersByTimeAsync(300_000);
        expect(queue.getAll()).toHaveLength(1);
        expect(fetchPr).not.toHaveBeenCalled();
        expect(bridge.executeFollowUp).not.toHaveBeenCalled();
    });

    it('catches up an overdue rule once after owner restart and retains the durable identity', async () => {
        dateRule();
        const current = await start();
        current.dispose(); infra = undefined;
        store.close();
        store = new SqliteProcessStore({ dbPath: join(dataDir, 'processes.db') });
        todos = new SentinelTodoStore(store.getDatabase());
        triggers = new TriggerStore(store.getDatabase());
        vi.setSystemTime(BASE + 120_000);
        await start();
        await vi.advanceTimersByTimeAsync(1);
        const receipt = triggers.getById(rule.id)?.delivery?.deliveryId;
        expect(receipt).toBeTruthy();
        await start();
        await vi.advanceTimersByTimeAsync(1);
        expect(queue.getAll()).toHaveLength(1);
        expect(triggers.getById(rule.id)?.delivery?.deliveryId).toBe(receipt);
    });

    it('re-arms bounded long waits and backward clock changes without an early wake', async () => {
        const cap = 2_147_483_647;
        dateRule(cap + 60_000);
        await start();
        await vi.advanceTimersByTimeAsync(cap);
        expect(queue.getAll()).toEqual([]);
        vi.setSystemTime(BASE);
        await vi.advanceTimersByTimeAsync(60_000);
        expect(queue.getAll()).toEqual([]);
        expect(infra!.timerRegistry.has(rule.id)).toBe(true);
        vi.setSystemTime(BASE + cap + 60_000);
        await start();
        await vi.advanceTimersByTimeAsync(1);
        expect(queue.getAll()).toHaveLength(1);
        expect(fetchPr).not.toHaveBeenCalled();
    });

    it('disarms live disabled date rules and catches up on enable without touching PR availability', async () => {
        dateRule();
        await start();
        dateTimeEnabled = false;
        infra!.triggerManager.refreshDateTime();
        expect(infra!.timerRegistry.has(rule.id)).toBe(false);
        await vi.advanceTimersByTimeAsync(120_000);
        expect(queue.getAll()).toEqual([]);
        expect(triggers.getById(rule.id)?.status).toBe('active');
        await expect(infra!.sentinelOvertures.create(owner, {
            itemId: rule.binding!.itemId, event: { type: 'date-time', localTime: '2027-01-01T00:00', firesAt: '2027-01-01T00:00:00.000Z', timeZone: 'UTC' },
        }, 'user')).rejects.toThrow('disabled');
        dateTimeEnabled = true;
        infra!.triggerManager.refreshDateTime();
        await vi.advanceTimersByTimeAsync(1);
        expect(queue.getAll()).toHaveLength(1);
    });
    it('does not arm or reconcile persisted date rules while the owner-server gate is off', async () => {
        dateRule(-1);
        seedPending();
        dateTimeEnabled = false;
        await start();
        expect(infra!.timerRegistry.has(rule.id)).toBe(false);
        expect(queue.getAll()).toEqual([]);
        expect(triggers.getById(rule.id)?.delivery?.state).toBe('pending');
        dateTimeEnabled = true;
        infra!.triggerManager.refreshDateTime();
        await vi.advanceTimersByTimeAsync(1);
        expect(queue.getAll()).toHaveLength(1);
        expect(triggers.getById(rule.id)?.delivery?.deliveryId).toBe('delivery-1');
    });

    it.each(['done', 'archived', 'manual', 'missing', 'paused', 'removed', 'owner-missing', 'owner-other-workspace'] as const)(
        'suppresses date catch-up for %s', async kind => {
            dateRule(-1);
            if (kind === 'done') todos.update(owner, rule.binding!.itemId, 1, { status: 'done' }, 'user');
            if (kind === 'archived') todos.update(owner, rule.binding!.itemId, 1, { archived: true }, 'user');
            if (kind === 'manual') {
                const manual = todos.create(owner, { title: 'Manual', type: 'manual' }, { actor: 'user' }).item;
                rule.binding!.itemId = manual.id; triggers.update(rule);
            }
            if (kind === 'missing') { rule.binding!.itemId = 'missing'; triggers.update(rule); }
            if (kind === 'paused') triggers.update({ ...rule, status: 'paused' });
            if (kind === 'removed') triggers.update({ ...rule, binding: { ...rule.binding!, removedAt: timestamp }, status: 'disarmed' });
            if (kind === 'owner-missing') await store.removeProcess(owner.processId);
            if (kind === 'owner-other-workspace') await store.updateProcess(owner.processId, { metadata: { mode: 'sentinel', workspaceId: 'other' } });
            await start();
            await vi.advanceTimersByTimeAsync(1);
            expect(queue.getAll()).toEqual([]);
            expect(fetchPr).not.toHaveBeenCalled();
            expect(triggers.getById(rule.id)?.delivery).toBeUndefined();
        });

    it('buffers a date wake once while its owning Sentinel is busy', async () => {
        dateRule(-1);
        await store.updateProcess(owner.processId, { status: 'running' });
        const initial = todos.get(owner);
        await start();
        await vi.advanceTimersByTimeAsync(1);
        expect(queue.getAll()).toEqual([]);
        const messages = (await store.getProcess(owner.processId))!.pendingMessages!;
        expect(messages).toHaveLength(1);
        expect(messages[0].context).toMatchObject({ source: 'trigger', triggerId: rule.id });
        expect(messages[0].content).toContain('grants no new authorization');
        await start();
        expect((await store.getProcess(owner.processId))!.pendingMessages).toHaveLength(1);
        expect(todos.get(owner)).toEqual(initial);
    });

    it.each(['queue', 'pending', 'turn', 'before-enqueue'] as const)(
        'recovers a date crash at %s using one immutable delivery receipt', async kind => {
            dateRule(-1);
            seedPending();
            const saved = triggers.getById(rule.id)!;
            triggers.update({ ...saved, delivery: { ...saved.delivery!, reason: 'due' } });
            const context = { source: 'trigger' as const, triggerId: rule.id, deliveryId: 'delivery-1' };
            if (kind === 'queue') queue.enqueue({
                id: 'delivery-1', processId: owner.processId, type: 'chat', priority: 'normal',
                payload: { kind: 'chat', workspaceId: owner.workspaceId, processId: owner.processId, context, relayRequestId: 'delivery-1' },
            });
            if (kind === 'pending') await store.appendPendingMessage(owner.processId, {
                id: 'delivery-1', relayRequestId: 'delivery-1', context, content: 'Saved wake', createdAt: timestamp,
            });
            if (kind === 'turn') await store.appendConversationTurn(owner.processId, index => ({
                role: 'user', turnIndex: index, content: 'Saved wake', timestamp: new Date(BASE), turnSource: context, relayRequestId: 'delivery-1',
            }));
            await start();
            await start();
            expect(triggers.getById(rule.id)?.delivery).toMatchObject({ deliveryId: 'delivery-1', state: 'delivered' });
            expect(bridge.enqueueAdmitted).toHaveBeenCalledTimes(kind === 'before-enqueue' ? 1 : 0);
            if (kind === 'before-enqueue') expect(queue.getAll()[0].payload.prompt).toBe('Durably saved wake snapshot');
            expect(fetchPr).not.toHaveBeenCalled();
        });

    it('keeps date delivery failures visible, retries with backoff, and suppresses removed pending rules', async () => {
        dateRule(-1);
        vi.mocked(bridge.enqueueAdmitted!).mockRejectedValueOnce(new Error('Queue unavailable'));
        await start();
        await vi.advanceTimersByTimeAsync(1);
        const pending = triggers.getById(rule.id)!;
        expect(pending).toMatchObject({ delivery: { state: 'pending', consecutiveErrors: 1 }, outcomeReason: expect.any(String) });
        const receipt = pending.delivery!.deliveryId;
        await vi.advanceTimersByTimeAsync(119_998);
        expect(queue.getAll()).toEqual([]);
        await vi.advanceTimersByTimeAsync(1);
        expect(queue.getAll()).toHaveLength(1);
        expect(triggers.getById(rule.id)?.delivery).toMatchObject({ deliveryId: receipt, state: 'delivered' });
        // A second pending receipt is removed before reconciliation.
        seedPending();
        const removable = triggers.getById(rule.id)!;
        await infra!.sentinelOvertures.remove(owner, rule.id, { expectedRevision: removable.revision });
        await start();
        expect(triggers.getById(rule.id)?.delivery?.state).toBe('failed');
        expect(queue.getAll()).toHaveLength(1);
    });
    it('surfaces pre-decision owner lookup failures and retries at a bounded cadence rather than spinning', async () => {
        dateRule(-1);
        await start();
        vi.spyOn(store, 'getProcess').mockRejectedValueOnce(new Error('Owner lookup unavailable'));
        await vi.advanceTimersByTimeAsync(1);
        expect(triggers.getById(rule.id)).toMatchObject({
            status: 'active', outcomeReason: 'Owner lookup unavailable', nextTickAt: new Date(BASE + 60_000).toISOString(),
        });
        expect(queue.getAll()).toEqual([]);
        await vi.advanceTimersByTimeAsync(59_998);
        expect(queue.getAll()).toEqual([]);
        await vi.advanceTimersByTimeAsync(1);
        expect(queue.getAll()).toHaveLength(1);
        expect(triggers.getById(rule.id)?.outcomeReason).toBeUndefined();
    });

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
