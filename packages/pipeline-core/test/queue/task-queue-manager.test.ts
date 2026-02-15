/**
 * Tests for TaskQueueManager
 *
 * Cross-platform compatible (Linux/Mac/Windows).
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
    TaskQueueManager,
    createTaskQueueManager,
    QueuedTask,
    CreateTaskInput,
    QueueChangeEvent,
    TaskPriority,
} from '../../src/queue';

describe('TaskQueueManager', () => {
    let manager: TaskQueueManager;

    beforeEach(() => {
        manager = createTaskQueueManager();
    });

    // ========================================================================
    // Constructor and Options
    // ========================================================================

    describe('constructor', () => {
        it('creates manager with default options', () => {
            const m = new TaskQueueManager();
            expect(m.size()).toBe(0);
            expect(m.isPaused()).toBe(false);
        });

        it('creates manager with custom options', () => {
            const m = new TaskQueueManager({
                maxQueueSize: 10,
                keepHistory: false,
                maxHistorySize: 50,
            });
            expect(m.size()).toBe(0);
        });

        it('createTaskQueueManager factory works', () => {
            const m = createTaskQueueManager({ maxQueueSize: 5 });
            expect(m).toBeInstanceOf(TaskQueueManager);
        });
    });

    // ========================================================================
    // Enqueue Operations
    // ========================================================================

    describe('enqueue', () => {
        it('adds task to queue and returns ID', () => {
            const taskId = manager.enqueue(createTestTask());
            expect(taskId).toMatch(/^queue-\d+-[a-z0-9]+$/);
            expect(manager.size()).toBe(1);
        });

        it('sets correct initial status and timestamps', () => {
            const taskId = manager.enqueue(createTestTask());
            const task = manager.getTask(taskId);

            expect(task).toBeDefined();
            expect(task!.status).toBe('queued');
            expect(task!.createdAt).toBeGreaterThan(0);
            expect(task!.startedAt).toBeUndefined();
            expect(task!.completedAt).toBeUndefined();
            expect(task!.retryCount).toBe(0);
        });

        it('emits taskAdded event', () => {
            const listener = vi.fn();
            manager.on('taskAdded', listener);

            manager.enqueue(createTestTask());

            expect(listener).toHaveBeenCalledTimes(1);
            expect(listener.mock.calls[0][0].status).toBe('queued');
        });

        it('emits change event with type added', () => {
            const listener = vi.fn();
            manager.on('change', listener);

            manager.enqueue(createTestTask());

            expect(listener).toHaveBeenCalledTimes(1);
            const event: QueueChangeEvent = listener.mock.calls[0][0];
            expect(event.type).toBe('added');
            expect(event.task).toBeDefined();
        });

        it('throws when queue is full', () => {
            const m = createTaskQueueManager({ maxQueueSize: 2 });
            m.enqueue(createTestTask());
            m.enqueue(createTestTask());

            expect(() => m.enqueue(createTestTask())).toThrow(/Queue is full/);
        });

        it('allows unlimited queue when maxQueueSize is 0', () => {
            const m = createTaskQueueManager({ maxQueueSize: 0 });
            for (let i = 0; i < 100; i++) {
                m.enqueue(createTestTask());
            }
            expect(m.size()).toBe(100);
        });
    });

    // ========================================================================
    // Priority Ordering
    // ========================================================================

    describe('priority ordering', () => {
        it('high priority tasks come first', () => {
            manager.enqueue(createTestTask({ priority: 'low' }));
            manager.enqueue(createTestTask({ priority: 'high' }));
            manager.enqueue(createTestTask({ priority: 'normal' }));

            const tasks = manager.getQueued();
            expect(tasks[0].priority).toBe('high');
            expect(tasks[1].priority).toBe('normal');
            expect(tasks[2].priority).toBe('low');
        });

        it('FIFO within same priority', () => {
            const id1 = manager.enqueue(createTestTask({ priority: 'normal', displayName: 'first' }));
            const id2 = manager.enqueue(createTestTask({ priority: 'normal', displayName: 'second' }));
            const id3 = manager.enqueue(createTestTask({ priority: 'normal', displayName: 'third' }));

            const tasks = manager.getQueued();
            expect(tasks[0].id).toBe(id1);
            expect(tasks[1].id).toBe(id2);
            expect(tasks[2].id).toBe(id3);
        });

        it('mixed priorities maintain correct order', () => {
            manager.enqueue(createTestTask({ priority: 'normal', displayName: 'n1' }));
            manager.enqueue(createTestTask({ priority: 'low', displayName: 'l1' }));
            manager.enqueue(createTestTask({ priority: 'high', displayName: 'h1' }));
            manager.enqueue(createTestTask({ priority: 'normal', displayName: 'n2' }));
            manager.enqueue(createTestTask({ priority: 'high', displayName: 'h2' }));

            const tasks = manager.getQueued();
            expect(tasks.map(t => t.displayName)).toEqual(['h1', 'h2', 'n1', 'n2', 'l1']);
        });
    });

    // ========================================================================
    // Dequeue and Peek
    // ========================================================================

    describe('dequeue', () => {
        it('returns undefined for empty queue', () => {
            expect(manager.dequeue()).toBeUndefined();
        });

        it('returns and removes first task', () => {
            const id = manager.enqueue(createTestTask());
            const task = manager.dequeue();

            expect(task).toBeDefined();
            expect(task!.id).toBe(id);
            expect(manager.size()).toBe(0);
        });

        it('returns tasks in priority order', () => {
            manager.enqueue(createTestTask({ priority: 'low', displayName: 'low' }));
            manager.enqueue(createTestTask({ priority: 'high', displayName: 'high' }));

            expect(manager.dequeue()!.displayName).toBe('high');
            expect(manager.dequeue()!.displayName).toBe('low');
        });
    });

    describe('peek', () => {
        it('returns undefined for empty queue', () => {
            expect(manager.peek()).toBeUndefined();
        });

        it('returns first task without removing', () => {
            const id = manager.enqueue(createTestTask());

            expect(manager.peek()!.id).toBe(id);
            expect(manager.size()).toBe(1);
            expect(manager.peek()!.id).toBe(id);
        });
    });

    // ========================================================================
    // Task Operations
    // ========================================================================

    describe('getTask', () => {
        it('finds task in queue', () => {
            const id = manager.enqueue(createTestTask());
            expect(manager.getTask(id)).toBeDefined();
        });

        it('finds task in running', () => {
            const id = manager.enqueue(createTestTask());
            manager.markStarted(id);
            expect(manager.getTask(id)).toBeDefined();
            expect(manager.getTask(id)!.status).toBe('running');
        });

        it('finds task in history', () => {
            const id = manager.enqueue(createTestTask());
            manager.markStarted(id);
            manager.markCompleted(id, 'result');
            expect(manager.getTask(id)).toBeDefined();
            expect(manager.getTask(id)!.status).toBe('completed');
        });

        it('returns undefined for unknown ID', () => {
            expect(manager.getTask('unknown-id')).toBeUndefined();
        });
    });

    describe('updateTask', () => {
        it('updates task in queue', () => {
            const id = manager.enqueue(createTestTask({ displayName: 'original' }));
            const result = manager.updateTask(id, { displayName: 'updated' });

            expect(result).toBe(true);
            expect(manager.getTask(id)!.displayName).toBe('updated');
        });

        it('updates task in running', () => {
            const id = manager.enqueue(createTestTask());
            manager.markStarted(id);
            const result = manager.updateTask(id, { displayName: 'updated' });

            expect(result).toBe(true);
            expect(manager.getTask(id)!.displayName).toBe('updated');
        });

        it('updates task in history', () => {
            const id = manager.enqueue(createTestTask());
            manager.markStarted(id);
            manager.markCompleted(id);
            const result = manager.updateTask(id, { displayName: 'updated' });

            expect(result).toBe(true);
            expect(manager.getTask(id)!.displayName).toBe('updated');
        });

        it('re-sorts queue when priority changes', () => {
            const id1 = manager.enqueue(createTestTask({ priority: 'high' }));
            const id2 = manager.enqueue(createTestTask({ priority: 'low' }));

            // Change low to high
            manager.updateTask(id2, { priority: 'high' });

            // id1 should still be first (earlier timestamp)
            const tasks = manager.getQueued();
            expect(tasks[0].id).toBe(id1);
        });

        it('returns false for unknown ID', () => {
            expect(manager.updateTask('unknown', { displayName: 'x' })).toBe(false);
        });

        it('emits taskUpdated event', () => {
            const listener = vi.fn();
            manager.on('taskUpdated', listener);

            const id = manager.enqueue(createTestTask());
            manager.updateTask(id, { displayName: 'updated' });

            expect(listener).toHaveBeenCalledTimes(1);
        });
    });

    describe('removeTask', () => {
        it('removes task from queue', () => {
            const id = manager.enqueue(createTestTask());
            const result = manager.removeTask(id);

            expect(result).toBe(true);
            expect(manager.size()).toBe(0);
            expect(manager.getTask(id)).toBeUndefined();
        });

        it('returns false for running task', () => {
            const id = manager.enqueue(createTestTask());
            manager.markStarted(id);

            expect(manager.removeTask(id)).toBe(false);
        });

        it('returns false for unknown ID', () => {
            expect(manager.removeTask('unknown')).toBe(false);
        });

        it('emits taskRemoved event', () => {
            const listener = vi.fn();
            manager.on('taskRemoved', listener);

            const id = manager.enqueue(createTestTask());
            manager.removeTask(id);

            expect(listener).toHaveBeenCalledTimes(1);
        });
    });

    describe('cancelTask', () => {
        it('cancels queued task', () => {
            const id = manager.enqueue(createTestTask());
            const result = manager.cancelTask(id);

            expect(result).toBe(true);
            expect(manager.size()).toBe(0);
            expect(manager.getTask(id)!.status).toBe('cancelled');
        });

        it('cancels running task', () => {
            const id = manager.enqueue(createTestTask());
            manager.markStarted(id);
            const result = manager.cancelTask(id);

            expect(result).toBe(true);
            expect(manager.getRunning()).toHaveLength(0);
            expect(manager.getTask(id)!.status).toBe('cancelled');
        });

        it('returns false for unknown ID', () => {
            expect(manager.cancelTask('unknown')).toBe(false);
        });

        it('emits taskCancelled event', () => {
            const listener = vi.fn();
            manager.on('taskCancelled', listener);

            const id = manager.enqueue(createTestTask());
            manager.cancelTask(id);

            expect(listener).toHaveBeenCalledTimes(1);
        });

        it('sets completedAt timestamp', () => {
            const id = manager.enqueue(createTestTask());
            manager.cancelTask(id);

            expect(manager.getTask(id)!.completedAt).toBeGreaterThan(0);
        });
    });

    // ========================================================================
    // State Transitions
    // ========================================================================

    describe('markStarted', () => {
        it('moves task from queue to running', () => {
            const id = manager.enqueue(createTestTask());
            const task = manager.markStarted(id);

            expect(task).toBeDefined();
            expect(task!.status).toBe('running');
            expect(task!.startedAt).toBeGreaterThan(0);
            expect(manager.size()).toBe(0);
            expect(manager.getRunning()).toHaveLength(1);
        });

        it('returns undefined for unknown ID', () => {
            expect(manager.markStarted('unknown')).toBeUndefined();
        });

        it('emits taskStarted event', () => {
            const listener = vi.fn();
            manager.on('taskStarted', listener);

            const id = manager.enqueue(createTestTask());
            manager.markStarted(id);

            expect(listener).toHaveBeenCalledTimes(1);
        });
    });

    describe('markCompleted', () => {
        it('moves task from running to history', () => {
            const id = manager.enqueue(createTestTask());
            manager.markStarted(id);
            const task = manager.markCompleted(id, { data: 'result' });

            expect(task).toBeDefined();
            expect(task!.status).toBe('completed');
            expect(task!.completedAt).toBeGreaterThan(0);
            expect(task!.result).toEqual({ data: 'result' });
            expect(manager.getRunning()).toHaveLength(0);
            expect(manager.getCompleted()).toHaveLength(1);
        });

        it('returns undefined for unknown ID', () => {
            expect(manager.markCompleted('unknown')).toBeUndefined();
        });

        it('emits taskCompleted event', () => {
            const listener = vi.fn();
            manager.on('taskCompleted', listener);

            const id = manager.enqueue(createTestTask());
            manager.markStarted(id);
            manager.markCompleted(id, 'result');

            expect(listener).toHaveBeenCalledTimes(1);
            expect(listener.mock.calls[0][1]).toBe('result');
        });
    });

    describe('markFailed', () => {
        it('moves task from running to history with error', () => {
            const id = manager.enqueue(createTestTask());
            manager.markStarted(id);
            const task = manager.markFailed(id, new Error('test error'));

            expect(task).toBeDefined();
            expect(task!.status).toBe('failed');
            expect(task!.error).toBe('test error');
            expect(manager.getFailed()).toHaveLength(1);
        });

        it('accepts string error', () => {
            const id = manager.enqueue(createTestTask());
            manager.markStarted(id);
            const task = manager.markFailed(id, 'string error');

            expect(task!.error).toBe('string error');
        });

        it('emits taskFailed event', () => {
            const listener = vi.fn();
            manager.on('taskFailed', listener);

            const id = manager.enqueue(createTestTask());
            manager.markStarted(id);
            manager.markFailed(id, new Error('test'));

            expect(listener).toHaveBeenCalledTimes(1);
            expect(listener.mock.calls[0][1]).toBeInstanceOf(Error);
        });
    });

    describe('markRetry', () => {
        it('increments retry count', () => {
            const id = manager.enqueue(createTestTask());
            manager.markStarted(id);
            manager.markRetry(id, false);

            expect(manager.getTask(id)!.retryCount).toBe(1);
        });

        it('re-queues task when requeue is true', () => {
            const id = manager.enqueue(createTestTask());
            manager.markStarted(id);
            manager.markRetry(id, true);

            expect(manager.getRunning()).toHaveLength(0);
            expect(manager.size()).toBe(1);
            expect(manager.getTask(id)!.status).toBe('queued');
        });

        it('keeps task running when requeue is false', () => {
            const id = manager.enqueue(createTestTask());
            manager.markStarted(id);
            manager.markRetry(id, false);

            expect(manager.getRunning()).toHaveLength(1);
        });
    });

    // ========================================================================
    // Reordering
    // ========================================================================

    describe('moveToTop', () => {
        it('moves task to first position', () => {
            const id1 = manager.enqueue(createTestTask({ displayName: 'first' }));
            const id2 = manager.enqueue(createTestTask({ displayName: 'second' }));
            const id3 = manager.enqueue(createTestTask({ displayName: 'third' }));

            manager.moveToTop(id3);

            const tasks = manager.getQueued();
            expect(tasks[0].id).toBe(id3);
        });

        it('sets priority to high', () => {
            const id = manager.enqueue(createTestTask({ priority: 'low' }));
            manager.enqueue(createTestTask());

            manager.moveToTop(id);

            expect(manager.getTask(id)!.priority).toBe('high');
        });

        it('returns true when already at top', () => {
            const id = manager.enqueue(createTestTask());
            expect(manager.moveToTop(id)).toBe(true);
        });

        it('returns false for unknown ID', () => {
            expect(manager.moveToTop('unknown')).toBe(false);
        });

        it('emits reordered event', () => {
            const listener = vi.fn();
            manager.on('change', listener);

            const id1 = manager.enqueue(createTestTask());
            const id2 = manager.enqueue(createTestTask());
            listener.mockClear();

            manager.moveToTop(id2);

            expect(listener).toHaveBeenCalledWith(
                expect.objectContaining({ type: 'reordered' })
            );
        });
    });

    describe('moveUp', () => {
        it('swaps task with previous', () => {
            const id1 = manager.enqueue(createTestTask({ displayName: 'first' }));
            const id2 = manager.enqueue(createTestTask({ displayName: 'second' }));

            manager.moveUp(id2);

            const tasks = manager.getQueued();
            expect(tasks[0].id).toBe(id2);
            expect(tasks[1].id).toBe(id1);
        });

        it('returns false when already first', () => {
            const id = manager.enqueue(createTestTask());
            expect(manager.moveUp(id)).toBe(false);
        });

        it('returns false for unknown ID', () => {
            expect(manager.moveUp('unknown')).toBe(false);
        });
    });

    describe('moveDown', () => {
        it('swaps task with next', () => {
            const id1 = manager.enqueue(createTestTask({ displayName: 'first' }));
            const id2 = manager.enqueue(createTestTask({ displayName: 'second' }));

            manager.moveDown(id1);

            const tasks = manager.getQueued();
            expect(tasks[0].id).toBe(id2);
            expect(tasks[1].id).toBe(id1);
        });

        it('returns false when already last', () => {
            manager.enqueue(createTestTask());
            const id = manager.enqueue(createTestTask());
            expect(manager.moveDown(id)).toBe(false);
        });

        it('returns false for unknown ID', () => {
            expect(manager.moveDown('unknown')).toBe(false);
        });
    });

    describe('getPosition', () => {
        it('returns 1-based position', () => {
            const id1 = manager.enqueue(createTestTask());
            const id2 = manager.enqueue(createTestTask());
            const id3 = manager.enqueue(createTestTask());

            expect(manager.getPosition(id1)).toBe(1);
            expect(manager.getPosition(id2)).toBe(2);
            expect(manager.getPosition(id3)).toBe(3);
        });

        it('returns -1 for unknown ID', () => {
            expect(manager.getPosition('unknown')).toBe(-1);
        });

        it('returns -1 for running task', () => {
            const id = manager.enqueue(createTestTask());
            manager.markStarted(id);
            expect(manager.getPosition(id)).toBe(-1);
        });
    });

    // ========================================================================
    // Queue Control
    // ========================================================================

    describe('pause/resume', () => {
        it('pause sets paused state', () => {
            manager.pause();
            expect(manager.isPaused()).toBe(true);
        });

        it('resume clears paused state', () => {
            manager.pause();
            manager.resume();
            expect(manager.isPaused()).toBe(false);
        });

        it('pause emits paused event', () => {
            const listener = vi.fn();
            manager.on('paused', listener);

            manager.pause();

            expect(listener).toHaveBeenCalledTimes(1);
        });

        it('resume emits resumed event', () => {
            const listener = vi.fn();
            manager.on('resumed', listener);

            manager.pause();
            manager.resume();

            expect(listener).toHaveBeenCalledTimes(1);
        });

        it('double pause does not emit twice', () => {
            const listener = vi.fn();
            manager.on('paused', listener);

            manager.pause();
            manager.pause();

            expect(listener).toHaveBeenCalledTimes(1);
        });

        it('double resume does not emit twice', () => {
            const listener = vi.fn();
            manager.on('resumed', listener);

            manager.pause();
            manager.resume();
            manager.resume();

            expect(listener).toHaveBeenCalledTimes(1);
        });
    });

    describe('clear', () => {
        it('removes all queued tasks', () => {
            manager.enqueue(createTestTask());
            manager.enqueue(createTestTask());
            manager.enqueue(createTestTask());

            manager.clear();

            expect(manager.size()).toBe(0);
        });

        it('moves tasks to history as cancelled', () => {
            manager.enqueue(createTestTask());
            manager.enqueue(createTestTask());

            manager.clear();

            expect(manager.getCancelled()).toHaveLength(2);
        });

        it('does not affect running tasks', () => {
            const id = manager.enqueue(createTestTask());
            manager.markStarted(id);
            manager.enqueue(createTestTask());

            manager.clear();

            expect(manager.getRunning()).toHaveLength(1);
            expect(manager.size()).toBe(0);
        });

        it('emits cleared event', () => {
            const listener = vi.fn();
            manager.on('change', listener);

            manager.enqueue(createTestTask());
            listener.mockClear();

            manager.clear();

            expect(listener).toHaveBeenCalledWith(
                expect.objectContaining({ type: 'cleared' })
            );
        });
    });

    describe('clearHistory', () => {
        it('removes all history', () => {
            const id = manager.enqueue(createTestTask());
            manager.markStarted(id);
            manager.markCompleted(id);

            manager.clearHistory();

            expect(manager.getHistory()).toHaveLength(0);
        });
    });

    describe('reset', () => {
        it('clears everything', () => {
            const id1 = manager.enqueue(createTestTask());
            manager.markStarted(id1);
            manager.enqueue(createTestTask());
            manager.markStarted(manager.enqueue(createTestTask()));
            manager.markCompleted(id1);
            manager.pause();

            manager.reset();

            expect(manager.size()).toBe(0);
            expect(manager.getRunning()).toHaveLength(0);
            expect(manager.getHistory()).toHaveLength(0);
            expect(manager.isPaused()).toBe(false);
        });
    });

    // ========================================================================
    // Statistics
    // ========================================================================

    describe('getStats', () => {
        it('returns correct statistics', () => {
            // Add some tasks
            const id1 = manager.enqueue(createTestTask());
            const id2 = manager.enqueue(createTestTask());
            const id3 = manager.enqueue(createTestTask());
            const id4 = manager.enqueue(createTestTask());

            // Start one
            manager.markStarted(id1);

            // Complete one
            manager.markStarted(id2);
            manager.markCompleted(id2);

            // Fail one
            manager.markStarted(id3);
            manager.markFailed(id3, 'error');

            const stats = manager.getStats();

            expect(stats.queued).toBe(1);
            expect(stats.running).toBe(1);
            expect(stats.completed).toBe(1);
            expect(stats.failed).toBe(1);
            expect(stats.cancelled).toBe(0);
            expect(stats.total).toBe(4);
            expect(stats.isPaused).toBe(false);
        });

        it('includes paused state', () => {
            manager.pause();
            expect(manager.getStats().isPaused).toBe(true);
        });
    });

    // ========================================================================
    // History Management
    // ========================================================================

    describe('history', () => {
        it('respects maxHistorySize', () => {
            const m = createTaskQueueManager({ maxHistorySize: 3 });

            for (let i = 0; i < 5; i++) {
                const id = m.enqueue(createTestTask({ displayName: `task-${i}` }));
                m.markStarted(id);
                m.markCompleted(id);
            }

            expect(m.getHistory()).toHaveLength(3);
            // Most recent should be first
            expect(m.getHistory()[0].displayName).toBe('task-4');
        });

        it('does not keep history when disabled', () => {
            const m = createTaskQueueManager({ keepHistory: false });

            const id = m.enqueue(createTestTask());
            m.markStarted(id);
            m.markCompleted(id);

            expect(m.getHistory()).toHaveLength(0);
        });
    });

    // ========================================================================
    // restoreHistory
    // ========================================================================

    describe('restoreHistory', () => {
        it('prepends restored tasks to history', () => {
            // Add one task to history via normal flow
            const id = manager.enqueue(createTestTask({ displayName: 'existing' }));
            manager.markStarted(id);
            manager.markCompleted(id);

            const restoredTasks: QueuedTask[] = [
                { id: 'r1', type: 'custom', priority: 'normal', status: 'completed', createdAt: 1000, completedAt: 2000, payload: { data: {} }, config: {}, displayName: 'restored-1' },
                { id: 'r2', type: 'custom', priority: 'normal', status: 'failed', createdAt: 900, completedAt: 1500, error: 'oops', payload: { data: {} }, config: {}, displayName: 'restored-2' },
            ] as QueuedTask[];

            manager.restoreHistory(restoredTasks);

            const history = manager.getHistory();
            expect(history).toHaveLength(3);
            // Current history first, then restored
            expect(history[0].displayName).toBe('existing');
            expect(history[1].displayName).toBe('restored-1');
            expect(history[2].displayName).toBe('restored-2');
        });

        it('respects maxHistorySize when restoring', () => {
            const m = createTaskQueueManager({ maxHistorySize: 3 });

            // Add 2 existing tasks
            for (let i = 0; i < 2; i++) {
                const id = m.enqueue(createTestTask({ displayName: `existing-${i}` }));
                m.markStarted(id);
                m.markCompleted(id);
            }

            // Restore 3 more — should trim to 3 total
            const restoredTasks = Array.from({ length: 3 }, (_, i) => ({
                id: `r${i}`, type: 'custom' as const, priority: 'normal' as const,
                status: 'completed' as const, createdAt: 1000 + i, completedAt: 2000 + i,
                payload: { data: {} }, config: {}, displayName: `restored-${i}`,
            })) as QueuedTask[];

            m.restoreHistory(restoredTasks);

            expect(m.getHistory()).toHaveLength(3);
        });

        it('does nothing when keepHistory is false', () => {
            const m = createTaskQueueManager({ keepHistory: false });

            const restoredTasks: QueuedTask[] = [
                { id: 'r1', type: 'custom', priority: 'normal', status: 'completed', createdAt: 1000, payload: { data: {} }, config: {} },
            ] as QueuedTask[];

            m.restoreHistory(restoredTasks);
            expect(m.getHistory()).toHaveLength(0);
        });

        it('does nothing with empty array', () => {
            manager.restoreHistory([]);
            expect(manager.getHistory()).toHaveLength(0);
        });

        it('handles large restore exceeding maxHistorySize', () => {
            const m = createTaskQueueManager({ maxHistorySize: 5 });

            const restoredTasks = Array.from({ length: 10 }, (_, i) => ({
                id: `r${i}`, type: 'custom' as const, priority: 'normal' as const,
                status: 'completed' as const, createdAt: 1000 + i,
                payload: { data: {} }, config: {}, displayName: `restored-${i}`,
            })) as QueuedTask[];

            m.restoreHistory(restoredTasks);
            expect(m.getHistory()).toHaveLength(5);
        });
    });

    // ========================================================================
    // Access Methods
    // ========================================================================

    describe('getAll', () => {
        it('returns all tasks', () => {
            const id1 = manager.enqueue(createTestTask());
            const id2 = manager.enqueue(createTestTask());
            manager.markStarted(id1);
            manager.markCompleted(id1);

            const all = manager.getAll();
            expect(all).toHaveLength(2);
        });
    });

    describe('getQueued', () => {
        it('returns copy of queue', () => {
            manager.enqueue(createTestTask());
            const queued = manager.getQueued();
            queued.push({} as QueuedTask);

            expect(manager.size()).toBe(1);
        });
    });

    describe('getRunning', () => {
        it('returns running tasks', () => {
            const id = manager.enqueue(createTestTask());
            manager.markStarted(id);

            expect(manager.getRunning()).toHaveLength(1);
        });
    });

    describe('getCompleted/getFailed/getCancelled', () => {
        it('filters history correctly', () => {
            const id1 = manager.enqueue(createTestTask());
            const id2 = manager.enqueue(createTestTask());
            const id3 = manager.enqueue(createTestTask());

            manager.markStarted(id1);
            manager.markCompleted(id1);

            manager.markStarted(id2);
            manager.markFailed(id2, 'error');

            manager.cancelTask(id3);

            expect(manager.getCompleted()).toHaveLength(1);
            expect(manager.getFailed()).toHaveLength(1);
            expect(manager.getCancelled()).toHaveLength(1);
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
