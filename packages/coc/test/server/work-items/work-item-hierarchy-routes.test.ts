/**
 * Work Item Hierarchy Routes Tests
 *
 * Tests for:
 * - GET /api/workspaces/:id/work-items/tree (disabled response when flag is off)
 * - GET /api/workspaces/:id/work-items/tree (tree structure + rollup when enabled)
 * - POST /api/workspaces/:id/work-items with hierarchy types when enabled
 * - POST /api/workspaces/:id/work-items rejecting hierarchy types when disabled
 * - PATCH /api/workspaces/:id/work-items/:id with parentId when enabled
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as http from 'http';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import type { Route } from '../../../src/server/types';
import { createRouter } from '../../../src/server/shared/router';
import { registerWorkItemHierarchyRoutes } from '../../../src/server/routes/work-item-hierarchy-routes';
import { registerWorkItemRoutes } from '../../../src/server/routes/work-item-routes';
import { FileWorkItemStore } from '../../../src/server/work-items/work-item-store';

const REPO_ID = 'hierarchy-test-repo';

let tmpDir: string;
let store: FileWorkItemStore;
let hierarchyEnabled = false;

function makeServer(): http.Server {
    const routes: Route[] = [];
    const getHierarchyEnabled = () => hierarchyEnabled;
    // Hierarchy tree route must be registered first
    registerWorkItemHierarchyRoutes({ routes, workItemStore: store, getHierarchyEnabled });
    registerWorkItemRoutes({
        routes,
        workItemStore: store,
        processStore: { getWorkspaces: async () => [] } as any,
        getHierarchyEnabled,
    });
    const handler = createRouter({ routes, spaHtml: '' });
    return http.createServer(handler);
}

let server: http.Server;
let baseUrl: string;

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

beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'coc-wi-hier-'));
    store = new FileWorkItemStore({ dataDir: tmpDir });
    hierarchyEnabled = false;
    server = makeServer();
    await startServer();
});

afterEach(async () => {
    await stopServer();
    await fs.rm(tmpDir, { recursive: true, force: true });
});

describe('Work Item Hierarchy Routes', () => {
    describe('GET /tree — when hierarchy flag is disabled', () => {
        it('returns disabled:true with empty roots', async () => {
            const res = await request('GET', `/api/workspaces/${REPO_ID}/work-items/tree`);
            expect(res.status).toBe(200);
            expect(res.body.disabled).toBe(true);
            expect(res.body.roots).toEqual([]);
            expect(res.body.total).toBe(0);
        });
    });

    describe('GET /tree — when hierarchy flag is enabled', () => {
        beforeEach(() => { hierarchyEnabled = true; });

        it('returns empty tree for a workspace with no items', async () => {
            const res = await request('GET', `/api/workspaces/${REPO_ID}/work-items/tree`);
            expect(res.status).toBe(200);
            expect(res.body.disabled).toBeUndefined();
            expect(res.body.roots).toEqual([]);
            expect(res.body.total).toBe(0);
        });

        it('returns unparented items as roots', async () => {
            await request('POST', `/api/workspaces/${REPO_ID}/work-items`, {
                title: 'Standalone task',
                type: 'work-item',
            });
            const res = await request('GET', `/api/workspaces/${REPO_ID}/work-items/tree`);
            expect(res.status).toBe(200);
            expect(res.body.roots).toHaveLength(1);
            expect(res.body.roots[0].item.title).toBe('Standalone task');
            expect(res.body.roots[0].children).toEqual([]);
        });

        it('builds a nested tree: epic → feature → pbi → work-item', async () => {
            const epicRes = await request('POST', `/api/workspaces/${REPO_ID}/work-items`, {
                title: 'My Epic',
                type: 'epic',
            });
            const epicId = epicRes.body.id;

            const featRes = await request('POST', `/api/workspaces/${REPO_ID}/work-items`, {
                title: 'My Feature',
                type: 'feature',
                parentId: epicId,
            });
            const featId = featRes.body.id;

            const pbiRes = await request('POST', `/api/workspaces/${REPO_ID}/work-items`, {
                title: 'My PBI',
                type: 'pbi',
                parentId: featId,
            });
            const pbiId = pbiRes.body.id;

            await request('POST', `/api/workspaces/${REPO_ID}/work-items`, {
                title: 'My Task',
                type: 'work-item',
                parentId: pbiId,
            });

            const res = await request('GET', `/api/workspaces/${REPO_ID}/work-items/tree`);
            expect(res.status).toBe(200);
            expect(res.body.roots).toHaveLength(1);

            const epic = res.body.roots[0];
            expect(epic.item.type).toBe('epic');
            expect(epic.item.title).toBe('My Epic');
            expect(epic.children).toHaveLength(1);

            const feat = epic.children[0];
            expect(feat.item.type).toBe('feature');
            expect(feat.children).toHaveLength(1);

            const pbi = feat.children[0];
            expect(pbi.item.type).toBe('pbi');
            expect(pbi.children).toHaveLength(1);

            const task = pbi.children[0];
            expect(task.item.type).toBe('work-item');
            expect(task.children).toEqual([]);
        });

        it('computes correct rollup counts', async () => {
            const epicRes = await request('POST', `/api/workspaces/${REPO_ID}/work-items`, {
                title: 'Epic',
                type: 'epic',
            });
            const epicId = epicRes.body.id;

            const featRes = await request('POST', `/api/workspaces/${REPO_ID}/work-items`, {
                title: 'Feature',
                type: 'feature',
                parentId: epicId,
            });
            const featId = featRes.body.id;

            const pbiRes = await request('POST', `/api/workspaces/${REPO_ID}/work-items`, {
                title: 'PBI',
                type: 'pbi',
                parentId: featId,
            });
            const pbiId = pbiRes.body.id;

            await request('POST', `/api/workspaces/${REPO_ID}/work-items`, {
                title: 'Task',
                type: 'work-item',
                parentId: pbiId,
            });
            await request('POST', `/api/workspaces/${REPO_ID}/work-items`, {
                title: 'Bug',
                type: 'bug',
                parentId: pbiId,
            });

            const res = await request('GET', `/api/workspaces/${REPO_ID}/work-items/tree`);
            const epic = res.body.roots[0];

            // Epic rollup should count all 4 descendants (feature, pbi, work-item, bug)
            expect(epic.rollup.descendantCount).toBe(4);
            expect(epic.rollup.byType.feature).toBe(1);
            expect(epic.rollup.byType.pbi).toBe(1);
            expect(epic.rollup.byType['work-item']).toBe(1);
            expect(epic.rollup.byType.bug).toBe(1);
            // All in created status
            expect(epic.rollup.byStatus.created).toBe(4);
        });

        it('excludes archived items when includeArchived is false (default)', async () => {
            const itemRes = await request('POST', `/api/workspaces/${REPO_ID}/work-items`, {
                title: 'Archived item',
                type: 'work-item',
            });
            await request('PATCH', `/api/workspaces/${REPO_ID}/work-items/${itemRes.body.id}/archive`, {
                archived: true,
            });

            const res = await request('GET', `/api/workspaces/${REPO_ID}/work-items/tree`);
            expect(res.status).toBe(200);
            expect(res.body.roots).toHaveLength(0);
            expect(res.body.total).toBe(0);
        });

        it('includes archived items when includeArchived=true', async () => {
            const itemRes = await request('POST', `/api/workspaces/${REPO_ID}/work-items`, {
                title: 'Archived item',
                type: 'work-item',
            });
            await request('PATCH', `/api/workspaces/${REPO_ID}/work-items/${itemRes.body.id}/archive`, {
                archived: true,
            });

            const res = await request('GET', `/api/workspaces/${REPO_ID}/work-items/tree?includeArchived=true`);
            expect(res.status).toBe(200);
            expect(res.body.roots).toHaveLength(1);
        });

        it('preserves ancestors when search matches a descendant', async () => {
            const epicRes = await request('POST', `/api/workspaces/${REPO_ID}/work-items`, {
                title: 'My Epic',
                type: 'epic',
            });
            const epicId = epicRes.body.id;

            const featRes = await request('POST', `/api/workspaces/${REPO_ID}/work-items`, {
                title: 'My Feature',
                type: 'feature',
                parentId: epicId,
            });
            const featId = featRes.body.id;

            const pbiRes = await request('POST', `/api/workspaces/${REPO_ID}/work-items`, {
                title: 'My PBI',
                type: 'pbi',
                parentId: featId,
            });
            const pbiId = pbiRes.body.id;

            await request('POST', `/api/workspaces/${REPO_ID}/work-items`, {
                title: 'Special task',
                type: 'work-item',
                parentId: pbiId,
            });

            // Search for "Special" — should include epic, feature, pbi as ancestors
            const res = await request('GET', `/api/workspaces/${REPO_ID}/work-items/tree?q=Special`);
            expect(res.status).toBe(200);
            expect(res.body.roots).toHaveLength(1);
            expect(res.body.roots[0].item.title).toBe('My Epic');
            expect(res.body.roots[0].children).toHaveLength(1);
            expect(res.body.roots[0].children[0].children).toHaveLength(1);
            expect(res.body.roots[0].children[0].children[0].children).toHaveLength(1);
        });

        it('returns total count as number of filtered entries', async () => {
            await request('POST', `/api/workspaces/${REPO_ID}/work-items`, { title: 'A', type: 'epic' });
            await request('POST', `/api/workspaces/${REPO_ID}/work-items`, { title: 'B', type: 'work-item' });

            const res = await request('GET', `/api/workspaces/${REPO_ID}/work-items/tree`);
            expect(res.body.total).toBe(2);
        });
    });

    describe('POST /work-items — hierarchy type validation', () => {
        it('rejects epic/feature/pbi types when hierarchy is disabled', async () => {
            for (const type of ['epic', 'feature', 'pbi']) {
                const res = await request('POST', `/api/workspaces/${REPO_ID}/work-items`, {
                    title: `Create ${type}`,
                    type,
                });
                expect(res.status).toBe(400);
                expect(res.body.error).toContain('hierarchy');
            }
        });

        it('rejects parentId when hierarchy is disabled', async () => {
            const res = await request('POST', `/api/workspaces/${REPO_ID}/work-items`, {
                title: 'Child item',
                type: 'work-item',
                parentId: 'some-parent-id',
            });
            expect(res.status).toBe(400);
            expect(res.body.error).toContain('hierarchy');
        });

        it('allows epic/feature/pbi types when hierarchy is enabled', async () => {
            hierarchyEnabled = true;
            for (const type of ['epic', 'feature', 'pbi']) {
                const res = await request('POST', `/api/workspaces/${REPO_ID}/work-items`, {
                    title: `Create ${type}`,
                    type,
                });
                expect(res.status).toBe(201);
                expect(res.body.type).toBe(type);
            }
        });

        it('allows parentId when hierarchy is enabled and parent-child types are valid', async () => {
            hierarchyEnabled = true;
            const epicRes = await request('POST', `/api/workspaces/${REPO_ID}/work-items`, {
                title: 'Epic',
                type: 'epic',
            });
            expect(epicRes.status).toBe(201);

            const featRes = await request('POST', `/api/workspaces/${REPO_ID}/work-items`, {
                title: 'Feature',
                type: 'feature',
                parentId: epicRes.body.id,
            });
            expect(featRes.status).toBe(201);
            expect(featRes.body.parentId).toBe(epicRes.body.id);
        });

        it('rejects invalid parent-child type combinations', async () => {
            hierarchyEnabled = true;
            const epicRes = await request('POST', `/api/workspaces/${REPO_ID}/work-items`, {
                title: 'Epic',
                type: 'epic',
            });

            // work-item cannot be a child of epic (must go through pbi first)
            const res = await request('POST', `/api/workspaces/${REPO_ID}/work-items`, {
                title: 'Invalid child',
                type: 'work-item',
                parentId: epicRes.body.id,
            });
            expect(res.status).toBe(400);
            expect(res.body.error).toContain('parent-child type');
        });

        it('rejects non-existent parent', async () => {
            hierarchyEnabled = true;
            const res = await request('POST', `/api/workspaces/${REPO_ID}/work-items`, {
                title: 'Orphan',
                type: 'work-item',
                parentId: 'non-existent-id',
            });
            expect(res.status).toBe(400);
        });
    });

    describe('PATCH /work-items/:id — parentId reparenting', () => {
        it('rejects parentId patch when hierarchy is disabled', async () => {
            const created = await request('POST', `/api/workspaces/${REPO_ID}/work-items`, {
                title: 'Item',
            });
            const res = await request('PATCH', `/api/workspaces/${REPO_ID}/work-items/${created.body.id}`, {
                parentId: 'some-id',
            });
            expect(res.status).toBe(400);
            expect(res.body.error).toContain('hierarchy');
        });

        it('allows reparenting when hierarchy is enabled', async () => {
            hierarchyEnabled = true;

            const pbi1Res = await request('POST', `/api/workspaces/${REPO_ID}/work-items`, {
                title: 'PBI 1',
                type: 'pbi',
            });
            const pbi2Res = await request('POST', `/api/workspaces/${REPO_ID}/work-items`, {
                title: 'PBI 2',
                type: 'pbi',
            });
            const taskRes = await request('POST', `/api/workspaces/${REPO_ID}/work-items`, {
                title: 'Task',
                type: 'work-item',
                parentId: pbi1Res.body.id,
            });

            // Reparent task to pbi2
            const res = await request('PATCH', `/api/workspaces/${REPO_ID}/work-items/${taskRes.body.id}`, {
                parentId: pbi2Res.body.id,
            });
            expect(res.status).toBe(200);
            expect(res.body.parentId).toBe(pbi2Res.body.id);
        });

        it('allows unlinking parent by setting parentId to null', async () => {
            hierarchyEnabled = true;

            const pbiRes = await request('POST', `/api/workspaces/${REPO_ID}/work-items`, {
                title: 'PBI',
                type: 'pbi',
            });
            const taskRes = await request('POST', `/api/workspaces/${REPO_ID}/work-items`, {
                title: 'Task',
                type: 'work-item',
                parentId: pbiRes.body.id,
            });

            // Unlink parent
            const res = await request('PATCH', `/api/workspaces/${REPO_ID}/work-items/${taskRes.body.id}`, {
                parentId: null,
            });
            expect(res.status).toBe(200);
            expect(res.body.parentId).toBeUndefined();

            // Verify item appears as root in tree
            const tree = await request('GET', `/api/workspaces/${REPO_ID}/work-items/tree`);
            // Both pbi and task are now unparented roots
            expect(tree.body.roots).toHaveLength(2);
        });

        it('rejects self-parenting', async () => {
            hierarchyEnabled = true;

            const itemRes = await request('POST', `/api/workspaces/${REPO_ID}/work-items`, {
                title: 'Item',
                type: 'pbi',
            });
            const id = itemRes.body.id;

            const res = await request('PATCH', `/api/workspaces/${REPO_ID}/work-items/${id}`, {
                parentId: id,
            });
            expect(res.status).toBe(400);
            expect(res.body.error).toContain('own parent');
        });
    });
});
