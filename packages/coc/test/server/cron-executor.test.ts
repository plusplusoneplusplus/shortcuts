/**
 * Unit tests for `CronExecutor` — timer scheduling, tick execution,
 * circuit breakers, concurrency guards, and lifecycle management.
 *
 * Uses in-memory SQLite databases and stubs for external dependencies.
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { CronStore } from '../../src/server/cron/cron-store';
import { CronExecutor } from '../../src/server/cron/cron-executor';
import type { CronExecutorDeps } from '../../src/server/cron/cron-executor';
import type { CronEntry, CronChangeEvent } from '../../src/server/cron/cron-types';
import { MAX_CONSECUTIVE_FAILURES, MAX_CONSECUTIVE_WAKEUPS_PER_PROCESS } from '../../src/server/cron/cron-types';

// ============================================================================
// Helpers & Stubs
// ============================================================================

function makeCron(overrides: Partial<CronEntry> = {}): CronEntry {
    return {
        id: overrides.id ?? 'cron_test1',
        processId: overrides.processId ?? 'queue_proc_abc',
        description: overrides.description ?? 'Test cron',
        intervalMs: overrides.intervalMs ?? 60_000,
        status: overrides.status ?? 'active',
        createdAt: overrides.createdAt ?? '2026-01-01T00:00:00.000Z',
        lastTickAt: 'lastTickAt' in overrides ? overrides.lastTickAt! : null,
        nextTickAt: 'nextTickAt' in overrides ? overrides.nextTickAt! : '2026-01-01T00:01:00.000Z',
        tickCount: overrides.tickCount ?? 0,
        consecutiveFailures: overrides.consecutiveFailures ?? 0,
        expiresAt: overrides.expiresAt ?? '2099-01-04T00:00:00.000Z',
        pausedReason: 'pausedReason' in overrides ? overrides.pausedReason! : null,
        prompt: overrides.prompt ?? 'check status',
        model: 'model' in overrides ? overrides.model! : null,
    };
}

/** Minimal ScheduleTimerRegistry stub. */
function createTimerRegistryStub() {
    const timers = new Map<string, { callback: () => void; delayMs: number }>();
    return {
        set: vi.fn((id: string, callback: () => void, delayMs: number) => {
            timers.set(id, { callback, delayMs });
            return { wasCapped: false };
        }),
        cancel: vi.fn((id: string) => {
            timers.delete(id);
        }),
        has: vi.fn((id: string) => timers.has(id)),
        clear: vi.fn(() => timers.clear()),
        // Test helper: fire a timer's callback directly
        _fire: async (id: string) => {
            const entry = timers.get(id);
            if (entry) {
                timers.delete(id);
                await entry.callback();
            }
        },
        _timers: timers,
    };
}

/** Minimal ProcessStore stub. */
function createProcessStoreStub(processes: Record<string, { status: string; workingDirectory?: string }> = {}) {
    return {
        getProcess: vi.fn(async (id: string) => {
            const proc = processes[id];
            if (!proc) return undefined;
            return { id, status: proc.status, workingDirectory: proc.workingDirectory || '/test' } as any;
        }),
    } as any;
}

/** Minimal TaskQueueManager stub. */
function createQueueManagerStub() {
    const tasks = new Map<string, { id: string; status: string; payload: Record<string, unknown>; processId?: string }>();
    return {
        getTask: vi.fn((taskId: string) => tasks.get(taskId)),
        updateTask: vi.fn((taskId: string, update: any) => {
            const task = tasks.get(taskId);
            if (task) {
                Object.assign(task, update);
                if (update.payload) task.payload = update.payload;
            }
            return !!task;
        }),
        requeueFromHistory: vi.fn((_taskId: string) => true),
        enqueue: vi.fn((input: any) => {
            const id = input.id || `task_${Math.random().toString(36).slice(2, 8)}`;
            tasks.set(id, { id, status: 'queued', payload: input.payload, processId: input.processId });
            return id;
        }),
        _tasks: tasks,
    } as any;
}

function createDeps(overrides: Partial<CronExecutorDeps> = {}): {
    deps: CronExecutorDeps;
    store: CronStore;
    timerRegistry: ReturnType<typeof createTimerRegistryStub>;
    queueManager: ReturnType<typeof createQueueManagerStub>;
    processStore: ReturnType<typeof createProcessStoreStub>;
    events: CronChangeEvent[];
} {
    const db = new Database(':memory:');
    const store = new CronStore(db);
    const timerRegistry = createTimerRegistryStub();
    const queueManager = createQueueManagerStub();
    const processStore = createProcessStoreStub({
        'queue_proc_abc': { status: 'completed' },
    });
    const events: CronChangeEvent[] = [];

    const deps: CronExecutorDeps = {
        store: overrides.store ?? store,
        processStore: overrides.processStore ?? processStore,
        timerRegistry: overrides.timerRegistry ?? (timerRegistry as any),
        queueManager: overrides.queueManager ?? (queueManager as any),
        emit: overrides.emit ?? ((event: CronChangeEvent) => events.push(event)),
        resolveWorkspaceId: overrides.resolveWorkspaceId ?? (async () => 'ws-test'),
    };

    return { deps, store, timerRegistry, queueManager, processStore, events };
}

// ============================================================================
// Tests
// ============================================================================

describe('CronExecutor', () => {
    beforeEach(() => {
        vi.useFakeTimers();
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    // --------------------------------------------------------------------
    // armAll / armTimer
    // --------------------------------------------------------------------

    describe('armAll', () => {
        it('arms timers for all active crons', () => {
            const { deps, store, timerRegistry } = createDeps();
            store.insert(makeCron({ id: 'cron_1', status: 'active' }));
            store.insert(makeCron({ id: 'cron_2', status: 'active' }));
            store.insert(makeCron({ id: 'cron_3', status: 'paused' }));

            const executor = new CronExecutor(deps);
            executor.armAll();

            expect(timerRegistry.set).toHaveBeenCalledTimes(2);
            expect(timerRegistry._timers.has('cron_1')).toBe(true);
            expect(timerRegistry._timers.has('cron_2')).toBe(true);
            expect(timerRegistry._timers.has('cron_3')).toBe(false);
        });
    });

    describe('armTimer', () => {
        it('does not arm timer for non-active crons', () => {
            const { deps, timerRegistry } = createDeps();
            const executor = new CronExecutor(deps);

            executor.armTimer(makeCron({ status: 'paused' }));
            expect(timerRegistry.set).not.toHaveBeenCalled();

            executor.armTimer(makeCron({ status: 'cancelled' }));
            expect(timerRegistry.set).not.toHaveBeenCalled();

            executor.armTimer(makeCron({ status: 'expired' }));
            expect(timerRegistry.set).not.toHaveBeenCalled();
        });

        it('computes delay from nextTickAt', () => {
            const { deps, timerRegistry } = createDeps();
            const executor = new CronExecutor(deps);

            const futureTime = new Date(Date.now() + 30_000).toISOString();
            executor.armTimer(makeCron({ nextTickAt: futureTime }));

            expect(timerRegistry.set).toHaveBeenCalledTimes(1);
            const [, , delayMs] = timerRegistry.set.mock.calls[0];
            // Allow 100ms tolerance for test execution time
            expect(delayMs).toBeGreaterThanOrEqual(29_000);
            expect(delayMs).toBeLessThanOrEqual(30_100);
        });

        it('uses 0 delay for overdue nextTickAt', () => {
            const { deps, timerRegistry } = createDeps();
            const executor = new CronExecutor(deps);

            const pastTime = new Date(Date.now() - 5_000).toISOString();
            executor.armTimer(makeCron({ nextTickAt: pastTime }));

            const [, , delayMs] = timerRegistry.set.mock.calls[0];
            expect(delayMs).toBe(0);
        });

        it('falls back to intervalMs when nextTickAt is null', () => {
            const { deps, timerRegistry } = createDeps();
            const executor = new CronExecutor(deps);

            executor.armTimer(makeCron({ nextTickAt: null, intervalMs: 45_000 }));

            const [, , delayMs] = timerRegistry.set.mock.calls[0];
            expect(delayMs).toBe(45_000);
        });
    });

    // --------------------------------------------------------------------
    // disarmTimer
    // --------------------------------------------------------------------

    describe('disarmTimer', () => {
        it('cancels the timer for a cron', () => {
            const { deps, timerRegistry } = createDeps();
            const executor = new CronExecutor(deps);

            executor.armTimer(makeCron({ id: 'cron_x' }));
            expect(timerRegistry._timers.has('cron_x')).toBe(true);

            executor.disarmTimer('cron_x');
            expect(timerRegistry.cancel).toHaveBeenCalledWith('cron_x');
        });
    });

    // --------------------------------------------------------------------
    // shutdownAll
    // --------------------------------------------------------------------

    describe('shutdownAll', () => {
        it('cancels active timers without mutating persisted crons', () => {
            const { deps, store, timerRegistry } = createDeps();
            store.insert(makeCron({ id: 'cron_1', status: 'active' }));
            store.insert(makeCron({ id: 'cron_2', status: 'active' }));
            store.insert(makeCron({ id: 'cron_3', status: 'paused' }));

            const executor = new CronExecutor(deps);
            executor.armAll();

            executor.shutdownAll();

            // Timers should be cancelled
            expect(timerRegistry.clear).toHaveBeenCalledTimes(1);
            expect(timerRegistry._timers.has('cron_1')).toBe(false);
            expect(timerRegistry._timers.has('cron_2')).toBe(false);

            // Active crons should remain active so startup can re-arm them.
            expect(store.getActive()).toHaveLength(2);
            const cron1 = store.getById('cron_1')!;
            expect(cron1.status).toBe('active');
            expect(cron1.pausedReason).toBeNull();
        });

        it('does not query the store during shutdown after storage migration changes', () => {
            const { deps, timerRegistry } = createDeps({
                store: {
                    getActive: vi.fn(() => {
                        throw new Error('no such table: crons');
                    }),
                } as any,
            });
            const executor = new CronExecutor(deps);

            executor.armTimer(makeCron({ id: 'cron_shutdown' }));
            expect(timerRegistry._timers.has('cron_shutdown')).toBe(true);

            expect(() => executor.shutdownAll()).not.toThrow();
            expect(timerRegistry.clear).toHaveBeenCalledTimes(1);
            expect(timerRegistry._timers.has('cron_shutdown')).toBe(false);
            expect(deps.store.getActive).not.toHaveBeenCalled();
        });
    });

    // --------------------------------------------------------------------
    // onTick — happy path
    // --------------------------------------------------------------------

    describe('onTick', () => {
        it('enqueues a follow-up when process is completed', async () => {
            const { deps, store, timerRegistry, queueManager } = createDeps();
            const cron = makeCron({ id: 'cron_tick', processId: 'queue_proc_abc' });
            store.insert(cron);

            const executor = new CronExecutor(deps);
            executor.armAll();

            await timerRegistry._fire('cron_tick');

            // Should have tried to enqueue
            // Either via requeueFromHistory or enqueue
            const enqueueCalls = queueManager.enqueue.mock.calls;
            const requeueCalls = queueManager.requeueFromHistory.mock.calls;
            expect(enqueueCalls.length + requeueCalls.length).toBeGreaterThan(0);
        });

        it('skips tick when cron is not active', async () => {
            const { deps, store, timerRegistry, queueManager } = createDeps();
            const cron = makeCron({ id: 'cron_paused_tick', status: 'active' });
            store.insert(cron);

            const executor = new CronExecutor(deps);
            executor.armAll();

            // Manually pause the cron after arming
            const l = store.getById('cron_paused_tick')!;
            l.status = 'paused';
            store.update(l);

            await timerRegistry._fire('cron_paused_tick');

            expect(queueManager.enqueue).not.toHaveBeenCalled();
            expect(queueManager.requeueFromHistory).not.toHaveBeenCalled();
        });

        it('expires cron when TTL is exceeded', async () => {
            const { deps, store, timerRegistry, events } = createDeps();
            const cron = makeCron({
                id: 'cron_expired',
                expiresAt: new Date(Date.now() - 1000).toISOString(),
            });
            store.insert(cron);

            const executor = new CronExecutor(deps);
            executor.armAll();

            await timerRegistry._fire('cron_expired');

            const updated = store.getById('cron_expired')!;
            expect(updated.status).toBe('expired');
            expect(events.some(e => e.type === 'cron-expired')).toBe(true);
        });

        it('auto-pauses when process is cancelled', async () => {
            const processStore = createProcessStoreStub({
                'queue_proc_cancelled': { status: 'cancelled' },
            });
            const { deps, store, timerRegistry, events } = createDeps({ processStore });
            const cron = makeCron({ id: 'cron_cancelled_proc', processId: 'queue_proc_cancelled' });
            store.insert(cron);

            const executor = new CronExecutor(deps);
            executor.armAll();

            await timerRegistry._fire('cron_cancelled_proc');

            const updated = store.getById('cron_cancelled_proc')!;
            expect(updated.status).toBe('paused');
            expect(updated.pausedReason).toContain('cancelled');
            expect(events.some(e => e.type === 'cron-paused')).toBe(true);
        });

        it('auto-pauses when process is failed', async () => {
            const processStore = createProcessStoreStub({
                'queue_proc_failed': { status: 'failed' },
            });
            const { deps, store, timerRegistry, events } = createDeps({ processStore });
            const cron = makeCron({ id: 'cron_failed_proc', processId: 'queue_proc_failed' });
            store.insert(cron);

            const executor = new CronExecutor(deps);
            executor.armAll();

            await timerRegistry._fire('cron_failed_proc');

            const updated = store.getById('cron_failed_proc')!;
            expect(updated.status).toBe('paused');
            expect(updated.pausedReason).toContain('failed');
        });

        it('skips tick when process is running (reschedules)', async () => {
            const processStore = createProcessStoreStub({
                'queue_proc_running': { status: 'running' },
            });
            const { deps, store, timerRegistry, queueManager } = createDeps({ processStore });
            const cron = makeCron({ id: 'cron_skip_running', processId: 'queue_proc_running' });
            store.insert(cron);

            const executor = new CronExecutor(deps);
            executor.armAll();

            await timerRegistry._fire('cron_skip_running');

            expect(queueManager.enqueue).not.toHaveBeenCalled();
            expect(queueManager.requeueFromHistory).not.toHaveBeenCalled();

            // Should reschedule
            const updated = store.getById('cron_skip_running')!;
            expect(updated.nextTickAt).not.toBeNull();
            // Timer should be re-armed
            expect(timerRegistry.set.mock.calls.length).toBeGreaterThan(1);
        });
    });

    // --------------------------------------------------------------------
    // Circuit breakers
    // --------------------------------------------------------------------

    describe('circuit breakers', () => {
        it('auto-pauses after MAX_CONSECUTIVE_FAILURES', async () => {
            const { deps, store, events } = createDeps();
            const cron = makeCron({
                id: 'cron_failing',
                consecutiveFailures: MAX_CONSECUTIVE_FAILURES - 1,
            });
            store.insert(cron);

            const executor = new CronExecutor(deps);

            // Simulate a failure on the last allowed attempt
            await executor.onTickComplete('cron_failing', false);

            const updated = store.getById('cron_failing')!;
            expect(updated.status).toBe('paused');
            expect(updated.pausedReason).toContain('consecutive failures');
            expect(events.some(e => e.type === 'cron-paused')).toBe(true);
        });

        it('resets consecutive failures on success', async () => {
            const { deps, store, timerRegistry } = createDeps();
            const cron = makeCron({
                id: 'cron_recovering',
                consecutiveFailures: 2,
            });
            store.insert(cron);

            const executor = new CronExecutor(deps);

            await executor.onTickComplete('cron_recovering', true);

            const updated = store.getById('cron_recovering')!;
            expect(updated.consecutiveFailures).toBe(0);
            expect(updated.tickCount).toBe(1);
            expect(updated.lastTickAt).not.toBeNull();
        });

        it('auto-pauses when wakeup limit is reached', async () => {
            const { deps, store, timerRegistry, events } = createDeps();
            const cron = makeCron({ id: 'cron_wakeup_limit' });
            store.insert(cron);

            const executor = new CronExecutor(deps);

            // Simulate reaching the wakeup limit
            for (let i = 0; i < MAX_CONSECUTIVE_WAKEUPS_PER_PROCESS; i++) {
                executor['wakeupCounts'].set('queue_proc_abc', i);
            }
            executor['wakeupCounts'].set(cron.processId, MAX_CONSECUTIVE_WAKEUPS_PER_PROCESS);

            executor.armAll();
            await timerRegistry._fire('cron_wakeup_limit');

            const updated = store.getById('cron_wakeup_limit')!;
            expect(updated.status).toBe('paused');
            expect(updated.pausedReason).toContain('consecutive wakeups');
        });
    });

    // --------------------------------------------------------------------
    // resetWakeupCount
    // --------------------------------------------------------------------

    describe('resetWakeupCount', () => {
        it('clears the wakeup counter for a process', () => {
            const { deps } = createDeps();
            const executor = new CronExecutor(deps);

            executor['wakeupCounts'].set('queue_proc_abc', 50);
            executor.resetWakeupCount('queue_proc_abc');

            expect(executor['wakeupCounts'].has('queue_proc_abc')).toBe(false);
        });
    });

    // --------------------------------------------------------------------
    // isInflight
    // --------------------------------------------------------------------

    describe('isInflight', () => {
        it('returns false when no tick is in flight', () => {
            const { deps } = createDeps();
            const executor = new CronExecutor(deps);
            expect(executor.isInflight('queue_proc_abc')).toBe(false);
        });

        it('returns true when a tick is in flight', () => {
            const { deps } = createDeps();
            const executor = new CronExecutor(deps);
            executor['inflight'].add('queue_proc_abc');
            expect(executor.isInflight('queue_proc_abc')).toBe(true);
        });
    });

    // --------------------------------------------------------------------
    // onTickComplete
    // --------------------------------------------------------------------

    describe('onTickComplete', () => {
        it('clears inflight on success', async () => {
            const { deps, store } = createDeps();
            const cron = makeCron({ id: 'cron_complete' });
            store.insert(cron);

            const executor = new CronExecutor(deps);
            executor['inflight'].add(cron.processId);

            await executor.onTickComplete('cron_complete', true);

            expect(executor.isInflight(cron.processId)).toBe(false);
        });

        it('clears inflight on failure', async () => {
            const { deps, store } = createDeps();
            const cron = makeCron({ id: 'cron_fail' });
            store.insert(cron);

            const executor = new CronExecutor(deps);
            executor['inflight'].add(cron.processId);

            await executor.onTickComplete('cron_fail', false);

            expect(executor.isInflight(cron.processId)).toBe(false);
        });

        it('increments tickCount and sets lastTickAt on success', async () => {
            const { deps, store } = createDeps();
            const cron = makeCron({ id: 'cron_inc', tickCount: 3 });
            store.insert(cron);

            const executor = new CronExecutor(deps);
            await executor.onTickComplete('cron_inc', true);

            const updated = store.getById('cron_inc')!;
            expect(updated.tickCount).toBe(4);
            expect(updated.lastTickAt).not.toBeNull();
        });

        it('schedules next tick after completion', async () => {
            const { deps, store, timerRegistry } = createDeps();
            const cron = makeCron({ id: 'cron_resched' });
            store.insert(cron);

            const executor = new CronExecutor(deps);
            await executor.onTickComplete('cron_resched', true);

            const updated = store.getById('cron_resched')!;
            expect(updated.nextTickAt).not.toBeNull();
            expect(timerRegistry.set).toHaveBeenCalled();
        });

        it('does nothing for unknown cron id', async () => {
            const { deps } = createDeps();
            const executor = new CronExecutor(deps);

            // Should not throw
            await executor.onTickComplete('nonexistent', true);
        });

        it('does nothing for non-active cron', async () => {
            const { deps, store, timerRegistry } = createDeps();
            const cron = makeCron({ id: 'cron_paused_complete', status: 'paused' });
            store.insert(cron);

            const executor = new CronExecutor(deps);
            await executor.onTickComplete('cron_paused_complete', true);

            // Should not re-arm timer
            expect(timerRegistry.set).not.toHaveBeenCalled();
        });
    });

    // --------------------------------------------------------------------
    // Concurrency guard
    // --------------------------------------------------------------------

    describe('concurrency', () => {
        it('skips tick when another tick is already inflight for the same process', async () => {
            const { deps, store, timerRegistry, queueManager } = createDeps();
            const cron = makeCron({ id: 'cron_concurrent' });
            store.insert(cron);

            const executor = new CronExecutor(deps);
            executor['inflight'].add(cron.processId);

            executor.armAll();
            await timerRegistry._fire('cron_concurrent');

            expect(queueManager.enqueue).not.toHaveBeenCalled();
            expect(queueManager.requeueFromHistory).not.toHaveBeenCalled();

            // Should reschedule
            const updated = store.getById('cron_concurrent')!;
            expect(updated.nextTickAt).not.toBeNull();
        });
    });

    // --------------------------------------------------------------------
    // enqueue flow — new task fallback
    // --------------------------------------------------------------------

    describe('enqueue', () => {
        it('enqueues a new task when no existing task in queue', async () => {
            const { deps, store, timerRegistry, queueManager } = createDeps();
            const cron = makeCron({ id: 'cron_new', prompt: 'hello world' });
            store.insert(cron);

            const executor = new CronExecutor(deps);
            executor.armAll();

            await timerRegistry._fire('cron_new');

            expect(queueManager.enqueue).toHaveBeenCalled();
            const call = queueManager.enqueue.mock.calls[0][0];
            expect(call.payload.prompt).toBe('hello world');
            expect(call.payload.processId).toBe('queue_proc_abc');
            expect(call.payload.context.cronId).toBe('cron_new');
            expect(call.payload.context.source).toBe('cron');
        });

        it('inherits resolved follow-up mode into fallback enqueue payload', async () => {
            // Cron ticks must not flip an Ask/Plan conversation into Autopilot.
            // The resolver inspects the process's metadata.mode (defaulting to
            // 'ask' when absent) and the resolved value is written onto
            // payload.mode so the UI badge and execution agree.
            const { deps, store, timerRegistry, queueManager } = createDeps();
            const cron = makeCron({ id: 'cron_mode_preserve', prompt: 'tick' });
            store.insert(cron);

            const executor = new CronExecutor(deps);
            executor.armAll();

            await timerRegistry._fire('cron_mode_preserve');

            expect(queueManager.enqueue).toHaveBeenCalled();
            const call = queueManager.enqueue.mock.calls[0][0];
            expect(call.payload.mode).toBe('ask');
            expect(call.payload.context.cronId).toBe('cron_mode_preserve');
            expect(call.payload.context.source).toBe('cron');
        });

        it('normalizes legacy process metadata.mode when resolving follow-up mode', async () => {
            const { deps, store, timerRegistry, queueManager, processStore } = createDeps();
            processStore.getProcess.mockImplementation(async (id: string) => ({
                id,
                status: 'completed',
                workingDirectory: '/test',
                metadata: { mode: 'plan' },
            }));

            const cron = makeCron({ id: 'cron_plan', prompt: 'tick' });
            store.insert(cron);

            const executor = new CronExecutor(deps);
            executor.armAll();
            await timerRegistry._fire('cron_plan');

            expect(queueManager.enqueue).toHaveBeenCalled();
            const call = queueManager.enqueue.mock.calls[0][0];
            expect(call.payload.mode).toBe('ask');
        });

        it('overwrites stale mode on requeue with resolved mode', async () => {
            const { deps, store, timerRegistry, queueManager, processStore } = createDeps();
            processStore.getProcess.mockImplementation(async (id: string) => ({
                id,
                status: 'completed',
                workingDirectory: '/test',
                metadata: { mode: 'ask' },
            }));

            queueManager._tasks.set('proc_abc', {
                id: 'proc_abc',
                status: 'completed',
                payload: { kind: 'chat', mode: 'autopilot', prompt: 'old prompt' },
                processId: 'queue_proc_abc',
            });

            const cron = makeCron({ id: 'cron_requeue_mode', prompt: 'new prompt' });
            store.insert(cron);

            const executor = new CronExecutor(deps);
            executor.armAll();
            await timerRegistry._fire('cron_requeue_mode');

            expect(queueManager.updateTask).toHaveBeenCalled();
            const updateCall = queueManager.updateTask.mock.calls[0];
            expect(updateCall[1].payload.mode).toBe('ask');
            expect(updateCall[1].payload.prompt).toBe('new prompt');
        });

        it('requeues from history when task exists as completed', async () => {
            const { deps, store, timerRegistry, queueManager } = createDeps();
            // Pre-populate a completed task in the queue
            queueManager._tasks.set('proc_abc', {
                id: 'proc_abc',
                status: 'completed',
                payload: { kind: 'chat', mode: 'autopilot', prompt: 'old prompt' },
                processId: 'queue_proc_abc',
            });

            const cron = makeCron({ id: 'cron_requeue', prompt: 'new prompt' });
            store.insert(cron);

            const executor = new CronExecutor(deps);
            executor.armAll();

            await timerRegistry._fire('cron_requeue');

            expect(queueManager.updateTask).toHaveBeenCalled();
            expect(queueManager.requeueFromHistory).toHaveBeenCalledWith('proc_abc');
        });
    });
});
