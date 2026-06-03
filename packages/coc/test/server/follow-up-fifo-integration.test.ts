/**
 * Follow-Up FIFO Integration Tests
 *
 * Validates end-to-end FIFO ordering of queued follow-ups across the
 * composition of three subsystems:
 *   1. API buffering (pendingMessages append order)
 *   2. Lifecycle runner drain callback (one-at-a-time after completion)
 *   3. Bridge requeueForFollowUp (dequeue head, requeue as follow-up task)
 *
 * These tests use the real CLITaskExecutor (queue-executor-bridge) with a
 * mock process store and mock SDK service, so they exercise the actual
 * drainPendingMessages → requeueForFollowUp composition without HTTP overhead.
 *
 * Workstreams covered (from the plan):
 *   1. Server orchestration FIFO test
 *   2. Repeated-drain one-at-a-time test
 *   3. Mixed enqueue + immediate interaction tests (drain side)
 *   4. Metadata preservation through drain/requeue
 *   5. Failure-path queue integrity
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('fs', async (importOriginal) => {
    const actual = await importOriginal<typeof import('fs')>();
    return {
        ...actual,
        existsSync: vi.fn(actual.existsSync),
        readFileSync: vi.fn(actual.readFileSync),
        mkdirSync: vi.fn(),
    };
});

import type { QueuedTask, TaskQueueManager } from '@plusplusoneplusplus/forge';
import { CLITaskExecutor } from '../../src/server/queue/queue-executor-bridge';
import { createMockSDKService } from '../helpers/mock-sdk-service';
import { createMockProcessStore, createCompletedProcessWithSession } from '../helpers/mock-process-store';
import type { PendingMessage } from '@plusplusoneplusplus/forge';

// ============================================================================
// Mock CopilotSDKService
// ============================================================================

const sdkMocks = createMockSDKService();

vi.mock('@plusplusoneplusplus/forge', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@plusplusoneplusplus/forge')>();
    return {
        ...actual,
        sdkServiceRegistry: { getOrThrow: () => sdkMocks.service },
    };
});

vi.mock('../../src/ai-invoker', () => ({
    createCLIAIInvoker: vi.fn().mockReturnValue(vi.fn()),
}));

vi.mock('../../src/server/core/image-utils', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../../src/server/core/image-utils')>();
    return { ...actual, cleanupTempDir: vi.fn() };
});
vi.mock('../../src/server/queue/image-blob-store', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../../src/server/queue/image-blob-store')>();
    return {
        ...actual,
        ImageBlobStore: {
            loadImages: vi.fn().mockResolvedValue([]),
            saveImages: vi.fn(),
            deleteImages: vi.fn(),
            getBlobsDir: vi.fn(),
        },
    };
});

// ============================================================================
// Helpers
// ============================================================================

function makePendingMessage(content: string, mode?: string): PendingMessage {
    return {
        id: `pm-${content.replace(/\s+/g, '-').toLowerCase()}`,
        content,
        ...(mode ? { mode } : {}),
        createdAt: new Date().toISOString(),
    };
}

function followUpTask(overrides: { processId: string; content: string } & Partial<QueuedTask>): QueuedTask {
    return {
        id: overrides.id ?? 'fu-task-1',
        type: 'chat',
        priority: 'normal',
        status: 'running',
        createdAt: Date.now(),
        payload: {
            kind: 'chat',
            processId: overrides.processId,
            prompt: overrides.content,
        },
        config: {},
        displayName: overrides.displayName ?? overrides.content,
        ...overrides,
    } as QueuedTask;
}

interface MockQueueManager extends Record<string, any> {
    /** Expose the backing map so tests can pre-register tasks */
    tasks: Map<string, QueuedTask>;
    enqueue: ReturnType<typeof vi.fn>;
    getTask: ReturnType<typeof vi.fn>;
    updateTask: ReturnType<typeof vi.fn>;
    requeueFromHistory: ReturnType<typeof vi.fn>;
}

function createMockQueueManager(): MockQueueManager {
    const tasks = new Map<string, QueuedTask>();
    return {
        tasks,
        enqueue: vi.fn((task: QueuedTask) => { tasks.set(task.id, task); return task.id; }),
        getTask: vi.fn((id: string) => tasks.get(id)),
        updateTask: vi.fn((id: string, updates: Partial<QueuedTask>) => {
            const existing = tasks.get(id);
            if (existing) { tasks.set(id, { ...existing, ...updates }); }
        }),
        reActivate: vi.fn(),
        requeueFromHistory: vi.fn().mockReturnValue(true),
        returnToHistory: vi.fn(),
        markCompleted: vi.fn(),
        getTasks: vi.fn(() => Array.from(tasks.values())),
        getHistory: vi.fn(() => []),
        on: vi.fn(),
        off: vi.fn(),
    } as MockQueueManager;
}

/** Collect the drained message prompts from enqueue calls (via drainPendingMessages) */
function drainedPrompts(qm: MockQueueManager): string[] {
    return qm.enqueue.mock.calls.map((call: any[]) => call[0]?.payload?.prompt).filter(Boolean);
}

// ============================================================================
// 1. Server orchestration FIFO test
// ============================================================================

describe('Follow-up FIFO — server orchestration', () => {
    let store: ReturnType<typeof createMockProcessStore>;
    let executor: CLITaskExecutor;
    let queueManager: MockQueueManager;

    beforeEach(() => {
        vi.clearAllMocks();
        store = createMockProcessStore();
        sdkMocks.resetAll();
        sdkMocks.mockIsAvailable.mockResolvedValue({ available: true });
        executor = new CLITaskExecutor(store, { aiService: sdkMocks.service });
        queueManager = createMockQueueManager();
        executor.setQueueManager(queueManager as any);
    });

    it('drains message A before message B across successive completions', async () => {
        const proc = createCompletedProcessWithSession('proc-1', 'sess-1');
        proc.pendingMessages = [
            makePendingMessage('Message A'),
            makePendingMessage('Message B'),
        ];
        await store.addProcess(proc);

        // First follow-up task executes and completes → drains Message A
        const task1 = followUpTask({ processId: 'proc-1', content: 'initial follow-up' });
        queueManager.tasks.set(task1.id, task1);
        await executor.execute(task1);

        // After first completion: Message A drained, Message B remains
        const afterFirst = await store.getProcess('proc-1');
        expect(afterFirst?.pendingMessages).toHaveLength(1);
        expect(afterFirst?.pendingMessages![0].content).toBe('Message B');

        // drainPendingMessages enqueued a follow-up for the first drain
        expect(queueManager.enqueue).toHaveBeenCalledTimes(1);
        expect(drainedPrompts(queueManager)).toEqual(['Message A']);

        // Second follow-up completes → drains Message B
        const task2 = followUpTask({ id: 'fu-task-2', processId: 'proc-1', content: 'Message A execution' });
        queueManager.tasks.set(task2.id, task2);
        queueManager.enqueue.mockClear();

        await executor.execute(task2);

        const afterSecond = await store.getProcess('proc-1');
        expect(afterSecond?.pendingMessages).toHaveLength(0);
        expect(drainedPrompts(queueManager)).toEqual(['Message B']);
        expect(queueManager.enqueue).toHaveBeenCalledTimes(1);
    });

    it('pendingMessages length transitions 2 → 1 → 0 across drains', async () => {
        const proc = createCompletedProcessWithSession('proc-2', 'sess-2');
        proc.pendingMessages = [
            makePendingMessage('First'),
            makePendingMessage('Second'),
        ];
        await store.addProcess(proc);

        expect((await store.getProcess('proc-2'))?.pendingMessages).toHaveLength(2);

        const t1 = followUpTask({ id: 'fu-t1', processId: 'proc-2', content: 'trigger' });
        queueManager.tasks.set(t1.id, t1);
        await executor.execute(t1);
        expect((await store.getProcess('proc-2'))?.pendingMessages).toHaveLength(1);

        const t2 = followUpTask({ id: 'fu-t2', processId: 'proc-2', content: 'trigger2' });
        queueManager.tasks.set(t2.id, t2);
        await executor.execute(t2);
        expect((await store.getProcess('proc-2'))?.pendingMessages).toHaveLength(0);
    });

    it('does not drain when there are no pending messages', async () => {
        const proc = createCompletedProcessWithSession('proc-3', 'sess-3');
        await store.addProcess(proc);

        const task = followUpTask({ processId: 'proc-3', content: 'trigger' });
        queueManager.tasks.set(task.id, task);
        await executor.execute(task);

        // No drain activity
        expect(queueManager.enqueue).not.toHaveBeenCalled();
        expect(drainedPrompts(queueManager)).toEqual([]);
    });
});

// ============================================================================
// 2. Repeated-drain one-at-a-time test
// ============================================================================

describe('Follow-up FIFO — repeated drain one-at-a-time', () => {
    let store: ReturnType<typeof createMockProcessStore>;
    let executor: CLITaskExecutor;
    let queueManager: MockQueueManager;

    beforeEach(() => {
        vi.clearAllMocks();
        store = createMockProcessStore();
        sdkMocks.resetAll();
        sdkMocks.mockIsAvailable.mockResolvedValue({ available: true });
        executor = new CLITaskExecutor(store, { aiService: sdkMocks.service });
        queueManager = createMockQueueManager();
        executor.setQueueManager(queueManager as any);
    });

    it('drains exactly one item per completion across three messages', async () => {
        const proc = createCompletedProcessWithSession('proc-drain', 'sess-drain');
        proc.pendingMessages = [
            makePendingMessage('Alpha'),
            makePendingMessage('Bravo'),
            makePendingMessage('Charlie'),
        ];
        await store.addProcess(proc);

        // First completion → drain Alpha
        const t1 = followUpTask({ id: 'dt-1', processId: 'proc-drain', content: 'trigger1' });
        queueManager.tasks.set(t1.id, t1);
        await executor.execute(t1);

        let remaining = await store.getProcess('proc-drain');
        expect(remaining?.pendingMessages).toHaveLength(2);

        // Second completion → drain Bravo
        const t2 = followUpTask({ id: 'dt-2', processId: 'proc-drain', content: 'trigger2' });
        queueManager.tasks.set(t2.id, t2);
        await executor.execute(t2);

        remaining = await store.getProcess('proc-drain');
        expect(remaining?.pendingMessages).toHaveLength(1);

        // Third completion → drain Charlie
        const t3 = followUpTask({ id: 'dt-3', processId: 'proc-drain', content: 'trigger3' });
        queueManager.tasks.set(t3.id, t3);
        await executor.execute(t3);

        remaining = await store.getProcess('proc-drain');
        expect(remaining?.pendingMessages).toHaveLength(0);

        // FIFO order must be stable
        expect(drainedPrompts(queueManager)).toEqual(['Alpha', 'Bravo', 'Charlie']);
    });

    it('later items are untouched until prior drained items complete', async () => {
        const proc = createCompletedProcessWithSession('proc-touch', 'sess-touch');
        proc.pendingMessages = [
            makePendingMessage('X'),
            makePendingMessage('Y'),
            makePendingMessage('Z'),
        ];
        await store.addProcess(proc);

        // After one drain, Y and Z should remain untouched in original order
        const t = followUpTask({ id: 'tt-1', processId: 'proc-touch', content: 'trigger' });
        queueManager.tasks.set(t.id, t);
        await executor.execute(t);

        const after = await store.getProcess('proc-touch');
        expect(after?.pendingMessages).toHaveLength(2);
        expect(after?.pendingMessages![0].content).toBe('Y');
        expect(after?.pendingMessages![1].content).toBe('Z');
        // Their IDs should be preserved exactly
        expect(after?.pendingMessages![0].id).toBe('pm-y');
        expect(after?.pendingMessages![1].id).toBe('pm-z');
    });
});

// ============================================================================
// 3. Mixed enqueue + immediate interaction tests (drain side)
// ============================================================================

describe('Follow-up FIFO — mixed delivery mode interactions', () => {
    let store: ReturnType<typeof createMockProcessStore>;
    let executor: CLITaskExecutor;
    let queueManager: MockQueueManager;

    beforeEach(() => {
        vi.clearAllMocks();
        store = createMockProcessStore();
        sdkMocks.resetAll();
        sdkMocks.mockIsAvailable.mockResolvedValue({ available: true });
        executor = new CLITaskExecutor(store, { aiService: sdkMocks.service });
        queueManager = createMockQueueManager();
        executor.setQueueManager(queueManager as any);
    });

    it('drain processes enqueue items without affecting immediate steering', async () => {
        const proc = createCompletedProcessWithSession('proc-mixed', 'sess-mixed');
        proc.pendingMessages = [
            makePendingMessage('Queued A'),
            makePendingMessage('Queued B'),
        ];
        await store.addProcess(proc);

        const task = followUpTask({ processId: 'proc-mixed', content: 'current execution' });
        queueManager.tasks.set(task.id, task);
        await executor.execute(task);

        // Drain only dequeues head (Queued A); Queued B remains
        const after = await store.getProcess('proc-mixed');
        expect(after?.pendingMessages).toHaveLength(1);
        expect(after?.pendingMessages![0].content).toBe('Queued B');
        expect(drainedPrompts(queueManager)).toEqual(['Queued A']);
    });

    it('mode from queued message is forwarded through drain → requeue', async () => {
        const proc = createCompletedProcessWithSession('proc-mode', 'sess-mode');
        proc.pendingMessages = [
            makePendingMessage('Switch to plan', 'plan'),
            makePendingMessage('Then autopilot', 'autopilot'),
        ];
        await store.addProcess(proc);

        // First drain → legacy plan mode normalized to ask
        const t1 = followUpTask({ id: 'mode-t1', processId: 'proc-mode', content: 'trigger' });
        queueManager.tasks.set(t1.id, t1);
        await executor.execute(t1);
        const firstCall = queueManager.enqueue.mock.calls[0];
        expect(firstCall[0].payload.mode).toBe('ask');

        // Second drain → autopilot mode
        const t2 = followUpTask({ id: 'mode-t2', processId: 'proc-mode', content: 'trigger2' });
        queueManager.tasks.set(t2.id, t2);
        queueManager.enqueue.mockClear();
        await executor.execute(t2);
        const secondCall = queueManager.enqueue.mock.calls[0];
        expect(secondCall[0].payload.mode).toBe('autopilot');
    });
});

// ============================================================================
// 4. Metadata preservation through drain/requeue
// ============================================================================

describe('Follow-up FIFO — metadata preservation', () => {
    let store: ReturnType<typeof createMockProcessStore>;
    let executor: CLITaskExecutor;
    let queueManager: MockQueueManager;

    beforeEach(() => {
        vi.clearAllMocks();
        store = createMockProcessStore();
        sdkMocks.resetAll();
        sdkMocks.mockIsAvailable.mockResolvedValue({ available: true });
        executor = new CLITaskExecutor(store, { aiService: sdkMocks.service });
        queueManager = createMockQueueManager();
        executor.setQueueManager(queueManager as any);
    });

    it('preserves content exactly through the drain path', async () => {
        const longContent = 'This is a multi-line message\nwith special chars: <>&"\'';
        const proc = createCompletedProcessWithSession('proc-meta', 'sess-meta');
        proc.pendingMessages = [makePendingMessage(longContent)];
        await store.addProcess(proc);

        const task = followUpTask({ processId: 'proc-meta', content: 'trigger' });
        queueManager.tasks.set(task.id, task);
        await executor.execute(task);

        expect(drainedPrompts(queueManager)).toEqual([longContent]);
    });

    it('preserves mode through drain → requeue', async () => {
        const proc = createCompletedProcessWithSession('proc-meta-mode', 'sess-meta-mode');
        proc.pendingMessages = [makePendingMessage('msg with mode', 'autopilot')];
        await store.addProcess(proc);

        const task = followUpTask({ processId: 'proc-meta-mode', content: 'trigger' });
        queueManager.tasks.set(task.id, task);
        await executor.execute(task);

        const enqueueCall = queueManager.enqueue.mock.calls[0];
        expect(enqueueCall[0].payload.mode).toBe('autopilot');
    });

    it('handles messages without mode gracefully', async () => {
        const proc = createCompletedProcessWithSession('proc-no-mode', 'sess-no-mode');
        proc.pendingMessages = [makePendingMessage('no mode msg')];
        await store.addProcess(proc);

        const task = followUpTask({ processId: 'proc-no-mode', content: 'trigger' });
        queueManager.tasks.set(task.id, task);
        await executor.execute(task);

        expect(drainedPrompts(queueManager)).toEqual(['no mode msg']);
        // mode should not be set when the pending message had none
        const enqueueCall = queueManager.enqueue.mock.calls[0];
        expect(enqueueCall[0].payload.mode).toBeUndefined();
    });

    it('pending message id and createdAt do not leak into requeued task payload', async () => {
        const proc = createCompletedProcessWithSession('proc-noleak', 'sess-noleak');
        proc.pendingMessages = [makePendingMessage('leak check')];
        await store.addProcess(proc);

        const task = followUpTask({ processId: 'proc-noleak', content: 'trigger' });
        queueManager.tasks.set(task.id, task);
        await executor.execute(task);

        const enqueueCall = queueManager.enqueue.mock.calls[0];
        // The enqueued payload should not contain the PendingMessage-specific fields
        expect(enqueueCall[0].payload.id).toBeUndefined();
        expect(enqueueCall[0].payload.createdAt).toBeUndefined();
    });

    it('displayName of requeued task is derived from pending message content', async () => {
        const proc = createCompletedProcessWithSession('proc-dn', 'sess-dn');
        proc.pendingMessages = [makePendingMessage('Short prompt')];
        await store.addProcess(proc);

        const task = followUpTask({ processId: 'proc-dn', content: 'trigger' });
        queueManager.tasks.set(task.id, task);
        await executor.execute(task);

        const enqueueCall = queueManager.enqueue.mock.calls[0];
        expect(enqueueCall[0].displayName).toBe('Short prompt');
    });

    it('truncates long displayName at 60 chars', async () => {
        const longPrompt = 'A'.repeat(100);
        const proc = createCompletedProcessWithSession('proc-long-dn', 'sess-long-dn');
        proc.pendingMessages = [makePendingMessage(longPrompt)];
        await store.addProcess(proc);

        const task = followUpTask({ processId: 'proc-long-dn', content: 'trigger' });
        queueManager.tasks.set(task.id, task);
        await executor.execute(task);

        const enqueueCall = queueManager.enqueue.mock.calls[0];
        expect(enqueueCall[0].displayName.length).toBeLessThanOrEqual(60);
        expect(enqueueCall[0].displayName).toContain('...');
    });
});

// ============================================================================
// 5. Failure-path queue integrity
// ============================================================================

describe('Follow-up FIFO — failure-path queue integrity', () => {
    let store: ReturnType<typeof createMockProcessStore>;
    let executor: CLITaskExecutor;
    let queueManager: MockQueueManager;

    beforeEach(() => {
        vi.clearAllMocks();
        store = createMockProcessStore();
        sdkMocks.resetAll();
        sdkMocks.mockIsAvailable.mockResolvedValue({ available: true });
        executor = new CLITaskExecutor(store, { aiService: sdkMocks.service });
        queueManager = createMockQueueManager();
        executor.setQueueManager(queueManager as any);
    });

    it('does not drain pending messages when the follow-up execution fails', async () => {
        const proc = createCompletedProcessWithSession('proc-fail', 'sess-fail');
        proc.pendingMessages = [
            makePendingMessage('Should stay A'),
            makePendingMessage('Should stay B'),
        ];
        await store.addProcess(proc);

        // Make the follow-up execution fail
        const spy = vi.spyOn(CLITaskExecutor.prototype as any, 'executeFollowUp');
        spy.mockRejectedValue(new Error('AI error'));

        const task = followUpTask({ processId: 'proc-fail', content: 'failing execution' });
        queueManager.tasks.set(task.id, task);
        const result = await executor.execute(task);

        expect(result.success).toBe(false);
        // Pending messages should be untouched
        const after = await store.getProcess('proc-fail');
        expect(after?.pendingMessages).toHaveLength(2);
        expect(after?.pendingMessages![0].content).toBe('Should stay A');
        expect(after?.pendingMessages![1].content).toBe('Should stay B');

        // No drain activity (no enqueue from drain path)
        expect(queueManager.enqueue).not.toHaveBeenCalled();
        expect(drainedPrompts(queueManager)).toEqual([]);

        spy.mockRestore();
    });

    it('does not drain pending messages when the follow-up task is cancelled', async () => {
        const proc = createCompletedProcessWithSession('proc-cancel', 'sess-cancel');
        proc.status = 'running';
        proc.pendingMessages = [
            makePendingMessage('Preserved A'),
            makePendingMessage('Preserved B'),
        ];
        await store.addProcess(proc);

        const task = followUpTask({ processId: 'proc-cancel', content: 'cancelled exec' });
        queueManager.tasks.set(task.id, task);
        executor.cancel(task.id);
        const result = await executor.execute(task);

        expect(result.success).toBe(false);
        // Pending messages remain
        const after = await store.getProcess('proc-cancel');
        expect(after?.pendingMessages).toHaveLength(2);
        expect(queueManager.enqueue).not.toHaveBeenCalled();
    });

    it('successful drain after a prior failure preserves remaining queue order', async () => {
        const proc = createCompletedProcessWithSession('proc-recover', 'sess-recover');
        proc.pendingMessages = [
            makePendingMessage('Queued 1'),
            makePendingMessage('Queued 2'),
            makePendingMessage('Queued 3'),
        ];
        await store.addProcess(proc);

        // First execution fails → no drain
        const spy = vi.spyOn(CLITaskExecutor.prototype as any, 'executeFollowUp');
        spy.mockRejectedValueOnce(new Error('temporary failure'));

        const task1 = followUpTask({ id: 'rec-1', processId: 'proc-recover', content: 'fail trigger' });
        queueManager.tasks.set(task1.id, task1);
        await executor.execute(task1);

        expect((await store.getProcess('proc-recover'))?.pendingMessages).toHaveLength(3);
        expect(queueManager.enqueue).not.toHaveBeenCalled();

        // Second execution succeeds → drains Queued 1
        spy.mockRestore();
        const task2 = followUpTask({ id: 'rec-2', processId: 'proc-recover', content: 'success trigger' });
        queueManager.tasks.set(task2.id, task2);
        await executor.execute(task2);

        const after = await store.getProcess('proc-recover');
        expect(after?.pendingMessages).toHaveLength(2);
        expect(after?.pendingMessages![0].content).toBe('Queued 2');
        expect(after?.pendingMessages![1].content).toBe('Queued 3');
        expect(drainedPrompts(queueManager)).toEqual(['Queued 1']);
    });

    it('no duplicate drain occurs even if the same task ID is reused', async () => {
        const proc = createCompletedProcessWithSession('proc-dedup', 'sess-dedup');
        proc.pendingMessages = [
            makePendingMessage('Only once'),
        ];
        await store.addProcess(proc);

        const task = followUpTask({ id: 'dedup-1', processId: 'proc-dedup', content: 'trigger' });
        queueManager.tasks.set(task.id, task);
        await executor.execute(task);

        // Should have drained exactly once
        expect(queueManager.enqueue).toHaveBeenCalledTimes(1);
        expect((await store.getProcess('proc-dedup'))?.pendingMessages).toHaveLength(0);

        // Execute again with no pending messages
        queueManager.enqueue.mockClear();
        const task2 = followUpTask({ id: 'dedup-2', processId: 'proc-dedup', content: 'trigger2' });
        queueManager.tasks.set(task2.id, task2);
        await executor.execute(task2);

        // No additional drain
        expect(queueManager.enqueue).not.toHaveBeenCalled();
        expect(drainedPrompts(queueManager)).toEqual([]);
    });
});

// ============================================================================
// 6. Drain race condition tests
// ============================================================================

describe('Follow-up FIFO — drain race condition (running task)', () => {
    let store: ReturnType<typeof createMockProcessStore>;
    let executor: CLITaskExecutor;
    let queueManager: MockQueueManager;

    beforeEach(() => {
        vi.clearAllMocks();
        store = createMockProcessStore();
        sdkMocks.resetAll();
        sdkMocks.mockIsAvailable.mockResolvedValue({ available: true });
        executor = new CLITaskExecutor(store, { aiService: sdkMocks.service });
        queueManager = createMockQueueManager();
        executor.setQueueManager(queueManager as any);
    });

    it('drains pending message even when parent task is still in running map', async () => {
        // This is the core race condition scenario: drain is called from
        // inside execute(), before QueueExecutor calls markCompleted.
        // The task is still in the running map (status: 'running').
        const proc = createCompletedProcessWithSession('proc-race', 'sess-race');
        proc.pendingMessages = [
            makePendingMessage('Buffered follow-up'),
        ];
        await store.addProcess(proc);

        // Simulate follow-up task that's in the running map (as it would be
        // during execute() — QueueExecutor hasn't called markCompleted yet)
        const task = followUpTask({ id: 'race-task', processId: 'proc-race', content: 'running task' });
        task.status = 'running';
        queueManager.tasks.set(task.id, task);
        await executor.execute(task);

        // Pending message should have been drained
        const after = await store.getProcess('proc-race');
        expect(after?.pendingMessages).toHaveLength(0);

        // The drained message should have been enqueued as a follow-up
        expect(queueManager.enqueue).toHaveBeenCalledTimes(1);
        const enqueued = queueManager.enqueue.mock.calls[0][0];
        expect(enqueued.payload.prompt).toBe('Buffered follow-up');
        expect(enqueued.payload.processId).toBe('proc-race');
        expect(enqueued.payload.kind).toBe('chat');
        expect(enqueued.type).toBe('chat');
    });

    it('pending message is preserved if enqueue throws', async () => {
        const proc = createCompletedProcessWithSession('proc-enq-fail', 'sess-enq-fail');
        proc.pendingMessages = [
            makePendingMessage('Should survive'),
        ];
        await store.addProcess(proc);

        // Make enqueue throw (simulates queue full, draining, etc.)
        queueManager.enqueue.mockImplementationOnce(() => { throw new Error('Queue is full'); });

        const task = followUpTask({ processId: 'proc-enq-fail', content: 'trigger' });
        queueManager.tasks.set(task.id, task);

        // The drain error is caught by the lifecycle runner (non-fatal)
        const result = await executor.execute(task);
        expect(result.success).toBe(true);

        // Pending message must NOT be removed since enqueue failed
        const after = await store.getProcess('proc-enq-fail');
        expect(after?.pendingMessages).toHaveLength(1);
        expect(after?.pendingMessages![0].content).toBe('Should survive');
    });

    it('enqueued follow-up has correct processId for conversation continuity', async () => {
        const proc = createCompletedProcessWithSession('proc-cont', 'sess-cont');
        proc.pendingMessages = [
            makePendingMessage('Continue conversation'),
        ];
        await store.addProcess(proc);

        const task = followUpTask({ id: 'cont-task', processId: 'proc-cont', content: 'trigger' });
        task.status = 'running';
        queueManager.tasks.set(task.id, task);
        await executor.execute(task);

        // The enqueued task must reference the correct processId
        const enqueued = queueManager.enqueue.mock.calls[0][0];
        expect(enqueued.processId).toBe('proc-cont');
        // And the payload must also contain processId for isChatFollowUp check
        expect(enqueued.payload.processId).toBe('proc-cont');
    });
});
