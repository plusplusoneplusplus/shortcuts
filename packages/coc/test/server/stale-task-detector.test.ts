/**
 * Tests for automatic detection and force-fail of stale running tasks.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { StaleTaskDetector } from '../../src/server/processes/stale-task-detector';
import { TaskQueueManager, createTaskQueueManager } from '@plusplusoneplusplus/forge';
import type { CreateTaskInput, TaskPriority, ProcessStore, AIProcess } from '@plusplusoneplusplus/forge';

// ============================================================================
// Helpers
// ============================================================================

function createTestTask(overrides: Partial<CreateTaskInput> = {}): CreateTaskInput {
    return {
        type: 'custom',
        priority: 'normal' as TaskPriority,
        payload: { data: { prompt: 'test' } },
        config: { timeoutMs: 60000 }, // 60s timeout
        ...overrides,
    };
}

function createMockStore(): ProcessStore {
    const processes = new Map<string, AIProcess>();
    return {
        addProcess: vi.fn(async (proc: AIProcess) => { processes.set(proc.id, proc); }),
        updateProcess: vi.fn(async (id: string, updates: Partial<AIProcess>) => {
            const existing = processes.get(id);
            if (existing) processes.set(id, { ...existing, ...updates } as AIProcess);
        }),
        getProcess: vi.fn(async (id: string) => processes.get(id)),
        getAllProcesses: vi.fn(async () => Array.from(processes.values())),
        removeProcess: vi.fn(async () => {}),
        clearProcesses: vi.fn(async () => 0),
        getWorkspaces: vi.fn(async () => []),
        registerWorkspace: vi.fn(async () => {}),
        removeWorkspace: vi.fn(async () => false),
        updateWorkspace: vi.fn(async () => undefined),
        getWikis: vi.fn(async () => []),
        registerWiki: vi.fn(async () => {}),
        removeWiki: vi.fn(async () => false),
        updateWiki: vi.fn(async () => undefined),
        onProcessOutput: vi.fn(() => () => {}),
        emitProcessOutput: vi.fn(),
        emitProcessComplete: vi.fn(),
        emitProcessEvent: vi.fn(),
    };
}

// ============================================================================
// Tests
// ============================================================================

describe('StaleTaskDetector', () => {
    let queueManager: TaskQueueManager;
    let detector: StaleTaskDetector;
    let mockStore: ProcessStore;

    beforeEach(() => {
        queueManager = createTaskQueueManager();
        mockStore = createMockStore();
    });

    afterEach(() => {
        detector?.dispose();
    });

    describe('timeout semantics across both detection passes', () => {
        beforeEach(() => {
            vi.useFakeTimers();
            vi.setSystemTime(new Date('2026-10-23T12:00:00Z'));
        });

        afterEach(() => {
            vi.useRealTimers();
        });

        it.each([
            { config: { timeoutMs: 0 }, defaultTimeoutMs: 1_000 },
            { config: {}, defaultTimeoutMs: 0 },
        ])('never marks or finalizes an unlimited task ($config, default $defaultTimeoutMs)', async ({ config, defaultTimeoutMs }) => {
            detector = new StaleTaskDetector(queueManager, mockStore, { defaultTimeoutMs });
            const id = queueManager.enqueue(createTestTask({ config }));
            queueManager.markStarted(id);
            const task = queueManager.getTask(id)!;
            task.processId = `queue_${id}`;
            const startedAt = task.startedAt!;

            for (const elapsed of [1, 300_000, 300_001, 24 * 60 * 60_000]) {
                vi.setSystemTime(startedAt + elapsed);
                expect(await detector.detectAndMarkStale()).toBe(0);
                expect(await detector.detectAndFailStale()).toBe(0);
                expect(queueManager.getRunning()).toHaveLength(1);
            }
            expect(mockStore.updateProcess).not.toHaveBeenCalled();
            expect(mockStore.getProcess).not.toHaveBeenCalled();
            expect(mockStore.emitProcessComplete).not.toHaveBeenCalled();

            // Unlimited elapsed time does not disable explicit cancellation.
            expect(queueManager.cancelTask(id)).toBe(true);
            expect(queueManager.getTask(id)?.status).toBe('cancelled');
        });

        it.each([
            { config: { timeoutMs: 1_000 }, timeout: 1_000 },
            { config: {}, timeout: 2_000 },
            { config: undefined, timeout: 2_000 },
        ])('keeps finite deadlines and grace with $config', async ({ config, timeout }) => {
            detector = new StaleTaskDetector(queueManager, mockStore, {
                defaultTimeoutMs: 2_000, gracePeriodMs: 300_000,
            });
            const id = queueManager.enqueue(createTestTask({ config }));
            queueManager.markStarted(id);
            const task = queueManager.getTask(id)!;
            task.processId = `queue_${id}`;
            const startedAt = task.startedAt!;

            vi.setSystemTime(startedAt + timeout);
            expect(await detector.detectAndMarkStale()).toBe(0);
            expect(await detector.detectAndFailStale()).toBe(0);

            vi.setSystemTime(startedAt + timeout + 1);
            expect(await detector.detectAndMarkStale()).toBe(1);
            expect(mockStore.updateProcess).toHaveBeenCalledWith(task.processId, { stale: true });
            expect(await detector.detectAndFailStale()).toBe(0);

            vi.setSystemTime(startedAt + timeout + 300_000);
            expect(await detector.detectAndFailStale()).toBe(0);
            vi.setSystemTime(startedAt + timeout + 300_001);
            expect(await detector.detectAndMarkStale()).toBe(0);
            expect(await detector.detectAndFailStale()).toBe(1);
            expect(queueManager.getTask(id)?.status).toBe('failed');
            expect(mockStore.updateProcess).toHaveBeenCalledWith(task.processId,
                expect.objectContaining({ status: 'failed', error: expect.stringContaining('Task stale') }));
        });
    });

    // ========================================================================
    // detectAndFailStale
    // ========================================================================

    describe('detectAndFailStale', () => {
        it('returns 0 when no running tasks', async () => {
            detector = new StaleTaskDetector(queueManager, mockStore);
            const count = await detector.detectAndFailStale();
            expect(count).toBe(0);
        });

        it('does not fail tasks that are within timeout + grace period', async () => {
            detector = new StaleTaskDetector(queueManager, mockStore, {
                gracePeriodMs: 300000, // 5 min grace
            });

            const id = queueManager.enqueue(createTestTask({ config: { timeoutMs: 60000 } })); // 60s timeout
            queueManager.markStarted(id);

            // Task just started — not stale
            const count = await detector.detectAndFailStale();
            expect(count).toBe(0);
            expect(queueManager.getRunning()).toHaveLength(1);
        });

        it('force-fails tasks that exceed timeout + grace period', async () => {
            detector = new StaleTaskDetector(queueManager, mockStore, {
                gracePeriodMs: 1000, // 1s grace for test speed
            });

            const id = queueManager.enqueue(createTestTask({ config: { timeoutMs: 1000 } })); // 1s timeout
            queueManager.markStarted(id);

            // Manually backdate startedAt to simulate elapsed time
            const task = queueManager.getTask(id)!;
            task.startedAt = Date.now() - 10000; // 10s ago

            const count = await detector.detectAndFailStale();
            expect(count).toBe(1);
            expect(queueManager.getRunning()).toHaveLength(0);
            expect(queueManager.getFailed()).toHaveLength(1);
        });

        it('sets appropriate error message on force-failed tasks', async () => {
            detector = new StaleTaskDetector(queueManager, mockStore, {
                gracePeriodMs: 1000,
            });

            const id = queueManager.enqueue(createTestTask({ config: { timeoutMs: 1000 } }));
            queueManager.markStarted(id);

            const task = queueManager.getTask(id)!;
            task.startedAt = Date.now() - 10000;

            await detector.detectAndFailStale();

            const failedTask = queueManager.getTask(id)!;
            expect(failedTask.error).toContain('Task stale');
            expect(failedTask.error).toContain('exceeded timeout');
        });

        it('updates linked process in store when force-failing', async () => {
            detector = new StaleTaskDetector(queueManager, mockStore, {
                gracePeriodMs: 1000,
            });

            const id = queueManager.enqueue(createTestTask({ config: { timeoutMs: 1000 } }));
            queueManager.markStarted(id);

            // Set a processId on the task
            const task = queueManager.getTask(id)!;
            task.processId = 'queue_' + id;
            task.startedAt = Date.now() - 10000;

            await detector.detectAndFailStale();

            expect(mockStore.updateProcess).toHaveBeenCalledWith(
                'queue_' + id,
                expect.objectContaining({
                    status: 'failed',
                    error: expect.stringContaining('Task stale'),
                })
            );
        });

        it('handles multiple stale tasks', async () => {
            detector = new StaleTaskDetector(queueManager, mockStore, {
                gracePeriodMs: 1000,
            });

            const id1 = queueManager.enqueue(createTestTask({ config: { timeoutMs: 1000 } }));
            const id2 = queueManager.enqueue(createTestTask({ config: { timeoutMs: 1000 } }));
            const id3 = queueManager.enqueue(createTestTask({ config: { timeoutMs: 60000 } })); // long timeout
            queueManager.markStarted(id1);
            queueManager.markStarted(id2);
            queueManager.markStarted(id3);

            // Backdate the first two
            queueManager.getTask(id1)!.startedAt = Date.now() - 10000;
            queueManager.getTask(id2)!.startedAt = Date.now() - 10000;

            const count = await detector.detectAndFailStale();
            expect(count).toBe(2);
            expect(queueManager.getRunning()).toHaveLength(1); // id3 still running
            expect(queueManager.getFailed()).toHaveLength(2);
        });

        it('uses default timeout when task has no configured timeout', async () => {
            detector = new StaleTaskDetector(queueManager, mockStore, {
                gracePeriodMs: 1000,
                defaultTimeoutMs: 2000, // 2s default
            });

            const id = queueManager.enqueue(createTestTask({ config: {} })); // no timeoutMs
            queueManager.markStarted(id);

            queueManager.getTask(id)!.startedAt = Date.now() - 10000;

            const count = await detector.detectAndFailStale();
            expect(count).toBe(1);
        });

        it('skips tasks without startedAt', async () => {
            detector = new StaleTaskDetector(queueManager, mockStore, {
                gracePeriodMs: 1000,
            });

            const id = queueManager.enqueue(createTestTask({ config: { timeoutMs: 1000 } }));
            queueManager.markStarted(id);

            // Remove startedAt to simulate edge case
            queueManager.getTask(id)!.startedAt = undefined;

            const count = await detector.detectAndFailStale();
            expect(count).toBe(0);
        });

        it('works without a store', async () => {
            detector = new StaleTaskDetector(queueManager, undefined, {
                gracePeriodMs: 1000,
            });

            const id = queueManager.enqueue(createTestTask({ config: { timeoutMs: 1000 } }));
            queueManager.markStarted(id);
            queueManager.getTask(id)!.startedAt = Date.now() - 10000;

            const count = await detector.detectAndFailStale();
            expect(count).toBe(1);
            expect(queueManager.getFailed()).toHaveLength(1);
        });
    });

    // ========================================================================
    // start / stop / dispose
    // ========================================================================

    describe('lifecycle', () => {
        it('start begins periodic detection', async () => {
            vi.useFakeTimers();
            try {
                detector = new StaleTaskDetector(queueManager, mockStore, {
                    checkIntervalMs: 100,
                    gracePeriodMs: 1000,
                });

                const id = queueManager.enqueue(createTestTask({ config: { timeoutMs: 1000 } }));
                queueManager.markStarted(id);
                queueManager.getTask(id)!.startedAt = Date.now() - 10000;

                detector.start();

                // Advance past the check interval
                await vi.advanceTimersByTimeAsync(150);

                expect(queueManager.getFailed()).toHaveLength(1);
            } finally {
                vi.useRealTimers();
            }
        });

        it('stop stops periodic detection', () => {
            vi.useFakeTimers();
            try {
                detector = new StaleTaskDetector(queueManager, mockStore, {
                    checkIntervalMs: 100,
                    gracePeriodMs: 1000,
                });

                detector.start();
                detector.stop();

                const id = queueManager.enqueue(createTestTask({ config: { timeoutMs: 1000 } }));
                queueManager.markStarted(id);
                queueManager.getTask(id)!.startedAt = Date.now() - 10000;

                vi.advanceTimersByTime(200);

                // Task should NOT be failed since detector was stopped
                expect(queueManager.getRunning()).toHaveLength(1);
            } finally {
                vi.useRealTimers();
            }
        });

        it('dispose stops the timer', () => {
            detector = new StaleTaskDetector(queueManager, mockStore, {
                checkIntervalMs: 100,
            });

            detector.start();
            detector.dispose();

            // Should not throw or leave dangling timers
        });

        it('start is idempotent', () => {
            detector = new StaleTaskDetector(queueManager, mockStore, {
                checkIntervalMs: 100,
            });

            detector.start();
            detector.start(); // Should not start a second timer
            detector.dispose();
        });
    });
});
