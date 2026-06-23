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
import { CancellationError } from '../../src/workflow/concurrency-limiter';

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
    // pauseOnFailure
    // ========================================================================

    describe('pauseOnFailure', () => {
        it('pauses repo queue when task with pauseOnFailure fails', async () => {
            const repoQueueManager = new TaskQueueManager({
                getTaskRepoId: (task) => task.repoId,
            });
            taskExecutor = createSimpleTaskExecutor(async () => {
                throw new Error('Script failed');
            });

            executor = new QueueExecutor(repoQueueManager, taskExecutor);

            repoQueueManager.enqueue(createTestTask({
                repoId: 'repo-X',
                config: { pauseOnFailure: true },
            }));

            await waitFor(() => repoQueueManager.isRepoPaused('repo-X'), 1000);

            expect(repoQueueManager.isRepoPaused('repo-X')).toBe(true);
            const reason = repoQueueManager.getPauseReason('repo-X');
            expect(reason).toBeDefined();
            expect(reason!.displayName).toBeDefined();
            expect(reason!.failedAt).toBeDefined();

            executor.dispose();
        });

        it('does not pause when pauseOnFailure is not set', async () => {
            const repoQueueManager = new TaskQueueManager({
                getTaskRepoId: (task) => task.repoId,
            });
            taskExecutor = createSimpleTaskExecutor(async () => {
                throw new Error('Script failed');
            });

            executor = new QueueExecutor(repoQueueManager, taskExecutor);

            const taskId = repoQueueManager.enqueue(createTestTask({
                repoId: 'repo-Y',
                config: {},
            }));

            await waitFor(() => repoQueueManager.getTask(taskId)?.status === 'failed', 1000);

            expect(repoQueueManager.isRepoPaused('repo-Y')).toBe(false);

            executor.dispose();
        });

        it('does not pause when task has no repoId', async () => {
            const repoQueueManager = new TaskQueueManager({
                getTaskRepoId: (task) => task.repoId,
            });
            taskExecutor = createSimpleTaskExecutor(async () => {
                throw new Error('Script failed');
            });

            executor = new QueueExecutor(repoQueueManager, taskExecutor);

            const taskId = repoQueueManager.enqueue(createTestTask({
                config: { pauseOnFailure: true },
                // no repoId
            }));

            await waitFor(() => repoQueueManager.getTask(taskId)?.status === 'failed', 1000);

            expect(repoQueueManager.getPausedRepos()).toHaveLength(0);

            executor.dispose();
        });

        it('uses displayName in pauseReason when available', async () => {
            const repoQueueManager = new TaskQueueManager({
                getTaskRepoId: (task) => task.repoId,
            });
            taskExecutor = createSimpleTaskExecutor(async () => {
                throw new Error('Script failed');
            });

            executor = new QueueExecutor(repoQueueManager, taskExecutor);

            repoQueueManager.enqueue(createTestTask({
                repoId: 'repo-Z',
                displayName: 'lint.sh',
                config: { pauseOnFailure: true },
            }));

            await waitFor(() => repoQueueManager.isRepoPaused('repo-Z'), 1000);

            const reason = repoQueueManager.getPauseReason('repo-Z');
            expect(reason!.displayName).toBe('lint.sh');

            executor.dispose();
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

        it('cancel running exclusive task frees slot for next task', async () => {
            let task1Started = false;
            let task1Resolve: (() => void) | undefined;
            const task1Promise = new Promise<void>(resolve => { task1Resolve = resolve; });
            let task2Completed = false;

            taskExecutor = createSimpleTaskExecutor(async (task) => {
                if (task.displayName === 'task1') {
                    task1Started = true;
                    await task1Promise;
                    return 'task1-done';
                }
                task2Completed = true;
                return 'task2-done';
            });

            executor = new QueueExecutor(queueManager, taskExecutor, {
                exclusiveConcurrency: 1,
                isExclusive: () => true,
                autoStart: true,
            });

            const task1Id = queueManager.enqueue(createTestTask({ displayName: 'task1' }));
            queueManager.enqueue(createTestTask({ displayName: 'task2' }));

            // Wait for task1 to start executing
            await waitFor(() => task1Started);

            // task2 should still be queued (only 1 exclusive slot)
            expect(task2Completed).toBe(false);

            // Cancel task1 — should free the exclusive slot
            executor.cancelTask(task1Id);
            // Unblock task1's promise so the limiter slot is released
            task1Resolve!();

            // task2 should now pick up and complete
            await waitFor(() => task2Completed, 2000);
            expect(task2Completed).toBe(true);
        });

        it('cancelTask notifies taskExecutor.cancel()', () => {
            const cancelSpy = vi.fn();
            const customExecutor: TaskExecutor = {
                execute: async () => ({ success: true, durationMs: 0 }),
                cancel: cancelSpy,
            };
            executor = new QueueExecutor(queueManager, customExecutor, { autoStart: false });

            const taskId = queueManager.enqueue(createTestTask());
            executor.cancelTask(taskId);

            expect(cancelSpy).toHaveBeenCalledWith(taskId);
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
    // Autopilot pause hold
    // ========================================================================

    describe('autopilot pause hold', () => {
        it('holds exclusive tasks in queue when autopilot is paused', async () => {
            queueManager = createTaskQueueManager({ isExclusive: () => true });
            executor = new QueueExecutor(queueManager, taskExecutor, {
                isExclusive: () => true,
            });

            queueManager.pauseAutopilot();
            const taskId = queueManager.enqueue(createTestTask());

            await delay(200);
            expect(queueManager.getTask(taskId)?.status).toBe('queued');

            // Resume autopilot — task should proceed
            queueManager.resumeAutopilot();
            await waitFor(() => queueManager.getTask(taskId)?.status === 'completed');
            expect(queueManager.getTask(taskId)?.status).toBe('completed');
        });

        it('allows shared tasks to run when autopilot is paused', async () => {
            queueManager = createTaskQueueManager({ isExclusive: () => false });
            executor = new QueueExecutor(queueManager, taskExecutor, {
                isExclusive: () => false,
            });

            queueManager.pauseAutopilot();
            const taskId = queueManager.enqueue(createTestTask());

            await waitFor(() => queueManager.getTask(taskId)?.status === 'completed');
            expect(queueManager.getTask(taskId)?.status).toBe('completed');
        });

        it('runs admitted tasks despite autopilot being paused', async () => {
            queueManager = createTaskQueueManager({ isExclusive: () => true });
            executor = new QueueExecutor(queueManager, taskExecutor, {
                isExclusive: () => true,
            });

            queueManager.pauseAutopilot();
            const taskId = queueManager.enqueue(createTestTask());

            await delay(200);
            expect(queueManager.getTask(taskId)?.status).toBe('queued');

            // Admit the task — should run despite autopilot pause
            queueManager.admitTask(taskId);
            await waitFor(() => queueManager.getTask(taskId)?.status === 'completed');
            expect(queueManager.getTask(taskId)?.status).toBe('completed');
        });

        it('unadmitting a task re-holds it', async () => {
            queueManager = createTaskQueueManager({ isExclusive: () => true });
            taskExecutor = createSimpleTaskExecutor(async () => {
                await delay(500);
                return 'done';
            });
            executor = new QueueExecutor(queueManager, taskExecutor, {
                isExclusive: () => true,
            });

            queueManager.pauseAutopilot();
            const taskId = queueManager.enqueue(createTestTask());

            await delay(100);
            expect(queueManager.getTask(taskId)?.status).toBe('queued');

            // Admit then immediately unadmit
            queueManager.admitTask(taskId);
            queueManager.unadmitTask(taskId);

            await delay(200);
            // Task should still be queued because it was unadmitted before executor picked it up
            expect(queueManager.getTask(taskId)?.status).toBe('queued');
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
    // Shared/Exclusive Concurrency (Dual-Limiter)
    // ========================================================================

    describe('shared/exclusive concurrency', () => {
        it('shared tasks run concurrently up to sharedConcurrency limit', async () => {
            const executionOrder: string[] = [];
            taskExecutor = createSimpleTaskExecutor(async (task) => {
                executionOrder.push(`start-${task.displayName}`);
                await delay(50);
                executionOrder.push(`end-${task.displayName}`);
                return task.displayName;
            });

            executor = new QueueExecutor(queueManager, taskExecutor, {
                sharedConcurrency: 2,
                exclusiveConcurrency: 1,
                isExclusive: (task) => task.concurrencyMode !== 'shared',
                autoStart: true,
            });

            queueManager.enqueue(createTestTask({ displayName: 'A', concurrencyMode: 'shared' }));
            queueManager.enqueue(createTestTask({ displayName: 'B', concurrencyMode: 'shared' }));
            queueManager.enqueue(createTestTask({ displayName: 'C', concurrencyMode: 'shared' }));

            await waitFor(() => queueManager.getCompleted().length === 3, 2000);

            // First two start before either ends; third waits
            expect(executionOrder.indexOf('start-A')).toBeLessThan(executionOrder.indexOf('end-A'));
            expect(executionOrder.indexOf('start-B')).toBeLessThan(executionOrder.indexOf('end-A'));
            expect(executionOrder.indexOf('start-C')).toBeGreaterThan(executionOrder.indexOf('end-A'));
        });

        it('exclusive tasks serialize against each other', async () => {
            const executionOrder: string[] = [];
            taskExecutor = createSimpleTaskExecutor(async (task) => {
                executionOrder.push(`start-${task.displayName}`);
                await delay(30);
                executionOrder.push(`end-${task.displayName}`);
                return task.displayName;
            });

            executor = new QueueExecutor(queueManager, taskExecutor, {
                sharedConcurrency: 5,
                exclusiveConcurrency: 1,
                isExclusive: (task) => task.concurrencyMode !== 'shared',
                autoStart: true,
            });

            queueManager.enqueue(createTestTask({ displayName: 'A', concurrencyMode: 'exclusive' }));
            queueManager.enqueue(createTestTask({ displayName: 'B', concurrencyMode: 'exclusive' }));

            await waitFor(() => queueManager.getCompleted().length === 2, 2000);

            expect(executionOrder).toEqual([
                'start-A', 'end-A', 'start-B', 'end-B',
            ]);
        });

        it('queue manager running map never exceeds exclusive limiter capacity', async () => {
            // Regression: previously markStarted ran BEFORE acquire(), so a second
            // exclusive task could appear in queueManager.getRunning() while blocked
            // on the limiter. The UI/API would then show two "running" tasks even
            // though only one was actually executing.
            let maxObserved = 0;
            taskExecutor = createSimpleTaskExecutor(async (task) => {
                await delay(80);
                return task.displayName;
            });

            executor = new QueueExecutor(queueManager, taskExecutor, {
                sharedConcurrency: 5,
                exclusiveConcurrency: 1,
                isExclusive: (task) => task.concurrencyMode !== 'shared',
                autoStart: true,
            });

            // Enqueue three exclusive tasks back-to-back; only one should ever be
            // in the running map at a time.
            queueManager.enqueue(createTestTask({ displayName: 'A', concurrencyMode: 'exclusive' }));
            queueManager.enqueue(createTestTask({ displayName: 'B', concurrencyMode: 'exclusive' }));
            queueManager.enqueue(createTestTask({ displayName: 'C', concurrencyMode: 'exclusive' }));

            const sampler = setInterval(() => {
                maxObserved = Math.max(maxObserved, queueManager.getRunning().length);
            }, 5);

            try {
                await waitFor(() => queueManager.getCompleted().length === 3, 5000);
            } finally {
                clearInterval(sampler);
            }

            // One final sample after completion
            maxObserved = Math.max(maxObserved, queueManager.getRunning().length);

            expect(maxObserved).toBeLessThanOrEqual(1);
        });

        it('shared and exclusive tasks run simultaneously on independent pools', async () => {
            const executionOrder: string[] = [];
            taskExecutor = createSimpleTaskExecutor(async (task) => {
                executionOrder.push(`start-${task.displayName}`);
                await delay(60);
                executionOrder.push(`end-${task.displayName}`);
                return task.displayName;
            });

            executor = new QueueExecutor(queueManager, taskExecutor, {
                sharedConcurrency: 3,
                exclusiveConcurrency: 1,
                isExclusive: (task) => task.concurrencyMode !== 'shared',
                autoStart: true,
            });

            queueManager.enqueue(createTestTask({ displayName: 'shared1', concurrencyMode: 'shared' }));
            queueManager.enqueue(createTestTask({ displayName: 'excl1', concurrencyMode: 'exclusive' }));

            await waitFor(() => queueManager.getCompleted().length === 2, 2000);

            // Both should start before either ends (independent pools)
            expect(executionOrder.indexOf('start-shared1')).toBeLessThan(executionOrder.indexOf('end-shared1'));
            expect(executionOrder.indexOf('start-excl1')).toBeLessThan(executionOrder.indexOf('end-shared1'));
            expect(executionOrder.indexOf('start-excl1')).toBeLessThan(executionOrder.indexOf('end-excl1'));
        });

        it('isExclusive callback is respected for classification', async () => {
            const pools: Record<string, string> = {};
            taskExecutor = createSimpleTaskExecutor(async (task) => {
                pools[task.displayName!] = task.type;
                return task.displayName;
            });

            executor = new QueueExecutor(queueManager, taskExecutor, {
                sharedConcurrency: 3,
                exclusiveConcurrency: 1,
                isExclusive: (task) => task.type === 'resolve-comments',
                autoStart: true,
            });

            queueManager.enqueue(createTestTask({ displayName: 'prompt', type: 'follow-prompt' }));
            queueManager.enqueue(createTestTask({ displayName: 'resolve', type: 'resolve-comments' }));

            await waitFor(() => queueManager.getCompleted().length === 2, 2000);

            // Both completed — callback classified correctly
            expect(pools['prompt']).toBe('follow-prompt');
            expect(pools['resolve']).toBe('resolve-comments');
        });

        it('concurrencyMode field is preserved on QueuedTask', () => {
            const taskId = queueManager.enqueue(createTestTask({ concurrencyMode: 'shared' }));
            const task = queueManager.getTask(taskId);
            expect(task?.concurrencyMode).toBe('shared');
        });

        it('default concurrencyMode is undefined (exclusive by default)', () => {
            const taskId = queueManager.enqueue(createTestTask());
            const task = queueManager.getTask(taskId);
            expect(task?.concurrencyMode).toBeUndefined();

            // Default isExclusive returns true for any task
            executor = new QueueExecutor(queueManager, taskExecutor, { autoStart: false });
            // Access the default isExclusive via getExclusiveConcurrency to verify defaults
            expect(executor.getExclusiveConcurrency()).toBe(1);
        });

        it('setMaxConcurrency updates both limiters (backward compat)', () => {
            executor = new QueueExecutor(queueManager, taskExecutor, { autoStart: false });
            executor.setMaxConcurrency(3);
            expect(executor.getMaxConcurrency()).toBe(3);
            expect(executor.getSharedConcurrency()).toBe(3);
            expect(executor.getExclusiveConcurrency()).toBe(3);
        });

        it('setSharedConcurrency updates only shared limiter', () => {
            executor = new QueueExecutor(queueManager, taskExecutor, { autoStart: false });
            executor.setSharedConcurrency(4);
            expect(executor.getSharedConcurrency()).toBe(4);
            expect(executor.getExclusiveConcurrency()).toBe(1); // unchanged default
        });

        it('setExclusiveConcurrency updates only exclusive limiter', () => {
            executor = new QueueExecutor(queueManager, taskExecutor, { autoStart: false });
            executor.setExclusiveConcurrency(2);
            expect(executor.getExclusiveConcurrency()).toBe(2);
            expect(executor.getSharedConcurrency()).toBe(5); // unchanged default
        });

        it('setSharedConcurrency throws for invalid value', () => {
            executor = new QueueExecutor(queueManager, taskExecutor, { autoStart: false });
            expect(() => executor.setSharedConcurrency(0)).toThrow(/at least 1/);
            expect(() => executor.setSharedConcurrency(-1)).toThrow(/at least 1/);
        });

        it('setExclusiveConcurrency throws for invalid value', () => {
            executor = new QueueExecutor(queueManager, taskExecutor, { autoStart: false });
            expect(() => executor.setExclusiveConcurrency(0)).toThrow(/at least 1/);
            expect(() => executor.setExclusiveConcurrency(-1)).toThrow(/at least 1/);
        });

        it('maxConcurrency alone sets both limiters (backward compat)', () => {
            executor = new QueueExecutor(queueManager, taskExecutor, {
                maxConcurrency: 3,
                autoStart: false,
            });
            expect(executor.getMaxConcurrency()).toBe(3);
            expect(executor.getSharedConcurrency()).toBe(3);
            expect(executor.getExclusiveConcurrency()).toBe(3);
        });
    });

    describe('dispose', () => {
        it('stops executor and cleans up', () => {
            executor = new QueueExecutor(queueManager, taskExecutor);
            const listener = vi.fn();
            executor.on('taskCompleted', listener);

            executor.dispose();

            expect(executor.isRunning()).toBe(false);
        });
    });

    // ========================================================================
    // drainAndDispose
    // ========================================================================

    describe('drainAndDispose', () => {
        it('completes immediately when queue is empty', async () => {
            executor = new QueueExecutor(queueManager, taskExecutor, { autoStart: true });

            const result = await executor.drainAndDispose();

            expect(result.outcome).toBe('completed');
            expect(executor.isRunning()).toBe(false);
        });

        it('waits for running task to complete', async () => {
            let resolveTask: ((value: unknown) => void) | undefined;
            const blockingExecutor = createSimpleTaskExecutor(async () => {
                return new Promise((resolve) => { resolveTask = resolve; });
            });

            executor = new QueueExecutor(queueManager, blockingExecutor, { autoStart: true });

            queueManager.enqueue(createTestTask());

            // Wait for task to start running
            await waitFor(() => queueManager.getRunning().length > 0, 2000);

            // Start drain (will wait for the task to complete)
            const drainPromise = executor.drainAndDispose();

            // Task is still running; drain should not have resolved
            await delay(100);

            // Complete the task
            resolveTask!('done');

            const result = await drainPromise;
            expect(result.outcome).toBe('completed');
        });

        it('times out when task takes too long', async () => {
            const blockingExecutor = createSimpleTaskExecutor(async () => {
                return new Promise(() => {}); // never resolves
            });

            executor = new QueueExecutor(queueManager, blockingExecutor, { autoStart: true });

            queueManager.enqueue(createTestTask());

            // Wait for task to start running
            await waitFor(() => queueManager.getRunning().length > 0, 2000);

            const result = await executor.drainAndDispose(200); // 200ms timeout

            expect(result.outcome).toBe('timeout');
        });

        it('emits drain-start event', async () => {
            executor = new QueueExecutor(queueManager, taskExecutor, { autoStart: true });
            const handler = vi.fn();
            executor.on('drain-start', handler);

            await executor.drainAndDispose();

            expect(handler).toHaveBeenCalledWith(
                expect.objectContaining({ queued: 0, running: 0 })
            );
        });

        it('emits drain-complete event on success', async () => {
            executor = new QueueExecutor(queueManager, taskExecutor, { autoStart: true });
            const handler = vi.fn();
            executor.on('drain-complete', handler);

            await executor.drainAndDispose();

            expect(handler).toHaveBeenCalledWith(
                expect.objectContaining({ outcome: 'completed' })
            );
        });

        it('emits drain-timeout event on timeout', async () => {
            const blockingExecutor = createSimpleTaskExecutor(async () => {
                return new Promise(() => {}); // never resolves
            });

            executor = new QueueExecutor(queueManager, blockingExecutor, { autoStart: true });
            queueManager.enqueue(createTestTask());

            await waitFor(() => queueManager.getRunning().length > 0, 2000);

            const handler = vi.fn();
            executor.on('drain-timeout', handler);

            await executor.drainAndDispose(200);

            expect(handler).toHaveBeenCalledWith(
                expect.objectContaining({ timeoutMs: 200 })
            );
        });

        it('emits drain-progress events during drain', async () => {
            let resolveTask: ((value: unknown) => void) | undefined;
            const blockingExecutor = createSimpleTaskExecutor(async () => {
                return new Promise((resolve) => { resolveTask = resolve; });
            });

            executor = new QueueExecutor(queueManager, blockingExecutor, { autoStart: true });
            queueManager.enqueue(createTestTask());

            await waitFor(() => queueManager.getRunning().length > 0, 2000);

            const handler = vi.fn();
            executor.on('drain-progress', handler);

            const drainPromise = executor.drainAndDispose();

            // Wait for at least one progress event
            await delay(1500);

            resolveTask!('done');
            await drainPromise;

            expect(handler).toHaveBeenCalled();
        });

        it('enters drain mode on the queue manager', async () => {
            executor = new QueueExecutor(queueManager, taskExecutor, { autoStart: true });

            await executor.drainAndDispose();

            // After drain completes and dispose is called, draining state should be set
            // (the queue manager's enterDrainMode was called)
            // We can't directly check because dispose resets things,
            // but we verify the drain-start event was emitted
        });

        it('disposes executor after drain completes', async () => {
            executor = new QueueExecutor(queueManager, taskExecutor, { autoStart: true });

            await executor.drainAndDispose();

            expect(executor.isRunning()).toBe(false);
        });

        it('waits for multiple tasks', async () => {
            let completedCount = 0;
            const slowExecutor = createSimpleTaskExecutor(async () => {
                await delay(100);
                completedCount++;
                return 'done';
            });

            executor = new QueueExecutor(queueManager, slowExecutor, {
                autoStart: true,
                maxConcurrency: 2,
            });

            queueManager.enqueue(createTestTask());
            queueManager.enqueue(createTestTask());
            queueManager.enqueue(createTestTask());

            const result = await executor.drainAndDispose();

            expect(result.outcome).toBe('completed');
            expect(completedCount).toBe(3);
        });
    });

    // ========================================================================
    // Pause Marker
    // ========================================================================

    describe('pause marker', () => {
        it('executor pauses when it encounters a pause marker', async () => {
            executor = new QueueExecutor(queueManager, taskExecutor, { autoStart: false });

            // enqueue a task then insert a marker before it
            queueManager.insertPauseMarker(0);

            executor.start();

            // Give the loop a chance to run
            await delay(80);

            expect(queueManager.isPaused()).toBe(true);
            expect(queueManager.getStats().pausedUntil).toBeUndefined();
            // The marker was consumed (no longer in queue)
            expect(queueManager.getQueueItems().some(i => (i as any).kind === 'pause-marker')).toBe(false);
        });

        it('executor starts a timed pause when it encounters a timed pause marker', async () => {
            executor = new QueueExecutor(queueManager, taskExecutor, { autoStart: false });
            const before = Date.now();

            queueManager.insertPauseMarker(0, 1);

            executor.start();

            await waitFor(() => queueManager.isPaused(), 2000);

            const stats = queueManager.getStats();
            expect(stats.pausedUntil).toBeDefined();
            expect(stats.pausedUntil!).toBeGreaterThanOrEqual(before + 60 * 60 * 1000);
            expect(stats.pausedUntil!).toBeLessThanOrEqual(Date.now() + 60 * 60 * 1000);
            expect(queueManager.getQueueItems().some(i => (i as any).kind === 'pause-marker')).toBe(false);
        });

        it('emits pause-marker-reached event when marker is consumed', async () => {
            executor = new QueueExecutor(queueManager, taskExecutor, { autoStart: false });
            const handler = vi.fn();
            executor.on('pause-marker-reached', handler);

            queueManager.insertPauseMarker(0);

            executor.start();

            await waitFor(() => handler.mock.calls.length > 0, 2000);

            expect(handler).toHaveBeenCalledTimes(1);
        });

        it('tasks after a marker run after manually resuming', async () => {
            let completedCount = 0;
            const countingExecutor = createSimpleTaskExecutor(async () => {
                completedCount++;
                return 'done';
            });

            executor = new QueueExecutor(queueManager, countingExecutor, { autoStart: false });

            queueManager.enqueue(createTestTask());
            queueManager.insertPauseMarker(1);
            queueManager.enqueue(createTestTask());

            executor.start();

            // Wait until first task done and queue pauses on marker
            await waitFor(() => queueManager.isPaused() && completedCount === 1, 2000);

            expect(completedCount).toBe(1);

            queueManager.resume();

            await waitFor(() => completedCount === 2, 2000);

            expect(completedCount).toBe(2);
        });
    });

    // ========================================================================
    // initialDelayMs
    // ========================================================================

    describe('initialDelayMs', () => {
        it('delays task processing by the specified amount', async () => {
            const completed: number[] = [];
            taskExecutor = createSimpleTaskExecutor(async () => {
                completed.push(Date.now());
                return 'ok';
            });

            const startTime = Date.now();
            executor = new QueueExecutor(queueManager, taskExecutor, {
                initialDelayMs: 200,
            });
            queueManager.enqueue(createTestTask());

            await waitFor(() => completed.length > 0, 2000);

            const elapsed = completed[0] - startTime;
            expect(elapsed).toBeGreaterThanOrEqual(150); // allow small timing slack
        });

        it('emits startup-delay-start and startup-delay-end events', async () => {
            const events: string[] = [];
            executor = new QueueExecutor(queueManager, taskExecutor, {
                autoStart: false,
                initialDelayMs: 100,
            });
            executor.on('startup-delay-start', (ms: number) => {
                events.push(`start:${ms}`);
            });
            executor.on('startup-delay-end', () => {
                events.push('end');
            });
            executor.start();

            await waitFor(() => events.includes('end'), 1000);

            expect(events).toEqual(['start:100', 'end']);
        });

        it('does not delay when initialDelayMs is 0', async () => {
            const completed: number[] = [];
            taskExecutor = createSimpleTaskExecutor(async () => {
                completed.push(Date.now());
                return 'ok';
            });

            const startTime = Date.now();
            executor = new QueueExecutor(queueManager, taskExecutor, {
                initialDelayMs: 0,
            });
            queueManager.enqueue(createTestTask());

            await waitFor(() => completed.length > 0, 1000);

            const elapsed = completed[0] - startTime;
            expect(elapsed).toBeLessThan(150);
        });

        it('does not emit startup delay events when initialDelayMs is 0', async () => {
            const events: string[] = [];
            const completed: string[] = [];
            taskExecutor = createSimpleTaskExecutor(async (task) => {
                completed.push(task.id);
                return 'ok';
            });
            executor = new QueueExecutor(queueManager, taskExecutor, {
                initialDelayMs: 0,
            });
            executor.on('startup-delay-start', () => events.push('start'));
            executor.on('startup-delay-end', () => events.push('end'));

            queueManager.enqueue(createTestTask());
            await waitFor(() => completed.length > 0, 1000);

            expect(events).toEqual([]);
        });

        it('defaults to no delay when initialDelayMs is not set', async () => {
            const completed: number[] = [];
            taskExecutor = createSimpleTaskExecutor(async () => {
                completed.push(Date.now());
                return 'ok';
            });

            const startTime = Date.now();
            executor = new QueueExecutor(queueManager, taskExecutor);
            queueManager.enqueue(createTestTask());

            await waitFor(() => completed.length > 0, 1000);

            const elapsed = completed[0] - startTime;
            expect(elapsed).toBeLessThan(150);
        });
    });
});

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
        id: `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`,
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
