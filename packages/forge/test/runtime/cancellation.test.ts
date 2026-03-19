/**
 * Isolated tests for packages/forge/src/runtime/cancellation.ts
 */

import { describe, it, expect } from 'vitest';
import {
    CancellationError,
    isCancellationError,
    throwIfCancelled,
    createCancellationToken,
} from '../../src/runtime/cancellation';
import { PipelineCoreError, ErrorCode } from '../../src/errors';

describe('CancellationError', () => {
    it('creates with default message and CANCELLED code', () => {
        const error = new CancellationError();
        expect(error.message).toBe('Operation cancelled');
        expect(error.code).toBe(ErrorCode.CANCELLED);
        expect(error.name).toBe('CancellationError');
    });

    it('creates with custom message', () => {
        const error = new CancellationError('user cancelled');
        expect(error.message).toBe('user cancelled');
    });
});

describe('throwIfCancelled', () => {
    it('throws CancellationError when isCancelled returns true', () => {
        expect(() => throwIfCancelled(() => true)).toThrow(CancellationError);
    });

    it('is a no-op when isCancelled returns false', () => {
        expect(() => throwIfCancelled(() => false)).not.toThrow();
    });

    it('is a no-op when called with no argument', () => {
        expect(() => throwIfCancelled()).not.toThrow();
    });
});

describe('createCancellationToken', () => {
    it('exposes isCancelled that reflects the wrapped function', () => {
        let cancelled = false;
        const token = createCancellationToken(() => cancelled);

        expect(token.isCancelled()).toBe(false);
        cancelled = true;
        expect(token.isCancelled()).toBe(true);
    });

    it('exposes throwIfCancelled that throws when cancelled', () => {
        let cancelled = false;
        const token = createCancellationToken(() => cancelled);

        expect(() => token.throwIfCancelled()).not.toThrow();
        cancelled = true;
        expect(() => token.throwIfCancelled()).toThrow(CancellationError);
    });

    it('defaults to never cancelled when no function provided', () => {
        const token = createCancellationToken();
        expect(token.isCancelled()).toBe(false);
        expect(() => token.throwIfCancelled()).not.toThrow();
    });
});

describe('isCancellationError', () => {
    it('returns true for CancellationError instances', () => {
        expect(isCancellationError(new CancellationError())).toBe(true);
    });

    it('returns true for a PipelineCoreError with ErrorCode.CANCELLED', () => {
        const error = new PipelineCoreError('cancelled', { code: ErrorCode.CANCELLED });
        expect(isCancellationError(error)).toBe(true);
    });

    it('returns false for plain Error', () => {
        expect(isCancellationError(new Error('nope'))).toBe(false);
    });

    it('returns false for PipelineCoreError with a different code', () => {
        const error = new PipelineCoreError('timeout', { code: ErrorCode.TIMEOUT });
        expect(isCancellationError(error)).toBe(false);
    });

    it('returns false for non-error values', () => {
        expect(isCancellationError(null)).toBe(false);
        expect(isCancellationError('string')).toBe(false);
        expect(isCancellationError(42)).toBe(false);
    });
});
