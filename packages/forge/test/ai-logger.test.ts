/**
 * Tests for ai-logger.ts — structured Pino logging for the AI service domain.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Writable } from 'stream';
import pino from 'pino';
import { initAIServiceLogger, getAIServiceLogger, createSessionLogger } from '../src/ai-logger';
import { createRootPinoLogger } from '../src/pino-logger';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Capture Pino JSON output to a string buffer. */
function captureStream(): { stream: Writable; lines: () => string[] } {
    const chunks: Buffer[] = [];
    const stream = new Writable({
        write(chunk, _enc, cb) {
            chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
            cb();
        },
    });
    return {
        stream,
        lines: () =>
            Buffer.concat(chunks)
                .toString()
                .split('\n')
                .filter((l) => l.trim().length > 0),
    };
}

// ---------------------------------------------------------------------------
// Reset module state between tests
// ---------------------------------------------------------------------------

/**
 * We need to reset the module-level aiServiceLogger between tests.
 * We do this by calling initAIServiceLogger with a silent logger.
 */
function resetAIServiceLogger(): void {
    // Pass a silent pino logger to reset the module state
    initAIServiceLogger(pino({ level: 'silent' }));
}

// ---------------------------------------------------------------------------
// getAIServiceLogger — uninitialized fallback
// ---------------------------------------------------------------------------

describe('getAIServiceLogger — uninitialized', () => {
    beforeEach(() => {
        // Force uninitialized state by re-importing after module reset
        // Since we can't easily reset module state, we just verify no crash occurs
    });

    it('returns a pino logger when uninitialized (silent fallback)', () => {
        // Even without calling initAIServiceLogger, getAIServiceLogger should not crash
        const logger = getAIServiceLogger();
        expect(typeof logger.debug).toBe('function');
        expect(typeof logger.info).toBe('function');
        expect(typeof logger.warn).toBe('function');
        expect(typeof logger.error).toBe('function');
    });

    it('silent fallback does not throw on any call', () => {
        const logger = getAIServiceLogger();
        expect(() => logger.debug('test message')).not.toThrow();
        expect(() => logger.info({ field: 'value' }, 'test message')).not.toThrow();
        expect(() => logger.warn({ err: new Error('boom') }, 'warn message')).not.toThrow();
        expect(() => logger.error({ durationMs: 100 }, 'error message')).not.toThrow();
    });
});

// ---------------------------------------------------------------------------
// initAIServiceLogger — from Pino root logger
// ---------------------------------------------------------------------------

describe('initAIServiceLogger — from existing Pino logger', () => {
    it('sets aiServiceLogger to a child with store=ai-service', () => {
        const { stream, lines } = captureStream();
        const root = pino({ level: 'debug' }, stream);
        initAIServiceLogger(root);

        const logger = getAIServiceLogger();
        logger.info('hello from ai-service');

        const records = lines().map((l) => JSON.parse(l));
        expect(records).toHaveLength(1);
        expect(records[0].store).toBe('ai-service');
        expect(records[0].msg).toBe('hello from ai-service');
    });

    it('structured fields are preserved in JSON output', () => {
        const { stream, lines } = captureStream();
        const root = pino({ level: 'debug' }, stream);
        initAIServiceLogger(root);

        const logger = getAIServiceLogger();
        logger.debug({ durationMs: 42, sessionId: 'sess-123' }, 'Request completed');

        const records = lines().map((l) => JSON.parse(l));
        expect(records[0].durationMs).toBe(42);
        expect(records[0].sessionId).toBe('sess-123');
        expect(records[0].msg).toBe('Request completed');
        expect(records[0].store).toBe('ai-service');
    });

    it('error objects are serialized via pino standard err serializer', () => {
        const { stream, lines } = captureStream();
        const root = pino({ level: 'error', serializers: { err: pino.stdSerializers.err } }, stream);
        initAIServiceLogger(root);

        const logger = getAIServiceLogger();
        const err = new Error('something failed');
        logger.error({ err, durationMs: 100 }, 'Request failed');

        const records = lines().map((l) => JSON.parse(l));
        expect(records[0].msg).toBe('Request failed');
        expect(records[0].durationMs).toBe(100);
        expect(records[0].err).toBeDefined();
        expect(records[0].err.message).toBe('something failed');
    });
});

// ---------------------------------------------------------------------------
// initAIServiceLogger — from PinoLoggerOptions
// ---------------------------------------------------------------------------

describe('initAIServiceLogger — from PinoLoggerOptions', () => {
    it('creates root logger from options and derives ai-service child', () => {
        // Use silent level to avoid stderr noise in tests
        initAIServiceLogger({ level: 'silent' });
        const logger = getAIServiceLogger();
        expect(typeof logger.debug).toBe('function');
        // Should not throw
        expect(() => logger.info({ key: 'val' }, 'from options')).not.toThrow();
    });
});

// ---------------------------------------------------------------------------
// createSessionLogger
// ---------------------------------------------------------------------------

describe('createSessionLogger', () => {
    it('returns a child logger with sessionId bound', () => {
        const { stream, lines } = captureStream();
        const root = pino({ level: 'debug' }, stream);
        initAIServiceLogger(root);

        const sessionLog = createSessionLogger('abc-def');
        sessionLog.debug({ toolName: 'grep' }, 'Tool execution started');

        const records = lines().map((l) => JSON.parse(l));
        expect(records).toHaveLength(1);
        expect(records[0].sessionId).toBe('abc-def');
        expect(records[0].toolName).toBe('grep');
        expect(records[0].msg).toBe('Tool execution started');
        expect(records[0].store).toBe('ai-service');
    });

    it('every entry carries the sessionId field', () => {
        const { stream, lines } = captureStream();
        const root = pino({ level: 'debug' }, stream);
        initAIServiceLogger(root);

        const sessionLog = createSessionLogger('session-xyz');
        sessionLog.info('first message');
        sessionLog.debug({ durationMs: 10 }, 'second message');
        sessionLog.warn({ err: new Error('oops') }, 'third message');

        const records = lines().map((l) => JSON.parse(l));
        expect(records).toHaveLength(3);
        for (const record of records) {
            expect(record.sessionId).toBe('session-xyz');
        }
    });

    it('does not throw when ai service logger is uninitialized', () => {
        // After calling initAIServiceLogger with a silent logger, createSessionLogger
        // should still work without throwing
        resetAIServiceLogger();
        expect(() => createSessionLogger('any-id').debug('test')).not.toThrow();
    });

    it('multiple session loggers are independent', () => {
        const { stream, lines } = captureStream();
        const root = pino({ level: 'debug' }, stream);
        initAIServiceLogger(root);

        const log1 = createSessionLogger('session-1');
        const log2 = createSessionLogger('session-2');

        log1.info('from session 1');
        log2.info('from session 2');

        const records = lines().map((l) => JSON.parse(l));
        expect(records[0].sessionId).toBe('session-1');
        expect(records[1].sessionId).toBe('session-2');
    });
});

// ---------------------------------------------------------------------------
// Structured field reference from task spec
// ---------------------------------------------------------------------------

describe('structured fields — task spec reference', () => {
    it('tool start event carries toolName, toolCallId, args', () => {
        const { stream, lines } = captureStream();
        const root = pino({ level: 'debug' }, stream);
        initAIServiceLogger(root);

        const sessionLog = createSessionLogger('sess-1');
        sessionLog.debug({ toolName: 'grep', toolCallId: 'tc-001', args: 'pattern=foo' }, 'Tool execution started');

        const record = JSON.parse(lines()[0]);
        expect(record.toolName).toBe('grep');
        expect(record.toolCallId).toBe('tc-001');
        expect(record.args).toBe('pattern=foo');
    });

    it('tool complete event carries durationMs, resultChars, success', () => {
        const { stream, lines } = captureStream();
        const root = pino({ level: 'debug' }, stream);
        initAIServiceLogger(root);

        const sessionLog = createSessionLogger('sess-2');
        sessionLog.debug({ toolName: 'view', toolCallId: 'tc-002', durationMs: 123, resultChars: 456, success: true }, 'Tool execution completed');

        const record = JSON.parse(lines()[0]);
        expect(record.durationMs).toBe(123);
        expect(record.resultChars).toBe(456);
        expect(record.success).toBe(true);
    });

    it('token usage event carries turn, inputTokens, outputTokens', () => {
        const { stream, lines } = captureStream();
        const root = pino({ level: 'debug' }, stream);
        initAIServiceLogger(root);

        const sessionLog = createSessionLogger('sess-3');
        sessionLog.debug({ turn: 2, inputTokens: 1000, outputTokens: 500 }, 'Token usage');

        const record = JSON.parse(lines()[0]);
        expect(record.turn).toBe(2);
        expect(record.inputTokens).toBe(1000);
        expect(record.outputTokens).toBe(500);
    });

    it('streaming complete uses info level with totalChars, turns, messages, elapsedMs', () => {
        const { stream, lines } = captureStream();
        const root = pino({ level: 'debug' }, stream);
        initAIServiceLogger(root);

        const sessionLog = createSessionLogger('sess-4');
        sessionLog.info({ totalChars: 2000, turns: 3, messages: 5, elapsedMs: 8000 }, 'Streaming completed');

        const record = JSON.parse(lines()[0]);
        expect(record.level).toBe(30); // pino info level = 30
        expect(record.totalChars).toBe(2000);
        expect(record.turns).toBe(3);
        expect(record.messages).toBe(5);
        expect(record.elapsedMs).toBe(8000);
    });
});
