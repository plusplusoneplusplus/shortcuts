/**
 * pino-setup Tests
 *
 * Tests for createCLIPinoLogger and pinoAdapterForPipelineCore.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { createCLIPinoLogger, pinoAdapterForPipelineCore } from '../src/pino-setup';
import type { ResolvedLoggingConfig } from '../src/config';
import { setColorEnabled } from '../src/logger';

/** Helper to build a ResolvedLoggingConfig with defaults */
function makeResolved(overrides: Partial<ResolvedLoggingConfig> = {}): ResolvedLoggingConfig {
    return { level: 'info', pretty: false, stores: {}, ...overrides };
}

describe('pino-setup', () => {
    let tmpDir: string;

    beforeEach(() => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'coc-pino-test-'));
        setColorEnabled(false);
    });

    afterEach(() => {
        fs.rmSync(tmpDir, { recursive: true, force: true });
        setColorEnabled(true);
    });

    // ========================================================================
    // createCLIPinoLogger — level resolution
    // ========================================================================

    describe('level resolution', () => {
        it('defaults to info level', () => {
            const { root } = createCLIPinoLogger(makeResolved());
            expect(root.level).toBe('info');
        });

        it('debug level is respected', () => {
            const { root } = createCLIPinoLogger(makeResolved({ level: 'debug' }));
            expect(root.level).toBe('debug');
        });

        it('explicit level option is respected', () => {
            const { root } = createCLIPinoLogger(makeResolved({ level: 'warn' }));
            expect(root.level).toBe('warn');
        });

        it('trace level is accepted', () => {
            const { root } = createCLIPinoLogger(makeResolved({ level: 'trace' }));
            expect(root.level).toBe('trace');
        });

        it('error level is accepted', () => {
            const { root } = createCLIPinoLogger(makeResolved({ level: 'error' }));
            expect(root.level).toBe('error');
        });
    });

    // ========================================================================
    // createCLIPinoLogger — child loggers
    // ========================================================================

    describe('child loggers', () => {
        it('returns root, ai, and coc loggers', () => {
            const loggers = createCLIPinoLogger(makeResolved());
            expect(loggers.root).toBeDefined();
            expect(loggers.ai).toBeDefined();
            expect(loggers.coc).toBeDefined();
        });

        it('ai logger has store: ai-service binding', () => {
            const { ai } = createCLIPinoLogger(makeResolved());
            const bindings = (ai as { bindings?: () => Record<string, unknown> }).bindings?.();
            if (bindings) {
                expect(bindings.store).toBe('ai-service');
            } else {
                expect(ai.level).toBe('info');
            }
        });

        it('coc logger has store: coc-service binding', () => {
            const { coc } = createCLIPinoLogger(makeResolved());
            const bindings = (coc as { bindings?: () => Record<string, unknown> }).bindings?.();
            if (bindings) {
                expect(bindings.store).toBe('coc-service');
            } else {
                expect(coc.level).toBe('info');
            }
        });

        it('per-store level override is applied to ai child logger', () => {
            const { root, ai } = createCLIPinoLogger(makeResolved({
                level: 'info',
                stores: { 'ai-service': { level: 'debug' } },
            }));
            expect(root.level).toBe('info');
            expect(ai.level).toBe('debug');
        });

        it('per-store level override is applied to coc child logger', () => {
            const { root, coc } = createCLIPinoLogger(makeResolved({
                level: 'warn',
                stores: { 'coc-service': { level: 'error' } },
            }));
            expect(root.level).toBe('warn');
            expect(coc.level).toBe('error');
        });

        it('child loggers inherit root level when no store override', () => {
            const { root, ai, coc } = createCLIPinoLogger(makeResolved({ level: 'warn' }));
            expect(ai.level).toBe(root.level);
            expect(coc.level).toBe(root.level);
        });
    });

    // ========================================================================
    // createCLIPinoLogger — file logging
    // ========================================================================

    describe('file logging', () => {
        it('creates log files on write when dir is set', async () => {
            const logDir = path.join(tmpDir, 'logs');
            const { ai, coc } = createCLIPinoLogger(makeResolved({ level: 'trace', dir: logDir }));

            ai.info({ category: 'test' }, 'ai message');
            coc.info({ category: 'test' }, 'coc message');

            await new Promise<void>((resolve) => {
                ai.flush(() => resolve());
            });

            const aiFile = path.join(logDir, 'ai-service.ndjson');
            const cocFile = path.join(logDir, 'coc-service.ndjson');
            expect(fs.existsSync(aiFile)).toBe(true);
            expect(fs.existsSync(cocFile)).toBe(true);
        });

        it('creates dir if it does not exist', async () => {
            const logDir = path.join(tmpDir, 'nested', 'logs');
            const { ai } = createCLIPinoLogger(makeResolved({ level: 'trace', dir: logDir }));
            ai.info({ category: 'test' }, 'msg');

            await new Promise<void>((resolve) => {
                ai.flush(() => resolve());
            });

            expect(fs.existsSync(path.join(logDir, 'ai-service.ndjson'))).toBe(true);
        });

        it('does not create log files when dir is not set', () => {
            const { root } = createCLIPinoLogger(makeResolved());
            expect(root).toBeDefined();
            const files = fs.readdirSync(tmpDir);
            expect(files.filter(f => f.endsWith('.ndjson'))).toHaveLength(0);
        });

        it('skips ai-service file when stores["ai-service"].file is false', async () => {
            const logDir = path.join(tmpDir, 'partial-logs');
            const { ai, coc } = createCLIPinoLogger(makeResolved({
                level: 'trace',
                dir: logDir,
                stores: { 'ai-service': { file: false } },
            }));

            ai.info({}, 'ai message');
            coc.info({}, 'coc message');
            await new Promise<void>((resolve) => { ai.flush(() => resolve()); });

            expect(fs.existsSync(path.join(logDir, 'ai-service.ndjson'))).toBe(false);
            expect(fs.existsSync(path.join(logDir, 'coc-service.ndjson'))).toBe(true);
        });
    });

    // ========================================================================
    // pinoAdapterForPipelineCore
    // ========================================================================

    describe('pinoAdapterForPipelineCore', () => {
        it('returns a Logger with all pipeline-core methods', () => {
            const { ai } = createCLIPinoLogger(makeResolved());
            const adapter = pinoAdapterForPipelineCore(ai);
            expect(typeof adapter.debug).toBe('function');
            expect(typeof adapter.info).toBe('function');
            expect(typeof adapter.warn).toBe('function');
            expect(typeof adapter.error).toBe('function');
        });

        it('adapter.info does not throw', () => {
            const { ai } = createCLIPinoLogger(makeResolved({ level: 'silent' }));
            const adapter = pinoAdapterForPipelineCore(ai);
            expect(() => adapter.info('category', 'message')).not.toThrow();
        });

        it('adapter.debug does not throw', () => {
            const { ai } = createCLIPinoLogger(makeResolved({ level: 'silent' }));
            const adapter = pinoAdapterForPipelineCore(ai);
            expect(() => adapter.debug('category', 'debug message')).not.toThrow();
        });

        it('adapter.warn does not throw', () => {
            const { ai } = createCLIPinoLogger(makeResolved({ level: 'silent' }));
            const adapter = pinoAdapterForPipelineCore(ai);
            expect(() => adapter.warn('category', 'warning')).not.toThrow();
        });

        it('adapter.error with Error object does not throw', () => {
            const { ai } = createCLIPinoLogger(makeResolved({ level: 'silent' }));
            const adapter = pinoAdapterForPipelineCore(ai);
            expect(() => adapter.error('category', 'error message', new Error('test'))).not.toThrow();
        });
    });

    // ========================================================================
    // pretty mode
    // ========================================================================

    describe('pretty mode', () => {
        it('pretty: false creates a plain logger', () => {
            const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
            try {
                const { root } = createCLIPinoLogger(makeResolved({ pretty: false, level: 'info' }));
                expect(root.level).toBe('info');
            } finally {
                stderrSpy.mockRestore();
            }
        });

        it('pretty: auto resolves based on TTY detection', () => {
            const { root } = createCLIPinoLogger(makeResolved({ pretty: 'auto' }));
            expect(root.level).toBe('info');
        });
    });
});
