/**
 * Isolated tests for packages/forge/src/runtime/retry.ts
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
    calculateDelay,
    withRetry,
    RetryExhaustedError,
    isRetryExhaustedError,
    defaultRetryOn,
    retryOnTimeout,
} from '../../src/runtime/retry';
import { CancellationError } from '../../src/runtime/cancellation';
import { TimeoutError } from '../../src/runtime/timeout';
import { PipelineCoreError, ErrorCode } from '../../src/errors';

describe('calculateDelay', () => {
    it('fixed: returns baseDelayMs regardless of attempt', () => {
        expect(calculateDelay(1, 500, 'fixed', 10_000)).toBe(500);
        expect(calculateDelay(5, 500, 'fixed', 10_000)).toBe(500);
    });

    it('linear: returns baseDelayMs * attempt', () => {
        expect(calculateDelay(1, 100, 'linear', 10_000)).toBe(100);
        expect(calculateDelay(3, 100, 'linear', 10_000)).toBe(300);
        expect(calculateDelay(5, 100, 'linear', 10_000)).toBe(500);
    });

    it('exponential: doubles each attempt', () => {
        expect(calculateDelay(1, 100, 'exponential', 10_000)).toBe(100);
        expect(calculateDelay(2, 100, 'exponential', 10_000)).toBe(200);
        expect(calculateDelay(3, 100, 'exponential', 10_000)).toBe(400);
        expect(calculateDelay(4, 100, 'exponential', 10_000)).toBe(800);
    });

    it('never exceeds maxDelayMs', () => {
        expect(calculateDelay(10, 1000, 'exponential', 5_000)).toBe(5_000);
        expect(calculateDelay(20, 100, 'linear', 500)).toBe(500);
    });
});

describe('withRetry', () => {
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => vi.useRealTimers());

    it('resolves immediately on first success', async () => {
        const fn = vi.fn().mockResolvedValue('ok');
        const result = await withRetry(fn, { attempts: 3 });
        expect(result).toBe('ok');
        expect(fn).toHaveBeenCalledTimes(1);
    });

    it('retries and returns on eventual success', async () => {
        const fn = vi.fn()
            .mockRejectedValueOnce(new Error('fail 1'))
            .mockRejectedValueOnce(new Error('fail 2'))
            .mockResolvedValue('ok');

        const promise = withRetry(fn, { attempts: 3, delayMs: 100, backoff: 'fixed' });

        await vi.advanceTimersByTimeAsync(0);    // first attempt fails
        await vi.advanceTimersByTimeAsync(100);  // delay
        await vi.advanceTimersByTimeAsync(0);    // second attempt fails
        await vi.advanceTimersByTimeAsync(100);  // delay
        await vi.advanceTimersByTimeAsync(0);    // third attempt succeeds

        await expect(promise).resolves.toBe('ok');
        expect(fn).toHaveBeenCalledTimes(3);
    });

    it('throws RetryExhaustedError after all attempts fail', async () => {
        vi.useRealTimers();
        const fn = vi.fn().mockRejectedValue(new Error('always fails'));

        await expect(
            withRetry(fn, { attempts: 3, delayMs: 1, backoff: 'fixed' })
        ).rejects.toThrow(RetryExhaustedError);
        expect(fn).toHaveBeenCalledTimes(3);
    });

    it('does not retry when retryOn returns false — rethrows original error', async () => {
        const original = new Error('do-not-retry');
        const fn = vi.fn().mockRejectedValue(original);

        await expect(
            withRetry(fn, { attempts: 3, retryOn: () => false })
        ).rejects.toThrow(original);
        expect(fn).toHaveBeenCalledTimes(1);
    });

    it('stops immediately when isCancelled is true before an attempt', async () => {
        vi.useRealTimers();
        let cancelled = false;
        const fn = vi.fn().mockImplementation(() => {
            cancelled = true; // cancel after first attempt executes
            return Promise.reject(new Error('fail'));
        });

        await expect(
            withRetry(fn, {
                attempts: 3,
                delayMs: 1,
                isCancelled: () => cancelled,
            })
        ).rejects.toThrow(CancellationError);

        // fn was called once; cancellation check fires before second attempt
        expect(fn).toHaveBeenCalledTimes(1);
    });

    it('calls onAttempt for each attempt with correct arguments', async () => {
        const onAttempt = vi.fn();
        const err = new Error('fail');
        const fn = vi.fn()
            .mockRejectedValueOnce(err)
            .mockResolvedValue('ok');

        const promise = withRetry(fn, {
            attempts: 3,
            delayMs: 50,
            backoff: 'fixed',
            onAttempt,
        });

        await vi.advanceTimersByTimeAsync(100);
        await promise;

        expect(onAttempt).toHaveBeenCalledTimes(2);
        expect(onAttempt).toHaveBeenNthCalledWith(1, 1, 3, undefined);
        expect(onAttempt).toHaveBeenNthCalledWith(2, 2, 3, err);
    });
});

describe('isRetryExhaustedError', () => {
    it('returns true for RetryExhaustedError instances', () => {
        expect(isRetryExhaustedError(new RetryExhaustedError('test'))).toBe(true);
    });

    it('returns true for a PipelineCoreError with ErrorCode.RETRY_EXHAUSTED', () => {
        const error = new PipelineCoreError('exhausted', { code: ErrorCode.RETRY_EXHAUSTED });
        expect(isRetryExhaustedError(error)).toBe(true);
    });

    it('returns false for other errors', () => {
        expect(isRetryExhaustedError(new Error('plain'))).toBe(false);
        expect(isRetryExhaustedError(new CancellationError())).toBe(false);
    });
});

describe('defaultRetryOn', () => {
    it('returns false for cancellation errors', () => {
        expect(defaultRetryOn(new CancellationError(), 1)).toBe(false);
    });

    it('returns true for non-cancellation errors', () => {
        expect(defaultRetryOn(new Error('generic'), 1)).toBe(true);
        expect(defaultRetryOn(new TimeoutError('slow'), 1)).toBe(true);
    });
});

describe('retryOnTimeout', () => {
    it('returns true for TimeoutError', () => {
        expect(retryOnTimeout(new TimeoutError('t'), 1)).toBe(true);
    });

    it('returns false for CancellationError', () => {
        expect(retryOnTimeout(new CancellationError(), 1)).toBe(false);
    });

    it('returns false for plain Error (not a timeout)', () => {
        expect(retryOnTimeout(new Error('other'), 1)).toBe(false);
    });
});
