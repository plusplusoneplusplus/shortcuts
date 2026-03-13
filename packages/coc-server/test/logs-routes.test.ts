/**
 * Tests for logs-routes.ts — /api/logs/history and /api/logs/sources
 *
 * Uses in-process HTTP server (no real Pino logger) to test route handlers.
 * The log capture buffer is populated directly via captureEntry().
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as http from 'http';
import { createRouter } from '../src/shared/router';
import { registerLogsRoutes } from '../src/logs-routes';
import {
    captureEntry,
    clearLogBuffer,
    getLogHistory,
    buildLogEntry,
    numToLevel,
} from '../src/server-log-capture';
import type { Route } from '../src/types';
import type { LogEntry } from '../src/server-log-capture';

// ── Helpers ──────────────────────────────────────────────────────────────────

let server: http.Server;
let baseUrl: string;

function makeServer(logDir?: string): http.Server {
    const routes: Route[] = [];
    registerLogsRoutes(routes, logDir);
    const handler = createRouter({ routes, spaHtml: '' });
    return http.createServer(handler);
}

async function startServer(logDir?: string): Promise<void> {
    server = makeServer(logDir);
    return new Promise((resolve, reject) => {
        server.on('error', reject);
        server.listen(0, '127.0.0.1', () => {
            const addr = server.address() as { port: number };
            baseUrl = `http://127.0.0.1:${addr.port}`;
            resolve();
        });
    });
}

async function stopServer(): Promise<void> {
    return new Promise(resolve => server.close(() => resolve()));
}

async function apiGet(path: string): Promise<{ status: number; body: any }> {
    const res = await fetch(`${baseUrl}${path}`);
    const body = await res.json();
    return { status: res.status, body };
}

function fakeEntry(overrides: Partial<LogEntry> = {}): LogEntry {
    return {
        ts: new Date().toISOString(),
        level: 'info',
        msg: 'test message',
        component: 'http',
        ...overrides,
    };
}

// ── Test lifecycle ────────────────────────────────────────────────────────────

beforeEach(async () => {
    clearLogBuffer();
    await startServer();
});

afterEach(async () => {
    await stopServer();
    clearLogBuffer();
});

// ── /api/logs/history ────────────────────────────────────────────────────────

describe('GET /api/logs/history', () => {
    it('returns empty entries when buffer is empty', async () => {
        const { status, body } = await apiGet('/api/logs/history');
        expect(status).toBe(200);
        expect(body.entries).toEqual([]);
        expect(body.total).toBe(0);
    });

    it('returns buffered entries newest-first', async () => {
        captureEntry(fakeEntry({ msg: 'first', ts: '2024-01-01T10:00:00.000Z' }));
        captureEntry(fakeEntry({ msg: 'second', ts: '2024-01-01T10:00:01.000Z' }));
        captureEntry(fakeEntry({ msg: 'third', ts: '2024-01-01T10:00:02.000Z' }));

        const { status, body } = await apiGet('/api/logs/history');
        expect(status).toBe(200);
        expect(body.entries).toHaveLength(3);
        // Newest-first: third, second, first
        expect(body.entries[0].msg).toBe('third');
        expect(body.entries[1].msg).toBe('second');
        expect(body.entries[2].msg).toBe('first');
    });

    it('filters by minimum level', async () => {
        captureEntry(fakeEntry({ level: 'debug', msg: 'debug-msg' }));
        captureEntry(fakeEntry({ level: 'info', msg: 'info-msg' }));
        captureEntry(fakeEntry({ level: 'warn', msg: 'warn-msg' }));
        captureEntry(fakeEntry({ level: 'error', msg: 'error-msg' }));

        const { body } = await apiGet('/api/logs/history?level=warn');
        expect(body.entries.map((e: any) => e.level).sort()).toEqual(['error', 'warn']);
    });

    it('filters by component', async () => {
        captureEntry(fakeEntry({ component: 'http', msg: 'http-log' }));
        captureEntry(fakeEntry({ component: 'queue', msg: 'queue-log' }));

        const { body } = await apiGet('/api/logs/history?component=http');
        expect(body.entries).toHaveLength(1);
        expect(body.entries[0].component).toBe('http');
    });

    it('respects the limit param', async () => {
        for (let i = 0; i < 10; i++) {
            captureEntry(fakeEntry({ msg: `msg-${i}` }));
        }
        const { body } = await apiGet('/api/logs/history?limit=3');
        expect(body.entries).toHaveLength(3);
    });

    it('caps limit at 1000', async () => {
        // Just verify parsing — we only have a few entries in the buffer
        captureEntry(fakeEntry());
        const { body } = await apiGet('/api/logs/history?limit=99999');
        expect(body.entries).toHaveLength(1); // only 1 entry buffered
    });

    it('filters by before timestamp', async () => {
        captureEntry(fakeEntry({ msg: 'old', ts: '2024-01-01T10:00:00.000Z' }));
        captureEntry(fakeEntry({ msg: 'new', ts: '2024-01-01T10:00:02.000Z' }));

        const { body } = await apiGet('/api/logs/history?before=2024-01-01T10:00:01.000Z');
        expect(body.entries).toHaveLength(1);
        expect(body.entries[0].msg).toBe('old');
    });

    it('filters by search (case-insensitive)', async () => {
        captureEntry(fakeEntry({ msg: 'Token limit exceeded' }));
        captureEntry(fakeEntry({ msg: 'Normal request' }));

        const { body } = await apiGet('/api/logs/history?search=token');
        expect(body.entries).toHaveLength(1);
        expect(body.entries[0].msg).toContain('Token');
    });

    it('returns total count matching entries length', async () => {
        captureEntry(fakeEntry({ level: 'info' }));
        captureEntry(fakeEntry({ level: 'error' }));

        const { body } = await apiGet('/api/logs/history?level=error');
        expect(body.total).toBe(body.entries.length);
        expect(body.total).toBe(1);
    });
});

// ── /api/logs/sources ────────────────────────────────────────────────────────

describe('GET /api/logs/sources', () => {
    it('returns in-process source by default', async () => {
        const { status, body } = await apiGet('/api/logs/sources');
        expect(status).toBe(200);
        expect(body.sources).toBeInstanceOf(Array);
        const inProc = body.sources.find((s: any) => s.id === 'in-process');
        expect(inProc).toBeDefined();
        expect(inProc.active).toBe(true);
        expect(body.logDir).toBeNull();
    });

    it('includes file sources when logDir is provided', async () => {
        await stopServer();
        await startServer('/tmp/test-logs');

        const { body } = await apiGet('/api/logs/sources');
        expect(body.logDir).toBe('/tmp/test-logs');
        const ids = body.sources.map((s: any) => s.id);
        expect(ids).toContain('coc-service');
        expect(ids).toContain('ai-service');
    });
});

// ── Server log capture: buildLogEntry ────────────────────────────────────────

describe('server-log-capture: buildLogEntry', () => {
    it('handles string-only call form', () => {
        const entry = buildLogEntry(30, {}, ['hello world']);
        expect(entry?.msg).toBe('hello world');
        expect(entry?.level).toBe('info');
    });

    it('handles object + string call form', () => {
        const entry = buildLogEntry(40, {}, [{ requestId: 'abc' }, 'request failed']);
        expect(entry?.msg).toBe('request failed');
        expect(entry?.level).toBe('warn');
        expect((entry as any)?.requestId).toBe('abc');
    });

    it('propagates component from bindings', () => {
        const entry = buildLogEntry(30, { component: 'http' }, ['GET /api']);
        expect(entry?.component).toBe('http');
    });

    it('returns null for empty args', () => {
        expect(buildLogEntry(30, {}, [])).toBeNull();
    });

    it('numToLevel maps correctly', () => {
        expect(numToLevel(10)).toBe('trace');
        expect(numToLevel(20)).toBe('debug');
        expect(numToLevel(30)).toBe('info');
        expect(numToLevel(40)).toBe('warn');
        expect(numToLevel(50)).toBe('error');
        expect(numToLevel(60)).toBe('fatal');
        expect(numToLevel(99)).toBe('info'); // fallback
    });
});

// ── captureEntry + getLogHistory integration ──────────────────────────────────

describe('captureEntry + getLogHistory', () => {
    beforeEach(() => clearLogBuffer());
    afterEach(() => clearLogBuffer());

    it('captured entries appear in history', () => {
        captureEntry(fakeEntry({ msg: 'hello', level: 'info' }));
        const history = getLogHistory();
        expect(history.some((e: LogEntry) => e.msg === 'hello')).toBe(true);
    });

    it('history is newest-first', () => {
        captureEntry(fakeEntry({ msg: 'a', ts: '2024-01-01T10:00:00.000Z' }));
        captureEntry(fakeEntry({ msg: 'b', ts: '2024-01-01T10:00:01.000Z' }));
        const history = getLogHistory();
        expect(history[0].msg).toBe('b');
        expect(history[1].msg).toBe('a');
    });

    it('limit controls max entries returned', () => {
        for (let i = 0; i < 20; i++) captureEntry(fakeEntry({ msg: `m${i}` }));
        const history = getLogHistory({ limit: 5 });
        expect(history).toHaveLength(5);
    });
});
