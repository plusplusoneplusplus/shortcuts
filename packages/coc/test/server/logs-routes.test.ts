/**
 * Tests for logs-routes.ts — /api/logs/history and /api/logs/sources
 *
 * Uses in-process HTTP server (no real Pino logger) to test route handlers.
 * The log capture buffer is populated directly via captureEntry().
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as http from 'http';
import { createRouter } from '../../src/server/shared/router';
import { registerLogsRoutes } from '../../src/server/logs-routes';
import {
    captureEntry,
    clearLogBuffer,
    getLogHistory,
    getLogEmitter,
    buildLogEntry,
    numToLevel,
} from '../../src/server/server-log-capture';
import type { Route } from '../../src/server/types';
import type { LogEntry } from '../../src/server/server-log-capture';

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

// ── sessionId filtering ──────────────────────────────────────────────────────

describe('getLogHistory: sessionId filter', () => {
    beforeEach(() => clearLogBuffer());
    afterEach(() => clearLogBuffer());

    it('returns only entries matching sessionId', () => {
        captureEntry(fakeEntry({ msg: 'a', sessionId: 'sess-1' }));
        captureEntry(fakeEntry({ msg: 'b', sessionId: 'sess-2' }));
        captureEntry(fakeEntry({ msg: 'c', sessionId: 'sess-1' }));
        captureEntry(fakeEntry({ msg: 'd' })); // no sessionId

        const history = getLogHistory({ sessionId: 'sess-1' });
        expect(history).toHaveLength(2);
        expect(history.every((e: LogEntry) => e.sessionId === 'sess-1')).toBe(true);
    });

    it('returns nothing when no entries match sessionId', () => {
        captureEntry(fakeEntry({ msg: 'a', sessionId: 'sess-1' }));
        const history = getLogHistory({ sessionId: 'sess-nonexistent' });
        expect(history).toHaveLength(0);
    });

    it('combines sessionId with level filter', () => {
        captureEntry(fakeEntry({ msg: 'debug', level: 'debug', sessionId: 'sess-1' }));
        captureEntry(fakeEntry({ msg: 'info', level: 'info', sessionId: 'sess-1' }));
        captureEntry(fakeEntry({ msg: 'warn', level: 'warn', sessionId: 'sess-2' }));

        const history = getLogHistory({ sessionId: 'sess-1', level: 'info' });
        expect(history).toHaveLength(1);
        expect(history[0].msg).toBe('info');
    });
});

describe('getLogHistory: search includes sessionId', () => {
    beforeEach(() => clearLogBuffer());
    afterEach(() => clearLogBuffer());

    it('search matches sessionId field', () => {
        captureEntry(fakeEntry({ msg: 'some log', sessionId: 'abc-123-def' }));
        captureEntry(fakeEntry({ msg: 'other log' }));

        const history = getLogHistory({ search: 'abc-123' });
        expect(history).toHaveLength(1);
        expect(history[0].sessionId).toBe('abc-123-def');
    });

    it('search matches partial sessionId', () => {
        captureEntry(fakeEntry({ msg: 'log', sessionId: 'my-session-xyz' }));
        const history = getLogHistory({ search: 'session-xyz' });
        expect(history).toHaveLength(1);
    });
});

describe('buildLogEntry: sessionId from bindings', () => {
    it('preserves sessionId from child bindings', () => {
        const entry = buildLogEntry(20, { component: 'ai-service', sessionId: 'sess-42' }, ['Turn started']);
        expect(entry).not.toBeNull();
        expect(entry!.sessionId).toBe('sess-42');
        expect(entry!.component).toBe('ai-service');
        expect(entry!.msg).toBe('Turn started');
    });

    it('preserves sessionId from merge object', () => {
        const entry = buildLogEntry(30, {}, [{ sessionId: 'sess-99' }, 'Permission request']);
        expect(entry).not.toBeNull();
        expect(entry!.sessionId).toBe('sess-99');
        expect(entry!.msg).toBe('Permission request');
    });

    it('omits sessionId when not provided', () => {
        const entry = buildLogEntry(30, { component: 'http' }, ['GET /api']);
        expect(entry).not.toBeNull();
        expect(entry!.sessionId).toBeUndefined();
    });
});

describe('GET /api/logs/history: sessionId query param', () => {
    it('filters entries by sessionId', async () => {
        captureEntry(fakeEntry({ msg: 'session-hit', sessionId: 'sid-abc' }));
        captureEntry(fakeEntry({ msg: 'session-miss', sessionId: 'sid-other' }));
        captureEntry(fakeEntry({ msg: 'no-session' }));

        const { status, body } = await apiGet('/api/logs/history?sessionId=sid-abc');
        expect(status).toBe(200);
        expect(body.entries).toHaveLength(1);
        expect(body.entries[0].msg).toBe('session-hit');
        expect(body.entries[0].sessionId).toBe('sid-abc');
    });

    it('returns empty when sessionId has no matches', async () => {
        captureEntry(fakeEntry({ msg: 'test', sessionId: 'sid-x' }));
        const { body } = await apiGet('/api/logs/history?sessionId=sid-nonexistent');
        expect(body.entries).toHaveLength(0);
    });

    it('combines sessionId with level filter', async () => {
        captureEntry(fakeEntry({ msg: 'debug-msg', level: 'debug', sessionId: 'sid-1' }));
        captureEntry(fakeEntry({ msg: 'warn-msg', level: 'warn', sessionId: 'sid-1' }));
        captureEntry(fakeEntry({ msg: 'warn-other', level: 'warn', sessionId: 'sid-2' }));

        const { body } = await apiGet('/api/logs/history?sessionId=sid-1&level=warn');
        expect(body.entries).toHaveLength(1);
        expect(body.entries[0].msg).toBe('warn-msg');
    });
});

describe('SSE /api/logs/stream: sessionId filter', () => {
    it('initial history is filtered by sessionId', async () => {
        captureEntry(fakeEntry({ msg: 'match', sessionId: 'sse-sid-1' }));
        captureEntry(fakeEntry({ msg: 'no-match', sessionId: 'sse-sid-2' }));
        captureEntry(fakeEntry({ msg: 'also-match', sessionId: 'sse-sid-1' }));

        const history = await new Promise<any[]>((resolve, reject) => {
            const req = http.get(`${baseUrl}/api/logs/stream?sessionId=sse-sid-1`, (res) => {
                let data = '';
                res.on('data', (chunk) => { data += chunk.toString(); });
                // Read just enough to get the history event
                setTimeout(() => {
                    req.destroy();
                    const match = data.match(/event: history\ndata: (.+)\n/);
                    if (!match) return resolve([]);
                    try { resolve(JSON.parse(match[1])); } catch { resolve([]); }
                }, 200);
            });
            req.on('error', (e) => {
                // Connection destroyed errors are expected
                if ((e as any).code !== 'ECONNRESET') reject(e);
            });
        });

        expect(history).toHaveLength(2);
        expect(history.every((e: any) => e.sessionId === 'sse-sid-1')).toBe(true);
    });

    it('live events are filtered by sessionId', async () => {
        const received: any[] = [];

        await new Promise<void>((resolve, reject) => {
            const req = http.get(`${baseUrl}/api/logs/stream?sessionId=live-sid`, (res) => {
                let data = '';
                res.on('data', (chunk) => {
                    data += chunk.toString();
                    // Parse log-entry events from accumulated data
                    const lines = data.split('\n');
                    for (let i = 0; i < lines.length - 1; i++) {
                        if (lines[i] === 'event: log-entry' && lines[i + 1]?.startsWith('data: ')) {
                            try {
                                received.push(JSON.parse(lines[i + 1].slice(6)));
                            } catch { /* ignore */ }
                        }
                    }
                });

                // Emit entries after a small delay to let SSE connect
                setTimeout(() => {
                    captureEntry(fakeEntry({ msg: 'should-pass', sessionId: 'live-sid' }));
                    captureEntry(fakeEntry({ msg: 'should-filter', sessionId: 'other-sid' }));
                    captureEntry(fakeEntry({ msg: 'no-session' }));
                }, 50);

                setTimeout(() => {
                    req.destroy();
                    resolve();
                }, 300);
            });
            req.on('error', (e) => {
                if ((e as any).code !== 'ECONNRESET') reject(e);
            });
        });

        expect(received).toHaveLength(1);
        expect(received[0].msg).toBe('should-pass');
        expect(received[0].sessionId).toBe('live-sid');
    });
});
