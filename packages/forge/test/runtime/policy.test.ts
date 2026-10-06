/**
 * Tests for runtime policy composition (runWithPolicy / createPolicyRunner).
 * Cancellation, timeout, and retry primitives are covered in their dedicated suites.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
    CancellationError,
    TimeoutError,
    runWithPolicy,
    createPolicyRunner,
} from '../../src/runtime';

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
                    return new Promise((resolve) => setTimeout(resolve, 2000));
                }
                return Promise.resolve('success');
            });

            const promise = runWithPolicy(fn, {
                timeoutMs: 500,
                retryOnFailure: true,
                retryAttempts: 3,
                retryDelayMs: 100,
            });

            vi.advanceTimersByTime(501);
            await vi.advanceTimersByTimeAsync(0);
            await vi.advanceTimersByTimeAsync(100);

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
