/**
 * Isolated tests for packages/forge/src/runtime/timeout.ts
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { withTimeout, TimeoutError, isTimeoutError } from '../../src/runtime/timeout';
import { CancellationError } from '../../src/runtime/cancellation';
import { PipelineCoreError, ErrorCode } from '../../src/errors';

describe('TimeoutError', () => {
    it('creates with TIMEOUT code and correct name', () => {
        const error = new TimeoutError('too slow');
        expect(error.code).toBe(ErrorCode.TIMEOUT);
        expect(error.name).toBe('TimeoutError');
        expect(error.message).toBe('too slow');
    });
});

describe('withTimeout', () => {
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => vi.useRealTimers());

    it('resolves with the function return value when it completes in time', async () => {
        const fn = vi.fn().mockResolvedValue('done');
        const result = await withTimeout(fn, { timeoutMs: 1000 });
        expect(result).toBe('done');
    });

    it('throws TimeoutError when the function exceeds the deadline', async () => {
        const fn = () => new Promise<string>((resolve) => setTimeout(() => resolve('late'), 2000));
        const promise = withTimeout(fn, { timeoutMs: 500 });

        vi.advanceTimersByTime(501);

        await expect(promise).rejects.toThrow(TimeoutError);
    });

    it('includes the operation name in the TimeoutError message', async () => {
        const fn = () => new Promise<never>(() => { /* never resolves */ });
        const promise = withTimeout(fn, { timeoutMs: 100, operationName: 'myOp' });

        vi.advanceTimersByTime(101);

        await expect(promise).rejects.toSatisfy(
            (e: unknown) => e instanceof TimeoutError && e.message.includes('myOp')
        );
    });
});

describe('isTimeoutError', () => {
    it('returns true for TimeoutError instances', () => {
        expect(isTimeoutError(new TimeoutError('t'))).toBe(true);
    });

    it('returns true for a PipelineCoreError with ErrorCode.TIMEOUT', () => {
        const error = new PipelineCoreError('timed out', { code: ErrorCode.TIMEOUT });
        expect(isTimeoutError(error)).toBe(true);
    });

    it('returns false for CancellationError', () => {
        expect(isTimeoutError(new CancellationError())).toBe(false);
    });

    it('returns false for plain Error', () => {
        expect(isTimeoutError(new Error('nope'))).toBe(false);
    });

    it('returns false for non-error values', () => {
        expect(isTimeoutError(null)).toBe(false);
        expect(isTimeoutError(undefined)).toBe(false);
    });
});
