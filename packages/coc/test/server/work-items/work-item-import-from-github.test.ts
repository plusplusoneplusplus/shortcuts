import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as http from 'http';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import type { Route } from '../../../src/server/types';
import { createRouter } from '../../../src/server/shared/router';
import { registerWorkItemSyncRoutes } from '../../../src/server/routes/work-item-sync-routes';
import { FileWorkItemStore } from '../../../src/server/work-items/work-item-store';
import type {
    WorkItem,
    WorkItemSyncProviderAdapter,
    WorkItemSyncProviderApplyContext,
    WorkItemSyncProviderPreviewContext,
} from '../../../src/server/work-items';
import type {
    AvailableGitHubWorkItemSyncRepo,
    GitHubWorkItemIssue,
    GitHubWorkItemIssueTransport,
} from '../../../src/server/work-items/work-item-sync-github-provider';
import { importGitHubEpicTreeAsWorkItems } from '../../../src/server/work-items/work-item-sync-github-provider';

const REPO_ID = 'import-test-repo';
const NOW = '2026-01-01T00:00:00.000Z';

const CONFIGURED_OWNER = 'plusplusoneplusplus';
const CONFIGURED_REPO = 'shortcuts';

function makeFakeProvider(): WorkItemSyncProviderAdapter {
    return {
        provider: 'github',
        async getStatus() {
            return {
                provider: 'github',
                available: true,
                repository: {
                    provider: 'github',
                    owner: CONFIGURED_OWNER,
                    repo: CONFIGURED_REPO,
                    url: `https://github.com/${CONFIGURED_OWNER}/${CONFIGURED_REPO}`,
                    source: 'origin',
                },
                auth: {
                    mode: 'external',
                    authenticated: true,
                    message: 'Uses external GitHub authentication.',
                },
            };
        },
        async preview(_context: WorkItemSyncProviderPreviewContext) {
            return {
                provider: 'github',
                operation: _context.operation,
                previewId: 'preview-1',
                generatedAt: NOW,
                itemCount: 0,
                maxItems: 200,
                creates: [],
                updates: [],
                links: [],
                noOps: [],
                warnings: [],
                conflicts: [],
            };
        },
        async apply(_context: WorkItemSyncProviderApplyContext) {
            return {
                provider: 'github',
                operation: _context.operation,
                applied: 0,
                skipped: 0,
                failed: 0,
                rows: [],
                warnings: [],
                conflicts: [],
            };
        },
    };
}

function makeMockIssue(
    issueNumber: number,
    title = 'Test Issue',
    state: 'open' | 'closed' = 'open',
    overrides: Partial<GitHubWorkItemIssue> = {},
): GitHubWorkItemIssue {
    return {
        id: `I_kw${issueNumber}`,
        number: issueNumber,
        title,
        state,
        htmlUrl: `https://github.com/${CONFIGURED_OWNER}/${CONFIGURED_REPO}/issues/${issueNumber}`,
        url: `https://api.github.com/repos/${CONFIGURED_OWNER}/${CONFIGURED_REPO}/issues/${issueNumber}`,
        labels: [],
        body: 'Issue body text',
        updatedAt: NOW,
        ...overrides,
    };
}

function metadataBlock(input: {
    issueNumber: number;
    workItemId?: string;
    type: WorkItem['type'];
    status?: WorkItem['status'];
    parent?: {
        workItemId?: string;
        issueId?: string;
        issueNumber?: number;
        issueUrl?: string;
        owner?: string;
        repo?: string;
    };
}): string {
    return `<!-- coc-work-item-sync ${JSON.stringify({
        schemaVersion: 1,
        provider: 'github',
        remote: {
            owner: CONFIGURED_OWNER,
            repo: CONFIGURED_REPO,
            issueNumber: input.issueNumber,
        },
        workItemId: input.workItemId,
        parent: input.parent,
        type: input.type,
        status: input.status ?? 'created',
        lastSyncedAt: NOW,
    })} -->`;
}

function configuredRepo(): AvailableGitHubWorkItemSyncRepo {
    return {
        available: true,
        provider: 'github',
        owner: CONFIGURED_OWNER,
        repo: CONFIGURED_REPO,
        url: `https://github.com/${CONFIGURED_OWNER}/${CONFIGURED_REPO}`,
        source: 'origin',
    };
}

function makeTransport(issues: Map<number, GitHubWorkItemIssue>): GitHubWorkItemIssueTransport {
    return {
        async getRepository(_repo: AvailableGitHubWorkItemSyncRepo) {
            // no-op
        },
        async listIssues(_repo: AvailableGitHubWorkItemSyncRepo) {
            return [...issues.values()];
        },
        async getIssue(_repo: AvailableGitHubWorkItemSyncRepo, issueNumber: number) {
            return issues.get(issueNumber);
        },
        async createIssue(_repo: AvailableGitHubWorkItemSyncRepo, input: any) {
            const num = 9999;
            const issue: GitHubWorkItemIssue = {
                id: `I_new`,
                number: num,
                title: input.title,
                state: 'open',
                body: input.body ?? '',
                labels: [],
                updatedAt: NOW,
            };
            issues.set(num, issue);
            return issue;
        },
        async updateIssue(_repo: AvailableGitHubWorkItemSyncRepo, issueNumber: number, input: any) {
            const existing = issues.get(issueNumber)!;
            const updated = { ...existing, ...input };
            issues.set(issueNumber, updated);
            return updated;
        },
    };
}

let tmpDir: string;
let store: FileWorkItemStore;
let server: http.Server | undefined;
let baseUrl: string;

function makeServer(issues: Map<number, GitHubWorkItemIssue>, providerAvailable = true): http.Server {
    const routes: Route[] = [];
    const provider = providerAvailable ? makeFakeProvider() : {
        ...makeFakeProvider(),
        async getStatus() {
            return {
                provider: 'github' as const,
                available: false,
                reason: 'no-repo-configured' as const,
                message: 'No GitHub repository configured.',
            };
        },
    };
    registerWorkItemSyncRoutes({
        routes,
        workItemStore: store,
        processStore: {
            getWorkspaces: async () => [{
                id: REPO_ID,
                name: 'Import Test',
                rootPath: tmpDir,
                remoteUrl: `https://github.com/${CONFIGURED_OWNER}/${CONFIGURED_REPO}.git`,
            }],
        } as any,
        dataDir: tmpDir,
        getHierarchyEnabled: () => false,
        getSyncEnabled: () => true,
        providers: [provider],
        githubTransport: makeTransport(issues),
    });
    return http.createServer(createRouter({ routes, spaHtml: '' }));
}

async function startServer(issues: Map<number, GitHubWorkItemIssue>, providerAvailable = true): Promise<void> {
    server = makeServer(issues, providerAvailable);
    await new Promise<void>((resolve, reject) => {
        server!.on('error', reject);
        server!.listen(0, '127.0.0.1', () => {
            const addr = server!.address() as any;
            baseUrl = `http://127.0.0.1:${addr.port}`;
            resolve();
        });
    });
}

async function stopServer(): Promise<void> {
    if (!server) return;
    await new Promise<void>(resolve => server!.close(() => resolve()));
    server = undefined;
}

async function post(urlPath: string, body: unknown = {}): Promise<{ status: number; body: any }> {
    return new Promise((resolve, reject) => {
        const urlObj = new URL(urlPath, baseUrl);
        const payload = JSON.stringify(body);
        const req = http.request({
            hostname: urlObj.hostname,
            port: urlObj.port,
            path: urlObj.pathname,
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) },
        }, res => {
            const chunks: Buffer[] = [];
            res.on('data', (chunk: Buffer) => chunks.push(chunk));
            res.on('end', () => {
                const raw = Buffer.concat(chunks).toString('utf-8');
                let parsed: any = raw;
                try { parsed = raw ? JSON.parse(raw) : undefined; } catch { /* keep raw */ }
                resolve({ status: res.statusCode!, body: parsed });
            });
        });
        req.on('error', reject);
        req.write(payload);
        req.end();
    });
}

function importUrl(repoId: string = REPO_ID): string {
    return `/api/workspaces/${encodeURIComponent(repoId)}/work-items/import-from-github`;
}

function syncUrl(workItemId: string, repoId: string = REPO_ID): string {
    return `/api/workspaces/${encodeURIComponent(repoId)}/work-items/${encodeURIComponent(workItemId)}/sync-from-github`;
}

beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'import-gh-test-'));
    store = new FileWorkItemStore({ dataDir: tmpDir });
});

afterEach(async () => {
    await stopServer();
    await fs.rm(tmpDir, { recursive: true, force: true });
});

describe('POST /api/workspaces/:id/work-items/import-from-github', () => {
    it('imports a GitHub Epic and metadata-parent subtree as a github-backed mirror', async () => {
        const issueNumber = 42;
        const issues = new Map<number, GitHubWorkItemIssue>([
            [issueNumber, makeMockIssue(issueNumber, 'GitHub Epic', 'open', {
                labels: ['customer', 'coc:type:epic'],
                body: 'Epic body',
            })],
            [43, makeMockIssue(43, 'GitHub Feature', 'open', {
                body: `Feature body\n\n${metadataBlock({
                    issueNumber: 43,
                    type: 'feature',
                    parent: { owner: CONFIGURED_OWNER, repo: CONFIGURED_REPO, issueNumber },
                })}`,
            })],
            [44, makeMockIssue(44, 'GitHub PBI', 'closed', {
                body: `PBI body\n\n${metadataBlock({
                    issueNumber: 44,
                    type: 'pbi',
                    parent: { owner: CONFIGURED_OWNER, repo: CONFIGURED_REPO, issueNumber: 43 },
                })}`,
            })],
            [45, makeMockIssue(45, 'Other tree Feature', 'open', {
                body: `Other feature\n\n${metadataBlock({
                    issueNumber: 45,
                    type: 'feature',
                    parent: { owner: CONFIGURED_OWNER, repo: CONFIGURED_REPO, issueNumber: 999 },
                })}`,
            })],
        ]);
        await startServer(issues);

        const res = await post(importUrl(), {
            issueUrl: `https://github.com/${CONFIGURED_OWNER}/${CONFIGURED_REPO}/issues/${issueNumber}`,
        });

        expect(res.status).toBe(201);
        expect(res.body).toMatchObject({
            title: 'GitHub Epic',
            repoId: REPO_ID,
            source: 'manual',
            type: 'epic',
            status: 'created',
            tracker: {
                kind: 'github-backed',
                provider: 'github',
                github: {
                    issueNumber,
                    issueUrl: `https://github.com/${CONFIGURED_OWNER}/${CONFIGURED_REPO}/issues/${issueNumber}`,
                },
            },
            githubMirror: {
                issueNumber,
                state: 'open',
            },
        });
        expect(res.body.syncLinks).toBeUndefined();

        const stored = await store.getWorkItem(res.body.id, REPO_ID);
        expect(stored).toBeDefined();
        expect(stored!.title).toBe('GitHub Epic');

        const all = await store.listWorkItems({ repoId: REPO_ID });
        expect(all.items.map(item => item.title).sort()).toEqual(['GitHub Epic', 'GitHub Feature', 'GitHub PBI']);
        const feature = all.items.find(item => item.title === 'GitHub Feature')!;
        const pbi = all.items.find(item => item.title === 'GitHub PBI')!;
        expect(feature.parentId).toBe(res.body.id);
        expect(pbi.parentId).toBe(feature.id);
        expect(pbi.githubMirror).toMatchObject({ issueNumber: 44, state: 'closed' });

        const githubBacked = await store.listWorkItems({ repoId: REPO_ID, tracker: 'github-backed' });
        expect(githubBacked.items.map(item => item.title).sort()).toEqual(['GitHub Epic', 'GitHub Feature', 'GitHub PBI']);
    });

    it('invalid URL format → 400', async () => {
        await startServer(new Map());

        const res = await post(importUrl(), { issueUrl: 'not-a-github-url' });

        expect(res.status).toBe(400);
        expect(res.body.error).toMatch(/valid GitHub issue URL/i);
    });

    it('missing issueUrl field → 400', async () => {
        await startServer(new Map());

        const res = await post(importUrl(), {});

        expect(res.status).toBe(400);
        expect(res.body.error).toMatch(/issueUrl is required/i);
    });

    it('wrong owner/repo → 400', async () => {
        await startServer(new Map());

        const res = await post(importUrl(), {
            issueUrl: 'https://github.com/other-owner/other-repo/issues/1',
        });

        expect(res.status).toBe(400);
        expect(res.body.error).toMatch(/does not match the workspace-configured GitHub repo/i);
    });

    it('duplicate import → 409 with existingWorkItemId', async () => {
        const issueNumber = 99;
        const issues = new Map([[issueNumber, makeMockIssue(issueNumber)]]);
        await startServer(issues);

        // First import
        const first = await post(importUrl(), {
            issueUrl: `https://github.com/${CONFIGURED_OWNER}/${CONFIGURED_REPO}/issues/${issueNumber}`,
        });
        expect(first.status).toBe(201);

        // Second import of same issue
        const second = await post(importUrl(), {
            issueUrl: `https://github.com/${CONFIGURED_OWNER}/${CONFIGURED_REPO}/issues/${issueNumber}`,
        });

        expect(second.status).toBe(409);
        expect(second.body.code).toBe('DUPLICATE_IMPORT');
        expect(second.body.details?.existingWorkItemId).toBe(first.body.id);
    });

    it('issue not found in transport → 404', async () => {
        await startServer(new Map()); // empty transport

        const res = await post(importUrl(), {
            issueUrl: `https://github.com/${CONFIGURED_OWNER}/${CONFIGURED_REPO}/issues/1234`,
        });

        expect(res.status).toBe(404);
        expect(res.body.error).toMatch(/GitHub issue #1234/i);
    });

    it('non-Epic root issue → 400', async () => {
        const issueNumber = 55;
        const issues = new Map([[issueNumber, makeMockIssue(issueNumber, 'Bug root', 'open', {
            labels: ['coc:type:bug'],
        })]]);
        await startServer(issues);

        const res = await post(importUrl(), {
            issueUrl: `https://github.com/${CONFIGURED_OWNER}/${CONFIGURED_REPO}/issues/${issueNumber}`,
        });

        expect(res.status).toBe(400);
        expect(res.body.error).toMatch(/must be imported from a GitHub issue marked as coc:type:epic/i);
    });

    it('provider unavailable → 409', async () => {
        await startServer(new Map(), false); // providerAvailable = false

        const res = await post(importUrl(), {
            issueUrl: `https://github.com/${CONFIGURED_OWNER}/${CONFIGURED_REPO}/issues/1`,
        });

        expect(res.status).toBe(409);
        expect(res.body.error).toMatch(/No GitHub repository configured/i);
    });

    it('imports epic roots with created local status while mirroring GitHub state', async () => {
        const issueNumber = 77;
        const issues = new Map([[issueNumber, makeMockIssue(issueNumber, 'Closed epic', 'closed', {
            body: 'Issue body',
            labels: [
                { name: 'coc:type:epic' },
                { name: 'coc:status:planning' },
                { name: 'coc:priority:high' },
            ],
        })]]);
        await startServer(issues);

        const res = await post(importUrl(), {
            issueUrl: `https://github.com/${CONFIGURED_OWNER}/${CONFIGURED_REPO}/issues/${issueNumber}`,
        });

        expect(res.status).toBe(201);
        expect(res.body.status).toBe('created');
        expect(res.body.type).toBe('epic');
        expect(res.body.priority).toBe('high');
        expect(res.body.githubMirror).toMatchObject({ issueNumber, state: 'closed' });
        expect(res.body.syncLinks).toBeUndefined();
    });

    it('re-pulls GitHub-owned fields while preserving local lifecycle fields', async () => {
        const issues = new Map<number, GitHubWorkItemIssue>([
            [70, makeMockIssue(70, 'Remote Epic', 'open', {
                labels: ['coc:type:epic', 'remote-tag'],
                body: 'Remote body',
            })],
        ]);

        const first = await importGitHubEpicTreeAsWorkItems(
            { workspaceId: REPO_ID, workItemStore: store },
            configuredRepo(),
            issues.get(70)!,
            [...issues.values()],
            () => NOW,
        );
        await store.updateWorkItem(first.root.id, {
            title: 'Local title edit',
            description: 'Local body edit',
            status: 'planning',
            plan: {
                version: 1,
                content: 'Local plan',
                updatedAt: '2026-01-01T01:00:00.000Z',
                resolvedBy: 'user',
            },
            executionHistory: [{
                taskId: 'task-1',
                startedAt: '2026-01-01T02:00:00.000Z',
                status: 'running',
            }],
        });
        issues.set(70, makeMockIssue(70, 'Remote Epic Updated', 'closed', {
            labels: ['coc:type:epic', 'github-tag'],
            body: 'Remote body updated',
            updatedAt: '2026-01-02T00:00:00.000Z',
        }));

        const second = await importGitHubEpicTreeAsWorkItems(
            { workspaceId: REPO_ID, workItemStore: store },
            configuredRepo(),
            issues.get(70)!,
            [...issues.values()],
            () => '2026-01-03T00:00:00.000Z',
        );

        expect(second).toMatchObject({ created: 0, updated: 1 });
        const updated = await store.getWorkItem(first.root.id, REPO_ID);
        expect(updated).toMatchObject({
            title: 'Remote Epic Updated',
            description: 'Remote body updated',
            type: 'epic',
            status: 'planning',
            tags: ['github-tag'],
            githubMirror: {
                issueNumber: 70,
                state: 'closed',
                updatedAt: '2026-01-02T00:00:00.000Z',
                lastPulledAt: '2026-01-03T00:00:00.000Z',
            },
        });
        expect(updated?.plan?.content).toBe('Local plan');
        expect(updated?.executionHistory?.[0].taskId).toBe('task-1');
    });

    it('prunes mirrored descendants that disappear from the GitHub Epic subtree on re-pull', async () => {
        const issues = new Map<number, GitHubWorkItemIssue>([
            [80, makeMockIssue(80, 'Remote Epic', 'open', {
                labels: ['coc:type:epic'],
                body: 'Remote epic',
            })],
            [81, makeMockIssue(81, 'Remote Feature', 'open', {
                body: `Remote feature\n\n${metadataBlock({
                    issueNumber: 81,
                    type: 'feature',
                    parent: { owner: CONFIGURED_OWNER, repo: CONFIGURED_REPO, issueNumber: 80 },
                })}`,
            })],
            [82, makeMockIssue(82, 'Remote PBI', 'open', {
                body: `Remote pbi\n\n${metadataBlock({
                    issueNumber: 82,
                    type: 'pbi',
                    parent: { owner: CONFIGURED_OWNER, repo: CONFIGURED_REPO, issueNumber: 81 },
                })}`,
            })],
        ]);

        const first = await importGitHubEpicTreeAsWorkItems(
            { workspaceId: REPO_ID, workItemStore: store },
            configuredRepo(),
            issues.get(80)!,
            [...issues.values()],
            () => NOW,
        );
        const removedPbi = first.items.find(item => item.githubMirror?.issueNumber === 82)!;
        await store.updateWorkItem(removedPbi.id, {
            status: 'planning',
            plan: {
                version: 1,
                content: 'Local execution plan that GitHub deletion wins over',
                updatedAt: '2026-01-01T01:00:00.000Z',
                resolvedBy: 'user',
            },
            executionHistory: [{
                taskId: 'task-local',
                startedAt: '2026-01-01T02:00:00.000Z',
                status: 'completed',
            }],
        });
        issues.delete(82);

        const second = await importGitHubEpicTreeAsWorkItems(
            { workspaceId: REPO_ID, workItemStore: store },
            configuredRepo(),
            issues.get(80)!,
            [...issues.values()],
            () => '2026-01-03T00:00:00.000Z',
            { pruneMissing: true },
        );

        expect(second.deleted).toBe(1);
        expect(second.deletedItemIds).toEqual([removedPbi.id]);
        expect(await store.getWorkItem(removedPbi.id, REPO_ID)).toBeUndefined();
        const all = await store.listWorkItems({ repoId: REPO_ID });
        expect(all.items.map(item => item.githubMirror?.issueNumber).filter(Boolean).sort()).toEqual([80, 81]);
    });

    it('syncs an existing GitHub-backed Epic via route and prunes removed mirrors', async () => {
        const issues = new Map<number, GitHubWorkItemIssue>([
            [90, makeMockIssue(90, 'Route Epic', 'open', {
                labels: ['coc:type:epic'],
                body: 'Route epic',
            })],
            [91, makeMockIssue(91, 'Route Feature', 'open', {
                body: `Route feature\n\n${metadataBlock({
                    issueNumber: 91,
                    type: 'feature',
                    parent: { owner: CONFIGURED_OWNER, repo: CONFIGURED_REPO, issueNumber: 90 },
                })}`,
            })],
            [92, makeMockIssue(92, 'Route PBI', 'open', {
                body: `Route pbi\n\n${metadataBlock({
                    issueNumber: 92,
                    type: 'pbi',
                    parent: { owner: CONFIGURED_OWNER, repo: CONFIGURED_REPO, issueNumber: 91 },
                })}`,
            })],
        ]);
        await startServer(issues);

        const imported = await post(importUrl(), {
            issueUrl: `https://github.com/${CONFIGURED_OWNER}/${CONFIGURED_REPO}/issues/90`,
        });
        expect(imported.status).toBe(201);
        const allBefore = await store.listWorkItems({ repoId: REPO_ID });
        const removedPbi = allBefore.items.find(item => item.githubMirror?.issueNumber === 92)!;

        issues.set(90, makeMockIssue(90, 'Route Epic Updated', 'closed', {
            labels: ['coc:type:epic', 'route-tag'],
            body: 'Route epic updated',
            updatedAt: '2026-01-02T00:00:00.000Z',
        }));
        issues.delete(92);

        const synced = await post(syncUrl(imported.body.id));

        expect(synced.status).toBe(200);
        expect(synced.body).toMatchObject({
            created: 0,
            updated: 2,
            deleted: 1,
            deletedItemIds: [removedPbi.id],
            root: {
                id: imported.body.id,
                title: 'Route Epic Updated',
                githubMirror: {
                    issueNumber: 90,
                    state: 'closed',
                    updatedAt: '2026-01-02T00:00:00.000Z',
                },
                tracker: {
                    kind: 'github-backed',
                    github: {
                        issueNumber: 90,
                    },
                },
            },
        });
        expect(await store.getWorkItem(removedPbi.id, REPO_ID)).toBeUndefined();
        const root = await store.getWorkItem(imported.body.id, REPO_ID);
        expect(root?.title).toBe('Route Epic Updated');
        expect(root?.tags).toEqual(['route-tag']);
    });

    it('sync route deletes the local mirror tree when the GitHub Epic root is deleted', async () => {
        const issues = new Map<number, GitHubWorkItemIssue>([
            [93, makeMockIssue(93, 'Deleted Root Epic', 'open', {
                labels: ['coc:type:epic'],
                body: 'Deleted root epic',
            })],
            [94, makeMockIssue(94, 'Deleted Root Feature', 'open', {
                body: `Deleted root feature\n\n${metadataBlock({
                    issueNumber: 94,
                    type: 'feature',
                    parent: { owner: CONFIGURED_OWNER, repo: CONFIGURED_REPO, issueNumber: 93 },
                })}`,
            })],
        ]);
        await startServer(issues);

        const imported = await post(importUrl(), {
            issueUrl: `https://github.com/${CONFIGURED_OWNER}/${CONFIGURED_REPO}/issues/93`,
        });
        expect(imported.status).toBe(201);
        const allBefore = await store.listWorkItems({ repoId: REPO_ID });
        const feature = allBefore.items.find(item => item.githubMirror?.issueNumber === 94)!;

        issues.delete(93);
        issues.delete(94);

        const synced = await post(syncUrl(imported.body.id));

        expect(synced.status).toBe(200);
        expect(synced.body).toMatchObject({
            created: 0,
            updated: 0,
            deleted: 2,
            deletedItemIds: [feature.id, imported.body.id],
            root: {
                id: imported.body.id,
                title: 'Deleted Root Epic',
            },
            items: [],
        });
        expect(await store.getWorkItem(imported.body.id, REPO_ID)).toBeUndefined();
        expect(await store.getWorkItem(feature.id, REPO_ID)).toBeUndefined();
    });

    it('rejects per-Epic GitHub sync for local-only items', async () => {
        await store.addWorkItem({
            id: 'local-epic',
            repoId: REPO_ID,
            title: 'Local Epic',
            description: 'Local only',
            status: 'created',
            type: 'epic',
            createdAt: NOW,
            updatedAt: NOW,
            source: 'manual',
        });
        await startServer(new Map());

        const res = await post(syncUrl('local-epic'));

        expect(res.status).toBe(400);
        expect(res.body.error).toMatch(/not a GitHub-backed Epic root/i);
    });
});
