/**
 * QueueExecutor
 *
 * Executes tasks from the queue with configurable concurrency.
 * Uses ConcurrencyLimiter for execution control.
 *
 * Cross-platform compatible (Linux/Mac/Windows).
 */

import { EventEmitter } from 'events';
import { ConcurrencyLimiter, CancellationError } from '../workflow/concurrency-limiter';
import { TaskQueueManager } from './task-queue-manager';
import {
    QueuedTask,
    TaskExecutor,
    TaskExecutionResult,
    QueueExecutorOptions,
    DEFAULT_EXECUTOR_OPTIONS,
    DEFAULT_TASK_CONFIG,
} from './types';

/**
 * Executor that processes tasks from a queue
 */
export class QueueExecutor extends EventEmitter {
    /** The queue manager to pull tasks from */
    private readonly queueManager: TaskQueueManager;
    /** The task executor implementation */
    private readonly taskExecutor: TaskExecutor;
    /** Concurrency limiter for shared (read-only) tasks */
    private sharedLimiter: ConcurrencyLimiter;
    /** Concurrency limiter for exclusive (write) tasks */
    private exclusiveLimiter: ConcurrencyLimiter;
    /** Policy callback to classify tasks */
    private readonly isExclusive: (task: QueuedTask) => boolean;
    /** Whether the executor is running */
    private running = false;
    /** Whether stop was requested */
    private stopRequested = false;
    /** Set of task IDs that have been requested to cancel */
    private cancelledTasks: Set<string> = new Set();
    /** Current configuration */
    private options: Required<QueueExecutorOptions>;
    /** Processing loop promise */
    private processingPromise: Promise<void> | null = null;

    constructor(
        queueManager: TaskQueueManager,
        taskExecutor: TaskExecutor,
        options: QueueExecutorOptions = {}
    ) {
        super();
        this.queueManager = queueManager;
        this.taskExecutor = taskExecutor;
        const opts = { ...DEFAULT_EXECUTOR_OPTIONS, ...options };
        // Backward compat: if only maxConcurrency was provided, use it for both limiters
        if (options.maxConcurrency !== undefined && options.exclusiveConcurrency === undefined) {
            opts.exclusiveConcurrency = options.maxConcurrency;
        }
        if (options.maxConcurrency !== undefined && options.sharedConcurrency === undefined) {
            opts.sharedConcurrency = options.maxConcurrency;
        }
        this.options = opts;
        this.sharedLimiter = new ConcurrencyLimiter(this.options.sharedConcurrency);
        this.exclusiveLimiter = new ConcurrencyLimiter(this.options.exclusiveConcurrency);
        this.isExclusive = this.options.isExclusive;

        // Listen to queue events
        this.setupQueueListeners();

        // Auto-start if configured
        if (this.options.autoStart) {
            this.start();
        }
    }

    // ========================================================================
    // Lifecycle
    // ========================================================================

    /**
     * Start processing tasks from the queue
     */
    start(): void {
        if (this.running) {
            return;
        }

        this.running = true;
        this.stopRequested = false;
        this.emit('started');

        // Start the processing loop
        this.processingPromise = this.processLoop();
    }

    /**
     * Stop processing tasks (running tasks will complete)
     */
    stop(): void {
        if (!this.running) {
            return;
        }

        this.stopRequested = true;
        this.running = false;
        this.emit('stopped');
    }

    /**
     * Check if the executor is running
     */
    isRunning(): boolean {
        return this.running;
    }

    /**
     * Wait for all currently running tasks to complete
     */
    async waitForCompletion(): Promise<void> {
        if (this.processingPromise) {
            await this.processingPromise;
        }
    }

    // ========================================================================
    // Graceful Drain
    // ========================================================================

    /**
     * Drain all queued and running tasks, then dispose.
     *
     * 1. Enters drain mode on the queue manager (rejects new tasks).
     * 2. Waits for all queued + running tasks to finish (or timeout).
     * 3. Calls dispose().
     *
     * @param timeoutMs Optional maximum wait time in ms. undefined = wait forever.
     * @returns Object with drain outcome: 'completed' | 'timeout'
     */
    async drainAndDispose(timeoutMs?: number): Promise<{ outcome: 'completed' | 'timeout' }> {
        const counts = this.queueManager.getTaskCounts();
        this.emit('drain-start', { queued: counts.queued, running: counts.running });

        // Enter drain mode to stop accepting new tasks
        this.queueManager.enterDrainMode();

        // If already idle, finish immediately
        if (counts.queued === 0 && counts.running === 0) {
            this.emit('drain-complete', { outcome: 'completed', queued: 0, running: 0 });
            this.dispose();
            return { outcome: 'completed' };
        }

        // Set up progress polling
        const pollInterval = setInterval(() => {
            const current = this.queueManager.getTaskCounts();
            this.emit('drain-progress', { queued: current.queued, running: current.running });
        }, 1000);

        try {
            const idlePromise = this.queueManager.waitUntilIdle();

            let outcome: 'completed' | 'timeout';

            if (timeoutMs !== undefined && timeoutMs > 0) {
                // Race between idle and timeout
                const timeoutPromise = new Promise<'timeout'>((resolve) => {
                    setTimeout(() => resolve('timeout'), timeoutMs);
                });

                const result = await Promise.race([
                    idlePromise.then(() => 'completed' as const),
                    timeoutPromise,
                ]);
                outcome = result;
            } else {
                // Wait forever
                await idlePromise;
                outcome = 'completed';
            }

            const finalCounts = this.queueManager.getTaskCounts();

            if (outcome === 'timeout') {
                this.emit('drain-timeout', { queued: finalCounts.queued, running: finalCounts.running, timeoutMs });
            } else {
                this.emit('drain-complete', { outcome: 'completed', queued: 0, running: 0 });
            }

            return { outcome };
        } finally {
            clearInterval(pollInterval);
            this.dispose();
        }
    }

    // ========================================================================
    // Configuration
    // ========================================================================

    /**
     * Set the maximum concurrency
     * @param n New concurrency limit
     */
    setMaxConcurrency(n: number): void {
        if (n < 1) {
            throw new Error('maxConcurrency must be at least 1');
        }
        this.options.maxConcurrency = n;
        this.options.sharedConcurrency = n;
        this.options.exclusiveConcurrency = n;
        this.sharedLimiter = new ConcurrencyLimiter(n);
        this.exclusiveLimiter = new ConcurrencyLimiter(n);
    }

    /**
     * Get the current maximum concurrency
     */
    getMaxConcurrency(): number {
        return this.options.maxConcurrency;
    }

    /**
     * Set the concurrency limit for shared (read-only) tasks
     */
    setSharedConcurrency(n: number): void {
        if (n < 1) {
            throw new Error('sharedConcurrency must be at least 1');
        }
        this.options.sharedConcurrency = n;
        this.sharedLimiter = new ConcurrencyLimiter(n);
    }

    /**
     * Set the concurrency limit for exclusive (write) tasks
     */
    setExclusiveConcurrency(n: number): void {
        if (n < 1) {
            throw new Error('exclusiveConcurrency must be at least 1');
        }
        this.options.exclusiveConcurrency = n;
        this.exclusiveLimiter = new ConcurrencyLimiter(n);
    }

    /**
     * Get the current shared concurrency limit
     */
    getSharedConcurrency(): number {
        return this.options.sharedConcurrency;
    }

    /**
     * Get the current exclusive concurrency limit
     */
    getExclusiveConcurrency(): number {
        return this.options.exclusiveConcurrency;
    }

    // ========================================================================
    // Task Cancellation
    // ========================================================================

    /**
     * Request cancellation of a specific task
     * @param taskId ID of the task to cancel
     */
    cancelTask(taskId: string): void {
        this.cancelledTasks.add(taskId);

        // Also cancel in queue manager
        this.queueManager.cancelTask(taskId);

        // Notify executor if it has cancel support
        if (this.taskExecutor.cancel) {
            this.taskExecutor.cancel(taskId);
        }
    }

    /**
     * Check if a task has been cancelled
     */
    isTaskCancelled(taskId: string): boolean {
        return this.cancelledTasks.has(taskId);
    }

    // ========================================================================
    // Processing Loop
    // ========================================================================

    /**
     * Main processing loop
     */
    private async processLoop(): Promise<void> {
        while (this.running && !this.stopRequested) {
            // Check if queue is paused
            if (this.queueManager.isPaused()) {
                await this.delay(100);
                continue;
            }

            // Try to get next item
            const item = this.queueManager.peek();
            if (!item) {
                // No items, wait a bit
                await this.delay(100);
                continue;
            }

            // Handle pause marker — consume it and pause the queue
            if ((item as any).kind === 'pause-marker') {
                this.queueManager.dequeue();   // consume the marker
                this.queueManager.pause();     // pause the queue (same as clicking ⏸)
                this.emit('pause-marker-reached', item);
                continue;
            }

            const task = item as import('./types').QueuedTask;

            // Check if we have capacity on the correct limiter
            const limiter = this.isExclusive(task) ? this.exclusiveLimiter : this.sharedLimiter;
            if (limiter.runningCount >= limiter.limit) {
                await this.delay(50);
                continue;
            }

            // Start executing the task (don't await - let it run in parallel)
            this.executeTask(task).catch(error => {
                // Log error but don't crash the loop
                this.emit('error', error);
            });

            // Small delay to prevent tight loop
            await this.delay(10);
        }
    }

    /**
     * Execute a single task
     */
    private async executeTask(task: QueuedTask): Promise<void> {
        const taskId = task.id;

        // Check if already cancelled
        if (this.cancelledTasks.has(taskId)) {
            return;
        }

        // Mark as started in queue manager
        const startedTask = this.queueManager.markStarted(taskId);
        if (!startedTask) {
            // Task was removed from queue
            return;
        }

        this.emit('taskStarted', startedTask);

        // Create cancellation checker
        const isCancelled = () => this.cancelledTasks.has(taskId);

        try {
            // Execute with concurrency limiting via correct pool
            const taskLimiter = this.isExclusive(startedTask) ? this.exclusiveLimiter : this.sharedLimiter;
            const result = await taskLimiter.run(
                () => this.executeWithTimeout(startedTask),
                isCancelled
            );

            // Check if cancelled during execution
            if (isCancelled()) {
                // Already marked as cancelled by cancelTask()
                this.cancelledTasks.delete(taskId);
                return;
            }

            if (result.success) {
                this.queueManager.markCompleted(taskId, result.result);
                this.emit('taskCompleted', startedTask, result.result);
            } else {
                await this.handleTaskFailure(startedTask, result.error || new Error('Unknown error'));
            }
        } catch (error) {
            if (error instanceof CancellationError) {
                // Task was cancelled
                this.cancelledTasks.delete(taskId);
                this.emit('taskCancelled', startedTask);
            } else {
                await this.handleTaskFailure(startedTask, error as Error);
            }
        }
    }

    /**
     * Execute a task with timeout
     */
    private async executeWithTimeout(task: QueuedTask): Promise<TaskExecutionResult> {
        const timeoutMs = task.config.timeoutMs ?? DEFAULT_TASK_CONFIG.timeoutMs!;

        const startTime = Date.now();

        // Create timeout promise
        const timeoutPromise = new Promise<TaskExecutionResult>((_, reject) => {
            setTimeout(() => {
                reject(new Error(`Task timed out after ${timeoutMs}ms`));
            }, timeoutMs);
        });

        // Race between execution and timeout
        try {
            const result = await Promise.race([
                this.taskExecutor.execute(task),
                timeoutPromise,
            ]);

            return {
                ...result,
                durationMs: Date.now() - startTime,
            };
        } catch (error) {
            return {
                success: false,
                error: error as Error,
                durationMs: Date.now() - startTime,
            };
        }
    }

    /**
     * Handle task failure with retry logic
     */
    private async handleTaskFailure(task: QueuedTask, error: Error): Promise<void> {
        const config = task.config;
        const retryCount = task.retryCount || 0;
        const maxRetries = config.retryAttempts ?? DEFAULT_TASK_CONFIG.retryAttempts!;

        if (config.retryOnFailure && retryCount < maxRetries) {
            // Retry the task
            const retryDelay = config.retryDelayMs ?? DEFAULT_TASK_CONFIG.retryDelayMs!;
            await this.delay(retryDelay);

            this.queueManager.markRetry(task.id, true);
            this.emit('taskRetry', task, retryCount + 1);
        } else {
            // Mark as failed
            this.queueManager.markFailed(task.id, error);
            this.emit('taskFailed', task, error);
        }
    }

    // ========================================================================
    // Event Listeners
    // ========================================================================

    /**
     * Set up listeners for queue events
     */
    private setupQueueListeners(): void {
        // When queue is resumed, make sure we're processing
        this.queueManager.on('resumed', () => {
            if (this.running && !this.processingPromise) {
                this.processingPromise = this.processLoop();
            }
        });
    }

    // ========================================================================
    // Utilities
    // ========================================================================

    /**
     * Delay helper
     */
    private delay(ms: number): Promise<void> {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    /**
     * Dispose of the executor
     */
    dispose(): void {
        this.stop();
        this.cancelledTasks.clear();
        this.removeAllListeners();
    }
}

/**
 * Create a new QueueExecutor instance
 */
export function createQueueExecutor(
    queueManager: TaskQueueManager,
    taskExecutor: TaskExecutor,
    options?: QueueExecutorOptions
): QueueExecutor {
    return new QueueExecutor(queueManager, taskExecutor, options);
}

/**
 * A simple pass-through executor for testing
 * Executes tasks by calling a provided function
 */
export class SimpleTaskExecutor implements TaskExecutor {
    private readonly executeFn: (task: QueuedTask) => Promise<unknown>;
    private readonly cancelledTasks: Set<string> = new Set();

    constructor(executeFn: (task: QueuedTask) => Promise<unknown>) {
        this.executeFn = executeFn;
    }

    async execute(task: QueuedTask): Promise<TaskExecutionResult> {
        if (this.cancelledTasks.has(task.id)) {
            return {
                success: false,
                error: new CancellationError(),
                durationMs: 0,
            };
        }

        const startTime = Date.now();

        try {
            const result = await this.executeFn(task);
            return {
                success: true,
                result,
                durationMs: Date.now() - startTime,
            };
        } catch (error) {
            return {
                success: false,
                error: error as Error,
                durationMs: Date.now() - startTime,
            };
        }
    }

    cancel(taskId: string): void {
        this.cancelledTasks.add(taskId);
    }
}

/**
 * Create a simple task executor
 */
export function createSimpleTaskExecutor(
    executeFn: (task: QueuedTask) => Promise<unknown>
): SimpleTaskExecutor {
    return new SimpleTaskExecutor(executeFn);
}
