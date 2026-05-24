import { describe, it, expect, beforeEach } from 'vitest';
import pino from 'pino';
import { initSDKLogger, resetSDKLogger, getSDKLogger, createSessionLogger } from '../src/logger';

describe('coc-agent-sdk logger', () => {
    beforeEach(() => {
        resetSDKLogger();
    });

    it('returns a silent pino logger when not initialized', () => {
        const logger = getSDKLogger();
        expect(typeof logger.debug).toBe('function');
        expect(typeof logger.info).toBe('function');
        expect(typeof logger.warn).toBe('function');
        expect(typeof logger.error).toBe('function');
        expect(logger.level).toBe('silent');
    });

    it('accepts a pino logger instance', () => {
        const root = pino({ level: 'warn' });
        initSDKLogger(root);
        const logger = getSDKLogger();
        expect(typeof logger.debug).toBe('function');
    });

    it('accepts pino options object', () => {
        initSDKLogger({ level: 'error' });
        const logger = getSDKLogger();
        expect(typeof logger.error).toBe('function');
        expect(logger.level).toBe('error');
    });

    it('createSessionLogger returns a child logger with sessionId binding', () => {
        const records: unknown[] = [];
        const mockLogger = {
            child: (bindings: object) => ({
                ...mockLogger,
                _bindings: bindings,
                debug: (msg: string) => records.push({ ...bindings, msg }),
            }),
        } as any;
        initSDKLogger(mockLogger);
        const sessionLog = createSessionLogger('test-session-123');
        sessionLog.debug('hello');
        expect(records[0]).toMatchObject({ sessionId: 'test-session-123', msg: 'hello' });
    });

    it('resetSDKLogger restores silent fallback', () => {
        initSDKLogger({ level: 'debug' });
        resetSDKLogger();
        const logger = getSDKLogger();
        expect(logger.level).toBe('silent');
    });
});
