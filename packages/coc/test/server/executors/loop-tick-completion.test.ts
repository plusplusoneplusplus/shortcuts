/**
 * ProcessLifecycleRunner — loop-tick completion wiring.
 *
 * Regression tests for the bug where loop-originated follow-ups completed
 * through the queue but never invoked `LoopExecutor.onTickComplete()`,
 * leaving loops "stranded" (active but with stale tickCount/lastTickAt/
 * nextTickAt and no re-armed timer).
 *
 * Covers the wiring contract that the queue-executor-bridge implements:
 *   - on follow-up success → onLoopTickComplete(loopId, true)
 *   - on follow-up failure → onLoopTickComplete(loopId, false)
 *   - non-loop follow-ups (manual, wakeup, normal chat) → not invoked
 *   - errors from the callback do not mask the follow-up's outcome
 *
 * Also includes an end-to-end test against the real LoopExecutor that
 * exercises the full timer-fire → enqueue → succeed → re-arm cycle.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import type { QueuedTask } from '@plusplusoneplusplus/forge';
import { ProcessLifecycleRunner } from '../../../src/server/executors/process-lifecycle-runner';
import type { LifecycleRunnerOptions } from '../../../src/server/executors/process-lifecycle-runner';
import { LoopStore } from '../../../src/server/loops/loop-store';
import { LoopExecutor } from '../../../src/server/loops/loop-executor';
import type { LoopExecutorDeps } from '../../../src/server/loops/loop-executor';
import type { LoopEntry, LoopChangeEvent } from '../../../src/server/loops/loop-types';
import { MAX_CONSECUTIVE_FAILURES } from '../../../src/server/loops/loop-types';
import { createMockProcessStore } from '../helpers/mock-process-store';

// ============================================================================
// Mocks
// ============================================================================

vi.mock('../../../src/server/executors/image-store', () => ({
    saveImagesToTempFiles: vi.fn().mockReturnValue({ tempDir: undefined, attachments: [] }),
    cleanupTempDir: vi.fn(),
    rehydrateImagesIfNeeded: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../../src/server/processes/output-file-manager', () => ({
    OutputFileManager: { saveOutput: vi.fn().mockResolvedValue(undefined) },
}));

// ============================================================================
// Helpers
// ============================================================================

function makeFollowUpTask(context: Record<string, unknown> | undefined): QueuedTask {
    return {
        id: 'task-1',
        type: 'chat',
        displayName: 'test',
        priority: 1,
        addedAt: new Date(),
        config: { model: undefined },
        payload: {
            kind: 'chat',
            prompt: 'Check status',
            processId: 'queue_proc_abc',
            mode: 'autopilot',
            ...(context !== undefined ? { context } : {}),
        } as any,
    } as QueuedTask;
}

function makeOpts(overrides: Partial<LifecycleRunnerOptions> = {}): LifecycleRunnerOptions {
    return {
        cancelledTasks: new Set<string>(),
        executeFollowUpFn: vi.fn().mockResolvedValue(undefined),
        executeByTypeFn: vi.fn().mockResolvedValue({ response: 'done' }),
        getWorkingDirectoryFn: vi.fn().mockReturnValue('/tmp'),
        ...overrides,
    };
}

// ============================================================================
// Wiring tests: onLoopTickComplete invocation
// ============================================================================

describe('ProcessLifecycleRunner — onLoopTickComplete wiring', () => {
    let store: ReturnType<typeof createMockProcessStore>;
    let runner: ProcessLifecycleRunner;

    beforeEach(() => {
        vi.clearAllMocks();
        store = createMockProcessStore();
        runner = new ProcessLifecycleRunner(store as any, '/data-dir', vi.fn());
    });

    it('invokes onLoopTickComplete(loopId, true) after a successful loop follow-up', async () => {
        const onLoopTickComplete = vi.fn().mockResolvedValue(undefined);
        const opts = makeOpts({ onLoopTickComplete });
        const task = makeFollowUpTask({ source: 'loop', loopId: 'loop_abc' });

        const result = await runner.run(task, opts);

        expect(result.success).toBe(true);
        expect(onLoopTickComplete).toHaveBeenCalledOnce();
        expect(onLoopTickComplete).toHaveBeenCalledWith('loop_abc', true);
    });

    it('invokes onLoopTickComplete(loopId, false) after a failed loop follow-up', async () => {
        const onLoopTickComplete = vi.fn().mockResolvedValue(undefined);
        const executeFollowUpFn = vi.fn().mockRejectedValue(new Error('boom'));
        const opts = makeOpts({ onLoopTickComplete, executeFollowUpFn });
        const task = makeFollowUpTask({ source: 'loop', loopId: 'loop_abc' });

        const result = await runner.run(task, opts);

        expect(result.success).toBe(false);
        expect(onLoopTickComplete).toHaveBeenCalledOnce();
        expect(onLoopTickComplete).toHaveBeenCalledWith('loop_abc', false);
    });

    it('does not invoke onLoopTickComplete for wakeup follow-ups', async () => {
        const onLoopTickComplete = vi.fn().mockResolvedValue(undefined);
        const opts = makeOpts({ onLoopTickComplete });
        const task = makeFollowUpTask({ source: 'wakeup', wakeupId: 'wakeup_1' });

        await runner.run(task, opts);

        expect(onLoopTickComplete).not.toHaveBeenCalled();
    });

    it('does not invoke onLoopTickComplete for normal follow-ups (no source in context)', async () => {
        const onLoopTickComplete = vi.fn().mockResolvedValue(undefined);
        const opts = makeOpts({ onLoopTickComplete });
        const task = makeFollowUpTask({ skills: ['impl'] });

        await runner.run(task, opts);

        expect(onLoopTickComplete).not.toHaveBeenCalled();
    });

    it('does not invoke onLoopTickComplete when context is undefined', async () => {
        const onLoopTickComplete = vi.fn().mockResolvedValue(undefined);
        const opts = makeOpts({ onLoopTickComplete });
        const task = makeFollowUpTask(undefined);

        await runner.run(task, opts);

        expect(onLoopTickComplete).not.toHaveBeenCalled();
    });

    it('does not invoke onLoopTickComplete when source is loop but loopId is missing', async () => {
        const onLoopTickComplete = vi.fn().mockResolvedValue(undefined);
        const opts = makeOpts({ onLoopTickComplete });
        const task = makeFollowUpTask({ source: 'loop' });

        await runner.run(task, opts);

        expect(onLoopTickComplete).not.toHaveBeenCalled();
    });

    it('still returns success=true when onLoopTickComplete throws after a successful follow-up', async () => {
        const onLoopTickComplete = vi.fn().mockRejectedValue(new Error('bookkeeping failure'));
        const opts = makeOpts({ onLoopTickComplete });
        const task = makeFollowUpTask({ source: 'loop', loopId: 'loop_abc' });

        const result = await runner.run(task, opts);

        // Bookkeeping errors must not mask the actual follow-up outcome.
        expect(result.success).toBe(true);
        expect(onLoopTickComplete).toHaveBeenCalledWith('loop_abc', true);
    });

    it('preserves drain-pending-messages call before onLoopTickComplete', async () => {
        const order: string[] = [];
        const onDrainPendingMessages = vi.fn(async () => { order.push('drain'); });
        const onLoopTickComplete = vi.fn(async () => { order.push('loop-complete'); });
        const opts = makeOpts({ onDrainPendingMessages, onLoopTickComplete });
        const task = makeFollowUpTask({ source: 'loop', loopId: 'loop_abc' });

        await runner.run(task, opts);

        expect(order).toEqual(['drain', 'loop-complete']);
    });
});

// ============================================================================
// End-to-end: real LoopExecutor reacts to onTickComplete from the runner
// ============================================================================

function makeLoop(overrides: Partial<LoopEntry> = {}): LoopEntry {
    return {
        id: overrides.id ?? 'loop_e2e',
        processId: overrides.processId ?? 'queue_proc_abc',
        description: overrides.description ?? 'E2E test loop',
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

function createLoopHarness() {
    const db = new Database(':memory:');
    const loopStore = new LoopStore(db);

    const timers = new Map<string, () => void>();
    const timerRegistry = {
        set: vi.fn((id: string, callback: () => void, _delayMs: number) => {
            timers.set(id, callback);
            return { wasCapped: false };
        }),
        cancel: vi.fn((id: string) => { timers.delete(id); }),
        has: vi.fn((id: string) => timers.has(id)),
        clear: vi.fn(() => timers.clear()),
    };

    const queueManager = {
        getTask: vi.fn(() => undefined),
        updateTask: vi.fn(() => true),
        requeueFromHistory: vi.fn(() => true),
        enqueue: vi.fn(() => 'task-enq-1'),
    } as any;

    const processStore = {
        getProcess: vi.fn(async (id: string) => ({ id, status: 'completed', workingDirectory: '/tmp' })),
    } as any;

    const events: LoopChangeEvent[] = [];

    const deps: LoopExecutorDeps = {
        store: loopStore,
        processStore,
        timerRegistry: timerRegistry as any,
        queueManager,
        emit: (event: LoopChangeEvent) => events.push(event),
        resolveWorkspaceId: async () => 'ws-e2e',
    };

    const executor = new LoopExecutor(deps);

    return { loopStore, timerRegistry, queueManager, executor, events, timers, db };
}

describe('LoopExecutor + ProcessLifecycleRunner — successful tick re-arms the loop', () => {
    let harness: ReturnType<typeof createLoopHarness>;
    let store: ReturnType<typeof createMockProcessStore>;
    let runner: ProcessLifecycleRunner;

    beforeEach(() => {
        vi.clearAllMocks();
        harness = createLoopHarness();
        store = createMockProcessStore();
        runner = new ProcessLifecycleRunner(store as any, '/data-dir', vi.fn());
    });

    afterEach(() => {
        harness.db.close();
    });

    it('advances tickCount, sets lastTickAt, and re-arms the timer after a successful loop follow-up', async () => {
        const loop = makeLoop({ id: 'loop_e2e', processId: 'queue_proc_abc', tickCount: 5 });
        harness.loopStore.insert(loop);
        harness.executor.armTimer(loop);
        expect(harness.timerRegistry.set).toHaveBeenCalledTimes(1);

        // Fire the timer — this enqueues a follow-up and marks the loop in-flight.
        const fire = harness.timers.get('loop_e2e');
        expect(fire).toBeDefined();
        await fire!();
        expect(harness.executor.isInflight('queue_proc_abc')).toBe(true);
        expect(harness.queueManager.enqueue).toHaveBeenCalledOnce();

        // Now run a loop-originated follow-up through the lifecycle runner.
        // The runner's onLoopTickComplete wiring should re-arm the timer.
        const task = makeFollowUpTask({ source: 'loop', loopId: 'loop_e2e' });
        const beforeTick = Date.now();
        const result = await runner.run(task, makeOpts({
            onLoopTickComplete: (loopId, success) => harness.executor.onTickComplete(loopId, success),
        }));

        expect(result.success).toBe(true);
        expect(harness.executor.isInflight('queue_proc_abc')).toBe(false);

        const updated = harness.loopStore.getById('loop_e2e')!;
        expect(updated.status).toBe('active');
        expect(updated.tickCount).toBe(6);
        expect(updated.consecutiveFailures).toBe(0);
        expect(updated.lastTickAt).toBeTruthy();
        expect(new Date(updated.lastTickAt!).getTime()).toBeGreaterThanOrEqual(beforeTick);
        expect(updated.nextTickAt).toBeTruthy();
        // Timer was set once for the initial arm + once after completion
        expect(harness.timerRegistry.set).toHaveBeenCalledTimes(2);
        expect(harness.timers.has('loop_e2e')).toBe(true);
    });

    it('increments consecutiveFailures and re-arms when a loop follow-up fails (below threshold)', async () => {
        const loop = makeLoop({ id: 'loop_e2e_fail', processId: 'queue_proc_abc', consecutiveFailures: 0 });
        harness.loopStore.insert(loop);
        harness.executor.armTimer(loop);
        const fire = harness.timers.get('loop_e2e_fail');
        await fire!();

        const task = makeFollowUpTask({ source: 'loop', loopId: 'loop_e2e_fail' });
        const result = await runner.run(task, makeOpts({
            executeFollowUpFn: vi.fn().mockRejectedValue(new Error('SDK failure')),
            onLoopTickComplete: (loopId, success) => harness.executor.onTickComplete(loopId, success),
        }));

        expect(result.success).toBe(false);
        const updated = harness.loopStore.getById('loop_e2e_fail')!;
        expect(updated.status).toBe('active');
        expect(updated.consecutiveFailures).toBe(1);
        expect(updated.tickCount).toBe(0);
        // Still re-armed because we're below the circuit-breaker threshold.
        expect(harness.timers.has('loop_e2e_fail')).toBe(true);
    });

    it('auto-pauses the loop when consecutive failures reach the threshold', async () => {
        const loop = makeLoop({
            id: 'loop_e2e_pause',
            processId: 'queue_proc_abc',
            consecutiveFailures: MAX_CONSECUTIVE_FAILURES - 1,
        });
        harness.loopStore.insert(loop);
        harness.executor.armTimer(loop);
        const fire = harness.timers.get('loop_e2e_pause');
        await fire!();

        const task = makeFollowUpTask({ source: 'loop', loopId: 'loop_e2e_pause' });
        await runner.run(task, makeOpts({
            executeFollowUpFn: vi.fn().mockRejectedValue(new Error('final straw')),
            onLoopTickComplete: (loopId, success) => harness.executor.onTickComplete(loopId, success),
        }));

        const updated = harness.loopStore.getById('loop_e2e_pause')!;
        expect(updated.status).toBe('paused');
        expect(updated.pausedReason).toMatch(/auto-paused/);
        expect(updated.nextTickAt).toBeNull();
        // Timer must be cancelled when the loop is auto-paused.
        expect(harness.timers.has('loop_e2e_pause')).toBe(false);
    });
});

