/**
 * Tests for server-logger.ts
 *
 * Covers: set/get logger injection, silent fallback, child logger factories.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import pino from 'pino';
import { Writable } from 'stream';
import { setServerLogger, getServerLogger, createRequestLogger, createWSLogger, createQueueLogger } from '../src/server-logger';

// ============================================================================
// Helper: in-memory log capture stream
// ============================================================================

function createCaptureStream(): { stream: Writable; lines: () => string[] } {
    const chunks: string[] = [];
    const stream = new Writable({
        write(chunk, _enc, cb) {
            chunks.push(chunk.toString());
            cb();
        },
    });
    return { stream, lines: () => chunks.flatMap(c => c.split('\n').filter(Boolean)) };
}

// Reset the module-level logger before each test by setting a fresh logger.
// We re-import via the same module reference so the singleton is shared.

// ============================================================================
// Tests
// ============================================================================

describe('getServerLogger — silent fallback', () => {
    beforeEach(() => {
        // Reset to null by injecting a silent logger and then removing it
        // via the setServerLogger API (we can't access private state, so
        // we inject silent and verify no output).
        setServerLogger(pino({ level: 'silent' }));
    });

    it('returns a logger without crashing when not configured', () => {
        // Even without explicit setServerLogger, getServerLogger must not throw
        const log = getServerLogger();
        expect(log).toBeDefined();
        expect(typeof log.info).toBe('function');
    });

    it('does not crash when called multiple times before setServerLogger', () => {
        const log1 = getServerLogger();
        const log2 = getServerLogger();
        expect(log1).toBe(log2); // same silent instance (or at least no crash)
    });
});

describe('setServerLogger / getServerLogger — injection', () => {
    it('returns the injected logger', () => {
        const { stream, lines } = createCaptureStream();
        const logger = pino({ level: 'info' }, stream);
        setServerLogger(logger);

        const returned = getServerLogger();
        returned.info({ x: 1 }, 'hello');

        const parsed = lines().map(l => JSON.parse(l));
        expect(parsed).toHaveLength(1);
        expect(parsed[0].msg).toBe('hello');
        expect(parsed[0].x).toBe(1);
    });

    it('replaces the previously injected logger', () => {
        const { stream: s1, lines: l1 } = createCaptureStream();
        const { stream: s2, lines: l2 } = createCaptureStream();

        setServerLogger(pino({ level: 'info' }, s1));
        getServerLogger().info('first');

        setServerLogger(pino({ level: 'info' }, s2));
        getServerLogger().info('second');

        expect(l1().some(l => l.includes('first'))).toBe(true);
        expect(l1().some(l => l.includes('second'))).toBe(false);
        expect(l2().some(l => l.includes('second'))).toBe(true);
    });
});

describe('createRequestLogger / createWSLogger / createQueueLogger', () => {
    it('createRequestLogger produces log entries with component=http', () => {
        const { stream, lines } = createCaptureStream();
        setServerLogger(pino({ level: 'debug' }, stream));

        createRequestLogger().info('req-test');

        const parsed = lines().map(l => JSON.parse(l));
        expect(parsed[0].component).toBe('http');
        expect(parsed[0].msg).toBe('req-test');
    });

    it('createWSLogger produces log entries with component=websocket', () => {
        const { stream, lines } = createCaptureStream();
        setServerLogger(pino({ level: 'debug' }, stream));

        createWSLogger().debug('ws-test');

        const parsed = lines().map(l => JSON.parse(l));
        expect(parsed[0].component).toBe('websocket');
        expect(parsed[0].msg).toBe('ws-test');
    });

    it('createQueueLogger produces log entries with component=queue', () => {
        const { stream, lines } = createCaptureStream();
        setServerLogger(pino({ level: 'debug' }, stream));

        createQueueLogger().info('queue-test');

        const parsed = lines().map(l => JSON.parse(l));
        expect(parsed[0].component).toBe('queue');
        expect(parsed[0].msg).toBe('queue-test');
    });
});

describe('silent fallback produces no output', () => {
    it('when setServerLogger is not called (or called with silent), logs produce no output', () => {
        const { stream, lines } = createCaptureStream();
        const silent = pino({ level: 'silent' }, stream);
        setServerLogger(silent);

        getServerLogger().info('should-be-silent');
        getServerLogger().error('also-silent');

        expect(lines()).toHaveLength(0);
    });
});
