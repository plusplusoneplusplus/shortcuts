import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as http from 'http';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import type { Route } from '../../../src/server/types';
import { createRouter } from '../../../src/server/shared/router';
import { registerWorkItemSyncRoutes } from '../../../src/server/routes/work-item-sync-routes';
import { FileWorkItemStore } from '../../../src/server/work-items/work-item-store';
import {
    parseGitHubWorkItemIssue,
    type WorkItem,
    type WorkItemSyncProviderAdapter,
} from '../../../src/server/work-items';
import type {
    AvailableGitHubWorkItemSyncRepo,
    GitHubWorkItemIssue,
    GitHubWorkItemIssueTransport,
} from '../../../src/server/work-items/work-item-sync-github-provider';

const REPO_ID = 'github-conversion-test-repo';
const OWNER = 'plusplusoneplusplus';
const REPO = 'shortcuts';
const NOW = '2026-01-01T00:00:00.000Z';

interface MockTransport {
    transport: GitHubWorkItemIssueTransport;
    issues: Map<number, GitHubWorkItemIssue>;
    calls: {
        getRepository: number;
        createIssue: Array<{ title: string; body: string; labels: string[] }>;
        updateIssue: Array<{ issueNumber: number; title: string; body: string; labels: string[]; state: 'open' | 'closed' }>;
    };
}

function makeProvider(): WorkItemSyncProviderAdapter {
    return {
        provider: 'github',
        async getStatus() {
            return {
                provider: 'github',
                available: true,
                repository: {
                    provider: 'github',
                    owner: OWNER,
                    repo: REPO,
                    url: `https://github.com/${OWNER}/${REPO}`,
                    source: 'origin',
                },
                auth: {
                    mode: 'external',
                    authenticated: true,
                    message: 'Uses external GitHub authentication.',
                },
            };
        },
    };
}

function makeMockTransport(): MockTransport {
    let nextIssueNumber = 100;
    const issues = new Map<number, GitHubWorkItemIssue>();
    const calls: MockTransport['calls'] = {
        getRepository: 0,
        createIssue: [],
        updateIssue: [],
    };
    return {
        issues,
        calls,
        transport: {
            async getRepository(_repo: AvailableGitHubWorkItemSyncRepo) {
                calls.getRepository++;
            },
            async listIssues() {
                return [...issues.values()];
            },
            async getIssue(_repo: AvailableGitHubWorkItemSyncRepo, issueNumber: number) {
                return issues.get(issueNumber);
            },
            async createIssue(_repo: AvailableGitHubWorkItemSyncRepo, input) {
                calls.createIssue.push(input);
                const issueNumber = nextIssueNumber++;
                const issue: GitHubWorkItemIssue = {
                    id: `I_${issueNumber}`,
                    number: issueNumber,
                    title: input.title,
                    state: 'open',
                    htmlUrl: `https://github.com/${OWNER}/${REPO}/issues/${issueNumber}`,
                    url: `https://api.github.com/repos/${OWNER}/${REPO}/issues/${issueNumber}`,
                    body: input.body,
                    labels: input.labels,
                    updatedAt: NOW,
                };
                issues.set(issue.number, issue);
                return issue;
            },
            async updateIssue(_repo: AvailableGitHubWorkItemSyncRepo, issueNumber: number, input) {
                calls.updateIssue.push({ issueNumber, ...input });
                const existing = issues.get(issueNumber);
                if (!existing) throw new Error(`Missing mock issue #${issueNumber}`);
                const updated: GitHubWorkItemIssue = {
                    ...existing,
                    title: input.title,
                    state: input.state,
                    body: input.body,
                    labels: input.labels,
                    updatedAt: NOW,
                };
                issues.set(issueNumber, updated);
                return updated;
            },
        },
    };
}

function makeWorkItem(overrides: Partial<WorkItem>): WorkItem {
    return {
        id: overrides.id ?? 'item-1',
        repoId: overrides.repoId ?? REPO_ID,
        title: overrides.title ?? 'Item',
        description: overrides.description ?? '',
        status: overrides.status ?? 'created',
        type: overrides.type,
        parentId: overrides.parentId,
        tracker: overrides.tracker,
        githubMirror: overrides.githubMirror,
        syncLinks: overrides.syncLinks,
        createdAt: overrides.createdAt ?? NOW,
        updatedAt: overrides.updatedAt ?? NOW,
        source: overrides.source ?? 'manual',
        priority: overrides.priority,
        tags: overrides.tags,
        plan: overrides.plan,
        executionHistory: overrides.executionHistory,
    };
}

let tmpDir: string;
let store: FileWorkItemStore;
let server: http.Server | undefined;
let baseUrl: string;

function makeServer(mock: MockTransport): http.Server {
    const routes: Route[] = [];
    registerWorkItemSyncRoutes({
        routes,
        workItemStore: store,
        processStore: {
            getWorkspaces: async () => [{
                id: REPO_ID,
                name: 'GitHub Conversion Test',
                rootPath: tmpDir,
                remoteUrl: `https://github.com/${OWNER}/${REPO}.git`,
            }],
        } as any,
        dataDir: tmpDir,
        getHierarchyEnabled: () => true,
        getSyncEnabled: () => true,
        providers: [makeProvider()],
        githubTransport: mock.transport,
    });
    return http.createServer(createRouter({ routes, spaHtml: '' }));
}

async function startServer(mock: MockTransport): Promise<void> {
    server = makeServer(mock);
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

async function post(urlPath: string): Promise<{ status: number; body: any }> {
    return new Promise((resolve, reject) => {
        const urlObj = new URL(urlPath, baseUrl);
        const req = http.request({
            hostname: urlObj.hostname,
            port: urlObj.port,
            path: urlObj.pathname,
            method: 'POST',
            headers: { 'Content-Length': 0 },
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
        req.end();
    });
}

function convertToGitHubUrl(workItemId: string): string {
    return `/api/workspaces/${encodeURIComponent(REPO_ID)}/work-items/${encodeURIComponent(workItemId)}/convert-to-github`;
}

function convertToLocalUrl(workItemId: string): string {
    return `/api/workspaces/${encodeURIComponent(REPO_ID)}/work-items/${encodeURIComponent(workItemId)}/convert-to-local`;
}

beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'github-conversion-'));
    store = new FileWorkItemStore({ dataDir: tmpDir });
});

afterEach(async () => {
    await stopServer();
    await fs.rm(tmpDir, { recursive: true, force: true });
});

describe('GitHub-backed Epic tracker conversion routes', () => {
    it('converts a local-only Epic subtree to GitHub issues and mirror metadata', async () => {
        await store.addWorkItem(makeWorkItem({
            id: 'epic-1',
            title: 'Local Epic',
            description: 'Epic body',
            status: 'planning',
            type: 'epic',
            tracker: { kind: 'local-only' },
            plan: {
                version: 1,
                content: 'Local plan remains local',
                updatedAt: NOW,
                resolvedBy: 'user',
            },
        }));
        await store.addWorkItem(makeWorkItem({
            id: 'feature-1',
            title: 'Local Feature',
            description: 'Feature body',
            type: 'feature',
            parentId: 'epic-1',
            priority: 'high',
            tags: ['customer'],
        }));
        await store.addWorkItem(makeWorkItem({
            id: 'pbi-1',
            title: 'Local PBI',
            description: 'PBI body',
            type: 'pbi',
            parentId: 'feature-1',
        }));
        const mock = makeMockTransport();
        await startServer(mock);

        const res = await post(convertToGitHubUrl('epic-1'));

        expect(res.status).toBe(200);
        expect(res.body).toMatchObject({
            remoteCreated: 3,
            localUpdated: 3,
            root: {
                id: 'epic-1',
                status: 'planning',
                tracker: {
                    kind: 'github-backed',
                    provider: 'github',
                    github: {
                        issueNumber: 100,
                        issueUrl: `https://github.com/${OWNER}/${REPO}/issues/100`,
                    },
                },
                githubMirror: {
                    issueNumber: 100,
                    state: 'open',
                },
            },
        });
        expect(mock.calls.createIssue.map(call => call.title)).toEqual(['Local Epic', 'Local Feature', 'Local PBI']);
        expect(mock.calls.updateIssue.map(call => call.issueNumber)).toEqual([100, 101, 102]);

        const root = await store.getWorkItem('epic-1', REPO_ID);
        const feature = await store.getWorkItem('feature-1', REPO_ID);
        const pbi = await store.getWorkItem('pbi-1', REPO_ID);
        expect(root).toMatchObject({
            status: 'planning',
            plan: { content: 'Local plan remains local' },
            tracker: { kind: 'github-backed', github: { issueNumber: 100 } },
            githubMirror: { issueNumber: 100 },
        });
        expect(root?.syncLinks).toBeUndefined();
        expect(feature).toMatchObject({ parentId: 'epic-1', githubMirror: { issueNumber: 101 } });
        expect(feature?.tracker).toBeUndefined();
        expect(feature?.syncLinks).toBeUndefined();
        expect(pbi).toMatchObject({ parentId: 'feature-1', githubMirror: { issueNumber: 102 } });

        const remoteRoot = parseGitHubWorkItemIssue(mock.issues.get(100)!);
        const remoteFeature = parseGitHubWorkItemIssue(mock.issues.get(101)!);
        const remotePbi = parseGitHubWorkItemIssue(mock.issues.get(102)!);
        expect(remoteRoot.bodyWithoutMetadata).toBe('Epic body');
        expect(remoteRoot.metadata).toMatchObject({
            workItemId: 'epic-1',
            type: 'epic',
            status: 'created',
            remote: {
                owner: OWNER,
                repo: REPO,
                issueNumber: 100,
            },
        });
        expect(remoteRoot.metadata?.parent).toBeUndefined();
        expect(mock.issues.get(100)?.labels).not.toContain('coc:status:planning');
        expect(mock.issues.get(101)?.labels).toEqual(expect.arrayContaining(['customer', 'coc:type:feature', 'coc:priority:high']));
        expect(mock.issues.get(101)?.labels).not.toContain('coc:status:created');
        expect(remoteFeature.metadata?.parent).toMatchObject({
            workItemId: 'epic-1',
            issueNumber: 100,
            owner: OWNER,
            repo: REPO,
        });
        expect(remotePbi.metadata?.parent).toMatchObject({
            workItemId: 'feature-1',
            issueNumber: 101,
            owner: OWNER,
            repo: REPO,
        });
    });

    it('detaches a GitHub-backed Epic subtree to local-only without dropping local execution fields', async () => {
        await store.addWorkItem(makeWorkItem({
            id: 'epic-1',
            title: 'GitHub Epic',
            description: 'Epic body',
            status: 'executing',
            type: 'epic',
            tracker: {
                kind: 'github-backed',
                provider: 'github',
                github: { issueNumber: 10, issueUrl: `https://github.com/${OWNER}/${REPO}/issues/10` },
            },
            githubMirror: {
                issueNumber: 10,
                issueUrl: `https://github.com/${OWNER}/${REPO}/issues/10`,
                state: 'open',
                lastPulledAt: NOW,
            },
            syncLinks: [{
                provider: 'github',
                remote: { owner: OWNER, repo: REPO, issueNumber: 10 },
            }],
            plan: {
                version: 1,
                content: 'Execution plan',
                updatedAt: NOW,
                resolvedBy: 'user',
            },
            executionHistory: [{
                taskId: 'task-1',
                startedAt: NOW,
                status: 'running',
            }],
        }));
        await store.addWorkItem(makeWorkItem({
            id: 'feature-1',
            title: 'GitHub Feature',
            type: 'feature',
            parentId: 'epic-1',
            githubMirror: {
                issueNumber: 11,
                issueUrl: `https://github.com/${OWNER}/${REPO}/issues/11`,
                state: 'closed',
            },
            syncLinks: [{
                provider: 'github',
                remote: { owner: OWNER, repo: REPO, issueNumber: 11 },
            }],
        }));
        const mock = makeMockTransport();
        await startServer(mock);

        const res = await post(convertToLocalUrl('epic-1'));

        expect(res.status).toBe(200);
        expect(res.body).toMatchObject({
            remoteCreated: 0,
            localUpdated: 2,
            root: {
                id: 'epic-1',
                status: 'executing',
                tracker: { kind: 'local-only' },
            },
        });
        expect(mock.calls.createIssue).toHaveLength(0);
        expect(mock.calls.updateIssue).toHaveLength(0);

        const root = await store.getWorkItem('epic-1', REPO_ID);
        const feature = await store.getWorkItem('feature-1', REPO_ID);
        expect(root).toMatchObject({
            status: 'executing',
            tracker: { kind: 'local-only' },
            plan: { content: 'Execution plan' },
            executionHistory: [{ taskId: 'task-1' }],
        });
        expect(root?.githubMirror).toBeUndefined();
        expect(root?.syncLinks).toBeUndefined();
        expect(feature).toMatchObject({ parentId: 'epic-1' });
        expect(feature?.tracker).toBeUndefined();
        expect(feature?.githubMirror).toBeUndefined();
        expect(feature?.syncLinks).toBeUndefined();
    });

    it('rejects conversion requests that do not match the current tracker kind', async () => {
        await store.addWorkItem(makeWorkItem({
            id: 'local-epic',
            title: 'Local Epic',
            type: 'epic',
            tracker: { kind: 'local-only' },
        }));
        await store.addWorkItem(makeWorkItem({
            id: 'github-epic',
            title: 'GitHub Epic',
            type: 'epic',
            tracker: {
                kind: 'github-backed',
                provider: 'github',
                github: { issueNumber: 10 },
            },
            githubMirror: { issueNumber: 10 },
        }));
        const mock = makeMockTransport();
        await startServer(mock);

        const localToLocal = await post(convertToLocalUrl('local-epic'));
        const githubToGithub = await post(convertToGitHubUrl('github-epic'));

        expect(localToLocal.status).toBe(400);
        expect(localToLocal.body.error).toMatch(/not a GitHub-backed Epic root/i);
        expect(githubToGithub.status).toBe(400);
        expect(githubToGithub.body.error).toMatch(/already a GitHub-backed Epic root/i);
    });
});
