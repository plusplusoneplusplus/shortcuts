/**
 * Tests for ConcurrencyLimiter
 *
 * Cross-platform compatible (Linux/Mac/Windows).
 */

import * as assert from 'assert';
import { ConcurrencyLimiter, CancellationError } from '../../../shortcuts/map-reduce/concurrency-limiter';

suite('ConcurrencyLimiter', () => {
    test('constructor throws for invalid maxConcurrency', () => {
        assert.throws(() => new ConcurrencyLimiter(0), /maxConcurrency must be at least 1/);
        assert.throws(() => new ConcurrencyLimiter(-1), /maxConcurrency must be at least 1/);
    });

    test('constructor accepts valid maxConcurrency', () => {
        const limiter = new ConcurrencyLimiter(1);
        assert.strictEqual(limiter.limit, 1);

        const limiter5 = new ConcurrencyLimiter(5);
        assert.strictEqual(limiter5.limit, 5);
    });

    test('default maxConcurrency is 5', () => {
        const limiter = new ConcurrencyLimiter();
        assert.strictEqual(limiter.limit, 5);
    });

    test('runningCount and queuedCount are initially 0', () => {
        const limiter = new ConcurrencyLimiter(3);
        assert.strictEqual(limiter.runningCount, 0);
        assert.strictEqual(limiter.queuedCount, 0);
    });

    test('run() executes function and returns result', async () => {
        const limiter = new ConcurrencyLimiter(5);
        const result = await limiter.run(async () => 42);
        assert.strictEqual(result, 42);
    });

    test('run() handles async functions correctly', async () => {
        const limiter = new ConcurrencyLimiter(5);
        const result = await limiter.run(async () => {
            await delay(10);
            return 'async result';
        });
        assert.strictEqual(result, 'async result');
    });

    test('run() propagates errors', async () => {
        const limiter = new ConcurrencyLimiter(5);
        await assert.rejects(
            async () => limiter.run(async () => { throw new Error('test error'); }),
            /test error/
        );
    });

    test('all() executes all tasks and returns results in order', async () => {
        const limiter = new ConcurrencyLimiter(5);
        const tasks = [
            async () => 1,
            async () => 2,
            async () => 3
        ];

        const results = await limiter.all(tasks);
        assert.deepStrictEqual(results, [1, 2, 3]);
    });

    test('all() respects concurrency limit', async () => {
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

        assert.ok(maxConcurrent <= 2, `Max concurrent was ${maxConcurrent}, expected <= 2`);
    });

    test('allSettled() returns settled results for all tasks', async () => {
        const limiter = new ConcurrencyLimiter(5);
        const tasks = [
            async () => 1,
            async () => { throw new Error('fail'); },
            async () => 3
        ];

        const results = await limiter.allSettled(tasks);

        assert.strictEqual(results.length, 3);
        assert.strictEqual(results[0].status, 'fulfilled');
        assert.strictEqual((results[0] as PromiseFulfilledResult<number>).value, 1);
        assert.strictEqual(results[1].status, 'rejected');
        assert.strictEqual(results[2].status, 'fulfilled');
        assert.strictEqual((results[2] as PromiseFulfilledResult<number>).value, 3);
    });

    test('concurrent execution with limit 1 runs sequentially', async () => {
        const limiter = new ConcurrencyLimiter(1);
        const order: number[] = [];

        const createTask = (id: number) => async () => {
            order.push(id);
            await delay(5);
            return id;
        };

        await limiter.all([createTask(1), createTask(2), createTask(3)]);

        // With limit 1, tasks should complete in order
        assert.deepStrictEqual(order, [1, 2, 3]);
    });

    test('handles high concurrency scenarios', async () => {
        const limiter = new ConcurrencyLimiter(10);
        const taskCount = 50;
        const tasks = Array.from({ length: taskCount }, (_, i) => async () => {
            await delay(Math.random() * 10);
            return i;
        });

        const results = await limiter.all(tasks);
        assert.strictEqual(results.length, taskCount);
        // Results should be in original order despite async execution
        for (let i = 0; i < taskCount; i++) {
            assert.strictEqual(results[i], i);
        }
    });

    test('slot is released even if task throws', async () => {
        const limiter = new ConcurrencyLimiter(1);

        // First task throws
        try {
            await limiter.run(async () => { throw new Error('fail'); });
        } catch {
            // Expected
        }

        // Second task should still run
        const result = await limiter.run(async () => 'success');
        assert.strictEqual(result, 'success');
    });

    test('queued tasks execute when slots become available', async () => {
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
        assert.deepStrictEqual(order, [
            'task1-start',
            'task1-end',
            'task2-start',
            'task2-end'
        ]);
    });

    suite('Cancellation', () => {
        test('CancellationError has correct name and message', () => {
            const error = new CancellationError();
            assert.strictEqual(error.name, 'CancellationError');
            assert.strictEqual(error.message, 'Operation cancelled');

            const customError = new CancellationError('Custom message');
            assert.strictEqual(customError.message, 'Custom message');
        });

        test('run() throws CancellationError when cancelled before acquiring slot', async () => {
            const limiter = new ConcurrencyLimiter(5);
            const isCancelled = () => true;

            await assert.rejects(
                async () => limiter.run(async () => 42, isCancelled),
                (err: Error) => err instanceof CancellationError
            );
        });

        test('run() throws CancellationError when cancelled after acquiring slot but before execution', async () => {
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
            assert.strictEqual(blockingResult, 'blocking');

            await assert.rejects(
                cancelledTask,
                (err: Error) => err instanceof CancellationError
            );
        });

        test('all() stops processing new tasks when cancelled', async () => {
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

            await assert.rejects(
                async () => limiter.all(tasks, isCancelled),
                (err: Error) => err instanceof CancellationError
            );

            // Only the first task should have executed
            assert.deepStrictEqual(executedTasks, [1]);
        });

        test('all() with higher concurrency stops pending tasks when cancelled', async () => {
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

            await assert.rejects(
                async () => limiter.all(tasks, isCancelled),
                (err: Error) => err instanceof CancellationError
            );

            // First two tasks start immediately (concurrency 2)
            // After task 2 completes and sets cancelled, remaining tasks should not execute
            assert.ok(executedTasks.includes(1), 'Task 1 should have started');
            assert.ok(executedTasks.includes(2), 'Task 2 should have started');
            // Tasks 3, 4, 5 should not have executed
            assert.ok(!executedTasks.includes(3) || !executedTasks.includes(4) || !executedTasks.includes(5),
                'At least some later tasks should not have executed');
        });

        test('allSettled() handles cancellation gracefully', async () => {
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
            assert.strictEqual(results[0].status, 'fulfilled');
            assert.strictEqual((results[0] as PromiseFulfilledResult<number>).value, 1);

            // Remaining tasks should be rejected with CancellationError
            assert.strictEqual(results[1].status, 'rejected');
            assert.ok((results[1] as PromiseRejectedResult).reason instanceof CancellationError);
            assert.strictEqual(results[2].status, 'rejected');
            assert.ok((results[2] as PromiseRejectedResult).reason instanceof CancellationError);
        });

        test('cancellation releases slot properly', async () => {
            const limiter = new ConcurrencyLimiter(1);

            // First, try a cancelled task
            try {
                await limiter.run(async () => 42, () => true);
            } catch {
                // Expected cancellation
            }

            // Slot should be available for next task
            const result = await limiter.run(async () => 'success');
            assert.strictEqual(result, 'success');
        });
    });
});

// Helper function
function delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}
