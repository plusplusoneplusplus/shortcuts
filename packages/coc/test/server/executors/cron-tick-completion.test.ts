/**
 * ProcessLifecycleRunner — cron-tick completion wiring.
 *
 * Regression tests for the bug where cron-originated follow-ups completed
 * through the queue but never invoked `CronExecutor.onTickComplete()`,
 * leaving crons "stranded" (active but with stale tickCount/lastTickAt/
 * nextTickAt and no re-armed timer).
 *
 * Covers the wiring contract that the queue-executor-bridge implements:
 *   - on follow-up success → onCronTickComplete(cronId, true)
 *   - on follow-up failure → onCronTickComplete(cronId, false)
 *   - non-cron follow-ups (manual, wakeup, normal chat) → not invoked
 *   - errors from the callback do not mask the follow-up's outcome
 *
 * Also includes an end-to-end test against the real CronExecutor that
 * exercises the full timer-fire → enqueue → succeed → re-arm cycle.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import type { QueuedTask } from '@plusplusoneplusplus/forge';
import { ProcessLifecycleRunner } from '../../../src/server/executors/process-lifecycle-runner';
import type { LifecycleRunnerOptions } from '../../../src/server/executors/process-lifecycle-runner';
import { CronStore } from '../../../src/server/cron/cron-store';
import { CronExecutor } from '../../../src/server/cron/cron-executor';
import type { CronExecutorDeps } from '../../../src/server/cron/cron-executor';
import type { CronEntry, CronChangeEvent } from '../../../src/server/cron/cron-types';
import { MAX_CONSECUTIVE_FAILURES } from '../../../src/server/cron/cron-types';
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
// Wiring tests: onCronTickComplete invocation
// ============================================================================

describe('ProcessLifecycleRunner — onCronTickComplete wiring', () => {
    let store: ReturnType<typeof createMockProcessStore>;
    let runner: ProcessLifecycleRunner;

    beforeEach(() => {
        vi.clearAllMocks();
        store = createMockProcessStore();
        runner = new ProcessLifecycleRunner(store as any, '/data-dir', vi.fn());
    });

    it('invokes onCronTickComplete(cronId, true) after a successful cron follow-up', async () => {
        const onCronTickComplete = vi.fn().mockResolvedValue(undefined);
        const opts = makeOpts({ onCronTickComplete });
        const task = makeFollowUpTask({ source: 'cron', cronId: 'cron_abc' });

        const result = await runner.run(task, opts);

        expect(result.success).toBe(true);
        expect(onCronTickComplete).toHaveBeenCalledOnce();
        expect(onCronTickComplete).toHaveBeenCalledWith('cron_abc', true);
    });

    it('invokes onCronTickComplete(cronId, false) after a failed cron follow-up', async () => {
        const onCronTickComplete = vi.fn().mockResolvedValue(undefined);
        const executeFollowUpFn = vi.fn().mockRejectedValue(new Error('boom'));
        const opts = makeOpts({ onCronTickComplete, executeFollowUpFn });
        const task = makeFollowUpTask({ source: 'cron', cronId: 'cron_abc' });

        const result = await runner.run(task, opts);

        expect(result.success).toBe(false);
        expect(onCronTickComplete).toHaveBeenCalledOnce();
        expect(onCronTickComplete).toHaveBeenCalledWith('cron_abc', false);
    });

    it('does not invoke onCronTickComplete for wakeup follow-ups', async () => {
        const onCronTickComplete = vi.fn().mockResolvedValue(undefined);
        const opts = makeOpts({ onCronTickComplete });
        const task = makeFollowUpTask({ source: 'wakeup', wakeupId: 'wakeup_1' });

        await runner.run(task, opts);

        expect(onCronTickComplete).not.toHaveBeenCalled();
    });

    it('does not invoke onCronTickComplete for normal follow-ups (no source in context)', async () => {
        const onCronTickComplete = vi.fn().mockResolvedValue(undefined);
        const opts = makeOpts({ onCronTickComplete });
        const task = makeFollowUpTask({ skills: ['impl'] });

        await runner.run(task, opts);

        expect(onCronTickComplete).not.toHaveBeenCalled();
    });

    it('does not invoke onCronTickComplete when context is undefined', async () => {
        const onCronTickComplete = vi.fn().mockResolvedValue(undefined);
        const opts = makeOpts({ onCronTickComplete });
        const task = makeFollowUpTask(undefined);

        await runner.run(task, opts);

        expect(onCronTickComplete).not.toHaveBeenCalled();
    });

    it('does not invoke onCronTickComplete when source is cron but cronId is missing', async () => {
        const onCronTickComplete = vi.fn().mockResolvedValue(undefined);
        const opts = makeOpts({ onCronTickComplete });
        const task = makeFollowUpTask({ source: 'cron' });

        await runner.run(task, opts);

        expect(onCronTickComplete).not.toHaveBeenCalled();
    });

    it('still returns success=true when onCronTickComplete throws after a successful follow-up', async () => {
        const onCronTickComplete = vi.fn().mockRejectedValue(new Error('bookkeeping failure'));
        const opts = makeOpts({ onCronTickComplete });
        const task = makeFollowUpTask({ source: 'cron', cronId: 'cron_abc' });

        const result = await runner.run(task, opts);

        // Bookkeeping errors must not mask the actual follow-up outcome.
        expect(result.success).toBe(true);
        expect(onCronTickComplete).toHaveBeenCalledWith('cron_abc', true);
    });

    it('preserves drain-pending-messages call before onCronTickComplete', async () => {
        const order: string[] = [];
        const onDrainPendingMessages = vi.fn(async () => { order.push('drain'); });
        const onCronTickComplete = vi.fn(async () => { order.push('cron-complete'); });
        const opts = makeOpts({ onDrainPendingMessages, onCronTickComplete });
        const task = makeFollowUpTask({ source: 'cron', cronId: 'cron_abc' });

        await runner.run(task, opts);

        expect(order).toEqual(['drain', 'cron-complete']);
    });
});

// ============================================================================
// End-to-end: real CronExecutor reacts to onTickComplete from the runner
// ============================================================================

function makeCron(overrides: Partial<CronEntry> = {}): CronEntry {
    return {
        id: overrides.id ?? 'cron_e2e',
        processId: overrides.processId ?? 'queue_proc_abc',
        description: overrides.description ?? 'E2E test cron',
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

function createCronHarness() {
    const db = new Database(':memory:');
    const cronStore = new CronStore(db);

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

    const events: CronChangeEvent[] = [];

    const deps: CronExecutorDeps = {
        store: cronStore,
        processStore,
        timerRegistry: timerRegistry as any,
        queueManager,
        emit: (event: CronChangeEvent) => events.push(event),
        resolveWorkspaceId: async () => 'ws-e2e',
    };

    const executor = new CronExecutor(deps);

    return { cronStore, timerRegistry, queueManager, executor, events, timers, db };
}

describe('CronExecutor + ProcessLifecycleRunner — successful tick re-arms the cron', () => {
    let harness: ReturnType<typeof createCronHarness>;
    let store: ReturnType<typeof createMockProcessStore>;
    let runner: ProcessLifecycleRunner;

    beforeEach(() => {
        vi.clearAllMocks();
        harness = createCronHarness();
        store = createMockProcessStore();
        runner = new ProcessLifecycleRunner(store as any, '/data-dir', vi.fn());
    });

    afterEach(() => {
        harness.db.close();
    });

    it('advances tickCount, sets lastTickAt, and re-arms the timer after a successful cron follow-up', async () => {
        const cron = makeCron({ id: 'cron_e2e', processId: 'queue_proc_abc', tickCount: 5 });
        harness.cronStore.insert(cron);
        harness.executor.armTimer(cron);
        expect(harness.timerRegistry.set).toHaveBeenCalledTimes(1);

        // Fire the timer — this enqueues a follow-up and marks the cron in-flight.
        const fire = harness.timers.get('cron_e2e');
        expect(fire).toBeDefined();
        await fire!();
        expect(harness.executor.isInflight('queue_proc_abc')).toBe(true);
        expect(harness.queueManager.enqueue).toHaveBeenCalledOnce();

        // Now run a cron-originated follow-up through the lifecycle runner.
        // The runner's onCronTickComplete wiring should re-arm the timer.
        const task = makeFollowUpTask({ source: 'cron', cronId: 'cron_e2e' });
        const beforeTick = Date.now();
        const result = await runner.run(task, makeOpts({
            onCronTickComplete: (cronId, success) => harness.executor.onTickComplete(cronId, success),
        }));

        expect(result.success).toBe(true);
        expect(harness.executor.isInflight('queue_proc_abc')).toBe(false);

        const updated = harness.cronStore.getById('cron_e2e')!;
        expect(updated.status).toBe('active');
        expect(updated.tickCount).toBe(6);
        expect(updated.consecutiveFailures).toBe(0);
        expect(updated.lastTickAt).toBeTruthy();
        expect(new Date(updated.lastTickAt!).getTime()).toBeGreaterThanOrEqual(beforeTick);
        expect(updated.nextTickAt).toBeTruthy();
        // Timer was set once for the initial arm + once after completion
        expect(harness.timerRegistry.set).toHaveBeenCalledTimes(2);
        expect(harness.timers.has('cron_e2e')).toBe(true);
    });

    it('increments consecutiveFailures and re-arms when a cron follow-up fails (below threshold)', async () => {
        const cron = makeCron({ id: 'cron_e2e_fail', processId: 'queue_proc_abc', consecutiveFailures: 0 });
        harness.cronStore.insert(cron);
        harness.executor.armTimer(cron);
        const fire = harness.timers.get('cron_e2e_fail');
        await fire!();

        const task = makeFollowUpTask({ source: 'cron', cronId: 'cron_e2e_fail' });
        const result = await runner.run(task, makeOpts({
            executeFollowUpFn: vi.fn().mockRejectedValue(new Error('SDK failure')),
            onCronTickComplete: (cronId, success) => harness.executor.onTickComplete(cronId, success),
        }));

        expect(result.success).toBe(false);
        const updated = harness.cronStore.getById('cron_e2e_fail')!;
        expect(updated.status).toBe('active');
        expect(updated.consecutiveFailures).toBe(1);
        expect(updated.tickCount).toBe(0);
        // Still re-armed because we're below the circuit-breaker threshold.
        expect(harness.timers.has('cron_e2e_fail')).toBe(true);
    });

    it('auto-pauses the cron when consecutive failures reach the threshold', async () => {
        const cron = makeCron({
            id: 'cron_e2e_pause',
            processId: 'queue_proc_abc',
            consecutiveFailures: MAX_CONSECUTIVE_FAILURES - 1,
        });
        harness.cronStore.insert(cron);
        harness.executor.armTimer(cron);
        const fire = harness.timers.get('cron_e2e_pause');
        await fire!();

        const task = makeFollowUpTask({ source: 'cron', cronId: 'cron_e2e_pause' });
        await runner.run(task, makeOpts({
            executeFollowUpFn: vi.fn().mockRejectedValue(new Error('final straw')),
            onCronTickComplete: (cronId, success) => harness.executor.onTickComplete(cronId, success),
        }));

        const updated = harness.cronStore.getById('cron_e2e_pause')!;
        expect(updated.status).toBe('paused');
        expect(updated.pausedReason).toMatch(/auto-paused/);
        expect(updated.nextTickAt).toBeNull();
        // Timer must be cancelled when the cron is auto-paused.
        expect(harness.timers.has('cron_e2e_pause')).toBe(false);
    });
});

