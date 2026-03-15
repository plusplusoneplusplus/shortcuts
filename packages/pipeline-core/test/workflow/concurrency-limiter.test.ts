import { describe, it, expect } from 'vitest';
import { ConcurrencyLimiter } from '../../src/workflow/concurrency-limiter';

describe('ConcurrencyLimiter', () => {
    it('throws when maxConcurrency is 0', () => {
        expect(() => new ConcurrencyLimiter(0)).toThrow('maxConcurrency must be at least 1');
    });

    it('throws when maxConcurrency is negative', () => {
        expect(() => new ConcurrencyLimiter(-1)).toThrow('maxConcurrency must be at least 1');
    });

    it('run() resolves with the task return value', async () => {
        const limiter = new ConcurrencyLimiter(2);
        const result = await limiter.run(() => Promise.resolve(42));
        expect(result).toBe(42);
    });

    it('run() rejects when the task rejects', async () => {
        const limiter = new ConcurrencyLimiter(2);
        await expect(limiter.run(() => Promise.reject(new Error('fail')))).rejects.toThrow('fail');
    });

    it('exposes limit, runningCount, and queuedCount', async () => {
        const limiter = new ConcurrencyLimiter(3);
        expect(limiter.limit).toBe(3);
        expect(limiter.runningCount).toBe(0);
        expect(limiter.queuedCount).toBe(0);
    });

    it('runs tasks up to the concurrency limit in parallel', async () => {
        const limiter = new ConcurrencyLimiter(2);
        let maxConcurrent = 0;
        let current = 0;

        const track = async () => {
            current++;
            maxConcurrent = Math.max(maxConcurrent, current);
            await new Promise<void>(resolve => setImmediate(resolve));
            current--;
        };

        await limiter.all([track, track, track, track, track]);
        expect(maxConcurrent).toBeLessThanOrEqual(2);
    });

    it('processes all items even with low concurrency (limit=1)', async () => {
        const limiter = new ConcurrencyLimiter(1);
        const order: number[] = [];
        const tasks = [1, 2, 3, 4, 5].map(n => () => {
            order.push(n);
            return Promise.resolve(n);
        });
        const results = await limiter.all(tasks);
        expect(results).toEqual([1, 2, 3, 4, 5]);
        expect(order).toEqual([1, 2, 3, 4, 5]);
    });

    it('queues tasks beyond limit and processes them when a slot frees', async () => {
        const limiter = new ConcurrencyLimiter(2);
        const started: number[] = [];
        let resolveFirst!: () => void;
        let resolveSecond!: () => void;

        const t1 = () => {
            started.push(1);
            return new Promise<void>(resolve => { resolveFirst = resolve; });
        };
        const t2 = () => {
            started.push(2);
            return new Promise<void>(resolve => { resolveSecond = resolve; });
        };
        const t3 = () => { started.push(3); return Promise.resolve(); };

        const allPromise = limiter.all([t1, t2, t3]);
        // Yield to allow event loop to start tasks up to the limit
        await new Promise<void>(resolve => setImmediate(resolve));
        await new Promise<void>(resolve => setImmediate(resolve));

        // Tasks 1 and 2 should have started; task 3 should be queued
        expect(started).toContain(1);
        expect(started).toContain(2);
        expect(started).not.toContain(3);

        // Release slot — task 3 should start
        resolveFirst();
        resolveSecond();
        await allPromise;
        expect(started).toContain(3);
    });

    it('all() resolves with results in the same order as input', async () => {
        const limiter = new ConcurrencyLimiter(3);
        const tasks = [3, 1, 2].map(n => () => Promise.resolve(n));
        const results = await limiter.all(tasks);
        expect(results).toEqual([3, 1, 2]);
    });

    it('allSettled() returns fulfilled results for all successful tasks', async () => {
        const limiter = new ConcurrencyLimiter(2);
        const tasks = [() => Promise.resolve(1), () => Promise.resolve(2)];
        const results = await limiter.allSettled(tasks);
        expect(results).toEqual([
            { status: 'fulfilled', value: 1 },
            { status: 'fulfilled', value: 2 },
        ]);
    });

    it('allSettled() captures rejections without throwing', async () => {
        const limiter = new ConcurrencyLimiter(2);
        const err = new Error('boom');
        const tasks = [
            () => Promise.resolve(1),
            () => Promise.reject(err),
            () => Promise.resolve(3),
        ];
        const results = await limiter.allSettled(tasks);
        expect(results[0]).toEqual({ status: 'fulfilled', value: 1 });
        expect(results[1]).toMatchObject({ status: 'rejected', reason: err });
        expect(results[2]).toEqual({ status: 'fulfilled', value: 3 });
    });

    it('run() throws CancellationError when isCancelled is true before execution', async () => {
        const limiter = new ConcurrencyLimiter(2);
        const { CancellationError } = await import('../../src/workflow/concurrency-limiter');
        await expect(
            limiter.run(() => Promise.resolve(42), () => true),
        ).rejects.toBeInstanceOf(CancellationError);
    });
});
