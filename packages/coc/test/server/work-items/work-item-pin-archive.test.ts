/**
 * Tests for work item pin/archive/delete actions — store methods and API routes.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as http from 'http';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import type { Route } from '../../../src/server/types';
import { createRouter } from '../../../src/server/shared/router';
import { registerWorkItemRoutes } from '../../../src/server/routes/work-item-routes';
import { FileWorkItemStore } from '../../../src/server/work-items/work-item-store';
import type { WorkItem } from '../../../src/server/work-items/types';

let tmpDir: string;
let store: FileWorkItemStore;
let server: http.Server;
let baseUrl: string;

function makeWorkItem(overrides: Partial<WorkItem> = {}): WorkItem {
    return {
        id: `wi-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        repoId: 'test-repo',
        title: 'Test work item',
        description: 'A test work item description',
        status: 'created',
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
        source: 'manual',
        ...overrides,
    };
}

function makeServer(): http.Server {
    const routes: Route[] = [];
    registerWorkItemRoutes({ routes, workItemStore: store, processStore: { getWorkspaces: async () => [] } as any });
    const handler = createRouter({ routes, spaHtml: '' });
    return http.createServer(handler);
}

async function startServer(): Promise<void> {
    return new Promise((resolve, reject) => {
        server.on('error', reject);
        server.listen(0, '127.0.0.1', () => {
            const addr = server.address() as any;
            baseUrl = `http://127.0.0.1:${addr.port}`;
            resolve();
        });
    });
}

async function stopServer(): Promise<void> {
    return new Promise(resolve => server.close(() => resolve()));
}

async function request(
    method: string,
    urlPath: string,
    body?: unknown,
): Promise<{ status: number; body: any }> {
    return new Promise((resolve, reject) => {
        const urlObj = new URL(urlPath, baseUrl);
        const opts: http.RequestOptions = {
            hostname: urlObj.hostname,
            port: urlObj.port,
            path: urlObj.pathname + urlObj.search,
            method,
            headers: body ? { 'Content-Type': 'application/json' } : {},
        };
        const req = http.request(opts, (res) => {
            const chunks: Buffer[] = [];
            res.on('data', (c: Buffer) => chunks.push(c));
            res.on('end', () => {
                const raw = Buffer.concat(chunks).toString('utf-8');
                let parsed: any = null;
                try { parsed = JSON.parse(raw); } catch { parsed = raw; }
                resolve({ status: res.statusCode!, body: parsed });
            });
        });
        req.on('error', reject);
        if (body) req.write(JSON.stringify(body));
        req.end();
    });
}

const REPO_ID = 'test-repo';

beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'coc-wi-pin-archive-'));
    store = new FileWorkItemStore({ dataDir: tmpDir });
    server = makeServer();
    await startServer();
});

afterEach(async () => {
    await stopServer();
    await fs.rm(tmpDir, { recursive: true, force: true });
});

// ============================================================================
// Store-level tests
// ============================================================================

describe('FileWorkItemStore — pin/archive', () => {
    describe('pinWorkItem / unpinWorkItem', () => {
        it('pins a work item', async () => {
            const item = makeWorkItem({ id: 'wi-pin' });
            await store.addWorkItem(item);

            const pinned = await store.pinWorkItem('wi-pin', '2026-01-15T00:00:00.000Z');
            expect(pinned).toBeDefined();
            expect(pinned!.pinnedAt).toBe('2026-01-15T00:00:00.000Z');

            const retrieved = await store.getWorkItem('wi-pin', REPO_ID);
            expect(retrieved!.pinnedAt).toBe('2026-01-15T00:00:00.000Z');
        });

        it('unpins a work item', async () => {
            const item = makeWorkItem({ id: 'wi-unpin', pinnedAt: '2026-01-15T00:00:00.000Z' });
            await store.addWorkItem(item);

            const unpinned = await store.unpinWorkItem('wi-unpin');
            expect(unpinned).toBeDefined();
            expect(unpinned!.pinnedAt).toBeUndefined();

            const retrieved = await store.getWorkItem('wi-unpin', REPO_ID);
            expect(retrieved!.pinnedAt).toBeUndefined();
        });

        it('updates index entry with pinnedAt', async () => {
            const item = makeWorkItem({ id: 'wi-pin-idx' });
            await store.addWorkItem(item);

            await store.pinWorkItem('wi-pin-idx', '2026-01-15T00:00:00.000Z');

            const list = await store.listWorkItems({ repoId: REPO_ID });
            const entry = list.items.find(e => e.id === 'wi-pin-idx');
            expect(entry).toBeDefined();
            expect(entry!.pinnedAt).toBe('2026-01-15T00:00:00.000Z');
        });

        it('returns undefined for non-existent item', async () => {
            const result = await store.pinWorkItem('nonexistent', '2026-01-15T00:00:00.000Z');
            expect(result).toBeUndefined();
        });
    });

    describe('archiveWorkItem / unarchiveWorkItem', () => {
        it('archives a work item', async () => {
            const item = makeWorkItem({ id: 'wi-arch' });
            await store.addWorkItem(item);

            const archived = await store.archiveWorkItem('wi-arch', '2026-02-01T00:00:00.000Z');
            expect(archived).toBeDefined();
            expect(archived!.archivedAt).toBe('2026-02-01T00:00:00.000Z');

            const retrieved = await store.getWorkItem('wi-arch', REPO_ID);
            expect(retrieved!.archivedAt).toBe('2026-02-01T00:00:00.000Z');
        });

        it('unarchives a work item', async () => {
            const item = makeWorkItem({ id: 'wi-unarch', archivedAt: '2026-02-01T00:00:00.000Z' });
            await store.addWorkItem(item);

            const unarchived = await store.unarchiveWorkItem('wi-unarch');
            expect(unarchived).toBeDefined();
            expect(unarchived!.archivedAt).toBeUndefined();
        });

        it('updates index entry with archivedAt', async () => {
            const item = makeWorkItem({ id: 'wi-arch-idx' });
            await store.addWorkItem(item);

            await store.archiveWorkItem('wi-arch-idx', '2026-02-01T00:00:00.000Z');

            const list = await store.listWorkItems({ repoId: REPO_ID });
            const entry = list.items.find(e => e.id === 'wi-arch-idx');
            expect(entry).toBeDefined();
            expect(entry!.archivedAt).toBe('2026-02-01T00:00:00.000Z');
        });

        it('returns undefined for non-existent item', async () => {
            const result = await store.archiveWorkItem('nonexistent', '2026-02-01T00:00:00.000Z');
            expect(result).toBeUndefined();
        });
    });
});

// ============================================================================
// Route-level tests
// ============================================================================

describe('Work Item Routes — pin/archive', () => {
    describe('PATCH /api/workspaces/:id/work-items/:workItemId/pin', () => {
        it('pins a work item', async () => {
            // Create first
            const createRes = await request('POST', `/api/workspaces/${REPO_ID}/work-items`, {
                title: 'Pin me',
            });
            expect(createRes.status).toBe(201);
            const itemId = createRes.body.id;

            // Pin
            const pinRes = await request('PATCH', `/api/workspaces/${REPO_ID}/work-items/${itemId}/pin`, {
                pinned: true,
            });
            expect(pinRes.status).toBe(200);
            expect(pinRes.body.pinnedAt).toBeDefined();
            expect(typeof pinRes.body.pinnedAt).toBe('string');
        });

        it('unpins a work item', async () => {
            const createRes = await request('POST', `/api/workspaces/${REPO_ID}/work-items`, {
                title: 'Unpin me',
            });
            const itemId = createRes.body.id;

            // Pin then unpin
            await request('PATCH', `/api/workspaces/${REPO_ID}/work-items/${itemId}/pin`, {
                pinned: true,
            });

            const unpinRes = await request('PATCH', `/api/workspaces/${REPO_ID}/work-items/${itemId}/pin`, {
                pinned: false,
            });
            expect(unpinRes.status).toBe(200);
            expect(unpinRes.body.pinnedAt).toBeUndefined();
        });

        it('returns 400 for missing pinned field', async () => {
            const createRes = await request('POST', `/api/workspaces/${REPO_ID}/work-items`, {
                title: 'Bad pin',
            });
            const itemId = createRes.body.id;

            const res = await request('PATCH', `/api/workspaces/${REPO_ID}/work-items/${itemId}/pin`, {});
            expect(res.status).toBe(400);
        });

        it('returns 404 for non-existent item', async () => {
            const res = await request('PATCH', `/api/workspaces/${REPO_ID}/work-items/nonexistent/pin`, {
                pinned: true,
            });
            expect(res.status).toBe(404);
        });
    });

    describe('PATCH /api/workspaces/:id/work-items/:workItemId/archive', () => {
        it('archives a work item', async () => {
            const createRes = await request('POST', `/api/workspaces/${REPO_ID}/work-items`, {
                title: 'Archive me',
            });
            const itemId = createRes.body.id;

            const archRes = await request('PATCH', `/api/workspaces/${REPO_ID}/work-items/${itemId}/archive`, {
                archived: true,
            });
            expect(archRes.status).toBe(200);
            expect(archRes.body.archivedAt).toBeDefined();
            expect(typeof archRes.body.archivedAt).toBe('string');
        });

        it('unarchives a work item', async () => {
            const createRes = await request('POST', `/api/workspaces/${REPO_ID}/work-items`, {
                title: 'Unarchive me',
            });
            const itemId = createRes.body.id;

            await request('PATCH', `/api/workspaces/${REPO_ID}/work-items/${itemId}/archive`, {
                archived: true,
            });

            const unarchRes = await request('PATCH', `/api/workspaces/${REPO_ID}/work-items/${itemId}/archive`, {
                archived: false,
            });
            expect(unarchRes.status).toBe(200);
            expect(unarchRes.body.archivedAt).toBeUndefined();
        });

        it('returns 400 for missing archived field', async () => {
            const createRes = await request('POST', `/api/workspaces/${REPO_ID}/work-items`, {
                title: 'Bad archive',
            });
            const itemId = createRes.body.id;

            const res = await request('PATCH', `/api/workspaces/${REPO_ID}/work-items/${itemId}/archive`, {});
            expect(res.status).toBe(400);
        });

        it('returns 404 for non-existent item', async () => {
            const res = await request('PATCH', `/api/workspaces/${REPO_ID}/work-items/nonexistent/archive`, {
                archived: true,
            });
            expect(res.status).toBe(404);
        });
    });

    describe('pin + archive state persists through GET', () => {
        it('GET detail returns pinnedAt and archivedAt', async () => {
            const createRes = await request('POST', `/api/workspaces/${REPO_ID}/work-items`, {
                title: 'Full lifecycle',
            });
            const itemId = createRes.body.id;

            await request('PATCH', `/api/workspaces/${REPO_ID}/work-items/${itemId}/pin`, { pinned: true });
            await request('PATCH', `/api/workspaces/${REPO_ID}/work-items/${itemId}/archive`, { archived: true });

            const getRes = await request('GET', `/api/workspaces/${REPO_ID}/work-items/${itemId}`);
            expect(getRes.status).toBe(200);
            expect(getRes.body.pinnedAt).toBeDefined();
            expect(getRes.body.archivedAt).toBeDefined();
        });
    });
});
