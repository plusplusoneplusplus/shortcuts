/**
 * StreamErrorGuard Tests
 *
 * Unit tests for:
 * - isStreamDestroyedError() standalone helper
 * - isConnectionDisposedError() standalone helper
 * - StreamErrorGuard class (install / remove lifecycle)
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
    isStreamDestroyedError,
    isConnectionDisposedError,
    StreamErrorGuard,
} from '../../src/stream-error-guard';



// ============================================================================
// isStreamDestroyedError
// ============================================================================

describe('isStreamDestroyedError', () => {
    it('detects "stream was destroyed" (lowercase)', () => {
        expect(isStreamDestroyedError('stream was destroyed')).toBe(true);
    });

    it('detects "ERR_STREAM_DESTROYED" (mixed case)', () => {
        expect(isStreamDestroyedError('ERR_STREAM_DESTROYED')).toBe(true);
    });

    it('detects "cannot call write after a stream was destroyed"', () => {
        expect(isStreamDestroyedError('cannot call write after a stream was destroyed')).toBe(true);
    });

    it('detects "EPIPE" embedded in a longer message', () => {
        expect(isStreamDestroyedError('write EPIPE')).toBe(true);
    });

    it('detects "ECONNRESET" embedded in a longer message', () => {
        expect(isStreamDestroyedError('read ECONNRESET')).toBe(true);
    });

    it('returns false for unrelated errors', () => {
        expect(isStreamDestroyedError('some other error')).toBe(false);
        expect(isStreamDestroyedError('Network timeout')).toBe(false);
        expect(isStreamDestroyedError('')).toBe(false);
    });

    it('is case-insensitive', () => {
        expect(isStreamDestroyedError('STREAM WAS DESTROYED')).toBe(true);
        expect(isStreamDestroyedError('err_stream_destroyed')).toBe(true);
    });
});

// ============================================================================
// isConnectionDisposedError
// ============================================================================

describe('isConnectionDisposedError', () => {
    it('detects "Connection is disposed"', () => {
        expect(isConnectionDisposedError(new Error('Connection is disposed'))).toBe(true);
    });

    it('detects "connection closed" (lowercase)', () => {
        expect(isConnectionDisposedError(new Error('connection closed unexpectedly'))).toBe(true);
    });

    it('detects "Connection got disposed"', () => {
        expect(isConnectionDisposedError(new Error('Connection got disposed'))).toBe(true);
    });

    it('detects error with numeric code === 2', () => {
        const err = new Error('some json-rpc error') as Error & { code: number };
        err.code = 2;
        expect(isConnectionDisposedError(err)).toBe(true);
    });

    it('returns false for unrelated Error instances', () => {
        expect(isConnectionDisposedError(new Error('Network failure'))).toBe(false);
        expect(isConnectionDisposedError(new Error('stream was destroyed'))).toBe(false);
    });

    it('returns false for non-Error values', () => {
        expect(isConnectionDisposedError('Connection is disposed')).toBe(false);
        expect(isConnectionDisposedError(null)).toBe(false);
        expect(isConnectionDisposedError(undefined)).toBe(false);
        expect(isConnectionDisposedError(42)).toBe(false);
    });
});

// ============================================================================
// StreamErrorGuard
// ============================================================================

describe('StreamErrorGuard', () => {
    let guard: StreamErrorGuard;

    beforeEach(() => {
        guard = new StreamErrorGuard();
    });

    afterEach(() => {
        guard.remove();
    });

    it('starts with null handlers', () => {
        expect(guard.handler).toBeNull();
        expect(guard.rejectionHandler).toBeNull();
    });

    it('install() registers both process listeners', () => {
        const uncaughtBefore = process.listenerCount('uncaughtException');
        const rejectionBefore = process.listenerCount('unhandledRejection');

        guard.install();

        expect(guard.handler).not.toBeNull();
        expect(guard.rejectionHandler).not.toBeNull();
        expect(process.listenerCount('uncaughtException')).toBe(uncaughtBefore + 1);
        expect(process.listenerCount('unhandledRejection')).toBe(rejectionBefore + 1);
    });

    it('remove() deregisters both listeners', () => {
        guard.install();
        const uncaughtAfterInstall = process.listenerCount('uncaughtException');
        const rejectionAfterInstall = process.listenerCount('unhandledRejection');

        guard.remove();

        expect(guard.handler).toBeNull();
        expect(guard.rejectionHandler).toBeNull();
        expect(process.listenerCount('uncaughtException')).toBe(uncaughtAfterInstall - 1);
        expect(process.listenerCount('unhandledRejection')).toBe(rejectionAfterInstall - 1);
    });

    it('remove() is a no-op when not installed', () => {
        expect(() => guard.remove()).not.toThrow();
        expect(guard.handler).toBeNull();
        expect(guard.rejectionHandler).toBeNull();
    });

    it('install() is idempotent — does not accumulate listeners', () => {
        const uncaughtBefore = process.listenerCount('uncaughtException');
        const rejectionBefore = process.listenerCount('unhandledRejection');

        guard.install();
        guard.install(); // second call should replace, not add

        expect(process.listenerCount('uncaughtException')).toBe(uncaughtBefore + 1);
        expect(process.listenerCount('unhandledRejection')).toBe(rejectionBefore + 1);
    });

    it('uncaughtException handler absorbs ERR_STREAM_DESTROYED', () => {
        guard.install();
        const handler = guard.handler!;

        // Should not throw — swallowed
        expect(() => handler(new Error('stream was destroyed'))).not.toThrow();
        expect(() => handler(new Error('ERR_STREAM_DESTROYED'))).not.toThrow();
        expect(() => handler(new Error('write EPIPE'))).not.toThrow();
    });

    it('uncaughtException handler re-throws non-stream errors', () => {
        guard.install();
        const handler = guard.handler!;

        expect(() => handler(new Error('some unrelated crash'))).toThrow('some unrelated crash');
    });

    it('unhandledRejection handler absorbs ERR_STREAM_DESTROYED rejections', () => {
        guard.install();
        const rejHandler = guard.rejectionHandler!;

        expect(() => rejHandler(new Error('ERR_STREAM_DESTROYED'))).not.toThrow();
        expect(() => rejHandler(new Error('stream was destroyed'))).not.toThrow();
        expect(() => rejHandler(new Error('write EPIPE'))).not.toThrow();
    });

    it('unhandledRejection handler silently ignores non-stream rejections', () => {
        guard.install();
        const rejHandler = guard.rejectionHandler!;

        // Non-stream errors are let through for default Node.js handling — no throw
        expect(() => rejHandler(new Error('some other rejection'))).not.toThrow();
    });
});
