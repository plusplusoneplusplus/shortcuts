import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as http from 'http';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import type { Route } from '../../../src/server/types';
import { createRouter } from '../../../src/server/shared/router';
import { registerWorkItemRoutes } from '../../../src/server/routes/work-item-routes';
import { registerWorkItemPlanRoutes } from '../../../src/server/routes/work-item-plan-routes';
import { createWorkItemStorageScopeResolver, FileWorkItemStore } from '../../../src/server/work-items/work-item-store';
import { safeRm } from '../../helpers/safe-rm';

let tmpDir: string;
let store: FileWorkItemStore;
let server: http.Server;
let baseUrl: string;
let workspaces: any[] = [];

const processStore = {
    getWorkspaces: async () => workspaces,
    updateWorkspace: async (workspaceId: string, update: any) => {
        const workspace = workspaces.find(entry => entry.id === workspaceId);
        if (workspace) Object.assign(workspace, update);
    },
} as any;

function makeServer(
    refineWithAI?: (plan: string, desc: string, title: string, instructions?: string) => Promise<string>,
    workflowEnabled = false,
): http.Server {
    const routes: Route[] = [];
    registerWorkItemRoutes({ routes, workItemStore: store, processStore });
    registerWorkItemPlanRoutes({ routes, workItemStore: store, processStore, refineWithAI, getWorkflowEnabled: () => workflowEnabled });
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
const ORIGIN_ID = 'gh_plusplusoneplusplus_shortcuts';
let workItemId: string;

describe('Work Item Plan Routes', () => {
    beforeEach(async () => {
        tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'coc-wi-plan-routes-'));
        workspaces = [];
        store = new FileWorkItemStore({ dataDir: tmpDir, scopeResolver: createWorkItemStorageScopeResolver(processStore) });
        server = makeServer(async (plan, desc, title) => {
            return `# Refined Plan for: ${title}\n\n${plan}\n\n## AI Additions\n- Error handling\n- Tests`;
        });
        await startServer();

        // Create a work item to test plan operations
        const res = await request('POST', `/api/workspaces/${REPO_ID}/work-items`, {
            title: 'Plan test item',
            description: 'Item for testing plans',
        });
        workItemId = res.body.id;
    });

    afterEach(async () => {
        await stopServer();
        await safeRm(tmpDir);
    });

    describe('GET /plan', () => {
        it('returns null plan for item without plan', async () => {
            const res = await request('GET', `/api/workspaces/${REPO_ID}/work-items/${workItemId}/plan`);
            expect(res.status).toBe(200);
            expect(res.body.plan).toBeNull();
            expect(res.body.versions).toBe(0);
        });

        it('returns current plan after PUT', async () => {
            await request('PUT', `/api/workspaces/${REPO_ID}/work-items/${workItemId}/plan`, {
                content: '# Step 1\nDo things',
            });

            const res = await request('GET', `/api/workspaces/${REPO_ID}/work-items/${workItemId}/plan`);
            expect(res.status).toBe(200);
            expect(res.body.plan.version).toBe(1);
            expect(res.body.plan.content).toBe('# Step 1\nDo things');
            expect(res.body.versions).toBe(1);
        });

        it('returns 404 for non-existent work item', async () => {
            const res = await request('GET', `/api/workspaces/${REPO_ID}/work-items/nonexistent/plan`);
            expect(res.status).toBe(404);
        });
    });

    describe('origin-scoped plan routes', () => {
        beforeEach(() => {
            workspaces = [
                {
                    id: 'clone-a',
                    name: 'Clone A',
                    rootPath: path.join(tmpDir, 'clone-a'),
                    remoteUrl: 'https://github.com/plusplusoneplusplus/shortcuts.git',
                },
                {
                    id: 'clone-b',
                    name: 'Clone B',
                    rootPath: path.join(tmpDir, 'clone-b'),
                    remoteUrl: 'git@github.com:plusplusoneplusplus/shortcuts.git',
                },
                {
                    id: 'other-clone',
                    name: 'Other Clone',
                    rootPath: path.join(tmpDir, 'other-clone'),
                    remoteUrl: 'https://github.com/plusplusoneplusplus/other.git',
                },
            ];
        });

        it('serves plan versions through the canonical origin across same-origin clones', async () => {
            const create = await request('POST', '/api/workspaces/clone-a/work-items', {
                id: 'shared-plan',
                title: 'Shared Plan',
            });
            expect(create.status).toBe(201);

            const update = await request('PUT', `/api/origins/${ORIGIN_ID}/work-items/shared-plan/plan`, {
                workspaceId: 'clone-b',
                content: 'origin plan v1',
                summary: 'Origin update',
            });
            expect(update.status).toBe(200);
            expect(update.body.version).toBe(1);

            const originVersions = await request('GET', `/api/origins/${ORIGIN_ID}/work-items/shared-plan/plan/versions`);
            expect(originVersions.status).toBe(200);
            expect(originVersions.body).toHaveLength(1);
            expect(originVersions.body[0].content).toBe('origin plan v1');

            const cloneRead = await request('GET', '/api/workspaces/clone-b/work-items/shared-plan/plan');
            expect(cloneRead.status).toBe(200);
            expect(cloneRead.body.plan.content).toBe('origin plan v1');

            const mismatch = await request('GET', `/api/origins/${ORIGIN_ID}/work-items/shared-plan/plan?workspaceId=other-clone`);
            expect(mismatch.status).toBe(400);
            expect(mismatch.body.error).toContain("resolves to origin 'gh_plusplusoneplusplus_other'");
        });

        it('keeps same work item IDs isolated across distinct origins', async () => {
            await request('POST', '/api/workspaces/clone-a/work-items', {
                id: 'same-id-plan',
                title: 'Shared Origin Plan',
            });
            await request('POST', '/api/workspaces/other-clone/work-items', {
                id: 'same-id-plan',
                title: 'Other Origin Plan',
            });

            const sharedUpdate = await request('PUT', `/api/origins/${ORIGIN_ID}/work-items/same-id-plan/plan`, {
                content: 'shared origin plan',
            });
            expect(sharedUpdate.status).toBe(200);

            const otherUpdate = await request('PUT', '/api/origins/gh_plusplusoneplusplus_other/work-items/same-id-plan/plan', {
                content: 'other origin plan',
            });
            expect(otherUpdate.status).toBe(200);

            const sharedPlan = await request('GET', `/api/origins/${ORIGIN_ID}/work-items/same-id-plan/plan`);
            const otherPlan = await request('GET', '/api/origins/gh_plusplusoneplusplus_other/work-items/same-id-plan/plan');

            expect(sharedPlan.body.plan.content).toBe('shared origin plan');
            expect(otherPlan.body.plan.content).toBe('other origin plan');
        });
    });

    describe('PUT /plan', () => {
        it('creates first plan version', async () => {
            const res = await request('PUT', `/api/workspaces/${REPO_ID}/work-items/${workItemId}/plan`, {
                content: 'Plan v1 content',
                resolvedBy: 'user',
                reason: 'Initial user draft',
            });

            expect(res.status).toBe(200);
            expect(res.body.version).toBe(1);
            expect(res.body.plan.content).toBe('Plan v1 content');
            expect(res.body.plan.resolvedBy).toBe('user');
            expect(res.body.plan.source).toBe('user');
            expect(res.body.plan.authorType).toBe('user');
            expect(res.body.plan.reason).toBe('Initial user draft');

            const detail = await request('GET', `/api/workspaces/${REPO_ID}/work-items/${workItemId}`);
            expect(detail.body.currentContentVersion).toBe(1);
            expect(detail.body.plan.currentVersion).toBe(1);
        });

        it('auto-increments version', async () => {
            await request('PUT', `/api/workspaces/${REPO_ID}/work-items/${workItemId}/plan`, {
                content: 'v1',
            });
            const res = await request('PUT', `/api/workspaces/${REPO_ID}/work-items/${workItemId}/plan`, {
                content: 'v2',
                summary: 'Added error handling',
            });

            expect(res.status).toBe(200);
            expect(res.body.version).toBe(2);
        });

        it('rejects missing content', async () => {
            const res = await request('PUT', `/api/workspaces/${REPO_ID}/work-items/${workItemId}/plan`, {
                summary: 'No content',
            });
            expect(res.status).toBe(400);
        });

        it('rejects blank content without creating a plan version', async () => {
            const res = await request('PUT', `/api/workspaces/${REPO_ID}/work-items/${workItemId}/plan`, {
                content: '   \n\t  ',
                summary: 'Blank content',
            });

            expect(res.status).toBe(400);
            expect(await store.getPlanVersions(workItemId)).toEqual([]);

            const detail = await request('GET', `/api/workspaces/${REPO_ID}/work-items/${workItemId}`);
            expect(detail.status).toBe(200);
            expect(detail.body.plan).toBeUndefined();
        });

        it('returns 404 for non-existent work item', async () => {
            const res = await request('PUT', `/api/workspaces/${REPO_ID}/work-items/nonexistent/plan`, {
                content: 'Plan',
            });
            expect(res.status).toBe(404);
        });
    });

    describe('GET /plan/versions', () => {
        it('lists all plan versions', async () => {
            await request('PUT', `/api/workspaces/${REPO_ID}/work-items/${workItemId}/plan`, {
                content: 'v1',
            });
            await request('PUT', `/api/workspaces/${REPO_ID}/work-items/${workItemId}/plan`, {
                content: 'v2',
            });
            await request('PUT', `/api/workspaces/${REPO_ID}/work-items/${workItemId}/plan`, {
                content: 'v3',
            });

            const res = await request('GET', `/api/workspaces/${REPO_ID}/work-items/${workItemId}/plan/versions`);
            expect(res.status).toBe(200);
            expect(res.body).toHaveLength(3);
            expect(res.body[0].version).toBe(1);
            expect(res.body[1].version).toBe(2);
            expect(res.body[2].version).toBe(3);
        });

        it('returns empty for item without plans', async () => {
            const res = await request('GET', `/api/workspaces/${REPO_ID}/work-items/${workItemId}/plan/versions`);
            expect(res.status).toBe(200);
            expect(res.body).toEqual([]);
        });
    });

    describe('GET /plan/versions/:v', () => {
        it('retrieves specific version', async () => {
            await request('PUT', `/api/workspaces/${REPO_ID}/work-items/${workItemId}/plan`, {
                content: 'First plan',
                resolvedBy: 'user',
            });
            await request('PUT', `/api/workspaces/${REPO_ID}/work-items/${workItemId}/plan`, {
                content: 'Second plan',
                resolvedBy: 'ai',
            });

            const v1 = await request('GET', `/api/workspaces/${REPO_ID}/work-items/${workItemId}/plan/versions/1`);
            expect(v1.status).toBe(200);
            expect(v1.body.content).toBe('First plan');
            expect(v1.body.resolvedBy).toBe('user');

            const v2 = await request('GET', `/api/workspaces/${REPO_ID}/work-items/${workItemId}/plan/versions/2`);
            expect(v2.status).toBe(200);
            expect(v2.body.content).toBe('Second plan');
            expect(v2.body.resolvedBy).toBe('ai');
        });

        it('returns 404 for non-existent version', async () => {
            const res = await request('GET', `/api/workspaces/${REPO_ID}/work-items/${workItemId}/plan/versions/99`);
            expect(res.status).toBe(404);
        });
    });

    describe('workflow-gated version compare and restore', () => {
        it('requires the workflow flag for compare and restore actions', async () => {
            await request('PUT', `/api/workspaces/${REPO_ID}/work-items/${workItemId}/plan`, {
                content: 'v1',
            });

            const compare = await request('GET', `/api/workspaces/${REPO_ID}/work-items/${workItemId}/plan/versions/compare?base=1&target=1`);
            expect(compare.status).toBe(403);

            const restore = await request('POST', `/api/workspaces/${REPO_ID}/work-items/${workItemId}/plan/versions/1/restore`, {});
            expect(restore.status).toBe(403);
        });

        it('compares two local-only work item versions when workflow is enabled', async () => {
            await stopServer();
            server = makeServer(undefined, true);
            await startServer();
            const item = await request('POST', `/api/workspaces/${REPO_ID}/work-items`, { title: 'Compare item' });
            await request('PUT', `/api/workspaces/${REPO_ID}/work-items/${item.body.id}/plan`, { content: 'one\ntwo\nthree' });
            await request('PUT', `/api/workspaces/${REPO_ID}/work-items/${item.body.id}/plan`, { content: 'one\nTWO\nthree\nfour' });

            const res = await request('GET', `/api/workspaces/${REPO_ID}/work-items/${item.body.id}/plan/versions/compare?base=1&target=2`);

            expect(res.status).toBe(200);
            expect(res.body.base.version).toBe(1);
            expect(res.body.target.version).toBe(2);
            expect(res.body.diff).toEqual([
                { type: 'equal', lines: ['one'] },
                { type: 'removed', lines: ['two'] },
                { type: 'added', lines: ['TWO'] },
                { type: 'equal', lines: ['three'] },
                { type: 'added', lines: ['four'] },
            ]);
        });

        it('restores an older local-only goal version by creating a new current version', async () => {
            await stopServer();
            server = makeServer(undefined, true);
            await startServer();
            const item = await request('POST', `/api/workspaces/${REPO_ID}/work-items`, {
                title: 'Goal item',
                type: 'goal',
            });
            await request('PUT', `/api/workspaces/${REPO_ID}/work-items/${item.body.id}/plan`, {
                content: 'goal spec v1',
                resolvedBy: 'ai',
            });
            await request('PUT', `/api/workspaces/${REPO_ID}/work-items/${item.body.id}/plan`, {
                content: 'goal spec v2',
                resolvedBy: 'user',
            });

            const restore = await request('POST', `/api/workspaces/${REPO_ID}/work-items/${item.body.id}/plan/versions/1/restore`, {
                reason: 'Restore clearer goal spec',
            });
            expect(restore.status).toBe(200);
            expect(restore.body).toMatchObject({
                version: 3,
                restoredFromVersion: 1,
                plan: {
                    version: 3,
                    content: 'goal spec v1',
                    source: 'user',
                    authorType: 'user',
                    reason: 'Restore clearer goal spec',
                    restoredFromVersion: 1,
                },
            });

            const detail = await request('GET', `/api/workspaces/${REPO_ID}/work-items/${item.body.id}`);
            expect(detail.body.currentContentVersion).toBe(3);
            expect(detail.body.plan.currentVersion).toBe(3);
            expect(detail.body.plan.content).toBe('goal spec v1');

            const versions = await request('GET', `/api/workspaces/${REPO_ID}/work-items/${item.body.id}/plan/versions`);
            expect(versions.body.map((version: any) => version.version)).toEqual([1, 2, 3]);
            expect(versions.body[2].restoredFromVersion).toBe(1);
        });

        it('rejects workflow version actions for remote-backed items', async () => {
            await stopServer();
            server = makeServer(undefined, true);
            await startServer();
            const item = await request('POST', `/api/workspaces/${REPO_ID}/work-items`, { title: 'Remote item' });
            await store.updateWorkItem(item.body.id, {
                githubMirror: {
                    issueNumber: 123,
                    issueUrl: 'https://github.com/example/repo/issues/123',
                },
            });
            await request('PUT', `/api/workspaces/${REPO_ID}/work-items/${item.body.id}/plan`, { content: 'v1' });

            const res = await request('GET', `/api/workspaces/${REPO_ID}/work-items/${item.body.id}/plan/versions/compare?base=1&target=1`);
            expect(res.status).toBe(400);
            expect(res.body.error).toContain('local-only work-item and goal');
        });
    });

    describe('POST /plan/refine', () => {
        it('refines existing plan with AI', async () => {
            await request('PUT', `/api/workspaces/${REPO_ID}/work-items/${workItemId}/plan`, {
                content: 'Original plan content',
            });

            const res = await request('POST', `/api/workspaces/${REPO_ID}/work-items/${workItemId}/plan/refine`, {});

            expect(res.status).toBe(200);
            expect(res.body.version).toBe(2);
            expect(res.body.previousVersion).toBe(1);
            expect(res.body.plan.resolvedBy).toBe('ai');
            expect(res.body.plan.content).toContain('Refined Plan');
            expect(res.body.plan.content).toContain('AI Additions');
        });

        it('forwards instructions to refineWithAI callback', async () => {
            await stopServer();
            const received: string[] = [];
            server = makeServer(async (plan, desc, title, instructions) => {
                received.push(instructions ?? '');
                return `# Plan\n${plan}\nInstructions used: ${instructions}`;
            });
            await startServer();
            const item = await request('POST', `/api/workspaces/${REPO_ID}/work-items`, { title: 'Instr test' });
            await request('PUT', `/api/workspaces/${REPO_ID}/work-items/${item.body.id}/plan`, { content: 'Base plan' });

            const res = await request('POST', `/api/workspaces/${REPO_ID}/work-items/${item.body.id}/plan/refine`, {
                instructions: 'Add error handling',
            });

            expect(res.status).toBe(200);
            expect(received[0]).toBe('Add error handling');
            expect(res.body.plan.content).toContain('Instructions used: Add error handling');
            expect(res.body.plan.summary).toContain('Add error handling');
        });

        it('returns 400 when no plan exists', async () => {
            const res = await request('POST', `/api/workspaces/${REPO_ID}/work-items/${workItemId}/plan/refine`, {});
            expect(res.status).toBe(400);
            expect(res.body.error).toContain('no plan');
        });

        it('returns 404 for non-existent work item', async () => {
            const res = await request('POST', `/api/workspaces/${REPO_ID}/work-items/nonexistent/plan/refine`, {});
            expect(res.status).toBe(404);
        });
    });

    describe('POST /plan/refine without AI', () => {
        it('returns 400 when AI is not available', async () => {
            await stopServer();
            server = makeServer(undefined); // no AI
            await startServer();

            // Create item and plan in new server instance
            const item = await request('POST', `/api/workspaces/${REPO_ID}/work-items`, {
                title: 'No AI item',
            });
            await request('PUT', `/api/workspaces/${REPO_ID}/work-items/${item.body.id}/plan`, {
                content: 'Some plan',
            });

            const res = await request('POST', `/api/workspaces/${REPO_ID}/work-items/${item.body.id}/plan/refine`, {});
            expect(res.status).toBe(400);
            expect(res.body.error).toContain('not available');
        });
    });
});
