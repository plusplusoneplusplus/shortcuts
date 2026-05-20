/**
 * Sync Handler Tests
 *
 * Unit tests for the sync REST routes:
 *   GET  /api/sync/status   — current sync status
 *   POST /api/sync/trigger  — force an immediate sync
 */

import { describe, it, expect, vi } from 'vitest';
import { registerSyncRoutes } from '../../src/server/sync/sync-handler';
import type { Route } from '../../src/server/types';
import type { SyncEngine } from '../../src/server/sync/sync-engine';
import type { SyncStatus } from '../../src/server/sync/sync-engine';
import type { ResolvedCLIConfig } from '../../src/config';
import { DEFAULT_CONFIG } from '../../src/config';
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

function findRoute(routes: Route[], method: string, routePattern: string): Route | undefined {
    return routes.find(r => r.method === method && r.pattern === routePattern);
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('registerSyncRoutes', () => {
    it('registers GET /api/sync/status and POST /api/sync/trigger', () => {
        const routes: Route[] = [];
        registerSyncRoutes(routes, () => undefined, () => undefined);

        expect(findRoute(routes, 'GET', '/api/sync/status')).toBeDefined();
        expect(findRoute(routes, 'POST', '/api/sync/trigger')).toBeDefined();
    });

    describe('GET /api/sync/status', () => {
        it('returns disabled status when no engine', async () => {
            const routes: Route[] = [];
            registerSyncRoutes(routes, () => undefined, () => undefined);

            const route = findRoute(routes, 'GET', '/api/sync/status')!;
            const res = createMockRes();
            await route.handler(createMockReq(), res);

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
            registerSyncRoutes(routes, () => mockEngine, () => DEFAULT_CONFIG);

            const route = findRoute(routes, 'GET', '/api/sync/status')!;
            const res = createMockRes();
            await route.handler(createMockReq(), res);

            const body = JSON.parse((res.end as any).mock.calls[0][0]);
            expect(body.enabled).toBe(true);
            expect(body.lastSyncTime).toBe('2026-01-01T00:00:00.000Z');
        });
    });

    describe('POST /api/sync/trigger', () => {
        it('returns 400 when no engine', async () => {
            const routes: Route[] = [];
            registerSyncRoutes(routes, () => undefined, () => undefined);

            const route = findRoute(routes, 'POST', '/api/sync/trigger')!;
            const res = createMockRes();
            await route.handler(createMockReq('POST'), res);

            expect(res.writeHead).toHaveBeenCalledWith(400, { 'Content-Type': 'application/json' });
            const body = JSON.parse((res.end as any).mock.calls[0][0]);
            expect(body.error).toBe('Sync is not configured');
        });

        it('returns 400 when config has no gitRemote', async () => {
            const mockEngine = {} as unknown as SyncEngine;
            const routes: Route[] = [];
            registerSyncRoutes(routes, () => mockEngine, () => DEFAULT_CONFIG);

            const route = findRoute(routes, 'POST', '/api/sync/trigger')!;
            const res = createMockRes();
            await route.handler(createMockReq('POST'), res);

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

            const config: ResolvedCLIConfig = {
                ...DEFAULT_CONFIG,
                sync: { gitRemote: 'git@github.com:user/notes.git', intervalMinutes: 5 },
            };

            const routes: Route[] = [];
            registerSyncRoutes(routes, () => mockEngine, () => config);

            const route = findRoute(routes, 'POST', '/api/sync/trigger')!;
            const res = createMockRes();
            await route.handler(createMockReq('POST'), res);

            expect(mockEngine.triggerSync).toHaveBeenCalledWith('git@github.com:user/notes.git');
            expect(res.writeHead).toHaveBeenCalledWith(200, { 'Content-Type': 'application/json' });
            const body = JSON.parse((res.end as any).mock.calls[0][0]);
            expect(body.lastSyncTime).toBe('2026-01-01T00:00:00.000Z');
        });

        it('returns 500 when triggerSync throws', async () => {
            const mockEngine = {
                triggerSync: vi.fn().mockRejectedValue(new Error('Git push failed')),
            } as unknown as SyncEngine;

            const config: ResolvedCLIConfig = {
                ...DEFAULT_CONFIG,
                sync: { gitRemote: 'git@github.com:user/notes.git', intervalMinutes: 5 },
            };

            const routes: Route[] = [];
            registerSyncRoutes(routes, () => mockEngine, () => config);

            const route = findRoute(routes, 'POST', '/api/sync/trigger')!;
            const res = createMockRes();
            await route.handler(createMockReq('POST'), res);

            expect(res.writeHead).toHaveBeenCalledWith(500, { 'Content-Type': 'application/json' });
            const body = JSON.parse((res.end as any).mock.calls[0][0]);
            expect(body.error).toBe('Git push failed');
        });
    });
});
