/**
 * Tests for pr-routes — HTTP handler unit tests using in-process HTTP.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as http from 'http';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { createRouter } from '../../src/server/shared/router';
import { registerPrRoutes, clearPrListCache, clearPrDetailCache, clearPrDiffCache, clearPrThreadsCache, clearPrCommitsCache, clearPrReviewersCache, clearPrChecksCache, warmPullRequestWorkspaceCache } from '../../src/server/repos/pr-routes';
import { addPullRequestCoworkerToRoster } from '../../src/server/repos/pr-coworker-roster-store';
import type { Route } from '../../src/server/types';
import { resolveCanonicalOriginId, type IPullRequestsService } from '@plusplusoneplusplus/forge';
import type { ProviderPullRequest, CommentThread, Reviewer } from '@plusplusoneplusplus/forge';
import type { ProviderPullRequestCheck, ProviderPullRequestCommit } from '@plusplusoneplusplus/forge';

// ── Mock ProviderFactory and RepoTreeService ─────────────────────────────────

vi.mock('../../src/server/providers/provider-factory', function () { return ({
    ProviderFactory: {
        detectProviderType: vi.fn().mockReturnValue('github'),
        createPullRequestsService: vi.fn(),
    },
}); });

vi.mock('../../src/server/repos/tree-service', function () { return ({
    RepoTreeService: vi.fn().mockImplementation(function () { return ({
        resolveRepo: vi.fn(),
    }); }),
}); });

vi.mock('../../src/server/providers/providers-config', function () { return ({
    readProvidersConfig: vi.fn().mockResolvedValue({ providers: {} }),
}); });

import { ProviderFactory } from '../../src/server/providers/provider-factory';
import { RepoTreeService } from '../../src/server/repos/tree-service';

// ── Test fixtures ─────────────────────────────────────────────────────────────

const REPO_ID = 'repo-abc123';
const REMOTE_URL = 'https://github.com/org/repo.git';
const ORIGIN_ID = 'gh_org_repo';

const mockRepoInfo = {
    id: REPO_ID,
    name: 'repo',
    localPath: '/tmp/repo',
    headSha: 'abc1234',
    clonedAt: new Date().toISOString(),
    remoteUrl: REMOTE_URL,
};

function makeMockRepoInfo(repoId: string, remoteUrl = REMOTE_URL): typeof mockRepoInfo {
    return {
        ...mockRepoInfo,
        id: repoId,
        name: repoId,
        remoteUrl,
    };
}

const mockPr: ProviderPullRequest = {
    id: 42,
    number: 42,
    title: 'Add feature X',
    description: 'This adds feature X',
    author: { id: 'user1', displayName: 'Alice', email: 'alice@example.com' },
    sourceBranch: 'feature/x',
    targetBranch: 'main',
    status: 'open',
    isDraft: false,
    createdAt: new Date('2024-01-01'),
    updatedAt: new Date('2024-01-02'),
    url: 'https://github.com/org/repo/pull/42',
    repositoryId: REPO_ID,
    reviewers: [],
    labels: [],
};

const mockThread: CommentThread = {
    id: 1,
    comments: [],
    status: 'active',
    createdAt: new Date('2024-01-01'),
};

const mockReviewer: Reviewer = {
    identity: { id: 'user2', displayName: 'Bob' },
    vote: 'approved',
    isRequired: false,
};

const mockCommit: ProviderPullRequestCommit = {
    id: 'abc1234deadbeef0000000000000000000000000',
    shortId: 'abc1234',
    message: 'feat: stream JSONL parser\n\nMore details',
    subject: 'feat: stream JSONL parser',
    author: { id: 'user1', displayName: 'Alice', email: 'alice@example.com' },
    authoredAt: new Date('2024-01-04T12:34:56Z'),
    url: 'https://github.com/org/repo/commit/abc1234',
};

const mockCheck: ProviderPullRequestCheck = {
    id: 'check-1',
    name: 'build',
    status: 'success',
    source: 'check',
    description: 'All targets built.',
    detailsUrl: 'https://github.com/org/repo/runs/1',
    startedAt: new Date('2024-01-04T12:00:00Z'),
    completedAt: new Date('2024-01-04T12:03:18Z'),
    durationMs: 198000,
};

// ── Server helpers ────────────────────────────────────────────────────────────

let tmpDir: string;
let dataDir: string;
let server: http.Server;
let baseUrl: string;
let mockSvc: Partial<IPullRequestsService>;
let mockResolveRepo: ReturnType<typeof vi.fn>;
const execFileAsync = promisify(execFile);

async function git(cwd: string, args: string[]): Promise<string> {
    const { stdout } = await execFileAsync('git', args, { cwd, encoding: 'utf-8' });
    return stdout.trim();
}

async function writeAndCommitFile(repoPath: string, filePath: string, content: string, message: string): Promise<string> {
    const fullPath = path.join(repoPath, filePath);
    fs.mkdirSync(path.dirname(fullPath), { recursive: true });
    fs.writeFileSync(fullPath, content, 'utf-8');
    await git(repoPath, ['add', filePath]);
    await git(repoPath, ['commit', '-m', message]);
    return git(repoPath, ['rev-parse', 'HEAD']);
}

async function initGitRepo(repoPath: string): Promise<void> {
    await git(repoPath, ['init', '-b', 'main']);
    await git(repoPath, ['config', 'core.autocrlf', 'false']);
    await git(repoPath, ['config', 'user.email', 'test@example.com']);
    await git(repoPath, ['config', 'user.name', 'Test User']);
}

function makeServer(
    dir: string,
    autoClassification?: Parameters<typeof registerPrRoutes>[5],
    aiService?: Parameters<typeof registerPrRoutes>[4],
): http.Server {
    const routes: Route[] = [];
    registerPrRoutes(routes, dir, undefined, undefined, aiService, autoClassification);
    const handler = createRouter({ routes, spaHtml: '' });
    return http.createServer(handler);
}

async function startServer(): Promise<void> {
    return new Promise((resolve, reject) => {
        server.on('error', reject);
        server.listen(0, '127.0.0.1', () => {
            const addr = server.address() as { port: number };
            baseUrl = `http://127.0.0.1:${addr.port}`;
            resolve();
        });
    });
}

async function stopServer(): Promise<void> {
    return new Promise(resolve => server.close(() => resolve()));
}

async function restartServer(
    autoClassification?: Parameters<typeof registerPrRoutes>[5],
    aiService?: Parameters<typeof registerPrRoutes>[4],
): Promise<void> {
    await stopServer();
    server = makeServer(dataDir, autoClassification, aiService);
    await startServer();
}

function originPullRequestsUrl(pathAndQuery = '', repoId = REPO_ID, originId = ORIGIN_ID): string {
    const separatorIndex = pathAndQuery.indexOf('?');
    const pathPart = separatorIndex === -1 ? pathAndQuery : pathAndQuery.slice(0, separatorIndex);
    const queryPart = separatorIndex === -1 ? '' : pathAndQuery.slice(separatorIndex + 1);
    const params = new URLSearchParams(queryPart);
    if (!params.has('workspaceId')) params.set('workspaceId', repoId);
    if (!params.has('repoId')) params.set('repoId', repoId);
    const query = params.toString();
    return `${baseUrl}/api/origins/${originId}/pull-requests${pathPart}${query ? `?${query}` : ''}`;
}

function makeAutoClassificationBridge(options?: { throwOnEnqueue?: boolean }) {
    let nextId = 1;
    const tasks = new Map<string, any>();
    const queue = {
        enqueue: vi.fn((task: any) => {
            if (options?.throwOnEnqueue) {
                throw new Error('classification queue down');
            }
            const id = `auto-task-${nextId++}`;
            tasks.set(id, { ...task, id, status: 'queued' });
            return id;
        }),
    };
    const bridge = {
        getOrCreateBridge: vi.fn(),
        getRepoIdForPath: vi.fn(() => REPO_ID),
        getTask: vi.fn((id: string) => tasks.get(id)),
        registry: {
            getQueueForRepo: vi.fn(() => queue),
        },
    } as any;
    return { bridge, queue };
}

beforeEach(async () => {
    clearPrListCache();
    clearPrDetailCache();
    clearPrDiffCache();
    clearPrThreadsCache();
    clearPrCommitsCache();
    clearPrReviewersCache();
    clearPrChecksCache();
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pr-routes-test-'));
    dataDir = path.join(tmpDir, 'data');
    fs.mkdirSync(dataDir, { recursive: true });

    // Default mocks: repo found, service available
    mockSvc = {
        listPullRequests: vi.fn().mockResolvedValue([mockPr]),
        getPullRequest: vi.fn().mockResolvedValue(mockPr),
        getThreads: vi.fn().mockResolvedValue([mockThread]),
        getReviewers: vi.fn().mockResolvedValue([mockReviewer]),
        getCommits: vi.fn().mockResolvedValue([mockCommit]),
        getDiff: vi.fn().mockResolvedValue('diff --git a/foo.ts b/foo.ts\n'),
        getCommits: vi.fn().mockResolvedValue([mockCommit]),
        getChecks: vi.fn().mockResolvedValue([mockCheck]),
    };

    (RepoTreeService as ReturnType<typeof vi.fn>).mockImplementation(function () { return ({
        resolveRepo: mockResolveRepo = vi.fn().mockResolvedValue(mockRepoInfo),
    }); });
    (ProviderFactory.createPullRequestsService as ReturnType<typeof vi.fn>).mockResolvedValue(mockSvc);

    server = makeServer(dataDir);
    await startServer();
});

afterEach(async () => {
    vi.clearAllMocks();
    await stopServer();
    fs.rmSync(tmpDir, { recursive: true, force: true });
});

// ── GET /api/origins/:originId/pull-requests ─────────────────────────────────────────

describe('GET /api/origins/:originId/pull-requests', () => {
    it('returns pullRequests array on success', async () => {
        const res = await fetch(originPullRequestsUrl(``, REPO_ID));
        expect(res.status).toBe(200);
        const body = await res.json() as { pullRequests: unknown[]; total: number; fetchedAt?: number };
        expect(Array.isArray(body.pullRequests)).toBe(true);
        expect(body.pullRequests).toHaveLength(1);
        expect(body.total).toBe(1);
        expect(body.fetchedAt).toEqual(expect.any(Number));
    });

    it('enriches list rows with real diff stats from the provider diff', async () => {
        const diff = [
            'diff --git a/src/foo.ts b/src/foo.ts',
            '--- a/src/foo.ts',
            '+++ b/src/foo.ts',
            '@@ -1,2 +1,3 @@',
            ' keep',
            '+added',
            '+another',
            'diff --git a/src/bar.ts b/src/bar.ts',
            '--- a/src/bar.ts',
            '+++ b/src/bar.ts',
            '@@ -1 +1 @@',
            '-old',
            '+new',
        ].join('\n');
        (mockSvc.listPullRequests as ReturnType<typeof vi.fn>).mockResolvedValue([
            { ...mockPr, headSha: 'head-42' },
        ]);
        (mockSvc.getDiff as ReturnType<typeof vi.fn>).mockResolvedValue(diff);

        const res = await fetch(originPullRequestsUrl(``, REPO_ID));
        expect(res.status).toBe(200);
        const body = await res.json() as { pullRequests: Array<{ diffStats?: { additions: number; deletions: number; changedFiles: number } }> };
        expect(body.pullRequests[0].diffStats).toEqual({
            additions: 3,
            deletions: 1,
            changedFiles: 2,
        });
        expect(mockSvc.getDiff).toHaveBeenCalledWith(REPO_ID, 42);
    });

    it('reuses cached diff stats for the same PR head across forced list refreshes', async () => {
        (mockSvc.listPullRequests as ReturnType<typeof vi.fn>).mockResolvedValue([
            { ...mockPr, headSha: 'same-head' },
        ]);
        (mockSvc.getDiff as ReturnType<typeof vi.fn>).mockResolvedValue([
            'diff --git a/src/foo.ts b/src/foo.ts',
            '--- a/src/foo.ts',
            '+++ b/src/foo.ts',
            '@@ -1 +1,2 @@',
            ' keep',
            '+added',
        ].join('\n'));

        await fetch(originPullRequestsUrl(``, REPO_ID));
        await fetch(originPullRequestsUrl(`?force=true`, REPO_ID));

        expect(mockSvc.listPullRequests).toHaveBeenCalledTimes(2);
        expect(mockSvc.getDiff).toHaveBeenCalledTimes(1);
    });

    it('keys cached diff stats by PR head SHA so a changed head refetches stats', async () => {
        (mockSvc.listPullRequests as ReturnType<typeof vi.fn>)
            .mockResolvedValueOnce([{ ...mockPr, headSha: 'old-head' }])
            .mockResolvedValueOnce([{ ...mockPr, headSha: 'new-head' }]);
        (mockSvc.getDiff as ReturnType<typeof vi.fn>)
            .mockResolvedValueOnce([
                'diff --git a/src/foo.ts b/src/foo.ts',
                '--- a/src/foo.ts',
                '+++ b/src/foo.ts',
                '@@ -1 +1,2 @@',
                ' keep',
                '+old',
            ].join('\n'))
            .mockResolvedValueOnce([
                'diff --git a/src/foo.ts b/src/foo.ts',
                '--- a/src/foo.ts',
                '+++ b/src/foo.ts',
                '@@ -1,2 +1 @@',
                ' keep',
                '-removed',
                'diff --git a/src/bar.ts b/src/bar.ts',
                '--- a/src/bar.ts',
                '+++ b/src/bar.ts',
                '@@ -0,0 +1 @@',
                '+new',
            ].join('\n'));

        const first = await fetch(originPullRequestsUrl(``, REPO_ID));
        const firstBody = await first.json() as { pullRequests: Array<{ diffStats?: { additions: number; deletions: number; changedFiles: number } }> };
        expect(firstBody.pullRequests[0].diffStats).toEqual({
            additions: 1,
            deletions: 0,
            changedFiles: 1,
        });

        const second = await fetch(originPullRequestsUrl(`?force=true`, REPO_ID));
        const secondBody = await second.json() as { pullRequests: Array<{ diffStats?: { additions: number; deletions: number; changedFiles: number } }> };
        expect(secondBody.pullRequests[0].diffStats).toEqual({
            additions: 1,
            deletions: 1,
            changedFiles: 2,
        });
        expect(mockSvc.getDiff).toHaveBeenCalledTimes(2);
    });

    it('omits diff stats when the provider does not support pull request diffs', async () => {
        const svcWithoutDiff = { ...mockSvc };
        delete (svcWithoutDiff as any).getDiff;
        (ProviderFactory.createPullRequestsService as ReturnType<typeof vi.fn>).mockResolvedValue(svcWithoutDiff);

        const res = await fetch(originPullRequestsUrl(``, REPO_ID));
        expect(res.status).toBe(200);
        const body = await res.json() as { pullRequests: Array<{ diffStats?: unknown }> };
        expect(body.pullRequests[0].diffStats).toBeUndefined();
    });

    it('passes status to upstream and always fetches top 100', async () => {
        await fetch(originPullRequestsUrl(`?status=closed&top=10&skip=5`, REPO_ID));
        expect(mockSvc.listPullRequests).toHaveBeenCalledWith(REPO_ID, { status: 'closed', top: 100, scope: 'mine' });
    });

    it('always fetches top 100 from upstream regardless of client top', async () => {
        await fetch(originPullRequestsUrl(`?top=200`, REPO_ID));
        expect(mockSvc.listPullRequests).toHaveBeenCalledWith(REPO_ID, { status: 'open', top: 100, scope: 'mine' });
    });

    it('defaults status=open and fetches top 100 from upstream', async () => {
        await fetch(originPullRequestsUrl(``, REPO_ID));
        expect(mockSvc.listPullRequests).toHaveBeenCalledWith(REPO_ID, { status: 'open', top: 100, scope: 'mine' });
    });

    it('returns 401 with unconfigured body when no provider config', async () => {
        (ProviderFactory.createPullRequestsService as ReturnType<typeof vi.fn>).mockResolvedValue(null);
        (ProviderFactory.detectProviderType as ReturnType<typeof vi.fn>).mockReturnValue('github');

        const res = await fetch(originPullRequestsUrl(``, REPO_ID));
        expect(res.status).toBe(401);
        const body = await res.json() as { error: string; detected: string; remoteUrl: string };
        expect(body.error).toBe('unconfigured');
        expect(body.detected).toBe('github');
        expect(body.remoteUrl).toBe(REMOTE_URL);
    });

    it('returns 401 with no-ado-credentials when ADO az CLI fails', async () => {
        (ProviderFactory.createPullRequestsService as ReturnType<typeof vi.fn>).mockResolvedValue({ error: 'no-ado-credentials' });

        const res = await fetch(originPullRequestsUrl(``, REPO_ID));
        expect(res.status).toBe(401);
        const body = await res.json() as { error: string };
        expect(body.error).toBe('no-ado-credentials');
    });

    it('returns 404 when repo not found', async () => {
        mockResolveRepo.mockResolvedValueOnce(null);
        const res = await fetch(originPullRequestsUrl(``, 'unknown'));
        expect(res.status).toBe(404);
        const body = await res.json() as { error: string };
        expect(body.error).toMatch(/unknown/);
    });

    it('filters by author display name', async () => {
        const pr2 = { ...mockPr, id: 43, number: 43, title: 'PR by Bob', author: { id: 'user2', displayName: 'Bob' } };
        (mockSvc.listPullRequests as ReturnType<typeof vi.fn>).mockResolvedValue([mockPr, pr2]);

        const res = await fetch(originPullRequestsUrl(`?author=alice`, REPO_ID));
        expect(res.status).toBe(200);
        const body = await res.json() as { pullRequests: unknown[]; total: number };
        expect(body.pullRequests).toHaveLength(1);
        expect(body.total).toBe(1);
    });

    it('filters by search title', async () => {
        const pr2 = { ...mockPr, id: 43, number: 43, title: 'Fix bug Y' };
        (mockSvc.listPullRequests as ReturnType<typeof vi.fn>).mockResolvedValue([mockPr, pr2]);

        const res = await fetch(originPullRequestsUrl(`?search=feature`, REPO_ID));
        expect(res.status).toBe(200);
        const body = await res.json() as { pullRequests: unknown[]; total: number };
        expect(body.pullRequests).toHaveLength(1);
    });

    it('returns 500 on unexpected error', async () => {
        (mockSvc.listPullRequests as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('network failure'));
        const res = await fetch(originPullRequestsUrl(``, REPO_ID));
        expect(res.status).toBe(500);
    });

    it('serves from cache on second call without hitting upstream', async () => {
        await fetch(originPullRequestsUrl(``, REPO_ID));
        expect(mockSvc.listPullRequests).toHaveBeenCalledTimes(1);

        const res2 = await fetch(originPullRequestsUrl(``, REPO_ID));
        expect(res2.status).toBe(200);
        const body = await res2.json() as { pullRequests: unknown[] };
        expect(body.pullRequests).toHaveLength(1);
        // Still only one upstream call
        expect(mockSvc.listPullRequests).toHaveBeenCalledTimes(1);
    });

    it('shares PR list cache entries across same-origin repo ids', async () => {
        const cloneRepoId = 'repo-clone-same-origin';
        mockResolveRepo.mockImplementation(async (repoId: string) => makeMockRepoInfo(repoId, REMOTE_URL));
        (mockSvc.listPullRequests as ReturnType<typeof vi.fn>).mockImplementation(async (repoId: string) => [
            { ...mockPr, repositoryId: repoId, title: `from ${repoId}` },
        ]);

        const first = await fetch(originPullRequestsUrl(``, REPO_ID));
        const firstBody = await first.json() as { pullRequests: Array<{ title: string }> };
        expect(firstBody.pullRequests[0].title).toBe(`from ${REPO_ID}`);

        const second = await fetch(originPullRequestsUrl(``, cloneRepoId));
        const secondBody = await second.json() as { pullRequests: Array<{ title: string }> };
        expect(second.status).toBe(200);
        expect(secondBody.pullRequests[0].title).toBe(`from ${REPO_ID}`);
        expect(mockSvc.listPullRequests).toHaveBeenCalledTimes(1);
    });

    it('keeps PR list cache entries isolated for distinct origins', async () => {
        const otherRepoId = 'repo-other-origin';
        mockResolveRepo.mockImplementation(async (repoId: string) => makeMockRepoInfo(
            repoId,
            repoId === otherRepoId ? 'https://github.com/org/other.git' : REMOTE_URL,
        ));
        (mockSvc.listPullRequests as ReturnType<typeof vi.fn>).mockImplementation(async (repoId: string) => [
            { ...mockPr, repositoryId: repoId, title: `from ${repoId}` },
        ]);

        await fetch(originPullRequestsUrl(``, REPO_ID));
        const other = await fetch(originPullRequestsUrl(``, otherRepoId, 'gh_org_other'));
        const otherBody = await other.json() as { pullRequests: Array<{ title: string }> };

        expect(other.status).toBe(200);
        expect(otherBody.pullRequests[0].title).toBe(`from ${otherRepoId}`);
        expect(mockSvc.listPullRequests).toHaveBeenCalledTimes(2);
    });

    it('force=true bypasses cache and repopulates', async () => {
        // Warm the cache
        await fetch(originPullRequestsUrl(``, REPO_ID));
        expect(mockSvc.listPullRequests).toHaveBeenCalledTimes(1);

        // Force refresh
        const res = await fetch(originPullRequestsUrl(`?force=true`, REPO_ID));
        expect(res.status).toBe(200);
        expect(mockSvc.listPullRequests).toHaveBeenCalledTimes(2);
    });

    it('re-fetches PR lists after the 60-minute cache TTL expires', async () => {
        await fetch(originPullRequestsUrl(``, REPO_ID));
        expect(mockSvc.listPullRequests).toHaveBeenCalledTimes(1);

        const realNow = Date.now;
        Date.now = () => realNow() + 61 * 60 * 1000;
        try {
            const res = await fetch(originPullRequestsUrl(``, REPO_ID));
            expect(res.status).toBe(200);
            expect(mockSvc.listPullRequests).toHaveBeenCalledTimes(2);
        } finally {
            Date.now = realNow;
        }
    });

    it('serves PR list data warmed by the background cache without an upstream call', async () => {
        await warmPullRequestWorkspaceCache({
            dataDir,
            workspaceId: REPO_ID,
            repoId: REPO_ID,
            service: new RepoTreeService(dataDir),
            suggestionsEnabled: true,
        });
        expect(mockSvc.listPullRequests).toHaveBeenCalledTimes(1);

        const res = await fetch(originPullRequestsUrl(``, REPO_ID));

        expect(res.status).toBe(200);
        const body = await res.json() as { pullRequests: unknown[]; fetchedAt?: number };
        expect(body.pullRequests).toHaveLength(1);
        expect(body.fetchedAt).toEqual(expect.any(Number));
        expect(mockSvc.listPullRequests).toHaveBeenCalledTimes(1);
    });

    it('preserves stale warmed PR list cache when a background refresh fails', async () => {
        await warmPullRequestWorkspaceCache({
            dataDir,
            workspaceId: REPO_ID,
            repoId: REPO_ID,
            service: new RepoTreeService(dataDir),
        });
        expect(mockSvc.listPullRequests).toHaveBeenCalledTimes(1);
        (mockSvc.listPullRequests as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('provider down'));

        await expect(warmPullRequestWorkspaceCache({
            dataDir,
            workspaceId: REPO_ID,
            repoId: REPO_ID,
            service: new RepoTreeService(dataDir),
        })).rejects.toThrow('provider down');

        const res = await fetch(originPullRequestsUrl(``, REPO_ID));

        expect(res.status).toBe(200);
        const body = await res.json() as { pullRequests: Array<{ number: number }> };
        expect(body.pullRequests).toHaveLength(1);
        expect(body.pullRequests[0].number).toBe(42);
        expect(mockSvc.listPullRequests).toHaveBeenCalledTimes(2);
    });

    it('does not auto-enqueue Team PR classification from list loads when the auto flag is disabled', async () => {
        const { bridge, queue } = makeAutoClassificationBridge();
        addPullRequestCoworkerToRoster(dataDir, REPO_ID, REPO_ID, {
            id: 'user1',
            displayName: 'Alice',
        });
        (mockSvc.listPullRequests as ReturnType<typeof vi.fn>).mockResolvedValue([
            { ...mockPr, headSha: 'head-auto' },
        ]);
        await restartServer({
            store: {} as any,
            bridge,
            getEnabled: () => false,
        });

        const res = await fetch(originPullRequestsUrl(`?workspaceId=${REPO_ID}`, REPO_ID));

        expect(res.status).toBe(200);
        expect(queue.enqueue).not.toHaveBeenCalled();
    });

    it('auto-enqueues missing Team PR classifications from list loads when enabled', async () => {
        const { bridge, queue } = makeAutoClassificationBridge();
        addPullRequestCoworkerToRoster(dataDir, REPO_ID, REPO_ID, {
            id: 'user1',
            displayName: 'Alice',
        });
        (mockSvc.listPullRequests as ReturnType<typeof vi.fn>).mockResolvedValue([
            { ...mockPr, headSha: 'head-auto' },
        ]);
        await restartServer({
            store: {} as any,
            bridge,
            getEnabled: () => true,
        });

        const res = await fetch(originPullRequestsUrl(`?workspaceId=${REPO_ID}`, REPO_ID));

        expect(res.status).toBe(200);
        expect(queue.enqueue).toHaveBeenCalledTimes(1);
        expect(queue.enqueue).toHaveBeenCalledWith(expect.objectContaining({
            priority: 'low',
            payload: expect.objectContaining({
                workspaceId: REPO_ID,
                repoId: REPO_ID,
                classificationStorageOriginId: ORIGIN_ID,
                classificationIdentifier: '42:head-auto',
                skills: ['classify-diff'],
            }),
        }));
    });

    it('keeps PR list loading non-blocking when auto-classification enqueue fails', async () => {
        const { bridge, queue } = makeAutoClassificationBridge({ throwOnEnqueue: true });
        addPullRequestCoworkerToRoster(dataDir, REPO_ID, REPO_ID, {
            id: 'user1',
            displayName: 'Alice',
        });
        (mockSvc.listPullRequests as ReturnType<typeof vi.fn>).mockResolvedValue([
            { ...mockPr, headSha: 'head-auto' },
        ]);
        await restartServer({
            store: {} as any,
            bridge,
            getEnabled: () => true,
        });

        const res = await fetch(originPullRequestsUrl(`?workspaceId=${REPO_ID}`, REPO_ID));
        const body = await res.json() as { pullRequests: unknown[] };

        expect(res.status).toBe(200);
        expect(body.pullRequests).toHaveLength(1);
        expect(queue.enqueue).toHaveBeenCalledTimes(1);
    });

    it('rejects manual Team auto-classification trigger when the flag is disabled', async () => {
        const { bridge, queue } = makeAutoClassificationBridge();
        await restartServer({
            store: {} as any,
            bridge,
            getEnabled: () => false,
        });

        const res = await fetch(originPullRequestsUrl(`/team-auto-classification`, REPO_ID), {
            method: 'POST',
            body: JSON.stringify({
                workspaceId: REPO_ID,
                pullRequests: [{ ...mockPr, headSha: 'head-manual' }],
            }),
        });

        expect(res.status).toBe(403);
        expect(queue.enqueue).not.toHaveBeenCalled();
    });

    it('manual Team auto-classification trigger reuses the bounded low-priority enqueue helper', async () => {
        const { bridge, queue } = makeAutoClassificationBridge();
        addPullRequestCoworkerToRoster(dataDir, REPO_ID, REPO_ID, {
            id: 'user1',
            displayName: 'Alice',
        });
        await restartServer({
            store: {} as any,
            bridge,
            getEnabled: () => true,
        });

        const res = await fetch(originPullRequestsUrl(`/team-auto-classification`, REPO_ID), {
            method: 'POST',
            body: JSON.stringify({
                workspaceId: REPO_ID,
                pullRequests: [{ ...mockPr, headSha: 'head-manual' }],
            }),
        });
        const body = await res.json() as { eligible: number; started: number; ready: number; running: number };

        expect(res.status).toBe(200);
        expect(body).toMatchObject({ eligible: 1, started: 1, ready: 0, running: 0 });
        expect(queue.enqueue).toHaveBeenCalledTimes(1);
        expect(queue.enqueue).toHaveBeenCalledWith(expect.objectContaining({
            priority: 'low',
            payload: expect.objectContaining({
                workspaceId: REPO_ID,
                repoId: REPO_ID,
                classificationStorageOriginId: ORIGIN_ID,
                classificationIdentifier: '42:head-manual',
                skills: ['classify-diff'],
            }),
        }));
    });

    it('manual Team auto-classification can target the canonical origin with an explicit workspace', async () => {
        const { bridge, queue } = makeAutoClassificationBridge();
        addPullRequestCoworkerToRoster(dataDir, REPO_ID, REPO_ID, {
            id: 'user1',
            displayName: 'Alice',
        });
        await restartServer({
            store: {} as any,
            bridge,
            getEnabled: () => true,
        });

        const res = await fetch(`${baseUrl}/api/origins/${ORIGIN_ID}/pull-requests/team-auto-classification`, {
            method: 'POST',
            body: JSON.stringify({
                workspaceId: REPO_ID,
                repoId: REPO_ID,
                pullRequests: [{ ...mockPr, headSha: 'head-origin-manual' }],
            }),
        });
        const body = await res.json() as { eligible: number; started: number };

        expect(res.status).toBe(200);
        expect(body).toMatchObject({ eligible: 1, started: 1 });
        expect(queue.enqueue).toHaveBeenCalledWith(expect.objectContaining({
            payload: expect.objectContaining({
                workspaceId: REPO_ID,
                repoId: REPO_ID,
                classificationStorageOriginId: ORIGIN_ID,
                classificationIdentifier: '42:head-origin-manual',
            }),
        }));
    });

    it('rejects origin Team auto-classification without a concrete workspace', async () => {
        const { bridge } = makeAutoClassificationBridge();
        await restartServer({
            store: {} as any,
            bridge,
            getEnabled: () => true,
        });

        const res = await fetch(`${baseUrl}/api/origins/${ORIGIN_ID}/pull-requests/team-auto-classification`, {
            method: 'POST',
            body: JSON.stringify({
                pullRequests: [{ ...mockPr, headSha: 'head-origin-manual' }],
            }),
        });

        expect(res.status).toBe(400);
        await expect(res.text()).resolves.toContain('workspaceId is required');
    });

    it('background warm can request Team auto-classification only when enabled', async () => {
        const { bridge, queue } = makeAutoClassificationBridge();
        addPullRequestCoworkerToRoster(dataDir, REPO_ID, REPO_ID, {
            id: 'user1',
            displayName: 'Alice',
        });
        (mockSvc.listPullRequests as ReturnType<typeof vi.fn>).mockResolvedValue([
            { ...mockPr, headSha: 'head-auto' },
        ]);

        await warmPullRequestWorkspaceCache({
            dataDir,
            workspaceId: REPO_ID,
            repoId: REPO_ID,
            service: new RepoTreeService(dataDir),
            store: {} as any,
            bridge,
            autoClassifyTeamEnabled: false,
        });
        expect(queue.enqueue).not.toHaveBeenCalled();
        expect(mockSvc.listPullRequests).toHaveBeenCalledTimes(1);

        clearPrListCache();
        await warmPullRequestWorkspaceCache({
            dataDir,
            workspaceId: REPO_ID,
            repoId: REPO_ID,
            service: new RepoTreeService(dataDir),
            store: {} as any,
            bridge,
            autoClassifyTeamEnabled: true,
        });

        expect(mockSvc.listPullRequests).toHaveBeenCalledWith(REPO_ID, { status: 'open', top: 100, scope: 'all' });
        expect(queue.enqueue).toHaveBeenCalledTimes(1);
    });

    it('background warm uses the explicit workspace id for Team roster matching and classification state', async () => {
        const workspaceId = 'workspace-other-than-repo';
        const { bridge, queue } = makeAutoClassificationBridge();
        addPullRequestCoworkerToRoster(dataDir, workspaceId, REPO_ID, {
            id: 'user1',
            displayName: 'Alice',
        });
        addPullRequestCoworkerToRoster(dataDir, REPO_ID, REPO_ID, {
            id: 'other-user',
            displayName: 'Other User',
        });
        (mockSvc.listPullRequests as ReturnType<typeof vi.fn>).mockResolvedValue([
            { ...mockPr, headSha: 'head-workspace-scoped' },
        ]);

        await warmPullRequestWorkspaceCache({
            dataDir,
            workspaceId,
            repoId: REPO_ID,
            service: new RepoTreeService(dataDir),
            store: {} as any,
            bridge,
            autoClassifyTeamEnabled: true,
        });

        expect(queue.enqueue).toHaveBeenCalledTimes(1);
        expect(queue.enqueue).toHaveBeenCalledWith(expect.objectContaining({
            payload: expect.objectContaining({
                workspaceId,
                repoId: REPO_ID,
                classificationStorageOriginId: ORIGIN_ID,
                classificationIdentifier: '42:head-workspace-scoped',
            }),
        }));
    });

    it('paginates from cache without upstream call', async () => {
        const prs = Array.from({ length: 50 }, (_, i) => ({ ...mockPr, id: i, number: i, title: `PR ${i}` }));
        (mockSvc.listPullRequests as ReturnType<typeof vi.fn>).mockResolvedValue(prs);

        // First call warms cache
        const res1 = await fetch(originPullRequestsUrl(`?top=25&skip=0`, REPO_ID));
        expect(res1.status).toBe(200);
        const body1 = await res1.json() as { pullRequests: any[] };
        expect(body1.pullRequests).toHaveLength(25);

        // Second page from cache
        const res2 = await fetch(originPullRequestsUrl(`?top=25&skip=25`, REPO_ID));
        expect(res2.status).toBe(200);
        const body2 = await res2.json() as { pullRequests: any[] };
        expect(body2.pullRequests).toHaveLength(25);
        expect(body2.pullRequests[0].title).toBe('PR 25');

        // Only one upstream call total
        expect(mockSvc.listPullRequests).toHaveBeenCalledTimes(1);
    });

    it('uses separate cache entries per status filter', async () => {
        await fetch(originPullRequestsUrl(`?status=open`, REPO_ID));
        await fetch(originPullRequestsUrl(`?status=closed`, REPO_ID));
        expect(mockSvc.listPullRequests).toHaveBeenCalledTimes(2);

        // Both are now cached — no additional calls
        await fetch(originPullRequestsUrl(`?status=open`, REPO_ID));
        await fetch(originPullRequestsUrl(`?status=closed`, REPO_ID));
        expect(mockSvc.listPullRequests).toHaveBeenCalledTimes(2);
    });

    it('passes scope=all to upstream when requested', async () => {
        await fetch(originPullRequestsUrl(`?scope=all`, REPO_ID));
        expect(mockSvc.listPullRequests).toHaveBeenCalledWith(REPO_ID, { status: 'open', top: 100, scope: 'all' });
    });

    it('defaults scope to mine when not specified', async () => {
        await fetch(originPullRequestsUrl(``, REPO_ID));
        expect(mockSvc.listPullRequests).toHaveBeenCalledWith(REPO_ID, { status: 'open', top: 100, scope: 'mine' });
    });

    it('ignores invalid scope values and defaults to mine', async () => {
        await fetch(originPullRequestsUrl(`?scope=invalid`, REPO_ID));
        expect(mockSvc.listPullRequests).toHaveBeenCalledWith(REPO_ID, { status: 'open', top: 100, scope: 'mine' });
    });

    it('uses separate cache entries per scope', async () => {
        await fetch(originPullRequestsUrl(`?scope=mine`, REPO_ID));
        await fetch(originPullRequestsUrl(`?scope=all`, REPO_ID));
        expect(mockSvc.listPullRequests).toHaveBeenCalledTimes(2);

        // Both are now cached
        await fetch(originPullRequestsUrl(`?scope=mine`, REPO_ID));
        await fetch(originPullRequestsUrl(`?scope=all`, REPO_ID));
        expect(mockSvc.listPullRequests).toHaveBeenCalledTimes(2);
    });

    it('scope=team fetches with scope=all and filters by coworker roster', async () => {
        const prAlice = { ...mockPr, id: 1, number: 1, title: 'PR by Alice', author: { id: 'user1', displayName: 'Alice' } };
        const prBob = { ...mockPr, id: 2, number: 2, title: 'PR by Bob', author: { id: 'user2', displayName: 'Bob' } };
        const prCharlie = { ...mockPr, id: 3, number: 3, title: 'PR by Charlie', author: { id: 'user3', displayName: 'Charlie' } };
        const allPrs = [prAlice, prBob, prCharlie];
        (mockSvc.listPullRequests as ReturnType<typeof vi.fn>).mockImplementation((_repoId: string, criteria?: any) => {
            if (criteria?.authorId) {
                return Promise.resolve(allPrs.filter(pr => pr.author.id === criteria.authorId));
            }
            return Promise.resolve(allPrs);
        });

        // Add only Alice and Charlie to the roster
        addPullRequestCoworkerToRoster(dataDir, REPO_ID, REPO_ID, { id: 'user1', displayName: 'Alice' });
        addPullRequestCoworkerToRoster(dataDir, REPO_ID, REPO_ID, { id: 'user3', displayName: 'Charlie' });

        const res = await fetch(originPullRequestsUrl(`?scope=team`, REPO_ID));
        expect(res.status).toBe(200);
        const body = await res.json() as { pullRequests: Array<{ title: string }>; total: number };
        expect(body.pullRequests).toHaveLength(2);
        expect(body.pullRequests.map(pr => pr.title)).toEqual(['PR by Alice', 'PR by Charlie']);
        expect(body.total).toBe(2);
        // Internally fetches with scope=all first, then per-member
        expect(mockSvc.listPullRequests).toHaveBeenCalledWith(REPO_ID, { status: 'open', top: 100, scope: 'all' });
        expect(mockSvc.listPullRequests).toHaveBeenCalledWith(REPO_ID, { status: 'open', top: 25, authorId: 'user1' });
        expect(mockSvc.listPullRequests).toHaveBeenCalledWith(REPO_ID, { status: 'open', top: 25, authorId: 'user3' });
    });

    it('scope=team returns empty list when no roster entries exist', async () => {
        const prAlice = { ...mockPr, id: 1, number: 1, title: 'PR by Alice', author: { id: 'user1', displayName: 'Alice' } };
        (mockSvc.listPullRequests as ReturnType<typeof vi.fn>).mockResolvedValue([prAlice]);

        const res = await fetch(originPullRequestsUrl(`?scope=team`, REPO_ID));
        expect(res.status).toBe(200);
        const body = await res.json() as { pullRequests: unknown[]; total: number };
        expect(body.pullRequests).toHaveLength(0);
        expect(body.total).toBe(0);
    });

    it('scope=team reuses cached scope=all data and supplements with per-member fetches', async () => {
        const prAlice = { ...mockPr, id: 1, number: 1, title: 'PR by Alice', author: { id: 'user1', displayName: 'Alice' } };
        (mockSvc.listPullRequests as ReturnType<typeof vi.fn>).mockImplementation((_repoId: string, criteria?: any) => {
            if (criteria?.authorId === 'user1') {
                return Promise.resolve([prAlice]);
            }
            return Promise.resolve([prAlice]);
        });
        addPullRequestCoworkerToRoster(dataDir, REPO_ID, REPO_ID, { id: 'user1', displayName: 'Alice' });

        // First call with scope=all populates cache
        await fetch(originPullRequestsUrl(`?scope=all`, REPO_ID));
        expect(mockSvc.listPullRequests).toHaveBeenCalledTimes(1);

        // scope=team reuses the scope=all cache but adds per-member fetch
        const res = await fetch(originPullRequestsUrl(`?scope=team`, REPO_ID));
        expect(res.status).toBe(200);
        // 1 (initial all) + 1 (per-member for user1) = 2
        expect(mockSvc.listPullRequests).toHaveBeenCalledTimes(2);
        const body = await res.json() as { pullRequests: Array<{ title: string }> };
        expect(body.pullRequests).toHaveLength(1);
        expect(body.pullRequests[0].title).toBe('PR by Alice');
    });

    it('scope=team paginates the filtered roster results', async () => {
        // Create 5 PRs from team members
        const teamPrs = Array.from({ length: 5 }, (_, i) => ({
            ...mockPr,
            id: i + 1,
            number: i + 1,
            title: `Team PR ${i + 1}`,
            author: { id: 'team-user', displayName: 'TeamUser' },
        }));
        // Intersperse with non-team PRs
        const otherPrs = Array.from({ length: 5 }, (_, i) => ({
            ...mockPr,
            id: i + 100,
            number: i + 100,
            title: `Other PR ${i + 1}`,
            author: { id: 'other-user', displayName: 'OtherUser' },
        }));
        // Interleave: other, team, other, team, ...
        const allPrs: any[] = [];
        for (let i = 0; i < 5; i++) {
            allPrs.push(otherPrs[i], teamPrs[i]);
        }
        (mockSvc.listPullRequests as ReturnType<typeof vi.fn>).mockImplementation((_repoId: string, criteria?: any) => {
            if (criteria?.authorId === 'team-user') {
                return Promise.resolve(teamPrs);
            }
            return Promise.resolve(allPrs);
        });
        addPullRequestCoworkerToRoster(dataDir, REPO_ID, REPO_ID, { id: 'team-user', displayName: 'TeamUser' });

        // Request page of 3
        const res = await fetch(originPullRequestsUrl(`?scope=team&top=3&skip=0`, REPO_ID));
        const body = await res.json() as { pullRequests: Array<{ title: string }>; total: number };
        expect(body.pullRequests).toHaveLength(3);
        expect(body.total).toBe(5); // total team PRs
        expect(body.pullRequests.map(pr => pr.title)).toEqual(['Team PR 1', 'Team PR 2', 'Team PR 3']);

        // Second page
        const res2 = await fetch(originPullRequestsUrl(`?scope=team&top=3&skip=3`, REPO_ID));
        const body2 = await res2.json() as { pullRequests: Array<{ title: string }>; total: number };
        expect(body2.pullRequests).toHaveLength(2);
        expect(body2.total).toBe(5);
        expect(body2.pullRequests.map(pr => pr.title)).toEqual(['Team PR 4', 'Team PR 5']);
    });
});

describe('GET /api/origins/:originId/pull-requests/coworker-candidates', () => {
    it('validates minimum query length before resolving the provider', async () => {
        const res = await fetch(originPullRequestsUrl(`/coworker-candidates?workspaceId=ws-1&repoId=${REPO_ID}&query=a`));

        expect(res.status).toBe(400);
        const body = await res.json() as { error: string; minimumQueryLength: number };
        expect(body.error).toContain('at least 2 characters');
        expect(body.minimumQueryLength).toBe(2);
        expect(mockSvc.listPullRequests).not.toHaveBeenCalled();
        expect(mockSvc.getDiff).not.toHaveBeenCalled();
    });

    it('dedupes matching authors, reports PR counts, and excludes existing roster entries by workspace', async () => {
        addPullRequestCoworkerToRoster(dataDir, 'ws-a', REPO_ID, {
            id: 'alice-id',
            displayName: 'Alice Old',
        });
        (mockSvc.listPullRequests as ReturnType<typeof vi.fn>).mockResolvedValue([
            {
                ...mockPr,
                id: 1,
                number: 1,
                author: {
                    id: 'alice-id',
                    displayName: 'Alice Dev',
                    email: 'alice@example.invalid',
                    avatarUrl: 'https://avatars.example.invalid/alice',
                },
            },
            { ...mockPr, id: 2, number: 2, author: { id: 'alice-id', displayName: 'Alice Dev' } },
            { ...mockPr, id: 3, number: 3, author: { id: 'alex-id', displayName: 'Alex Dev' } },
            { ...mockPr, id: 4, number: 4, author: { id: 'mona-id', displayName: 'Mona Dev' } },
        ]);

        const excluded = await fetch(originPullRequestsUrl(`/coworker-candidates?workspaceId=ws-a&repoId=${REPO_ID}&query=al&top=10`));
        expect(excluded.status).toBe(200);
        const excludedBody = await excluded.json() as { candidates: Array<{ id: string; displayName: string; prCount: number; isInRoster: boolean }> };
        expect(excludedBody.candidates).toEqual([
            { id: 'alex-id', displayName: 'Alex Dev', prCount: 1, isInRoster: false },
        ]);

        const included = await fetch(originPullRequestsUrl(`/coworker-candidates?workspaceId=ws-a&repoId=${REPO_ID}&query=al&includeRoster=true`));
        expect(included.status).toBe(200);
        const includedBody = await included.json() as { candidates: Array<{ id: string; displayName: string; email?: string; avatarUrl?: string; prCount: number; isInRoster: boolean }> };
        expect(includedBody.candidates).toEqual([
            {
                id: 'alice-id',
                displayName: 'Alice Dev',
                email: 'alice@example.invalid',
                avatarUrl: 'https://avatars.example.invalid/alice',
                prCount: 2,
                isInRoster: true,
            },
            { id: 'alex-id', displayName: 'Alex Dev', prCount: 1, isInRoster: false },
        ]);

        const otherWorkspace = await fetch(originPullRequestsUrl(`/coworker-candidates?workspaceId=ws-b&repoId=${REPO_ID}&query=al`));
        expect(otherWorkspace.status).toBe(200);
        const otherWorkspaceBody = await otherWorkspace.json() as { candidates: Array<{ id: string; isInRoster: boolean }> };
        expect(otherWorkspaceBody.candidates.map(candidate => candidate.id)).toEqual(['alex-id']);
        expect(otherWorkspaceBody.candidates.every(candidate => candidate.isInRoster === false)).toBe(true);

        expect(mockSvc.listPullRequests).toHaveBeenCalledWith(REPO_ID, { status: 'open', top: 100, skip: 0, scope: 'all' });
        expect(mockSvc.listPullRequests).toHaveBeenCalledTimes(2);
        expect(mockSvc.getDiff).not.toHaveBeenCalled();
    });

    it('uses provider pagination and caches repeated searches without diff enrichment', async () => {
        const firstPage = Array.from({ length: 100 }, (_, index) => ({
            ...mockPr,
            id: index + 1,
            number: index + 1,
            author: { id: `user-${index + 1}`, displayName: `User ${index + 1}` },
        }));
        const secondPage = [
            {
                ...mockPr,
                id: 101,
                number: 101,
                author: { id: 'zoe-id', displayName: 'Zoe Zebra' },
            },
        ];
        (mockSvc.listPullRequests as ReturnType<typeof vi.fn>)
            .mockResolvedValueOnce(firstPage)
            .mockResolvedValueOnce(secondPage);

        const first = await fetch(originPullRequestsUrl(`/coworker-candidates?workspaceId=ws-1&repoId=${REPO_ID}&query=zo`));
        expect(first.status).toBe(200);
        const firstBody = await first.json() as { candidates: Array<{ id: string; displayName: string; prCount: number; isInRoster: boolean }>; scannedPullRequests: number; truncated: boolean };
        expect(firstBody.candidates).toEqual([
            { id: 'zoe-id', displayName: 'Zoe Zebra', prCount: 1, isInRoster: false },
        ]);
        expect(firstBody.scannedPullRequests).toBe(101);
        expect(firstBody.truncated).toBe(false);

        const second = await fetch(originPullRequestsUrl(`/coworker-candidates?workspaceId=ws-1&repoId=${REPO_ID}&query=zo`));
        expect(second.status).toBe(200);
        const secondBody = await second.json() as { candidates: Array<{ id: string; displayName: string; prCount: number; isInRoster: boolean }> };
        expect(secondBody.candidates).toEqual([
            { id: 'zoe-id', displayName: 'Zoe Zebra', prCount: 1, isInRoster: false },
        ]);

        expect(mockSvc.listPullRequests).toHaveBeenNthCalledWith(1, REPO_ID, { status: 'open', top: 100, skip: 0, scope: 'all' });
        expect(mockSvc.listPullRequests).toHaveBeenNthCalledWith(2, REPO_ID, { status: 'open', top: 100, skip: 100, scope: 'all' });
        expect(mockSvc.listPullRequests).toHaveBeenCalledTimes(2);
        expect(mockSvc.getDiff).not.toHaveBeenCalled();
    });
});

describe('GET /api/origins/:originId/pull-requests', () => {
    it('does not register repo-scoped pull request aliases', async () => {
        const list = await fetch(`${baseUrl}/api/repos/${REPO_ID}/pull-requests`);
        const detail = await fetch(`${baseUrl}/api/repos/${REPO_ID}/pull-requests/42`);
        const diff = await fetch(`${baseUrl}/api/repos/${REPO_ID}/pull-requests/42/diff`);
        const candidates = await fetch(`${baseUrl}/api/repos/${REPO_ID}/pull-requests/coworker-candidates?workspaceId=ws-1&query=al`);

        expect(list.status).toBe(404);
        expect(detail.status).toBe(404);
        expect(diff.status).toBe(404);
        expect(candidates.status).toBe(404);
        expect(mockSvc.listPullRequests).not.toHaveBeenCalled();
        expect(mockSvc.getPullRequest).not.toHaveBeenCalled();
        expect(mockSvc.getDiff).not.toHaveBeenCalled();
    });

    it('lists PRs through an explicit workspace that resolves to the origin', async () => {
        const res = await fetch(`${baseUrl}/api/origins/${ORIGIN_ID}/pull-requests?workspaceId=${REPO_ID}&repoId=${REPO_ID}&scope=all`);
        expect(res.status).toBe(200);
        const body = await res.json() as { pullRequests: unknown[]; total: number; fetchedAt?: number };
        expect(body.pullRequests).toHaveLength(1);
        expect(body.total).toBe(1);
        expect(body.fetchedAt).toEqual(expect.any(Number));
        expect(mockSvc.listPullRequests).toHaveBeenCalledWith(REPO_ID, { status: 'open', top: 100, scope: 'all' });
    });

    it('rejects origin list requests without a concrete workspace', async () => {
        const res = await fetch(`${baseUrl}/api/origins/${ORIGIN_ID}/pull-requests`);
        expect(res.status).toBe(400);
        await expect(res.text()).resolves.toContain('workspaceId is required');
        expect(mockSvc.listPullRequests).not.toHaveBeenCalled();
    });

    it('rejects origin list requests when the workspace resolves to a different origin', async () => {
        mockResolveRepo.mockResolvedValueOnce(makeMockRepoInfo(REPO_ID, 'https://github.com/other/repo.git'));

        const res = await fetch(`${baseUrl}/api/origins/${ORIGIN_ID}/pull-requests?workspaceId=${REPO_ID}&repoId=${REPO_ID}`);
        expect(res.status).toBe(400);
        await expect(res.text()).resolves.toContain('not gh_org_repo');
        expect(mockSvc.listPullRequests).not.toHaveBeenCalled();
    });
});

// ── GET /api/origins/:originId/pull-requests/:prId ───────────────────────────────────

describe('GET /api/origins/:originId/pull-requests/:prId', () => {
    it('returns single PR on success', async () => {
        const res = await fetch(originPullRequestsUrl(`/42`, REPO_ID));
        expect(res.status).toBe(200);
        const body = await res.json() as { number: number };
        expect(body.number).toBe(42);
    });

    it('returns 404 when repo not found', async () => {
        mockResolveRepo.mockResolvedValueOnce(null);
        const res = await fetch(originPullRequestsUrl(`/42`, 'unknown'));
        expect(res.status).toBe(404);
    });

    it('returns 404 when PR not found', async () => {
        (mockSvc.getPullRequest as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('PR 999 not found'));
        const res = await fetch(originPullRequestsUrl(`/999`, REPO_ID));
        expect(res.status).toBe(404);
    });

    it('returns 401 when unconfigured', async () => {
        (ProviderFactory.createPullRequestsService as ReturnType<typeof vi.fn>).mockResolvedValue(null);
        const res = await fetch(originPullRequestsUrl(`/42`, REPO_ID));
        expect(res.status).toBe(401);
        const body = await res.json() as { error: string };
        expect(body.error).toBe('unconfigured');
    });

    it('returns 500 on unexpected error', async () => {
        (mockSvc.getPullRequest as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('oops'));
        const res = await fetch(originPullRequestsUrl(`/42`, REPO_ID));
        expect(res.status).toBe(500);
    });
});

describe('GET /api/origins/:originId/pull-requests/:prId', () => {
    it('gets a single PR through an explicit workspace that resolves to the origin', async () => {
        const res = await fetch(`${baseUrl}/api/origins/${ORIGIN_ID}/pull-requests/42?workspaceId=${REPO_ID}&repoId=${REPO_ID}`);
        expect(res.status).toBe(200);
        const body = await res.json() as { number: number };
        expect(body.number).toBe(42);
        expect(mockSvc.getPullRequest).toHaveBeenCalledWith(REPO_ID, '42');
    });

    it('rejects origin detail requests without a concrete workspace', async () => {
        const res = await fetch(`${baseUrl}/api/origins/${ORIGIN_ID}/pull-requests/42`);
        expect(res.status).toBe(400);
        await expect(res.text()).resolves.toContain('workspaceId is required');
        expect(mockSvc.getPullRequest).not.toHaveBeenCalled();
    });
});

describe('GET /api/origins/:originId/pull-requests/:prId provider subresources', () => {
    it('serves threads, reviewers, commits, and checks through an explicit workspace', async () => {
        const query = `workspaceId=${REPO_ID}&repoId=${REPO_ID}`;
        const threads = await fetch(`${baseUrl}/api/origins/${ORIGIN_ID}/pull-requests/42/threads?${query}`);
        const reviewers = await fetch(`${baseUrl}/api/origins/${ORIGIN_ID}/pull-requests/42/reviewers?${query}`);
        const commits = await fetch(`${baseUrl}/api/origins/${ORIGIN_ID}/pull-requests/42/commits?${query}`);
        const checks = await fetch(`${baseUrl}/api/origins/${ORIGIN_ID}/pull-requests/42/checks?${query}`);

        expect(threads.status).toBe(200);
        expect(reviewers.status).toBe(200);
        expect(commits.status).toBe(200);
        expect(checks.status).toBe(200);
        const threadsBody = await threads.json() as { threads: Array<{ id: number }> };
        const reviewersBody = await reviewers.json() as { reviewers: unknown[] };
        const commitsBody = await commits.json() as { commits: Array<{ id: string }> };
        const checksBody = await checks.json() as { checks: Array<{ id: string }> };
        expect(threadsBody.threads).toHaveLength(1);
        expect(threadsBody.threads[0].id).toBe(1);
        expect(reviewersBody.reviewers).toHaveLength(1);
        expect(commitsBody.commits).toHaveLength(1);
        expect(commitsBody.commits[0].id).toBe(mockCommit.id);
        expect(checksBody.checks).toHaveLength(1);
        expect(checksBody.checks[0].id).toBe(mockCheck.id);
        expect(mockSvc.getThreads).toHaveBeenCalledWith(REPO_ID, '42');
        expect(mockSvc.getReviewers).toHaveBeenCalledWith(REPO_ID, '42');
        expect(mockSvc.getCommits).toHaveBeenCalledWith(REPO_ID, '42');
        expect(mockSvc.getChecks).toHaveBeenCalledWith(REPO_ID, '42');
    });

    it('serves combined and per-file diffs through origin routes using the same origin cache', async () => {
        const combinedDiff = [
            'diff --git a/src/foo.ts b/src/foo.ts',
            '--- a/src/foo.ts',
            '+++ b/src/foo.ts',
            '@@ -1 +1 @@',
            '-old',
            '+new',
        ].join('\n');
        (mockSvc.getDiff as ReturnType<typeof vi.fn>).mockResolvedValue(combinedDiff);

        const query = `workspaceId=${REPO_ID}&repoId=${REPO_ID}`;
        const diffRes = await fetch(`${baseUrl}/api/origins/${ORIGIN_ID}/pull-requests/42/diff?${query}`);
        const fileRes = await fetch(`${baseUrl}/api/origins/${ORIGIN_ID}/pull-requests/42/diff/files/${encodeURIComponent('src/foo.ts')}?${query}`);

        expect(diffRes.status).toBe(200);
        await expect(diffRes.text()).resolves.toBe(combinedDiff);
        expect(fileRes.status).toBe(200);
        const fileBody = await fileRes.json() as { diff: string };
        expect(fileBody.diff).toContain('diff --git a/src/foo.ts b/src/foo.ts');
        expect(mockSvc.getDiff).toHaveBeenCalledTimes(1);
    });

    it('rejects origin subresource requests without a concrete workspace', async () => {
        const res = await fetch(`${baseUrl}/api/origins/${ORIGIN_ID}/pull-requests/42/threads`);
        expect(res.status).toBe(400);
        await expect(res.text()).resolves.toContain('workspaceId is required');
        expect(mockSvc.getThreads).not.toHaveBeenCalled();
    });

    it('rejects origin subresource requests when the workspace resolves to another origin', async () => {
        mockResolveRepo.mockResolvedValueOnce(makeMockRepoInfo(REPO_ID, 'https://github.com/other/repo.git'));

        const res = await fetch(`${baseUrl}/api/origins/${ORIGIN_ID}/pull-requests/42/checks?workspaceId=${REPO_ID}&repoId=${REPO_ID}`);

        expect(res.status).toBe(400);
        await expect(res.text()).resolves.toContain('not gh_org_repo');
        expect(mockSvc.getChecks).not.toHaveBeenCalled();
    });
});

// ── GET /api/origins/:originId/pull-requests/:prId/threads ───────────────────────────

describe('GET /api/origins/:originId/pull-requests/:prId/threads', () => {
    it('returns threads array on success', async () => {
        const res = await fetch(originPullRequestsUrl(`/42/threads`, REPO_ID));
        expect(res.status).toBe(200);
        const body = await res.json() as { threads: unknown[] };
        expect(Array.isArray(body.threads)).toBe(true);
        expect(body.threads).toHaveLength(1);
    });

    it('returns 404 when repo not found', async () => {
        mockResolveRepo.mockResolvedValueOnce(null);
        const res = await fetch(originPullRequestsUrl(`/42/threads`, 'unknown'));
        expect(res.status).toBe(404);
    });

    it('returns 500 on unexpected error', async () => {
        (mockSvc.getThreads as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('network'));
        const res = await fetch(originPullRequestsUrl(`/42/threads`, REPO_ID));
        expect(res.status).toBe(500);
    });
});

// ── GET /api/origins/:originId/pull-requests/:prId/reviewers ─────────────────────────

describe('GET /api/origins/:originId/pull-requests/:prId/reviewers', () => {
    it('returns reviewers array on success', async () => {
        const res = await fetch(originPullRequestsUrl(`/42/reviewers`, REPO_ID));
        expect(res.status).toBe(200);
        const body = await res.json() as { reviewers: unknown[] };
        expect(Array.isArray(body.reviewers)).toBe(true);
        expect(body.reviewers).toHaveLength(1);
    });

    it('returns 404 when repo not found', async () => {
        mockResolveRepo.mockResolvedValueOnce(null);
        const res = await fetch(originPullRequestsUrl(`/42/reviewers`, 'unknown'));
        expect(res.status).toBe(404);
    });

    it('returns 500 on unexpected error', async () => {
        (mockSvc.getReviewers as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('network'));
        const res = await fetch(originPullRequestsUrl(`/42/reviewers`, REPO_ID));
        expect(res.status).toBe(500);
    });
});

// ── GET /api/origins/:originId/pull-requests/:prId/commits ──────────────────────────

describe('GET /api/origins/:originId/pull-requests/:prId/commits', () => {
    it('returns commits array on success', async () => {
        const res = await fetch(originPullRequestsUrl(`/42/commits`, REPO_ID));
        expect(res.status).toBe(200);
        const body = await res.json() as { commits: unknown[] };
        expect(Array.isArray(body.commits)).toBe(true);
        expect(body.commits).toHaveLength(1);
        expect(mockSvc.getCommits).toHaveBeenCalledWith(REPO_ID, '42');
    });

    it('returns empty array when getCommits is not implemented', async () => {
        const svcWithoutCommits = { ...mockSvc };
        delete (svcWithoutCommits as any).getCommits;
        (ProviderFactory.createPullRequestsService as ReturnType<typeof vi.fn>).mockResolvedValue(svcWithoutCommits);

        const res = await fetch(originPullRequestsUrl(`/42/commits`, REPO_ID));
        expect(res.status).toBe(200);
        const body = await res.json() as { commits: unknown[] };
        expect(body.commits).toEqual([]);
    });

    it('returns 404 when repo not found', async () => {
        mockResolveRepo.mockResolvedValueOnce(null);
        const res = await fetch(originPullRequestsUrl(`/42/commits`, 'unknown'));
        expect(res.status).toBe(404);
    });

    it('returns 401 when unconfigured', async () => {
        (ProviderFactory.createPullRequestsService as ReturnType<typeof vi.fn>).mockResolvedValue(null);
        const res = await fetch(originPullRequestsUrl(`/42/commits`, REPO_ID));
        expect(res.status).toBe(401);
        const body = await res.json() as { error: string };
        expect(body.error).toBe('unconfigured');
    });

    it('returns 500 on unexpected error', async () => {
        (mockSvc.getCommits as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('network'));
        const res = await fetch(originPullRequestsUrl(`/42/commits`, REPO_ID));
        expect(res.status).toBe(500);
    });
});

// ── GET /api/origins/:originId/pull-requests/:prId/diff ───────────────────────────────

describe('GET /api/origins/:originId/pull-requests/:prId/diff', () => {
    it('returns diff text on success', async () => {
        const res = await fetch(originPullRequestsUrl(`/42/diff`, REPO_ID));
        expect(res.status).toBe(200);
        const text = await res.text();
        expect(text).toContain('diff --git');
    });

    it('returns empty string when getDiff is not implemented', async () => {
        const svcWithoutDiff = { ...mockSvc };
        delete (svcWithoutDiff as any).getDiff;
        (ProviderFactory.createPullRequestsService as ReturnType<typeof vi.fn>).mockResolvedValue(svcWithoutDiff);

        const res = await fetch(originPullRequestsUrl(`/42/diff`, REPO_ID));
        expect(res.status).toBe(200);
        const text = await res.text();
        expect(text).toBe('');
    });

    it('returns 404 when repo not found', async () => {
        mockResolveRepo.mockResolvedValueOnce(null);
        const res = await fetch(originPullRequestsUrl(`/42/diff`, 'unknown'));
        expect(res.status).toBe(404);
    });

    it('returns 401 when unconfigured', async () => {
        (ProviderFactory.createPullRequestsService as ReturnType<typeof vi.fn>).mockResolvedValue(null);
        const res = await fetch(originPullRequestsUrl(`/42/diff`, REPO_ID));
        expect(res.status).toBe(401);
        const body = await res.json() as { error: string };
        expect(body.error).toBe('unconfigured');
    });

    it('returns 500 on unexpected error', async () => {
        (mockSvc.getDiff as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('network'));
        const res = await fetch(originPullRequestsUrl(`/42/diff`, REPO_ID));
        expect(res.status).toBe(500);
    });
});

// ── GET /api/origins/:originId/pull-requests/:prId/commits ────────────────────────────

describe('GET /api/origins/:originId/pull-requests/:prId/commits', () => {
    it('returns commits array on success', async () => {
        const res = await fetch(originPullRequestsUrl(`/42/commits`, REPO_ID));
        expect(res.status).toBe(200);
        const body = await res.json() as { commits: Array<{ id: string; shortId: string; subject: string }> };
        expect(Array.isArray(body.commits)).toBe(true);
        expect(body.commits).toHaveLength(1);
        expect(body.commits[0].shortId).toBe('abc1234');
        expect(body.commits[0].subject).toBe('feat: stream JSONL parser');
    });

    it('returns empty array when getCommits is not implemented', async () => {
        const svcWithoutCommits = { ...mockSvc };
        delete (svcWithoutCommits as any).getCommits;
        (ProviderFactory.createPullRequestsService as ReturnType<typeof vi.fn>).mockResolvedValue(svcWithoutCommits);

        const res = await fetch(originPullRequestsUrl(`/42/commits`, REPO_ID));
        expect(res.status).toBe(200);
        const body = await res.json() as { commits: unknown[] };
        expect(body.commits).toEqual([]);
    });

    it('returns 404 when repo not found', async () => {
        mockResolveRepo.mockResolvedValueOnce(null);
        const res = await fetch(originPullRequestsUrl(`/42/commits`, 'unknown'));
        expect(res.status).toBe(404);
    });

    it('returns 401 when unconfigured', async () => {
        (ProviderFactory.createPullRequestsService as ReturnType<typeof vi.fn>).mockResolvedValue(null);
        const res = await fetch(originPullRequestsUrl(`/42/commits`, REPO_ID));
        expect(res.status).toBe(401);
        const body = await res.json() as { error: string };
        expect(body.error).toBe('unconfigured');
    });

    it('returns 401 with no-ado-credentials when ADO az CLI fails', async () => {
        (ProviderFactory.createPullRequestsService as ReturnType<typeof vi.fn>).mockResolvedValue({ error: 'no-ado-credentials' });
        const res = await fetch(originPullRequestsUrl(`/42/commits`, REPO_ID));
        expect(res.status).toBe(401);
        const body = await res.json() as { error: string };
        expect(body.error).toBe('no-ado-credentials');
    });

    it('returns 500 on unexpected error', async () => {
        (mockSvc.getCommits as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('network'));
        const res = await fetch(originPullRequestsUrl(`/42/commits`, REPO_ID));
        expect(res.status).toBe(500);
    });
});

// ── GET /api/origins/:originId/pull-requests/:prId/diff/files/:filePath ─────────────

describe('GET /api/origins/:originId/pull-requests/:prId/diff/files/:filePath', () => {
    const combinedDiff = [
        'diff --git a/src/foo.ts b/src/foo.ts',
        '--- a/src/foo.ts',
        '+++ b/src/foo.ts',
        '@@ -1,3 +1,4 @@',
        ' line1',
        '+added',
        'diff --git a/src/bar.ts b/src/bar.ts',
        '--- a/src/bar.ts',
        '+++ b/src/bar.ts',
        '@@ -1,2 +1,2 @@',
        '-old',
        '+new',
    ].join('\n');

    it('returns extracted file diff as JSON on success', async () => {
        (mockSvc.getDiff as ReturnType<typeof vi.fn>).mockResolvedValue(combinedDiff);
        const res = await fetch(originPullRequestsUrl(`/42/diff/files/${encodeURIComponent('src/foo.ts')}`, REPO_ID));
        expect(res.status).toBe(200);
        const body = await res.json() as { diff: string };
        expect(body.diff).toContain('diff --git a/src/foo.ts b/src/foo.ts');
        expect(body.diff).toContain('+added');
        expect(body.diff).not.toContain('src/bar.ts');
    });

    it('returns empty diff when file not found in combined diff', async () => {
        (mockSvc.getDiff as ReturnType<typeof vi.fn>).mockResolvedValue(combinedDiff);
        const res = await fetch(originPullRequestsUrl(`/42/diff/files/${encodeURIComponent('src/missing.ts')}`, REPO_ID));
        expect(res.status).toBe(200);
        const body = await res.json() as { diff: string };
        expect(body.diff).toBe('');
    });

    it('returns empty diff when getDiff is not implemented', async () => {
        const svcWithoutDiff = { ...mockSvc };
        delete (svcWithoutDiff as any).getDiff;
        (ProviderFactory.createPullRequestsService as ReturnType<typeof vi.fn>).mockResolvedValue(svcWithoutDiff);

        const res = await fetch(originPullRequestsUrl(`/42/diff/files/${encodeURIComponent('src/foo.ts')}`, REPO_ID));
        expect(res.status).toBe(200);
        const body = await res.json() as { diff: string };
        expect(body.diff).toBe('');
    });

    it('returns 404 when repo not found', async () => {
        mockResolveRepo.mockResolvedValueOnce(null);
        const res = await fetch(originPullRequestsUrl(`/42/diff/files/${encodeURIComponent('src/foo.ts')}`, 'unknown'));
        expect(res.status).toBe(404);
    });

    it('returns 401 when unconfigured', async () => {
        (ProviderFactory.createPullRequestsService as ReturnType<typeof vi.fn>).mockResolvedValue(null);
        const res = await fetch(originPullRequestsUrl(`/42/diff/files/${encodeURIComponent('src/foo.ts')}`, REPO_ID));
        expect(res.status).toBe(401);
        const body = await res.json() as { error: string };
        expect(body.error).toBe('unconfigured');
    });

    it('returns 401 with no-ado-credentials when ADO az CLI fails', async () => {
        (ProviderFactory.createPullRequestsService as ReturnType<typeof vi.fn>).mockResolvedValue({ error: 'no-ado-credentials' });
        const res = await fetch(originPullRequestsUrl(`/42/diff/files/${encodeURIComponent('src/foo.ts')}`, REPO_ID));
        expect(res.status).toBe(401);
        const body = await res.json() as { error: string };
        expect(body.error).toBe('no-ado-credentials');
    });

    it('returns 500 on unexpected error', async () => {
        (mockSvc.getDiff as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('network'));
        const res = await fetch(originPullRequestsUrl(`/42/diff/files/${encodeURIComponent('src/foo.ts')}`, REPO_ID));
        expect(res.status).toBe(500);
    });

    it('decodes URL-encoded file paths', async () => {
        const diffWithSpaces = 'diff --git a/path with spaces/file.ts b/path with spaces/file.ts\n--- a/path with spaces/file.ts\n+++ b/path with spaces/file.ts\n@@ -1 +1 @@\n-old\n+new\n';
        (mockSvc.getDiff as ReturnType<typeof vi.fn>).mockResolvedValue(diffWithSpaces);
        const res = await fetch(originPullRequestsUrl(`/42/diff/files/${encodeURIComponent('path with spaces/file.ts')}`, REPO_ID));
        expect(res.status).toBe(200);
        const body = await res.json() as { diff: string };
        expect(body.diff).toContain('path with spaces/file.ts');
    });
});

// ── GET /api/origins/:originId/pull-requests/:prId/diff/files/:path?fullContext=true (AC-02) ──

describe('GET .../diff/files/:path?fullContext=true (AC-02)', () => {
    const combinedDiff = [
        'diff --git a/src/foo.ts b/src/foo.ts',
        '--- a/src/foo.ts',
        '+++ b/src/foo.ts',
        '@@ -1,3 +1,4 @@',
        ' line1',
        '+added',
    ].join('\n');

    beforeEach(() => {
        (mockSvc.getDiff as ReturnType<typeof vi.fn>).mockResolvedValue(combinedDiff);
    });

    it('without ?fullContext: returns normal diff, no fullContextUnavailable field', async () => {
        const res = await fetch(originPullRequestsUrl(`/42/diff/files/${encodeURIComponent('src/foo.ts')}`, REPO_ID));
        expect(res.status).toBe(200);
        const body = await res.json() as { diff: string; fullContextUnavailable?: boolean };
        expect(body.diff).toContain('diff --git a/src/foo.ts');
        expect(body.fullContextUnavailable).toBeUndefined();
    });

    it('with ?fullContext=true and no cached PR detail: returns hunk diff with fullContextUnavailable=true', async () => {
        // No prior GET /pull-requests/42 call, so prDetailCache is empty
        const res = await fetch(originPullRequestsUrl(`/42/diff/files/${encodeURIComponent('src/foo.ts')}?fullContext=true`, REPO_ID));
        expect(res.status).toBe(200);
        const body = await res.json() as { diff: string; fullContextUnavailable: boolean };
        expect(body.fullContextUnavailable).toBe(true);
        // Should still include the hunk diff as fallback
        expect(body.diff).toContain('diff --git a/src/foo.ts');
        expect(mockSvc.getPullRequest).toHaveBeenCalledWith(REPO_ID, '42');
    });

    it('with ?fullContext=true and cached PR detail missing SHAs: returns fullContextUnavailable=true', async () => {
        // Warm the PR detail cache (mockPr has no baseSha/headSha)
        await fetch(originPullRequestsUrl(`/42`, REPO_ID));

        const res = await fetch(originPullRequestsUrl(`/42/diff/files/${encodeURIComponent('src/foo.ts')}?fullContext=true`, REPO_ID));
        expect(res.status).toBe(200);
        const body = await res.json() as { diff: string; fullContextUnavailable: boolean };
        expect(body.fullContextUnavailable).toBe(true);
        // Fallback hunk diff still returned
        expect(body.diff).toContain('diff --git a/src/foo.ts');
    });

    it('with ?fullContext=true and cached PR detail has SHAs but git fails: returns fullContextUnavailable=true', async () => {
        // Override getPullRequest to return a PR with SHAs
        const prWithShas = { ...mockPr, headSha: 'deadbeef111', baseSha: 'cafebabe222' };
        (mockSvc.getPullRequest as ReturnType<typeof vi.fn>).mockResolvedValue(prWithShas);

        // Warm the PR detail cache with SHAs
        await fetch(originPullRequestsUrl(`/42`, REPO_ID));

        // The repo.localPath is /tmp/repo which is not a real git repo, so git diff fails
        const res = await fetch(originPullRequestsUrl(`/42/diff/files/${encodeURIComponent('src/foo.ts')}?fullContext=true`, REPO_ID));
        expect(res.status).toBe(200);
        const body = await res.json() as { diff: string; fullContextUnavailable: boolean };
        expect(body.fullContextUnavailable).toBe(true);
        expect(body.diff).toContain('diff --git a/src/foo.ts');
    });

    it('with ?fullContext=true and PR detail fetch fails: returns hunk diff fallback', async () => {
        (mockSvc.getPullRequest as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('detail unavailable'));

        const res = await fetch(originPullRequestsUrl(`/42/diff/files/${encodeURIComponent('src/foo.ts')}?fullContext=true`, REPO_ID));
        expect(res.status).toBe(200);
        const body = await res.json() as { diff: string; fullContextUnavailable: boolean; fullContextUnavailableReason?: string };
        expect(body.fullContextUnavailable).toBe(true);
        expect(body.fullContextUnavailableReason).toBe('pr-detail-unavailable');
        expect(body.diff).toContain('diff --git a/src/foo.ts');
    });

    it('with ?fullContext=true fetches a missing PR head commit and returns full context', async () => {
        const remotePath = path.join(tmpDir, 'remote.git');
        const sourcePath = path.join(tmpDir, 'source');
        const localPath = path.join(tmpDir, 'local');

        fs.mkdirSync(sourcePath, { recursive: true });
        await initGitRepo(sourcePath);
        const baseSha = await writeAndCommitFile(
            sourcePath,
            'src/foo.ts',
            ['line1', 'line2', 'line3', 'line4', 'line5', ''].join('\n'),
            'base',
        );
        await git(sourcePath, ['clone', '--bare', sourcePath, remotePath]);
        await git(tmpDir, ['clone', remotePath, localPath]);
        await git(localPath, ['rev-parse', `${baseSha}^{commit}`]);

        await git(sourcePath, ['checkout', '-b', 'feature/full-context']);
        const headSha = await writeAndCommitFile(
            sourcePath,
            'src/foo.ts',
            ['line1', 'line2 changed', 'line3', 'line4', 'line5', ''].join('\n'),
            'feature',
        );
        await git(sourcePath, ['push', remotePath, 'feature/full-context']);

        await expect(execFileAsync('git', ['rev-parse', `${headSha}^{commit}`], { cwd: localPath, encoding: 'utf-8' })).rejects.toThrow();

        mockResolveRepo.mockResolvedValueOnce({
            ...mockRepoInfo,
            localPath,
            remoteUrl: remotePath,
        });
        (mockSvc.getPullRequest as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
            ...mockPr,
            baseSha,
            headSha,
            sourceBranch: 'feature/full-context',
            targetBranch: 'main',
        });

        const localOriginId = resolveCanonicalOriginId({ workspaceId: REPO_ID, remoteUrl: remotePath });
        const res = await fetch(originPullRequestsUrl(`/42/diff/files/${encodeURIComponent('src/foo.ts')}?fullContext=true`, REPO_ID, localOriginId));
        expect(res.status).toBe(200);
        const body = await res.json() as { diff: string; fullContextUnavailable: boolean; fullContextUnavailableReason?: string };
        expect(body.fullContextUnavailable).toBe(false);
        expect(body.fullContextUnavailableReason).toBeUndefined();
        expect(body.diff).toContain('@@ -1,5 +1,5 @@');
        expect(body.diff).toContain('-line2');
        expect(body.diff).toContain('+line2 changed');
        expect(body.diff).toContain(' line5');
        expect(mockSvc.getPullRequest).toHaveBeenCalledWith(REPO_ID, '42');
        await git(localPath, ['rev-parse', `${headSha}^{commit}`]);
        expect(await git(localPath, ['branch', '--show-current'])).toBe('main');
        expect(await git(localPath, ['status', '--porcelain'])).toBe('');
    });
});

// ── PR diff cache tests (AC-01) ───────────────────────────────────────────────

describe('PR diff cache (AC-01)', () => {
    const combinedDiff = [
        'diff --git a/src/foo.ts b/src/foo.ts',
        '--- a/src/foo.ts',
        '+++ b/src/foo.ts',
        '@@ -1,3 +1,4 @@',
        ' line1',
        '+added',
        'diff --git a/src/bar.ts b/src/bar.ts',
        '--- a/src/bar.ts',
        '+++ b/src/bar.ts',
        '@@ -1 +1 @@',
        '-old',
        '+new',
    ].join('\n');

    beforeEach(() => {
        (mockSvc.getDiff as ReturnType<typeof vi.fn>).mockResolvedValue(combinedDiff);
    });

    it('caches the combined diff so /diff endpoint hits once on second request', async () => {
        const r1 = await fetch(originPullRequestsUrl(`/42/diff`, REPO_ID));
        expect(r1.status).toBe(200);

        const r2 = await fetch(originPullRequestsUrl(`/42/diff`, REPO_ID));
        expect(r2.status).toBe(200);
        expect(mockSvc.getDiff).toHaveBeenCalledTimes(1);
    });

    it('caches the combined diff so /diff/files endpoint hits once on second request', async () => {
        const r1 = await fetch(originPullRequestsUrl(`/42/diff/files/${encodeURIComponent('src/foo.ts')}`, REPO_ID));
        expect(r1.status).toBe(200);

        const r2 = await fetch(originPullRequestsUrl(`/42/diff/files/${encodeURIComponent('src/bar.ts')}`, REPO_ID));
        expect(r2.status).toBe(200);
        // Both per-file requests share one upstream fetch
        expect(mockSvc.getDiff).toHaveBeenCalledTimes(1);
    });

    it('full /diff and /diff/files requests share the same cached combined diff', async () => {
        await fetch(originPullRequestsUrl(`/42/diff`, REPO_ID));
        await fetch(originPullRequestsUrl(`/42/diff/files/${encodeURIComponent('src/foo.ts')}`, REPO_ID));
        // Second call should reuse the cache set by the first
        expect(mockSvc.getDiff).toHaveBeenCalledTimes(1);
    });

    it('keeps the provider combined diff cache without a TTL until invalidated', async () => {
        (mockSvc.getPullRequest as ReturnType<typeof vi.fn>).mockResolvedValue({ ...mockPr, headSha: 'stable-head' });
        (mockSvc.getDiff as ReturnType<typeof vi.fn>).mockResolvedValue(combinedDiff);

        await fetch(originPullRequestsUrl(`/42/diff`, REPO_ID));
        expect(mockSvc.getDiff).toHaveBeenCalledTimes(1);

        const realNow = Date.now;
        Date.now = () => realNow() + 24 * 60 * 60 * 1000;
        try {
            const res = await fetch(originPullRequestsUrl(`/42/diff/files/${encodeURIComponent('src/foo.ts')}`, REPO_ID));
            expect(res.status).toBe(200);
            const body = await res.json() as { diff: string };
            expect(body.diff).toContain('diff --git a/src/foo.ts b/src/foo.ts');
            expect(mockSvc.getDiff).toHaveBeenCalledTimes(1);
        } finally {
            Date.now = realNow;
        }
    });

    it('keys the combined diff by resolved PR head SHA so changed heads refetch', async () => {
        const oldDiff = 'diff --git a/src/old.ts b/src/old.ts\n';
        const newDiff = 'diff --git a/src/new.ts b/src/new.ts\n';
        (mockSvc.getPullRequest as ReturnType<typeof vi.fn>)
            .mockResolvedValueOnce({ ...mockPr, headSha: 'old-head' })
            .mockResolvedValueOnce({ ...mockPr, headSha: 'new-head' });
        (mockSvc.getDiff as ReturnType<typeof vi.fn>)
            .mockResolvedValueOnce(oldDiff)
            .mockResolvedValueOnce(newDiff);

        const first = await fetch(originPullRequestsUrl(`/42/diff`, REPO_ID));
        expect(await first.text()).toContain('src/old.ts');

        const second = await fetch(originPullRequestsUrl(`/42/diff`, REPO_ID));
        expect(await second.text()).toContain('src/new.ts');
        expect(mockSvc.getDiff).toHaveBeenCalledTimes(2);
    });

    it('falls back to the origin/PR combined-diff key when PR head SHA is unavailable', async () => {
        (mockSvc.getPullRequest as ReturnType<typeof vi.fn>).mockResolvedValue({ ...mockPr, headSha: undefined });

        await fetch(originPullRequestsUrl(`/42/diff`, REPO_ID));
        await fetch(originPullRequestsUrl(`/42/diff/files/${encodeURIComponent('src/foo.ts')}`, REPO_ID));

        expect(mockSvc.getDiff).toHaveBeenCalledTimes(1);
    });

    it('force-refreshing PR detail clears the diff cache and the next diff request refetches', async () => {
        // Warm the diff cache via /diff
        await fetch(originPullRequestsUrl(`/42/diff`, REPO_ID));
        expect(mockSvc.getDiff).toHaveBeenCalledTimes(1);

        // Force-refresh PR detail
        await fetch(originPullRequestsUrl(`/42?force=true`, REPO_ID));

        // Next diff request must refetch from provider
        await fetch(originPullRequestsUrl(`/42/diff`, REPO_ID));
        expect(mockSvc.getDiff).toHaveBeenCalledTimes(2);
    });

    it('force-refreshing PR detail clears head-keyed combined diffs for only that PR', async () => {
        const firstDiff = 'diff --git a/src/first.ts b/src/first.ts\n';
        const refreshedDiff = 'diff --git a/src/refreshed.ts b/src/refreshed.ts\n';
        (mockSvc.getPullRequest as ReturnType<typeof vi.fn>).mockResolvedValue({ ...mockPr, headSha: 'same-head' });
        (mockSvc.getDiff as ReturnType<typeof vi.fn>)
            .mockResolvedValueOnce(firstDiff)
            .mockResolvedValueOnce(refreshedDiff);

        const first = await fetch(originPullRequestsUrl(`/42/diff`, REPO_ID));
        expect(await first.text()).toContain('src/first.ts');

        await fetch(originPullRequestsUrl(`/42?force=true`, REPO_ID));

        const refreshed = await fetch(originPullRequestsUrl(`/42/diff`, REPO_ID));
        expect(await refreshed.text()).toContain('src/refreshed.ts');
        expect(mockSvc.getDiff).toHaveBeenCalledTimes(2);
    });

    it('uses separate cache entries per PR so switching PRs does not cross-pollute', async () => {
        const pr2Diff = 'diff --git a/other.ts b/other.ts\n';
        (mockSvc.getDiff as ReturnType<typeof vi.fn>)
            .mockResolvedValueOnce(combinedDiff)  // PR 42
            .mockResolvedValueOnce(pr2Diff);        // PR 99

        await fetch(originPullRequestsUrl(`/42/diff`, REPO_ID));
        const r99 = await fetch(originPullRequestsUrl(`/99/diff`, REPO_ID));
        const text99 = await r99.text();
        expect(text99).toContain('other.ts');
        expect(text99).not.toContain('src/foo.ts');
        expect(mockSvc.getDiff).toHaveBeenCalledTimes(2);
    });

    it('force-refreshing one PR does not invalidate another PR diff cache', async () => {
        const pr2Diff = 'diff --git a/other.ts b/other.ts\n';
        (mockSvc.getDiff as ReturnType<typeof vi.fn>)
            .mockResolvedValueOnce(combinedDiff) // PR 42 initial
            .mockResolvedValueOnce(pr2Diff);     // PR 99

        await fetch(originPullRequestsUrl(`/42/diff`, REPO_ID));
        await fetch(originPullRequestsUrl(`/99/diff`, REPO_ID));
        expect(mockSvc.getDiff).toHaveBeenCalledTimes(2);

        // Force-refresh PR 42 detail only
        await fetch(originPullRequestsUrl(`/42?force=true`, REPO_ID));

        // PR 99 diff still cached
        await fetch(originPullRequestsUrl(`/99/diff`, REPO_ID));
        expect(mockSvc.getDiff).toHaveBeenCalledTimes(2);
    });

    it('shares combined-diff cache entries across same-origin repo ids for the same PR and head', async () => {
        const cloneRepoId = 'repo-clone-same-origin';
        const repoDiff = 'diff --git a/src/repo.ts b/src/repo.ts\n';
        mockResolveRepo.mockImplementation(async (repoId: string) => makeMockRepoInfo(repoId, REMOTE_URL));
        (mockSvc.getPullRequest as ReturnType<typeof vi.fn>).mockImplementation(async (repoId: string) => ({
            ...mockPr,
            repositoryId: repoId,
            headSha: 'shared-head',
        }));
        (mockSvc.getDiff as ReturnType<typeof vi.fn>).mockResolvedValue(repoDiff);

        const repoRes = await fetch(originPullRequestsUrl(`/42/diff`, REPO_ID));
        expect(await repoRes.text()).toContain('src/repo.ts');

        const cloneRepoRes = await fetch(originPullRequestsUrl(`/42/diff`, cloneRepoId));
        expect(await cloneRepoRes.text()).toContain('src/repo.ts');

        await fetch(originPullRequestsUrl(`/42/diff`, REPO_ID));
        await fetch(originPullRequestsUrl(`/42/diff`, cloneRepoId));
        expect(mockSvc.getDiff).toHaveBeenCalledTimes(1);
    });

    it('keeps combined-diff cache entries isolated for distinct origins', async () => {
        const otherRepoId = 'repo-other-origin';
        const repoDiff = 'diff --git a/src/repo.ts b/src/repo.ts\n';
        const otherRepoDiff = 'diff --git a/src/other-repo.ts b/src/other-repo.ts\n';
        mockResolveRepo.mockImplementation(async (repoId: string) => makeMockRepoInfo(
            repoId,
            repoId === otherRepoId ? 'https://github.com/org/other.git' : REMOTE_URL,
        ));
        (mockSvc.getPullRequest as ReturnType<typeof vi.fn>).mockImplementation(async (repoId: string) => ({
            ...mockPr,
            repositoryId: repoId,
            headSha: 'shared-head',
        }));
        (mockSvc.getDiff as ReturnType<typeof vi.fn>).mockImplementation(async (repoId: string) =>
            repoId === otherRepoId ? otherRepoDiff : repoDiff,
        );

        const repoRes = await fetch(originPullRequestsUrl(`/42/diff`, REPO_ID));
        expect(await repoRes.text()).toContain('src/repo.ts');

        const otherRepoRes = await fetch(originPullRequestsUrl(`/42/diff`, otherRepoId, 'gh_org_other'));
        expect(await otherRepoRes.text()).toContain('src/other-repo.ts');

        await fetch(originPullRequestsUrl(`/42/diff`, REPO_ID));
        await fetch(originPullRequestsUrl(`/42/diff`, otherRepoId, 'gh_org_other'));
        expect(mockSvc.getDiff).toHaveBeenCalledTimes(2);
    });
});

// ── GET /api/origins/:originId/pull-requests/:prId/checks ─────────────────────────────

describe('GET /api/origins/:originId/pull-requests/:prId/checks', () => {
    it('returns checks array on success', async () => {
        const res = await fetch(originPullRequestsUrl(`/42/checks`, REPO_ID));
        expect(res.status).toBe(200);
        const body = await res.json() as { checks: Array<{ id: string; name: string; status: string; source: string }> };
        expect(Array.isArray(body.checks)).toBe(true);
        expect(body.checks).toHaveLength(1);
        expect(body.checks[0].id).toBe('check-1');
        expect(body.checks[0].name).toBe('build');
        expect(body.checks[0].status).toBe('success');
        expect(body.checks[0].source).toBe('check');
    });

    it('returns empty array when getChecks is not implemented', async () => {
        const svcWithoutChecks = { ...mockSvc };
        delete (svcWithoutChecks as any).getChecks;
        (ProviderFactory.createPullRequestsService as ReturnType<typeof vi.fn>).mockResolvedValue(svcWithoutChecks);

        const res = await fetch(originPullRequestsUrl(`/42/checks`, REPO_ID));
        expect(res.status).toBe(200);
        const body = await res.json() as { checks: unknown[] };
        expect(body.checks).toEqual([]);
    });

    it('returns 404 when repo not found', async () => {
        mockResolveRepo.mockResolvedValueOnce(null);
        const res = await fetch(originPullRequestsUrl(`/42/checks`, 'unknown'));
        expect(res.status).toBe(404);
    });

    it('returns 401 when unconfigured', async () => {
        (ProviderFactory.createPullRequestsService as ReturnType<typeof vi.fn>).mockResolvedValue(null);
        const res = await fetch(originPullRequestsUrl(`/42/checks`, REPO_ID));
        expect(res.status).toBe(401);
        const body = await res.json() as { error: string };
        expect(body.error).toBe('unconfigured');
    });

    it('returns 401 with no-ado-credentials when ADO az CLI fails', async () => {
        (ProviderFactory.createPullRequestsService as ReturnType<typeof vi.fn>).mockResolvedValue({ error: 'no-ado-credentials' });
        const res = await fetch(originPullRequestsUrl(`/42/checks`, REPO_ID));
        expect(res.status).toBe(401);
        const body = await res.json() as { error: string };
        expect(body.error).toBe('no-ado-credentials');
    });

    it('returns 500 on unexpected error', async () => {
        (mockSvc.getChecks as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('network'));
        const res = await fetch(originPullRequestsUrl(`/42/checks`, REPO_ID));
        expect(res.status).toBe(500);
    });
});

// ── threads cache tests ───────────────────────────────────────────────────────

describe('threads cache (GET /api/origins/:originId/pull-requests/:prId/threads)', () => {
    it('cache miss calls provider', async () => {
        const res = await fetch(originPullRequestsUrl(`/42/threads`, REPO_ID));
        expect(res.status).toBe(200);
        expect(mockSvc.getThreads).toHaveBeenCalledTimes(1);
    });

    it('cache hit does not call provider', async () => {
        await fetch(originPullRequestsUrl(`/42/threads`, REPO_ID));
        expect(mockSvc.getThreads).toHaveBeenCalledTimes(1);

        const res2 = await fetch(originPullRequestsUrl(`/42/threads`, REPO_ID));
        expect(res2.status).toBe(200);
        const body = await res2.json() as { threads: unknown[] };
        expect(body.threads).toHaveLength(1);
        expect(mockSvc.getThreads).toHaveBeenCalledTimes(1);
    });

    it('shares thread cache entries across same-origin repo ids', async () => {
        const cloneRepoId = 'repo-clone-same-origin';
        mockResolveRepo.mockImplementation(async (repoId: string) => makeMockRepoInfo(repoId, REMOTE_URL));
        (mockSvc.getThreads as ReturnType<typeof vi.fn>).mockImplementation(async (repoId: string) => [
            { ...mockThread, id: repoId === cloneRepoId ? 2 : 1 },
        ]);

        await fetch(originPullRequestsUrl(`/42/threads`, REPO_ID));
        const res = await fetch(originPullRequestsUrl(`/42/threads`, cloneRepoId));
        const body = await res.json() as { threads: Array<{ id: number }> };

        expect(res.status).toBe(200);
        expect(body.threads[0].id).toBe(1);
        expect(mockSvc.getThreads).toHaveBeenCalledTimes(1);
    });

    it('expired TTL refetches from provider', async () => {
        vi.useFakeTimers();
        try {
            await fetch(originPullRequestsUrl(`/42/threads`, REPO_ID));
            expect(mockSvc.getThreads).toHaveBeenCalledTimes(1);

            vi.advanceTimersByTime(11 * 60 * 1000); // 11 minutes

            await fetch(originPullRequestsUrl(`/42/threads`, REPO_ID));
            expect(mockSvc.getThreads).toHaveBeenCalledTimes(2);
        } finally {
            vi.useRealTimers();
        }
    });

    it('force=true on PR detail evicts threads cache', async () => {
        await fetch(originPullRequestsUrl(`/42/threads`, REPO_ID));
        expect(mockSvc.getThreads).toHaveBeenCalledTimes(1);

        // Force-refresh the detail endpoint
        await fetch(originPullRequestsUrl(`/42?force=true`, REPO_ID));

        // Next threads call must hit upstream again
        await fetch(originPullRequestsUrl(`/42/threads`, REPO_ID));
        expect(mockSvc.getThreads).toHaveBeenCalledTimes(2);
    });
});

// ── commits cache tests ───────────────────────────────────────────────────────

describe('commits cache (GET /api/origins/:originId/pull-requests/:prId/commits)', () => {
    it('cache miss calls provider', async () => {
        const res = await fetch(originPullRequestsUrl(`/42/commits`, REPO_ID));
        expect(res.status).toBe(200);
        expect(mockSvc.getCommits).toHaveBeenCalledTimes(1);
    });

    it('cache hit does not call provider', async () => {
        await fetch(originPullRequestsUrl(`/42/commits`, REPO_ID));
        expect(mockSvc.getCommits).toHaveBeenCalledTimes(1);

        const res2 = await fetch(originPullRequestsUrl(`/42/commits`, REPO_ID));
        expect(res2.status).toBe(200);
        const body = await res2.json() as { commits: unknown[] };
        expect(body.commits).toHaveLength(1);
        expect(mockSvc.getCommits).toHaveBeenCalledTimes(1);
    });

    it('expired TTL refetches from provider', async () => {
        vi.useFakeTimers();
        try {
            await fetch(originPullRequestsUrl(`/42/commits`, REPO_ID));
            expect(mockSvc.getCommits).toHaveBeenCalledTimes(1);

            vi.advanceTimersByTime(31 * 60 * 1000); // 31 minutes

            await fetch(originPullRequestsUrl(`/42/commits`, REPO_ID));
            expect(mockSvc.getCommits).toHaveBeenCalledTimes(2);
        } finally {
            vi.useRealTimers();
        }
    });

    it('force=true on PR detail evicts commits cache', async () => {
        await fetch(originPullRequestsUrl(`/42/commits`, REPO_ID));
        expect(mockSvc.getCommits).toHaveBeenCalledTimes(1);

        await fetch(originPullRequestsUrl(`/42?force=true`, REPO_ID));

        await fetch(originPullRequestsUrl(`/42/commits`, REPO_ID));
        expect(mockSvc.getCommits).toHaveBeenCalledTimes(2);
    });
});

// ── reviewers cache tests ─────────────────────────────────────────────────────

describe('reviewers cache (GET /api/origins/:originId/pull-requests/:prId/reviewers)', () => {
    it('cache miss calls provider', async () => {
        const res = await fetch(originPullRequestsUrl(`/42/reviewers`, REPO_ID));
        expect(res.status).toBe(200);
        expect(mockSvc.getReviewers).toHaveBeenCalledTimes(1);
    });

    it('cache hit does not call provider', async () => {
        await fetch(originPullRequestsUrl(`/42/reviewers`, REPO_ID));
        expect(mockSvc.getReviewers).toHaveBeenCalledTimes(1);

        const res2 = await fetch(originPullRequestsUrl(`/42/reviewers`, REPO_ID));
        expect(res2.status).toBe(200);
        const body = await res2.json() as { reviewers: unknown[] };
        expect(body.reviewers).toHaveLength(1);
        expect(mockSvc.getReviewers).toHaveBeenCalledTimes(1);
    });

    it('expired TTL refetches from provider', async () => {
        vi.useFakeTimers();
        try {
            await fetch(originPullRequestsUrl(`/42/reviewers`, REPO_ID));
            expect(mockSvc.getReviewers).toHaveBeenCalledTimes(1);

            vi.advanceTimersByTime(31 * 60 * 1000); // 31 minutes

            await fetch(originPullRequestsUrl(`/42/reviewers`, REPO_ID));
            expect(mockSvc.getReviewers).toHaveBeenCalledTimes(2);
        } finally {
            vi.useRealTimers();
        }
    });

    it('force=true on PR detail evicts reviewers cache', async () => {
        await fetch(originPullRequestsUrl(`/42/reviewers`, REPO_ID));
        expect(mockSvc.getReviewers).toHaveBeenCalledTimes(1);

        await fetch(originPullRequestsUrl(`/42?force=true`, REPO_ID));

        await fetch(originPullRequestsUrl(`/42/reviewers`, REPO_ID));
        expect(mockSvc.getReviewers).toHaveBeenCalledTimes(2);
    });

    it('force=true on the reviewers endpoint itself bypasses the cache', async () => {
        await fetch(originPullRequestsUrl(`/42/reviewers`, REPO_ID));
        expect(mockSvc.getReviewers).toHaveBeenCalledTimes(1);

        await fetch(originPullRequestsUrl(`/42/reviewers`, REPO_ID));
        expect(mockSvc.getReviewers).toHaveBeenCalledTimes(1);

        await fetch(originPullRequestsUrl(`/42/reviewers?force=true`, REPO_ID));
        expect(mockSvc.getReviewers).toHaveBeenCalledTimes(2);

        await fetch(originPullRequestsUrl(`/42/reviewers`, REPO_ID));
        expect(mockSvc.getReviewers).toHaveBeenCalledTimes(2);
    });
});

// ── checks cache tests ────────────────────────────────────────────────────────

describe('checks cache (GET /api/origins/:originId/pull-requests/:prId/checks)', () => {
    it('cache miss calls provider', async () => {
        const res = await fetch(originPullRequestsUrl(`/42/checks`, REPO_ID));
        expect(res.status).toBe(200);
        expect(mockSvc.getChecks).toHaveBeenCalledTimes(1);
    });

    it('cache hit does not call provider', async () => {
        await fetch(originPullRequestsUrl(`/42/checks`, REPO_ID));
        expect(mockSvc.getChecks).toHaveBeenCalledTimes(1);

        const res2 = await fetch(originPullRequestsUrl(`/42/checks`, REPO_ID));
        expect(res2.status).toBe(200);
        const body = await res2.json() as { checks: unknown[] };
        expect(body.checks).toHaveLength(1);
        expect(mockSvc.getChecks).toHaveBeenCalledTimes(1);
    });

    it('expired TTL refetches from provider', async () => {
        vi.useFakeTimers();
        try {
            await fetch(originPullRequestsUrl(`/42/checks`, REPO_ID));
            expect(mockSvc.getChecks).toHaveBeenCalledTimes(1);

            vi.advanceTimersByTime(11 * 60 * 1000); // 11 minutes

            await fetch(originPullRequestsUrl(`/42/checks`, REPO_ID));
            expect(mockSvc.getChecks).toHaveBeenCalledTimes(2);
        } finally {
            vi.useRealTimers();
        }
    });

    it('force=true on PR detail evicts checks cache', async () => {
        await fetch(originPullRequestsUrl(`/42/checks`, REPO_ID));
        expect(mockSvc.getChecks).toHaveBeenCalledTimes(1);

        await fetch(originPullRequestsUrl(`/42?force=true`, REPO_ID));

        await fetch(originPullRequestsUrl(`/42/checks`, REPO_ID));
        expect(mockSvc.getChecks).toHaveBeenCalledTimes(2);
    });

    it('force=true on the checks endpoint itself bypasses the cache (AC-05)', async () => {
        await fetch(originPullRequestsUrl(`/42/checks`, REPO_ID));
        expect(mockSvc.getChecks).toHaveBeenCalledTimes(1);

        // A cached call does not re-hit the provider...
        await fetch(originPullRequestsUrl(`/42/checks`, REPO_ID));
        expect(mockSvc.getChecks).toHaveBeenCalledTimes(1);

        // ...but a forced refresh does, then repopulates the cache.
        await fetch(originPullRequestsUrl(`/42/checks?force=true`, REPO_ID));
        expect(mockSvc.getChecks).toHaveBeenCalledTimes(2);

        await fetch(originPullRequestsUrl(`/42/checks`, REPO_ID));
        expect(mockSvc.getChecks).toHaveBeenCalledTimes(2);
    });
});

// ── PR detail cache tests ─────────────────────────────────────────────────────

describe('PR detail cache (GET /api/origins/:originId/pull-requests/:prId)', () => {
    it('serves from cache on second call without hitting upstream', async () => {
        await fetch(originPullRequestsUrl(`/42`, REPO_ID));
        expect(mockSvc.getPullRequest).toHaveBeenCalledTimes(1);

        const res2 = await fetch(originPullRequestsUrl(`/42`, REPO_ID));
        expect(res2.status).toBe(200);
        const body = await res2.json() as { number: number };
        expect(body.number).toBe(42);
        // Still only one upstream call
        expect(mockSvc.getPullRequest).toHaveBeenCalledTimes(1);
    });

    it('shares detail cache entries across same-origin repo ids', async () => {
        const cloneRepoId = 'repo-clone-same-origin';
        mockResolveRepo.mockImplementation(async (repoId: string) => makeMockRepoInfo(repoId, REMOTE_URL));
        (mockSvc.getPullRequest as ReturnType<typeof vi.fn>).mockImplementation(async (repoId: string) => ({
            ...mockPr,
            repositoryId: repoId,
            title: `detail ${repoId}`,
        }));

        await fetch(originPullRequestsUrl(`/42`, REPO_ID));
        const res = await fetch(originPullRequestsUrl(`/42`, cloneRepoId));
        const body = await res.json() as { title: string };

        expect(res.status).toBe(200);
        expect(body.title).toBe(`detail ${REPO_ID}`);
        expect(mockSvc.getPullRequest).toHaveBeenCalledTimes(1);
    });

    it('keeps detail cache entries isolated for distinct origins', async () => {
        const otherRepoId = 'repo-other-origin';
        mockResolveRepo.mockImplementation(async (repoId: string) => makeMockRepoInfo(
            repoId,
            repoId === otherRepoId ? 'https://github.com/org/other.git' : REMOTE_URL,
        ));
        (mockSvc.getPullRequest as ReturnType<typeof vi.fn>).mockImplementation(async (repoId: string) => ({
            ...mockPr,
            repositoryId: repoId,
            title: `detail ${repoId}`,
        }));

        await fetch(originPullRequestsUrl(`/42`, REPO_ID));
        const res = await fetch(originPullRequestsUrl(`/42`, otherRepoId, 'gh_org_other'));
        const body = await res.json() as { title: string };

        expect(res.status).toBe(200);
        expect(body.title).toBe(`detail ${otherRepoId}`);
        expect(mockSvc.getPullRequest).toHaveBeenCalledTimes(2);
    });

    it('force=true bypasses cache and repopulates', async () => {
        // Warm the cache
        await fetch(originPullRequestsUrl(`/42`, REPO_ID));
        expect(mockSvc.getPullRequest).toHaveBeenCalledTimes(1);

        // Force refresh
        const res = await fetch(originPullRequestsUrl(`/42?force=true`, REPO_ID));
        expect(res.status).toBe(200);
        expect(mockSvc.getPullRequest).toHaveBeenCalledTimes(2);
    });

    it('re-fetches after TTL expiry', async () => {
        // Warm the cache
        await fetch(originPullRequestsUrl(`/42`, REPO_ID));
        expect(mockSvc.getPullRequest).toHaveBeenCalledTimes(1);

        // Expire the cache by manipulating Date.now
        const realNow = Date.now;
        Date.now = () => realNow() + 11 * 60 * 1000; // 11 minutes into the future
        try {
            const res = await fetch(originPullRequestsUrl(`/42`, REPO_ID));
            expect(res.status).toBe(200);
            expect(mockSvc.getPullRequest).toHaveBeenCalledTimes(2);
        } finally {
            Date.now = realNow;
        }
    });

    it('uses separate cache entries per origin and PR', async () => {
        // Fetch PR 42 for the resolved origin
        await fetch(originPullRequestsUrl(`/42`, REPO_ID));
        // Fetch PR 99 for the same resolved origin
        await fetch(originPullRequestsUrl(`/99`, REPO_ID));
        expect(mockSvc.getPullRequest).toHaveBeenCalledTimes(2);

        // Both are now cached — no additional calls
        await fetch(originPullRequestsUrl(`/42`, REPO_ID));
        await fetch(originPullRequestsUrl(`/99`, REPO_ID));
        expect(mockSvc.getPullRequest).toHaveBeenCalledTimes(2);
    });

    it('does not cache 404 errors', async () => {
        (mockSvc.getPullRequest as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('PR 999 not found'));
        const res1 = await fetch(originPullRequestsUrl(`/999`, REPO_ID));
        expect(res1.status).toBe(404);

        // Retry should hit upstream again (not serve cached error)
        (mockSvc.getPullRequest as ReturnType<typeof vi.fn>).mockResolvedValueOnce(mockPr);
        const res2 = await fetch(originPullRequestsUrl(`/999`, REPO_ID));
        expect(res2.status).toBe(200);
        expect(mockSvc.getPullRequest).toHaveBeenCalledTimes(2);
    });

    it('does not cache auth errors', async () => {
        (mockSvc.getPullRequest as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('401 unauthorized'));
        const res1 = await fetch(originPullRequestsUrl(`/42`, REPO_ID));
        expect(res1.status).toBe(401);

        // Retry should hit upstream again
        (mockSvc.getPullRequest as ReturnType<typeof vi.fn>).mockResolvedValueOnce(mockPr);
        const res2 = await fetch(originPullRequestsUrl(`/42`, REPO_ID));
        expect(res2.status).toBe(200);
        expect(mockSvc.getPullRequest).toHaveBeenCalledTimes(2);
    });

    it('clearPrDetailCache() clears all detail entries', async () => {
        // Warm the cache
        await fetch(originPullRequestsUrl(`/42`, REPO_ID));
        expect(mockSvc.getPullRequest).toHaveBeenCalledTimes(1);

        // Clear and verify re-fetch
        clearPrDetailCache();
        await fetch(originPullRequestsUrl(`/42`, REPO_ID));
        expect(mockSvc.getPullRequest).toHaveBeenCalledTimes(2);
    });

    it('clearPrDetailCache() also clears threads/commits/reviewers/checks caches', async () => {
        // Warm all sub-endpoint caches
        await fetch(originPullRequestsUrl(`/42/threads`, REPO_ID));
        await fetch(originPullRequestsUrl(`/42/commits`, REPO_ID));
        await fetch(originPullRequestsUrl(`/42/reviewers`, REPO_ID));
        await fetch(originPullRequestsUrl(`/42/checks`, REPO_ID));
        expect(mockSvc.getThreads).toHaveBeenCalledTimes(1);
        expect(mockSvc.getCommits).toHaveBeenCalledTimes(1);
        expect(mockSvc.getReviewers).toHaveBeenCalledTimes(1);
        expect(mockSvc.getChecks).toHaveBeenCalledTimes(1);

        clearPrDetailCache();

        // All sub-endpoint caches must be evicted
        await fetch(originPullRequestsUrl(`/42/threads`, REPO_ID));
        await fetch(originPullRequestsUrl(`/42/commits`, REPO_ID));
        await fetch(originPullRequestsUrl(`/42/reviewers`, REPO_ID));
        await fetch(originPullRequestsUrl(`/42/checks`, REPO_ID));
        expect(mockSvc.getThreads).toHaveBeenCalledTimes(2);
        expect(mockSvc.getCommits).toHaveBeenCalledTimes(2);
        expect(mockSvc.getReviewers).toHaveBeenCalledTimes(2);
        expect(mockSvc.getChecks).toHaveBeenCalledTimes(2);
    });
});

// ── GET /api/origins/:originId/pull-requests/review-history ──────────────────────────

describe('GET /api/origins/:originId/pull-requests/review-history', () => {
    it('returns empty reviews when no cache exists', async () => {
        const res = await fetch(originPullRequestsUrl(`/review-history`, REPO_ID));
        expect(res.status).toBe(200);
        const body = await res.json() as { reviews: unknown[]; fetchedAt: string | null };
        expect(body.reviews).toEqual([]);
        expect(body.fetchedAt).toBeNull();
    });

    it('returns cached review history from legacy disk cache and migrates it to origin storage', async () => {
        // Write a legacy workspace cache file
        const repoDir = path.join(dataDir, 'repos', REPO_ID);
        fs.mkdirSync(repoDir, { recursive: true });
        const cache = {
            fetchedAt: '2024-06-01T12:00:00.000Z',
            reviews: [{ number: 1, title: 'Test PR', author: { id: 'u1', displayName: 'Alice' }, filesChanged: [], labels: [], reviewedAt: '2024-06-01T10:00:00.000Z', targetBranch: 'main', url: 'https://example.com/pr/1' }],
        };
        fs.writeFileSync(path.join(repoDir, 'pr-review-history.json'), JSON.stringify(cache), 'utf-8');

        const res = await fetch(originPullRequestsUrl(`/review-history`, REPO_ID));
        expect(res.status).toBe(200);
        const body = await res.json() as { reviews: unknown[]; fetchedAt: string };
        expect(body.reviews).toHaveLength(1);
        expect(body.fetchedAt).toBe('2024-06-01T12:00:00.000Z');
        const originFile = path.join(dataDir, 'repos', ORIGIN_ID, 'pr-review-history.json');
        expect(fs.existsSync(originFile)).toBe(true);
    });

    it('serves review history from the shared origin for a same-remote clone', async () => {
        const originDir = path.join(dataDir, 'repos', ORIGIN_ID);
        fs.mkdirSync(originDir, { recursive: true });
        fs.writeFileSync(path.join(originDir, 'pr-review-history.json'), JSON.stringify({
            fetchedAt: '2024-06-02T12:00:00.000Z',
            reviews: [{ number: 2, title: 'Clone PR', author: { id: 'u2', displayName: 'Bob' }, filesChanged: [], labels: [], reviewedAt: '2024-06-02T10:00:00.000Z', targetBranch: 'main', url: 'https://example.com/pr/2' }],
        }), 'utf-8');

        const cloneRepoId = 'repo-clone';
        mockResolveRepo.mockResolvedValueOnce(makeMockRepoInfo(cloneRepoId));
        const res = await fetch(originPullRequestsUrl(`/review-history?workspaceId=${cloneRepoId}`, cloneRepoId));

        expect(res.status).toBe(200);
        const body = await res.json() as { reviews: Array<{ number: number }>; fetchedAt: string };
        expect(body.fetchedAt).toBe('2024-06-02T12:00:00.000Z');
        expect(body.reviews[0].number).toBe(2);
    });

    it('serves review history directly from the canonical origin route', async () => {
        const originDir = path.join(dataDir, 'repos', ORIGIN_ID);
        fs.mkdirSync(originDir, { recursive: true });
        fs.writeFileSync(path.join(originDir, 'pr-review-history.json'), JSON.stringify({
            fetchedAt: '2024-06-03T12:00:00.000Z',
            reviews: [{ number: 3, title: 'Origin PR', author: { id: 'u3', displayName: 'Cara' }, filesChanged: [], labels: [], reviewedAt: '2024-06-03T10:00:00.000Z', targetBranch: 'main', url: 'https://example.com/pr/3' }],
        }), 'utf-8');

        const res = await fetch(`${baseUrl}/api/origins/${ORIGIN_ID}/pull-requests/review-history?workspaceId=${REPO_ID}&repoId=${REPO_ID}`);

        expect(res.status).toBe(200);
        const body = await res.json() as { reviews: Array<{ number: number }>; fetchedAt: string };
        expect(body.fetchedAt).toBe('2024-06-03T12:00:00.000Z');
        expect(body.reviews[0].number).toBe(3);
    });

    it('returns empty review history even when optional legacy repo metadata cannot resolve', async () => {
        mockResolveRepo.mockResolvedValueOnce(null);
        const res = await fetch(originPullRequestsUrl(`/review-history`, 'unknown'));
        expect(res.status).toBe(200);
        const body = await res.json() as { reviews: unknown[]; fetchedAt: string | null };
        expect(body).toEqual({ reviews: [], fetchedAt: null });
    });
});

// ── POST /api/origins/:originId/pull-requests/review-history/refresh ─────────────────

describe('POST /api/origins/:originId/pull-requests/review-history/refresh', () => {
    it('fetches review history and caches to disk', async () => {
        const mockReviews = [
            { number: 10, title: 'PR 10', author: { id: 'u1', displayName: 'Alice' }, filesChanged: ['a.ts'], labels: [], reviewedAt: new Date('2024-01-01'), targetBranch: 'main', url: 'https://example.com/pr/10' },
        ];
        mockSvc.getReviewedPullRequests = vi.fn().mockResolvedValue(mockReviews);

        const res = await fetch(originPullRequestsUrl(`/review-history/refresh`, REPO_ID), { method: 'POST' });
        expect(res.status).toBe(200);
        const body = await res.json() as { reviews: unknown[]; fetchedAt: string };
        expect(body.reviews).toHaveLength(1);
        expect(body.fetchedAt).toBeTruthy();

        // Verify written to origin storage
        const cached = fs.readFileSync(path.join(dataDir, 'repos', ORIGIN_ID, 'pr-review-history.json'), 'utf-8');
        expect(JSON.parse(cached).reviews).toHaveLength(1);
    });

    it('refreshes review history through the canonical origin route using a concrete workspace', async () => {
        const mockReviews = [
            { number: 11, title: 'PR 11', author: { id: 'u1', displayName: 'Alice' }, filesChanged: ['b.ts'], labels: [], reviewedAt: new Date('2024-01-02'), targetBranch: 'main', url: 'https://example.com/pr/11' },
        ];
        mockSvc.getReviewedPullRequests = vi.fn().mockResolvedValue(mockReviews);

        const res = await fetch(`${baseUrl}/api/origins/${ORIGIN_ID}/pull-requests/review-history/refresh?workspaceId=${REPO_ID}&repoId=${REPO_ID}`, { method: 'POST' });

        expect(res.status).toBe(200);
        const body = await res.json() as { reviews: Array<{ number: number }>; fetchedAt: string };
        expect(body.reviews[0].number).toBe(11);
        expect(body.fetchedAt).toBeTruthy();

        const cached = fs.readFileSync(path.join(dataDir, 'repos', ORIGIN_ID, 'pr-review-history.json'), 'utf-8');
        expect(JSON.parse(cached).reviews[0].number).toBe(11);
    });

    it('returns 501 when provider does not support review history', async () => {
        // Ensure getReviewedPullRequests is NOT present
        delete (mockSvc as any).getReviewedPullRequests;

        const res = await fetch(originPullRequestsUrl(`/review-history/refresh`, REPO_ID), { method: 'POST' });
        expect(res.status).toBe(501);
    });

    // ── GET /api/origins/:originId/pull-requests/suggestions ─────────────────────────────

    describe('GET /api/origins/:originId/pull-requests/suggestions', () => {
        it('returns empty suggestions when no cache exists', async () => {
            const res = await fetch(originPullRequestsUrl(`/suggestions`, REPO_ID));

            expect(res.status).toBe(200);
            const body = await res.json() as { suggestions: unknown[]; rankedAt: string | null };
            expect(body.suggestions).toEqual([]);
            expect(body.rankedAt).toBeNull();
        });

        it('returns cached suggestions from legacy disk cache and migrates them to origin storage', async () => {
            const repoDir = path.join(dataDir, 'repos', REPO_ID);
            fs.mkdirSync(repoDir, { recursive: true });
            const cache = {
                rankedAt: '2024-06-01T14:00:00.000Z',
                suggestions: [{ prNumber: 42, score: 95 }],
            };
            fs.writeFileSync(path.join(repoDir, 'pr-suggestions-cache.json'), JSON.stringify(cache), 'utf-8');

            const res = await fetch(originPullRequestsUrl(`/suggestions`, REPO_ID));

            expect(res.status).toBe(200);
            const body = await res.json() as { suggestions: Array<{ prNumber: number }>; rankedAt: string };
            expect(body.rankedAt).toBe('2024-06-01T14:00:00.000Z');
            expect(body.suggestions[0].prNumber).toBe(42);
            const originFile = path.join(dataDir, 'repos', ORIGIN_ID, 'pr-suggestions-cache.json');
            expect(fs.existsSync(originFile)).toBe(true);
        });

        it('serves cached suggestions directly from the canonical origin route', async () => {
            const originDir = path.join(dataDir, 'repos', ORIGIN_ID);
            fs.mkdirSync(originDir, { recursive: true });
            fs.writeFileSync(path.join(originDir, 'pr-suggestions-cache.json'), JSON.stringify({
                rankedAt: '2024-06-02T14:00:00.000Z',
                suggestions: [{ prNumber: 7, score: 91 }],
            }), 'utf-8');

            const res = await fetch(`${baseUrl}/api/origins/${ORIGIN_ID}/pull-requests/suggestions?workspaceId=${REPO_ID}&repoId=${REPO_ID}`);

            expect(res.status).toBe(200);
            const body = await res.json() as { suggestions: Array<{ prNumber: number; score: number }>; rankedAt: string };
            expect(body.rankedAt).toBe('2024-06-02T14:00:00.000Z');
            expect(body.suggestions).toEqual([{ prNumber: 7, score: 91 }]);
        });
    });

    // ── POST /api/origins/:originId/pull-requests/suggestions/refresh ────────────────────

    describe('POST /api/origins/:originId/pull-requests/suggestions/refresh', () => {
        it('ranks PRs using origin-scoped review history and caches suggestions by origin', async () => {
            const originDir = path.join(dataDir, 'repos', ORIGIN_ID);
            fs.mkdirSync(originDir, { recursive: true });
            fs.writeFileSync(path.join(originDir, 'pr-review-history.json'), JSON.stringify({
                fetchedAt: '2024-06-01T12:00:00.000Z',
                reviews: [{ number: 1, title: 'Test PR', author: { id: 'u1', displayName: 'Alice' }, filesChanged: [], labels: [], reviewedAt: '2024-06-01T10:00:00.000Z', targetBranch: 'main', url: 'https://example.com/pr/1' }],
            }), 'utf-8');
            const aiService = {
                transform: vi.fn().mockResolvedValue({
                    success: true,
                    text: '[{"prNumber":42,"score":88}]',
                }),
            } as Parameters<typeof registerPrRoutes>[4];
            await restartServer(undefined, aiService);

            const res = await fetch(originPullRequestsUrl(`/suggestions/refresh`, REPO_ID), { method: 'POST' });

            expect(res.status).toBe(200);
            const body = await res.json() as { suggestions: Array<{ prNumber: number; score: number }> };
            expect(body.suggestions).toEqual([{ prNumber: 42, score: 88 }]);
            expect(aiService?.transform).toHaveBeenCalledTimes(1);
            const cached = fs.readFileSync(path.join(originDir, 'pr-suggestions-cache.json'), 'utf-8');
            expect(JSON.parse(cached).suggestions).toEqual([{ prNumber: 42, score: 88 }]);
            expect(fs.existsSync(path.join(dataDir, 'repos', REPO_ID, 'pr-suggestions-cache.json'))).toBe(false);
        });

        it('ranks PRs through the canonical origin route using a concrete workspace', async () => {
            const originDir = path.join(dataDir, 'repos', ORIGIN_ID);
            fs.mkdirSync(originDir, { recursive: true });
            fs.writeFileSync(path.join(originDir, 'pr-review-history.json'), JSON.stringify({
                fetchedAt: '2024-06-01T12:00:00.000Z',
                reviews: [{ number: 1, title: 'Test PR', author: { id: 'u1', displayName: 'Alice' }, filesChanged: [], labels: [], reviewedAt: '2024-06-01T10:00:00.000Z', targetBranch: 'main', url: 'https://example.com/pr/1' }],
            }), 'utf-8');
            const aiService = {
                transform: vi.fn().mockResolvedValue({
                    success: true,
                    text: '[{"prNumber":43,"score":89}]',
                }),
            } as Parameters<typeof registerPrRoutes>[4];
            await restartServer(undefined, aiService);

            const res = await fetch(`${baseUrl}/api/origins/${ORIGIN_ID}/pull-requests/suggestions/refresh?workspaceId=${REPO_ID}&repoId=${REPO_ID}`, { method: 'POST' });

            expect(res.status).toBe(200);
            const body = await res.json() as { suggestions: Array<{ prNumber: number; score: number }> };
            expect(body.suggestions).toEqual([{ prNumber: 43, score: 89 }]);
            expect(aiService?.transform).toHaveBeenCalledTimes(1);
            const cached = fs.readFileSync(path.join(originDir, 'pr-suggestions-cache.json'), 'utf-8');
            expect(JSON.parse(cached).suggestions).toEqual([{ prNumber: 43, score: 89 }]);
        });
    });

    it('returns an informational empty cache when provider has review history support but no reviews', async () => {
        mockSvc.getReviewedPullRequests = vi.fn().mockResolvedValue([]);

        const res = await fetch(originPullRequestsUrl(`/review-history/refresh`, REPO_ID), { method: 'POST' });

        expect(res.status).toBe(200);
        const body = await res.json() as { reviews: unknown[]; fetchedAt: string };
        expect(body.reviews).toEqual([]);
        expect(body.fetchedAt).toBeTruthy();
        expect(body).not.toHaveProperty('error');
    });

    it('returns 404 when repo not found', async () => {
        mockResolveRepo.mockResolvedValueOnce(null);
        const res = await fetch(originPullRequestsUrl(`/review-history/refresh`, 'unknown'), { method: 'POST' });
        expect(res.status).toBe(404);
    });

    it('returns 401 when no credentials', async () => {
        (ProviderFactory.createPullRequestsService as ReturnType<typeof vi.fn>).mockResolvedValue(null);
        const res = await fetch(originPullRequestsUrl(`/review-history/refresh`, REPO_ID), { method: 'POST' });
        expect(res.status).toBe(401);
    });
});
