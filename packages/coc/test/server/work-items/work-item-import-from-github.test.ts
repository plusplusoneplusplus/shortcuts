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

async function post(urlPath: string, body: unknown): Promise<{ status: number; body: any }> {
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

beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'import-gh-test-'));
    store = new FileWorkItemStore({ dataDir: tmpDir });
});

afterEach(async () => {
    await stopServer();
    await fs.rm(tmpDir, { recursive: true, force: true });
});

describe('POST /api/workspaces/:id/work-items/import-from-github', () => {
    it('happy path: valid URL → 201 with syncLink', async () => {
        const issueNumber = 42;
        const issues = new Map([[issueNumber, makeMockIssue(issueNumber, 'Fix the thing')]]);
        await startServer(issues);

        const res = await post(importUrl(), {
            issueUrl: `https://github.com/${CONFIGURED_OWNER}/${CONFIGURED_REPO}/issues/${issueNumber}`,
        });

        expect(res.status).toBe(201);
        expect(res.body).toMatchObject({
            title: 'Fix the thing',
            repoId: REPO_ID,
            source: 'manual',
        });
        expect(res.body.syncLinks).toHaveLength(1);
        expect(res.body.syncLinks[0]).toMatchObject({
            provider: 'github',
            remote: {
                issueNumber,
                owner: CONFIGURED_OWNER,
                repo: CONFIGURED_REPO,
            },
        });

        // Also confirm item is persisted in the store
        const stored = await store.getWorkItem(res.body.id, REPO_ID);
        expect(stored).toBeDefined();
        expect(stored!.title).toBe('Fix the thing');
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

    it('provider unavailable → 409', async () => {
        await startServer(new Map(), false); // providerAvailable = false

        const res = await post(importUrl(), {
            issueUrl: `https://github.com/${CONFIGURED_OWNER}/${CONFIGURED_REPO}/issues/1`,
        });

        expect(res.status).toBe(409);
        expect(res.body.error).toMatch(/No GitHub repository configured/i);
    });

    it('imports standalone GitHub issues with created status while preserving type and priority labels', async () => {
        const issueNumber = 77;
        const issues = new Map([[issueNumber, makeMockIssue(issueNumber, 'Closed issue', 'closed', {
            body: [
                'Issue body',
                '',
                '<!-- coc-sync -->',
                'coc:type:bug',
                'coc:status:done',
                'coc:priority:high',
                '<!-- /coc-sync -->',
            ].join('\n'),
            labels: [
                { name: 'coc:type:bug' },
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
        expect(res.body.type).toBe('bug');
        expect(res.body.priority).toBe('high');
        expect(res.body.syncLinks).toHaveLength(1);
    });
});
