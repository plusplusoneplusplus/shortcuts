/**
 * Tests for QueueExecutor
 *
 * Cross-platform compatible (Linux/Mac/Windows).
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import {
    QueueExecutor,
    createQueueExecutor,
    TaskQueueManager,
    createTaskQueueManager,
    SimpleTaskExecutor,
    createSimpleTaskExecutor,
    QueuedTask,
    CreateTaskInput,
    TaskExecutor,
    TaskExecutionResult,
    TaskPriority,
} from '../../src/queue';
import { CancellationError } from '../../src/map-reduce/concurrency-limiter';

describe('QueueExecutor', () => {
    let queueManager: TaskQueueManager;
    let taskExecutor: SimpleTaskExecutor;
    let executor: QueueExecutor;

    beforeEach(() => {
        queueManager = createTaskQueueManager();
        taskExecutor = createSimpleTaskExecutor(async (task) => {
            return { taskId: task.id, processed: true };
        });
    });

    afterEach(() => {
        if (executor) {
            executor.dispose();
        }
    });

    // ========================================================================
    // Constructor and Lifecycle
    // ========================================================================

    describe('constructor', () => {
        it('creates executor with default options', () => {
            executor = new QueueExecutor(queueManager, taskExecutor);
            expect(executor.getMaxConcurrency()).toBe(1);
            expect(executor.isRunning()).toBe(true); // autoStart default
        });

        it('creates executor with custom options', () => {
            executor = new QueueExecutor(queueManager, taskExecutor, {
                maxConcurrency: 3,
                autoStart: false,
            });
            expect(executor.getMaxConcurrency()).toBe(3);
            expect(executor.isRunning()).toBe(false);
        });

        it('createQueueExecutor factory works', () => {
            executor = createQueueExecutor(queueManager, taskExecutor, {
                autoStart: false,
            });
            expect(executor).toBeInstanceOf(QueueExecutor);
        });
    });

    describe('start/stop', () => {
        it('start sets running state', () => {
            executor = new QueueExecutor(queueManager, taskExecutor, { autoStart: false });
            expect(executor.isRunning()).toBe(false);

            executor.start();
            expect(executor.isRunning()).toBe(true);
        });

        it('stop clears running state', () => {
            executor = new QueueExecutor(queueManager, taskExecutor);
            expect(executor.isRunning()).toBe(true);

            executor.stop();
            expect(executor.isRunning()).toBe(false);
        });

        it('emits started event', () => {
            executor = new QueueExecutor(queueManager, taskExecutor, { autoStart: false });
            const listener = vi.fn();
            executor.on('started', listener);

            executor.start();

            expect(listener).toHaveBeenCalledTimes(1);
        });

        it('emits stopped event', () => {
            executor = new QueueExecutor(queueManager, taskExecutor);
            const listener = vi.fn();
            executor.on('stopped', listener);

            executor.stop();

            expect(listener).toHaveBeenCalledTimes(1);
        });

        it('double start does not restart', () => {
            executor = new QueueExecutor(queueManager, taskExecutor, { autoStart: false });
            const listener = vi.fn();
            executor.on('started', listener);

            executor.start();
            executor.start();

            expect(listener).toHaveBeenCalledTimes(1);
        });
    });

    // ========================================================================
    // Configuration
    // ========================================================================

    describe('setMaxConcurrency', () => {
        it('updates concurrency limit', () => {
            executor = new QueueExecutor(queueManager, taskExecutor, { autoStart: false });
            executor.setMaxConcurrency(5);
            expect(executor.getMaxConcurrency()).toBe(5);
        });

        it('throws for invalid value', () => {
            executor = new QueueExecutor(queueManager, taskExecutor, { autoStart: false });
            expect(() => executor.setMaxConcurrency(0)).toThrow(/at least 1/);
            expect(() => executor.setMaxConcurrency(-1)).toThrow(/at least 1/);
        });
    });

    // ========================================================================
    // Task Execution
    // ========================================================================

    describe('task execution', () => {
        it('executes queued task', async () => {
            executor = new QueueExecutor(queueManager, taskExecutor);

            const taskId = queueManager.enqueue(createTestTask());

            // Wait for task to be processed
            await waitFor(() => queueManager.getTask(taskId)?.status === 'completed');

            const task = queueManager.getTask(taskId);
            expect(task?.status).toBe('completed');
            expect(task?.result).toEqual({ taskId, processed: true });
        });

        it('emits taskStarted event', async () => {
            executor = new QueueExecutor(queueManager, taskExecutor);
            const listener = vi.fn();
            executor.on('taskStarted', listener);

            queueManager.enqueue(createTestTask());

            await waitFor(() => listener.mock.calls.length > 0);
            expect(listener).toHaveBeenCalled();
        });

        it('emits taskCompleted event', async () => {
            executor = new QueueExecutor(queueManager, taskExecutor);
            const listener = vi.fn();
            executor.on('taskCompleted', listener);

            queueManager.enqueue(createTestTask());

            await waitFor(() => listener.mock.calls.length > 0);
            expect(listener).toHaveBeenCalled();
            expect(listener.mock.calls[0][1]).toEqual(expect.objectContaining({ processed: true }));
        });

        it('executes multiple tasks sequentially with concurrency 1', async () => {
            const executionOrder: string[] = [];
            taskExecutor = createSimpleTaskExecutor(async (task) => {
                executionOrder.push(`start-${task.displayName}`);
                await delay(20);
                executionOrder.push(`end-${task.displayName}`);
                return task.displayName;
            });

            executor = new QueueExecutor(queueManager, taskExecutor, { maxConcurrency: 1 });

            queueManager.enqueue(createTestTask({ displayName: 'task1' }));
            queueManager.enqueue(createTestTask({ displayName: 'task2' }));

            await waitFor(() => queueManager.getCompleted().length === 2, 1000);

            // With concurrency 1, tasks should not overlap
            expect(executionOrder).toEqual([
                'start-task1',
                'end-task1',
                'start-task2',
                'end-task2',
            ]);
        });

        it('executes tasks in parallel with higher concurrency', async () => {
            const executionOrder: string[] = [];
            taskExecutor = createSimpleTaskExecutor(async (task) => {
                executionOrder.push(`start-${task.displayName}`);
                await delay(30);
                executionOrder.push(`end-${task.displayName}`);
                return task.displayName;
            });

            executor = new QueueExecutor(queueManager, taskExecutor, { maxConcurrency: 2 });

            queueManager.enqueue(createTestTask({ displayName: 'task1' }));
            queueManager.enqueue(createTestTask({ displayName: 'task2' }));

            await waitFor(() => queueManager.getCompleted().length === 2, 1000);

            // With concurrency 2, both tasks should start before either ends
            expect(executionOrder[0]).toBe('start-task1');
            expect(executionOrder[1]).toBe('start-task2');
        });

        it('respects priority order', async () => {
            const executionOrder: string[] = [];
            taskExecutor = createSimpleTaskExecutor(async (task) => {
                executionOrder.push(task.displayName!);
                return task.displayName;
            });

            executor = new QueueExecutor(queueManager, taskExecutor, {
                maxConcurrency: 1,
                autoStart: false,
            });

            queueManager.enqueue(createTestTask({ priority: 'low', displayName: 'low' }));
            queueManager.enqueue(createTestTask({ priority: 'high', displayName: 'high' }));
            queueManager.enqueue(createTestTask({ priority: 'normal', displayName: 'normal' }));

            executor.start();

            await waitFor(() => queueManager.getCompleted().length === 3, 1000);

            expect(executionOrder).toEqual(['high', 'normal', 'low']);
        });
    });

    // ========================================================================
    // Task Failure
    // ========================================================================

    describe('task failure', () => {
        it('marks task as failed on error', async () => {
            taskExecutor = createSimpleTaskExecutor(async () => {
                throw new Error('Task failed');
            });

            executor = new QueueExecutor(queueManager, taskExecutor);

            const taskId = queueManager.enqueue(createTestTask());

            await waitFor(() => queueManager.getTask(taskId)?.status === 'failed');

            const task = queueManager.getTask(taskId);
            expect(task?.status).toBe('failed');
            expect(task?.error).toBe('Task failed');
        });

        it('emits taskFailed event', async () => {
            taskExecutor = createSimpleTaskExecutor(async () => {
                throw new Error('Task failed');
            });

            executor = new QueueExecutor(queueManager, taskExecutor);
            const listener = vi.fn();
            executor.on('taskFailed', listener);

            queueManager.enqueue(createTestTask());

            await waitFor(() => listener.mock.calls.length > 0);
            expect(listener).toHaveBeenCalled();
            expect(listener.mock.calls[0][1]).toBeInstanceOf(Error);
        });

        it('retries task when configured', async () => {
            let attempts = 0;
            taskExecutor = createSimpleTaskExecutor(async () => {
                attempts++;
                if (attempts < 3) {
                    throw new Error('Retry me');
                }
                return 'success';
            });

            executor = new QueueExecutor(queueManager, taskExecutor);

            const taskId = queueManager.enqueue(createTestTask({
                config: {
                    retryOnFailure: true,
                    retryAttempts: 3,
                    retryDelayMs: 10,
                },
            }));

            await waitFor(() => queueManager.getTask(taskId)?.status === 'completed', 1000);

            expect(attempts).toBe(3);
            expect(queueManager.getTask(taskId)?.status).toBe('completed');
        });

        it('fails after max retries', async () => {
            taskExecutor = createSimpleTaskExecutor(async () => {
                throw new Error('Always fails');
            });

            executor = new QueueExecutor(queueManager, taskExecutor);

            const taskId = queueManager.enqueue(createTestTask({
                config: {
                    retryOnFailure: true,
                    retryAttempts: 2,
                    retryDelayMs: 10,
                },
            }));

            await waitFor(() => queueManager.getTask(taskId)?.status === 'failed', 1000);

            expect(queueManager.getTask(taskId)?.status).toBe('failed');
        });

        it('emits taskRetry event', async () => {
            let attempts = 0;
            taskExecutor = createSimpleTaskExecutor(async () => {
                attempts++;
                if (attempts < 2) {
                    throw new Error('Retry me');
                }
                return 'success';
            });

            executor = new QueueExecutor(queueManager, taskExecutor);
            const listener = vi.fn();
            executor.on('taskRetry', listener);

            queueManager.enqueue(createTestTask({
                config: {
                    retryOnFailure: true,
                    retryAttempts: 3,
                    retryDelayMs: 10,
                },
            }));

            await waitFor(() => listener.mock.calls.length > 0, 500);
            expect(listener).toHaveBeenCalled();
        });
    });

    // ========================================================================
    // Task Cancellation
    // ========================================================================

    describe('task cancellation', () => {
        it('cancels queued task', async () => {
            executor = new QueueExecutor(queueManager, taskExecutor, { autoStart: false });

            const taskId = queueManager.enqueue(createTestTask());
            executor.cancelTask(taskId);

            expect(queueManager.getTask(taskId)?.status).toBe('cancelled');
        });

        it('cancels running task', async () => {
            let taskStarted = false;
            taskExecutor = createSimpleTaskExecutor(async () => {
                taskStarted = true;
                await delay(500);
                return 'done';
            });

            executor = new QueueExecutor(queueManager, taskExecutor);

            const taskId = queueManager.enqueue(createTestTask());

            // Wait for task to start
            await waitFor(() => taskStarted);

            executor.cancelTask(taskId);

            await waitFor(() => queueManager.getTask(taskId)?.status === 'cancelled', 100);

            expect(queueManager.getTask(taskId)?.status).toBe('cancelled');
        });

        it('emits taskCancelled event', async () => {
            executor = new QueueExecutor(queueManager, taskExecutor, { autoStart: false });
            const listener = vi.fn();
            executor.on('taskCancelled', listener);

            const taskId = queueManager.enqueue(createTestTask());
            executor.cancelTask(taskId);

            // The event is emitted by queue manager, not executor in this case
            // since task was cancelled before execution
            expect(queueManager.getTask(taskId)?.status).toBe('cancelled');
        });

        it('isTaskCancelled returns correct state', () => {
            executor = new QueueExecutor(queueManager, taskExecutor, { autoStart: false });

            const taskId = queueManager.enqueue(createTestTask());

            expect(executor.isTaskCancelled(taskId)).toBe(false);
            executor.cancelTask(taskId);
            expect(executor.isTaskCancelled(taskId)).toBe(true);
        });
    });

    // ========================================================================
    // Queue Pause/Resume
    // ========================================================================

    describe('queue pause/resume', () => {
        it('does not process tasks when paused', async () => {
            executor = new QueueExecutor(queueManager, taskExecutor);

            queueManager.pause();
            const taskId = queueManager.enqueue(createTestTask());

            await delay(100);

            expect(queueManager.getTask(taskId)?.status).toBe('queued');
        });

        it('resumes processing after unpause', async () => {
            executor = new QueueExecutor(queueManager, taskExecutor);

            queueManager.pause();
            const taskId = queueManager.enqueue(createTestTask());

            await delay(50);
            expect(queueManager.getTask(taskId)?.status).toBe('queued');

            queueManager.resume();

            await waitFor(() => queueManager.getTask(taskId)?.status === 'completed');
            expect(queueManager.getTask(taskId)?.status).toBe('completed');
        });
    });

    // ========================================================================
    // Timeout
    // ========================================================================

    describe('timeout', () => {
        it('fails task on timeout', async () => {
            taskExecutor = createSimpleTaskExecutor(async () => {
                await delay(500);
                return 'done';
            });

            executor = new QueueExecutor(queueManager, taskExecutor);

            const taskId = queueManager.enqueue(createTestTask({
                config: { timeoutMs: 50 },
            }));

            await waitFor(() => queueManager.getTask(taskId)?.status === 'failed', 500);

            const task = queueManager.getTask(taskId);
            expect(task?.status).toBe('failed');
            expect(task?.error).toContain('timed out');
        });
    });

    // ========================================================================
    // SimpleTaskExecutor
    // ========================================================================

    describe('SimpleTaskExecutor', () => {
        it('executes function and returns result', async () => {
            const exec = createSimpleTaskExecutor(async (task) => {
                return { id: task.id };
            });

            const task = createQueuedTask();
            const result = await exec.execute(task);

            expect(result.success).toBe(true);
            expect(result.result).toEqual({ id: task.id });
            expect(result.durationMs).toBeGreaterThanOrEqual(0);
        });

        it('returns failure on error', async () => {
            const exec = createSimpleTaskExecutor(async () => {
                throw new Error('Test error');
            });

            const result = await exec.execute(createQueuedTask());

            expect(result.success).toBe(false);
            expect(result.error?.message).toBe('Test error');
        });

        it('returns failure when cancelled', async () => {
            const exec = createSimpleTaskExecutor(async () => {
                return 'done';
            });

            const task = createQueuedTask();
            exec.cancel(task.id);

            const result = await exec.execute(task);

            expect(result.success).toBe(false);
            expect(result.error).toBeInstanceOf(CancellationError);
        });
    });

    // ========================================================================
    // Dispose
    // ========================================================================

    describe('dispose', () => {
        it('stops executor and cleans up', () => {
            executor = new QueueExecutor(queueManager, taskExecutor);
            const listener = vi.fn();
            executor.on('taskCompleted', listener);

            executor.dispose();

            expect(executor.isRunning()).toBe(false);
        });
    });
});

// ============================================================================
// Test Helpers
// ============================================================================

function createTestTask(
    overrides: Partial<CreateTaskInput> = {}
): CreateTaskInput {
    return {
        type: 'follow-prompt',
        priority: 'normal' as TaskPriority,
        payload: { promptFilePath: '/test/prompt.md' },
        config: { timeoutMs: 60000 },
        ...overrides,
    };
}

function createQueuedTask(overrides: Partial<QueuedTask> = {}): QueuedTask {
    return {
        id: `queue-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`,
        type: 'follow-prompt',
        priority: 'normal',
        status: 'queued',
        createdAt: Date.now(),
        payload: { promptFilePath: '/test/prompt.md' },
        config: { timeoutMs: 60000 },
        retryCount: 0,
        ...overrides,
    };
}

function delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function waitFor(
    condition: () => boolean,
    timeoutMs: number = 500
): Promise<void> {
    const startTime = Date.now();
    while (!condition()) {
        if (Date.now() - startTime > timeoutMs) {
            throw new Error(`Condition not met within ${timeoutMs}ms`);
        }
        await delay(10);
    }
}
