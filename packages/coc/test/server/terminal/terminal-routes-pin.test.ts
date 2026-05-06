/**
 * Tests for PATCH /api/workspaces/:id/terminals/:sessionId/pin
 *
 * Covers:
 * - Pin and unpin via REST
 * - Invalid body
 * - Unknown session
 * - Manager not available
 * - GET /api/workspaces/:id/terminals returns pinned field
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as http from 'http';
import type { AddressInfo } from 'net';
import { createRouter } from '../../../src/server/shared/router';
import { registerTerminalRoutes } from '../../../src/server/terminal/terminal-routes';
import type { Route } from '../../../src/server/types';
import type { ProcessStore } from '@plusplusoneplusplus/forge';
import type { ResolvedCLIConfig } from '../../../src/config';
import type { TerminalSessionManager } from '../../../src/server/terminal/terminal-session-manager';
import { createMockProcessStore } from '../../helpers/mock-process-store';

// ── Helpers ───────────────────────────────────────────────────────────────────

const WORKSPACE = { id: 'ws-test-1', name: 'Test Workspace', rootPath: '/tmp/test-ws' };

function makeConfig(terminalEnabled: boolean): ResolvedCLIConfig {
    return {
        terminal: { enabled: terminalEnabled },
    } as unknown as ResolvedCLIConfig;
}

function makeMockSessionManager(options?: {
    sessions?: Array<{ id: string; workspaceId: string; cols: number; rows: number; createdAt: number; lastActivity: number; pinned: boolean; pty: { pid: number } }>;
    pinResult?: boolean;
    unpinResult?: boolean;
}): TerminalSessionManager {
    const sessions = options?.sessions ?? [];
    return {
        getSessionsByWorkspace: vi.fn((wsId: string) =>
            sessions.filter(s => s.workspaceId === wsId),
        ),
        getSession: vi.fn((id: string) => sessions.find(s => s.id === id)),
        pinSession: vi.fn(() => options?.pinResult ?? true),
        unpinSession: vi.fn(() => options?.unpinResult ?? true),
        destroySession: vi.fn(() => true),
        destroyAll: vi.fn(),
        size: sessions.length,
        isAvailable: vi.fn().mockReturnValue(true),
    } as unknown as TerminalSessionManager;
}

function makeSession(overrides?: Partial<{ id: string; workspaceId: string; pinned: boolean }>) {
    return {
        id: overrides?.id ?? 'sess-1',
        workspaceId: overrides?.workspaceId ?? WORKSPACE.id,
        cols: 80,
        rows: 24,
        createdAt: 1000,
        lastActivity: 2000,
        pinned: overrides?.pinned ?? false,
        pty: { pid: 12345 },
    };
}

// ── HTTP Server Setup ─────────────────────────────────────────────────────────

let server: http.Server;
let baseUrl: string;

function createTestServer(
    store: ProcessStore,
    getTerminalSessionManager: () => TerminalSessionManager | undefined,
    resolvedConfig?: ResolvedCLIConfig,
): http.Server {
    const routes: Route[] = [];
    registerTerminalRoutes(routes, store, getTerminalSessionManager, resolvedConfig);
    const handler = createRouter({ routes, spaHtml: '' });
    return http.createServer(handler);
}

async function startServer(srv: http.Server): Promise<void> {
    return new Promise((resolve, reject) => {
        srv.on('error', reject);
        srv.listen(0, '127.0.0.1', () => {
            const addr = srv.address() as AddressInfo;
            baseUrl = `http://127.0.0.1:${addr.port}`;
            resolve();
        });
    });
}

async function stopServer(srv: http.Server): Promise<void> {
    return new Promise(resolve => srv.close(() => resolve()));
}

async function apiPatch(path: string, body: any): Promise<{ status: number; body: any }> {
    const res = await fetch(`${baseUrl}${path}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
    });
    const text = await res.text();
    return { status: res.status, body: text ? JSON.parse(text) : null };
}

async function apiPatchRaw(path: string, body: string): Promise<{ status: number; body: any }> {
    const res = await fetch(`${baseUrl}${path}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body,
    });
    const text = await res.text();
    return { status: res.status, body: text ? JSON.parse(text) : null };
}

async function apiGet(path: string): Promise<{ status: number; body: any }> {
    const res = await fetch(`${baseUrl}${path}`);
    const text = await res.text();
    return { status: res.status, body: text ? JSON.parse(text) : null };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('Terminal Pin REST Routes', () => {
    let store: ReturnType<typeof createMockProcessStore>;

    beforeEach(() => {
        store = createMockProcessStore();
        (store.getWorkspaces as ReturnType<typeof vi.fn>).mockResolvedValue([WORKSPACE]);
    });

    afterEach(async () => {
        if (server) {
            await stopServer(server);
        }
    });

    describe('PATCH /api/workspaces/:id/terminals/:sessionId/pin', () => {
        it('pins a session and returns 200', async () => {
            const session = makeSession({ id: 'sess-1', pinned: true });
            const mgr = makeMockSessionManager({ sessions: [session], pinResult: true });
            server = createTestServer(store, () => mgr, makeConfig(true));
            await startServer(server);

            const { status, body } = await apiPatch(
                `/api/workspaces/${WORKSPACE.id}/terminals/sess-1/pin`,
                { pinned: true },
            );
            expect(status).toBe(200);
            expect(body.sessionId).toBe('sess-1');
            expect(body.pinned).toBe(true);
            expect(mgr.pinSession).toHaveBeenCalledWith('sess-1');
        });

        it('unpins a session and returns 200', async () => {
            const session = makeSession({ id: 'sess-1', pinned: false });
            const mgr = makeMockSessionManager({ sessions: [session], unpinResult: true });
            server = createTestServer(store, () => mgr, makeConfig(true));
            await startServer(server);

            const { status, body } = await apiPatch(
                `/api/workspaces/${WORKSPACE.id}/terminals/sess-1/pin`,
                { pinned: false },
            );
            expect(status).toBe(200);
            expect(body.sessionId).toBe('sess-1');
            expect(body.pinned).toBe(false);
            expect(mgr.unpinSession).toHaveBeenCalledWith('sess-1');
        });

        it('returns 400 for missing pinned field', async () => {
            const mgr = makeMockSessionManager();
            server = createTestServer(store, () => mgr, makeConfig(true));
            await startServer(server);

            const { status, body } = await apiPatch(
                `/api/workspaces/${WORKSPACE.id}/terminals/sess-1/pin`,
                { other: 'value' },
            );
            expect(status).toBe(400);
            expect(body.error).toContain('pinned');
        });

        it('returns 400 for invalid JSON', async () => {
            const mgr = makeMockSessionManager();
            server = createTestServer(store, () => mgr, makeConfig(true));
            await startServer(server);

            const { status, body } = await apiPatchRaw(
                `/api/workspaces/${WORKSPACE.id}/terminals/sess-1/pin`,
                '{bad json',
            );
            expect(status).toBe(400);
            expect(body.error).toContain('Invalid JSON');
        });

        it('returns 400 for non-boolean pinned field', async () => {
            const mgr = makeMockSessionManager();
            server = createTestServer(store, () => mgr, makeConfig(true));
            await startServer(server);

            const { status, body } = await apiPatch(
                `/api/workspaces/${WORKSPACE.id}/terminals/sess-1/pin`,
                { pinned: 'yes' },
            );
            expect(status).toBe(400);
            expect(body.error).toContain('pinned');
        });

        it('returns 404 for unknown session', async () => {
            const mgr = makeMockSessionManager({ pinResult: false });
            server = createTestServer(store, () => mgr, makeConfig(true));
            await startServer(server);

            const { status, body } = await apiPatch(
                `/api/workspaces/${WORKSPACE.id}/terminals/no-such/pin`,
                { pinned: true },
            );
            expect(status).toBe(404);
            expect(body.error).toContain('Terminal session');
        });

        it('returns 404 when the session belongs to another workspace', async () => {
            const session = makeSession({ id: 'sess-1', workspaceId: 'ws-other' });
            const mgr = makeMockSessionManager({ sessions: [session], pinResult: true });
            server = createTestServer(store, () => mgr, makeConfig(true));
            await startServer(server);

            const { status, body } = await apiPatch(
                `/api/workspaces/${WORKSPACE.id}/terminals/sess-1/pin`,
                { pinned: true },
            );
            expect(status).toBe(404);
            expect(body.error).toContain('Terminal session');
            expect(mgr.pinSession).not.toHaveBeenCalled();
        });

        it('returns 404 for unknown workspace', async () => {
            const mgr = makeMockSessionManager();
            server = createTestServer(store, () => mgr, makeConfig(true));
            await startServer(server);

            const { status, body } = await apiPatch(
                '/api/workspaces/nonexistent/terminals/sess-1/pin',
                { pinned: true },
            );
            expect(status).toBe(404);
            expect(body.error).toContain('not found');
        });

        it('returns 404 when manager is undefined', async () => {
            server = createTestServer(store, () => undefined, makeConfig(false));
            await startServer(server);

            const { status, body } = await apiPatch(
                `/api/workspaces/${WORKSPACE.id}/terminals/sess-1/pin`,
                { pinned: true },
            );
            expect(status).toBe(404);
            expect(body.error).toContain('Terminal session');
        });
    });

    describe('GET /api/workspaces/:id/terminals includes pinned', () => {
        it('returns pinned field in session list', async () => {
            const sessions = [
                makeSession({ id: 'sess-a', pinned: true }),
                makeSession({ id: 'sess-b', pinned: false }),
            ];
            const mgr = makeMockSessionManager({ sessions });
            server = createTestServer(store, () => mgr, makeConfig(true));
            await startServer(server);

            const { status, body } = await apiGet(`/api/workspaces/${WORKSPACE.id}/terminals`);
            expect(status).toBe(200);
            expect(body.sessions).toHaveLength(2);
            expect(body.sessions.find((s: any) => s.id === 'sess-a').pinned).toBe(true);
            expect(body.sessions.find((s: any) => s.id === 'sess-b').pinned).toBe(false);
        });
    });
});
