import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as http from 'http';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import type { Route } from '../../../src/server/types';
import { createRouter } from '../../../src/server/shared/router';
import { registerWorkItemRoutes } from '../../../src/server/routes/work-item-routes';
import { FileWorkItemStore } from '../../../src/server/work-items/work-item-store';
import type { WorkItem } from '../../../src/server/work-items/types';
import {
    parseGitHubWorkItemIssue,
    type GitHubWorkItemIssue,
    type GitHubWorkItemIssueTransport,
} from '../../../src/server/work-items';
import type { AvailableGitHubWorkItemSyncRepo } from '../../../src/server/work-items/work-item-sync-github-provider';

const REPO_ID = 'github-child-test-repo';
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
                const issue: GitHubWorkItemIssue = {
                    id: `I_${nextIssueNumber}`,
                    number: nextIssueNumber++,
                    title: input.title,
                    state: 'open',
                    htmlUrl: `https://github.com/${OWNER}/${REPO}/issues/${nextIssueNumber - 1}`,
                    url: `https://api.github.com/repos/${OWNER}/${REPO}/issues/${nextIssueNumber - 1}`,
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
        createdAt: overrides.createdAt ?? NOW,
        updatedAt: overrides.updatedAt ?? NOW,
        source: overrides.source ?? 'manual',
        tags: overrides.tags,
        priority: overrides.priority,
    };
}

let tmpDir: string;
let store: FileWorkItemStore;
let server: http.Server | undefined;
let baseUrl: string;

function makeServer(mock: MockTransport, workspaces = [{
    id: REPO_ID,
    name: 'GitHub Child Test',
    rootPath: tmpDir,
    remoteUrl: `https://github.com/${OWNER}/${REPO}.git`,
}]): http.Server {
    const routes: Route[] = [];
    registerWorkItemRoutes({
        routes,
        workItemStore: store,
        processStore: { getWorkspaces: async () => workspaces } as any,
        getHierarchyEnabled: () => true,
        dataDir: tmpDir,
        githubTransport: mock.transport,
    });
    return http.createServer(createRouter({ routes, spaHtml: '' }));
}

async function startServer(mock: MockTransport, workspaces?: Array<{ id: string; name: string; rootPath: string; remoteUrl?: string }>): Promise<void> {
    server = makeServer(mock, workspaces);
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

async function postWorkItem(body: unknown): Promise<{ status: number; body: any }> {
    return new Promise((resolve, reject) => {
        const payload = JSON.stringify(body);
        const req = http.request({
            hostname: '127.0.0.1',
            port: new URL(baseUrl).port,
            path: `/api/workspaces/${encodeURIComponent(REPO_ID)}/work-items`,
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

beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'github-child-push-'));
    store = new FileWorkItemStore({ dataDir: tmpDir });
});

afterEach(async () => {
    await stopServer();
    await fs.rm(tmpDir, { recursive: true, force: true });
});

describe('GitHub-backed work item child creation', () => {
    it('pushes a new local child under a GitHub-backed Epic to GitHub and stores mirror metadata', async () => {
        await store.addWorkItem(makeWorkItem({
            id: 'epic-1',
            title: 'GitHub Epic',
            type: 'epic',
            tracker: {
                kind: 'github-backed',
                provider: 'github',
                github: {
                    issueId: 'I_10',
                    issueNumber: 10,
                    issueUrl: `https://github.com/${OWNER}/${REPO}/issues/10`,
                    lastPulledAt: NOW,
                },
            },
            githubMirror: {
                issueId: 'I_10',
                issueNumber: 10,
                issueUrl: `https://github.com/${OWNER}/${REPO}/issues/10`,
                state: 'open',
                updatedAt: NOW,
                lastPulledAt: NOW,
            },
        }));
        const mock = makeMockTransport();
        await startServer(mock);

        const res = await postWorkItem({
            title: 'New GitHub Feature',
            description: 'Feature body',
            type: 'feature',
            parentId: 'epic-1',
            tags: ['customer'],
            priority: 'high',
        });

        expect(res.status).toBe(201);
        expect(res.body).toMatchObject({
            title: 'New GitHub Feature',
            description: 'Feature body',
            type: 'feature',
            parentId: 'epic-1',
            status: 'created',
            githubMirror: {
                issueId: 'I_100',
                issueNumber: 100,
                issueUrl: `https://github.com/${OWNER}/${REPO}/issues/100`,
                state: 'open',
                updatedAt: NOW,
                lastPulledAt: expect.any(String),
            },
        });
        expect(res.body.syncLinks).toBeUndefined();
        expect(mock.calls.getRepository).toBe(1);
        expect(mock.calls.createIssue).toHaveLength(1);
        expect(mock.calls.updateIssue).toHaveLength(1);

        const remote = mock.issues.get(100)!;
        expect(remote.title).toBe('New GitHub Feature');
        expect(remote.body).toContain('Feature body');
        expect(remote.labels).toEqual(expect.arrayContaining(['customer', 'coc:type:feature', 'coc:priority:high']));
        expect(remote.labels).not.toContain('coc:status:created');
        const parsed = parseGitHubWorkItemIssue(remote);
        expect(parsed.metadata).toMatchObject({
            provider: 'github',
            workItemId: res.body.id,
            remote: {
                owner: OWNER,
                repo: REPO,
                issueId: 'I_100',
                issueNumber: 100,
                issueUrl: `https://github.com/${OWNER}/${REPO}/issues/100`,
            },
            parent: {
                workItemId: 'epic-1',
                issueId: 'I_10',
                issueNumber: 10,
                issueUrl: `https://github.com/${OWNER}/${REPO}/issues/10`,
                owner: OWNER,
                repo: REPO,
            },
            type: 'feature',
            status: 'created',
        });

        const stored = await store.getWorkItem(res.body.id, REPO_ID);
        expect(stored?.githubMirror).toMatchObject({ issueNumber: 100 });
        expect((stored as { syncLinks?: unknown } | undefined)?.syncLinks).toBeUndefined();
    });

    it('does not call GitHub for a child under a local-only Epic', async () => {
        await store.addWorkItem(makeWorkItem({
            id: 'local-epic',
            title: 'Local Epic',
            type: 'epic',
            tracker: { kind: 'local-only' },
        }));
        const mock = makeMockTransport();
        await startServer(mock);

        const res = await postWorkItem({
            title: 'Local Feature',
            type: 'feature',
            parentId: 'local-epic',
        });

        expect(res.status).toBe(201);
        expect(res.body.githubMirror).toBeUndefined();
        expect(mock.calls.getRepository).toBe(0);
        expect(mock.calls.createIssue).toHaveLength(0);
        expect(mock.calls.updateIssue).toHaveLength(0);
    });

    it('fails without creating a local child when the workspace GitHub repo cannot be resolved', async () => {
        await store.addWorkItem(makeWorkItem({
            id: 'epic-1',
            title: 'GitHub Epic',
            type: 'epic',
            tracker: {
                kind: 'github-backed',
                provider: 'github',
                github: { issueNumber: 10 },
            },
            githubMirror: {
                issueNumber: 10,
                state: 'open',
            },
        }));
        const mock = makeMockTransport();
        await startServer(mock, []);

        const res = await postWorkItem({
            title: 'Unpushable Feature',
            type: 'feature',
            parentId: 'epic-1',
        });

        expect(res.status).toBe(409);
        expect(res.body.code).toBe('WORK_ITEM_GITHUB_REPO_UNAVAILABLE');
        expect(await store.listChildren('epic-1', REPO_ID)).toEqual([]);
        expect(mock.calls.createIssue).toHaveLength(0);
    });
});
