/**
 * Tests for setupServerLogging() — the shared logger-wiring helper reused by
 * both `coc serve` and the desktop-forked server (server-entry.ts).
 *
 * The critical guarantee: after calling setupServerLogging(), the server
 * capture proxy is wired so that getServerLogger().info(...) (and its child
 * loggers) land in the in-process ring buffer that feeds /api/logs/stream.
 * This is what makes the in-app Logs viewer non-empty when the desktop app
 * runs its own forked server.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { setupServerLogging } from '../../src/server/logging/setup-server-logging';
import { getServerLogger } from '../../src/server/logging/server-logger';
import { clearLogBuffer, getLogHistory } from '../../src/server/logging/server-log-capture';
import { getLogger, LogCategory, resetLogger } from '@plusplusoneplusplus/forge';
import { getSDKLogger, resetSDKLogger } from '@plusplusoneplusplus/coc-agent-sdk';

function makeTempLogDir(): string {
    return fs.mkdtempSync(path.join(os.tmpdir(), 'coc-setup-logging-'));
}

describe('setupServerLogging', () => {
    let logDir: string;

    beforeEach(() => {
        clearLogBuffer();
        logDir = makeTempLogDir();
    });

    afterEach(() => {
        resetLogger();
        resetSDKLogger();
        try { fs.rmSync(logDir, { recursive: true, force: true }); } catch { /* ignore */ }
    });

    it('wires the capture proxy so getServerLogger().info() lands in the ring buffer', () => {
        setupServerLogging({ logLevel: 'debug', logDir });

        getServerLogger().info({ route: '/api/x' }, 'request handled');

        const history = getLogHistory({});
        expect(history.some(e => e.msg === 'request handled')).toBe(true);
        const entry = history.find(e => e.msg === 'request handled');
        expect(entry?.route).toBe('/api/x');
    });

    it('captures each log call exactly once (capture proxy not double-wrapped)', () => {
        setupServerLogging({ logLevel: 'debug', logDir });

        getServerLogger().info('single-capture-check');

        const matches = getLogHistory({}).filter(e => e.msg === 'single-capture-check');
        expect(matches).toHaveLength(1);
    });

    it('routes AI-service child logger through the ring buffer', () => {
        setupServerLogging({ logLevel: 'debug', logDir });

        getServerLogger().child({ component: 'ai-service' }).info('ai child log');

        const history = getLogHistory({ component: 'ai-service' });
        expect(history.some(e => e.msg === 'ai child log')).toBe(true);
    });

    it('routes forge getLogger() through the ring buffer (MCP/AI dashboard logs)', () => {
        setupServerLogging({ logLevel: 'debug', logDir });

        getLogger().info(LogCategory.MCP, '[McpOauthManager] wired via setupServerLogging');

        const msgs = getLogHistory({}).map(e => e.msg);
        expect(msgs.some(m => m.includes('[McpOauthManager] wired via setupServerLogging'))).toBe(true);
    });

    it('routes coc-agent-sdk getSDKLogger() through the ring buffer (claude-sdk logs)', () => {
        setupServerLogging({ logLevel: 'debug', logDir });

        getSDKLogger().info('sdk debug line');

        const history = getLogHistory({ component: 'claude-sdk' });
        expect(history.some(e => e.msg === 'sdk debug line')).toBe(true);
    });

    it('returns the coc child logger and creates the log directory', () => {
        const { coc, ai } = setupServerLogging({ logLevel: 'info', logDir });

        expect(typeof coc.info).toBe('function');
        expect(typeof ai.info).toBe('function');
        expect(fs.existsSync(logDir)).toBe(true);
    });

    it('honors fileConfig.logging level over the default', () => {
        // The resolved level flows into pino's output threshold (stderr/file);
        // the returned logger reflects it. (The capture ring buffer records all
        // levels by design, so we assert on the logger's level, not the buffer.)
        const { coc } = setupServerLogging({ logDir, fileConfig: { logging: { level: 'warn' } } });
        expect(coc.level).toBe('warn');

        const { coc: cocDefault } = setupServerLogging({ logDir });
        expect(cocDefault.level).toBe('info');
    });

    it('CLI logLevel overrides fileConfig.logging level', () => {
        const { coc } = setupServerLogging({
            logLevel: 'debug',
            logDir,
            fileConfig: { logging: { level: 'warn' } },
        });
        expect(coc.level).toBe('debug');
    });
});
