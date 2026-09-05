/**
 * Verifies REST endpoints:
 * - GET /api/terminal/status (disabled & enabled)
 * - GET /api/workspaces/:id/terminals (list sessions, unknown workspace)
 * - DELETE /api/workspaces/:id/terminals/:sessionId (kill, not found, unknown workspace)
 * - POST /api/workspaces/:id/terminals/:sessionId/restart (respawn, 409, not found)
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
import { TerminalSessionRunningError } from '../../../src/server/terminal/terminal-session-manager';

// ── Helpers ───────────────────────────────────────────────────────────────────

const WORKSPACE = { id: 'ws-test-1', name: 'Test Workspace', rootPath: '/tmp/test-ws' };

function makeConfig(terminalEnabled: boolean): ResolvedCLIConfig {
    return {
        terminal: { enabled: terminalEnabled },
    } as unknown as ResolvedCLIConfig;
}

type MockSession = ReturnType<typeof makeSession>;

function makeMockSessionManager(options?: {
    sessions?: MockSession[];
    destroyResult?: boolean;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    restartSession?: (...args: any[]) => any;
}): TerminalSessionManager {
    const sessions = options?.sessions ?? [];
    return {
        getSessionsByWorkspace: vi.fn((wsId: string) =>
            sessions.filter(s => s.workspaceId === wsId),
        ),
        getSession: vi.fn((id: string) => sessions.find(s => s.id === id)),
        hydrateWorkspace: vi.fn(),
        restartSession: vi.fn(options?.restartSession ?? (() => ({
            session: makeSession({ id: 'sess-restarted' }),
            cwdFallback: false,
        }))),
        destroySession: vi.fn(() => options?.destroyResult ?? true),
        destroyAll: vi.fn(),
        size: sessions.length,
        liveSize: sessions.filter(s => s.status === 'running').length,
        isAvailable: vi.fn().mockReturnValue(true),
    } as unknown as TerminalSessionManager;
}

function makeSession(overrides?: Partial<{
    id: string; workspaceId: string; cols: number; rows: number;
    createdAt: number; lastActivity: number; status: 'running' | 'exited';
    cwd: string; title: string; exitedAt: number; exitCode: number;
}>) {
    const status = overrides?.status ?? 'running';
    return {
        id: overrides?.id ?? 'sess-1',
        workspaceId: overrides?.workspaceId ?? WORKSPACE.id,
        cols: overrides?.cols ?? 80,
        rows: overrides?.rows ?? 24,
        createdAt: overrides?.createdAt ?? 1000,
        lastActivity: overrides?.lastActivity ?? 2000,
        status,
        cwd: overrides?.cwd ?? '/tmp/test-ws',
        title: overrides?.title ?? 'bash',
        exitedAt: overrides?.exitedAt,
        exitCode: overrides?.exitCode,
        pty: status === 'running' ? { pid: 12345 } : null,
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

async function apiGet(path: string): Promise<{ status: number; body: any }> {
    const res = await fetch(`${baseUrl}${path}`);
    const text = await res.text();
    return { status: res.status, body: text ? JSON.parse(text) : null };
}

async function apiPost(path: string): Promise<{ status: number; body: any }> {
    const res = await fetch(`${baseUrl}${path}`, { method: 'POST' });
    const text = await res.text();
    return { status: res.status, body: text ? JSON.parse(text) : null };
}

async function apiDelete(path: string): Promise<{ status: number; body: any }> {
    const res = await fetch(`${baseUrl}${path}`, { method: 'DELETE' });
    const text = await res.text();
    return { status: res.status, body: text ? JSON.parse(text) : null };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('Terminal REST Routes', () => {
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

    // ── GET /api/terminal/status ──────────────────────────────────────────

    describe('GET /api/terminal/status', () => {
        it('returns disabled status when manager is undefined', async () => {
            server = createTestServer(store, () => undefined, makeConfig(false));
            await startServer(server);

            const { status, body } = await apiGet('/api/terminal/status');
            expect(status).toBe(200);
            expect(body).toEqual({
                enabled: false,
                nodePtyAvailable: false,
                activeSessions: 0,
            });
        });

        it('returns enabled status with active session count', async () => {
            const mgr = makeMockSessionManager({
                sessions: [makeSession(), makeSession({ id: 'sess-2' })],
            });
            server = createTestServer(store, () => mgr, makeConfig(true));
            await startServer(server);

            const { status, body } = await apiGet('/api/terminal/status');
            expect(status).toBe(200);
            expect(body).toEqual({
                enabled: true,
                nodePtyAvailable: true,
                activeSessions: 2,
            });
        });

        it('returns config enabled but node-pty unavailable when no manager', async () => {
            server = createTestServer(store, () => undefined, makeConfig(true));
            await startServer(server);

            const { status, body } = await apiGet('/api/terminal/status');
            expect(status).toBe(200);
            expect(body).toEqual({
                enabled: true,
                nodePtyAvailable: false,
                activeSessions: 0,
            });
        });
    });

    // ── GET /api/workspaces/:id/terminals ─────────────────────────────────

    describe('GET /api/workspaces/:id/terminals', () => {
        it('returns session list for workspace', async () => {
            const sessions = [
                makeSession({ id: 'sess-a' }),
                makeSession({ id: 'sess-b' }),
            ];
            const mgr = makeMockSessionManager({ sessions });
            server = createTestServer(store, () => mgr, makeConfig(true));
            await startServer(server);

            const { status, body } = await apiGet(`/api/workspaces/${WORKSPACE.id}/terminals`);
            expect(status).toBe(200);
            expect(body.sessions).toHaveLength(2);
            expect(body.sessions[0]).toHaveProperty('id', 'sess-a');
            expect(body.sessions[0]).toHaveProperty('workspaceId', WORKSPACE.id);
            expect(body.sessions[0]).toHaveProperty('cols', 80);
            expect(body.sessions[0]).toHaveProperty('rows', 24);
            expect(body.sessions[0]).toHaveProperty('createdAt');
            expect(body.sessions[0]).toHaveProperty('lastActivity');
            expect(body.sessions[0]).toHaveProperty('pid');
        });

        it('returns empty sessions when manager is undefined', async () => {
            server = createTestServer(store, () => undefined, makeConfig(false));
            await startServer(server);

            const { status, body } = await apiGet(`/api/workspaces/${WORKSPACE.id}/terminals`);
            expect(status).toBe(200);
            expect(body.sessions).toEqual([]);
        });

        it('returns 404 for unknown workspace', async () => {
            const mgr = makeMockSessionManager();
            server = createTestServer(store, () => mgr, makeConfig(true));
            await startServer(server);

            const { status, body } = await apiGet('/api/workspaces/nonexistent-ws/terminals');
            expect(status).toBe(404);
            expect(body.error).toContain('not found');
        });
    });

    // ── DELETE /api/workspaces/:id/terminals/:sessionId ───────────────────

    describe('DELETE /api/workspaces/:id/terminals/:sessionId', () => {
        it('kills session and returns 204', async () => {
            const mgr = makeMockSessionManager({ destroyResult: true });
            server = createTestServer(store, () => mgr, makeConfig(true));
            await startServer(server);

            const { status } = await apiDelete(`/api/workspaces/${WORKSPACE.id}/terminals/sess-1`);
            expect(status).toBe(204);
            expect(mgr.destroySession).toHaveBeenCalledWith('sess-1');
        });

        it('returns 404 for unknown session', async () => {
            const mgr = makeMockSessionManager({ destroyResult: false });
            server = createTestServer(store, () => mgr, makeConfig(true));
            await startServer(server);

            const { status, body } = await apiDelete(`/api/workspaces/${WORKSPACE.id}/terminals/no-such-session`);
            expect(status).toBe(404);
            expect(body.error).toContain('Terminal session');
        });

        it('returns 404 for unknown workspace', async () => {
            const mgr = makeMockSessionManager();
            server = createTestServer(store, () => mgr, makeConfig(true));
            await startServer(server);

            const { status, body } = await apiDelete('/api/workspaces/nonexistent-ws/terminals/sess-1');
            expect(status).toBe(404);
            expect(body.error).toContain('not found');
        });

        it('returns 404 when manager is undefined', async () => {
            server = createTestServer(store, () => undefined, makeConfig(false));
            await startServer(server);

            const { status, body } = await apiDelete(`/api/workspaces/${WORKSPACE.id}/terminals/sess-1`);
            expect(status).toBe(404);
            expect(body.error).toContain('Terminal session');
        });
    });

    // ── POST /api/workspaces/:id/terminals/:sessionId/restart ─────────────

    describe('POST /api/workspaces/:id/terminals/:sessionId/restart', () => {
        it('respawns an exited session and returns the new session info', async () => {
            const exited = makeSession({ id: 'sess-dead', status: 'exited', exitedAt: 5000, exitCode: 0 });
            const mgr = makeMockSessionManager({ sessions: [exited] });
            server = createTestServer(store, () => mgr, makeConfig(true));
            await startServer(server);

            const { status, body } = await apiPost(`/api/workspaces/${WORKSPACE.id}/terminals/sess-dead/restart`);
            expect(status).toBe(200);
            expect(body.session.id).toBe('sess-restarted');
            expect(body.session.status).toBe('running');
            expect(body.cwdFallback).toBe(false);
            expect(mgr.restartSession).toHaveBeenCalledWith('sess-dead', WORKSPACE.rootPath);
        });

        it('reports the workspace-root fallback when the recorded cwd is gone', async () => {
            const exited = makeSession({ id: 'sess-dead', status: 'exited' });
            const mgr = makeMockSessionManager({
                sessions: [exited],
                restartSession: () => ({ session: makeSession({ id: 'sess-new' }), cwdFallback: true }),
            });
            server = createTestServer(store, () => mgr, makeConfig(true));
            await startServer(server);

            const { status, body } = await apiPost(`/api/workspaces/${WORKSPACE.id}/terminals/sess-dead/restart`);
            expect(status).toBe(200);
            expect(body.cwdFallback).toBe(true);
            expect(body.notice).toContain(WORKSPACE.rootPath);
        });

        it('returns 409 when the session is still running', async () => {
            const live = makeSession({ id: 'sess-live' });
            const mgr = makeMockSessionManager({
                sessions: [live],
                restartSession: () => { throw new TerminalSessionRunningError('sess-live'); },
            });
            server = createTestServer(store, () => mgr, makeConfig(true));
            await startServer(server);

            const { status, body } = await apiPost(`/api/workspaces/${WORKSPACE.id}/terminals/sess-live/restart`);
            expect(status).toBe(409);
            expect(body.error).toContain('still running');
        });

        it('returns 500 with the create-path error when node-pty is unavailable', async () => {
            const exited = makeSession({ id: 'sess-dead', status: 'exited' });
            const mgr = makeMockSessionManager({
                sessions: [exited],
                restartSession: () => { throw new Error('Terminal is not available: node-pty not installed'); },
            });
            server = createTestServer(store, () => mgr, makeConfig(true));
            await startServer(server);

            const { status, body } = await apiPost(`/api/workspaces/${WORKSPACE.id}/terminals/sess-dead/restart`);
            expect(status).toBe(500);
            expect(body.error).toContain('node-pty');
        });

        it('returns 404 for an unknown session', async () => {
            const mgr = makeMockSessionManager({ sessions: [] });
            server = createTestServer(store, () => mgr, makeConfig(true));
            await startServer(server);

            const { status, body } = await apiPost(`/api/workspaces/${WORKSPACE.id}/terminals/nope/restart`);
            expect(status).toBe(404);
            expect(body.error).toContain('Terminal session');
        });

        it('returns 404 when manager is undefined', async () => {
            server = createTestServer(store, () => undefined, makeConfig(false));
            await startServer(server);

            const { status, body } = await apiPost(`/api/workspaces/${WORKSPACE.id}/terminals/sess-1/restart`);
            expect(status).toBe(404);
            expect(body.error).toContain('Terminal session');
        });
    });
});
