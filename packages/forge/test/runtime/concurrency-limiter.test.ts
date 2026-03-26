import { describe, it, expect } from 'vitest';
import { ConcurrencyLimiter, CancellationError } from '../../src/runtime/concurrency-limiter';
import {
    CancellationError as RuntimeCancellationError,
    isCancellationError,
} from '../../src/runtime/cancellation';
import {
    ConcurrencyLimiter as MRLimiter,
    CancellationError as MRCancellationError,
} from '../../src/map-reduce';
import {
    ConcurrencyLimiter as WFLimiter,
    CancellationError as WFCancellationError,
} from '../../src/workflow/concurrency-limiter';

describe('runtime/concurrency-limiter', () => {
    describe('canonical ConcurrencyLimiter', () => {
        it('throws when maxConcurrency is 0', () => {
            expect(() => new ConcurrencyLimiter(0)).toThrow('maxConcurrency must be at least 1');
        });

        it('run() resolves with the task return value', async () => {
            const limiter = new ConcurrencyLimiter(2);
            const result = await limiter.run(() => Promise.resolve(42));
            expect(result).toBe(42);
        });

        it('run() throws CancellationError when isCancelled is true', async () => {
            const limiter = new ConcurrencyLimiter(2);
            await expect(
                limiter.run(() => Promise.resolve(42), () => true),
            ).rejects.toBeInstanceOf(CancellationError);
        });
    });

    describe('re-exports are the same classes', () => {
        it('map-reduce re-exports the same ConcurrencyLimiter class', () => {
            expect(MRLimiter).toBe(ConcurrencyLimiter);
        });

        it('workflow re-exports the same ConcurrencyLimiter class', () => {
            expect(WFLimiter).toBe(ConcurrencyLimiter);
        });

        it('map-reduce re-exports the same CancellationError class', () => {
            expect(MRCancellationError).toBe(CancellationError);
        });

        it('workflow re-exports the same CancellationError class', () => {
            expect(WFCancellationError).toBe(CancellationError);
        });
    });

    describe('CancellationError hierarchy', () => {
        it('CancellationError from concurrency-limiter extends RuntimeCancellationError', () => {
            const err = new CancellationError();
            expect(err).toBeInstanceOf(RuntimeCancellationError);
        });

        it('isCancellationError() recognizes CancellationError from concurrency-limiter', () => {
            const err = new CancellationError();
            expect(isCancellationError(err)).toBe(true);
        });

        it('isCancellationError() recognizes CancellationError from map-reduce re-export', () => {
            const err = new MRCancellationError();
            expect(isCancellationError(err)).toBe(true);
        });

        it('isCancellationError() recognizes CancellationError from workflow re-export', () => {
            const err = new WFCancellationError();
            expect(isCancellationError(err)).toBe(true);
        });
    });
});
