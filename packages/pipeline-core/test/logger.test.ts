/**
 * Logger Tests
 *
 * Tests for the pipeline-core logger: formatTimestamp, consoleLogger timestamps,
 * Logger interface, setLogger, getLogger, resetLogger, nullLogger.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
    formatTimestamp,
    consoleLogger,
    nullLogger,
    setLogger,
    getLogger,
    resetLogger,
    LogCategory,
} from '../src/logger';

describe('Logger', () => {
    // ========================================================================
    // formatTimestamp
    // ========================================================================

    describe('formatTimestamp', () => {
        it('should return an ISO 8601 string', () => {
            const ts = formatTimestamp();
            // ISO 8601 format: 2024-01-15T10:30:45.123Z
            expect(ts).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
        });

        it('should use the provided date', () => {
            const date = new Date('2025-06-15T12:30:45.789Z');
            const ts = formatTimestamp(date);
            expect(ts).toBe('2025-06-15T12:30:45.789Z');
        });

        it('should default to current time', () => {
            const before = Date.now();
            const ts = formatTimestamp();
            const after = Date.now();
            const parsed = new Date(ts).getTime();
            expect(parsed).toBeGreaterThanOrEqual(before);
            expect(parsed).toBeLessThanOrEqual(after);
        });
    });

    // ========================================================================
    // consoleLogger with timestamps
    // ========================================================================

    describe('consoleLogger', () => {
        let debugSpy: ReturnType<typeof vi.spyOn>;
        let logSpy: ReturnType<typeof vi.spyOn>;
        let warnSpy: ReturnType<typeof vi.spyOn>;
        let errorSpy: ReturnType<typeof vi.spyOn>;

        beforeEach(() => {
            debugSpy = vi.spyOn(console, 'debug').mockImplementation(() => {});
            logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
            warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
            errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
        });

        afterEach(() => {
            debugSpy.mockRestore();
            logSpy.mockRestore();
            warnSpy.mockRestore();
            errorSpy.mockRestore();
        });

        it('debug should include timestamp', () => {
            consoleLogger.debug('AI Service', 'test message');
            expect(debugSpy).toHaveBeenCalledTimes(1);
            const output = debugSpy.mock.calls[0][0] as string;
            // Should start with ISO timestamp
            expect(output).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z \[DEBUG\]/);
            expect(output).toContain('[AI Service]');
            expect(output).toContain('test message');
        });

        it('info should include timestamp', () => {
            consoleLogger.info('Pipeline', 'info msg');
            expect(logSpy).toHaveBeenCalledTimes(1);
            const output = logSpy.mock.calls[0][0] as string;
            expect(output).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z \[INFO\]/);
            expect(output).toContain('[Pipeline]');
            expect(output).toContain('info msg');
        });

        it('warn should include timestamp', () => {
            consoleLogger.warn('Utils', 'warn msg');
            expect(warnSpy).toHaveBeenCalledTimes(1);
            const output = warnSpy.mock.calls[0][0] as string;
            expect(output).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z \[WARN\]/);
            expect(output).toContain('[Utils]');
            expect(output).toContain('warn msg');
        });

        it('error should include timestamp', () => {
            consoleLogger.error('General', 'error msg');
            expect(errorSpy).toHaveBeenCalledTimes(1);
            const output = errorSpy.mock.calls[0][0] as string;
            expect(output).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z \[ERROR\]/);
            expect(output).toContain('[General]');
            expect(output).toContain('error msg');
        });

        it('error should include Error object when provided', () => {
            const err = new Error('boom');
            consoleLogger.error('Test', 'failure', err);
            expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('[ERROR]'), err);
        });
    });

    // ========================================================================
    // nullLogger
    // ========================================================================

    describe('nullLogger', () => {
        it('should not throw on any method', () => {
            expect(() => nullLogger.debug('cat', 'msg')).not.toThrow();
            expect(() => nullLogger.info('cat', 'msg')).not.toThrow();
            expect(() => nullLogger.warn('cat', 'msg')).not.toThrow();
            expect(() => nullLogger.error('cat', 'msg')).not.toThrow();
        });
    });

    // ========================================================================
    // setLogger / getLogger / resetLogger
    // ========================================================================

    describe('setLogger / getLogger / resetLogger', () => {
        afterEach(() => {
            resetLogger();
        });

        it('should default to consoleLogger', () => {
            resetLogger();
            expect(getLogger()).toBe(consoleLogger);
        });

        it('should allow setting a custom logger', () => {
            const custom = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
            setLogger(custom);
            expect(getLogger()).toBe(custom);
        });

        it('should restore consoleLogger on reset', () => {
            const custom = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
            setLogger(custom);
            resetLogger();
            expect(getLogger()).toBe(consoleLogger);
        });
    });

    // ========================================================================
    // LogCategory
    // ========================================================================

    describe('LogCategory', () => {
        it('should have expected values', () => {
            expect(LogCategory.AI).toBe('AI Service');
            expect(LogCategory.PIPELINE).toBe('Pipeline');
            expect(LogCategory.GIT).toBe('Git');
            expect(LogCategory.Memory).toBe('Memory');
        });
    });
});
