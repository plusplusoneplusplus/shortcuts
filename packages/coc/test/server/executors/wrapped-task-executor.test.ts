/**
 * WrappedTaskExecutor Unit Tests
 *
 * Verifies the before-script → AI → after-script orchestration,
 * including error handling, event emission, and edge cases.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { EventEmitter } from 'events';
import type { QueuedTask } from '@plusplusoneplusplus/forge';
import { WrappedTaskExecutor } from '../../../src/server/executors/wrapped-task-executor';
import { createMockProcessStore } from '../helpers/mock-process-store';

// ============================================================================
// Mock child_process
// ============================================================================

interface FakeChild extends EventEmitter {
    stdout: EventEmitter;
    stderr: EventEmitter;
    kill: ReturnType<typeof vi.fn>;
}

function makeFakeChild(): FakeChild {
    const child = new EventEmitter() as FakeChild;
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.kill = vi.fn(() => {
        setImmediate(() => child.emit('close', null));
    });
    return child;
}

const mockSpawn = vi.fn();
vi.mock('child_process', () => ({
    spawn: (...args: any[]) => mockSpawn(...args),
}));

// ============================================================================
// Helpers
// ============================================================================

function makeTask(overrides?: Partial<QueuedTask>): QueuedTask {
    return {
        id: 'wrap-1',
        type: 'chat',
        priority: 'normal',
        status: 'running',
        createdAt: Date.now(),
        payload: {
            kind: 'chat',
            mode: 'autopilot',
            prompt: 'do something',
        },
        config: {},
        ...overrides,
    };
}

function makeInnerExecutor(result: unknown = { status: 'completed' }, shouldThrow = false) {
    return {
        execute: vi.fn(async () => {
            if (shouldThrow) throw new Error('AI execution failed');
            return result;
        }),
    };
}

/** Simulate a successful script execution via the mocked spawn */
function simulateScriptSuccess(output = '') {
    const child = makeFakeChild();
    mockSpawn.mockReturnValueOnce(child);
    setImmediate(() => {
        if (output) child.stdout.emit('data', Buffer.from(output));
        child.emit('close', 0);
    });
    return child;
}

/** Simulate a failed script execution via the mocked spawn */
function simulateScriptFailure(stderr = 'script error') {
    const child = makeFakeChild();
    mockSpawn.mockReturnValueOnce(child);
    setImmediate(() => {
        child.stderr.emit('data', Buffer.from(stderr));
        child.emit('close', 1);
    });
    return child;
}

// ============================================================================
// Tests
// ============================================================================

describe('WrappedTaskExecutor', () => {
    let store: ReturnType<typeof createMockProcessStore>;

    beforeEach(() => {
        store = createMockProcessStore();
        mockSpawn.mockReset();
    });

    // ========================================================================
    // Happy path
    // ========================================================================

    it('happy path: before → AI → after all succeed', async () => {
        const inner = makeInnerExecutor({ status: 'completed' });
        const executor = new WrappedTaskExecutor(inner, store);
        const task = makeTask({
            payload: {
                kind: 'chat', mode: 'autopilot', prompt: 'test',
                beforeScript: './setup.sh',
                afterScript: './cleanup.sh',
            },
        });

        simulateScriptSuccess('setup done');
        simulateScriptSuccess('cleanup done');

        const result = await executor.execute(task, 'test');

        expect(result).toEqual({ status: 'completed' });
        expect(inner.execute).toHaveBeenCalledWith(task, 'test');

        // Verify hook-step events: before-running, before-done, after-running, after-done
        const events = (store.emitProcessEvent as any).mock.calls;
        expect(events).toHaveLength(4);
        expect(events[0][1].hookStep).toMatchObject({ step: 'before', status: 'running', script: './setup.sh' });
        expect(events[1][1].hookStep).toMatchObject({ step: 'before', status: 'done', script: './setup.sh' });
        expect(events[2][1].hookStep).toMatchObject({ step: 'after', status: 'running', script: './cleanup.sh' });
        expect(events[3][1].hookStep).toMatchObject({ step: 'after', status: 'done', script: './cleanup.sh' });
    });

    // ========================================================================
    // Before-script failure
    // ========================================================================

    it('before-script fails: AI skipped, after still runs, task throws', async () => {
        const inner = makeInnerExecutor();
        const executor = new WrappedTaskExecutor(inner, store);
        const task = makeTask({
            payload: {
                kind: 'chat', mode: 'autopilot', prompt: 'test',
                beforeScript: './setup.sh',
                afterScript: './cleanup.sh',
            },
        });

        simulateScriptFailure('setup failed');
        simulateScriptSuccess('cleanup ok');

        await expect(executor.execute(task, 'test')).rejects.toThrow('Before-script failed');
        expect(inner.execute).not.toHaveBeenCalled();

        // After-script still ran
        const events = (store.emitProcessEvent as any).mock.calls;
        const afterEvents = events.filter((c: any) => c[1].hookStep?.step === 'after');
        expect(afterEvents).toHaveLength(2); // running + done
    });

    // ========================================================================
    // AI failure
    // ========================================================================

    it('AI fails: after-script still runs, task re-throws AI error', async () => {
        const inner = makeInnerExecutor(undefined, true);
        const executor = new WrappedTaskExecutor(inner, store);
        const task = makeTask({
            payload: {
                kind: 'chat', mode: 'autopilot', prompt: 'test',
                beforeScript: './setup.sh',
                afterScript: './cleanup.sh',
            },
        });

        simulateScriptSuccess('setup ok');
        simulateScriptSuccess('cleanup ok');

        await expect(executor.execute(task, 'test')).rejects.toThrow('AI execution failed');

        // After-script still ran
        const events = (store.emitProcessEvent as any).mock.calls;
        const afterEvents = events.filter((c: any) => c[1].hookStep?.step === 'after');
        expect(afterEvents).toHaveLength(2); // running + done
    });

    // ========================================================================
    // After-script failure
    // ========================================================================

    it('after-script fails: task completes but after-script emits failed event', async () => {
        const inner = makeInnerExecutor({ status: 'completed' });
        const executor = new WrappedTaskExecutor(inner, store);
        const task = makeTask({
            payload: {
                kind: 'chat', mode: 'autopilot', prompt: 'test',
                afterScript: './cleanup.sh',
            },
        });

        simulateScriptFailure('cleanup error');

        // Task should still complete (after-script failure doesn't throw)
        const result = await executor.execute(task, 'test');
        expect(result).toEqual({ status: 'completed' });

        const events = (store.emitProcessEvent as any).mock.calls;
        const afterFailed = events.find((c: any) =>
            c[1].hookStep?.step === 'after' && c[1].hookStep?.status === 'failed'
        );
        expect(afterFailed).toBeDefined();
        expect(afterFailed[1].hookStep.output).toContain('cleanup error');
    });

    // ========================================================================
    // No scripts
    // ========================================================================

    it('no scripts: inner executor called directly', async () => {
        const inner = makeInnerExecutor({ status: 'completed' });
        const executor = new WrappedTaskExecutor(inner, store);
        const task = makeTask();

        const result = await executor.execute(task, 'test');

        expect(result).toEqual({ status: 'completed' });
        expect(inner.execute).toHaveBeenCalled();
        expect(store.emitProcessEvent).not.toHaveBeenCalled();
    });

    // ========================================================================
    // Only before-script
    // ========================================================================

    it('only before-script: runs before then AI, no after events', async () => {
        const inner = makeInnerExecutor({ status: 'completed' });
        const executor = new WrappedTaskExecutor(inner, store);
        const task = makeTask({
            payload: {
                kind: 'chat', mode: 'autopilot', prompt: 'test',
                beforeScript: './setup.sh',
            },
        });

        simulateScriptSuccess('ready');

        const result = await executor.execute(task, 'test');
        expect(result).toEqual({ status: 'completed' });

        const events = (store.emitProcessEvent as any).mock.calls;
        expect(events).toHaveLength(2); // before-running + before-done
        expect(events.every((c: any) => c[1].hookStep.step === 'before')).toBe(true);
    });

    // ========================================================================
    // Only after-script
    // ========================================================================

    it('only after-script: AI runs then after, no before events', async () => {
        const inner = makeInnerExecutor({ status: 'completed' });
        const executor = new WrappedTaskExecutor(inner, store);
        const task = makeTask({
            payload: {
                kind: 'chat', mode: 'autopilot', prompt: 'test',
                afterScript: './cleanup.sh',
            },
        });

        simulateScriptSuccess('done');

        const result = await executor.execute(task, 'test');
        expect(result).toEqual({ status: 'completed' });

        const events = (store.emitProcessEvent as any).mock.calls;
        expect(events).toHaveLength(2); // after-running + after-done
        expect(events.every((c: any) => c[1].hookStep.step === 'after')).toBe(true);
    });

    // ========================================================================
    // Process ID
    // ========================================================================

    it('emits events with correct processId (queue_<taskId>)', async () => {
        const inner = makeInnerExecutor();
        const executor = new WrappedTaskExecutor(inner, store);
        const task = makeTask({
            id: 'abc-123',
            payload: {
                kind: 'chat', mode: 'autopilot', prompt: 'test',
                beforeScript: 'echo hi',
            },
        });

        simulateScriptSuccess();

        await executor.execute(task, 'test');

        const events = (store.emitProcessEvent as any).mock.calls;
        expect(events.every((c: any) => c[0] === 'queue_abc-123')).toBe(true);
    });

    // ========================================================================
    // Working directory
    // ========================================================================

    it('passes workingDirectory to spawn', async () => {
        const inner = makeInnerExecutor();
        const executor = new WrappedTaskExecutor(inner, store);
        const task = makeTask({
            payload: {
                kind: 'chat', mode: 'autopilot', prompt: 'test',
                beforeScript: './setup.sh',
                workingDirectory: '/my/project',
            },
        });

        simulateScriptSuccess();

        await executor.execute(task, 'test');

        expect(mockSpawn).toHaveBeenCalledWith('./setup.sh', [], expect.objectContaining({
            shell: true,
            cwd: '/my/project',
        }));
    });

    // ========================================================================
    // Duration tracking
    // ========================================================================

    it('reports durationMs in done/failed events', async () => {
        const inner = makeInnerExecutor();
        const executor = new WrappedTaskExecutor(inner, store);
        const task = makeTask({
            payload: {
                kind: 'chat', mode: 'autopilot', prompt: 'test',
                beforeScript: 'echo hi',
            },
        });

        simulateScriptSuccess();

        await executor.execute(task, 'test');

        const events = (store.emitProcessEvent as any).mock.calls;
        const doneEvent = events.find((c: any) => c[1].hookStep?.status === 'done');
        expect(doneEvent[1].hookStep.durationMs).toBeTypeOf('number');
        expect(doneEvent[1].hookStep.durationMs).toBeGreaterThanOrEqual(0);
    });
});
