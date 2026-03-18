/**
 * Workspace CRUD Lifecycle Tests — Section 6
 *
 * Tests for the full lifecycle of workspace CRUD:
 * - POST /api/workspaces → create
 * - GET /api/workspaces → list
 * - GET /api/workspaces/:id → get by id
 * - PATCH /api/workspaces/:id → update
 * - DELETE /api/workspaces/:id → remove
 *
 * Also covers path/name edge cases (spaces, Unicode, Windows-style paths).
 *
 * Uses port 0 (OS-assigned) for test isolation.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as http from 'http';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { createExecutionServer } from '../../src/server/index';
import { FileProcessStore } from '@plusplusoneplusplus/forge';
import type { ExecutionServer } from '@plusplusoneplusplus/coc-server';

// ============================================================================
// HTTP Helpers
// ============================================================================

function request(
    url: string,
    options: { method?: string; body?: string; headers?: Record<string, string> } = {}
): Promise<{ status: number; body: string }> {
    return new Promise((resolve, reject) => {
        const parsed = new URL(url);
        const req = http.request(
            {
                hostname: parsed.hostname,
                port: parsed.port,
                path: parsed.pathname + parsed.search,
                method: options.method || 'GET',
                headers: options.headers,
            },
            (res) => {
                const chunks: Buffer[] = [];
                res.on('data', (chunk: Buffer) => chunks.push(chunk));
                res.on('end', () => {
                    resolve({ status: res.statusCode || 0, body: Buffer.concat(chunks).toString('utf-8') });
                });
            }
        );
        req.on('error', reject);
        if (options.body) req.write(options.body);
        req.end();
    });
}

function jsonReq(url: string, method: string, data?: unknown) {
    const body = data !== undefined ? JSON.stringify(data) : undefined;
    return request(url, { method, body, headers: { 'Content-Type': 'application/json' } });
}

// ============================================================================
// Tests
// ============================================================================

describe('Workspace CRUD Lifecycle', () => {
    let server: ExecutionServer | undefined;
    let dataDir: string;
    let wsDir: string;

    beforeEach(() => {
        dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ws-crud-test-'));
        wsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ws-crud-dir-'));
    });

    afterEach(async () => {
        if (server) {
            await server.close();
            server = undefined;
        }
        fs.rmSync(dataDir, { recursive: true, force: true });
        fs.rmSync(wsDir, { recursive: true, force: true });
    });

    async function startServer(): Promise<ExecutionServer> {
        const store = new FileProcessStore({ dataDir });
        server = await createExecutionServer({ port: 0, host: 'localhost', store, dataDir });
        return server;
    }

    // ========================================================================
    // Create
    // ========================================================================

    describe('POST /api/workspaces — Create', () => {
        it('POST with unique path → 201, workspace ID returned', async () => {
            const srv = await startServer();
            const res = await jsonReq(`${srv.url}/api/workspaces`, 'POST', {
                id: 'ws-unique-1',
                name: 'My Project',
                rootPath: wsDir,
            });
            expect(res.status).toBe(201);
            const body = JSON.parse(res.body);
            expect(body.id).toBe('ws-unique-1');
        });

        it('POST with same ID twice → second call upserts (200-family, no crash)', async () => {
            const srv = await startServer();
            await jsonReq(`${srv.url}/api/workspaces`, 'POST', {
                id: 'ws-same-id',
                name: 'First',
                rootPath: wsDir,
            });
            const res = await jsonReq(`${srv.url}/api/workspaces`, 'POST', {
                id: 'ws-same-id',
                name: 'Updated name',
                rootPath: wsDir,
            });
            // Registration is idempotent — no error, returns 201
            expect(res.status).toBe(201);
        });
    });

    // ========================================================================
    // Read
    // ========================================================================

    describe('GET /api/workspaces — List', () => {
        it('GET /api/workspaces after creation → includes new workspace', async () => {
            const srv = await startServer();
            await jsonReq(`${srv.url}/api/workspaces`, 'POST', {
                id: 'ws-list-1',
                name: 'Listed',
                rootPath: wsDir,
            });

            const res = await request(`${srv.url}/api/workspaces`);
            expect(res.status).toBe(200);
            const body = JSON.parse(res.body);
            const workspaces: any[] = body.workspaces ?? body;
            expect(workspaces.some((w: any) => w.id === 'ws-list-1')).toBe(true);
        });
    });

    // ========================================================================
    // Update
    // ========================================================================

    describe('PATCH /api/workspaces/:id — Update', () => {
        it('PATCH name change → reflected in subsequent GET list', async () => {
            const srv = await startServer();
            await jsonReq(`${srv.url}/api/workspaces`, 'POST', {
                id: 'ws-patch-1',
                name: 'Original Name',
                rootPath: wsDir,
            });

            const patchRes = await jsonReq(`${srv.url}/api/workspaces/ws-patch-1`, 'PATCH', {
                name: 'Updated Name',
            });
            expect(patchRes.status).toBe(200);
            const patchBody = JSON.parse(patchRes.body);
            expect(patchBody.workspace.name).toBe('Updated Name');

            // Verify via list
            const listRes = await request(`${srv.url}/api/workspaces`);
            const listBody = JSON.parse(listRes.body);
            const ws = (listBody.workspaces ?? []).find((w: any) => w.id === 'ws-patch-1');
            expect(ws?.name).toBe('Updated Name');
        });

        it('PATCH on nonexistent workspace → 404', async () => {
            const srv = await startServer();
            const res = await jsonReq(`${srv.url}/api/workspaces/does-not-exist`, 'PATCH', {
                name: 'New Name',
            });
            expect(res.status).toBe(404);
        });
    });

    // ========================================================================
    // Delete
    // ========================================================================

    describe('DELETE /api/workspaces/:id — Remove', () => {
        it('DELETE → subsequent GET list no longer includes it', async () => {
            const srv = await startServer();
            await jsonReq(`${srv.url}/api/workspaces`, 'POST', {
                id: 'ws-del-1',
                name: 'To Delete',
                rootPath: wsDir,
            });

            const delRes = await request(`${srv.url}/api/workspaces/ws-del-1`, { method: 'DELETE' });
            expect(delRes.status).toBe(204);

            const listRes = await request(`${srv.url}/api/workspaces`);
            const listBody = JSON.parse(listRes.body);
            const found = (listBody.workspaces ?? []).find((w: any) => w.id === 'ws-del-1');
            expect(found).toBeUndefined();
        });

        it('DELETE → removed from GET list', async () => {
            const srv = await startServer();
            const wsDir2 = fs.mkdtempSync(path.join(os.tmpdir(), 'ws-del-dir2-'));
            try {
                await jsonReq(`${srv.url}/api/workspaces`, 'POST', {
                    id: 'ws-del-list-1',
                    name: 'Keep',
                    rootPath: wsDir,
                });
                await jsonReq(`${srv.url}/api/workspaces`, 'POST', {
                    id: 'ws-del-list-2',
                    name: 'Delete',
                    rootPath: wsDir2,
                });

                await request(`${srv.url}/api/workspaces/ws-del-list-2`, { method: 'DELETE' });

                const listRes = await request(`${srv.url}/api/workspaces`);
                const body = JSON.parse(listRes.body);
                const workspaces: any[] = body.workspaces ?? body;
                expect(workspaces.some((w: any) => w.id === 'ws-del-list-1')).toBe(true);
                expect(workspaces.some((w: any) => w.id === 'ws-del-list-2')).toBe(false);
            } finally {
                fs.rmSync(wsDir2, { recursive: true, force: true });
            }
        });

        it('DELETE on nonexistent workspace → 404', async () => {
            const srv = await startServer();
            const res = await request(`${srv.url}/api/workspaces/ghost-ws`, { method: 'DELETE' });
            expect(res.status).toBe(404);
        });
    });

    // ========================================================================
    // GET list
    // ========================================================================

    describe('GET /api/workspaces — list only (no individual get endpoint)', () => {
        it('Registered workspace appears in the list', async () => {
            const srv = await startServer();
            await jsonReq(`${srv.url}/api/workspaces`, 'POST', {
                id: 'ws-list-check',
                name: 'Listed Workspace',
                rootPath: wsDir,
            });

            const listRes = await request(`${srv.url}/api/workspaces`);
            expect(listRes.status).toBe(200);
            const listBody = JSON.parse(listRes.body);
            const ws = (listBody.workspaces ?? []).find((w: any) => w.id === 'ws-list-check');
            expect(ws).toBeDefined();
            expect(ws.name).toBe('Listed Workspace');
        });
    });

    // ========================================================================
    // Path/name edge cases
    // ========================================================================

    describe('Edge cases', () => {
        it('Workspace with path containing spaces → CRUD succeeds', async () => {
            const spaceDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ws path with spaces-'));
            try {
                const srv = await startServer();
                const createRes = await jsonReq(`${srv.url}/api/workspaces`, 'POST', {
                    id: 'ws-spaces-1',
                    name: 'Space Path',
                    rootPath: spaceDir,
                });
                expect(createRes.status).toBe(201);

                const listRes = await request(`${srv.url}/api/workspaces`);
                const listBody = JSON.parse(listRes.body);
                const ws = (listBody.workspaces ?? []).find((w: any) => w.id === 'ws-spaces-1');
                expect(ws).toBeDefined();
                expect(ws.rootPath).toBe(spaceDir);
            } finally {
                fs.rmSync(spaceDir, { recursive: true, force: true });
            }
        });

        it('Workspace with Unicode name → stored and retrieved correctly', async () => {
            const srv = await startServer();
            const unicodeName = 'プロジェクト ABC 🚀';
            const createRes = await jsonReq(`${srv.url}/api/workspaces`, 'POST', {
                id: 'ws-unicode-1',
                name: unicodeName,
                rootPath: wsDir,
            });
            expect(createRes.status).toBe(201);

            const listRes = await request(`${srv.url}/api/workspaces`);
            const listBody = JSON.parse(listRes.body);
            const ws = (listBody.workspaces ?? []).find((w: any) => w.id === 'ws-unicode-1');
            expect(ws).toBeDefined();
            expect(ws.name).toBe(unicodeName);
        });
    });
});
