/**
 * ConcurrencyLimiter
 *
 * Controls parallel execution of async tasks with a configurable concurrency limit.
 * Prevents overwhelming APIs with too many simultaneous requests.
 *
 * Cross-platform compatible (Linux/Mac/Windows).
 */

/**
 * Error thrown when an operation is cancelled
 */
export class CancellationError extends Error {
    constructor(message = 'Operation cancelled') {
        super(message);
        this.name = 'CancellationError';
    }
}

/**
 * A limiter that controls the maximum number of concurrent async operations.
 * Uses a queue-based approach to manage pending tasks.
 */
export class ConcurrencyLimiter {
    private running = 0;
    private queue: Array<() => void> = [];

    /**
     * Creates a new ConcurrencyLimiter
     * @param maxConcurrency Maximum number of concurrent operations (default: 5)
     */
    constructor(private readonly maxConcurrency: number = 5) {
        if (maxConcurrency < 1) {
            throw new Error('maxConcurrency must be at least 1');
        }
    }

    /**
     * Get the current number of running tasks
     */
    get runningCount(): number {
        return this.running;
    }

    /**
     * Get the current number of queued tasks
     */
    get queuedCount(): number {
        return this.queue.length;
    }

    /**
     * Get the maximum concurrency limit
     */
    get limit(): number {
        return this.maxConcurrency;
    }

    /**
     * Execute a single async function with concurrency limiting.
     * If the limit is reached, the function will be queued until a slot is available.
     *
     * @param fn The async function to execute
     * @param isCancelled Optional function to check if operation should be cancelled
     * @returns Promise that resolves with the function's result
     */
    async run<T>(fn: () => Promise<T>, isCancelled?: () => boolean): Promise<T> {
        // Check for cancellation before acquiring slot
        if (isCancelled?.()) {
            throw new CancellationError();
        }

        await this.acquire();

        // Check for cancellation after acquiring slot but before executing
        if (isCancelled?.()) {
            this.release();
            throw new CancellationError();
        }

        try {
            return await fn();
        } finally {
            this.release();
        }
    }

    /**
     * Execute multiple async tasks with concurrency limiting.
     * Similar to Promise.all but respects the maxConcurrency limit.
     *
     * @param tasks Array of functions that return promises
     * @param isCancelled Optional function to check if operation should be cancelled
     * @returns Promise that resolves with array of results (in same order as input)
     */
    async all<T>(tasks: Array<() => Promise<T>>, isCancelled?: () => boolean): Promise<T[]> {
        return Promise.all(tasks.map(task => this.run(task, isCancelled)));
    }

    /**
     * Execute multiple async tasks with concurrency limiting, settling all promises.
     * Similar to Promise.allSettled but respects the maxConcurrency limit.
     *
     * @param tasks Array of functions that return promises
     * @param isCancelled Optional function to check if operation should be cancelled
     * @returns Promise that resolves with array of settled results
     */
    async allSettled<T>(tasks: Array<() => Promise<T>>, isCancelled?: () => boolean): Promise<PromiseSettledResult<T>[]> {
        return Promise.all(
            tasks.map(task =>
                this.run(task, isCancelled)
                    .then(value => ({ status: 'fulfilled' as const, value }))
                    .catch(reason => ({ status: 'rejected' as const, reason }))
            )
        );
    }

    /**
     * Acquire a slot for execution.
     * If maxConcurrency is reached, this will wait until a slot is available.
     */
    private acquire(): Promise<void> {
        if (this.running < this.maxConcurrency) {
            this.running++;
            return Promise.resolve();
        }

        // Queue the request and wait for a slot
        return new Promise<void>(resolve => {
            this.queue.push(resolve);
        });
    }

    /**
     * Release a slot after execution completes.
     * If there are queued tasks, the next one will be started.
     */
    private release(): void {
        this.running--;

        // Start next queued task if any
        const next = this.queue.shift();
        if (next) {
            this.running++;
            next();
        }
    }
}

// Re-export for backward compatibility
export { DEFAULT_MAX_CONCURRENCY } from '../config/defaults';
