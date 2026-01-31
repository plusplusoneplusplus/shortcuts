/**
 * TaskQueueManager
 *
 * Manages a queue of tasks with priority-based ordering.
 * Provides operations for enqueue, dequeue, reorder, and queue control.
 *
 * Uses Node.js EventEmitter for cross-platform compatibility.
 * In-memory storage only - queue resets when process restarts.
 *
 * Cross-platform compatible (Linux/Mac/Windows).
 */

import { EventEmitter } from 'events';
import {
    QueuedTask,
    CreateTaskInput,
    TaskUpdate,
    TaskPayload,
    QueueChangeEvent,
    QueueChangeType,
    QueueStats,
    TaskQueueManagerOptions,
    DEFAULT_QUEUE_MANAGER_OPTIONS,
    comparePriority,
    generateTaskId,
} from './types';

/**
 * Task queue manager for managing AI task execution queue
 */
export class TaskQueueManager extends EventEmitter {
    /** Queue of pending tasks (sorted by priority) */
    private queue: QueuedTask[] = [];
    /** Currently running tasks */
    private running: Map<string, QueuedTask> = new Map();
    /** History of completed/failed/cancelled tasks */
    private history: QueuedTask[] = [];
    /** Whether the queue is paused */
    private paused = false;
    /** Configuration options */
    private readonly options: Required<TaskQueueManagerOptions>;

    constructor(options: TaskQueueManagerOptions = {}) {
        super();
        this.options = { ...DEFAULT_QUEUE_MANAGER_OPTIONS, ...options };
    }

    // ========================================================================
    // Core Operations
    // ========================================================================

    /**
     * Add a task to the queue
     * @param input Task input (without auto-generated fields)
     * @returns The ID of the queued task
     */
    enqueue<TPayload extends TaskPayload = TaskPayload>(
        input: CreateTaskInput<TPayload>
    ): string {
        // Check queue size limit
        if (this.options.maxQueueSize > 0 && this.queue.length >= this.options.maxQueueSize) {
            throw new Error(`Queue is full (max size: ${this.options.maxQueueSize})`);
        }

        const task: QueuedTask<TPayload> = {
            ...input,
            id: generateTaskId(),
            status: 'queued',
            createdAt: Date.now(),
            retryCount: 0,
        };

        // Insert in priority order
        this.insertByPriority(task);

        // Emit events
        this.emitChange('added', task);
        this.emit('taskAdded', task);

        return task.id;
    }

    /**
     * Remove and return the next task from the queue
     * @returns The next task, or undefined if queue is empty
     */
    dequeue(): QueuedTask | undefined {
        if (this.queue.length === 0) {
            return undefined;
        }

        const task = this.queue.shift()!;
        return task;
    }

    /**
     * Get the next task without removing it
     * @returns The next task, or undefined if queue is empty
     */
    peek(): QueuedTask | undefined {
        return this.queue[0];
    }

    // ========================================================================
    // Queue Access
    // ========================================================================

    /**
     * Get all tasks (queued + running + history)
     */
    getAll(): QueuedTask[] {
        return [...this.queue, ...Array.from(this.running.values()), ...this.history];
    }

    /**
     * Get all queued tasks (waiting for execution)
     */
    getQueued(): QueuedTask[] {
        return [...this.queue];
    }

    /**
     * Get all running tasks
     */
    getRunning(): QueuedTask[] {
        return Array.from(this.running.values());
    }

    /**
     * Get completed tasks from history
     */
    getCompleted(): QueuedTask[] {
        return this.history.filter(t => t.status === 'completed');
    }

    /**
     * Get failed tasks from history
     */
    getFailed(): QueuedTask[] {
        return this.history.filter(t => t.status === 'failed');
    }

    /**
     * Get cancelled tasks from history
     */
    getCancelled(): QueuedTask[] {
        return this.history.filter(t => t.status === 'cancelled');
    }

    /**
     * Get history (completed + failed + cancelled)
     */
    getHistory(): QueuedTask[] {
        return [...this.history];
    }

    /**
     * Get the number of queued tasks
     */
    size(): number {
        return this.queue.length;
    }

    /**
     * Get queue statistics
     */
    getStats(): QueueStats {
        return {
            queued: this.queue.length,
            running: this.running.size,
            completed: this.history.filter(t => t.status === 'completed').length,
            failed: this.history.filter(t => t.status === 'failed').length,
            cancelled: this.history.filter(t => t.status === 'cancelled').length,
            total: this.queue.length + this.running.size + this.history.length,
            isPaused: this.paused,
        };
    }

    // ========================================================================
    // Task Operations
    // ========================================================================

    /**
     * Get a task by ID (searches all: queued, running, history)
     */
    getTask(id: string): QueuedTask | undefined {
        // Check queue
        const queued = this.queue.find(t => t.id === id);
        if (queued) return queued;

        // Check running
        const running = this.running.get(id);
        if (running) return running;

        // Check history
        return this.history.find(t => t.id === id);
    }

    /**
     * Update a task's properties
     * @param id Task ID
     * @param updates Partial updates to apply
     * @returns true if task was found and updated
     */
    updateTask(id: string, updates: TaskUpdate): boolean {
        // Try to find in queue
        const queueIndex = this.queue.findIndex(t => t.id === id);
        if (queueIndex !== -1) {
            const task = this.queue[queueIndex];
            Object.assign(task, updates);

            // Re-sort if priority changed
            if (updates.priority !== undefined) {
                this.queue.splice(queueIndex, 1);
                this.insertByPriority(task);
            }

            this.emitChange('updated', task);
            this.emit('taskUpdated', task, updates);
            return true;
        }

        // Try to find in running
        const running = this.running.get(id);
        if (running) {
            Object.assign(running, updates);
            this.emitChange('updated', running);
            this.emit('taskUpdated', running, updates);
            return true;
        }

        // Try to find in history
        const historyIndex = this.history.findIndex(t => t.id === id);
        if (historyIndex !== -1) {
            const task = this.history[historyIndex];
            Object.assign(task, updates);
            this.emitChange('updated', task);
            this.emit('taskUpdated', task, updates);
            return true;
        }

        return false;
    }

    /**
     * Remove a task from the queue (only works for queued tasks)
     * @param id Task ID
     * @returns true if task was found and removed
     */
    removeTask(id: string): boolean {
        const index = this.queue.findIndex(t => t.id === id);
        if (index === -1) {
            return false;
        }

        const [task] = this.queue.splice(index, 1);
        this.emitChange('removed', task);
        this.emit('taskRemoved', task);
        return true;
    }

    /**
     * Cancel a task (works for queued or running tasks)
     * @param id Task ID
     * @returns true if task was found and cancelled
     */
    cancelTask(id: string): boolean {
        // Try to cancel from queue
        const queueIndex = this.queue.findIndex(t => t.id === id);
        if (queueIndex !== -1) {
            const [task] = this.queue.splice(queueIndex, 1);
            task.status = 'cancelled';
            task.completedAt = Date.now();
            this.addToHistory(task);
            this.emitChange('removed', task);
            this.emit('taskCancelled', task);
            return true;
        }

        // Try to cancel running task
        const running = this.running.get(id);
        if (running) {
            running.status = 'cancelled';
            running.completedAt = Date.now();
            this.running.delete(id);
            this.addToHistory(running);
            this.emitChange('updated', running);
            this.emit('taskCancelled', running);
            return true;
        }

        return false;
    }

    // ========================================================================
    // Task State Transitions (used by executor)
    // ========================================================================

    /**
     * Mark a task as started (moves from queue to running)
     * @param id Task ID
     * @returns The task if found and started
     */
    markStarted(id: string): QueuedTask | undefined {
        const index = this.queue.findIndex(t => t.id === id);
        if (index === -1) {
            return undefined;
        }

        const [task] = this.queue.splice(index, 1);
        task.status = 'running';
        task.startedAt = Date.now();
        this.running.set(id, task);

        this.emitChange('updated', task);
        this.emit('taskStarted', task);
        return task;
    }

    /**
     * Mark a task as completed (moves from running to history)
     * @param id Task ID
     * @param result The result of execution
     * @returns The task if found and completed
     */
    markCompleted(id: string, result?: unknown): QueuedTask | undefined {
        const task = this.running.get(id);
        if (!task) {
            return undefined;
        }

        task.status = 'completed';
        task.completedAt = Date.now();
        task.result = result;
        this.running.delete(id);
        this.addToHistory(task);

        this.emitChange('updated', task);
        this.emit('taskCompleted', task, result);
        return task;
    }

    /**
     * Mark a task as failed (moves from running to history)
     * @param id Task ID
     * @param error The error that occurred
     * @returns The task if found and marked as failed
     */
    markFailed(id: string, error: Error | string): QueuedTask | undefined {
        const task = this.running.get(id);
        if (!task) {
            return undefined;
        }

        task.status = 'failed';
        task.completedAt = Date.now();
        task.error = typeof error === 'string' ? error : error.message;
        this.running.delete(id);
        this.addToHistory(task);

        this.emitChange('updated', task);
        this.emit('taskFailed', task, typeof error === 'string' ? new Error(error) : error);
        return task;
    }

    /**
     * Increment retry count and optionally re-queue the task
     * @param id Task ID
     * @param requeue Whether to re-queue the task
     * @returns The task if found
     */
    markRetry(id: string, requeue: boolean = true): QueuedTask | undefined {
        const task = this.running.get(id);
        if (!task) {
            return undefined;
        }

        task.retryCount = (task.retryCount || 0) + 1;

        if (requeue) {
            task.status = 'queued';
            task.startedAt = undefined;
            this.running.delete(id);
            this.insertByPriority(task);
            this.emitChange('reordered', task);
        }

        return task;
    }

    // ========================================================================
    // Reordering
    // ========================================================================

    /**
     * Move a task to the top of the queue (highest priority position)
     * @param id Task ID
     * @returns true if task was found and moved
     */
    moveToTop(id: string): boolean {
        const index = this.queue.findIndex(t => t.id === id);
        if (index === -1 || index === 0) {
            return index === 0; // Already at top
        }

        const [task] = this.queue.splice(index, 1);
        // Set to high priority and earliest timestamp to ensure it's first
        task.priority = 'high';
        task.createdAt = this.queue.length > 0 ? this.queue[0].createdAt - 1 : Date.now();
        this.queue.unshift(task);

        this.emitChange('reordered', task);
        return true;
    }

    /**
     * Move a task up one position in the queue
     * @param id Task ID
     * @returns true if task was found and moved
     */
    moveUp(id: string): boolean {
        const index = this.queue.findIndex(t => t.id === id);
        if (index <= 0) {
            return false;
        }

        // Swap with previous task
        [this.queue[index - 1], this.queue[index]] = [this.queue[index], this.queue[index - 1]];

        this.emitChange('reordered', this.queue[index - 1]);
        return true;
    }

    /**
     * Move a task down one position in the queue
     * @param id Task ID
     * @returns true if task was found and moved
     */
    moveDown(id: string): boolean {
        const index = this.queue.findIndex(t => t.id === id);
        if (index === -1 || index >= this.queue.length - 1) {
            return false;
        }

        // Swap with next task
        [this.queue[index], this.queue[index + 1]] = [this.queue[index + 1], this.queue[index]];

        this.emitChange('reordered', this.queue[index + 1]);
        return true;
    }

    /**
     * Get the position of a task in the queue (1-based)
     * @param id Task ID
     * @returns Position (1-based) or -1 if not found
     */
    getPosition(id: string): number {
        const index = this.queue.findIndex(t => t.id === id);
        return index === -1 ? -1 : index + 1;
    }

    // ========================================================================
    // Queue Control
    // ========================================================================

    /**
     * Pause queue processing
     * Running tasks continue, but no new tasks will be started
     */
    pause(): void {
        if (!this.paused) {
            this.paused = true;
            this.emitChange('paused');
            this.emit('paused');
        }
    }

    /**
     * Resume queue processing
     */
    resume(): void {
        if (this.paused) {
            this.paused = false;
            this.emitChange('resumed');
            this.emit('resumed');
        }
    }

    /**
     * Check if queue is paused
     */
    isPaused(): boolean {
        return this.paused;
    }

    /**
     * Clear all queued tasks (does not affect running or history)
     */
    clear(): void {
        const clearedTasks = [...this.queue];
        this.queue = [];

        // Move all to history as cancelled
        for (const task of clearedTasks) {
            task.status = 'cancelled';
            task.completedAt = Date.now();
            this.addToHistory(task);
        }

        this.emitChange('cleared');
    }

    /**
     * Clear history
     */
    clearHistory(): void {
        this.history = [];
        this.emitChange('cleared');
    }

    /**
     * Reset the queue manager (clears everything)
     */
    reset(): void {
        this.queue = [];
        this.running.clear();
        this.history = [];
        this.paused = false;
        this.emitChange('cleared');
    }

    // ========================================================================
    // Private Helpers
    // ========================================================================

    /**
     * Insert a task into the queue maintaining priority order
     */
    private insertByPriority(task: QueuedTask): void {
        // Find insertion point using binary search
        let low = 0;
        let high = this.queue.length;

        while (low < high) {
            const mid = Math.floor((low + high) / 2);
            if (comparePriority(task, this.queue[mid]) < 0) {
                high = mid;
            } else {
                low = mid + 1;
            }
        }

        this.queue.splice(low, 0, task);
    }

    /**
     * Add a task to history, respecting max history size
     */
    private addToHistory(task: QueuedTask): void {
        if (!this.options.keepHistory) {
            return;
        }

        this.history.unshift(task);

        // Trim history if needed
        if (this.history.length > this.options.maxHistorySize) {
            this.history = this.history.slice(0, this.options.maxHistorySize);
        }
    }

    /**
     * Emit a queue change event
     */
    private emitChange(type: QueueChangeType, task?: QueuedTask): void {
        const event: QueueChangeEvent = {
            type,
            taskId: task?.id,
            task,
            timestamp: Date.now(),
        };
        this.emit('change', event);
    }
}

/**
 * Create a new TaskQueueManager instance
 */
export function createTaskQueueManager(
    options?: TaskQueueManagerOptions
): TaskQueueManager {
    return new TaskQueueManager(options);
}
