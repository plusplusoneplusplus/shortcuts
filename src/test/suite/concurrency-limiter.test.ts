/**
 * Tests for ConcurrencyLimiter
 *
 * Tests the concurrency limiting functionality for parallel execution
 * of async tasks in the code review system.
 */

import * as assert from 'assert';
import { ConcurrencyLimiter, DEFAULT_MAX_CONCURRENCY } from '../../shortcuts/code-review/concurrency-limiter';

suite('ConcurrencyLimiter', () => {
    suite('Constructor', () => {
        test('creates with default concurrency', () => {
            const limiter = new ConcurrencyLimiter();
            assert.strictEqual(limiter.limit, DEFAULT_MAX_CONCURRENCY);
        });

        test('creates with custom concurrency', () => {
            const limiter = new ConcurrencyLimiter(10);
            assert.strictEqual(limiter.limit, 10);
        });

        test('throws for concurrency less than 1', () => {
            assert.throws(() => new ConcurrencyLimiter(0), /maxConcurrency must be at least 1/);
            assert.throws(() => new ConcurrencyLimiter(-1), /maxConcurrency must be at least 1/);
        });

        test('allows concurrency of 1', () => {
            const limiter = new ConcurrencyLimiter(1);
            assert.strictEqual(limiter.limit, 1);
        });
    });

    suite('run()', () => {
        test('executes a single task', async () => {
            const limiter = new ConcurrencyLimiter(5);
            const result = await limiter.run(async () => 'hello');
            assert.strictEqual(result, 'hello');
        });

        test('returns the correct value from async function', async () => {
            const limiter = new ConcurrencyLimiter(5);
            const result = await limiter.run(async () => {
                await delay(10);
                return 42;
            });
            assert.strictEqual(result, 42);
        });

        test('propagates errors from task', async () => {
            const limiter = new ConcurrencyLimiter(5);
            await assert.rejects(
                limiter.run(async () => {
                    throw new Error('Task failed');
                }),
                /Task failed/
            );
        });

        test('tracks running count correctly', async () => {
            const limiter = new ConcurrencyLimiter(5);
            assert.strictEqual(limiter.runningCount, 0);

            const promise = limiter.run(async () => {
                await delay(50);
                return 'done';
            });

            // Give it a moment to start
            await delay(10);
            assert.strictEqual(limiter.runningCount, 1);

            await promise;
            assert.strictEqual(limiter.runningCount, 0);
        });
    });

    suite('Concurrency Limiting', () => {
        test('respects max concurrency limit', async () => {
            const limiter = new ConcurrencyLimiter(2);
            let maxConcurrent = 0;
            let current = 0;

            const tasks = Array.from({ length: 5 }, (_, i) => async () => {
                current++;
                maxConcurrent = Math.max(maxConcurrent, current);
                await delay(30);
                current--;
                return i;
            });

            await limiter.all(tasks);

            assert.strictEqual(maxConcurrent, 2, 'Should never exceed max concurrency of 2');
        });

        test('queues tasks when limit is reached', async () => {
            const limiter = new ConcurrencyLimiter(2);
            const order: number[] = [];

            const tasks = Array.from({ length: 4 }, (_, i) => async () => {
                order.push(i);
                await delay(i === 0 || i === 1 ? 50 : 10);
                return i;
            });

            await limiter.all(tasks);

            // First two start immediately (0, 1)
            // Then 2 and 3 wait and start as slots free up
            assert.strictEqual(order[0], 0);
            assert.strictEqual(order[1], 1);
        });

        test('processes all tasks eventually', async () => {
            const limiter = new ConcurrencyLimiter(2);
            const completed: number[] = [];

            const tasks = Array.from({ length: 10 }, (_, i) => async () => {
                await delay(Math.random() * 20);
                completed.push(i);
                return i;
            });

            await limiter.all(tasks);

            assert.strictEqual(completed.length, 10, 'All tasks should complete');
            // Verify all indices are present
            const sorted = [...completed].sort((a, b) => a - b);
            assert.deepStrictEqual(sorted, [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
        });

        test('with concurrency of 1, executes sequentially', async () => {
            const limiter = new ConcurrencyLimiter(1);
            const order: string[] = [];

            const tasks = [
                async () => { order.push('start-0'); await delay(10); order.push('end-0'); return 0; },
                async () => { order.push('start-1'); await delay(10); order.push('end-1'); return 1; },
                async () => { order.push('start-2'); await delay(10); order.push('end-2'); return 2; },
            ];

            await limiter.all(tasks);

            // With concurrency 1, each task must complete before the next starts
            assert.deepStrictEqual(order, [
                'start-0', 'end-0',
                'start-1', 'end-1',
                'start-2', 'end-2'
            ]);
        });
    });

    suite('all()', () => {
        test('returns results in order', async () => {
            const limiter = new ConcurrencyLimiter(2);
            const tasks = [
                async () => { await delay(30); return 'a'; },
                async () => { await delay(10); return 'b'; },
                async () => { await delay(20); return 'c'; },
            ];

            const results = await limiter.all(tasks);

            // Results should be in input order, not completion order
            assert.deepStrictEqual(results, ['a', 'b', 'c']);
        });

        test('handles empty task array', async () => {
            const limiter = new ConcurrencyLimiter(5);
            const results = await limiter.all([]);
            assert.deepStrictEqual(results, []);
        });

        test('handles single task', async () => {
            const limiter = new ConcurrencyLimiter(5);
            const results = await limiter.all([async () => 'only']);
            assert.deepStrictEqual(results, ['only']);
        });

        test('propagates first error (rejects all)', async () => {
            const limiter = new ConcurrencyLimiter(2);
            const tasks = [
                async () => { await delay(10); return 'ok'; },
                async () => { throw new Error('Failed!'); },
                async () => { await delay(10); return 'ok2'; },
            ];

            await assert.rejects(
                limiter.all(tasks),
                /Failed!/
            );
        });
    });

    suite('allSettled()', () => {
        test('returns all results including failures', async () => {
            const limiter = new ConcurrencyLimiter(2);
            const tasks = [
                async () => 'success1',
                async () => { throw new Error('Failed!'); },
                async () => 'success2',
            ];

            const results = await limiter.allSettled(tasks);

            assert.strictEqual(results.length, 3);
            assert.strictEqual(results[0].status, 'fulfilled');
            assert.strictEqual((results[0] as PromiseFulfilledResult<string>).value, 'success1');
            assert.strictEqual(results[1].status, 'rejected');
            assert.strictEqual((results[1] as PromiseRejectedResult).reason.message, 'Failed!');
            assert.strictEqual(results[2].status, 'fulfilled');
            assert.strictEqual((results[2] as PromiseFulfilledResult<string>).value, 'success2');
        });

        test('handles all failures gracefully', async () => {
            const limiter = new ConcurrencyLimiter(2);
            const tasks = [
                async () => { throw new Error('Error 1'); },
                async () => { throw new Error('Error 2'); },
            ];

            const results = await limiter.allSettled(tasks);

            assert.strictEqual(results.length, 2);
            assert.strictEqual(results[0].status, 'rejected');
            assert.strictEqual(results[1].status, 'rejected');
        });

        test('handles empty array', async () => {
            const limiter = new ConcurrencyLimiter(5);
            const results = await limiter.allSettled([]);
            assert.deepStrictEqual(results, []);
        });

        test('maintains order with mixed results', async () => {
            const limiter = new ConcurrencyLimiter(3);
            const tasks = [
                async () => { await delay(30); return 1; },
                async () => { await delay(10); throw new Error('2 failed'); },
                async () => { await delay(20); return 3; },
                async () => { await delay(5); return 4; },
            ];

            const results = await limiter.allSettled(tasks);

            assert.strictEqual(results.length, 4);
            assert.strictEqual((results[0] as PromiseFulfilledResult<number>).value, 1);
            assert.strictEqual(results[1].status, 'rejected');
            assert.strictEqual((results[2] as PromiseFulfilledResult<number>).value, 3);
            assert.strictEqual((results[3] as PromiseFulfilledResult<number>).value, 4);
        });
    });

    suite('Queue Management', () => {
        test('tracks queued count correctly', async () => {
            const limiter = new ConcurrencyLimiter(1);

            const task1 = limiter.run(async () => {
                await delay(50);
                return 1;
            });

            // Give first task time to start
            await delay(10);

            const task2Promise = limiter.run(async () => 2);
            const task3Promise = limiter.run(async () => 3);

            // First task is running, 2 should be queued
            assert.strictEqual(limiter.runningCount, 1);
            assert.strictEqual(limiter.queuedCount, 2);

            await Promise.all([task1, task2Promise, task3Promise]);

            assert.strictEqual(limiter.runningCount, 0);
            assert.strictEqual(limiter.queuedCount, 0);
        });

        test('releases slot even when task throws', async () => {
            const limiter = new ConcurrencyLimiter(2);

            try {
                await limiter.run(async () => {
                    throw new Error('Intentional');
                });
            } catch {
                // Expected
            }

            // Slot should be released
            assert.strictEqual(limiter.runningCount, 0);
        });
    });

    suite('Performance', () => {
        test('parallel execution is faster than sequential', async () => {
            const limiter = new ConcurrencyLimiter(5);
            const taskDuration = 100;  // Increased for more reliable timing in CI
            const taskCount = 5;

            const tasks = Array.from({ length: taskCount }, () => async () => {
                await delay(taskDuration);
                return true;
            });

            const start = Date.now();
            await limiter.all(tasks);
            const elapsed = Date.now() - start;

            // With 5 concurrent and 5 tasks of 100ms each:
            // - Sequential would take 500ms
            // - Parallel should take ~100ms + overhead
            // Allow very generous margin for CI environments (up to 350ms / 70% of sequential)
            const sequentialTime = taskDuration * taskCount;
            const maxAllowedTime = sequentialTime * 0.7; // Allow up to 70% of sequential time
            assert.ok(elapsed < maxAllowedTime,
                `Expected parallel execution (${elapsed}ms) to be faster than 70% of sequential time (${maxAllowedTime}ms)`);
        });
    });

    suite('Edge Cases', () => {
        test('handles tasks that complete synchronously', async () => {
            const limiter = new ConcurrencyLimiter(2);
            const tasks = [
                async () => 1,
                async () => 2,
                async () => 3,
            ];

            const results = await limiter.all(tasks);
            assert.deepStrictEqual(results, [1, 2, 3]);
        });

        test('handles mixed sync and async tasks', async () => {
            const limiter = new ConcurrencyLimiter(2);
            const tasks = [
                async () => 1,
                async () => { await delay(10); return 2; },
                async () => 3,
            ];

            const results = await limiter.all(tasks);
            assert.deepStrictEqual(results, [1, 2, 3]);
        });

        test('handles large number of tasks', async () => {
            const limiter = new ConcurrencyLimiter(5);
            const taskCount = 100;
            const tasks = Array.from({ length: taskCount }, (_, i) => async () => i);

            const results = await limiter.all(tasks);

            assert.strictEqual(results.length, taskCount);
            assert.deepStrictEqual(results, Array.from({ length: taskCount }, (_, i) => i));
        });
    });
});

/**
 * Helper function to create a delay
 */
function delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}
