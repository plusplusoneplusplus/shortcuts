import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as http from 'http';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import type { Route } from '../../../src/server/types';
import { createRouter } from '../../../src/server/shared/router';
import { registerWorkItemRoutes } from '../../../src/server/routes/work-item-routes';
import { FileWorkItemStore } from '../../../src/server/work-items/work-item-store';

let tmpDir: string;
let store: FileWorkItemStore;
let server: http.Server;
let baseUrl: string;

function makeServer(): http.Server {
    const routes: Route[] = [];
    registerWorkItemRoutes({ routes, workItemStore: store });
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

beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'coc-wi-routes-'));
    store = new FileWorkItemStore({ dataDir: tmpDir });
    server = makeServer();
    await startServer();
});

afterEach(async () => {
    await stopServer();
    await fs.rm(tmpDir, { recursive: true, force: true });
});

describe('Work Item Routes', () => {
    const REPO_ID = 'test-repo';

    describe('POST /api/workspaces/:id/work-items', () => {
        it('creates a work item', async () => {
            const res = await request('POST', `/api/workspaces/${REPO_ID}/work-items`, {
                title: 'My task',
                description: 'Some description',
                priority: 'high',
                tags: ['backend'],
            });

            expect(res.status).toBe(201);
            expect(res.body.title).toBe('My task');
            expect(res.body.description).toBe('Some description');
            expect(res.body.status).toBe('created');
            expect(res.body.source).toBe('manual');
            expect(res.body.priority).toBe('high');
            expect(res.body.tags).toEqual(['backend']);
            expect(res.body.id).toBeDefined();
            expect(res.body.repoId).toBe(REPO_ID);
        });

        it('creates with initial plan', async () => {
            const res = await request('POST', `/api/workspaces/${REPO_ID}/work-items`, {
                title: 'Planned task',
                plan: { content: '# Step 1\nDo things', resolvedBy: 'user' },
            });

            expect(res.status).toBe(201);
            expect(res.body.plan).toBeDefined();
            expect(res.body.plan.version).toBe(1);
            expect(res.body.plan.content).toBe('# Step 1\nDo things');
        });

        it('rejects missing title', async () => {
            const res = await request('POST', `/api/workspaces/${REPO_ID}/work-items`, {
                description: 'No title',
            });

            expect(res.status).toBe(400);
            expect(res.body.error).toContain('title');
        });

        it('defaults source to manual for invalid values', async () => {
            const res = await request('POST', `/api/workspaces/${REPO_ID}/work-items`, {
                title: 'Test',
                source: 'invalid-source',
            });

            expect(res.status).toBe(201);
            expect(res.body.source).toBe('manual');
        });

        it('accepts chat source', async () => {
            const res = await request('POST', `/api/workspaces/${REPO_ID}/work-items`, {
                title: 'From chat',
                source: 'chat',
                sourceId: 'proc-123',
            });

            expect(res.status).toBe(201);
            expect(res.body.source).toBe('chat');
            expect(res.body.sourceId).toBe('proc-123');
        });
    });

    describe('GET /api/workspaces/:id/work-items', () => {
        beforeEach(async () => {
            await request('POST', `/api/workspaces/${REPO_ID}/work-items`, {
                title: 'Item A', status: 'created', priority: 'high', tags: ['api'],
            });
            await request('POST', `/api/workspaces/${REPO_ID}/work-items`, {
                title: 'Item B', source: 'chat', priority: 'low',
            });
        });

        it('lists all work items for a repo', async () => {
            const res = await request('GET', `/api/workspaces/${REPO_ID}/work-items`);
            expect(res.status).toBe(200);
            expect(res.body).toHaveLength(2);
        });

        it('filters by status', async () => {
            const res = await request('GET', `/api/workspaces/${REPO_ID}/work-items?status=created`);
            expect(res.status).toBe(200);
            expect(res.body).toHaveLength(2); // both are 'created'
        });

        it('filters by source', async () => {
            const res = await request('GET', `/api/workspaces/${REPO_ID}/work-items?source=chat`);
            expect(res.status).toBe(200);
            expect(res.body).toHaveLength(1);
            expect(res.body[0].title).toBe('Item B');
        });

        it('filters by priority', async () => {
            const res = await request('GET', `/api/workspaces/${REPO_ID}/work-items?priority=high`);
            expect(res.status).toBe(200);
            expect(res.body).toHaveLength(1);
            expect(res.body[0].title).toBe('Item A');
        });

        it('returns empty for unknown repo', async () => {
            const res = await request('GET', `/api/workspaces/unknown-repo/work-items`);
            expect(res.status).toBe(200);
            expect(res.body).toEqual([]);
        });
    });

    describe('GET /api/workspaces/:id/work-items/:workItemId', () => {
        it('returns work item detail', async () => {
            const created = await request('POST', `/api/workspaces/${REPO_ID}/work-items`, {
                title: 'Detailed item',
                description: 'Full description here',
            });
            const id = created.body.id;

            const res = await request('GET', `/api/workspaces/${REPO_ID}/work-items/${id}`);
            expect(res.status).toBe(200);
            expect(res.body.id).toBe(id);
            expect(res.body.title).toBe('Detailed item');
            expect(res.body.description).toBe('Full description here');
        });

        it('returns 404 for non-existent item', async () => {
            const res = await request('GET', `/api/workspaces/${REPO_ID}/work-items/nonexistent`);
            expect(res.status).toBe(404);
        });
    });

    describe('PATCH /api/workspaces/:id/work-items/:workItemId', () => {
        let itemId: string;

        beforeEach(async () => {
            const created = await request('POST', `/api/workspaces/${REPO_ID}/work-items`, {
                title: 'Patchable item',
            });
            itemId = created.body.id;
        });

        it('updates title and description', async () => {
            const res = await request('PATCH', `/api/workspaces/${REPO_ID}/work-items/${itemId}`, {
                title: 'Updated title',
                description: 'New description',
            });

            expect(res.status).toBe(200);
            expect(res.body.title).toBe('Updated title');
            expect(res.body.description).toBe('New description');
        });

        it('validates status transitions', async () => {
            // created → planning is valid
            let res = await request('PATCH', `/api/workspaces/${REPO_ID}/work-items/${itemId}`, {
                status: 'planning',
            });
            expect(res.status).toBe(200);
            expect(res.body.status).toBe('planning');

            // planning → executing is INVALID (must go through ready)
            res = await request('PATCH', `/api/workspaces/${REPO_ID}/work-items/${itemId}`, {
                status: 'executing',
            });
            expect(res.status).toBe(400);
            expect(res.body.error).toContain('Invalid status transition');
        });

        it('rejects invalid status values', async () => {
            const res = await request('PATCH', `/api/workspaces/${REPO_ID}/work-items/${itemId}`, {
                status: 'invalid-status',
            });
            expect(res.status).toBe(400);
        });

        it('returns 404 for non-existent item', async () => {
            const res = await request('PATCH', `/api/workspaces/${REPO_ID}/work-items/nonexistent`, {
                title: 'x',
            });
            expect(res.status).toBe(404);
        });
    });

    describe('DELETE /api/workspaces/:id/work-items/:workItemId', () => {
        it('deletes a work item', async () => {
            const created = await request('POST', `/api/workspaces/${REPO_ID}/work-items`, {
                title: 'Deletable',
            });
            const id = created.body.id;

            const res = await request('DELETE', `/api/workspaces/${REPO_ID}/work-items/${id}`);
            expect(res.status).toBe(204);

            // Verify it's gone
            const getRes = await request('GET', `/api/workspaces/${REPO_ID}/work-items/${id}`);
            expect(getRes.status).toBe(404);
        });

        it('returns 404 for non-existent item', async () => {
            const res = await request('DELETE', `/api/workspaces/${REPO_ID}/work-items/nonexistent`);
            expect(res.status).toBe(404);
        });
    });
});
