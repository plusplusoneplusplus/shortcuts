/**
 * Tests for withTimeoutDoubling — the timeout-with-doubled-retry variant.
 */
import { describe, it, expect, vi } from 'vitest';
import { withTimeoutDoubling, TimeoutError, isTimeoutError } from '../../src/runtime/timeout';

describe('withTimeoutDoubling', () => {
    it('returns the result when fn succeeds within timeout', async () => {
        const result = await withTimeoutDoubling(() => Promise.resolve(42), { timeoutMs: 1000 });
        expect(result).toBe(42);
    });

    it('runs fn without timeout when timeoutMs is undefined', async () => {
        const result = await withTimeoutDoubling(() => Promise.resolve('ok'), {});
        expect(result).toBe('ok');
    });

    it('runs fn without timeout when timeoutMs is 0', async () => {
        const result = await withTimeoutDoubling(() => Promise.resolve('ok'), { timeoutMs: 0 });
        expect(result).toBe('ok');
    });

    it('runs fn without timeout when timeoutMs is negative', async () => {
        const result = await withTimeoutDoubling(() => Promise.resolve('ok'), { timeoutMs: -1 });
        expect(result).toBe('ok');
    });

    it('retries with doubled timeout on first timeout then succeeds', async () => {
        let callCount = 0;
        const fn = vi.fn(async () => {
            callCount++;
            if (callCount === 1) {
                // Simulate a slow operation that exceeds 50ms but fits in 100ms
                await new Promise(resolve => setTimeout(resolve, 80));
            }
            return 'done';
        });

        // First call with 50ms timeout should time out, retry with 100ms should succeed
        const result = await withTimeoutDoubling(fn, { timeoutMs: 50 });
        expect(result).toBe('done');
        expect(fn).toHaveBeenCalledTimes(2);
    });

    it('propagates non-timeout errors immediately without retry', async () => {
        const fn = vi.fn(async () => {
            throw new Error('not a timeout');
        });

        await expect(withTimeoutDoubling(fn, { timeoutMs: 1000 })).rejects.toThrow('not a timeout');
        expect(fn).toHaveBeenCalledTimes(1);
    });

    it('throws TimeoutError when both attempts time out', async () => {
        const fn = vi.fn(async () => {
            await new Promise(resolve => setTimeout(resolve, 500));
            return 'too slow';
        });

        await expect(
            withTimeoutDoubling(fn, { timeoutMs: 30 })
        ).rejects.toSatisfy((err: unknown) => isTimeoutError(err));
        expect(fn).toHaveBeenCalledTimes(2);
    });

    it('passes operationName to the TimeoutError', async () => {
        const fn = async () => {
            await new Promise(resolve => setTimeout(resolve, 500));
            return 'slow';
        };

        try {
            await withTimeoutDoubling(fn, { timeoutMs: 30, operationName: 'TestOp' });
            expect.fail('should have thrown');
        } catch (error) {
            expect(error).toBeInstanceOf(TimeoutError);
            expect((error as TimeoutError).message).toContain('TestOp');
        }
    });
});
