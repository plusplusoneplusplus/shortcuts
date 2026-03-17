/**
 * Tests for runtime async policy utilities
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
    // Cancellation
    CancellationError,
    isCancellationError,
    throwIfCancelled,
    createCancellationToken,
    // Timeout
    TimeoutError,
    withTimeout,
    isTimeoutError,
    createTimeoutPromise,
    // Retry
    RetryExhaustedError,
    withRetry,
    isRetryExhaustedError,
    calculateDelay,
    defaultRetryOn,
    // Policy
    runWithPolicy,
    createPolicyRunner,
} from '../../src/runtime';
import { ErrorCode } from '../../src/errors';

describe('Cancellation', () => {
    describe('CancellationError', () => {
        it('should create error with default message', () => {
            const error = new CancellationError();
            expect(error.message).toBe('Operation cancelled');
            expect(error.code).toBe(ErrorCode.CANCELLED);
            expect(error.name).toBe('CancellationError');
        });

        it('should create error with custom message', () => {
            const error = new CancellationError('User cancelled');
            expect(error.message).toBe('User cancelled');
        });

        it('should be instanceof PipelineCoreError', () => {
            const error = new CancellationError();
            expect(isCancellationError(error)).toBe(true);
        });
    });

    describe('throwIfCancelled', () => {
        it('should not throw when isCancelled is undefined', () => {
            expect(() => throwIfCancelled()).not.toThrow();
        });

        it('should not throw when isCancelled returns false', () => {
            expect(() => throwIfCancelled(() => false)).not.toThrow();
        });

        it('should throw CancellationError when isCancelled returns true', () => {
            expect(() => throwIfCancelled(() => true)).toThrow(CancellationError);
        });

        it('should include metadata in thrown error', () => {
            try {
                throwIfCancelled(() => true, { taskId: 'task-1' });
                expect.fail('Should have thrown');
            } catch (error) {
                expect(isCancellationError(error)).toBe(true);
                expect((error as CancellationError).meta?.taskId).toBe('task-1');
            }
        });
    });

    describe('createCancellationToken', () => {
        it('should return token with isCancelled function', () => {
            let cancelled = false;
            const token = createCancellationToken(() => cancelled);

            expect(token.isCancelled()).toBe(false);
            cancelled = true;
            expect(token.isCancelled()).toBe(true);
        });

        it('should provide throwIfCancelled helper', () => {
            let cancelled = false;
            const token = createCancellationToken(() => cancelled);

            expect(() => token.throwIfCancelled()).not.toThrow();
            cancelled = true;
            expect(() => token.throwIfCancelled()).toThrow(CancellationError);
        });

        it('should default to never cancelled when no function provided', () => {
            const token = createCancellationToken();
            expect(token.isCancelled()).toBe(false);
        });
    });
});

describe('Timeout', () => {
    beforeEach(() => {
        vi.useFakeTimers();
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    describe('TimeoutError', () => {
        it('should create error with code TIMEOUT', () => {
            const error = new TimeoutError('Operation timed out');
            expect(error.code).toBe(ErrorCode.TIMEOUT);
            expect(error.name).toBe('TimeoutError');
        });

        it('should include metadata', () => {
            const error = new TimeoutError('Timed out', { timeoutMs: 5000 });
            expect(error.meta?.timeoutMs).toBe(5000);
        });
    });

    describe('withTimeout', () => {
        it('should resolve when function completes before timeout', async () => {
            const fn = vi.fn().mockResolvedValue('result');
            const promise = withTimeout(fn, { timeoutMs: 1000 });

            await vi.advanceTimersByTimeAsync(0);
            const result = await promise;

            expect(result).toBe('result');
        });

        it('should reject with TimeoutError when timeout exceeded', async () => {
            const fn = () => new Promise((resolve) => setTimeout(resolve, 2000));
            const promise = withTimeout(fn, { timeoutMs: 1000 });

            vi.advanceTimersByTime(1001);

            await expect(promise).rejects.toThrow(TimeoutError);
        });

        it('should call onTimeout callback when timeout occurs', async () => {
            const onTimeout = vi.fn();
            const fn = () => new Promise((resolve) => setTimeout(resolve, 2000));
            const promise = withTimeout(fn, { timeoutMs: 1000, onTimeout });

            vi.advanceTimersByTime(1001);

            await expect(promise).rejects.toThrow();
            expect(onTimeout).toHaveBeenCalled();
        });

        it('should include operation name in error message', async () => {
            const fn = () => new Promise((resolve) => setTimeout(resolve, 2000));
            const promise = withTimeout(fn, {
                timeoutMs: 1000,
                operationName: 'fetchData',
            });

            vi.advanceTimersByTime(1001);

            try {
                await promise;
                expect.fail('Should have thrown');
            } catch (error) {
                expect((error as TimeoutError).message).toContain('fetchData');
            }
        });

        it('should check cancellation before starting', async () => {
            const fn = vi.fn().mockResolvedValue('result');
            const promise = withTimeout(fn, {
                timeoutMs: 1000,
                isCancelled: () => true,
            });

            await expect(promise).rejects.toThrow(CancellationError);
            expect(fn).not.toHaveBeenCalled();
        });
    });

    describe('isTimeoutError', () => {
        it('should return true for TimeoutError', () => {
            expect(isTimeoutError(new TimeoutError('test'))).toBe(true);
        });

        it('should return false for other errors', () => {
            expect(isTimeoutError(new Error('test'))).toBe(false);
            expect(isTimeoutError(new CancellationError())).toBe(false);
        });
    });

    describe('createTimeoutPromise', () => {
        it('should reject after specified time', async () => {
            const promise = createTimeoutPromise(500, 'test operation');

            vi.advanceTimersByTime(500);

            await expect(promise).rejects.toThrow(TimeoutError);
        });
    });
});

describe('Retry', () => {
    beforeEach(() => {
        vi.useFakeTimers();
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    describe('calculateDelay', () => {
        it('should return fixed delay for fixed strategy', () => {
            expect(calculateDelay(1, 1000, 'fixed', 30000)).toBe(1000);
            expect(calculateDelay(2, 1000, 'fixed', 30000)).toBe(1000);
            expect(calculateDelay(3, 1000, 'fixed', 30000)).toBe(1000);
        });

        it('should return linear delay for linear strategy', () => {
            expect(calculateDelay(1, 1000, 'linear', 30000)).toBe(1000);
            expect(calculateDelay(2, 1000, 'linear', 30000)).toBe(2000);
            expect(calculateDelay(3, 1000, 'linear', 30000)).toBe(3000);
        });

        it('should return exponential delay for exponential strategy', () => {
            expect(calculateDelay(1, 1000, 'exponential', 30000)).toBe(1000);
            expect(calculateDelay(2, 1000, 'exponential', 30000)).toBe(2000);
            expect(calculateDelay(3, 1000, 'exponential', 30000)).toBe(4000);
            expect(calculateDelay(4, 1000, 'exponential', 30000)).toBe(8000);
        });

        it('should cap delay at maxDelayMs', () => {
            expect(calculateDelay(10, 1000, 'exponential', 5000)).toBe(5000);
        });
    });

    describe('defaultRetryOn', () => {
        it('should return false for cancellation errors', () => {
            expect(defaultRetryOn(new CancellationError(), 1)).toBe(false);
        });

        it('should return true for other errors', () => {
            expect(defaultRetryOn(new Error('test'), 1)).toBe(true);
            expect(defaultRetryOn(new TimeoutError('test'), 1)).toBe(true);
        });
    });

    describe('withRetry', () => {
        it('should resolve on first success', async () => {
            const fn = vi.fn().mockResolvedValue('success');

            const result = await withRetry(fn, { attempts: 3 });

            expect(result).toBe('success');
            expect(fn).toHaveBeenCalledTimes(1);
        });

        it('should retry on failure and succeed', async () => {
            const fn = vi.fn()
                .mockRejectedValueOnce(new Error('fail 1'))
                .mockRejectedValueOnce(new Error('fail 2'))
                .mockResolvedValue('success');

            const promise = withRetry(fn, { attempts: 3, delayMs: 100, backoff: 'fixed' });

            // First failure
            await vi.advanceTimersByTimeAsync(0);
            // Wait for delay
            await vi.advanceTimersByTimeAsync(100);
            // Second failure
            await vi.advanceTimersByTimeAsync(0);
            // Wait for delay
            await vi.advanceTimersByTimeAsync(100);
            // Third success
            await vi.advanceTimersByTimeAsync(0);

            const result = await promise;
            expect(result).toBe('success');
            expect(fn).toHaveBeenCalledTimes(3);
        });

        it('should throw RetryExhaustedError when all attempts fail', async () => {
            vi.useRealTimers();
            const fn = vi.fn().mockRejectedValue(new Error('always fails'));

            await expect(
                withRetry(fn, { attempts: 3, delayMs: 10, backoff: 'fixed' })
            ).rejects.toThrow(RetryExhaustedError);
            expect(fn).toHaveBeenCalledTimes(3);
        });

        it('should call onAttempt callback', async () => {
            const onAttempt = vi.fn();
            const fn = vi.fn()
                .mockRejectedValueOnce(new Error('fail'))
                .mockResolvedValue('success');

            const promise = withRetry(fn, {
                attempts: 3,
                delayMs: 100,
                backoff: 'fixed',
                onAttempt,
            });

            await vi.advanceTimersByTimeAsync(200);
            await promise;

            expect(onAttempt).toHaveBeenCalledTimes(2);
            expect(onAttempt).toHaveBeenCalledWith(1, 3, undefined);
            expect(onAttempt).toHaveBeenCalledWith(2, 3, expect.any(Error));
        });

        it('should not retry cancellation errors', async () => {
            const fn = vi.fn().mockRejectedValue(new CancellationError());

            const promise = withRetry(fn, { attempts: 3 });

            await expect(promise).rejects.toThrow(CancellationError);
            expect(fn).toHaveBeenCalledTimes(1);
        });

        it('should check cancellation between attempts', async () => {
            vi.useRealTimers();
            let cancelled = false;
            const fn = vi.fn()
                .mockImplementation(() => {
                    if (!cancelled) {
                        cancelled = true;  // Cancel after first attempt
                        return Promise.reject(new Error('fail'));
                    }
                    return Promise.resolve('success');
                });

            await expect(
                withRetry(fn, {
                    attempts: 3,
                    delayMs: 10,
                    isCancelled: () => cancelled,
                })
            ).rejects.toThrow(CancellationError);
        });
    });

    describe('isRetryExhaustedError', () => {
        it('should return true for RetryExhaustedError', () => {
            expect(isRetryExhaustedError(new RetryExhaustedError('test'))).toBe(true);
        });

        it('should return false for other errors', () => {
            expect(isRetryExhaustedError(new Error('test'))).toBe(false);
        });
    });
});

describe('Policy', () => {
    beforeEach(() => {
        vi.useFakeTimers();
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    describe('runWithPolicy', () => {
        it('should execute function without policy', async () => {
            const fn = vi.fn().mockResolvedValue('result');

            const result = await runWithPolicy(fn);

            expect(result).toBe('result');
        });

        it('should apply timeout when specified', async () => {
            const fn = () => new Promise((resolve) => setTimeout(resolve, 2000));
            const promise = runWithPolicy(fn, { timeoutMs: 1000 });

            vi.advanceTimersByTime(1001);

            await expect(promise).rejects.toThrow(TimeoutError);
        });

        it('should apply retry when enabled', async () => {
            const fn = vi.fn()
                .mockRejectedValueOnce(new Error('fail'))
                .mockResolvedValue('success');

            const promise = runWithPolicy(fn, {
                retryOnFailure: true,
                retryAttempts: 3,
                retryDelayMs: 100,
            });

            await vi.advanceTimersByTimeAsync(200);
            const result = await promise;

            expect(result).toBe('success');
            expect(fn).toHaveBeenCalledTimes(2);
        });

        it('should combine timeout and retry', async () => {
            let callCount = 0;
            const fn = vi.fn().mockImplementation(() => {
                callCount++;
                if (callCount === 1) {
                    // First call times out
                    return new Promise((resolve) => setTimeout(resolve, 2000));
                }
                // Second call succeeds quickly
                return Promise.resolve('success');
            });

            const promise = runWithPolicy(fn, {
                timeoutMs: 500,
                retryOnFailure: true,
                retryAttempts: 3,
                retryDelayMs: 100,
            });

            // First call times out at 500ms
            vi.advanceTimersByTime(501);
            await vi.advanceTimersByTimeAsync(0);

            // Wait for retry delay
            await vi.advanceTimersByTimeAsync(100);

            // Second call succeeds
            const result = await promise;
            expect(result).toBe('success');
            expect(fn).toHaveBeenCalledTimes(2);
        });

        it('should check cancellation immediately', async () => {
            const fn = vi.fn().mockResolvedValue('result');

            const promise = runWithPolicy(fn, {
                isCancelled: () => true,
            });

            await expect(promise).rejects.toThrow(CancellationError);
            expect(fn).not.toHaveBeenCalled();
        });
    });

    describe('createPolicyRunner', () => {
        it('should create reusable policy runner', async () => {
            const runner = createPolicyRunner({
                timeoutMs: 5000,
                operationName: 'AI Call',
            });

            const fn = vi.fn().mockResolvedValue('result');
            const result = await runner(fn);

            expect(result).toBe('result');
        });

        it('should allow overriding options', async () => {
            const runner = createPolicyRunner({
                timeoutMs: 5000,
            });

            const fn = () => new Promise((resolve) => setTimeout(resolve, 2000));
            const promise = runner(fn, { timeoutMs: 500 });

            vi.advanceTimersByTime(501);

            await expect(promise).rejects.toThrow(TimeoutError);
        });
    });
});
