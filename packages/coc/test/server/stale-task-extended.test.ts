/**
 * Stale Task Detector Extended Tests
 *
 * Covers Section 9 of test-plan-schedule-system.md:
 * Extends stale-task-detector.test.ts with additional edge cases and the new
 * detectAndMarkStale() soft-stale marking feature.
 *
 * Key additions:
 * - detectAndMarkStale() marks tasks stale in store after taskTimeout but before grace
 * - Tasks with status done/failed → NOT marked stale (only running tasks)
 * - Stale task marked in store includes stale: true on process record
 * - detectAndFailStale() force-fails at taskTimeout + gracePeriod (existing behaviour)
 *
 * Note: WebSocket process-updated events on stale marking require wsServer
 * injection into StaleTaskDetector, which is not yet implemented. That test
 * is marked TODO below.
 *
 * Cross-platform compatible (Linux/Mac/Windows).
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { StaleTaskDetector } from '../../src/server/stale-task-detector';
import { TaskQueueManager, createTaskQueueManager } from '@plusplusoneplusplus/forge';
import type { CreateTaskInput, TaskPriority, ProcessStore, AIProcess } from '@plusplusoneplusplus/forge';

// ============================================================================
// Helpers (mirrors stale-task-detector.test.ts)
// ============================================================================

function createTestTask(overrides: Partial<CreateTaskInput> = {}): CreateTaskInput {
    return {
        type: 'custom',
        priority: 'normal' as TaskPriority,
        payload: { data: { prompt: 'test' } },
        config: { timeoutMs: 60000 },
        ...overrides,
    };
}

function createMockStore(): ProcessStore & { getUpdates: () => Array<{ id: string; updates: Partial<AIProcess> }> } {
    const processes = new Map<string, AIProcess>();
    const updates: Array<{ id: string; updates: Partial<AIProcess> }> = [];

    const store: any = {
        addProcess: vi.fn(async (proc: AIProcess) => { processes.set(proc.id, proc); }),
        updateProcess: vi.fn(async (id: string, upd: Partial<AIProcess>) => {
            updates.push({ id, updates: upd });
            const existing = processes.get(id);
            if (existing) processes.set(id, { ...existing, ...upd } as AIProcess);
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
        getUpdates: () => updates,
    };
    return store;
}

// ============================================================================
// Extended tests: detectAndMarkStale
// ============================================================================

describe('StaleTaskDetector.detectAndMarkStale (new)', () => {
    let queueManager: TaskQueueManager;
    let detector: StaleTaskDetector;
    let mockStore: ReturnType<typeof createMockStore>;

    beforeEach(() => {
        queueManager = createTaskQueueManager();
        mockStore = createMockStore();
    });

    afterEach(() => {
        detector?.dispose();
    });

    it('returns 0 when no running tasks', async () => {
        detector = new StaleTaskDetector(queueManager, mockStore);
        const count = await detector.detectAndMarkStale();
        expect(count).toBe(0);
    });

    it('marks task stale in store when elapsed > taskTimeout but within grace period', async () => {
        detector = new StaleTaskDetector(queueManager, mockStore, {
            gracePeriodMs: 60_000, // 1 minute grace
        });

        const id = queueManager.enqueue(createTestTask({ config: { timeoutMs: 1000 } }));
        queueManager.markStarted(id);

        const task = queueManager.getTask(id)!;
        task.processId = `queue_${id}`;
        // Elapsed = 5s — past timeout (1s) but within grace (1s + 60s = 61s)
        task.startedAt = Date.now() - 5_000;

        const count = await detector.detectAndMarkStale();
        expect(count).toBe(1);

        // Store should be updated with stale: true
        const staleUpdates = mockStore.getUpdates().filter(u => u.updates.stale === true);
        expect(staleUpdates).toHaveLength(1);
        expect(staleUpdates[0].id).toBe(`queue_${id}`);
    });

    it('does NOT mark task stale when elapsed <= taskTimeout', async () => {
        detector = new StaleTaskDetector(queueManager, mockStore, {
            gracePeriodMs: 60_000,
        });

        const id = queueManager.enqueue(createTestTask({ config: { timeoutMs: 60_000 } }));
        queueManager.markStarted(id);
        // Just started — not stale
        queueManager.getTask(id)!.startedAt = Date.now();

        const count = await detector.detectAndMarkStale();
        expect(count).toBe(0);
        expect(mockStore.getUpdates().filter(u => u.updates.stale === true)).toHaveLength(0);
    });

    it('does NOT mark task stale when elapsed > staleThreshold (force-fail threshold)', async () => {
        detector = new StaleTaskDetector(queueManager, mockStore, {
            gracePeriodMs: 1000, // small grace
        });

        const id = queueManager.enqueue(createTestTask({ config: { timeoutMs: 1000 } }));
        queueManager.markStarted(id);
        // Elapsed = 10s, staleThreshold = 1s + 1s = 2s → already past grace period
        queueManager.getTask(id)!.startedAt = Date.now() - 10_000;

        const count = await detector.detectAndMarkStale();
        // Task is beyond grace period, not in the "soft stale" window
        expect(count).toBe(0);
        expect(mockStore.getUpdates().filter(u => u.updates.stale === true)).toHaveLength(0);
    });

    it('does not call store.updateProcess if no processId on task', async () => {
        detector = new StaleTaskDetector(queueManager, mockStore, {
            gracePeriodMs: 60_000,
        });

        const id = queueManager.enqueue(createTestTask({ config: { timeoutMs: 1000 } }));
        queueManager.markStarted(id);
        const task = queueManager.getTask(id)!;
        task.processId = undefined; // no process ID
        task.startedAt = Date.now() - 5_000;

        const count = await detector.detectAndMarkStale();
        // Count still increments but store is not called
        expect(count).toBe(1);
        expect(mockStore.updateProcess).not.toHaveBeenCalled();
    });

    it('marks multiple tasks stale independently', async () => {
        detector = new StaleTaskDetector(queueManager, mockStore, {
            gracePeriodMs: 60_000,
        });

        const id1 = queueManager.enqueue(createTestTask({ config: { timeoutMs: 1000 } }));
        const id2 = queueManager.enqueue(createTestTask({ config: { timeoutMs: 1000 } }));
        const id3 = queueManager.enqueue(createTestTask({ config: { timeoutMs: 60_000 } })); // still ok

        queueManager.markStarted(id1);
        queueManager.markStarted(id2);
        queueManager.markStarted(id3);

        const task1 = queueManager.getTask(id1)!;
        const task2 = queueManager.getTask(id2)!;
        const task3 = queueManager.getTask(id3)!;

        task1.processId = `queue_${id1}`;
        task2.processId = `queue_${id2}`;
        task3.processId = `queue_${id3}`;

        // Backdate first two past timeout but within grace
        task1.startedAt = Date.now() - 5_000;
        task2.startedAt = Date.now() - 5_000;
        task3.startedAt = Date.now(); // just started

        const count = await detector.detectAndMarkStale();
        expect(count).toBe(2);
        const staleUpdates = mockStore.getUpdates().filter(u => u.updates.stale === true);
        expect(staleUpdates).toHaveLength(2);
    });

    it('works without a store (no-op store call)', async () => {
        detector = new StaleTaskDetector(queueManager, undefined, {
            gracePeriodMs: 60_000,
        });

        const id = queueManager.enqueue(createTestTask({ config: { timeoutMs: 1000 } }));
        queueManager.markStarted(id);
        queueManager.getTask(id)!.startedAt = Date.now() - 5_000;

        // Should not throw
        const count = await detector.detectAndMarkStale();
        expect(count).toBe(1);
    });

    it('skips tasks without startedAt', async () => {
        detector = new StaleTaskDetector(queueManager, mockStore, {
            gracePeriodMs: 60_000,
        });

        const id = queueManager.enqueue(createTestTask({ config: { timeoutMs: 1000 } }));
        queueManager.markStarted(id);
        queueManager.getTask(id)!.startedAt = undefined;

        const count = await detector.detectAndMarkStale();
        expect(count).toBe(0);
    });
});

// ============================================================================
// Extended tests: existing detectAndFailStale — additional edge cases
// ============================================================================

describe('StaleTaskDetector.detectAndFailStale (extended edge cases)', () => {
    let queueManager: TaskQueueManager;
    let detector: StaleTaskDetector;
    let mockStore: ReturnType<typeof createMockStore>;

    beforeEach(() => {
        queueManager = createTaskQueueManager();
        mockStore = createMockStore();
    });

    afterEach(() => {
        detector?.dispose();
    });

    it('completed tasks are NOT force-failed (only running tasks checked)', async () => {
        detector = new StaleTaskDetector(queueManager, mockStore, { gracePeriodMs: 1000 });

        const id = queueManager.enqueue(createTestTask({ config: { timeoutMs: 1000 } }));
        queueManager.markStarted(id);
        queueManager.getTask(id)!.startedAt = Date.now() - 10_000;

        // Complete the task before detection
        queueManager.markCompleted(id, 'done');

        const count = await detector.detectAndFailStale();
        // Completed tasks are not in getRunning(), so nothing fails
        expect(count).toBe(0);
    });

    it('failed tasks are NOT force-failed again (already in failed state)', async () => {
        detector = new StaleTaskDetector(queueManager, mockStore, { gracePeriodMs: 1000 });

        const id = queueManager.enqueue(createTestTask({ config: { timeoutMs: 1000 } }));
        queueManager.markStarted(id);
        queueManager.forceFailTask(id, 'manual failure');

        // Now the task is failed, not running
        const count = await detector.detectAndFailStale();
        expect(count).toBe(0);
    });

    it('periodic detection fires at configured interval', async () => {
        vi.useFakeTimers();
        try {
            let detectionCount = 0;
            detector = new StaleTaskDetector(queueManager, mockStore, {
                checkIntervalMs: 100,
                gracePeriodMs: 1000,
            });

            // Spy on detectAndFailStale to count invocations
            const originalDetect = detector.detectAndFailStale.bind(detector);
            vi.spyOn(detector, 'detectAndFailStale').mockImplementation(async () => {
                detectionCount++;
                return originalDetect();
            });

            detector.start();

            await vi.advanceTimersByTimeAsync(350);
            expect(detectionCount).toBeGreaterThanOrEqual(3);
        } finally {
            vi.useRealTimers();
        }
    });

    it('force-failed task is removed from running list', async () => {
        detector = new StaleTaskDetector(queueManager, mockStore, { gracePeriodMs: 1000 });

        const id = queueManager.enqueue(createTestTask({ config: { timeoutMs: 1000 } }));
        queueManager.markStarted(id);
        queueManager.getTask(id)!.startedAt = Date.now() - 10_000;

        await detector.detectAndFailStale();

        expect(queueManager.getRunning()).toHaveLength(0);
        expect(queueManager.getFailed()).toHaveLength(1);
    });

    it('store.updateProcess called with status failed for stale task', async () => {
        detector = new StaleTaskDetector(queueManager, mockStore, { gracePeriodMs: 1000 });

        const id = queueManager.enqueue(createTestTask({ config: { timeoutMs: 1000 } }));
        queueManager.markStarted(id);

        const task = queueManager.getTask(id)!;
        task.processId = `queue_${id}`;
        task.startedAt = Date.now() - 10_000;

        await detector.detectAndFailStale();

        expect(mockStore.updateProcess).toHaveBeenCalledWith(
            `queue_${id}`,
            expect.objectContaining({ status: 'failed' })
        );
    });
});

// ============================================================================
// TODO tests — require additional infrastructure
// ============================================================================

describe('StaleTaskDetector — TODO / pending features', () => {
    it.todo('stale task continues receiving SSE events (not killed by detector) — requires SSE integration test');
    it.todo('GET /api/processes/:id for stale task includes stale: true field — requires HTTP server integration');
    it.todo('GET /api/processes response includes stale field for stale tasks — requires HTTP server integration');
    it.todo('stale detection sends process-updated WebSocket event — requires wsServer injection into StaleTaskDetector');
    it.todo('task completes after being marked stale → stale: false cleared on completion — requires executor integration');
});
