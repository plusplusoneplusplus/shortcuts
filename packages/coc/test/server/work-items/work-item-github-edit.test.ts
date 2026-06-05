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

const REPO_ID = 'github-edit-test-repo';
const OWNER = 'plusplusoneplusplus';
const REPO = 'shortcuts';
const NOW = '2026-01-01T00:00:00.000Z';
const LATER = '2026-02-02T00:00:00.000Z';

function issueUrl(issueNumber: number): string {
    return `https://github.com/${OWNER}/${REPO}/issues/${issueNumber}`;
}

interface MockTransport {
    transport: GitHubWorkItemIssueTransport;
    issues: Map<number, GitHubWorkItemIssue>;
    calls: {
        getRepository: number;
        getIssue: number[];
        updateIssue: Array<{ issueNumber: number; title: string; body: string; labels: string[]; state: 'open' | 'closed' }>;
    };
    failNextUpdate?: Error;
}

function makeMockTransport(seed: GitHubWorkItemIssue[]): MockTransport {
    const issues = new Map<number, GitHubWorkItemIssue>();
    for (const issue of seed) issues.set(issue.number, issue);
    const calls: MockTransport['calls'] = {
        getRepository: 0,
        getIssue: [],
        updateIssue: [],
    };
    const mock: MockTransport = {
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
                calls.getIssue.push(issueNumber);
                return issues.get(issueNumber);
            },
            async createIssue() {
                throw new Error('createIssue should not be called by edit tests');
            },
            async updateIssue(_repo: AvailableGitHubWorkItemSyncRepo, issueNumber: number, input) {
                calls.updateIssue.push({ issueNumber, ...input });
                if (mock.failNextUpdate) throw mock.failNextUpdate;
                const existing = issues.get(issueNumber);
                if (!existing) throw new Error(`Missing mock issue #${issueNumber}`);
                const updated: GitHubWorkItemIssue = {
                    ...existing,
                    title: input.title,
                    state: input.state,
                    body: input.body,
                    labels: input.labels,
                    updatedAt: LATER,
                };
                issues.set(issueNumber, updated);
                return updated;
            },
        },
    };
    return mock;
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

function githubBackedRoot(overrides: Partial<WorkItem> = {}): WorkItem {
    return makeWorkItem({
        id: 'epic-1',
        title: 'GitHub Epic',
        type: 'epic',
        tracker: {
            kind: 'github-backed',
            provider: 'github',
            github: { issueId: 'I_10', issueNumber: 10, issueUrl: issueUrl(10), lastPulledAt: NOW },
        },
        githubMirror: { issueId: 'I_10', issueNumber: 10, issueUrl: issueUrl(10), state: 'open', updatedAt: NOW, lastPulledAt: NOW },
        ...overrides,
    });
}

function mirroredIssue(issueNumber: number, overrides: Partial<GitHubWorkItemIssue> = {}): GitHubWorkItemIssue {
    return {
        id: `I_${issueNumber}`,
        number: issueNumber,
        title: `Issue ${issueNumber}`,
        state: 'open',
        htmlUrl: issueUrl(issueNumber),
        url: `https://api.github.com/repos/${OWNER}/${REPO}/issues/${issueNumber}`,
        body: 'Remote prose',
        labels: ['coc:type:work-item', 'coc:status:created', 'coc:priority:normal'],
        updatedAt: NOW,
        ...overrides,
    };
}

let tmpDir: string;
let store: FileWorkItemStore;
let server: http.Server | undefined;
let baseUrl: string;

function makeServer(mock: MockTransport): http.Server {
    const routes: Route[] = [];
    registerWorkItemRoutes({
        routes,
        workItemStore: store,
        processStore: {
            getWorkspaces: async () => [{
                id: REPO_ID,
                name: 'GitHub Edit Test',
                rootPath: tmpDir,
                remoteUrl: `https://github.com/${OWNER}/${REPO}.git`,
            }],
        } as any,
        getHierarchyEnabled: () => true,
        dataDir: tmpDir,
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

async function request(method: string, urlPath: string, body?: unknown): Promise<{ status: number; body: any }> {
    return new Promise((resolve, reject) => {
        const payload = body === undefined ? undefined : JSON.stringify(body);
        const urlObj = new URL(urlPath, baseUrl);
        const req = http.request({
            hostname: urlObj.hostname,
            port: urlObj.port,
            path: urlObj.pathname + urlObj.search,
            method,
            headers: payload
                ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) }
                : {},
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
        if (payload) req.write(payload);
        req.end();
    });
}

beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'github-edit-'));
    store = new FileWorkItemStore({ dataDir: tmpDir });
});

afterEach(async () => {
    await stopServer();
    await fs.rm(tmpDir, { recursive: true, force: true });
});

describe('GitHub-backed work item edits', () => {
    it('pushes descendant title/body/status/priority/tags/parent edits to GitHub before storing the mirror', async () => {
        await store.addWorkItem(githubBackedRoot());
        await store.addWorkItem(makeWorkItem({
            id: 'feature-a',
            title: 'Feature A',
            type: 'feature',
            parentId: 'epic-1',
            githubMirror: { issueId: 'I_11', issueNumber: 11, issueUrl: issueUrl(11), state: 'open', updatedAt: NOW, lastPulledAt: NOW },
        }));
        await store.addWorkItem(makeWorkItem({
            id: 'feature-b',
            title: 'Feature B',
            type: 'feature',
            parentId: 'epic-1',
            githubMirror: { issueId: 'I_13', issueNumber: 13, issueUrl: issueUrl(13), state: 'open', updatedAt: NOW, lastPulledAt: NOW },
        }));
        await store.addWorkItem(makeWorkItem({
            id: 'pbi-1',
            title: 'PBI',
            type: 'pbi',
            parentId: 'feature-a',
            githubMirror: { issueId: 'I_12', issueNumber: 12, issueUrl: issueUrl(12), state: 'open', updatedAt: NOW, lastPulledAt: NOW },
        }));
        const mock = makeMockTransport([mirroredIssue(12)]);
        await startServer(mock);

        const res = await request('PATCH', `/api/workspaces/${REPO_ID}/work-items/pbi-1`, {
            title: 'Updated PBI',
            description: 'Updated body',
            status: 'readyToExecute',
            priority: 'high',
            tags: ['customer'],
            parentId: 'feature-b',
        });

        expect(res.status).toBe(200);
        expect(mock.calls.getIssue).toEqual([12]);
        expect(mock.calls.updateIssue).toHaveLength(1);
        const update = mock.calls.updateIssue[0];
        expect(update.issueNumber).toBe(12);
        expect(update.title).toBe('Updated PBI');
        expect(update.state).toBe('open');
        expect(update.labels).toEqual(expect.arrayContaining([
            'customer', 'coc:type:pbi', 'coc:status:readyToExecute', 'coc:priority:high',
        ]));
        expect(update.body).toContain('Updated body');

        const remote = mock.issues.get(12)!;
        const parsed = parseGitHubWorkItemIssue(remote);
        expect(parsed.metadata).toMatchObject({
            provider: 'github',
            workItemId: 'pbi-1',
            status: 'readyToExecute',
            parent: { workItemId: 'feature-b', issueNumber: 13, owner: OWNER, repo: REPO },
        });

        expect(res.body).toMatchObject({
            id: 'pbi-1',
            title: 'Updated PBI',
            description: 'Updated body',
            status: 'readyToExecute',
            priority: 'high',
            tags: ['customer'],
            parentId: 'feature-b',
            githubMirror: { issueNumber: 12, updatedAt: LATER },
        });
        const stored = await store.getWorkItem('pbi-1', REPO_ID);
        expect(stored?.parentId).toBe('feature-b');
        expect(stored?.githubMirror?.updatedAt).toBe(LATER);
    });

    it('updates the root Epic issue and refreshes tracker metadata, closing terminal status', async () => {
        await store.addWorkItem(githubBackedRoot());
        const mock = makeMockTransport([mirroredIssue(10, {
            title: 'GitHub Epic',
            labels: ['coc:type:epic', 'coc:status:created', 'coc:priority:normal'],
        })]);
        await startServer(mock);

        const res = await request('PATCH', `/api/workspaces/${REPO_ID}/work-items/epic-1`, {
            title: 'Renamed Epic',
            status: 'done',
        });

        expect(res.status).toBe(200);
        expect(mock.calls.updateIssue).toHaveLength(1);
        expect(mock.calls.updateIssue[0]).toMatchObject({ issueNumber: 10, state: 'closed', title: 'Renamed Epic' });
        expect(mock.calls.updateIssue[0].labels).toEqual(expect.arrayContaining(['coc:status:done']));
        expect(res.body).toMatchObject({
            id: 'epic-1',
            title: 'Renamed Epic',
            status: 'done',
            tracker: {
                kind: 'github-backed',
                provider: 'github',
                github: { issueNumber: 10, lastPulledAt: expect.any(String) },
            },
            githubMirror: { issueNumber: 10, state: 'closed', updatedAt: LATER },
        });
        const stored = await store.getWorkItem('epic-1', REPO_ID);
        expect(stored?.githubMirror?.state).toBe('closed');
        expect(stored?.githubMirror?.updatedAt).toBe(LATER);
    });

    it('fails loudly without storing local edits when GitHub rejects the update', async () => {
        await store.addWorkItem(githubBackedRoot());
        const mock = makeMockTransport([mirroredIssue(10, { title: 'GitHub Epic' })]);
        mock.failNextUpdate = new Error('GitHub API rejected the patch');
        await startServer(mock);

        const res = await request('PATCH', `/api/workspaces/${REPO_ID}/work-items/epic-1`, {
            title: 'Local title that should not persist',
        });

        expect(res.status).toBe(409);
        expect(res.body.code).toBe('WORK_ITEM_GITHUB_UPDATE_FAILED');
        expect(mock.calls.updateIssue).toHaveLength(1);
        const stored = await store.getWorkItem('epic-1', REPO_ID);
        expect(stored?.title).toBe('GitHub Epic');
        expect(stored?.githubMirror?.updatedAt).toBe(NOW);
    });

    it('rejects stale local saves with a typed per-field conflict when the GitHub issue changed remotely', async () => {
        await store.addWorkItem(githubBackedRoot());
        const mock = makeMockTransport([mirroredIssue(10, {
            title: 'Remote changed title',
            body: 'Remote body prose',
            labels: ['coc:type:epic', 'coc:status:executing', 'coc:priority:high', 'urgent'],
            updatedAt: LATER,
        })]);
        await startServer(mock);

        const res = await request('PATCH', `/api/workspaces/${REPO_ID}/work-items/epic-1`, {
            title: 'Stale local title',
            status: 'planning',
        });

        expect(res.status).toBe(409);
        expect(res.body.code).toBe('WORK_ITEM_SYNC_CONFLICT');
        expect(mock.calls.updateIssue).toHaveLength(0);

        const details = res.body.details;
        expect(details).toMatchObject({
            kind: 'work-item-sync-conflict',
            provider: 'github',
            providerLabel: 'GitHub',
            workItemId: 'epic-1',
            issueNumber: 10,
            localUpdatedAt: NOW,
            remoteUpdatedAt: LATER,
        });
        const byField = Object.fromEntries(details.fields.map((f: any) => [f.field, f]));
        expect(byField.title).toEqual({ field: 'title', draft: 'Stale local title', base: 'GitHub Epic', remote: 'Remote changed title' });
        expect(byField.status).toEqual({ field: 'status', draft: 'planning', base: 'created', remote: 'executing' });
        expect(byField.priority).toEqual({ field: 'priority', draft: 'normal', base: 'normal', remote: 'high' });
        expect(byField.description).toEqual({ field: 'description', draft: null, base: null, remote: 'Remote body prose' });
        expect(byField.tags).toEqual({ field: 'tags', draft: null, base: null, remote: 'urgent' });
        // Parent did not diverge (both remote and base are the Epic root), so it is omitted.
        expect(byField.parent).toBeUndefined();

        const stored = await store.getWorkItem('epic-1', REPO_ID);
        expect(stored?.title).toBe('GitHub Epic');
        expect(stored?.status).toBe('created');
        expect(stored?.githubMirror?.updatedAt).toBe(NOW);
    });

    it('does not call GitHub for edits to a local-only tree', async () => {
        await store.addWorkItem(makeWorkItem({
            id: 'local-epic',
            title: 'Local Epic',
            type: 'epic',
            tracker: { kind: 'local-only' },
        }));
        const mock = makeMockTransport([]);
        await startServer(mock);

        const res = await request('PATCH', `/api/workspaces/${REPO_ID}/work-items/local-epic`, {
            title: 'Renamed Local Epic',
        });

        expect(res.status).toBe(200);
        expect(mock.calls.getIssue).toHaveLength(0);
        expect(mock.calls.updateIssue).toHaveLength(0);
        const stored = await store.getWorkItem('local-epic', REPO_ID);
        expect(stored?.title).toBe('Renamed Local Epic');
    });

    it('does not call GitHub when only local-only fields change', async () => {
        await store.addWorkItem(githubBackedRoot());
        const mock = makeMockTransport([mirroredIssue(10)]);
        await startServer(mock);

        const res = await request('PATCH', `/api/workspaces/${REPO_ID}/work-items/epic-1`, {
            autoExecute: true,
            successCriteria: 'All tests pass',
        });

        expect(res.status).toBe(200);
        expect(mock.calls.getIssue).toHaveLength(0);
        expect(mock.calls.updateIssue).toHaveLength(0);
    });
});
