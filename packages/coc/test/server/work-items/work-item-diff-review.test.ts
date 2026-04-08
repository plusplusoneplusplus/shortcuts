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

const REPO_ID = 'test-repo';

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

/** Helper: create work item and transition to aiDone. */
async function createAiDoneItem(planContent = '# Original plan'): Promise<string> {
    const created = await request('POST', `/api/workspaces/${REPO_ID}/work-items`, {
        title: 'Review item',
        plan: { content: planContent },
    });
    const id = created.body.id;
    await request('PATCH', `/api/workspaces/${REPO_ID}/work-items/${id}`, { status: 'planning' });
    await request('PATCH', `/api/workspaces/${REPO_ID}/work-items/${id}`, { status: 'readyToExecute' });
    await request('PATCH', `/api/workspaces/${REPO_ID}/work-items/${id}`, { status: 'executing' });
    await request('PATCH', `/api/workspaces/${REPO_ID}/work-items/${id}`, { status: 'aiDone' });
    return id;
}

beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'coc-wi-diff-'));
    store = new FileWorkItemStore({ dataDir: tmpDir });
    server = makeServer();
    await startServer();
});

afterEach(async () => {
    await stopServer();
    await fs.rm(tmpDir, { recursive: true, force: true });
});

describe('request-changes with source=diff-comments', () => {
    it('uses "Diff Review Comments" heading when source is diff-comments', async () => {
        const itemId = await createAiDoneItem();
        const res = await request('POST', `/api/workspaces/${REPO_ID}/work-items/${itemId}/request-changes`, {
            comments: [
                '[src/auth.ts:42] Missing null check (code: `user.name`)',
                '[src/api.ts:10] Should validate input',
            ],
            source: 'diff-comments',
        });

        expect(res.status).toBe(200);
        expect(res.body.plan.content).toContain('## Diff Review Comments (to address)');
        expect(res.body.plan.content).toContain('[src/auth.ts:42]');
        expect(res.body.plan.content).toContain('[src/api.ts:10]');
        expect(res.body.plan.summary).toContain('diff review comment');
    });

    it('uses standard heading when source is not specified', async () => {
        const itemId = await createAiDoneItem();
        const res = await request('POST', `/api/workspaces/${REPO_ID}/work-items/${itemId}/request-changes`, {
            comments: ['Fix something'],
        });

        expect(res.status).toBe(200);
        expect(res.body.plan.content).toContain('## Review Comments (to address)');
        expect(res.body.plan.content).not.toContain('Diff Review');
    });

    it('transitions to readyToExecute after diff comment review', async () => {
        const itemId = await createAiDoneItem();
        await request('POST', `/api/workspaces/${REPO_ID}/work-items/${itemId}/request-changes`, {
            comments: ['[file.ts:1] Fix this'],
            source: 'diff-comments',
        });

        const detail = await request('GET', `/api/workspaces/${REPO_ID}/work-items/${itemId}`);
        expect(detail.body.status).toBe('readyToExecute');
    });

    it('increments plan version correctly', async () => {
        const itemId = await createAiDoneItem();
        const res = await request('POST', `/api/workspaces/${REPO_ID}/work-items/${itemId}/request-changes`, {
            comments: ['[file.ts:1] Issue'],
            source: 'diff-comments',
        });

        expect(res.body.newVersion).toBe(2);
        expect(res.body.plan.version).toBe(2);
    });

    it('appends diff comments to existing plan content', async () => {
        const itemId = await createAiDoneItem('# My Plan\n\n- Step 1\n- Step 2');
        const res = await request('POST', `/api/workspaces/${REPO_ID}/work-items/${itemId}/request-changes`, {
            comments: ['[src/index.ts:5] Add error handling (code: `doSomething()`)'],
            source: 'diff-comments',
        });

        expect(res.body.plan.content).toMatch(/# My Plan/);
        expect(res.body.plan.content).toMatch(/- Step 1/);
        expect(res.body.plan.content).toMatch(/## Diff Review Comments/);
        expect(res.body.plan.content).toMatch(/\[src\/index\.ts:5\]/);
    });

    it('rejects when status is not aiDone', async () => {
        const created = await request('POST', `/api/workspaces/${REPO_ID}/work-items`, {
            title: 'Not ready',
        });
        const id = created.body.id;

        const res = await request('POST', `/api/workspaces/${REPO_ID}/work-items/${id}/request-changes`, {
            comments: ['[file.ts:1] Issue'],
            source: 'diff-comments',
        });
        expect(res.status).toBe(400);
    });

    it('rejects empty comments even with source flag', async () => {
        const itemId = await createAiDoneItem();
        const res = await request('POST', `/api/workspaces/${REPO_ID}/work-items/${itemId}/request-changes`, {
            comments: [],
            source: 'diff-comments',
        });
        expect(res.status).toBe(400);
    });
});
