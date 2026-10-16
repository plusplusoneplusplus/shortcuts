/**
 * Verifies the trigger infrastructure builder wires the store, manager,
 * ci-failure evaluator, queue-backed action executor, and timer registry
 * together correctly:
 *  - re-arms persisted active triggers from `nextTickAt` (and skips paused),
 *  - a tick resolves the ci-failure evaluator, polls via the injected checks
 *    fetcher, and fires the action into the queue with the `trigger` context,
 *  - `dispose()` cancels all timers.
 *
 * Uses an in-memory SqliteProcessStore (so the builder reuses its DB handle),
 * a fake checks fetcher, and a mock queue facade. Fake timers keep it
 * deterministic and file-I/O-free.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { SqliteProcessStore, TaskQueueManager } from '@plusplusoneplusplus/forge';
import { createTriggerInfrastructure } from '../../../src/server/infrastructure/trigger-infrastructure';
import { TriggerStore } from '../../../src/server/triggers/trigger-store';
import { TriggerManager } from '../../../src/server/triggers/trigger-manager';
import { PullRequestChatBindingStore } from '../../../src/server/processes/pull-request-chat-binding-store';
import type { CiChecksFetcher, CiPrChecksSnapshot } from '../../../src/server/triggers/ci-failure-evaluator';
import type { Trigger } from '../../../src/server/triggers/trigger-types';

const BASE = Date.parse('2026-01-01T00:00:00.000Z');

function makeTrigger(overrides: Partial<Trigger> = {}): Trigger {
    return {
        id: overrides.id ?? 'trigger_1',
        workspaceId: overrides.workspaceId ?? 'ws_a',
        processId: overrides.processId ?? 'proc_a',
        status: overrides.status ?? 'active',
        event: overrides.event ?? {
            type: 'condition-monitor',
            monitor: 'ci-failure',
            originId: 'origin_1',
            prId: '42',
            pollIntervalMs: 60_000,
            lastSeenChecks: {},
        },
        action: overrides.action ?? {
            type: 'send-message',
            processId: 'proc_a',
            prompt: 'fix the CI',
            mode: 'autopilot',
        },
        inFlight: overrides.inFlight ?? false,
        createdAt: overrides.createdAt ?? '2026-01-01T00:00:00.000Z',
        expiresAt: overrides.expiresAt ?? '2099-01-01T00:00:00.000Z',
        lastTickAt: 'lastTickAt' in overrides ? overrides.lastTickAt! : null,
        nextTickAt: 'nextTickAt' in overrides ? overrides.nextTickAt! : null,
    };
}

function makeQueueFacade() {
    const queue = new TaskQueueManager();
    return Object.assign(queue, { enqueue: vi.fn(queue.enqueue.bind(queue)) });
}

function makeFetcher(snapshot: CiPrChecksSnapshot): CiChecksFetcher & { mock: ReturnType<typeof vi.fn> } {
    const mock = vi.fn(async () => snapshot);
    const fetcher = ((args: { workspaceId: string; originId: string; prId: string }) => mock(args)) as any;
    fetcher.mock = mock;
    return fetcher;
}

describe('createTriggerInfrastructure', () => {
    let store: SqliteProcessStore;

    beforeEach(async () => {
        store = new SqliteProcessStore({ dbPath: ':memory:' });
        await store.addProcess({ id: 'proc_a', type: 'chat', status: 'completed',
            promptPreview: 'PR owner', startTime: new Date(BASE), metadata: { workspaceId: 'ws_a', mode: 'autopilot' } });
        new PullRequestChatBindingStore(store.getDatabase()).bind('origin_1', '42', 'proc_a');
        vi.useFakeTimers();
        vi.setSystemTime(BASE);
    });

    afterEach(() => {
        vi.useRealTimers();
        try { store.close(); } catch { /* ignore */ }
    });

    async function build(fetcher: CiChecksFetcher) {
        const queueFacade = makeQueueFacade();
        return createTriggerInfrastructure({
            dataDir: '/tmp/coc-trigger-infra-test',
            queueFacade,
            deliveryBridge: { executeFollowUp: vi.fn(), isSessionAlive: vi.fn(),
                enqueue: async input => queueFacade.enqueue(input), getTask: id => queueFacade.getTask(id) },
            store,
            emit: vi.fn(),
            ciChecksFetcher: fetcher,
        });
    }

    it('returns store, manager, timer registry, and dispose', async () => {
        const infra = await build(makeFetcher({ prStatus: 'open', prNumber: 1, checks: [] }));

        expect(infra.triggerStore).toBeInstanceOf(TriggerStore);
        expect(infra.triggerManager).toBeInstanceOf(TriggerManager);
        expect(typeof infra.dispose).toBe('function');
        expect(infra.timerRegistry.has('nope')).toBe(false);

        infra.dispose();
    });

    it('re-arms persisted active triggers and skips paused ones', async () => {
        // Seed the shared DB via a first infra instance.
        const infra1 = await build(makeFetcher({ prStatus: 'open', prNumber: 1, checks: [] }));
        const future = new Date(BASE + 60_000).toISOString();
        infra1.triggerStore.insert(makeTrigger({ id: 'trigger_active', status: 'active', nextTickAt: future }));
        infra1.triggerStore.insert(makeTrigger({ id: 'trigger_paused', status: 'paused', nextTickAt: future }));
        infra1.dispose();

        // A fresh infra over the same store re-arms active triggers on startup.
        const infra2 = await build(makeFetcher({ prStatus: 'open', prNumber: 1, checks: [] }));
        expect(infra2.timerRegistry.has('trigger_active')).toBe(true);
        expect(infra2.timerRegistry.has('trigger_paused')).toBe(false);

        infra2.dispose();
    });

    it('a tick polls via the injected fetcher and fires the action into the queue', async () => {
        const fetcher = makeFetcher({
            prStatus: 'open',
            prNumber: 42,
            checks: [{ id: 'build', name: 'build', status: 'failure', detailsUrl: 'https://ci/build' }],
        });
        const queueFacade = makeQueueFacade();
        const infra = await createTriggerInfrastructure({
            dataDir: '/tmp/coc-trigger-infra-test',
            queueFacade,
            deliveryBridge: { executeFollowUp: vi.fn(), isSessionAlive: vi.fn(),
                enqueue: async input => queueFacade.enqueue(input), getTask: id => queueFacade.getTask(id) },
            store,
            emit: vi.fn(),
            ciChecksFetcher: fetcher,
        });

        // Overdue active trigger: armAll schedules it with a 0ms delay.
        infra.triggerStore.insert(makeTrigger({ id: 'trigger_fire', nextTickAt: new Date(BASE).toISOString() }));
        infra.triggerManager.arm(infra.triggerStore.getById('trigger_fire')!);

        await vi.advanceTimersByTimeAsync(1);

        expect(fetcher.mock).toHaveBeenCalledWith({ workspaceId: 'ws_a', originId: 'origin_1', prId: '42' });
        expect(queueFacade.enqueue).toHaveBeenCalledTimes(1);
        const payload = queueFacade.enqueue.mock.calls[0][0].payload;
        expect(payload.context).toMatchObject({ triggerId: 'trigger_fire', source: 'trigger',
            deliveryId: expect.any(String) });
        expect(payload.mode).toBe('autopilot');
        expect(payload.prompt).toContain('#42');

        infra.dispose();
    });

    it('creates monitors through the tool capability with workspace validation and scheduling', async () => {
        const infra = await build(makeFetcher({ prStatus: 'open', prNumber: 42, checks: [] }));
        try {
            const body = { processId: 'proc_a', event: {
                type: 'condition-monitor', monitor: 'ci-failure', originId: 'origin_1', prId: '42',
            } };
            const trigger = await infra.createTrigger('ws_a', body, true);
            expect(infra.timerRegistry.has(trigger.id)).toBe(true);
            expect(infra.triggerStore.getById(trigger.id)).toEqual(trigger);
            expect((await infra.createTrigger('ws_a', body, true)).id).toBe(trigger.id);
            await expect(infra.createTrigger('ws_b', body, true)).rejects.toThrow('different workspace');
            expect(infra.triggerStore.getAll()).toHaveLength(1);
        } finally {
            infra.dispose();
        }
    });

    it('dispose cancels armed timers', async () => {
        const infra = await build(makeFetcher({ prStatus: 'open', prNumber: 1, checks: [] }));
        const future = new Date(BASE + 60_000).toISOString();
        infra.triggerStore.insert(makeTrigger({ id: 'trigger_d', status: 'active', nextTickAt: future }));
        infra.triggerManager.arm(infra.triggerStore.getById('trigger_d')!);
        expect(infra.timerRegistry.has('trigger_d')).toBe(true);

        infra.dispose();
        expect(infra.timerRegistry.has('trigger_d')).toBe(false);
    });

    it('reconciles a completed durable PR repair after restart without repeating delivery', async () => {
        const first = await build(makeFetcher({ prStatus: 'open', prNumber: 42, checks: [] }));
        const event = { ...makeTrigger().event, repairDelivery: {
            id: 'repair-1', prompt: 'Resolve conflict', state: 'admitted' as const, attempts: 1,
        } };
        first.triggerStore.insert(makeTrigger({ id: 'repair-monitor', inFlight: true, event }));
        await store.appendConversationTurn('proc_a', turnIndex => ({
            role: 'user', turnIndex, content: 'Resolve conflict', timestamp: new Date(BASE), timeline: [],
            turnSource: { source: 'trigger', triggerId: 'repair-monitor', deliveryId: 'repair-1' },
        }));
        await store.updateProcess('proc_a', { status: 'completed' });
        first.dispose();
        const restored = await build(makeFetcher({ prStatus: 'open', prNumber: 42, checks: [] }));
        try {
            expect(restored.triggerStore.getById('repair-monitor')).toMatchObject({ inFlight: false, event: {
                repairStatus: expect.stringContaining('fresh CI'),
            } });
        } finally { restored.dispose(); }
    });
    describe('PR repair owner resolution after restart (owner absent from the queue)', () => {
        const FAILING = { prStatus: 'open' as const, prNumber: 42,
            checks: [{ id: 'build', name: 'build', status: 'failure' as const, detailsUrl: 'https://ci/build' }] };
        const OWNER = 'queue_owner-1';

        beforeEach(async () => {
            // A completed owner persisted with a queue-prefixed id; the restarted
            // queue does not hold its task. The PR binding uses the bare task id.
            await store.addProcess({ id: OWNER, type: 'chat', status: 'completed', promptPreview: 'PR owner',
                startTime: new Date(BASE), metadata: { workspaceId: 'ws_a', mode: 'autopilot' } });
            new PullRequestChatBindingStore(store.getDatabase()).bind('origin_1', '43', 'owner-1');
        });

        async function fire(overrides: Partial<Trigger>) {
            const fetcher = makeFetcher(FAILING);
            const queueFacade = makeQueueFacade();
            const infra = await createTriggerInfrastructure({
                dataDir: '/tmp/coc-trigger-infra-test', queueFacade,
                deliveryBridge: { executeFollowUp: vi.fn(), isSessionAlive: vi.fn(),
                    enqueue: async input => queueFacade.enqueue(input), getTask: id => queueFacade.getTask(id) },
                store, emit: vi.fn(), ciChecksFetcher: fetcher,
            });
            const base = makeTrigger();
            infra.triggerStore.insert(makeTrigger({
                id: 'repair', processId: OWNER, nextTickAt: new Date(BASE).toISOString(),
                event: { ...base.event, prId: '43' } as Trigger['event'],
                action: { ...base.action, processId: OWNER }, ...overrides,
            }));
            infra.triggerManager.arm(infra.triggerStore.getById('repair')!);
            await vi.advanceTimersByTimeAsync(1);
            return { infra, queueFacade };
        }

        const receipt = (infra: Awaited<ReturnType<typeof createTriggerInfrastructure>>) => {
            const event = infra.triggerStore.getById('repair')!.event;
            return event.type === 'condition-monitor' && event.monitor === 'ci-failure' ? event.repairDelivery : undefined;
        };

        it('admits the repair through the persisted owner exactly once, even when the receipt is replayed', async () => {
            const { infra, queueFacade } = await fire({});
            try {
                expect(queueFacade.enqueue).toHaveBeenCalledTimes(1);
                expect(queueFacade.enqueue.mock.calls[0][0]).toMatchObject({
                    payload: { processId: OWNER, context: { triggerId: 'repair', source: 'trigger' } } });
                const admitted = receipt(infra)!;
                expect(admitted).toMatchObject({ state: 'admitted', attempts: 1 });

                // Replay the same durable receipt (e.g. crash before 'admitted' was saved).
                const replay = infra.triggerStore.getById('repair')!;
                if (replay.event.type === 'condition-monitor' && replay.event.monitor === 'ci-failure') {
                    replay.event.repairDelivery = { ...admitted, state: 'pending', retryAt: undefined };
                }
                replay.nextTickAt = new Date(Date.now()).toISOString();
                infra.triggerStore.update(replay);
                infra.triggerManager.arm(replay);
                await vi.advanceTimersByTimeAsync(1);

                expect(queueFacade.enqueue).toHaveBeenCalledTimes(1);
                expect(receipt(infra)).toMatchObject({ id: admitted.id, state: 'admitted' });
            } finally { infra.dispose(); }
        });

        it.each([
            ['the trigger workspace differs from the owner', { workspaceId: 'ws_b' }],
            ['the owner conversation is missing', { processId: 'queue_missing',
                action: { type: 'send-message', processId: 'queue_missing', prompt: 'fix', mode: 'autopilot' } }],
        ] as Array<[string, Partial<Trigger>]>)('rejects without admission when %s', async (_label, overrides) => {
            const { infra, queueFacade } = await fire(overrides);
            try {
                expect(queueFacade.enqueue).not.toHaveBeenCalled();
                expect(receipt(infra)).toMatchObject({ state: 'pending', attempts: 1 });
                expect(infra.triggerStore.getById('repair')!.event).toMatchObject({
                    repairStatus: expect.stringContaining('failed') });
            } finally { infra.dispose(); }
        });

        it('rejects without admission when the PR is bound to a different conversation', async () => {
            new PullRequestChatBindingStore(store.getDatabase()).bind('origin_1', '43', 'other-task');
            const { infra, queueFacade } = await fire({});
            try {
                expect(queueFacade.enqueue).not.toHaveBeenCalled();
                expect(receipt(infra)).toMatchObject({ state: 'pending', attempts: 1 });
            } finally { infra.dispose(); }
        });
    });
});
