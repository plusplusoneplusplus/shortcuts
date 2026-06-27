/**
 * createTriggerInfrastructure Tests
 *
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
import { SqliteProcessStore } from '@plusplusoneplusplus/forge';
import { createTriggerInfrastructure } from '../../../src/server/infrastructure/trigger-infrastructure';
import { TriggerStore } from '../../../src/server/triggers/trigger-store';
import { TriggerManager } from '../../../src/server/triggers/trigger-manager';
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
    return {
        enqueue: vi.fn(),
        getTask: vi.fn(),
        getQueued: vi.fn().mockReturnValue([]),
        getRunning: vi.fn().mockReturnValue([]),
    } as any;
}

function makeFetcher(snapshot: CiPrChecksSnapshot): CiChecksFetcher & { mock: ReturnType<typeof vi.fn> } {
    const mock = vi.fn(async () => snapshot);
    const fetcher = ((args: { workspaceId: string; originId: string; prId: string }) => mock(args)) as any;
    fetcher.mock = mock;
    return fetcher;
}

describe('createTriggerInfrastructure', () => {
    let store: SqliteProcessStore;

    beforeEach(() => {
        store = new SqliteProcessStore({ dbPath: ':memory:' });
        vi.useFakeTimers();
        vi.setSystemTime(BASE);
    });

    afterEach(() => {
        vi.useRealTimers();
        try { store.close(); } catch { /* ignore */ }
    });

    async function build(fetcher: CiChecksFetcher) {
        return createTriggerInfrastructure({
            dataDir: '/tmp/coc-trigger-infra-test',
            queueFacade: makeQueueFacade(),
            store,
            emit: vi.fn(),
            resolveWorkspaceId: async () => 'ws_a',
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
            store,
            emit: vi.fn(),
            resolveWorkspaceId: async () => 'ws_a',
            ciChecksFetcher: fetcher,
        });

        // Overdue active trigger: armAll schedules it with a 0ms delay.
        infra.triggerStore.insert(makeTrigger({ id: 'trigger_fire', nextTickAt: new Date(BASE).toISOString() }));
        infra.triggerManager.arm(infra.triggerStore.getById('trigger_fire')!);

        await vi.advanceTimersByTimeAsync(1);

        expect(fetcher.mock).toHaveBeenCalledWith({ workspaceId: 'ws_a', originId: 'origin_1', prId: '42' });
        expect(queueFacade.enqueue).toHaveBeenCalledTimes(1);
        const payload = queueFacade.enqueue.mock.calls[0][0].payload;
        expect(payload.context).toEqual({ triggerId: 'trigger_fire', source: 'trigger' });
        expect(payload.mode).toBe('autopilot');
        expect(payload.prompt).toContain('#42');

        infra.dispose();
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
});
