/**
 * Tests for ConcurrencyLimiter
 *
 * Cross-platform compatible (Linux/Mac/Windows).
 */

import * as assert from 'assert';
import { ConcurrencyLimiter } from '../../../shortcuts/map-reduce/concurrency-limiter';

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
});

// Helper function
function delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}
