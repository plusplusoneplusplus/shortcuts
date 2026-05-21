/**
 * Sync Handler Tests
 *
 * Unit tests for the per-workspace sync REST routes:
 *   GET  /api/workspaces/:workspaceId/sync/status   — current sync status
 *   POST /api/workspaces/:workspaceId/sync/trigger  — force an immediate sync
 */

import { describe, it, expect, vi } from 'vitest';
import { registerSyncRoutes } from '../../src/server/sync/sync-handler';
import type { Route } from '../../src/server/types';
import type { SyncEngine } from '../../src/server/sync/sync-engine';
import type { SyncStatus } from '../../src/server/sync/sync-engine';
import type { PerRepoPreferences } from '../../src/server/preferences-handler';
import type { IncomingMessage, ServerResponse } from 'http';

// ── Helpers ──────────────────────────────────────────────────────────────────

function createMockRes() {
    const res = {
        writeHead: vi.fn(),
        end: vi.fn(),
    } as unknown as ServerResponse;
    return res;
}

function createMockReq(method = 'GET') {
    return { method } as IncomingMessage;
}

/** Find a route by method and matching a sample URL against its regex pattern. */
function findRoute(routes: Route[], method: string, url: string): { route: Route; match: RegExpMatchArray } | undefined {
    for (const r of routes) {
        if (r.method !== method) continue;
        if (r.pattern instanceof RegExp) {
            const m = url.match(r.pattern);
            if (m) return { route: r, match: m };
        } else if (r.pattern === url) {
            return { route: r, match: [url] as unknown as RegExpMatchArray };
        }
    }
    return undefined;
}

const WORKSPACE_ID = 'my_work';
const STATUS_URL = `/api/workspaces/${WORKSPACE_ID}/sync/status`;
const TRIGGER_URL = `/api/workspaces/${WORKSPACE_ID}/sync/trigger`;

// ── Tests ────────────────────────────────────────────────────────────────────

describe('registerSyncRoutes', () => {
    it('registers GET status and POST trigger routes', () => {
        const routes: Route[] = [];
        registerSyncRoutes(routes, () => undefined, () => undefined);

        expect(findRoute(routes, 'GET', STATUS_URL)).toBeDefined();
        expect(findRoute(routes, 'POST', TRIGGER_URL)).toBeDefined();
    });

    describe('GET /api/workspaces/:workspaceId/sync/status', () => {
        it('returns disabled status when no engine', async () => {
            const routes: Route[] = [];
            registerSyncRoutes(routes, () => undefined, () => undefined);

            const found = findRoute(routes, 'GET', STATUS_URL)!;
            const res = createMockRes();
            await found.route.handler(createMockReq(), res, found.match);

            expect(res.writeHead).toHaveBeenCalledWith(200, { 'Content-Type': 'application/json' });
            const body = JSON.parse((res.end as any).mock.calls[0][0]);
            expect(body.enabled).toBe(false);
            expect(body.inProgress).toBe(false);
            expect(body.lastSyncTime).toBeNull();
            expect(body.lastError).toBeNull();
        });

        it('returns engine status when engine exists', async () => {
            const mockStatus: SyncStatus = {
                enabled: true,
                inProgress: false,
                lastSyncTime: '2026-01-01T00:00:00.000Z',
                lastError: null,
            };
            const mockEngine = {
                getStatus: vi.fn().mockReturnValue(mockStatus),
            } as unknown as SyncEngine;

            const routes: Route[] = [];
            registerSyncRoutes(routes, () => mockEngine, () => ({ sync: { gitRemote: 'git@github.com:user/notes.git' } }));

            const found = findRoute(routes, 'GET', STATUS_URL)!;
            const res = createMockRes();
            await found.route.handler(createMockReq(), res, found.match);

            const body = JSON.parse((res.end as any).mock.calls[0][0]);
            expect(body.enabled).toBe(true);
            expect(body.lastSyncTime).toBe('2026-01-01T00:00:00.000Z');
        });

        it('returns 404 for invalid workspace', async () => {
            const routes: Route[] = [];
            registerSyncRoutes(routes, () => undefined, () => undefined);

            const found = findRoute(routes, 'GET', '/api/workspaces/invalid_ws/sync/status')!;
            const res = createMockRes();
            await found.route.handler(createMockReq(), res, found.match);

            expect(res.writeHead).toHaveBeenCalledWith(404, { 'Content-Type': 'application/json' });
        });
    });

    describe('POST /api/workspaces/:workspaceId/sync/trigger', () => {
        it('returns 400 when no engine', async () => {
            const routes: Route[] = [];
            registerSyncRoutes(routes, () => undefined, () => undefined);

            const found = findRoute(routes, 'POST', TRIGGER_URL)!;
            const res = createMockRes();
            await found.route.handler(createMockReq('POST'), res, found.match);

            expect(res.writeHead).toHaveBeenCalledWith(400, { 'Content-Type': 'application/json' });
            const body = JSON.parse((res.end as any).mock.calls[0][0]);
            expect(body.error).toBe('Sync is not configured');
        });

        it('returns 400 when prefs have no gitRemote', async () => {
            const mockEngine = {} as unknown as SyncEngine;
            const routes: Route[] = [];
            registerSyncRoutes(routes, () => mockEngine, () => ({} as PerRepoPreferences));

            const found = findRoute(routes, 'POST', TRIGGER_URL)!;
            const res = createMockRes();
            await found.route.handler(createMockReq('POST'), res, found.match);

            expect(res.writeHead).toHaveBeenCalledWith(400, { 'Content-Type': 'application/json' });
        });

        it('triggers sync and returns status on success', async () => {
            const resultStatus: SyncStatus = {
                enabled: true,
                inProgress: false,
                lastSyncTime: '2026-01-01T00:00:00.000Z',
                lastError: null,
            };
            const mockEngine = {
                triggerSync: vi.fn().mockResolvedValue(resultStatus),
            } as unknown as SyncEngine;

            const prefs: PerRepoPreferences = {
                sync: { gitRemote: 'git@github.com:user/notes.git', intervalMinutes: 5 },
            } as PerRepoPreferences;

            const routes: Route[] = [];
            registerSyncRoutes(routes, () => mockEngine, () => prefs);

            const found = findRoute(routes, 'POST', TRIGGER_URL)!;
            const res = createMockRes();
            await found.route.handler(createMockReq('POST'), res, found.match);

            expect(mockEngine.triggerSync).toHaveBeenCalledWith('git@github.com:user/notes.git');
            expect(res.writeHead).toHaveBeenCalledWith(200, { 'Content-Type': 'application/json' });
            const body = JSON.parse((res.end as any).mock.calls[0][0]);
            expect(body.lastSyncTime).toBe('2026-01-01T00:00:00.000Z');
        });

        it('returns 500 when triggerSync throws', async () => {
            const mockEngine = {
                triggerSync: vi.fn().mockRejectedValue(new Error('Git push failed')),
            } as unknown as SyncEngine;

            const prefs: PerRepoPreferences = {
                sync: { gitRemote: 'git@github.com:user/notes.git', intervalMinutes: 5 },
            } as PerRepoPreferences;

            const routes: Route[] = [];
            registerSyncRoutes(routes, () => mockEngine, () => prefs);

            const found = findRoute(routes, 'POST', TRIGGER_URL)!;
            const res = createMockRes();
            await found.route.handler(createMockReq('POST'), res, found.match);

            expect(res.writeHead).toHaveBeenCalledWith(500, { 'Content-Type': 'application/json' });
            const body = JSON.parse((res.end as any).mock.calls[0][0]);
            expect(body.error).toBe('Git push failed');
        });

        it('returns 404 for invalid workspace', async () => {
            const routes: Route[] = [];
            registerSyncRoutes(routes, () => undefined, () => undefined);

            const found = findRoute(routes, 'POST', '/api/workspaces/invalid_ws/sync/trigger')!;
            const res = createMockRes();
            await found.route.handler(createMockReq('POST'), res, found.match);

            expect(res.writeHead).toHaveBeenCalledWith(404, { 'Content-Type': 'application/json' });
        });
    });
});
