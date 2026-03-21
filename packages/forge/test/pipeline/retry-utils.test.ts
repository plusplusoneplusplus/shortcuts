import { describe, it, expect, vi } from 'vitest';
import { withRetry, RetryPolicy } from '../../src/pipeline/retry-utils';

describe('withRetry', () => {
    describe('happy path', () => {
        it('resolves immediately when fn succeeds on first attempt', async () => {
            const fn = vi.fn().mockResolvedValue('ok');
            const result = await withRetry(fn, { maxAttempts: 3 });
            expect(result).toBe('ok');
            expect(fn).toHaveBeenCalledTimes(1);
            expect(fn).toHaveBeenCalledWith(0);
        });

        it('passes attempt index to fn', async () => {
            const attempts: number[] = [];
            const fn = vi.fn().mockImplementation(async (attempt: number) => {
                attempts.push(attempt);
                if (attempt < 2) throw new Error('fail');
                return 'done';
            });
            const result = await withRetry(fn, { maxAttempts: 3 });
            expect(result).toBe('done');
            expect(attempts).toEqual([0, 1, 2]);
        });
    });

    describe('retry behaviour', () => {
        it('retries up to maxAttempts and returns on eventual success', async () => {
            let calls = 0;
            const fn = async (attempt: number) => {
                calls++;
                if (attempt < 2) throw new Error('transient');
                return 'success';
            };
            const result = await withRetry(fn, { maxAttempts: 3 });
            expect(result).toBe('success');
            expect(calls).toBe(3);
        });

        it('throws last error when all attempts fail', async () => {
            const fn = vi.fn().mockRejectedValue(new Error('always fails'));
            await expect(withRetry(fn, { maxAttempts: 3 })).rejects.toThrow('always fails');
            expect(fn).toHaveBeenCalledTimes(3);
        });

        it('does not retry when maxAttempts is 1', async () => {
            const fn = vi.fn().mockRejectedValue(new Error('oops'));
            await expect(withRetry(fn, { maxAttempts: 1 })).rejects.toThrow('oops');
            expect(fn).toHaveBeenCalledTimes(1);
        });
    });

    describe('shouldRetry predicate', () => {
        it('retries only when shouldRetry returns true', async () => {
            let calls = 0;
            const fn = async () => {
                calls++;
                throw new Error(calls === 1 ? 'timed out' : 'other error');
            };
            const policy: RetryPolicy = {
                maxAttempts: 3,
                shouldRetry: (err) => err instanceof Error && err.message.includes('timed out'),
            };
            await expect(withRetry(fn, policy)).rejects.toThrow('other error');
            // first call throws 'timed out' → retried; second call throws 'other error' → not retried
            expect(calls).toBe(2);
        });

        it('does not retry when shouldRetry returns false on first error', async () => {
            const fn = vi.fn().mockRejectedValue(new Error('permanent'));
            const policy: RetryPolicy = {
                maxAttempts: 3,
                shouldRetry: () => false,
            };
            await expect(withRetry(fn, policy)).rejects.toThrow('permanent');
            expect(fn).toHaveBeenCalledTimes(1);
        });

        it('retries on all errors when shouldRetry is omitted', async () => {
            let calls = 0;
            const fn = async () => {
                calls++;
                if (calls < 3) throw new Error('any error');
                return 'done';
            };
            const result = await withRetry(fn, { maxAttempts: 3 });
            expect(result).toBe('done');
            expect(calls).toBe(3);
        });
    });

    describe('doubled-timeout pattern (regression guard)', () => {
        it('supports passing doubled timeout to fn via attempt index', async () => {
            const baseTimeout = 100;
            const receivedTimeouts: number[] = [];
            let calls = 0;

            const fn = async (attempt: number) => {
                calls++;
                const t = attempt === 0 ? baseTimeout : baseTimeout * 2;
                receivedTimeouts.push(t);
                if (attempt === 0) throw new Error('timed out');
                return 'ok';
            };

            const result = await withRetry(fn, {
                maxAttempts: 2,
                shouldRetry: (err) => err instanceof Error && err.message.includes('timed out'),
            });

            expect(result).toBe('ok');
            expect(calls).toBe(2);
            expect(receivedTimeouts).toEqual([100, 200]);
        });
    });
});
