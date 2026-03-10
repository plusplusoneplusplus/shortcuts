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
import { setColorEnabled } from '../src/logger';

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
            const { root } = createCLIPinoLogger({});
            expect(root.level).toBe('info');
        });

        it('verbose: true sets level to debug', () => {
            const { root } = createCLIPinoLogger({ verbose: true });
            expect(root.level).toBe('debug');
        });

        it('verbose: true overrides explicit level option', () => {
            const { root } = createCLIPinoLogger({ verbose: true, level: 'warn' });
            expect(root.level).toBe('debug');
        });

        it('explicit level option is respected', () => {
            const { root } = createCLIPinoLogger({ level: 'warn' });
            expect(root.level).toBe('warn');
        });

        it('trace level is accepted', () => {
            const { root } = createCLIPinoLogger({ level: 'trace' });
            expect(root.level).toBe('trace');
        });

        it('error level is accepted', () => {
            const { root } = createCLIPinoLogger({ level: 'error' });
            expect(root.level).toBe('error');
        });
    });

    // ========================================================================
    // createCLIPinoLogger — child loggers
    // ========================================================================

    describe('child loggers', () => {
        it('returns root, ai, and coc loggers', () => {
            const loggers = createCLIPinoLogger({});
            expect(loggers.root).toBeDefined();
            expect(loggers.ai).toBeDefined();
            expect(loggers.coc).toBeDefined();
        });

        it('ai logger has store: ai-service binding', () => {
            const { ai } = createCLIPinoLogger({});
            // Pino child logger bindings are accessible via logger.bindings()
            const bindings = (ai as { bindings?: () => Record<string, unknown> }).bindings?.();
            if (bindings) {
                expect(bindings.store).toBe('ai-service');
            } else {
                // Fallback: just verify it's a valid logger
                expect(ai.level).toBe('info');
            }
        });

        it('coc logger has store: coc-service binding', () => {
            const { coc } = createCLIPinoLogger({});
            const bindings = (coc as { bindings?: () => Record<string, unknown> }).bindings?.();
            if (bindings) {
                expect(bindings.store).toBe('coc-service');
            } else {
                expect(coc.level).toBe('info');
            }
        });
    });

    // ========================================================================
    // createCLIPinoLogger — file logging
    // ========================================================================

    describe('file logging', () => {
        it('creates log files on write when logDir is set', async () => {
            const logDir = path.join(tmpDir, 'logs');
            const { ai, coc } = createCLIPinoLogger({ logDir, level: 'trace' });

            // Write a log record and flush
            ai.info({ category: 'test' }, 'ai message');
            coc.info({ category: 'test' }, 'coc message');

            // Flush pino's async streams
            await new Promise<void>((resolve) => {
                ai.flush(() => resolve());
            });

            // Files should exist now
            const aiFile = path.join(logDir, 'ai-service.ndjson');
            const cocFile = path.join(logDir, 'coc-service.ndjson');
            expect(fs.existsSync(aiFile)).toBe(true);
            expect(fs.existsSync(cocFile)).toBe(true);
        });

        it('creates logDir if it does not exist', async () => {
            const logDir = path.join(tmpDir, 'nested', 'logs');
            const { ai } = createCLIPinoLogger({ logDir, level: 'trace' });
            ai.info({ category: 'test' }, 'msg');

            await new Promise<void>((resolve) => {
                ai.flush(() => resolve());
            });

            expect(fs.existsSync(path.join(logDir, 'ai-service.ndjson'))).toBe(true);
        });

        it('does not create log files when logDir is not set', () => {
            const { root } = createCLIPinoLogger({});
            expect(root).toBeDefined();
            // No files created in tmpDir
            const files = fs.readdirSync(tmpDir);
            expect(files.filter(f => f.endsWith('.ndjson'))).toHaveLength(0);
        });
    });

    // ========================================================================
    // pinoAdapterForPipelineCore
    // ========================================================================

    describe('pinoAdapterForPipelineCore', () => {
        it('returns a Logger with all pipeline-core methods', () => {
            const { ai } = createCLIPinoLogger({});
            const adapter = pinoAdapterForPipelineCore(ai);
            expect(typeof adapter.debug).toBe('function');
            expect(typeof adapter.info).toBe('function');
            expect(typeof adapter.warn).toBe('function');
            expect(typeof adapter.error).toBe('function');
        });

        it('adapter.info does not throw', () => {
            const { ai } = createCLIPinoLogger({ level: 'silent' });
            const adapter = pinoAdapterForPipelineCore(ai);
            expect(() => adapter.info('category', 'message')).not.toThrow();
        });

        it('adapter.debug does not throw', () => {
            const { ai } = createCLIPinoLogger({ level: 'silent' });
            const adapter = pinoAdapterForPipelineCore(ai);
            expect(() => adapter.debug('category', 'debug message')).not.toThrow();
        });

        it('adapter.warn does not throw', () => {
            const { ai } = createCLIPinoLogger({ level: 'silent' });
            const adapter = pinoAdapterForPipelineCore(ai);
            expect(() => adapter.warn('category', 'warning')).not.toThrow();
        });

        it('adapter.error with Error object does not throw', () => {
            const { ai } = createCLIPinoLogger({ level: 'silent' });
            const adapter = pinoAdapterForPipelineCore(ai);
            expect(() => adapter.error('category', 'error message', new Error('test'))).not.toThrow();
        });
    });

    // ========================================================================
    // pretty mode
    // ========================================================================

    describe('pretty mode', () => {
        it('pretty: false creates a plain logger without transport', () => {
            const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
            try {
                // With pretty:false and no logDir, logs go to stderr as JSON
                const { root } = createCLIPinoLogger({ pretty: false, level: 'info' });
                expect(root.level).toBe('info');
            } finally {
                stderrSpy.mockRestore();
            }
        });
    });
});
