import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as http from 'http';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import type { Route } from '../../../src/server/types';
import { createRouter } from '../../../src/server/shared/router';
import { registerWorkItemRoutes } from '../../../src/server/routes/work-item-routes';
import { FileWorkItemStore } from '../../../src/server/work-items/work-item-store';
import { clearWorkItemResponseCache } from '../../../src/server/work-items/work-item-response-cache';

let tmpDir: string;
let store: FileWorkItemStore;
let server: http.Server;
let baseUrl: string;

const SYNC_LINK = {
    provider: 'github',
    remote: {
        owner: 'plusplusoneplusplus',
        repo: 'shortcuts',
        issueId: 'I_kwDOExample',
        issueNumber: 42,
        issueUrl: 'https://github.com/plusplusoneplusplus/shortcuts/issues/42',
    },
    remoteRevision: 'etag-1',
    remoteUpdatedAt: '2026-01-02T00:00:00.000Z',
    lastSyncedAt: '2026-01-02T01:00:00.000Z',
    lastSyncedFingerprint: 'fingerprint-1',
    parent: {
        workItemId: 'parent-1',
        issueNumber: 7,
        issueUrl: 'https://github.com/plusplusoneplusplus/shortcuts/issues/7',
    },
};

function makeServer(processStore: any = { getWorkspaces: async () => [] }): http.Server {
    const routes: Route[] = [];
    registerWorkItemRoutes({ routes, workItemStore: store, processStore });
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

async function restartWithOriginScopedServer(): Promise<void> {
    await stopServer();
    store = new FileWorkItemStore({
        dataDir: tmpDir,
        scopeResolver: repoId => {
            if (repoId === 'clone-a' || repoId === 'clone-b' || repoId === 'gh_owner_repo') {
                return { storageRepoId: 'gh_owner_repo', legacyRepoIds: ['clone-a', 'clone-b'] };
            }
            if (repoId === 'other-clone' || repoId === 'gh_owner_other') {
                return { storageRepoId: 'gh_owner_other', legacyRepoIds: ['other-clone'] };
            }
            return undefined;
        },
    });
    const processStore = {
        getWorkspaces: async () => [
            {
                id: 'clone-a',
                name: 'Clone A',
                rootPath: path.join(tmpDir, 'clone-a'),
                remoteUrl: 'https://github.com/owner/repo.git',
            },
            {
                id: 'clone-b',
                name: 'Clone B',
                rootPath: path.join(tmpDir, 'clone-b'),
                remoteUrl: 'git@github.com:owner/repo.git',
            },
            {
                id: 'other-clone',
                name: 'Other Clone',
                rootPath: path.join(tmpDir, 'other-clone'),
                remoteUrl: 'https://github.com/owner/other.git',
            },
        ],
        updateWorkspace: async () => undefined,
    };
    server = makeServer(processStore);
    await startServer();
}

beforeEach(async () => {
    clearWorkItemResponseCache();
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'coc-wi-routes-'));
    store = new FileWorkItemStore({ dataDir: tmpDir });
    server = makeServer();
    await startServer();
});

afterEach(async () => {
    await stopServer();
    clearWorkItemResponseCache();
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

        it('creates a bug with type field', async () => {
            const res = await request('POST', `/api/workspaces/${REPO_ID}/work-items`, {
                title: 'Crash on startup',
                type: 'bug',
                priority: 'high',
            });

            expect(res.status).toBe(201);
            expect(res.body.title).toBe('Crash on startup');
            expect(res.body.type).toBe('bug');
            expect(res.body.priority).toBe('high');
        });

        it('creates a goal with type and successCriteria', async () => {
            const res = await request('POST', `/api/workspaces/${REPO_ID}/work-items`, {
                title: 'Improve onboarding',
                type: 'goal',
                successCriteria: 'New users complete setup in under 5 minutes',
            });

            expect(res.status).toBe(201);
            expect(res.body.type).toBe('goal');
            expect(res.body.successCriteria).toBe('New users complete setup in under 5 minutes');
        });

        it('rejects legacy syncLinks metadata on create', async () => {
            const res = await request('POST', `/api/workspaces/${REPO_ID}/work-items`, {
                title: 'Synced task',
                syncLinks: [SYNC_LINK],
            });

            expect(res.status).toBe(400);
            expect(res.body.error).toContain('syncLinks are no longer accepted');

            const list = await request('GET', `/api/workspaces/${REPO_ID}/work-items`);
            expect(list.status).toBe(200);
            expect(list.body.items).toEqual([]);
        });

        it('omits blank successCriteria on create', async () => {
            const res = await request('POST', `/api/workspaces/${REPO_ID}/work-items`, {
                title: 'Goal without criteria',
                type: 'goal',
                successCriteria: '   ',
            });

            expect(res.status).toBe(201);
            expect(res.body.successCriteria).toBeUndefined();
        });

        it('rejects hierarchy container types when hierarchy flag is disabled', async () => {
            const res = await request('POST', `/api/workspaces/${REPO_ID}/work-items`, {
                title: 'Invalid type',
                type: 'epic',
            });

            expect(res.status).toBe(400);
        });

        it('ignores genuinely unknown type values', async () => {
            const res = await request('POST', `/api/workspaces/${REPO_ID}/work-items`, {
                title: 'Unknown type',
                type: 'unknown-type-xyz',
            });

            expect(res.status).toBe(201);
            expect(res.body.type).toBeUndefined();
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
            expect(res.body.items).toHaveLength(2);
            expect(res.body.total).toBe(2);
        });

        it('filters by status', async () => {
            const res = await request('GET', `/api/workspaces/${REPO_ID}/work-items?status=created`);
            expect(res.status).toBe(200);
            expect(res.body.items).toHaveLength(2); // both are 'created'
        });

        it('filters by source', async () => {
            const res = await request('GET', `/api/workspaces/${REPO_ID}/work-items?source=chat`);
            expect(res.status).toBe(200);
            expect(res.body.items).toHaveLength(1);
            expect(res.body.items[0].title).toBe('Item B');
        });

        it('filters by priority', async () => {
            const res = await request('GET', `/api/workspaces/${REPO_ID}/work-items?priority=high`);
            expect(res.status).toBe(200);
            expect(res.body.items).toHaveLength(1);
            expect(res.body.items[0].title).toBe('Item A');
        });

        it('returns empty for unknown repo', async () => {
            const res = await request('GET', `/api/workspaces/unknown-repo/work-items`);
            expect(res.status).toBe(200);
            expect(res.body.items).toEqual([]);
            expect(res.body.total).toBe(0);
        });

        it('serves cached list responses until force=true requests a live refresh', async () => {
            const first = await request('GET', `/api/workspaces/${REPO_ID}/work-items?limit=10`);
            expect(first.status).toBe(200);
            expect(first.body.total).toBe(2);

            await store.addWorkItem({
                id: 'direct-store-item',
                repoId: REPO_ID,
                title: 'Direct Store Item',
                description: '',
                status: 'created',
                createdAt: '2026-01-01T00:00:00.000Z',
                updatedAt: '2026-01-01T00:00:00.000Z',
                source: 'manual',
            });

            const cached = await request('GET', `/api/workspaces/${REPO_ID}/work-items?limit=10`);
            expect(cached.status).toBe(200);
            expect(cached.body.total).toBe(2);

            const forced = await request('GET', `/api/workspaces/${REPO_ID}/work-items?limit=10&force=true`);
            expect(forced.status).toBe(200);
            expect(forced.body.total).toBe(3);

            const refreshedCache = await request('GET', `/api/workspaces/${REPO_ID}/work-items?limit=10`);
            expect(refreshedCache.status).toBe(200);
            expect(refreshedCache.body.total).toBe(3);
        });

        it('clears cached grouped responses after route-created work items', async () => {
            const first = await request('GET', `/api/workspaces/${REPO_ID}/work-items/grouped?limit=20`);
            expect(first.status).toBe(200);
            expect(first.body.groups.created.total).toBe(2);

            const created = await request('POST', `/api/workspaces/${REPO_ID}/work-items`, {
                title: 'Route-created item',
            });
            expect(created.status).toBe(201);

            const afterCreate = await request('GET', `/api/workspaces/${REPO_ID}/work-items/grouped?limit=20`);
            expect(afterCreate.status).toBe(200);
            expect(afterCreate.body.groups.created.total).toBe(3);
        });

        it('serves core Work Item state through the canonical origin shared by same-origin clones', async () => {
            await restartWithOriginScopedServer();

            const warmed = await request('GET', '/api/workspaces/clone-b/work-items?limit=20');
            expect(warmed.status).toBe(200);
            expect(warmed.body.total).toBe(0);

            const created = await request('POST', '/api/workspaces/clone-a/work-items', {
                title: 'Shared origin task',
            });
            expect(created.status).toBe(201);
            expect(created.body.repoId).toBe('clone-a');

            const originList = await request('GET', '/api/origins/gh_owner_repo/work-items?limit=20');
            expect(originList.status).toBe(200);
            expect(originList.body.items.map((item: any) => item.id)).toEqual([created.body.id]);

            const cloneList = await request('GET', '/api/workspaces/clone-b/work-items?limit=20');
            expect(cloneList.status).toBe(200);
            expect(cloneList.body.items.map((item: any) => item.id)).toEqual([created.body.id]);

            const updated = await request(
                'PATCH',
                `/api/origins/gh_owner_repo/work-items/${created.body.id}?workspaceId=clone-a`,
                { title: 'Updated through origin' },
            );
            expect(updated.status).toBe(200);
            expect(updated.body.title).toBe('Updated through origin');

            const detailFromOtherClone = await request('GET', `/api/workspaces/clone-b/work-items/${created.body.id}`);
            expect(detailFromOtherClone.status).toBe(200);
            expect(detailFromOtherClone.body.title).toBe('Updated through origin');
        });

        it('keeps origin PATCH plan versions isolated for duplicate Work Item IDs', async () => {
            await restartWithOriginScopedServer();

            const shared = await request('POST', '/api/workspaces/clone-a/work-items', {
                id: 'duplicate-plan-id',
                title: 'Shared origin task',
            });
            expect(shared.status).toBe(201);
            const other = await request('POST', '/api/workspaces/other-clone/work-items', {
                id: 'duplicate-plan-id',
                title: 'Other origin task',
            });
            expect(other.status).toBe(201);

            const sharedUpdate = await request('PATCH', '/api/origins/gh_owner_repo/work-items/duplicate-plan-id', {
                plan: { content: '# Shared origin plan', resolvedBy: 'user' },
            });
            expect(sharedUpdate.status).toBe(200);
            const otherUpdate = await request('PATCH', '/api/origins/gh_owner_other/work-items/duplicate-plan-id', {
                plan: { content: '# Other origin plan', resolvedBy: 'user' },
            });
            expect(otherUpdate.status).toBe(200);

            const sharedDetail = await request('GET', '/api/origins/gh_owner_repo/work-items/duplicate-plan-id');
            const otherDetail = await request('GET', '/api/origins/gh_owner_other/work-items/duplicate-plan-id');
            expect(sharedDetail.body.plan.content).toBe('# Shared origin plan');
            expect(otherDetail.body.plan.content).toBe('# Other origin plan');

            const sharedVersions = await store.getPlanVersions('duplicate-plan-id', 'gh_owner_repo');
            const otherVersions = await store.getPlanVersions('duplicate-plan-id', 'gh_owner_other');
            expect(sharedVersions.map(version => version.content)).toEqual(['# Shared origin plan']);
            expect(otherVersions.map(version => version.content)).toEqual(['# Other origin plan']);
        });

        it('rejects an explicit workspaceId that resolves to a different origin', async () => {
            await restartWithOriginScopedServer();

            const res = await request('GET', '/api/origins/gh_owner_repo/work-items?workspaceId=other-clone');
            expect(res.status).toBe(400);
            expect(res.body.error).toContain("not 'gh_owner_repo'");
        });

        it('filters by type', async () => {
            await request('POST', `/api/workspaces/${REPO_ID}/work-items`, {
                title: 'Bug item', type: 'bug',
            });

            const bugs = await request('GET', `/api/workspaces/${REPO_ID}/work-items?type=bug`);
            expect(bugs.status).toBe(200);
            expect(bugs.body.items).toHaveLength(1);
            expect(bugs.body.items[0].title).toBe('Bug item');

            const workItems = await request('GET', `/api/workspaces/${REPO_ID}/work-items?type=work-item`);
            expect(workItems.status).toBe(200);
            // Item A and Item B have no type, so they default to 'work-item'
            expect(workItems.body.items).toHaveLength(2);
        });

        describe('pagination and search', () => {
            it('respects limit parameter', async () => {
                // Parent beforeEach creates 2 items; add 3 more for 5 total
                for (let i = 1; i <= 3; i++) {
                    await request('POST', `/api/workspaces/${REPO_ID}/work-items`, {
                        title: `Extra ${i}`,
                    });
                }

                const res = await request('GET', `/api/workspaces/${REPO_ID}/work-items?limit=2`);
                expect(res.status).toBe(200);
                expect(res.body.items).toHaveLength(2);
                expect(res.body.total).toBe(5);
                expect(res.body.hasMore).toBe(true);
            });

            it('respects offset parameter', async () => {
                // Parent creates 2; add 3 more for 5 total
                for (let i = 1; i <= 3; i++) {
                    await request('POST', `/api/workspaces/${REPO_ID}/work-items`, {
                        title: `Extra ${i}`,
                    });
                }

                const res = await request('GET', `/api/workspaces/${REPO_ID}/work-items?offset=3&limit=2`);
                expect(res.status).toBe(200);
                expect(res.body.items).toHaveLength(2);
                expect(res.body.total).toBe(5);
                expect(res.body.hasMore).toBe(false);
            });

            it('returns hasMore=false when no more items', async () => {
                // Parent creates 2; add 1 more for 3 total
                await request('POST', `/api/workspaces/${REPO_ID}/work-items`, {
                    title: 'Extra 1',
                });

                const res = await request('GET', `/api/workspaces/${REPO_ID}/work-items?limit=5`);
                expect(res.status).toBe(200);
                expect(res.body.items).toHaveLength(3);
                expect(res.body.hasMore).toBe(false);
            });

            it('defaults to all items when no pagination params', async () => {
                // Parent creates 2; add 1 more for 3 total
                await request('POST', `/api/workspaces/${REPO_ID}/work-items`, {
                    title: 'Extra 1',
                });

                const res = await request('GET', `/api/workspaces/${REPO_ID}/work-items`);
                expect(res.status).toBe(200);
                expect(res.body.items).toHaveLength(3);
                expect(res.body.total).toBe(3);
                expect(res.body.hasMore).toBe(false);
            });

            it('searches by title (case-insensitive)', async () => {
                await request('POST', `/api/workspaces/${REPO_ID}/work-items`, {
                    title: 'Fix login bug',
                });
                await request('POST', `/api/workspaces/${REPO_ID}/work-items`, {
                    title: 'Add payment page',
                });
                await request('POST', `/api/workspaces/${REPO_ID}/work-items`, {
                    title: 'Update login UI',
                });

                const res = await request('GET', `/api/workspaces/${REPO_ID}/work-items?q=login`);
                expect(res.status).toBe(200);
                expect(res.body.items).toHaveLength(2);
                expect(res.body.total).toBe(2);
            });

            it('searches by tags', async () => {
                await request('POST', `/api/workspaces/${REPO_ID}/work-items`, {
                    title: 'UI task',
                    tags: ['frontend'],
                });
                await request('POST', `/api/workspaces/${REPO_ID}/work-items`, {
                    title: 'Server task',
                    tags: ['backend'],
                });

                const res = await request('GET', `/api/workspaces/${REPO_ID}/work-items?q=frontend`);
                expect(res.status).toBe(200);
                expect(res.body.items).toHaveLength(1);
                expect(res.body.items[0].title).toBe('UI task');
            });

            it('search combined with pagination', async () => {
                // Parent creates Item A, Item B (neither contains 'login')
                await request('POST', `/api/workspaces/${REPO_ID}/work-items`, { title: 'Login page fix' });
                await request('POST', `/api/workspaces/${REPO_ID}/work-items`, { title: 'Payment feature' });
                await request('POST', `/api/workspaces/${REPO_ID}/work-items`, { title: 'Login form update' });
                await request('POST', `/api/workspaces/${REPO_ID}/work-items`, { title: 'Dashboard redesign' });
                await request('POST', `/api/workspaces/${REPO_ID}/work-items`, { title: 'Login error handling' });

                // First page: 2 of 3 login matches
                const page1 = await request('GET', `/api/workspaces/${REPO_ID}/work-items?q=login&limit=2&offset=0`);
                expect(page1.status).toBe(200);
                expect(page1.body.items).toHaveLength(2);
                expect(page1.body.total).toBe(3);
                expect(page1.body.hasMore).toBe(true);

                // Second page: 1 remaining match
                const page2 = await request('GET', `/api/workspaces/${REPO_ID}/work-items?q=login&limit=2&offset=2`);
                expect(page2.status).toBe(200);
                expect(page2.body.items).toHaveLength(1);
                expect(page2.body.total).toBe(3);
                expect(page2.body.hasMore).toBe(false);
            });

            it('search combined with existing filters', async () => {
                // Parent creates Item A, Item B (both status 'created', no 'login' in title)
                const created = await request('POST', `/api/workspaces/${REPO_ID}/work-items`, {
                    title: 'Login planning task',
                });
                await request('PATCH', `/api/workspaces/${REPO_ID}/work-items/${created.body.id}`, {
                    status: 'planning',
                });
                await request('POST', `/api/workspaces/${REPO_ID}/work-items`, {
                    title: 'Login created task',
                });

                // Filter by status=created AND q=login
                const res = await request('GET', `/api/workspaces/${REPO_ID}/work-items?status=created&q=login`);
                expect(res.status).toBe(200);
                // Only 'Login created task' matches both filters
                expect(res.body.items).toHaveLength(1);
                expect(res.body.items[0].title).toBe('Login created task');
            });

            it('returns empty results for non-matching search', async () => {
                const res = await request('GET', `/api/workspaces/${REPO_ID}/work-items?q=nonexistent`);
                expect(res.status).toBe(200);
                expect(res.body.items).toEqual([]);
                expect(res.body.total).toBe(0);
                expect(res.body.hasMore).toBe(false);
            });

            it('ignores invalid offset/limit values', async () => {
                // Parent creates 2 items; invalid params should be ignored
                const res1 = await request('GET', `/api/workspaces/${REPO_ID}/work-items?offset=-1`);
                expect(res1.status).toBe(200);
                expect(res1.body.items).toHaveLength(2);

                const res2 = await request('GET', `/api/workspaces/${REPO_ID}/work-items?offset=abc`);
                expect(res2.status).toBe(200);
                expect(res2.body.items).toHaveLength(2);
            });
        });
    });

    describe('GET /api/workspaces/:id/work-items/grouped', () => {
        it('returns items grouped by status', async () => {
            await request('POST', `/api/workspaces/${REPO_ID}/work-items`, { title: 'Created 1' });
            await request('POST', `/api/workspaces/${REPO_ID}/work-items`, { title: 'Created 2' });
            const item3 = await request('POST', `/api/workspaces/${REPO_ID}/work-items`, { title: 'Will be planning' });
            await request('PATCH', `/api/workspaces/${REPO_ID}/work-items/${item3.body.id}`, { status: 'planning' });

            const res = await request('GET', `/api/workspaces/${REPO_ID}/work-items/grouped`);
            expect(res.status).toBe(200);
            expect(res.body.groups).toBeDefined();
            expect(res.body.groups.created.items).toHaveLength(2);
            expect(res.body.groups.created.total).toBe(2);
            expect(res.body.groups.created.hasMore).toBe(false);
            expect(res.body.groups.planning.items).toHaveLength(1);
            expect(res.body.groups.planning.total).toBe(1);
        });

        it('respects limit parameter per group', async () => {
            for (let i = 0; i < 5; i++) {
                await request('POST', `/api/workspaces/${REPO_ID}/work-items`, { title: `Item ${i}` });
            }

            const res = await request('GET', `/api/workspaces/${REPO_ID}/work-items/grouped?limit=3`);
            expect(res.status).toBe(200);
            expect(res.body.groups.created.items).toHaveLength(3);
            expect(res.body.groups.created.total).toBe(5);
            expect(res.body.groups.created.hasMore).toBe(true);
        });

        it('supports search query across groups', async () => {
            await request('POST', `/api/workspaces/${REPO_ID}/work-items`, { title: 'Login fix' });
            await request('POST', `/api/workspaces/${REPO_ID}/work-items`, { title: 'Dashboard update' });

            const res = await request('GET', `/api/workspaces/${REPO_ID}/work-items/grouped?q=login`);
            expect(res.status).toBe(200);
            expect(res.body.groups.created.items).toHaveLength(1);
            expect(res.body.groups.created.items[0].title).toBe('Login fix');
        });

        it('returns empty groups when no items match search', async () => {
            await request('POST', `/api/workspaces/${REPO_ID}/work-items`, { title: 'Test item' });

            const res = await request('GET', `/api/workspaces/${REPO_ID}/work-items/grouped?q=nonexistent`);
            expect(res.status).toBe(200);
            expect(Object.keys(res.body.groups)).toHaveLength(0);
        });

        it('excludes empty status groups', async () => {
            await request('POST', `/api/workspaces/${REPO_ID}/work-items`, { title: 'Only created' });

            const res = await request('GET', `/api/workspaces/${REPO_ID}/work-items/grouped`);
            expect(res.status).toBe(200);
            expect(Object.keys(res.body.groups)).toEqual(['created']);
            expect(res.body.groups.executing).toBeUndefined();
        });

        it('supports filter params alongside search', async () => {
            await request('POST', `/api/workspaces/${REPO_ID}/work-items`, { title: 'High item', priority: 'high' });
            await request('POST', `/api/workspaces/${REPO_ID}/work-items`, { title: 'Low item', priority: 'low' });

            const res = await request('GET', `/api/workspaces/${REPO_ID}/work-items/grouped?priority=high`);
            expect(res.status).toBe(200);
            expect(res.body.groups.created.items).toHaveLength(1);
            expect(res.body.groups.created.total).toBe(1);
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

            // planning → executing is INVALID (must go through readyToExecute)
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

        it('updates successCriteria and grillSessionId', async () => {
            const res = await request('PATCH', `/api/workspaces/${REPO_ID}/work-items/${itemId}`, {
                successCriteria: 'Ship the feature behind a flag',
                grillSessionId: 'queue_proc-abc',
            });

            expect(res.status).toBe(200);
            expect(res.body.successCriteria).toBe('Ship the feature behind a flag');
            expect(res.body.grillSessionId).toBe('queue_proc-abc');
        });

        it('updates metadata and plan in one PATCH while creating a plan version', async () => {
            const res = await request('PATCH', `/api/workspaces/${REPO_ID}/work-items/${itemId}`, {
                title: 'Updated title',
                description: 'Updated description',
                plan: {
                    content: '# Updated plan',
                    resolvedBy: 'user',
                    summary: 'Inline edit',
                },
            });

            expect(res.status).toBe(200);
            expect(res.body.title).toBe('Updated title');
            expect(res.body.description).toBe('Updated description');
            expect(res.body.plan).toMatchObject({
                version: 1,
                content: '# Updated plan',
                resolvedBy: 'user',
            });

            const versions = await store.getPlanVersions(itemId);
            expect(versions).toHaveLength(1);
            expect(versions[0]).toMatchObject({
                version: 1,
                content: '# Updated plan',
                resolvedBy: 'user',
                summary: 'Inline edit',
            });
        });

        it('rejects blank plan content in a mixed PATCH without partial updates', async () => {
            const res = await request('PATCH', `/api/workspaces/${REPO_ID}/work-items/${itemId}`, {
                title: 'Should not change',
                plan: {
                    content: '   \n\t  ',
                    resolvedBy: 'user',
                },
            });

            expect(res.status).toBe(400);
            expect(res.body.error).toContain('plan.content');
            expect(await store.getPlanVersions(itemId)).toEqual([]);

            const detail = await request('GET', `/api/workspaces/${REPO_ID}/work-items/${itemId}`);
            expect(detail.status).toBe(200);
            expect(detail.body.title).toBe('Patchable item');
            expect(detail.body.plan).toBeUndefined();
        });

        it('does not create a plan version when a mixed PATCH fails validation', async () => {
            const res = await request('PATCH', `/api/workspaces/${REPO_ID}/work-items/${itemId}`, {
                plan: {
                    content: '# Should not persist',
                    resolvedBy: 'user',
                },
                parentId: 'parent-1',
            });

            expect(res.status).toBe(400);
            expect(res.body.error).toContain('parentId requires the workItems.hierarchy feature flag to be enabled');
            expect(await store.getPlanVersions(itemId)).toEqual([]);
        });

        it('rejects legacy syncLinks metadata on update without changing the item', async () => {
            const res = await request('PATCH', `/api/workspaces/${REPO_ID}/work-items/${itemId}`, {
                syncLinks: [SYNC_LINK],
            });

            expect(res.status).toBe(400);
            expect(res.body.error).toContain('syncLinks are no longer accepted');

            const detail = await request('GET', `/api/workspaces/${REPO_ID}/work-items/${itemId}`);
            expect(detail.body.syncLinks).toBeUndefined();
        });

        it('allows the created → drafting transition (goal spec phase)', async () => {
            const res = await request('PATCH', `/api/workspaces/${REPO_ID}/work-items/${itemId}`, {
                status: 'drafting',
            });

            expect(res.status).toBe(200);
            expect(res.body.status).toBe('drafting');
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

    describe('POST /api/workspaces/:id/work-items/:workItemId/request-changes', () => {
        let itemId: string;

        beforeEach(async () => {
            // Create an item and move it to aiDone state
            const created = await request('POST', `/api/workspaces/${REPO_ID}/work-items`, {
                title: 'Review me',
                plan: { content: '# Original plan\n\n1. Do something' },
            });
            itemId = created.body.id;
            // created → planning → readyToExecute → executing → aiDone
            await request('PATCH', `/api/workspaces/${REPO_ID}/work-items/${itemId}`, { status: 'planning' });
            await request('PATCH', `/api/workspaces/${REPO_ID}/work-items/${itemId}`, { status: 'readyToExecute' });
            await request('PATCH', `/api/workspaces/${REPO_ID}/work-items/${itemId}`, { status: 'executing' });
            await request('PATCH', `/api/workspaces/${REPO_ID}/work-items/${itemId}`, { status: 'aiDone' });
        });

        it('incorporates comments into plan and transitions to readyToExecute', async () => {
            const res = await request('POST', `/api/workspaces/${REPO_ID}/work-items/${itemId}/request-changes`, {
                comments: ['Add error handling', 'Fix the auth flow'],
            });

            expect(res.status).toBe(200);
            expect(res.body.newVersion).toBe(2);
            expect(res.body.plan.content).toContain('Review Comments');
            expect(res.body.plan.content).toContain('Add error handling');
            expect(res.body.plan.content).toContain('Fix the auth flow');

            // Verify status transitioned
            const detail = await request('GET', `/api/workspaces/${REPO_ID}/work-items/${itemId}`);
            expect(detail.body.status).toBe('readyToExecute');
            expect(detail.body.plan.version).toBe(2);
        });

        it('rejects empty comments array', async () => {
            const res = await request('POST', `/api/workspaces/${REPO_ID}/work-items/${itemId}/request-changes`, {
                comments: [],
            });
            expect(res.status).toBe(400);
            expect(res.body.error).toContain('comment');
        });

        it('rejects request-changes from non-aiDone status', async () => {
            // Create a fresh item in created status
            const created = await request('POST', `/api/workspaces/${REPO_ID}/work-items`, {
                title: 'Not ready for review',
            });
            const id = created.body.id;

            const res = await request('POST', `/api/workspaces/${REPO_ID}/work-items/${id}/request-changes`, {
                comments: ['Something'],
            });
            expect(res.status).toBe(400);
        });

        it('returns 404 for non-existent work item', async () => {
            const res = await request('POST', `/api/workspaces/${REPO_ID}/work-items/nonexistent/request-changes`, {
                comments: ['Something'],
            });
            expect(res.status).toBe(404);
        });
    });

    describe('workItemNumber', () => {
        it('assigns sequential workItemNumber on create', async () => {
            const res1 = await request('POST', `/api/workspaces/${REPO_ID}/work-items`, { title: 'First' });
            const res2 = await request('POST', `/api/workspaces/${REPO_ID}/work-items`, { title: 'Second' });

            expect(res1.status).toBe(201);
            expect(res1.body.workItemNumber).toBe(1);
            expect(res2.status).toBe(201);
            expect(res2.body.workItemNumber).toBe(2);
        });

        it('includes workItemNumber in list response', async () => {
            await request('POST', `/api/workspaces/${REPO_ID}/work-items`, { title: 'Listed' });

            const res = await request('GET', `/api/workspaces/${REPO_ID}/work-items`);
            expect(res.status).toBe(200);
            expect(res.body.items[0].workItemNumber).toBe(1);
        });

        it('includes workItemNumber in detail response', async () => {
            const created = await request('POST', `/api/workspaces/${REPO_ID}/work-items`, { title: 'Detail' });
            const id = created.body.id;

            const res = await request('GET', `/api/workspaces/${REPO_ID}/work-items/${id}`);
            expect(res.status).toBe(200);
            expect(res.body.workItemNumber).toBe(1);
        });

        it('does not reuse numbers after deletion', async () => {
            const res1 = await request('POST', `/api/workspaces/${REPO_ID}/work-items`, { title: 'A' });
            const res2 = await request('POST', `/api/workspaces/${REPO_ID}/work-items`, { title: 'B' });
            await request('DELETE', `/api/workspaces/${REPO_ID}/work-items/${res2.body.id}`);

            const res3 = await request('POST', `/api/workspaces/${REPO_ID}/work-items`, { title: 'C' });
            expect(res1.body.workItemNumber).toBe(1);
            expect(res3.body.workItemNumber).toBe(3);
        });
    });
});
