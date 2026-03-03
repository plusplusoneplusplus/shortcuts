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
    generateTaskId,
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
            expect(taskId).toMatch(/^\d+-[a-z0-9]+$/);
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

    describe('moveToPosition', () => {
        it('moves task forward (index 0 → 2)', () => {
            const id1 = manager.enqueue(createTestTask({ displayName: 'first' }));
            const id2 = manager.enqueue(createTestTask({ displayName: 'second' }));
            const id3 = manager.enqueue(createTestTask({ displayName: 'third' }));

            manager.moveToPosition(id1, 2);

            const tasks = manager.getQueued();
            expect(tasks[0].id).toBe(id2);
            expect(tasks[1].id).toBe(id3);
            expect(tasks[2].id).toBe(id1);
        });

        it('moves task backward (index 2 → 0)', () => {
            const id1 = manager.enqueue(createTestTask({ displayName: 'first' }));
            const id2 = manager.enqueue(createTestTask({ displayName: 'second' }));
            const id3 = manager.enqueue(createTestTask({ displayName: 'third' }));

            manager.moveToPosition(id3, 0);

            const tasks = manager.getQueued();
            expect(tasks[0].id).toBe(id3);
            expect(tasks[1].id).toBe(id1);
            expect(tasks[2].id).toBe(id2);
        });

        it('returns true when already at target position (noop)', () => {
            const id1 = manager.enqueue(createTestTask());
            manager.enqueue(createTestTask());

            expect(manager.moveToPosition(id1, 0)).toBe(true);
            expect(manager.getQueued()[0].id).toBe(id1);
        });

        it('returns false for unknown ID', () => {
            expect(manager.moveToPosition('unknown', 0)).toBe(false);
        });

        it('clamps out-of-bounds index to last position', () => {
            const id1 = manager.enqueue(createTestTask({ displayName: 'first' }));
            const id2 = manager.enqueue(createTestTask({ displayName: 'second' }));
            const id3 = manager.enqueue(createTestTask({ displayName: 'third' }));

            manager.moveToPosition(id1, 999);

            const tasks = manager.getQueued();
            expect(tasks[2].id).toBe(id1);
        });

        it('clamps negative index to 0', () => {
            const id1 = manager.enqueue(createTestTask({ displayName: 'first' }));
            const id2 = manager.enqueue(createTestTask({ displayName: 'second' }));
            const id3 = manager.enqueue(createTestTask({ displayName: 'third' }));

            manager.moveToPosition(id3, -5);

            const tasks = manager.getQueued();
            expect(tasks[0].id).toBe(id3);
        });

        it('does not mutate priority', () => {
            const id = manager.enqueue(createTestTask({ priority: 'low' }));
            manager.enqueue(createTestTask());

            manager.moveToPosition(id, 0);

            expect(manager.getTask(id)!.priority).toBe('low');
        });

        it('emits reordered event', () => {
            const listener = vi.fn();
            manager.on('change', listener);

            const id1 = manager.enqueue(createTestTask());
            const id2 = manager.enqueue(createTestTask());
            listener.mockClear();

            manager.moveToPosition(id2, 0);

            expect(listener).toHaveBeenCalledWith(
                expect.objectContaining({ type: 'reordered' })
            );
        });

        it('moves to end position', () => {
            const id1 = manager.enqueue(createTestTask({ displayName: 'first' }));
            const id2 = manager.enqueue(createTestTask({ displayName: 'second' }));
            const id3 = manager.enqueue(createTestTask({ displayName: 'third' }));

            manager.moveToPosition(id1, 2);

            expect(manager.getPosition(id1)).toBe(3);
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

    // ========================================================================
    // Force-Fail Operations
    // ========================================================================

    describe('forceFailRunning', () => {
        it('force-fails all running tasks', () => {
            const id1 = manager.enqueue(createTestTask());
            const id2 = manager.enqueue(createTestTask());
            manager.markStarted(id1);
            manager.markStarted(id2);

            expect(manager.getRunning()).toHaveLength(2);

            const count = manager.forceFailRunning('stale');
            expect(count).toBe(2);
            expect(manager.getRunning()).toHaveLength(0);
            expect(manager.getFailed()).toHaveLength(2);
        });

        it('sets error message and completedAt on force-failed tasks', () => {
            const id = manager.enqueue(createTestTask());
            manager.markStarted(id);

            manager.forceFailRunning('Custom stale message');

            const task = manager.getTask(id);
            expect(task!.status).toBe('failed');
            expect(task!.error).toBe('Custom stale message');
            expect(task!.completedAt).toBeGreaterThan(0);
        });

        it('returns 0 when no running tasks', () => {
            manager.enqueue(createTestTask());
            const count = manager.forceFailRunning();
            expect(count).toBe(0);
        });

        it('does not affect queued tasks', () => {
            const id1 = manager.enqueue(createTestTask());
            const id2 = manager.enqueue(createTestTask());
            manager.markStarted(id1);

            manager.forceFailRunning();

            expect(manager.size()).toBe(1); // id2 still queued
            expect(manager.getTask(id2)!.status).toBe('queued');
        });

        it('emits taskFailed events for each force-failed task', () => {
            const listener = vi.fn();
            manager.on('taskFailed', listener);

            const id1 = manager.enqueue(createTestTask());
            const id2 = manager.enqueue(createTestTask());
            manager.markStarted(id1);
            manager.markStarted(id2);

            manager.forceFailRunning('error');

            expect(listener).toHaveBeenCalledTimes(2);
        });

        it('emits change events for each force-failed task', () => {
            const listener = vi.fn();
            manager.on('change', listener);

            const id = manager.enqueue(createTestTask());
            manager.markStarted(id);
            listener.mockClear();

            manager.forceFailRunning();

            expect(listener).toHaveBeenCalledTimes(1);
            expect(listener.mock.calls[0][0].type).toBe('updated');
        });

        it('uses default error message when not provided', () => {
            const id = manager.enqueue(createTestTask());
            manager.markStarted(id);

            manager.forceFailRunning();

            const task = manager.getTask(id);
            expect(task!.error).toBe('Task was force-failed (assumed stale)');
        });

        it('moves tasks to history', () => {
            const id1 = manager.enqueue(createTestTask());
            const id2 = manager.enqueue(createTestTask());
            manager.markStarted(id1);
            manager.markStarted(id2);

            manager.forceFailRunning();

            expect(manager.getHistory()).toHaveLength(2);
            expect(manager.getHistory().every(t => t.status === 'failed')).toBe(true);
        });
    });

    describe('forceFailTask', () => {
        it('force-fails a single running task', () => {
            const id = manager.enqueue(createTestTask());
            manager.markStarted(id);

            const success = manager.forceFailTask(id, 'stale');
            expect(success).toBe(true);
            expect(manager.getRunning()).toHaveLength(0);
            expect(manager.getFailed()).toHaveLength(1);
        });

        it('returns false for non-existent task', () => {
            const success = manager.forceFailTask('nonexistent');
            expect(success).toBe(false);
        });

        it('returns false for queued (non-running) task', () => {
            const id = manager.enqueue(createTestTask());
            const success = manager.forceFailTask(id);
            expect(success).toBe(false);
        });

        it('sets error and completedAt', () => {
            const id = manager.enqueue(createTestTask());
            manager.markStarted(id);

            manager.forceFailTask(id, 'Custom error');

            const task = manager.getTask(id);
            expect(task!.status).toBe('failed');
            expect(task!.error).toBe('Custom error');
            expect(task!.completedAt).toBeGreaterThan(0);
        });

        it('does not affect other running tasks', () => {
            const id1 = manager.enqueue(createTestTask());
            const id2 = manager.enqueue(createTestTask());
            manager.markStarted(id1);
            manager.markStarted(id2);

            manager.forceFailTask(id1, 'fail one');

            expect(manager.getRunning()).toHaveLength(1);
            expect(manager.getTask(id2)!.status).toBe('running');
        });

        it('emits taskFailed event', () => {
            const listener = vi.fn();
            manager.on('taskFailed', listener);

            const id = manager.enqueue(createTestTask());
            manager.markStarted(id);

            manager.forceFailTask(id, 'error');

            expect(listener).toHaveBeenCalledTimes(1);
        });

        it('uses default error message when not provided', () => {
            const id = manager.enqueue(createTestTask());
            manager.markStarted(id);

            manager.forceFailTask(id);

            const task = manager.getTask(id);
            expect(task!.error).toBe('Task was force-failed (assumed stale)');
        });
    });

    // ========================================================================
    // Drain Mode
    // ========================================================================

    describe('drain mode', () => {
        it('enterDrainMode sets draining state', () => {
            manager.enterDrainMode();
            expect(manager.isDraining()).toBe(true);
        });

        it('exitDrainMode clears draining state', () => {
            manager.enterDrainMode();
            expect(manager.isDraining()).toBe(true);

            manager.exitDrainMode();
            expect(manager.isDraining()).toBe(false);
        });

        it('enterDrainMode is idempotent (no double event)', () => {
            const handler = vi.fn();
            manager.on('drain-started', handler);

            manager.enterDrainMode();
            manager.enterDrainMode(); // second call should be no-op
            expect(handler).toHaveBeenCalledTimes(1);
        });

        it('exitDrainMode is idempotent', () => {
            const handler = vi.fn();
            manager.on('drain-cancelled', handler);

            manager.enterDrainMode();
            manager.exitDrainMode();
            manager.exitDrainMode(); // second call should be no-op
            expect(handler).toHaveBeenCalledTimes(1);
        });

        it('enqueue rejects when draining', () => {
            manager.enterDrainMode();

            expect(() => {
                manager.enqueue(createTestTask());
            }).toThrow('Queue is draining — no new tasks accepted');
        });

        it('enqueue works again after exitDrainMode', () => {
            manager.enterDrainMode();
            manager.exitDrainMode();

            const id = manager.enqueue(createTestTask());
            expect(id).toBeTruthy();
            expect(manager.size()).toBe(1);
        });

        it('getStats includes isDraining', () => {
            expect(manager.getStats().isDraining).toBe(false);

            manager.enterDrainMode();
            expect(manager.getStats().isDraining).toBe(true);

            manager.exitDrainMode();
            expect(manager.getStats().isDraining).toBe(false);
        });

        it('emits drain-started change event', () => {
            const handler = vi.fn();
            manager.on('change', handler);

            manager.enterDrainMode();

            expect(handler).toHaveBeenCalledWith(
                expect.objectContaining({ type: 'drain-started' })
            );
        });

        it('emits drain-cancelled change event', () => {
            manager.enterDrainMode();

            const handler = vi.fn();
            manager.on('change', handler);

            manager.exitDrainMode();

            expect(handler).toHaveBeenCalledWith(
                expect.objectContaining({ type: 'drain-cancelled' })
            );
        });

        it('reset clears draining state', () => {
            manager.enterDrainMode();
            manager.reset();
            expect(manager.isDraining()).toBe(false);
        });
    });

    describe('getTaskCounts', () => {
        it('returns zero counts when empty', () => {
            const counts = manager.getTaskCounts();
            expect(counts).toEqual({ queued: 0, running: 0, total: 0 });
        });

        it('counts queued tasks', () => {
            manager.enqueue(createTestTask());
            manager.enqueue(createTestTask());

            const counts = manager.getTaskCounts();
            expect(counts).toEqual({ queued: 2, running: 0, total: 2 });
        });

        it('counts running tasks', () => {
            const id = manager.enqueue(createTestTask());
            manager.markStarted(id);

            const counts = manager.getTaskCounts();
            expect(counts).toEqual({ queued: 0, running: 1, total: 1 });
        });

        it('counts both queued and running', () => {
            const id1 = manager.enqueue(createTestTask());
            manager.enqueue(createTestTask());
            manager.markStarted(id1);

            const counts = manager.getTaskCounts();
            expect(counts).toEqual({ queued: 1, running: 1, total: 2 });
        });
    });

    describe('waitUntilIdle', () => {
        it('resolves immediately when queue is empty', async () => {
            await expect(manager.waitUntilIdle()).resolves.toBeUndefined();
        });

        it('waits for queued tasks to drain', async () => {
            const id = manager.enqueue(createTestTask());
            let resolved = false;

            const promise = manager.waitUntilIdle().then(() => { resolved = true; });

            expect(resolved).toBe(false);

            // Mark started then completed
            manager.markStarted(id);
            expect(resolved).toBe(false);

            manager.markCompleted(id, 'done');

            await promise;
            expect(resolved).toBe(true);
        });

        it('waits for running tasks to finish', async () => {
            const id = manager.enqueue(createTestTask());
            manager.markStarted(id);
            let resolved = false;

            const promise = manager.waitUntilIdle().then(() => { resolved = true; });

            expect(resolved).toBe(false);

            manager.markCompleted(id, 'done');

            await promise;
            expect(resolved).toBe(true);
        });

        it('resolves when task fails (failure counts as completion)', async () => {
            const id = manager.enqueue(createTestTask());
            manager.markStarted(id);
            let resolved = false;

            const promise = manager.waitUntilIdle().then(() => { resolved = true; });

            manager.markFailed(id, 'error');

            await promise;
            expect(resolved).toBe(true);
        });

        it('resolves when running task is cancelled', async () => {
            const id = manager.enqueue(createTestTask());
            manager.markStarted(id);
            let resolved = false;

            const promise = manager.waitUntilIdle().then(() => { resolved = true; });

            manager.cancelTask(id);

            await promise;
            expect(resolved).toBe(true);
        });

        it('resolves when forceFailRunning is called', async () => {
            const id = manager.enqueue(createTestTask());
            manager.markStarted(id);
            let resolved = false;

            const promise = manager.waitUntilIdle().then(() => { resolved = true; });

            manager.forceFailRunning();

            await promise;
            expect(resolved).toBe(true);
        });

        it('resolves when forceFailTask is called', async () => {
            const id = manager.enqueue(createTestTask());
            manager.markStarted(id);
            let resolved = false;

            const promise = manager.waitUntilIdle().then(() => { resolved = true; });

            manager.forceFailTask(id);

            await promise;
            expect(resolved).toBe(true);
        });

        it('resolves on reset', async () => {
            const id = manager.enqueue(createTestTask());
            manager.markStarted(id);

            const promise = manager.waitUntilIdle();

            manager.reset();

            await expect(promise).resolves.toBeUndefined();
        });

        it('multiple waiters all resolve', async () => {
            const id = manager.enqueue(createTestTask());
            manager.markStarted(id);

            const results: number[] = [];
            const p1 = manager.waitUntilIdle().then(() => results.push(1));
            const p2 = manager.waitUntilIdle().then(() => results.push(2));
            const p3 = manager.waitUntilIdle().then(() => results.push(3));

            manager.markCompleted(id, 'done');

            await Promise.all([p1, p2, p3]);
            expect(results).toHaveLength(3);
        });

        it('exitDrainMode clears idle resolvers without resolving', async () => {
            const id = manager.enqueue(createTestTask());
            manager.markStarted(id);
            manager.enterDrainMode();
            let resolved = false;

            // This waiter should never resolve because exitDrainMode clears them
            manager.waitUntilIdle().then(() => { resolved = true; });

            manager.exitDrainMode();

            // Give microtask queue a chance to settle
            await new Promise(r => setTimeout(r, 50));
            expect(resolved).toBe(false);
        });
    });

    // ========================================================================
    // Per-Repo Pause
    // ========================================================================

    describe('per-repo pause', () => {
        let repoManager: TaskQueueManager;

        beforeEach(() => {
            repoManager = new TaskQueueManager({
                getTaskRepoId: (task) => {
                    const payload = task.payload as Record<string, unknown>;
                    return (payload?.repoId as string) || 'default';
                },
            });
        });

        it('pauseRepo marks a repo as paused', () => {
            repoManager.pauseRepo('repo-A');
            expect(repoManager.isRepoPaused('repo-A')).toBe(true);
            expect(repoManager.isRepoPaused('repo-B')).toBe(false);
        });

        it('resumeRepo clears paused state', () => {
            repoManager.pauseRepo('repo-A');
            repoManager.resumeRepo('repo-A');
            expect(repoManager.isRepoPaused('repo-A')).toBe(false);
        });

        it('getPausedRepos returns all paused repo IDs', () => {
            repoManager.pauseRepo('repo-A');
            repoManager.pauseRepo('repo-B');
            const paused = repoManager.getPausedRepos().sort();
            expect(paused).toEqual(['repo-A', 'repo-B']);
        });

        it('double pauseRepo is idempotent', () => {
            const listener = vi.fn();
            repoManager.on('repo-paused', listener);

            repoManager.pauseRepo('repo-A');
            repoManager.pauseRepo('repo-A');

            expect(listener).toHaveBeenCalledTimes(1);
        });

        it('resumeRepo on non-paused repo is no-op', () => {
            const listener = vi.fn();
            repoManager.on('repo-resumed', listener);

            repoManager.resumeRepo('repo-A');

            expect(listener).not.toHaveBeenCalled();
        });

        it('emits repo-paused event with repoId', () => {
            const listener = vi.fn();
            repoManager.on('repo-paused', listener);

            repoManager.pauseRepo('repo-X');

            expect(listener).toHaveBeenCalledWith('repo-X');
        });

        it('emits repo-resumed event with repoId', () => {
            const listener = vi.fn();
            repoManager.on('repo-resumed', listener);

            repoManager.pauseRepo('repo-X');
            repoManager.resumeRepo('repo-X');

            expect(listener).toHaveBeenCalledWith('repo-X');
        });

        it('emits change event on repo-paused', () => {
            const listener = vi.fn();
            repoManager.on('change', listener);

            repoManager.pauseRepo('repo-A');

            expect(listener).toHaveBeenCalledWith(
                expect.objectContaining({ type: 'repo-paused' })
            );
        });

        it('emits change event on repo-resumed', () => {
            repoManager.pauseRepo('repo-A');
            const listener = vi.fn();
            repoManager.on('change', listener);

            repoManager.resumeRepo('repo-A');

            expect(listener).toHaveBeenCalledWith(
                expect.objectContaining({ type: 'repo-resumed' })
            );
        });

        it('dequeue skips tasks from paused repos', () => {
            const idA = repoManager.enqueue(createTestTask({ payload: { repoId: 'repo-A' } as any }));
            const idB = repoManager.enqueue(createTestTask({ payload: { repoId: 'repo-B' } as any }));

            repoManager.pauseRepo('repo-A');

            const task = repoManager.dequeue();
            expect(task).toBeDefined();
            expect(task!.id).toBe(idB);
        });

        it('dequeue returns undefined when all tasks are from paused repos', () => {
            repoManager.enqueue(createTestTask({ payload: { repoId: 'repo-A' } as any }));
            repoManager.enqueue(createTestTask({ payload: { repoId: 'repo-A' } as any }));

            repoManager.pauseRepo('repo-A');

            expect(repoManager.dequeue()).toBeUndefined();
        });

        it('dequeue returns task after repo is resumed', () => {
            repoManager.enqueue(createTestTask({ payload: { repoId: 'repo-A' } as any }));

            repoManager.pauseRepo('repo-A');
            expect(repoManager.dequeue()).toBeUndefined();

            repoManager.resumeRepo('repo-A');
            expect(repoManager.dequeue()).toBeDefined();
        });

        it('dequeue works normally when no repos are paused', () => {
            const id = repoManager.enqueue(createTestTask({ payload: { repoId: 'repo-A' } as any }));
            const task = repoManager.dequeue();
            expect(task).toBeDefined();
            expect(task!.id).toBe(id);
        });

        it('dequeue works normally without getTaskRepoId', () => {
            // Use default manager without getTaskRepoId
            const id = manager.enqueue(createTestTask());
            const task = manager.dequeue();
            expect(task).toBeDefined();
            expect(task!.id).toBe(id);
        });

        it('getStats includes pausedRepos', () => {
            repoManager.pauseRepo('repo-A');
            repoManager.pauseRepo('repo-B');

            const stats = repoManager.getStats();
            expect(stats.pausedRepos).toHaveLength(2);
            expect(stats.pausedRepos.sort()).toEqual(['repo-A', 'repo-B']);
        });

        it('getStats returns empty pausedRepos by default', () => {
            const stats = manager.getStats();
            expect(stats.pausedRepos).toEqual([]);
        });

        it('reset clears pausedRepos', () => {
            repoManager.pauseRepo('repo-A');
            repoManager.reset();

            expect(repoManager.isRepoPaused('repo-A')).toBe(false);
            expect(repoManager.getPausedRepos()).toEqual([]);
        });

        it('mixed repos: only tasks from unpaused repos are dequeued', () => {
            repoManager.enqueue(createTestTask({ payload: { repoId: 'repo-A' } as any, displayName: 'A1' }));
            repoManager.enqueue(createTestTask({ payload: { repoId: 'repo-B' } as any, displayName: 'B1' }));
            repoManager.enqueue(createTestTask({ payload: { repoId: 'repo-A' } as any, displayName: 'A2' }));
            repoManager.enqueue(createTestTask({ payload: { repoId: 'repo-C' } as any, displayName: 'C1' }));

            repoManager.pauseRepo('repo-A');

            const t1 = repoManager.dequeue();
            expect(t1!.displayName).toBe('B1');

            const t2 = repoManager.dequeue();
            expect(t2!.displayName).toBe('C1');

            // Only repo-A tasks remain
            expect(repoManager.dequeue()).toBeUndefined();
            expect(repoManager.size()).toBe(2);

            // Resume repo-A
            repoManager.resumeRepo('repo-A');
            expect(repoManager.dequeue()!.displayName).toBe('A1');
            expect(repoManager.dequeue()!.displayName).toBe('A2');
        });

        it('dequeue allows tasks with undefined repoId when repos are paused', () => {
            // getTaskRepoId returns undefined for tasks without repoId
            const undefinedRepoManager = new TaskQueueManager({
                getTaskRepoId: (task) => (task.payload as any).repoId as string | undefined,
            });

            undefinedRepoManager.enqueue(createTestTask({ payload: { repoId: undefined } as any, displayName: 'no-repo' }));
            undefinedRepoManager.enqueue(createTestTask({ payload: { repoId: 'repo-A' } as any, displayName: 'A1' }));

            undefinedRepoManager.pauseRepo('repo-A');

            // Task with undefined repoId should still be dequeued
            const task = undefinedRepoManager.dequeue();
            expect(task).toBeDefined();
            expect(task!.displayName).toBe('no-repo');

            // repo-A task should be skipped
            expect(undefinedRepoManager.dequeue()).toBeUndefined();
        });
    });

    // ========================================================================
    // Freeze / Unfreeze
    // ========================================================================

    describe('freezeTask', () => {
        it('freezes a queued task', () => {
            const id = manager.enqueue(createTestTask());
            expect(manager.freezeTask(id)).toBe(true);
            expect(manager.getTask(id)!.frozen).toBe(true);
        });

        it('returns false for non-existent task', () => {
            expect(manager.freezeTask('no-such-id')).toBe(false);
        });

        it('returns false for running task', () => {
            const id = manager.enqueue(createTestTask());
            manager.markStarted(id);
            expect(manager.freezeTask(id)).toBe(false);
        });

        it('emits frozen change event', () => {
            const listener = vi.fn();
            manager.on('change', listener);
            const id = manager.enqueue(createTestTask());
            listener.mockClear();

            manager.freezeTask(id);

            expect(listener).toHaveBeenCalledTimes(1);
            expect(listener.mock.calls[0][0].type).toBe('frozen');
            expect(listener.mock.calls[0][0].taskId).toBe(id);
        });

        it('task stays in queued status after freeze', () => {
            const id = manager.enqueue(createTestTask());
            manager.freezeTask(id);
            expect(manager.getTask(id)!.status).toBe('queued');
        });
    });

    describe('unfreezeTask', () => {
        it('unfreezes a frozen task', () => {
            const id = manager.enqueue(createTestTask());
            manager.freezeTask(id);
            expect(manager.unfreezeTask(id)).toBe(true);
            expect(manager.getTask(id)!.frozen).toBe(false);
        });

        it('returns false for non-frozen task', () => {
            const id = manager.enqueue(createTestTask());
            expect(manager.unfreezeTask(id)).toBe(false);
        });

        it('returns false for non-existent task', () => {
            expect(manager.unfreezeTask('no-such-id')).toBe(false);
        });

        it('emits unfrozen change event', () => {
            const listener = vi.fn();
            manager.on('change', listener);
            const id = manager.enqueue(createTestTask());
            manager.freezeTask(id);
            listener.mockClear();

            manager.unfreezeTask(id);

            expect(listener).toHaveBeenCalledTimes(1);
            expect(listener.mock.calls[0][0].type).toBe('unfrozen');
            expect(listener.mock.calls[0][0].taskId).toBe(id);
        });
    });

    describe('peek with frozen tasks', () => {
        it('skips frozen tasks', () => {
            const id1 = manager.enqueue(createTestTask({ displayName: 'T1' }));
            const id2 = manager.enqueue(createTestTask({ displayName: 'T2' }));
            manager.freezeTask(id1);

            const next = manager.peek();
            expect(next).toBeDefined();
            expect(next!.id).toBe(id2);
        });

        it('returns undefined when all tasks frozen', () => {
            const id1 = manager.enqueue(createTestTask());
            const id2 = manager.enqueue(createTestTask());
            manager.freezeTask(id1);
            manager.freezeTask(id2);

            expect(manager.peek()).toBeUndefined();
        });

        it('returns first non-frozen task', () => {
            const id1 = manager.enqueue(createTestTask({ displayName: 'T1' }));
            const id2 = manager.enqueue(createTestTask({ displayName: 'T2' }));
            const id3 = manager.enqueue(createTestTask({ displayName: 'T3' }));
            manager.freezeTask(id1);

            expect(manager.peek()!.id).toBe(id2);
        });
    });

    describe('dequeue with frozen tasks', () => {
        it('skips frozen tasks', () => {
            const id1 = manager.enqueue(createTestTask({ displayName: 'T1' }));
            const id2 = manager.enqueue(createTestTask({ displayName: 'T2' }));
            manager.freezeTask(id1);

            const next = manager.dequeue();
            expect(next).toBeDefined();
            expect(next!.id).toBe(id2);
            // Frozen task stays in queue
            expect(manager.size()).toBe(1);
            expect(manager.getTask(id1)).toBeDefined();
        });

        it('returns undefined when all tasks frozen', () => {
            const id1 = manager.enqueue(createTestTask());
            manager.freezeTask(id1);

            expect(manager.dequeue()).toBeUndefined();
            expect(manager.size()).toBe(1);
        });

        it('frozen task stays at its position after unfreezing', () => {
            const id1 = manager.enqueue(createTestTask({ displayName: 'T1' }));
            const id2 = manager.enqueue(createTestTask({ displayName: 'T2' }));
            manager.freezeTask(id1);
            manager.unfreezeTask(id1);

            const next = manager.dequeue();
            expect(next!.id).toBe(id1);
        });
    });
});

// ============================================================================
// generateTaskId
// ============================================================================

describe('generateTaskId', () => {
    it('returns a string with timestamp-random format', () => {
        const id = generateTaskId();
        expect(typeof id).toBe('string');
        expect(id.length).toBeGreaterThan(0);
    });

    it('does not include a queue- prefix', () => {
        const id = generateTaskId();
        expect(id).not.toMatch(/^queue-/);
    });

    it('matches <timestamp>-<random> pattern', () => {
        const id = generateTaskId();
        expect(id).toMatch(/^\d+-[a-z0-9]+$/);
    });

    it('generates unique IDs', () => {
        const ids = new Set<string>();
        for (let i = 0; i < 100; i++) {
            ids.add(generateTaskId());
        }
        expect(ids.size).toBe(100);
    });

    it('produces IDs that form valid process IDs with queue_ prefix', () => {
        const id = generateTaskId();
        const processId = `queue_${id}`;
        expect(processId).toMatch(/^queue_\d+-[a-z0-9]+$/);
    });
});

// ============================================================================
// repoId Field Support
// ============================================================================

describe('repoId field support', () => {
    let manager: TaskQueueManager;

    beforeEach(() => {
        manager = createTaskQueueManager();
    });

    it('stores repoId when provided on QueuedTask', () => {
        const taskId = manager.enqueue(
            createTestTask({ repoId: 'repo-123' })
        );
        const task = manager.getTask(taskId);
        expect(task?.repoId).toBe('repo-123');
    });

    it('allows undefined repoId for backward compatibility', () => {
        const taskId = manager.enqueue(createTestTask());
        const task = manager.getTask(taskId);
        expect(task?.repoId).toBeUndefined();
    });

    it('preserves repoId through CreateTaskInput', () => {
        const input: CreateTaskInput = {
            type: 'follow-prompt',
            priority: 'normal',
            payload: { promptFilePath: '/test/prompt.md' },
            config: { timeoutMs: 60000 },
            repoId: 'my-repo',
        };
        const taskId = manager.enqueue(input);
        const task = manager.getTask(taskId);
        expect(task?.repoId).toBe('my-repo');
    });

    it('supports repoId on FollowPromptPayload', () => {
        const payload: Record<string, unknown> = {
            promptFilePath: '/test/prompt.md',
            repoId: 'frontend-repo',
        };
        const taskId = manager.enqueue(createTestTask({ payload }));
        const task = manager.getTask(taskId);
        expect((task?.payload as Record<string, unknown>).repoId).toBe('frontend-repo');
    });

    it('supports repoId on CodeReviewPayload', () => {
        const payload: Record<string, unknown> = {
            diffType: 'staged',
            rulesFolder: '/rules',
            repoId: 'backend-repo',
        };
        const taskId = manager.enqueue(createTestTask({
            type: 'code-review',
            payload,
        }));
        const task = manager.getTask(taskId);
        expect((task?.payload as Record<string, unknown>).repoId).toBe('backend-repo');
    });

    it('supports repoId on AIClarificationPayload', () => {
        const payload: Record<string, unknown> = {
            prompt: 'explain this',
            repoId: 'docs-repo',
        };
        const taskId = manager.enqueue(createTestTask({
            type: 'ai-clarification',
            payload,
        }));
        const task = manager.getTask(taskId);
        expect((task?.payload as Record<string, unknown>).repoId).toBe('docs-repo');
    });

    it('allows payload without repoId for backward compatibility', () => {
        const payload: Record<string, unknown> = {
            promptFilePath: '/test/prompt.md',
        };
        const taskId = manager.enqueue(createTestTask({ payload }));
        const task = manager.getTask(taskId);
        expect((task?.payload as Record<string, unknown>).repoId).toBeUndefined();
    });
});

// ============================================================================
// Pause Markers
// ============================================================================

describe('pause markers', () => {
    let manager: TaskQueueManager;

    beforeEach(() => {
        manager = createTaskQueueManager();
    });
    it('insertPauseMarker returns a unique string id', () => {
        manager.enqueue(createTestTask());
        manager.enqueue(createTestTask());
        const markerId = manager.insertPauseMarker(0);
        expect(typeof markerId).toBe('string');
        expect(markerId.length).toBeGreaterThan(0);
    });

    it('insertPauseMarker inserts marker at given index (0-based task offset)', () => {
        manager.enqueue(createTestTask({ displayName: 'T1' }));
        manager.enqueue(createTestTask({ displayName: 'T2' }));
        manager.insertPauseMarker(0); // after first task (index 0)
        const items = manager.getQueueItems();
        expect(items[0]).toMatchObject({ displayName: 'T1' });
        expect(items[1]).toMatchObject({ kind: 'pause-marker' });
        expect(items[2]).toMatchObject({ displayName: 'T2' });
    });

    it('insertPauseMarker at -1 inserts before all tasks', () => {
        manager.enqueue(createTestTask({ displayName: 'T1' }));
        manager.insertPauseMarker(-1);
        const items = manager.getQueueItems();
        expect(items[0]).toMatchObject({ kind: 'pause-marker' });
        expect(items[1]).toMatchObject({ displayName: 'T1' });
    });

    it('removePauseMarker removes the marker by id', () => {
        manager.enqueue(createTestTask());
        const markerId = manager.insertPauseMarker(0);
        expect(manager.getQueueItems().some(i => (i as any).kind === 'pause-marker')).toBe(true);

        const removed = manager.removePauseMarker(markerId);
        expect(removed).toBe(true);
        expect(manager.getQueueItems().some(i => (i as any).kind === 'pause-marker')).toBe(false);
    });

    it('removePauseMarker returns false for unknown id', () => {
        expect(manager.removePauseMarker('no-such-id')).toBe(false);
    });

    it('getQueued does not include pause markers', () => {
        manager.enqueue(createTestTask());
        manager.enqueue(createTestTask());
        manager.insertPauseMarker(1);

        const queued = manager.getQueued();
        expect(queued).toHaveLength(2);
        expect(queued.every(t => !('kind' in t))).toBe(true);
    });

    it('getQueueItems returns mixed array with markers', () => {
        manager.enqueue(createTestTask());
        manager.enqueue(createTestTask());
        manager.insertPauseMarker(1);

        const items = manager.getQueueItems();
        expect(items).toHaveLength(3);
        expect(items.filter(i => (i as any).kind === 'pause-marker')).toHaveLength(1);
    });

    it('dequeue returns marker when it is first non-skipped item', () => {
        manager.insertPauseMarker(0); // marker at front
        const item = manager.dequeue();
        expect(item).toBeDefined();
        expect((item as any).kind).toBe('pause-marker');
    });

    it('dequeue skips frozen tasks before a marker, then returns marker', () => {
        const id1 = manager.enqueue(createTestTask({ displayName: 'T1' }));
        manager.enqueue(createTestTask({ displayName: 'T2' }));
        manager.freezeTask(id1);
        manager.insertPauseMarker(0); // after T1, before T2: [T1(frozen), marker, T2]
        // T1 is frozen, so dequeue should skip it and return the marker
        const item = manager.dequeue();
        expect((item as any).kind).toBe('pause-marker');
    });

    it('clear discards markers (not added to history)', () => {
        manager.enqueue(createTestTask());
        manager.insertPauseMarker(1);
        manager.clear();
        expect(manager.getQueueItems()).toHaveLength(0);
        // markers do not appear in history
        const history = manager.getHistory();
        expect(history.some(t => (t as any).kind === 'pause-marker')).toBe(false);
    });

    it('emits pause-marker-added change event', () => {
        const listener = vi.fn();
        manager.on('change', listener);
        manager.enqueue(createTestTask());
        listener.mockClear();

        manager.insertPauseMarker(1);

        expect(listener).toHaveBeenCalledWith(
            expect.objectContaining({ type: 'pause-marker-added' })
        );
    });

    it('emits pause-marker-removed change event', () => {
        manager.enqueue(createTestTask());
        const markerId = manager.insertPauseMarker(1);

        const listener = vi.fn();
        manager.on('change', listener);

        manager.removePauseMarker(markerId);

        expect(listener).toHaveBeenCalledWith(
            expect.objectContaining({ type: 'pause-marker-removed' })
        );
    });

    it('peek returns marker when it is first non-skipped item', () => {
        manager.insertPauseMarker(0);
        const item = manager.peek();
        expect((item as any)?.kind).toBe('pause-marker');
    });

    it('size does not count pause markers', () => {
        manager.enqueue(createTestTask());
        manager.enqueue(createTestTask());
        manager.insertPauseMarker(1);
        expect(manager.size()).toBe(2);
    });
});

// ============================================================================
// insertBeforeFirstExclusive (isExclusive option)
// ============================================================================

describe('insertBeforeFirstExclusive (isExclusive option)', () => {
    // A simple policy: tasks of type 'readonly-chat' are shared; everything else exclusive.
    const isExclusive = (t: QueuedTask) => t.type !== 'readonly-chat';

    let m: TaskQueueManager;
    beforeEach(() => {
        m = new TaskQueueManager({ isExclusive });
    });

    it('non-exclusive task is inserted before the first exclusive task', () => {
        m.enqueue(createTestTask({ type: 'run-pipeline', displayName: 'ex1' }));
        m.enqueue(createTestTask({ type: 'run-pipeline', displayName: 'ex2' }));
        m.enqueue(createTestTask({ type: 'readonly-chat', displayName: 'rc1' }));

        const queued = m.getQueued();
        expect(queued.map(t => t.displayName)).toEqual(['rc1', 'ex1', 'ex2']);
    });

    it('non-exclusive task falls back to priority order when no exclusive tasks are present', () => {
        m.enqueue(createTestTask({ type: 'readonly-chat', displayName: 'rc1' }));
        m.enqueue(createTestTask({ type: 'readonly-chat', displayName: 'rc2' }));

        const queued = m.getQueued();
        expect(queued.map(t => t.displayName)).toEqual(['rc1', 'rc2']);
    });

    it('falls back to priority insertion on empty queue', () => {
        m.enqueue(createTestTask({ type: 'readonly-chat', displayName: 'rc1' }));
        expect(m.getQueued()).toHaveLength(1);
    });

    it('multiple non-exclusive tasks queued in sequence maintain FIFO relative to each other', () => {
        m.enqueue(createTestTask({ type: 'run-pipeline', displayName: 'ex1' }));
        m.enqueue(createTestTask({ type: 'readonly-chat', displayName: 'rc1' }));
        m.enqueue(createTestTask({ type: 'readonly-chat', displayName: 'rc2' }));
        m.enqueue(createTestTask({ type: 'readonly-chat', displayName: 'rc3' }));

        const queued = m.getQueued();
        // All readonly-chats end up before ex1, in FIFO order relative to each other
        expect(queued.map(t => t.displayName)).toEqual(['rc1', 'rc2', 'rc3', 'ex1']);
    });

    it('existing exclusive tasks preserve their relative ordering', () => {
        m.enqueue(createTestTask({ type: 'run-pipeline', displayName: 'ex1' }));
        m.enqueue(createTestTask({ type: 'run-pipeline', displayName: 'ex2' }));
        m.enqueue(createTestTask({ type: 'run-pipeline', displayName: 'ex3' }));
        m.enqueue(createTestTask({ type: 'readonly-chat', displayName: 'rc1' }));

        const queued = m.getQueued();
        expect(queued.map(t => t.displayName)).toEqual(['rc1', 'ex1', 'ex2', 'ex3']);
    });

    it('exclusive tasks still use standard priority insertion', () => {
        m.enqueue(createTestTask({ type: 'run-pipeline', priority: 'low', displayName: 'ex-low' }));
        m.enqueue(createTestTask({ type: 'run-pipeline', priority: 'high', displayName: 'ex-high' }));

        const queued = m.getQueued();
        expect(queued.map(t => t.displayName)).toEqual(['ex-high', 'ex-low']);
    });

    it('markRetry re-insertion uses insertByPriority (not insertBeforeFirstExclusive)', () => {
        const exId = m.enqueue(createTestTask({ type: 'run-pipeline', displayName: 'ex1' }));
        m.markStarted(exId);
        m.markRetry(exId, true);

        m.enqueue(createTestTask({ type: 'readonly-chat', displayName: 'rc1' }));

        const queued = m.getQueued();
        // ex1 was re-inserted via insertByPriority (normal priority), rc1 jumps before it
        expect(queued.find(t => t.displayName === 'rc1')).toBeDefined();
        expect(queued.find(t => t.displayName === 'ex1')).toBeDefined();
        // rc1 should be before ex1 (rc1 inserts before first exclusive)
        const rc1Idx = queued.findIndex(t => t.displayName === 'rc1');
        const ex1Idx = queued.findIndex(t => t.displayName === 'ex1');
        expect(rc1Idx).toBeLessThan(ex1Idx);
    });

    it('without isExclusive option, all tasks use standard priority insertion', () => {
        const plain = new TaskQueueManager();
        plain.enqueue(createTestTask({ type: 'run-pipeline', priority: 'low', displayName: 'ex-low' }));
        plain.enqueue(createTestTask({ type: 'readonly-chat', priority: 'normal', displayName: 'rc1' }));

        const queued = plain.getQueued();
        // rc1 has higher priority → comes first via standard insertion
        expect(queued[0].displayName).toBe('rc1');
    });

    it('pause markers are treated as transparent (not exclusive)', () => {
        m.enqueue(createTestTask({ type: 'run-pipeline', displayName: 'ex1' }));
        m.insertPauseMarker(0); // insert pause marker at position 0 (before ex1)
        m.enqueue(createTestTask({ type: 'readonly-chat', displayName: 'rc1' }));

        // rc1 should appear before ex1 (the pause marker is at pos 0, ex1 at pos 1, rc1 inserts before ex1)
        const queued = m.getQueued();
        const rc1Idx = queued.findIndex(t => t.displayName === 'rc1');
        const ex1Idx = queued.findIndex(t => t.displayName === 'ex1');
        expect(rc1Idx).toBeLessThan(ex1Idx);
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
