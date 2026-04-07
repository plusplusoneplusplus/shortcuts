/**
 * Tests for terminal/terminal-routes.ts
 *
 * Verifies REST endpoints:
 * - GET /api/terminal/status (disabled & enabled)
 * - GET /api/workspaces/:id/terminals (list sessions, unknown workspace)
 * - DELETE /api/workspaces/:id/terminals/:sessionId (kill, not found, unknown workspace)
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
    sessions?: Array<{ id: string; workspaceId: string; cols: number; rows: number; createdAt: number; lastActivity: number; pty: { pid: number } }>;
    destroyResult?: boolean;
}): TerminalSessionManager {
    const sessions = options?.sessions ?? [];
    return {
        getSessionsByWorkspace: vi.fn((wsId: string) =>
            sessions.filter(s => s.workspaceId === wsId),
        ),
        destroySession: vi.fn(() => options?.destroyResult ?? true),
        destroyAll: vi.fn(),
        size: sessions.length,
        isAvailable: vi.fn().mockReturnValue(true),
    } as unknown as TerminalSessionManager;
}

function makeSession(overrides?: Partial<{ id: string; workspaceId: string; cols: number; rows: number; createdAt: number; lastActivity: number }>) {
    return {
        id: overrides?.id ?? 'sess-1',
        workspaceId: overrides?.workspaceId ?? WORKSPACE.id,
        cols: overrides?.cols ?? 80,
        rows: overrides?.rows ?? 24,
        createdAt: overrides?.createdAt ?? 1000,
        lastActivity: overrides?.lastActivity ?? 2000,
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

async function apiGet(path: string): Promise<{ status: number; body: any }> {
    const res = await fetch(`${baseUrl}${path}`);
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
});
