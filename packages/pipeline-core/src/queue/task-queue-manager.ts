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
    PauseMarker,
    QueueItem,
    CreateTaskInput,
    TaskUpdate,
    QueueChangeEvent,
    QueueChangeType,
    QueueStats,
    TaskQueueManagerOptions,
    DEFAULT_QUEUE_MANAGER_OPTIONS,
    comparePriority,
    generateTaskId,
} from './types';

// ============================================================================
// Helpers
// ============================================================================

/** Type guard: true when the queue item is a PauseMarker. */
function isPauseMarker(item: QueueItem): item is PauseMarker {
    return (item as PauseMarker).kind === 'pause-marker';
}

/**
 * Task queue manager for managing AI task execution queue
 */
export class TaskQueueManager extends EventEmitter {
    /** Queue of pending tasks and pause markers (sorted by priority for tasks; markers at absolute positions) */
    private queue: Array<QueueItem> = [];
    /** Currently running tasks */
    private running: Map<string, QueuedTask> = new Map();
    /** History of completed/failed/cancelled tasks */
    private history: QueuedTask[] = [];
    /** Whether the queue is paused */
    private paused = false;
    /** Whether the queue is in drain mode (no new tasks accepted) */
    private draining = false;
    /** Callbacks waiting for the queue to become idle */
    private idleResolvers: Array<() => void> = [];
    /** Configuration options */
    private readonly options: Required<Omit<TaskQueueManagerOptions, 'getTaskRepoId'>>;
    /** Set of paused repository IDs */
    private pausedRepos = new Set<string>();
    /** Function to extract repo ID from a task (injected) */
    private readonly getTaskRepoId?: (task: QueuedTask) => string | undefined;

    constructor(options: TaskQueueManagerOptions = {}) {
        super();
        const { getTaskRepoId, ...rest } = options;
        this.options = { ...DEFAULT_QUEUE_MANAGER_OPTIONS, ...rest };
        this.getTaskRepoId = getTaskRepoId;
    }

    // ========================================================================
    // Core Operations
    // ========================================================================

    /**
     * Add a task to the queue
     * @param input Task input (without auto-generated fields)
     * @returns The ID of the queued task
     */
    enqueue(input: CreateTaskInput): string {
        // Reject new tasks when in drain mode
        if (this.draining) {
            throw new Error('Queue is draining — no new tasks accepted');
        }

        // Check queue size limit
        if (this.options.maxQueueSize > 0 && this.size() >= this.options.maxQueueSize) {
            throw new Error(`Queue is full (max size: ${this.options.maxQueueSize})`);
        }

        const task: QueuedTask = {
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
     * Remove and return the next eligible item from the queue.
     * Pause markers are returned (and consumed) when encountered in order.
     * Frozen tasks and tasks from paused repos are skipped.
     * @returns The next item, or undefined if queue is empty
     */
    dequeue(): QueueItem | undefined {
        if (this.queue.length === 0) {
            return undefined;
        }

        for (let i = 0; i < this.queue.length; i++) {
            const item = this.queue[i];
            if (isPauseMarker(item)) {
                // Markers are always eligible — return and consume
                this.queue.splice(i, 1);
                return item;
            }
            const task = item as QueuedTask;
            if (task.frozen) continue;
            if (this.getTaskRepoId && this.pausedRepos.size > 0) {
                const repoId = this.getTaskRepoId(task);
                if (repoId && this.pausedRepos.has(repoId)) continue;
            }
            this.queue.splice(i, 1);
            return task;
        }
        return undefined;
    }

    /**
     * Get the next eligible item without removing it.
     * Pause markers are returned when encountered in order.
     * Skips frozen tasks and (when configured) tasks from paused repos.
     * @returns The next eligible item, or undefined if none available
     */
    peek(): QueueItem | undefined {
        for (const item of this.queue) {
            if (isPauseMarker(item)) {
                return item;
            }
            const task = item as QueuedTask;
            if (task.frozen) continue;
            if (this.getTaskRepoId && this.pausedRepos.size > 0) {
                const repoId = this.getTaskRepoId(task);
                if (repoId && this.pausedRepos.has(repoId)) continue;
            }
            return task;
        }
        return undefined;
    }

    // ========================================================================
    // Queue Access
    // ========================================================================

    /**
     * Get all tasks (queued + running + history)
     */
    getAll(): QueuedTask[] {
        return [
            ...this.queue.filter((item): item is QueuedTask => !isPauseMarker(item)),
            ...Array.from(this.running.values()),
            ...this.history,
        ];
    }

    /**
     * Get all queue items in order, including pause markers.
     */
    getQueueItems(): Array<QueueItem> {
        return [...this.queue];
    }

    /**
     * Get all queued tasks (waiting for execution, excluding pause markers)
     */
    getQueued(): QueuedTask[] {
        return this.queue.filter((item): item is QueuedTask => !isPauseMarker(item));
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
     * Get the number of queued tasks (excludes pause markers)
     */
    size(): number {
        return this.queue.filter(t => !isPauseMarker(t)).length;
    }

    /**
     * Get queue statistics
     */
    getStats(): QueueStats {
        const taskCount = this.queue.filter(t => !isPauseMarker(t)).length;
        return {
            queued: taskCount,
            running: this.running.size,
            completed: this.history.filter(t => t.status === 'completed').length,
            failed: this.history.filter(t => t.status === 'failed').length,
            cancelled: this.history.filter(t => t.status === 'cancelled').length,
            total: taskCount + this.running.size + this.history.length,
            isPaused: this.paused,
            isDraining: this.draining,
            pausedRepos: Array.from(this.pausedRepos),
        };
    }

    // ========================================================================
    // Task Operations
    // ========================================================================

    /**
     * Get a task by ID (searches all: queued, running, history)
     */
    getTask(id: string): QueuedTask | undefined {
        // Check queue (exclude pause markers)
        const queued = this.queue.find(t => !isPauseMarker(t) && t.id === id) as QueuedTask | undefined;
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
        const queueIndex = this.queue.findIndex(t => !isPauseMarker(t) && t.id === id);
        if (queueIndex !== -1) {
            const task = this.queue[queueIndex] as QueuedTask;
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
        const index = this.queue.findIndex(t => !isPauseMarker(t) && t.id === id);
        if (index === -1) {
            return false;
        }

        const [task] = this.queue.splice(index, 1);
        this.emitChange('removed', task as QueuedTask);
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
        const queueIndex = this.queue.findIndex(t => !isPauseMarker(t) && t.id === id);
        if (queueIndex !== -1) {
            const [item] = this.queue.splice(queueIndex, 1);
            const task = item as QueuedTask;
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
            this.checkIdle();
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
        const index = this.queue.findIndex(t => !isPauseMarker(t) && t.id === id);
        if (index === -1) {
            return undefined;
        }

        const [item] = this.queue.splice(index, 1);
        const task = item as QueuedTask;
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
        this.checkIdle();
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
        this.checkIdle();
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
    // Freeze / Unfreeze
    // ========================================================================

    /**
     * Freeze a queued task so the executor skips it.
     * The task remains in its queue position with status 'queued'.
     * @param id Task ID
     * @returns true if the task was found in the queue and frozen
     */
    freezeTask(id: string): boolean {
        const task = this.queue.find(t => !isPauseMarker(t) && t.id === id) as QueuedTask | undefined;
        if (!task) return false;
        task.frozen = true;
        this.emitChange('frozen', task);
        return true;
    }

    /**
     * Unfreeze a previously frozen task, making it eligible for execution again.
     * @param id Task ID
     * @returns true if the task was found in the queue and unfrozen
     */
    unfreezeTask(id: string): boolean {
        const task = this.queue.find(t => !isPauseMarker(t) && t.id === id) as QueuedTask | undefined;
        if (!task || !task.frozen) return false;
        task.frozen = false;
        this.emitChange('unfrozen', task);
        return true;
    }

    // ========================================================================
    // Pause Markers
    // ========================================================================

    /**
     * Insert a pause marker at the given position in the queue.
     * When the executor reaches the marker, it pauses and discards it.
     *
     * @param afterIndex 0-based index of the item after which the marker is inserted.
     *   Pass -1 to insert at the very beginning.
     *   Values >= queue.length insert at the end.
     * @returns The id of the newly created marker.
     */
    insertPauseMarker(afterIndex: number): string {
        const marker: PauseMarker = {
            kind: 'pause-marker',
            id: generateTaskId(),
            createdAt: Date.now(),
        };

        // Clamp insertion index
        const insertAt = Math.max(0, Math.min(afterIndex + 1, this.queue.length));
        this.queue.splice(insertAt, 0, marker);

        this.emitChange('pause-marker-added');
        this.emit('pause-marker-added', marker);
        return marker.id;
    }

    /**
     * Remove a pause marker by id.
     * @returns true if the marker was found and removed
     */
    removePauseMarker(markerId: string): boolean {
        const index = this.queue.findIndex(
            item => isPauseMarker(item) && item.id === markerId
        );
        if (index === -1) return false;

        this.queue.splice(index, 1);
        this.emitChange('pause-marker-removed');
        this.emit('pause-marker-removed', markerId);
        return true;
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
        const index = this.queue.findIndex(t => !isPauseMarker(t) && t.id === id);
        if (index === -1 || index === 0) {
            return index === 0; // Already at top
        }

        const [item] = this.queue.splice(index, 1);
        const task = item as QueuedTask;
        // Set to high priority and earliest timestamp to ensure it's first
        task.priority = 'high';
        task.createdAt = this.queue.length > 0 ? (this.queue[0] as QueuedTask).createdAt - 1 : Date.now();
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
        const index = this.queue.findIndex(t => !isPauseMarker(t) && t.id === id);
        if (index <= 0) {
            return false;
        }

        // Swap with previous task
        [this.queue[index - 1], this.queue[index]] = [this.queue[index], this.queue[index - 1]];

        this.emitChange('reordered', this.queue[index - 1] as QueuedTask);
        return true;
    }

    /**
     * Move a task down one position in the queue
     * @param id Task ID
     * @returns true if task was found and moved
     */
    moveDown(id: string): boolean {
        const index = this.queue.findIndex(t => !isPauseMarker(t) && t.id === id);
        if (index === -1 || index >= this.queue.length - 1) {
            return false;
        }

        // Swap with next task
        [this.queue[index], this.queue[index + 1]] = [this.queue[index + 1], this.queue[index]];

        this.emitChange('reordered', this.queue[index + 1] as QueuedTask);
        return true;
    }

    /**
     * Move a task to an arbitrary position in the queue (0-based index).
     * Does not mutate priority (unlike moveToTop).
     * @param id Task ID
     * @param targetIndex Desired 0-based index (clamped to valid range)
     * @returns true if the task was found (even if already at target), false if not found
     */
    moveToPosition(id: string, targetIndex: number): boolean {
        const currentIndex = this.queue.findIndex(t => !isPauseMarker(t) && t.id === id);
        if (currentIndex === -1) return false;
        const clamped = Math.max(0, Math.min(targetIndex, this.queue.length - 1));
        if (currentIndex === clamped) return true;
        const [item] = this.queue.splice(currentIndex, 1);
        this.queue.splice(clamped, 0, item);
        this.emitChange('reordered', item as QueuedTask);
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

    // ========================================================================
    // Per-Repo Pause Control
    // ========================================================================

    /**
     * Pause queue processing for a specific repository.
     * Tasks from this repo will remain in queue but won't be dequeued.
     */
    pauseRepo(repoId: string): void {
        if (!this.pausedRepos.has(repoId)) {
            this.pausedRepos.add(repoId);
            this.emitChange('repo-paused');
            this.emit('repo-paused', repoId);
        }
    }

    /**
     * Resume queue processing for a specific repository.
     */
    resumeRepo(repoId: string): void {
        if (this.pausedRepos.delete(repoId)) {
            this.emitChange('repo-resumed');
            this.emit('repo-resumed', repoId);
        }
    }

    /**
     * Check if a specific repository is paused.
     */
    isRepoPaused(repoId: string): boolean {
        return this.pausedRepos.has(repoId);
    }

    /**
     * Get all paused repository IDs.
     */
    getPausedRepos(): string[] {
        return Array.from(this.pausedRepos);
    }

    // ========================================================================
    // Drain Mode
    // ========================================================================

    /**
     * Enter drain mode: stop accepting new tasks.
     * Existing queued and running tasks continue to completion.
     */
    enterDrainMode(): void {
        if (!this.draining) {
            this.draining = true;
            this.emitChange('drain-started');
            this.emit('drain-started');
            // Check if already idle
            this.checkIdle();
        }
    }

    /**
     * Exit drain mode: re-enable normal task acceptance.
     */
    exitDrainMode(): void {
        if (this.draining) {
            this.draining = false;
            // Clear any pending idle resolvers
            this.idleResolvers = [];
            this.emitChange('drain-cancelled');
            this.emit('drain-cancelled');
        }
    }

    /**
     * Check if the queue is in drain mode.
     */
    isDraining(): boolean {
        return this.draining;
    }

    /**
     * Wait until the queue is idle (queued=0 and running=0).
     * Resolves immediately if already idle.
     */
    waitUntilIdle(): Promise<void> {
        const taskCount = this.queue.filter(t => !isPauseMarker(t)).length;
        if (taskCount === 0 && this.running.size === 0) {
            return Promise.resolve();
        }
        return new Promise<void>((resolve) => {
            this.idleResolvers.push(resolve);
        });
    }

    /**
     * Get counts of queued and running tasks.
     */
    getTaskCounts(): { queued: number; running: number; total: number } {
        const taskCount = this.queue.filter(t => !isPauseMarker(t)).length;
        return {
            queued: taskCount,
            running: this.running.size,
            total: taskCount + this.running.size,
        };
    }

    /**
     * Clear all queued tasks and markers (does not affect running or history)
     */
    clear(): void {
        const clearedItems = [...this.queue];
        this.queue = [];

        // Move tasks to history as cancelled; discard markers
        for (const item of clearedItems) {
            if (isPauseMarker(item)) continue;
            const task = item as QueuedTask;
            task.status = 'cancelled';
            task.completedAt = Date.now();
            this.addToHistory(task);
        }

        this.emitChange('cleared');
    }

    /**
     * Restore history entries (e.g. from persisted state on startup).
     * Prepends tasks to history, respecting maxHistorySize.
     */
    restoreHistory(tasks: QueuedTask[]): void {
        if (!this.options.keepHistory || tasks.length === 0) {
            return;
        }
        // Prepend restored tasks (older) after current history (newer)
        this.history = [...this.history, ...tasks];
        // Trim to max size
        if (this.history.length > this.options.maxHistorySize) {
            this.history = this.history.slice(0, this.options.maxHistorySize);
        }
    }

    /**
     * Clear history
     */
    clearHistory(): void {
        this.history = [];
        this.emitChange('cleared');
    }

    /**
     * Force-fail all running tasks (e.g., stale processes killed externally).
     * Moves all running tasks to history with a failed status.
     * @param error Error message to set on the failed tasks
     * @returns The number of tasks force-failed
     */
    forceFailRunning(error: string = 'Task was force-failed (assumed stale)'): number {
        const runningTasks = Array.from(this.running.values());
        if (runningTasks.length === 0) {
            return 0;
        }

        for (const task of runningTasks) {
            task.status = 'failed';
            task.completedAt = Date.now();
            task.error = error;
            this.running.delete(task.id);
            this.addToHistory(task);
            this.emitChange('updated', task);
            this.emit('taskFailed', task, new Error(error));
        }

        this.checkIdle();
        return runningTasks.length;
    }

    /**
     * Force-fail a single running task by ID.
     * @param id Task ID
     * @param error Error message
     * @returns true if task was found and force-failed
     */
    forceFailTask(id: string, error: string = 'Task was force-failed (assumed stale)'): boolean {
        const task = this.running.get(id);
        if (!task) {
            return false;
        }

        task.status = 'failed';
        task.completedAt = Date.now();
        task.error = error;
        this.running.delete(id);
        this.addToHistory(task);
        this.emitChange('updated', task);
        this.emit('taskFailed', task, new Error(error));
        this.checkIdle();
        return true;
    }

    /**
     * Reset the queue manager (clears everything)
     */
    reset(): void {
        this.queue = [];
        this.running.clear();
        this.history = [];
        this.paused = false;
        this.draining = false;
        this.pausedRepos.clear();
        // Resolve any pending idle waiters since there's nothing left
        const resolvers = this.idleResolvers;
        this.idleResolvers = [];
        for (const resolve of resolvers) {
            resolve();
        }
        this.emitChange('cleared');
    }

    // ========================================================================
    // Private Helpers
    // ========================================================================

    /**
     * Check if queue is idle and resolve pending waiters
     */
    private checkIdle(): void {
        const taskCount = this.queue.filter(t => !isPauseMarker(t)).length;
        if (taskCount === 0 && this.running.size === 0 && this.idleResolvers.length > 0) {
            const resolvers = this.idleResolvers;
            this.idleResolvers = [];
            for (const resolve of resolvers) {
                resolve();
            }
        }
    }

    /**
     * Insert a task into the queue maintaining priority order.
     * Uses a linear scan because pause markers can interrupt the sorted order.
     * Markers are transparent in priority comparison — the task is inserted before
     * the first task with strictly lower priority, which may place it before or
     * after existing markers.
     */
    private insertByPriority(task: QueuedTask): void {
        let insertAt = this.queue.length;
        for (let i = 0; i < this.queue.length; i++) {
            const item = this.queue[i];
            if (!isPauseMarker(item) && comparePriority(task, item as QueuedTask) < 0) {
                insertAt = i;
                break;
            }
        }
        this.queue.splice(insertAt, 0, task);
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
