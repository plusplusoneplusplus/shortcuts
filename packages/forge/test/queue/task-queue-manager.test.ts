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
    PauseMarker,
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

        it('honors a pre-set id when provided', () => {
            const taskId = manager.enqueue(createTestTask({ id: 'my-custom-id' }));
            expect(taskId).toBe('my-custom-id');
            const task = manager.getTask('my-custom-id');
            expect(task).toBeDefined();
            expect(task!.id).toBe('my-custom-id');
        });

        it('generates an id when none is provided', () => {
            const taskId = manager.enqueue(createTestTask());
            expect(taskId).toMatch(/^\d+-[a-z0-9]+$/);
        });

        it('generates an id when id is empty string', () => {
            const taskId = manager.enqueue(createTestTask({ id: '' }));
            expect(taskId).toMatch(/^\d+-[a-z0-9]+$/);
        });

        it('sets processId on the enqueued task when provided', () => {
            const taskId = manager.enqueue(createTestTask({ id: 'tid', processId: 'queue_tid' }));
            const task = manager.getTask(taskId);
            expect(task!.processId).toBe('queue_tid');
        });

        it('allows findTaskByProcessId to work for a queued task with pre-set processId', () => {
            manager.enqueue(createTestTask({ id: 'tid-2', processId: 'queue_tid-2' }));
            const all = manager.getAll();
            const found = all.find(t => t.processId === 'queue_tid-2');
            expect(found).toBeDefined();
            expect(found!.id).toBe('tid-2');
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

        it('skips task whose processId is already running', () => {
            const id1 = manager.enqueue(createTestTask({ payload: { processId: 'proc-1' }, processId: 'proc-1' }));
            const id2 = manager.enqueue(createTestTask({ payload: { processId: 'proc-2' }, processId: 'proc-2' }));
            manager.markStarted(id1);

            // id1 is running with processId 'proc-1', enqueue another task for same process
            const id3 = manager.enqueue(createTestTask({ payload: { processId: 'proc-1' }, processId: 'proc-1' }));

            // peek should skip id3 (same processId as running id1) and return id2
            const peeked = manager.peek() as any;
            expect(peeked.id).toBe(id2);
        });

        it('returns task for same processId after running task completes', () => {
            const id1 = manager.enqueue(createTestTask({ processId: 'proc-1' }));
            manager.markStarted(id1);

            const id2 = manager.enqueue(createTestTask({ processId: 'proc-1' }));

            // While id1 is running, id2 is skipped
            expect(manager.peek()).toBeUndefined();

            // After id1 completes, id2 becomes eligible
            manager.markCompleted(id1);
            expect(manager.peek()!.id).toBe(id2);
        });

        it('does not skip tasks without processId', () => {
            const id1 = manager.enqueue(createTestTask());
            manager.markStarted(id1);

            const id2 = manager.enqueue(createTestTask());
            expect(manager.peek()!.id).toBe(id2);
        });

        it('unlocks processId on task failure', () => {
            const id1 = manager.enqueue(createTestTask({ processId: 'proc-1' }));
            manager.markStarted(id1);

            const id2 = manager.enqueue(createTestTask({ processId: 'proc-1' }));
            expect(manager.peek()).toBeUndefined();

            manager.markFailed(id1, 'error');
            expect(manager.peek()!.id).toBe(id2);
        });

        it('unlocks processId on task cancellation', () => {
            const id1 = manager.enqueue(createTestTask({ processId: 'proc-1' }));
            manager.markStarted(id1);

            const id2 = manager.enqueue(createTestTask({ processId: 'proc-1' }));
            expect(manager.peek()).toBeUndefined();

            manager.cancelTask(id1);
            expect(manager.peek()!.id).toBe(id2);
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

        it('timed pause reports pausedUntil and auto-resumes after expiration', () => {
            vi.useFakeTimers();
            vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
            try {
                const listener = vi.fn();
                manager.on('resumed', listener);
                const until = Date.now() + 60_000;

                manager.pause(until);
                expect(manager.getStats().isPaused).toBe(true);
                expect(manager.getStats().pausedUntil).toBe(until);

                vi.advanceTimersByTime(60_001);
                expect(manager.isPaused()).toBe(false);
                expect(manager.getStats().pausedUntil).toBeUndefined();
                expect(listener).toHaveBeenCalledTimes(1);
            } finally {
                vi.useRealTimers();
            }
        });
    });

    describe('autopilot pause/resume', () => {
        it('pauseAutopilot sets autopilotPaused state', () => {
            manager.pauseAutopilot();
            expect(manager.isAutopilotPaused()).toBe(true);
        });

        it('resumeAutopilot clears autopilotPaused state', () => {
            manager.pauseAutopilot();
            manager.resumeAutopilot();
            expect(manager.isAutopilotPaused()).toBe(false);
        });

        it('pauseAutopilot emits autopilot-paused event', () => {
            const listener = vi.fn();
            manager.on('autopilot-paused', listener);

            manager.pauseAutopilot();

            expect(listener).toHaveBeenCalledTimes(1);
        });

        it('resumeAutopilot emits autopilot-resumed event', () => {
            const listener = vi.fn();
            manager.on('autopilot-resumed', listener);

            manager.pauseAutopilot();
            manager.resumeAutopilot();

            expect(listener).toHaveBeenCalledTimes(1);
        });

        it('double pauseAutopilot does not emit twice', () => {
            const listener = vi.fn();
            manager.on('autopilot-paused', listener);

            manager.pauseAutopilot();
            manager.pauseAutopilot();

            expect(listener).toHaveBeenCalledTimes(1);
        });

        it('double resumeAutopilot does not emit twice', () => {
            const listener = vi.fn();
            manager.on('autopilot-resumed', listener);

            manager.pauseAutopilot();
            manager.resumeAutopilot();
            manager.resumeAutopilot();

            expect(listener).toHaveBeenCalledTimes(1);
        });

        it('timed pauseAutopilot reports autopilotPausedUntil and auto-resumes after expiration', () => {
            vi.useFakeTimers();
            vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
            try {
                manager = createTaskQueueManager({ isExclusive: () => true });
                const listener = vi.fn();
                manager.on('autopilot-resumed', listener);
                const until = Date.now() + 60_000;
                const taskId = manager.enqueue(createTestTask());
                manager.pauseAutopilot(until);
                manager.admitTask(taskId);

                expect(manager.getStats().isAutopilotPaused).toBe(true);
                expect(manager.getStats().autopilotPausedUntil).toBe(until);

                vi.advanceTimersByTime(60_001);
                expect(manager.isAutopilotPaused()).toBe(false);
                expect(manager.getStats().autopilotPausedUntil).toBeUndefined();
                expect(manager.getTask(taskId)!.admitted).toBe(false);
                expect(listener).toHaveBeenCalledTimes(1);
            } finally {
                vi.useRealTimers();
            }
        });

        it('pauseAutopilot does not affect isPaused', () => {
            manager.pauseAutopilot();
            expect(manager.isPaused()).toBe(false);
        });

        it('pause does not affect isAutopilotPaused', () => {
            manager.pause();
            expect(manager.isAutopilotPaused()).toBe(false);
        });

        it('resumeAutopilot clears admitted flags on queued tasks', () => {
            manager = createTaskQueueManager({ isExclusive: () => true });
            manager.pauseAutopilot();
            const id = manager.enqueue(createTestTask());
            manager.admitTask(id);
            expect(manager.getTask(id)!.admitted).toBe(true);

            manager.resumeAutopilot();
            expect(manager.getTask(id)!.admitted).toBe(false);
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
            manager.pause(Date.now() + 60_000);
            manager.pauseAutopilot(Date.now() + 60_000);

            manager.reset();

            expect(manager.size()).toBe(0);
            expect(manager.getRunning()).toHaveLength(0);
            expect(manager.getHistory()).toHaveLength(0);
            expect(manager.isPaused()).toBe(false);
            expect(manager.getStats().pausedUntil).toBeUndefined();
            expect(manager.isAutopilotPaused()).toBe(false);
            expect(manager.getStats().autopilotPausedUntil).toBeUndefined();
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

        it('includes isAutopilotPaused: false by default', () => {
            expect(manager.getStats().isAutopilotPaused).toBe(false);
        });

        it('includes isAutopilotPaused: true when autopilot paused', () => {
            manager.pauseAutopilot();
            expect(manager.getStats().isAutopilotPaused).toBe(true);
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
    // removeHistoryEntry
    // ========================================================================

    describe('removeHistoryEntry', () => {
        it('removes a completed task from history and returns true', () => {
            const id = manager.enqueue(createTestTask());
            manager.markStarted(id);
            manager.markCompleted(id);

            expect(manager.getHistory()).toHaveLength(1);
            const removed = manager.removeHistoryEntry(id);
            expect(removed).toBe(true);
            expect(manager.getHistory()).toHaveLength(0);
        });

        it('removes a failed task from history and returns true', () => {
            const id = manager.enqueue(createTestTask());
            manager.markStarted(id);
            manager.markFailed(id, 'error');

            const removed = manager.removeHistoryEntry(id);
            expect(removed).toBe(true);
            expect(manager.getHistory()).toHaveLength(0);
        });

        it('removes a cancelled task from history and returns true', () => {
            const id = manager.enqueue(createTestTask());
            manager.cancelTask(id);

            const removed = manager.removeHistoryEntry(id);
            expect(removed).toBe(true);
            expect(manager.getHistory()).toHaveLength(0);
        });

        it('returns false for a non-existent task ID', () => {
            const removed = manager.removeHistoryEntry('nonexistent-id');
            expect(removed).toBe(false);
        });

        it('only removes the targeted entry, leaving others intact', () => {
            const id1 = manager.enqueue(createTestTask({ displayName: 'task-1' }));
            const id2 = manager.enqueue(createTestTask({ displayName: 'task-2' }));
            manager.markStarted(id1);
            manager.markCompleted(id1);
            manager.markStarted(id2);
            manager.markCompleted(id2);

            expect(manager.getHistory()).toHaveLength(2);
            manager.removeHistoryEntry(id1);

            const remaining = manager.getHistory();
            expect(remaining).toHaveLength(1);
            expect(remaining[0].id).toBe(id2);
        });

        it('emits a change event when removing', () => {
            const listener = vi.fn();
            manager.on('change', listener);

            const id = manager.enqueue(createTestTask());
            manager.markStarted(id);
            manager.markCompleted(id);
            listener.mockClear();

            manager.removeHistoryEntry(id);
            expect(listener).toHaveBeenCalledTimes(1);
        });

        it('does not emit a change event when task is not found', () => {
            const listener = vi.fn();
            manager.on('change', listener);

            manager.removeHistoryEntry('nonexistent');
            expect(listener).not.toHaveBeenCalled();
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

        it('pauseRepo stores reason when provided', () => {
            const reason = { taskId: 't1', displayName: 'lint.sh', failedAt: '2026-01-01T00:00:00Z' };
            repoManager.pauseRepo('repo-A', reason);
            expect(repoManager.getPauseReason('repo-A')).toEqual(reason);
        });

        it('pauseRepo without reason stores no reason', () => {
            repoManager.pauseRepo('repo-A');
            expect(repoManager.getPauseReason('repo-A')).toBeUndefined();
        });

        it('resumeRepo clears reason', () => {
            const reason = { taskId: 't1', displayName: 'lint.sh', failedAt: '2026-01-01T00:00:00Z' };
            repoManager.pauseRepo('repo-A', reason);
            repoManager.resumeRepo('repo-A');
            expect(repoManager.getPauseReason('repo-A')).toBeUndefined();
        });

        it('getStats includes pauseReason when repo is paused with reason', () => {
            const reason = { taskId: 't1', displayName: 'test.sh', failedAt: '2026-01-01T12:00:00Z' };
            repoManager.pauseRepo('repo-A', reason);
            const stats = repoManager.getStats();
            expect(stats.pauseReason).toEqual(reason);
        });

        it('getStats has no pauseReason when paused without reason', () => {
            repoManager.pauseRepo('repo-A');
            const stats = repoManager.getStats();
            expect(stats.pauseReason).toBeUndefined();
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

    describe('admitTask', () => {
        it('admits a queued task', () => {
            const id = manager.enqueue(createTestTask());
            expect(manager.admitTask(id)).toBe(true);
            expect(manager.getTask(id)!.admitted).toBe(true);
        });

        it('returns false for non-existent task', () => {
            expect(manager.admitTask('no-such-id')).toBe(false);
        });

        it('returns false for running task', () => {
            const id = manager.enqueue(createTestTask());
            manager.markStarted(id);
            expect(manager.admitTask(id)).toBe(false);
        });

        it('emits admitted change event', () => {
            const listener = vi.fn();
            manager.on('change', listener);
            const id = manager.enqueue(createTestTask());
            listener.mockClear();

            manager.admitTask(id);

            expect(listener).toHaveBeenCalledTimes(1);
            expect(listener.mock.calls[0][0].type).toBe('admitted');
            expect(listener.mock.calls[0][0].taskId).toBe(id);
        });

        it('task stays in queued status after admit', () => {
            const id = manager.enqueue(createTestTask());
            manager.admitTask(id);
            expect(manager.getTask(id)!.status).toBe('queued');
        });
    });

    describe('unadmitTask', () => {
        it('unadmits an admitted task', () => {
            const id = manager.enqueue(createTestTask());
            manager.admitTask(id);
            expect(manager.unadmitTask(id)).toBe(true);
            expect(manager.getTask(id)!.admitted).toBe(false);
        });

        it('returns false for non-admitted task', () => {
            const id = manager.enqueue(createTestTask());
            expect(manager.unadmitTask(id)).toBe(false);
        });

        it('returns false for non-existent task', () => {
            expect(manager.unadmitTask('no-such-id')).toBe(false);
        });

        it('emits unadmitted change event', () => {
            const listener = vi.fn();
            manager.on('change', listener);
            const id = manager.enqueue(createTestTask());
            manager.admitTask(id);
            listener.mockClear();

            manager.unadmitTask(id);

            expect(listener).toHaveBeenCalledTimes(1);
            expect(listener.mock.calls[0][0].type).toBe('unadmitted');
            expect(listener.mock.calls[0][0].taskId).toBe(id);
        });
    });

    describe('peek with autopilot-paused tasks', () => {
        it('skips non-admitted exclusive tasks when autopilot is paused', () => {
            manager = createTaskQueueManager({ isExclusive: () => true });
            const id1 = manager.enqueue(createTestTask({ displayName: 'T1' }));
            const id2 = manager.enqueue(createTestTask({ displayName: 'T2' }));
            manager.pauseAutopilot();

            // Both exclusive, neither admitted → no eligible task
            expect(manager.peek()).toBeUndefined();
        });

        it('returns admitted task when autopilot is paused', () => {
            manager = createTaskQueueManager({ isExclusive: () => true });
            const id1 = manager.enqueue(createTestTask({ displayName: 'T1' }));
            const id2 = manager.enqueue(createTestTask({ displayName: 'T2' }));
            manager.pauseAutopilot();
            manager.admitTask(id2);

            // id1 is held, id2 is admitted → peek returns id2
            const next = manager.peek();
            expect(next).toBeDefined();
            expect(next!.id).toBe(id2);
        });

        it('returns first admitted task in queue order', () => {
            manager = createTaskQueueManager({ isExclusive: () => true });
            const id1 = manager.enqueue(createTestTask({ displayName: 'T1' }));
            const id2 = manager.enqueue(createTestTask({ displayName: 'T2' }));
            const id3 = manager.enqueue(createTestTask({ displayName: 'T3' }));
            manager.pauseAutopilot();
            manager.admitTask(id2);
            manager.admitTask(id3);

            // id1 held, id2 admitted, id3 admitted → returns id2 (first admitted in order)
            expect(manager.peek()!.id).toBe(id2);
        });

        it('does not skip tasks without isExclusive configured', () => {
            // No isExclusive → autopilot pause does not affect peek
            manager = createTaskQueueManager();
            const id = manager.enqueue(createTestTask());
            manager.pauseAutopilot();

            expect(manager.peek()!.id).toBe(id);
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

    it('insertPauseMarker stores a preset duration when provided', () => {
        manager.enqueue(createTestTask());

        const markerId = manager.insertPauseMarker(0, 2);
        const marker = manager.getQueueItems().find((item): item is PauseMarker => (item as any).kind === 'pause-marker');

        expect(marker).toMatchObject({
            kind: 'pause-marker',
            id: markerId,
            durationHours: 2,
        });
    });

    it('insertPauseMarker omits durationHours for indefinite markers', () => {
        manager.enqueue(createTestTask());

        const markerId = manager.insertPauseMarker(0);
        const marker = manager.getQueueItems().find((item): item is PauseMarker => (item as any).kind === 'pause-marker');

        expect(marker).toMatchObject({ kind: 'pause-marker', id: markerId });
        expect(marker!.durationHours).toBeUndefined();
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

        const markerId = manager.insertPauseMarker(1, 4);

        expect(listener).toHaveBeenCalledWith(
            expect.objectContaining({
                type: 'pause-marker-added',
                taskId: markerId,
                item: expect.objectContaining({ kind: 'pause-marker', id: markerId, durationHours: 4 }),
            })
        );
    });

    it('emits pause-marker-removed change event', () => {
        manager.enqueue(createTestTask());
        const markerId = manager.insertPauseMarker(1);

        const listener = vi.fn();
        manager.on('change', listener);

        manager.removePauseMarker(markerId);

        expect(listener).toHaveBeenCalledWith(
            expect.objectContaining({
                type: 'pause-marker-removed',
                taskId: markerId,
                item: expect.objectContaining({ kind: 'pause-marker', id: markerId }),
            })
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
// reActivate
// ============================================================================

describe('TaskQueueManager.reActivate', () => {
    let manager: TaskQueueManager;

    beforeEach(() => {
        manager = createTaskQueueManager();
    });

    it('moves a completed task from history to running', () => {
        const id = manager.enqueue(createTestTask({ displayName: 'chat-task' }));
        manager.markStarted(id);
        manager.markCompleted(id, 'done');
        expect(manager.getHistory()).toHaveLength(1);
        expect(manager.getRunning()).toHaveLength(0);

        const result = manager.reActivate(id);
        expect(result).toBe(true);
        expect(manager.getHistory()).toHaveLength(0);
        expect(manager.getRunning()).toHaveLength(1);

        const task = manager.getTask(id);
        expect(task?.status).toBe('running');
        expect(task?.startedAt).toBeDefined();
        expect(task?.completedAt).toBeUndefined();
        expect(task?.result).toBeUndefined();
        expect(task?.error).toBeUndefined();
    });

    it('moves a queued task to running (e.g. requeued parent)', () => {
        const id = manager.enqueue(createTestTask());
        expect(manager.reActivate(id)).toBe(true); // now handles queued tasks
        expect(manager.getRunning()).toHaveLength(1);
        expect(manager.getQueued()).toHaveLength(0);
    });

    it('returns false for unknown task ID', () => {
        expect(manager.reActivate('nonexistent')).toBe(false);
    });

    it('moves a failed task from history to running', () => {
        const id = manager.enqueue(createTestTask());
        manager.markStarted(id);
        manager.markFailed(id, 'some error');
        expect(manager.getHistory()).toHaveLength(1);

        const result = manager.reActivate(id);
        expect(result).toBe(true);
        expect(manager.getRunning()).toHaveLength(1);
        const task = manager.getTask(id);
        expect(task?.status).toBe('running');
        expect(task?.error).toBeUndefined();
    });

    it('emits change and taskUpdated events', () => {
        const changeListener = vi.fn();
        const updateListener = vi.fn();
        manager.on('change', changeListener);
        manager.on('taskUpdated', updateListener);

        const id = manager.enqueue(createTestTask());
        manager.markStarted(id);
        manager.markCompleted(id);
        changeListener.mockClear();
        updateListener.mockClear();

        manager.reActivate(id);

        expect(changeListener).toHaveBeenCalledWith(
            expect.objectContaining({ type: 'updated', taskId: id })
        );
        expect(updateListener).toHaveBeenCalledWith(
            expect.objectContaining({ id, status: 'running' }),
            expect.objectContaining({ status: 'running' })
        );
    });

    it('preserves original createdAt', () => {
        const id = manager.enqueue(createTestTask());
        manager.markStarted(id);
        const originalCreatedAt = manager.getTask(id)!.createdAt;
        manager.markCompleted(id);

        manager.reActivate(id);

        const task = manager.getTask(id);
        expect(task?.createdAt).toBe(originalCreatedAt);
    });

    it('can be re-completed after re-activation', () => {
        const id = manager.enqueue(createTestTask());
        manager.markStarted(id);
        manager.markCompleted(id, 'first-result');

        manager.reActivate(id);
        expect(manager.getRunning()).toHaveLength(1);

        manager.markCompleted(id, 'second-result');
        expect(manager.getRunning()).toHaveLength(0);
        expect(manager.getHistory()).toHaveLength(1);
        expect(manager.getTask(id)?.result).toBe('second-result');
    });

    it('returns false when task is currently running', () => {
        const id = manager.enqueue(createTestTask());
        manager.markStarted(id);
        // Task is running, not in history
        expect(manager.reActivate(id)).toBe(false);
    });
});

// ============================================================================
// requeueFromHistory
// ============================================================================

describe('TaskQueueManager.requeueFromHistory', () => {
    let manager: TaskQueueManager;

    beforeEach(() => {
        manager = createTaskQueueManager();
    });

    it('moves a completed task from history to queue', () => {
        const id = manager.enqueue(createTestTask({ displayName: 'chat-task' }));
        manager.markStarted(id);
        manager.markCompleted(id, 'done');
        expect(manager.getHistory()).toHaveLength(1);
        expect(manager.getQueued()).toHaveLength(0);

        const result = manager.requeueFromHistory(id);
        expect(result).toBe(true);
        expect(manager.getHistory()).toHaveLength(0);
        expect(manager.getQueued()).toHaveLength(1);

        const task = manager.getTask(id);
        expect(task?.status).toBe('queued');
        expect(task?.startedAt).toBeUndefined();
        expect(task?.completedAt).toBeUndefined();
        expect(task?.result).toBeUndefined();
        expect(task?.error).toBeUndefined();
    });

    it('returns false for a task not in history', () => {
        const id = manager.enqueue(createTestTask());
        expect(manager.requeueFromHistory(id)).toBe(false); // still queued
    });

    it('returns false for unknown task ID', () => {
        expect(manager.requeueFromHistory('nonexistent')).toBe(false);
    });

    it('is a no-op when parent is already in queue (second follow-up)', () => {
        const id = manager.enqueue(createTestTask());
        manager.markStarted(id);
        manager.markCompleted(id, 'done');

        // First follow-up requeues it
        expect(manager.requeueFromHistory(id)).toBe(true);
        // Second follow-up: not in history anymore
        expect(manager.requeueFromHistory(id)).toBe(false);
        // Task is still in queue
        expect(manager.getQueued()).toHaveLength(1);
    });

    it('emits change and taskUpdated events', () => {
        const changeListener = vi.fn();
        const updateListener = vi.fn();
        manager.on('change', changeListener);
        manager.on('taskUpdated', updateListener);

        const id = manager.enqueue(createTestTask());
        manager.markStarted(id);
        manager.markCompleted(id);
        changeListener.mockClear();
        updateListener.mockClear();

        manager.requeueFromHistory(id);

        expect(changeListener).toHaveBeenCalledWith(
            expect.objectContaining({ type: 'updated', taskId: id })
        );
        expect(updateListener).toHaveBeenCalledWith(
            expect.objectContaining({ id, status: 'queued' }),
            expect.objectContaining({ status: 'queued' })
        );
    });

    it('preserves original createdAt', () => {
        const id = manager.enqueue(createTestTask());
        const originalCreatedAt = manager.getTask(id)!.createdAt;
        manager.markStarted(id);
        manager.markCompleted(id);

        manager.requeueFromHistory(id);

        expect(manager.getTask(id)?.createdAt).toBe(originalCreatedAt);
    });

    // Regression: requeueFromHistory must respect isExclusiveFn so that
    // non-exclusive (ask/plan) follow-ups are not buried behind exclusive
    // (autopilot) tasks when the queue is autopilot-paused.
    describe('non-exclusive routing (regression)', () => {
        const isExclusive = (t: QueuedTask) => t.type !== 'readonly-chat';

        it('requeued non-exclusive task is placed before existing exclusive tasks', () => {
            const m = new TaskQueueManager({ isExclusive });

            // Complete a non-exclusive (ask/plan) task
            const chatId = m.enqueue(createTestTask({ type: 'readonly-chat', displayName: 'chat' }));
            m.markStarted(chatId);
            m.markCompleted(chatId, 'done');

            // Queue up two exclusive (autopilot) tasks while chat is in history
            m.enqueue(createTestTask({ type: 'run-pipeline', displayName: 'ap1' }));
            m.enqueue(createTestTask({ type: 'run-pipeline', displayName: 'ap2' }));

            // Simulate follow-up reply: requeue the chat task
            m.requeueFromHistory(chatId);

            // The non-exclusive chat task must sit BEFORE the exclusive tasks
            const queued = m.getQueued();
            const chatIdx = queued.findIndex(t => t.id === chatId);
            const ap1Idx = queued.findIndex(t => t.displayName === 'ap1');
            expect(chatIdx).toBeLessThan(ap1Idx);
        });

        it('requeued non-exclusive task is visible via peek when autopilot is paused', () => {
            const m = new TaskQueueManager({ isExclusive });

            // Complete a non-exclusive task
            const chatId = m.enqueue(createTestTask({ type: 'readonly-chat', displayName: 'chat' }));
            m.markStarted(chatId);
            m.markCompleted(chatId, 'done');

            // Queue an exclusive task and pause autopilot
            m.enqueue(createTestTask({ type: 'run-pipeline', displayName: 'ap1' }));
            m.pauseAutopilot();

            // Requeue the non-exclusive follow-up
            m.requeueFromHistory(chatId);

            // peek() should return the non-exclusive chat task, not undefined or ap1
            const next = m.peek();
            expect(next).toBeDefined();
            expect((next as QueuedTask).id).toBe(chatId);
        });
    });
});

// ============================================================================
// returnToHistory
// ============================================================================

describe('TaskQueueManager.returnToHistory', () => {
    let manager: TaskQueueManager;

    beforeEach(() => {
        manager = createTaskQueueManager();
    });

    it('moves a queued task back to history as completed', () => {
        const id = manager.enqueue(createTestTask());
        manager.markStarted(id);
        manager.markCompleted(id, 'done');

        // Requeue it
        manager.requeueFromHistory(id);
        expect(manager.getQueued()).toHaveLength(1);

        // Return to history
        const result = manager.returnToHistory(id);
        expect(result).toBe(true);
        expect(manager.getQueued()).toHaveLength(0);
        expect(manager.getHistory()).toHaveLength(1);

        const task = manager.getTask(id);
        expect(task?.status).toBe('completed');
        expect(task?.completedAt).toBeDefined();
    });

    it('returns false for a task not in queue', () => {
        const id = manager.enqueue(createTestTask());
        manager.markStarted(id);
        manager.markCompleted(id, 'done');
        // Task is in history, not in queue
        expect(manager.returnToHistory(id)).toBe(false);
    });

    it('returns false for unknown task ID', () => {
        expect(manager.returnToHistory('nonexistent')).toBe(false);
    });

    it('emits change and taskUpdated events', () => {
        const changeListener = vi.fn();
        const updateListener = vi.fn();
        manager.on('change', changeListener);
        manager.on('taskUpdated', updateListener);

        const id = manager.enqueue(createTestTask());
        manager.markStarted(id);
        manager.markCompleted(id);
        manager.requeueFromHistory(id);
        changeListener.mockClear();
        updateListener.mockClear();

        manager.returnToHistory(id);

        expect(changeListener).toHaveBeenCalledWith(
            expect.objectContaining({ type: 'updated', taskId: id })
        );
        expect(updateListener).toHaveBeenCalledWith(
            expect.objectContaining({ id, status: 'completed' }),
            expect.objectContaining({ status: 'completed' })
        );
    });
});

// ============================================================================
// reActivate (from queue)
// ============================================================================

describe('TaskQueueManager.reActivate from queue', () => {
    let manager: TaskQueueManager;

    beforeEach(() => {
        manager = createTaskQueueManager();
    });

    it('moves a requeued task from queue to running', () => {
        const id = manager.enqueue(createTestTask({ displayName: 'chat-task' }));
        manager.markStarted(id);
        manager.markCompleted(id, 'done');

        // Requeue it (simulates follow-up enqueued)
        manager.requeueFromHistory(id);
        expect(manager.getQueued()).toHaveLength(1);
        expect(manager.getRunning()).toHaveLength(0);

        // Re-activate (simulates follow-up starting execution)
        const result = manager.reActivate(id);
        expect(result).toBe(true);
        expect(manager.getQueued()).toHaveLength(0);
        expect(manager.getRunning()).toHaveLength(1);

        const task = manager.getTask(id);
        expect(task?.status).toBe('running');
        expect(task?.startedAt).toBeDefined();
    });

    it('can complete after reActivate from queue', () => {
        const id = manager.enqueue(createTestTask());
        manager.markStarted(id);
        manager.markCompleted(id, 'first');

        manager.requeueFromHistory(id);
        manager.reActivate(id);
        manager.markCompleted(id, 'second');

        expect(manager.getRunning()).toHaveLength(0);
        expect(manager.getHistory()).toHaveLength(1);
        expect(manager.getTask(id)?.result).toBe('second');
    });
});

// ============================================================================
// Ralph-session continuation ordering (AC-01 / AC-02 / AC-03 / AC-04)
// ============================================================================

describe('Ralph-session continuation ordering', () => {
    // All tests use a manager with an isExclusive function so the
    // insertAsContinuation logic knows which tasks are exclusive.
    function isExclusive(task: QueuedTask): boolean {
        // ralph and autopilot tasks are exclusive; ask tasks are shared
        return (task.payload as any)?.mode !== 'ask';
    }

    function makeManager() {
        return createTaskQueueManager({ isExclusive });
    }

    function makeExclusiveTask(overrides: Partial<CreateTaskInput> = {}): CreateTaskInput {
        return createTestTask({
            payload: { promptFilePath: '/exclusive.md', mode: 'autopilot' },
            ...overrides,
        });
    }

    function makeRalphTask(sessionId: string, overrides: Partial<CreateTaskInput> = {}): CreateTaskInput {
        return createTestTask({
            continuationOfSessionId: sessionId,
            payload: { promptFilePath: '/ralph.md', mode: 'ralph' },
            ...overrides,
        });
    }

    it('continuation task is inserted before unrelated exclusive backlog', () => {
        const m = makeManager();
        // Two unrelated exclusive tasks already in queue
        const unrelatedId1 = m.enqueue(makeExclusiveTask({ displayName: 'unrelated-1' }));
        const unrelatedId2 = m.enqueue(makeExclusiveTask({ displayName: 'unrelated-2' }));

        // Enqueue a Ralph continuation for session A
        const continuationId = m.enqueue(makeRalphTask('session-A', { displayName: 'ralph-continuation' }));

        const queued = m.getQueued();
        expect(queued[0].id).toBe(continuationId);
        expect(queued[1].id).toBe(unrelatedId1);
        expect(queued[2].id).toBe(unrelatedId2);
    });

    it('multiple same-session continuations stack before unrelated exclusive tasks', () => {
        const m = makeManager();
        const unrelatedId = m.enqueue(makeExclusiveTask({ displayName: 'unrelated' }));

        const cont1 = m.enqueue(makeRalphTask('session-A', { displayName: 'cont-1' }));
        const cont2 = m.enqueue(makeRalphTask('session-A', { displayName: 'cont-2' }));

        const queued = m.getQueued();
        expect(queued[0].id).toBe(cont1);
        expect(queued[1].id).toBe(cont2);
        expect(queued[2].id).toBe(unrelatedId);
    });

    it('continuation task for session A does not reorder session B exclusive tasks', () => {
        const m = makeManager();
        // Two sessions already have continuation tasks in queue
        const sessionBId = m.enqueue(makeRalphTask('session-B', { displayName: 'session-b-cont' }));

        // Now enqueue a continuation for session A
        const sessionAId = m.enqueue(makeRalphTask('session-A', { displayName: 'session-a-cont' }));

        // session-A continuation goes before session-B continuation
        // because session-B is an unrelated exclusive w.r.t. session-A
        const queued = m.getQueued();
        expect(queued[0].id).toBe(sessionAId);
        expect(queued[1].id).toBe(sessionBId);
    });

    it('continuation without any exclusive backlog uses priority insertion', () => {
        const m = makeManager();
        // No exclusive tasks yet — continuation should land normally
        const cont = m.enqueue(makeRalphTask('session-A'));
        expect(m.getQueued()[0].id).toBe(cont);
        expect(m.size()).toBe(1);
    });

    it('continuation preserves repo-scope isolation (AC-04): another workspace unaffected', () => {
        // Two separate managers simulate two different workspaces
        const mA = makeManager();
        const mB = makeManager();

        const unrelatedInA = mA.enqueue(makeExclusiveTask({ displayName: 'unrelated-in-A' }));
        const unrelatedInB = mB.enqueue(makeExclusiveTask({ displayName: 'unrelated-in-B' }));

        // Ralph continuation in workspace A
        const contA = mA.enqueue(makeRalphTask('session-A', { displayName: 'ralph-in-A' }));

        // workspace B queue is unchanged
        const queuedB = mB.getQueued();
        expect(queuedB).toHaveLength(1);
        expect(queuedB[0].id).toBe(unrelatedInB);

        // workspace A queue has continuation before unrelated
        const queuedA = mA.getQueued();
        expect(queuedA[0].id).toBe(contA);
        expect(queuedA[1].id).toBe(unrelatedInA);
    });

    it('non-exclusive (ask) tasks remain unaffected by continuation ordering', () => {
        const m = makeManager();
        const exclusiveId = m.enqueue(makeExclusiveTask({ displayName: 'exclusive' }));
        const askId = m.enqueue(createTestTask({
            payload: { promptFilePath: '/ask.md', mode: 'ask' },
            displayName: 'ask-task',
        }));
        const contId = m.enqueue(makeRalphTask('session-A', { displayName: 'ralph-cont' }));

        // ask task should appear before the exclusive task (non-exclusive fast path)
        // ralph continuation should appear before the exclusive task too
        const queued = m.getQueued();
        // Both ask and continuation are before the unrelated exclusive task
        const exclusivePos = queued.findIndex(t => t.id === exclusiveId);
        const askPos = queued.findIndex(t => t.id === askId);
        const contPos = queued.findIndex(t => t.id === contId);
        expect(exclusivePos).toBeGreaterThan(askPos);
        expect(exclusivePos).toBeGreaterThan(contPos);
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
