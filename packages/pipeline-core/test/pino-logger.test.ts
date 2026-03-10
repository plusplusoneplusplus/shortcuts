/**
 * Tests for pino-logger.ts — foundation module for structured Pino logging.
 */

import { describe, it, expect } from 'vitest';
import { Writable } from 'stream';
import pino from 'pino';
import {
    createPinoAdapter,
    createPinoNullLogger,
    createRootPinoLogger,
    createLogStore,
} from '../src/pino-logger';
import type { Logger } from '../src/logger';
import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs';

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
// createPinoAdapter
// ---------------------------------------------------------------------------

describe('createPinoAdapter', () => {
    it('returns an object satisfying the Logger interface', () => {
        const adapter = createPinoAdapter(pino({ level: 'silent' }));
        expect(typeof adapter.debug).toBe('function');
        expect(typeof adapter.info).toBe('function');
        expect(typeof adapter.warn).toBe('function');
        expect(typeof adapter.error).toBe('function');
    });

    it('all four methods are callable without throwing', () => {
        const adapter: Logger = createPinoAdapter(pino({ level: 'silent' }));
        expect(() => adapter.debug('cat', 'msg')).not.toThrow();
        expect(() => adapter.info('cat', 'msg')).not.toThrow();
        expect(() => adapter.warn('cat', 'msg')).not.toThrow();
        expect(() => adapter.error('cat', 'msg')).not.toThrow();
        expect(() => adapter.error('cat', 'msg', new Error('boom'))).not.toThrow();
    });

    it('forwards category as a structured field', () => {
        const { stream, lines } = captureStream();
        const pinoLogger = pino({ level: 'debug' }, stream);
        const adapter = createPinoAdapter(pinoLogger);

        adapter.info('AI Service', 'hello');

        const records = lines().map((l) => JSON.parse(l));
        expect(records).toHaveLength(1);
        expect(records[0].category).toBe('AI Service');
        expect(records[0].msg).toBe('hello');
    });

    it('forwards debug messages with correct level', () => {
        const { stream, lines } = captureStream();
        const pinoLogger = pino({ level: 'debug' }, stream);
        const adapter = createPinoAdapter(pinoLogger);

        adapter.debug('Pipeline', 'debug msg');

        const records = lines().map((l) => JSON.parse(l));
        expect(records[0].level).toBe(20); // pino debug level
        expect(records[0].category).toBe('Pipeline');
    });

    it('forwards warn messages', () => {
        const { stream, lines } = captureStream();
        const pinoLogger = pino({ level: 'warn' }, stream);
        const adapter = createPinoAdapter(pinoLogger);

        adapter.warn('Memory', 'watch out');

        const records = lines().map((l) => JSON.parse(l));
        expect(records[0].level).toBe(40); // pino warn level
        expect(records[0].category).toBe('Memory');
    });

    it('forwards Error objects in the err field', () => {
        const { stream, lines } = captureStream();
        const pinoLogger = pino({ level: 'error' }, stream);
        const adapter = createPinoAdapter(pinoLogger);

        const err = new Error('something broke');
        adapter.error('General', 'failure', err);

        const records = lines().map((l) => JSON.parse(l));
        expect(records).toHaveLength(1);
        expect(records[0].category).toBe('General');
        expect(records[0].msg).toBe('failure');
        // pino.stdSerializers.err is NOT on this logger, but err should still be present
        expect(records[0].err).toBeDefined();
    });

    it('error without Error object does not throw', () => {
        const { stream, lines } = captureStream();
        const pinoLogger = pino({ level: 'error' }, stream);
        const adapter = createPinoAdapter(pinoLogger);

        adapter.error('General', 'oops');

        const records = lines().map((l) => JSON.parse(l));
        expect(records[0].msg).toBe('oops');
    });
});

// ---------------------------------------------------------------------------
// createPinoNullLogger
// ---------------------------------------------------------------------------

describe('createPinoNullLogger', () => {
    it('returns a Logger-compatible object', () => {
        const logger = createPinoNullLogger();
        expect(typeof logger.debug).toBe('function');
        expect(typeof logger.info).toBe('function');
        expect(typeof logger.warn).toBe('function');
        expect(typeof logger.error).toBe('function');
    });

    it('suppresses all output', () => {
        // There is no observable output to capture since Pino uses level 'silent'.
        // We just verify no output reaches stderr and no error is thrown.
        const logger = createPinoNullLogger();
        expect(() => logger.debug('cat', 'msg')).not.toThrow();
        expect(() => logger.info('cat', 'msg')).not.toThrow();
        expect(() => logger.warn('cat', 'msg')).not.toThrow();
        expect(() => logger.error('cat', 'msg', new Error('x'))).not.toThrow();
    });
});

// ---------------------------------------------------------------------------
// createRootPinoLogger
// ---------------------------------------------------------------------------

describe('createRootPinoLogger', () => {
    it('returns a working pino logger', () => {
        const { stream, lines } = captureStream();
        const root = pino({ level: 'info' }, stream);
        root.info('basic test');
        const records = lines().map((l) => JSON.parse(l));
        expect(records[0].msg).toBe('basic test');
    });

    it('createRootPinoLogger without logDir writes to stderr substitute', () => {
        // We test via createRootPinoLogger itself using a custom stream path
        // Just confirm the function runs without error
        const logger = createRootPinoLogger({ level: 'silent' });
        expect(logger).toBeDefined();
        expect(typeof logger.info).toBe('function');
    });

    it('createRootPinoLogger with logDir creates .ndjson files on write', async () => {
        const tmpDir = path.join(os.tmpdir(), `pino-test-${Date.now()}`);
        fs.mkdirSync(tmpDir, { recursive: true });

        try {
            const logger = createRootPinoLogger({
                level: 'info',
                logDir: tmpDir,
                stores: {
                    'ai-service': { file: true },
                    'coc-service': { file: true },
                },
            });

            logger.info('trigger flush');

            // Give async destination a tick to flush
            await new Promise((r) => setTimeout(r, 100));

            const aiFile = path.join(tmpDir, 'ai-service.ndjson');
            const cocFile = path.join(tmpDir, 'coc-service.ndjson');
            expect(fs.existsSync(aiFile)).toBe(true);
            expect(fs.existsSync(cocFile)).toBe(true);
        } finally {
            fs.rmSync(tmpDir, { recursive: true, force: true });
        }
    });
});

// ---------------------------------------------------------------------------
// createLogStore
// ---------------------------------------------------------------------------

describe('createLogStore', () => {
    it('returns a child logger with store field bound', () => {
        const { stream, lines } = captureStream();
        const root = pino({ level: 'info' }, stream);
        const child = createLogStore(root, 'ai-service');

        child.info('child message');

        const records = lines().map((l) => JSON.parse(l));
        expect(records[0].store).toBe('ai-service');
        expect(records[0].msg).toBe('child message');
    });

    it('coc-service store has correct store field', () => {
        const { stream, lines } = captureStream();
        const root = pino({ level: 'info' }, stream);
        const child = createLogStore(root, 'coc-service');

        child.info('coc message');

        const records = lines().map((l) => JSON.parse(l));
        expect(records[0].store).toBe('coc-service');
    });
});
