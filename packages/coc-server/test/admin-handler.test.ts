/**
 * Admin Handler Tests (coc-server)
 *
 * Direct unit tests for:
 * - TokenManager (generate, validate, expiry, one-time-use)
 * - GET /api/admin/data/wipe-token
 * - GET /api/admin/data/stats
 * - DELETE /api/admin/data (wipe with token)
 * - GET /api/admin/config
 * - PUT /api/admin/config (validation)
 * - GET /api/admin/export
 * - GET /api/admin/import-token
 * - POST /api/admin/import/preview
 * - POST /api/admin/import
 *
 * Uses the coc-server shared router directly (no full coc server stack).
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as http from 'http';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { createRouter } from '../src/shared/router';
import {
    registerAdminRoutes,
    TokenManager,
    TOKEN_EXPIRY_MS,
    wipeTokenManager,
    importTokenManager,
} from '../src/admin-handler';
import { DataWiper } from '../src/data-wiper';
import { EXPORT_SCHEMA_VERSION } from '../src/export-import-types';
import type { Route } from '../src/types';
import type { ProcessStore } from '@plusplusoneplusplus/pipeline-core';

// ============================================================================
// Helpers
// ============================================================================

function createMockStore(overrides: Partial<ProcessStore> = {}): ProcessStore {
    return {
        addProcess: vi.fn(async () => {}),
        updateProcess: vi.fn(async () => {}),
        getProcess: vi.fn(async () => undefined),
        getAllProcesses: vi.fn(async () => []),
        removeProcess: vi.fn(async () => {}),
        clearProcesses: vi.fn(async () => 0),
        getWorkspaces: vi.fn(async () => []),
        registerWorkspace: vi.fn(async () => {}),
        removeWorkspace: vi.fn(async () => false),
        updateWorkspace: vi.fn(async () => undefined),
        getWikis: vi.fn(async () => []),
        registerWiki: vi.fn(async () => {}),
        removeWiki: vi.fn(async () => false),
        updateWiki: vi.fn(async () => undefined),
        clearAllWorkspaces: vi.fn(async () => 0),
        clearAllWikis: vi.fn(async () => 0),
        getStorageStats: vi.fn(async () => ({ totalProcesses: 0, totalWorkspaces: 0, totalWikis: 0, storageSize: 0 })),
        onProcessOutput: vi.fn(() => () => {}),
        emitProcessOutput: vi.fn(),
        emitProcessComplete: vi.fn(),
        emitProcessEvent: vi.fn(),
        ...overrides,
    };
}

function makeServer(dataDir: string, store: ProcessStore): http.Server {
    const routes: Route[] = [];
    registerAdminRoutes(routes, { store, dataDir });
    const handler = createRouter({ routes, spaHtml: '' });
    return http.createServer(handler);
}

async function startServer(server: http.Server): Promise<string> {
    return new Promise((resolve, reject) => {
        server.on('error', reject);
        server.listen(0, '127.0.0.1', () => {
            const addr = server.address() as { port: number };
            resolve(`http://127.0.0.1:${addr.port}`);
        });
    });
}

async function stopServer(server: http.Server): Promise<void> {
    return new Promise(resolve => server.close(() => resolve()));
}

async function apiRequest(baseUrl: string, pathname: string, opts: { method?: string; body?: unknown } = {}): Promise<{ status: number; body: unknown }> {
    const method = opts.method ?? 'GET';
    const init: RequestInit = { method };
    if (opts.body !== undefined) {
        init.body = JSON.stringify(opts.body);
        init.headers = { 'Content-Type': 'application/json' };
    }
    const res = await fetch(`${baseUrl}${pathname}`, init);
    const text = await res.text();
    let body: unknown;
    try { body = JSON.parse(text); } catch { body = text; }
    return { status: res.status, body };
}

// ============================================================================
// TokenManager unit tests
// ============================================================================

describe('TokenManager', () => {
    let manager: TokenManager;

    beforeEach(() => {
        manager = new TokenManager();
    });

    it('generates a non-empty token', () => {
        const { token } = manager.generate();
        expect(typeof token).toBe('string');
        expect(token.length).toBeGreaterThan(0);
    });

    it('generates different tokens on successive calls', () => {
        const { token: t1 } = manager.generate();
        const { token: t2 } = manager.generate();
        expect(t1).not.toBe(t2);
    });

    it('validates a freshly generated token', () => {
        const { token } = manager.generate();
        expect(manager.validate(token)).toBe(true);
    });

    it('token is one-time-use — second validation returns false', () => {
        const { token } = manager.generate();
        manager.validate(token);
        expect(manager.validate(token)).toBe(false);
    });

    it('rejects an incorrect token', () => {
        manager.generate();
        expect(manager.validate('not-the-right-token')).toBe(false);
    });

    it('rejects when no token has been generated', () => {
        expect(manager.validate('anything')).toBe(false);
    });

    it('rejects an expired token', () => {
        const { token } = manager.generate();
        // Simulate expiry by moving createdAt into the past
        const active = manager.activeToken!;
        (active as { createdAt: number }).createdAt = Date.now() - TOKEN_EXPIRY_MS - 1;
        expect(manager.validate(token)).toBe(false);
    });

    it('reset() clears the active token', () => {
        const { token } = manager.generate();
        manager.reset();
        expect(manager.validate(token)).toBe(false);
    });
});

// ============================================================================
// HTTP route tests
// ============================================================================

describe('Admin HTTP Routes', () => {
    let server: http.Server;
    let baseUrl: string;
    let dataDir: string;
    let store: ProcessStore;

    beforeEach(async () => {
        dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'coc-admin-test-'));
        wipeTokenManager.reset();
        importTokenManager.reset();
        store = createMockStore();
        server = makeServer(dataDir, store);
        baseUrl = await startServer(server);
    });

    afterEach(async () => {
        await stopServer(server);
        fs.rmSync(dataDir, { recursive: true, force: true });
        wipeTokenManager.reset();
        importTokenManager.reset();
    });

    // ---- GET /api/admin/data/wipe-token -----------------------------------------------

    describe('GET /api/admin/data/wipe-token', () => {
        it('returns a token with expiresIn', async () => {
            const { status, body } = await apiRequest(baseUrl, '/api/admin/data/wipe-token');
            expect(status).toBe(200);
            expect((body as any).token).toBeDefined();
            expect(typeof (body as any).token).toBe('string');
            expect((body as any).expiresIn).toBe(TOKEN_EXPIRY_MS / 1000);
        });

        it('generates a different token on each call', async () => {
            const { body: b1 } = await apiRequest(baseUrl, '/api/admin/data/wipe-token');
            const { body: b2 } = await apiRequest(baseUrl, '/api/admin/data/wipe-token');
            expect((b1 as any).token).not.toBe((b2 as any).token);
        });
    });

    // ---- GET /api/admin/data/stats --------------------------------------------------------

    describe('GET /api/admin/data/stats', () => {
        it('returns storage statistics', async () => {
            (store.getAllProcesses as ReturnType<typeof vi.fn>).mockResolvedValue([{ id: 'p1' } as any]);
            const { status, body } = await apiRequest(baseUrl, '/api/admin/data/stats');
            expect(status).toBe(200);
            expect(typeof (body as any).deletedProcesses).toBe('number');
            expect(typeof (body as any).errors).toBe('object');
        });
    });

    // ---- DELETE /api/admin/data -----------------------------------------------------------

    describe('DELETE /api/admin/data', () => {
        it('returns 400 when confirmation token is missing', async () => {
            const { status, body } = await apiRequest(baseUrl, '/api/admin/data', { method: 'DELETE' });
            expect(status).toBe(400);
            expect((body as any).error).toMatch(/confirmation token/i);
        });

        it('returns 403 for invalid token', async () => {
            const { status, body } = await apiRequest(baseUrl, '/api/admin/data?confirm=bad-token', { method: 'DELETE' });
            expect(status).toBe(403);
            expect((body as any).error).toMatch(/invalid or expired/i);
        });

        it('returns 200 and wipes data with valid token', async () => {
            // Get a valid token
            const { body: tokenBody } = await apiRequest(baseUrl, '/api/admin/data/wipe-token');
            const token = (tokenBody as any).token;

            (store.clearProcesses as ReturnType<typeof vi.fn>).mockResolvedValue(0);
            (store.clearAllWorkspaces as ReturnType<typeof vi.fn>).mockResolvedValue(0);

            const { status, body } = await apiRequest(baseUrl, `/api/admin/data?confirm=${token}`, { method: 'DELETE' });
            expect(status).toBe(200);
            expect(typeof (body as any).deletedProcesses).toBe('number');
        });

        it('token is one-time-use — second DELETE with same token fails', async () => {
            const { body: tokenBody } = await apiRequest(baseUrl, '/api/admin/data/wipe-token');
            const token = (tokenBody as any).token;

            // First use succeeds
            await apiRequest(baseUrl, `/api/admin/data?confirm=${token}`, { method: 'DELETE' });
            // Second use rejected
            const { status } = await apiRequest(baseUrl, `/api/admin/data?confirm=${token}`, { method: 'DELETE' });
            expect(status).toBe(403);
        });
    });

    // ---- GET /api/admin/import-token -------------------------------------------------------

    describe('GET /api/admin/import-token', () => {
        it('returns an import token with expiresIn', async () => {
            const { status, body } = await apiRequest(baseUrl, '/api/admin/import-token');
            expect(status).toBe(200);
            expect(typeof (body as any).token).toBe('string');
            expect((body as any).expiresIn).toBe(TOKEN_EXPIRY_MS / 1000);
        });
    });

    // ---- POST /api/admin/import/preview ---------------------------------------------------

    describe('POST /api/admin/import/preview', () => {
        it('returns 400 for malformed payload', async () => {
            const { status, body } = await apiRequest(baseUrl, '/api/admin/import/preview', {
                method: 'POST',
                body: { notAValidPayload: true },
            });
            expect(status).toBe(400);
            expect((body as any).valid).toBe(false);
            expect(typeof (body as any).error).toBe('string');
        });

        it('returns preview for a valid payload', async () => {
            const payload = {
                version: EXPORT_SCHEMA_VERSION,
                exportedAt: new Date().toISOString(),
                metadata: {
                    processCount: 2,
                    workspaceCount: 1,
                    wikiCount: 0,
                    queueFileCount: 0,
                    blobFileCount: 0,
                },
                processes: [{ id: 'p1' }, { id: 'p2' }],
                workspaces: [{ id: 'ws1' }],
                wikis: [],
                queueHistory: [],
                preferences: {},
                imageBlobs: [],
            };

            const { status, body } = await apiRequest(baseUrl, '/api/admin/import/preview', {
                method: 'POST',
                body: payload,
            });
            expect(status).toBe(200);
            expect((body as any).valid).toBe(true);
            expect((body as any).preview.processCount).toBe(2);
            expect((body as any).preview.workspaceCount).toBe(1);
        });
    });

    // ---- POST /api/admin/import -----------------------------------------------------------

    describe('POST /api/admin/import', () => {
        it('returns 400 when confirmation token is missing', async () => {
            const { status, body } = await apiRequest(baseUrl, '/api/admin/import', {
                method: 'POST',
                body: {},
            });
            expect(status).toBe(400);
            expect((body as any).error).toMatch(/confirmation token/i);
        });

        it('returns 403 for invalid token', async () => {
            const { status } = await apiRequest(baseUrl, '/api/admin/import?confirm=bad-token', {
                method: 'POST',
                body: {},
            });
            expect(status).toBe(403);
        });

        it('imports data with a valid token in replace mode', async () => {
            // Get import token
            const { body: tokenBody } = await apiRequest(baseUrl, '/api/admin/import-token');
            const token = (tokenBody as any).token;

            const payload = {
                version: EXPORT_SCHEMA_VERSION,
                exportedAt: new Date().toISOString(),
                metadata: {
                    processCount: 0,
                    workspaceCount: 0,
                    wikiCount: 0,
                    queueFileCount: 0,
                    blobFileCount: 0,
                },
                processes: [],
                workspaces: [],
                wikis: [],
                queueHistory: [],
                preferences: {},
                imageBlobs: [],
            };

            const { status, body } = await apiRequest(baseUrl, `/api/admin/import?confirm=${token}&mode=replace`, {
                method: 'POST',
                body: payload,
            });
            expect(status).toBe(200);
            expect(typeof (body as any).importedProcesses).toBe('number');
        });
    });

    // ---- GET /api/admin/export -----------------------------------------------------------

    describe('GET /api/admin/export', () => {
        it('returns a JSON attachment with export data', async () => {
            const res = await fetch(`${baseUrl}/api/admin/export`);
            expect(res.status).toBe(200);
            expect(res.headers.get('content-disposition')).toMatch(/attachment/);
            const body = await res.json();
            expect(body.version).toBe(EXPORT_SCHEMA_VERSION);
            expect(typeof body.exportedAt).toBe('string');
        });
    });
});
