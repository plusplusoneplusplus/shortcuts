/**
 * deep-wiki pino-setup Tests
 *
 * Tests for createDeepWikiPinoLogger and pinoAdapterForPipelineCore.
 */

import { describe, it, expect } from 'vitest';
import { createDeepWikiPinoLogger, pinoAdapterForPipelineCore } from '../src/pino-setup';

describe('createDeepWikiPinoLogger', () => {
    // ========================================================================
    // Level resolution
    // ========================================================================

    describe('level resolution', () => {
        it('defaults to info level', () => {
            const logger = createDeepWikiPinoLogger();
            expect(logger.level).toBe('info');
        });

        it('verbose: true sets level to debug', () => {
            const logger = createDeepWikiPinoLogger({ verbose: true });
            expect(logger.level).toBe('debug');
        });

        it('verbose: true overrides explicit level', () => {
            const logger = createDeepWikiPinoLogger({ verbose: true, level: 'warn' });
            expect(logger.level).toBe('debug');
        });

        it('explicit level is respected', () => {
            const logger = createDeepWikiPinoLogger({ level: 'warn' });
            expect(logger.level).toBe('warn');
        });

        it('trace level is accepted', () => {
            const logger = createDeepWikiPinoLogger({ level: 'trace' });
            expect(logger.level).toBe('trace');
        });

        it('error level is accepted', () => {
            const logger = createDeepWikiPinoLogger({ level: 'error' });
            expect(logger.level).toBe('error');
        });
    });

    // ========================================================================
    // Pretty mode
    // ========================================================================

    describe('pretty mode', () => {
        it('pretty: false creates a plain JSON logger', () => {
            const logger = createDeepWikiPinoLogger({ pretty: false, level: 'info' });
            expect(logger.level).toBe('info');
        });

        it('pretty: auto resolves without error', () => {
            const logger = createDeepWikiPinoLogger({ pretty: 'auto' });
            expect(logger.level).toBe('info');
        });
    });

    // ========================================================================
    // Logger validity
    // ========================================================================

    describe('logger methods', () => {
        it('returns a valid pino logger with standard methods', () => {
            const logger = createDeepWikiPinoLogger({ level: 'silent' });
            expect(typeof logger.info).toBe('function');
            expect(typeof logger.debug).toBe('function');
            expect(typeof logger.warn).toBe('function');
            expect(typeof logger.error).toBe('function');
        });

        it('logger.info does not throw', () => {
            const logger = createDeepWikiPinoLogger({ level: 'silent' });
            expect(() => logger.info('test message')).not.toThrow();
        });

        it('logger.debug does not throw', () => {
            const logger = createDeepWikiPinoLogger({ level: 'silent' });
            expect(() => logger.debug('debug msg')).not.toThrow();
        });
    });
});

// ============================================================================
// pinoAdapterForPipelineCore
// ============================================================================

describe('pinoAdapterForPipelineCore (deep-wiki)', () => {
    it('wraps pino logger in pipeline-core Logger interface', () => {
        const pinoLogger = createDeepWikiPinoLogger({ level: 'silent' });
        const adapter = pinoAdapterForPipelineCore(pinoLogger);
        expect(typeof adapter.info).toBe('function');
        expect(typeof adapter.debug).toBe('function');
        expect(typeof adapter.warn).toBe('function');
        expect(typeof adapter.error).toBe('function');
    });

    it('adapter.info does not throw', () => {
        const pinoLogger = createDeepWikiPinoLogger({ level: 'silent' });
        const adapter = pinoAdapterForPipelineCore(pinoLogger);
        expect(() => adapter.info('category', 'message')).not.toThrow();
    });

    it('adapter.error with Error does not throw', () => {
        const pinoLogger = createDeepWikiPinoLogger({ level: 'silent' });
        const adapter = pinoAdapterForPipelineCore(pinoLogger);
        expect(() => adapter.error('category', 'error', new Error('test'))).not.toThrow();
    });
});
