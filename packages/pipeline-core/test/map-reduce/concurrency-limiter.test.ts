/**
 * Tests for ConcurrencyLimiter
 *
 * Cross-platform compatible (Linux/Mac/Windows).
 */

import { describe, it, expect } from 'vitest';
import { ConcurrencyLimiter, CancellationError } from '../../src/map-reduce/concurrency-limiter';

describe('ConcurrencyLimiter', () => {
    it('constructor throws for invalid maxConcurrency', () => {
        expect(() => new ConcurrencyLimiter(0)).toThrow(/maxConcurrency must be at least 1/);
        expect(() => new ConcurrencyLimiter(-1)).toThrow(/maxConcurrency must be at least 1/);
    });

    it('constructor accepts valid maxConcurrency', () => {
        const limiter = new ConcurrencyLimiter(1);
        expect(limiter.limit).toBe(1);

        const limiter5 = new ConcurrencyLimiter(5);
        expect(limiter5.limit).toBe(5);
    });

    it('default maxConcurrency is 5', () => {
        const limiter = new ConcurrencyLimiter();
        expect(limiter.limit).toBe(5);
    });

    it('runningCount and queuedCount are initially 0', () => {
        const limiter = new ConcurrencyLimiter(3);
        expect(limiter.runningCount).toBe(0);
        expect(limiter.queuedCount).toBe(0);
    });

    it('run() executes function and returns result', async () => {
        const limiter = new ConcurrencyLimiter(5);
        const result = await limiter.run(async () => 42);
        expect(result).toBe(42);
    });

    it('run() handles async functions correctly', async () => {
        const limiter = new ConcurrencyLimiter(5);
        const result = await limiter.run(async () => {
            await delay(10);
            return 'async result';
        });
        expect(result).toBe('async result');
    });

    it('run() propagates errors', async () => {
        const limiter = new ConcurrencyLimiter(5);
        await expect(
            limiter.run(async () => { throw new Error('test error'); })
        ).rejects.toThrow(/test error/);
    });

    it('all() executes all tasks and returns results in order', async () => {
        const limiter = new ConcurrencyLimiter(5);
        const tasks = [
            async () => 1,
            async () => 2,
            async () => 3
        ];

        const results = await limiter.all(tasks);
        expect(results).toEqual([1, 2, 3]);
    });

    it('all() respects concurrency limit', async () => {
        const limiter = new ConcurrencyLimiter(2);
        let maxConcurrent = 0;
        let currentConcurrent = 0;

        const createTask = (value: number) => async () => {
            currentConcurrent++;
            maxConcurrent = Math.max(maxConcurrent, currentConcurrent);
            await delay(10);
            currentConcurrent--;
            return value;
        };

        const tasks = [1, 2, 3, 4, 5].map(createTask);
        await limiter.all(tasks);

        expect(maxConcurrent).toBeLessThanOrEqual(2);
    });

    it('allSettled() returns settled results for all tasks', async () => {
        const limiter = new ConcurrencyLimiter(5);
        const tasks = [
            async () => 1,
            async () => { throw new Error('fail'); },
            async () => 3
        ];

        const results = await limiter.allSettled(tasks);

        expect(results.length).toBe(3);
        expect(results[0].status).toBe('fulfilled');
        expect((results[0] as PromiseFulfilledResult<number>).value).toBe(1);
        expect(results[1].status).toBe('rejected');
        expect(results[2].status).toBe('fulfilled');
        expect((results[2] as PromiseFulfilledResult<number>).value).toBe(3);
    });

    it('concurrent execution with limit 1 runs sequentially', async () => {
        const limiter = new ConcurrencyLimiter(1);
        const order: number[] = [];

        const createTask = (id: number) => async () => {
            order.push(id);
            await delay(5);
            return id;
        };

        await limiter.all([createTask(1), createTask(2), createTask(3)]);

        // With limit 1, tasks should complete in order
        expect(order).toEqual([1, 2, 3]);
    });

    it('handles high concurrency scenarios', async () => {
        const limiter = new ConcurrencyLimiter(10);
        const taskCount = 50;
        const tasks = Array.from({ length: taskCount }, (_, i) => async () => {
            await delay(Math.random() * 10);
            return i;
        });

        const results = await limiter.all(tasks);
        expect(results.length).toBe(taskCount);
        // Results should be in original order despite async execution
        for (let i = 0; i < taskCount; i++) {
            expect(results[i]).toBe(i);
        }
    });

    it('slot is released even if task throws', async () => {
        const limiter = new ConcurrencyLimiter(1);

        // First task throws
        try {
            await limiter.run(async () => { throw new Error('fail'); });
        } catch {
            // Expected
        }

        // Second task should still run
        const result = await limiter.run(async () => 'success');
        expect(result).toBe('success');
    });

    it('queued tasks execute when slots become available', async () => {
        const limiter = new ConcurrencyLimiter(1);
        const order: string[] = [];

        const task1 = limiter.run(async () => {
            order.push('task1-start');
            await delay(20);
            order.push('task1-end');
            return 1;
        });

        const task2 = limiter.run(async () => {
            order.push('task2-start');
            await delay(10);
            order.push('task2-end');
            return 2;
        });

        await Promise.all([task1, task2]);

        // Task2 should start after task1 completes
        expect(order).toEqual([
            'task1-start',
            'task1-end',
            'task2-start',
            'task2-end'
        ]);
    });

    describe('Cancellation', () => {
        it('CancellationError has correct name and message', () => {
            const error = new CancellationError();
            expect(error.name).toBe('CancellationError');
            expect(error.message).toBe('Operation cancelled');

            const customError = new CancellationError('Custom message');
            expect(customError.message).toBe('Custom message');
        });

        it('run() throws CancellationError when cancelled before acquiring slot', async () => {
            const limiter = new ConcurrencyLimiter(5);
            const isCancelled = () => true;

            await expect(
                limiter.run(async () => 42, isCancelled)
            ).rejects.toBeInstanceOf(CancellationError);
        });

        it('run() throws CancellationError when cancelled after acquiring slot but before execution', async () => {
            const limiter = new ConcurrencyLimiter(1);
            let cancelled = false;
            const isCancelled = () => cancelled;

            // Start a long-running task to occupy the slot
            const blockingTask = limiter.run(async () => {
                await delay(50);
                cancelled = true; // Cancel while second task is waiting
                return 'blocking';
            });

            // This task will wait for slot, then get cancelled when it acquires
            const cancelledTask = limiter.run(async () => {
                return 'should not execute';
            }, isCancelled);

            const blockingResult = await blockingTask;
            expect(blockingResult).toBe('blocking');

            await expect(cancelledTask).rejects.toBeInstanceOf(CancellationError);
        });

        it('all() stops processing new tasks when cancelled', async () => {
            const limiter = new ConcurrencyLimiter(1);
            let cancelled = false;
            const isCancelled = () => cancelled;
            const executedTasks: number[] = [];

            const tasks = [
                async () => {
                    executedTasks.push(1);
                    await delay(10);
                    cancelled = true; // Cancel after first task
                    return 1;
                },
                async () => {
                    executedTasks.push(2);
                    return 2;
                },
                async () => {
                    executedTasks.push(3);
                    return 3;
                }
            ];

            await expect(
                limiter.all(tasks, isCancelled)
            ).rejects.toBeInstanceOf(CancellationError);

            // Only the first task should have executed
            expect(executedTasks).toEqual([1]);
        });

        it('all() with higher concurrency stops pending tasks when cancelled', async () => {
            const limiter = new ConcurrencyLimiter(2);
            let cancelled = false;
            const isCancelled = () => cancelled;
            const executedTasks: number[] = [];

            const tasks = [
                async () => {
                    executedTasks.push(1);
                    await delay(50);
                    return 1;
                },
                async () => {
                    executedTasks.push(2);
                    await delay(10);
                    cancelled = true; // Cancel early
                    return 2;
                },
                async () => {
                    executedTasks.push(3);
                    return 3;
                },
                async () => {
                    executedTasks.push(4);
                    return 4;
                },
                async () => {
                    executedTasks.push(5);
                    return 5;
                }
            ];

            await expect(
                limiter.all(tasks, isCancelled)
            ).rejects.toBeInstanceOf(CancellationError);

            // First two tasks start immediately (concurrency 2)
            // After task 2 completes and sets cancelled, remaining tasks should not execute
            expect(executedTasks).toContain(1);
            expect(executedTasks).toContain(2);
            // At least some later tasks should not have executed
            expect(
                !executedTasks.includes(3) || !executedTasks.includes(4) || !executedTasks.includes(5)
            ).toBe(true);
        });

        it('allSettled() handles cancellation gracefully', async () => {
            const limiter = new ConcurrencyLimiter(1);
            let cancelled = false;
            const isCancelled = () => cancelled;

            const tasks = [
                async () => {
                    await delay(10);
                    cancelled = true;
                    return 1;
                },
                async () => 2,
                async () => 3
            ];

            const results = await limiter.allSettled(tasks, isCancelled);

            // First task should succeed
            expect(results[0].status).toBe('fulfilled');
            expect((results[0] as PromiseFulfilledResult<number>).value).toBe(1);

            // Remaining tasks should be rejected with CancellationError
            expect(results[1].status).toBe('rejected');
            expect((results[1] as PromiseRejectedResult).reason).toBeInstanceOf(CancellationError);
            expect(results[2].status).toBe('rejected');
            expect((results[2] as PromiseRejectedResult).reason).toBeInstanceOf(CancellationError);
        });

        it('cancellation releases slot properly', async () => {
            const limiter = new ConcurrencyLimiter(1);

            // First, try a cancelled task
            try {
                await limiter.run(async () => 42, () => true);
            } catch {
                // Expected cancellation
            }

            // Slot should be available for next task
            const result = await limiter.run(async () => 'success');
            expect(result).toBe('success');
        });
    });
});

// Helper function
function delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}
