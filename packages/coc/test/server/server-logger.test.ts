/**
 * Tests for server-logger.ts
 *
 * Covers: set/get logger injection, silent fallback, child logger factories.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import pino from 'pino';
import { Writable } from 'stream';
import { setServerLogger, getServerLogger, createRequestLogger, createWSLogger, createQueueLogger } from '../../src/server/logging/server-logger';
import { clearLogBuffer, getLogHistory } from '../../src/server/logging/server-log-capture';
import { setLogger, getLogger, LogCategory, resetLogger } from '@plusplusoneplusplus/forge';
import { pinoAdapterForPipelineCore } from '../../src/pino-setup';

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

describe('wrapped logger child → ring buffer (session log regression)', () => {
    beforeEach(() => {
        clearLogBuffer();
    });

    it('child logger with sessionId feeds entries into ring buffer', () => {
        const { stream } = createCaptureStream();
        setServerLogger(pino({ level: 'debug' }, stream));

        const sessionChild = getServerLogger().child({ component: 'ai-service' }).child({ sessionId: 'sess-abc' });
        sessionChild.info('session log message');

        const history = getLogHistory({});
        expect(history).toHaveLength(1);
        expect(history[0].sessionId).toBe('sess-abc');
        expect(history[0].component).toBe('ai-service');
        expect(history[0].msg).toBe('session log message');
    });

    it('ring buffer entries are filterable by sessionId', () => {
        const { stream } = createCaptureStream();
        setServerLogger(pino({ level: 'debug' }, stream));

        const wrapped = getServerLogger();
        const sess1 = wrapped.child({ component: 'ai-service', sessionId: 'sess-1' });
        const sess2 = wrapped.child({ component: 'ai-service', sessionId: 'sess-2' });
        wrapped.child({ component: 'http' }).info('unrelated log');

        sess1.info('message from session 1');
        sess2.info('message from session 2');

        const filtered = getLogHistory({ sessionId: 'sess-1' });
        expect(filtered).toHaveLength(1);
        expect(filtered[0].msg).toBe('message from session 1');
    });

    it('deeply nested child preserves sessionId through ring buffer', () => {
        const { stream } = createCaptureStream();
        setServerLogger(pino({ level: 'debug' }, stream));

        const deep = getServerLogger()
            .child({ component: 'ai-service' })
            .child({ sessionId: 'deep-sess' })
            .child({ requestId: 'req-42' });

        deep.warn('nested warning');

        const history = getLogHistory({ sessionId: 'deep-sess' });
        expect(history).toHaveLength(1);
        expect(history[0].level).toBe('warn');
        expect(history[0].sessionId).toBe('deep-sess');
        expect(history[0].component).toBe('ai-service');
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

// ── Regression: forge getLogger() must flow through the capture ring buffer ──
// When serve.ts wires setLogger(pinoAdapterForPipelineCore(getServerLogger().child(...))),
// calls to getLogger().debug/info/warn/error must appear in the ring buffer so
// that MCP OAuth logs (LogCategory.MCP) are visible in the dashboard.

describe('forge getLogger() → ring buffer (MCP OAuth dashboard regression)', () => {
    beforeEach(() => {
        clearLogBuffer();
    });

    afterEach(() => {
        resetLogger();
    });

    it('routes getLogger() calls through the ring buffer when wired via getServerLogger()', () => {
        const { stream } = createCaptureStream();
        setServerLogger(pino({ level: 'debug' }, stream));

        // Replicate the serve.ts wiring: derive forge getLogger() from the captured server logger.
        setLogger(pinoAdapterForPipelineCore(getServerLogger().child({ store: 'ai-service' })));

        getLogger().debug(LogCategory.MCP, '[McpOauthManager] addPending id=req-1 server=github');
        getLogger().info(LogCategory.MCP, '[McpOauthManager] resolved id=req-1 status=completed');
        getLogger().warn(LogCategory.MCP, '[McpOauthManager] some warning');

        const history = getLogHistory({});
        expect(history.length).toBeGreaterThanOrEqual(3);
        const msgs = history.map(e => e.msg);
        expect(msgs.some(m => m.includes('[McpOauthManager] addPending id=req-1'))).toBe(true);
        expect(msgs.some(m => m.includes('[McpOauthManager] resolved id=req-1'))).toBe(true);
        expect(msgs.some(m => m.includes('[McpOauthManager] some warning'))).toBe(true);
    });

    it('does NOT capture getLogger() calls when wired with raw ai logger (old broken behaviour)', () => {
        const { stream } = createCaptureStream();
        // Use a fresh raw pino logger (not through setServerLogger)
        const rawAi = pino({ level: 'debug' }, stream);
        setLogger(pinoAdapterForPipelineCore(rawAi));

        getLogger().info(LogCategory.MCP, 'raw-ai-msg should-not-appear-in-buffer');

        const history = getLogHistory({});
        const msgs = history.map(e => e.msg);
        expect(msgs.some(m => m.includes('raw-ai-msg'))).toBe(false);
    });
});
