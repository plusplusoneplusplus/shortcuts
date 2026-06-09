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
import type { IPullRequestsService } from '@plusplusoneplusplus/forge';
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

const mockRepoInfo = {
    id: REPO_ID,
    name: 'repo',
    localPath: '/tmp/repo',
    headSha: 'abc1234',
    clonedAt: new Date().toISOString(),
    remoteUrl: REMOTE_URL,
};

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
    await git(repoPath, ['config', 'user.email', 'test@example.com']);
    await git(repoPath, ['config', 'user.name', 'Test User']);
}

function makeServer(dir: string, autoClassification?: Parameters<typeof registerPrRoutes>[5]): http.Server {
    const routes: Route[] = [];
    registerPrRoutes(routes, dir, undefined, undefined, undefined, autoClassification);
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

async function restartServer(autoClassification?: Parameters<typeof registerPrRoutes>[5]): Promise<void> {
    await stopServer();
    server = makeServer(dataDir, autoClassification);
    await startServer();
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

// ── GET /api/repos/:id/pull-requests ─────────────────────────────────────────

describe('GET /api/repos/:id/pull-requests', () => {
    it('returns pullRequests array on success', async () => {
        const res = await fetch(`${baseUrl}/api/repos/${REPO_ID}/pull-requests`);
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

        const res = await fetch(`${baseUrl}/api/repos/${REPO_ID}/pull-requests`);
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

        await fetch(`${baseUrl}/api/repos/${REPO_ID}/pull-requests`);
        await fetch(`${baseUrl}/api/repos/${REPO_ID}/pull-requests?force=true`);

        expect(mockSvc.listPullRequests).toHaveBeenCalledTimes(2);
        expect(mockSvc.getDiff).toHaveBeenCalledTimes(1);
    });

    it('omits diff stats when the provider does not support pull request diffs', async () => {
        const svcWithoutDiff = { ...mockSvc };
        delete (svcWithoutDiff as any).getDiff;
        (ProviderFactory.createPullRequestsService as ReturnType<typeof vi.fn>).mockResolvedValue(svcWithoutDiff);

        const res = await fetch(`${baseUrl}/api/repos/${REPO_ID}/pull-requests`);
        expect(res.status).toBe(200);
        const body = await res.json() as { pullRequests: Array<{ diffStats?: unknown }> };
        expect(body.pullRequests[0].diffStats).toBeUndefined();
    });

    it('passes status to upstream and always fetches top 100', async () => {
        await fetch(`${baseUrl}/api/repos/${REPO_ID}/pull-requests?status=closed&top=10&skip=5`);
        expect(mockSvc.listPullRequests).toHaveBeenCalledWith(REPO_ID, { status: 'closed', top: 100, scope: 'mine' });
    });

    it('always fetches top 100 from upstream regardless of client top', async () => {
        await fetch(`${baseUrl}/api/repos/${REPO_ID}/pull-requests?top=200`);
        expect(mockSvc.listPullRequests).toHaveBeenCalledWith(REPO_ID, { status: 'open', top: 100, scope: 'mine' });
    });

    it('defaults status=open and fetches top 100 from upstream', async () => {
        await fetch(`${baseUrl}/api/repos/${REPO_ID}/pull-requests`);
        expect(mockSvc.listPullRequests).toHaveBeenCalledWith(REPO_ID, { status: 'open', top: 100, scope: 'mine' });
    });

    it('returns 401 with unconfigured body when no provider config', async () => {
        (ProviderFactory.createPullRequestsService as ReturnType<typeof vi.fn>).mockResolvedValue(null);
        (ProviderFactory.detectProviderType as ReturnType<typeof vi.fn>).mockReturnValue('github');

        const res = await fetch(`${baseUrl}/api/repos/${REPO_ID}/pull-requests`);
        expect(res.status).toBe(401);
        const body = await res.json() as { error: string; detected: string; remoteUrl: string };
        expect(body.error).toBe('unconfigured');
        expect(body.detected).toBe('github');
        expect(body.remoteUrl).toBe(REMOTE_URL);
    });

    it('returns 401 with no-ado-credentials when ADO az CLI fails', async () => {
        (ProviderFactory.createPullRequestsService as ReturnType<typeof vi.fn>).mockResolvedValue({ error: 'no-ado-credentials' });

        const res = await fetch(`${baseUrl}/api/repos/${REPO_ID}/pull-requests`);
        expect(res.status).toBe(401);
        const body = await res.json() as { error: string };
        expect(body.error).toBe('no-ado-credentials');
    });

    it('returns 404 when repo not found', async () => {
        mockResolveRepo.mockResolvedValueOnce(null);
        const res = await fetch(`${baseUrl}/api/repos/unknown/pull-requests`);
        expect(res.status).toBe(404);
        const body = await res.json() as { error: string };
        expect(body.error).toMatch(/unknown/);
    });

    it('filters by author display name', async () => {
        const pr2 = { ...mockPr, id: 43, number: 43, title: 'PR by Bob', author: { id: 'user2', displayName: 'Bob' } };
        (mockSvc.listPullRequests as ReturnType<typeof vi.fn>).mockResolvedValue([mockPr, pr2]);

        const res = await fetch(`${baseUrl}/api/repos/${REPO_ID}/pull-requests?author=alice`);
        expect(res.status).toBe(200);
        const body = await res.json() as { pullRequests: unknown[]; total: number };
        expect(body.pullRequests).toHaveLength(1);
        expect(body.total).toBe(1);
    });

    it('filters by search title', async () => {
        const pr2 = { ...mockPr, id: 43, number: 43, title: 'Fix bug Y' };
        (mockSvc.listPullRequests as ReturnType<typeof vi.fn>).mockResolvedValue([mockPr, pr2]);

        const res = await fetch(`${baseUrl}/api/repos/${REPO_ID}/pull-requests?search=feature`);
        expect(res.status).toBe(200);
        const body = await res.json() as { pullRequests: unknown[]; total: number };
        expect(body.pullRequests).toHaveLength(1);
    });

    it('returns 500 on unexpected error', async () => {
        (mockSvc.listPullRequests as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('network failure'));
        const res = await fetch(`${baseUrl}/api/repos/${REPO_ID}/pull-requests`);
        expect(res.status).toBe(500);
    });

    it('serves from cache on second call without hitting upstream', async () => {
        await fetch(`${baseUrl}/api/repos/${REPO_ID}/pull-requests`);
        expect(mockSvc.listPullRequests).toHaveBeenCalledTimes(1);

        const res2 = await fetch(`${baseUrl}/api/repos/${REPO_ID}/pull-requests`);
        expect(res2.status).toBe(200);
        const body = await res2.json() as { pullRequests: unknown[] };
        expect(body.pullRequests).toHaveLength(1);
        // Still only one upstream call
        expect(mockSvc.listPullRequests).toHaveBeenCalledTimes(1);
    });

    it('force=true bypasses cache and repopulates', async () => {
        // Warm the cache
        await fetch(`${baseUrl}/api/repos/${REPO_ID}/pull-requests`);
        expect(mockSvc.listPullRequests).toHaveBeenCalledTimes(1);

        // Force refresh
        const res = await fetch(`${baseUrl}/api/repos/${REPO_ID}/pull-requests?force=true`);
        expect(res.status).toBe(200);
        expect(mockSvc.listPullRequests).toHaveBeenCalledTimes(2);
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

        const res = await fetch(`${baseUrl}/api/repos/${REPO_ID}/pull-requests`);

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

        const res = await fetch(`${baseUrl}/api/repos/${REPO_ID}/pull-requests`);

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

        const res = await fetch(`${baseUrl}/api/repos/${REPO_ID}/pull-requests?workspaceId=${REPO_ID}`);

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

        const res = await fetch(`${baseUrl}/api/repos/${REPO_ID}/pull-requests?workspaceId=${REPO_ID}`);

        expect(res.status).toBe(200);
        expect(queue.enqueue).toHaveBeenCalledTimes(1);
        expect(queue.enqueue).toHaveBeenCalledWith(expect.objectContaining({
            priority: 'low',
            payload: expect.objectContaining({
                workspaceId: REPO_ID,
                repoId: REPO_ID,
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

        const res = await fetch(`${baseUrl}/api/repos/${REPO_ID}/pull-requests?workspaceId=${REPO_ID}`);
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

        const res = await fetch(`${baseUrl}/api/repos/${REPO_ID}/pull-requests/team-auto-classification`, {
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

        const res = await fetch(`${baseUrl}/api/repos/${REPO_ID}/pull-requests/team-auto-classification`, {
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
                classificationIdentifier: '42:head-manual',
                skills: ['classify-diff'],
            }),
        }));
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
                classificationIdentifier: '42:head-workspace-scoped',
            }),
        }));
    });

    it('paginates from cache without upstream call', async () => {
        const prs = Array.from({ length: 50 }, (_, i) => ({ ...mockPr, id: i, number: i, title: `PR ${i}` }));
        (mockSvc.listPullRequests as ReturnType<typeof vi.fn>).mockResolvedValue(prs);

        // First call warms cache
        const res1 = await fetch(`${baseUrl}/api/repos/${REPO_ID}/pull-requests?top=25&skip=0`);
        expect(res1.status).toBe(200);
        const body1 = await res1.json() as { pullRequests: any[] };
        expect(body1.pullRequests).toHaveLength(25);

        // Second page from cache
        const res2 = await fetch(`${baseUrl}/api/repos/${REPO_ID}/pull-requests?top=25&skip=25`);
        expect(res2.status).toBe(200);
        const body2 = await res2.json() as { pullRequests: any[] };
        expect(body2.pullRequests).toHaveLength(25);
        expect(body2.pullRequests[0].title).toBe('PR 25');

        // Only one upstream call total
        expect(mockSvc.listPullRequests).toHaveBeenCalledTimes(1);
    });

    it('uses separate cache entries per status filter', async () => {
        await fetch(`${baseUrl}/api/repos/${REPO_ID}/pull-requests?status=open`);
        await fetch(`${baseUrl}/api/repos/${REPO_ID}/pull-requests?status=closed`);
        expect(mockSvc.listPullRequests).toHaveBeenCalledTimes(2);

        // Both are now cached — no additional calls
        await fetch(`${baseUrl}/api/repos/${REPO_ID}/pull-requests?status=open`);
        await fetch(`${baseUrl}/api/repos/${REPO_ID}/pull-requests?status=closed`);
        expect(mockSvc.listPullRequests).toHaveBeenCalledTimes(2);
    });

    it('passes scope=all to upstream when requested', async () => {
        await fetch(`${baseUrl}/api/repos/${REPO_ID}/pull-requests?scope=all`);
        expect(mockSvc.listPullRequests).toHaveBeenCalledWith(REPO_ID, { status: 'open', top: 100, scope: 'all' });
    });

    it('defaults scope to mine when not specified', async () => {
        await fetch(`${baseUrl}/api/repos/${REPO_ID}/pull-requests`);
        expect(mockSvc.listPullRequests).toHaveBeenCalledWith(REPO_ID, { status: 'open', top: 100, scope: 'mine' });
    });

    it('ignores invalid scope values and defaults to mine', async () => {
        await fetch(`${baseUrl}/api/repos/${REPO_ID}/pull-requests?scope=invalid`);
        expect(mockSvc.listPullRequests).toHaveBeenCalledWith(REPO_ID, { status: 'open', top: 100, scope: 'mine' });
    });

    it('uses separate cache entries per scope', async () => {
        await fetch(`${baseUrl}/api/repos/${REPO_ID}/pull-requests?scope=mine`);
        await fetch(`${baseUrl}/api/repos/${REPO_ID}/pull-requests?scope=all`);
        expect(mockSvc.listPullRequests).toHaveBeenCalledTimes(2);

        // Both are now cached
        await fetch(`${baseUrl}/api/repos/${REPO_ID}/pull-requests?scope=mine`);
        await fetch(`${baseUrl}/api/repos/${REPO_ID}/pull-requests?scope=all`);
        expect(mockSvc.listPullRequests).toHaveBeenCalledTimes(2);
    });
});

// ── GET /api/repos/:id/pull-requests/:prId ───────────────────────────────────

describe('GET /api/repos/:id/pull-requests/:prId', () => {
    it('returns single PR on success', async () => {
        const res = await fetch(`${baseUrl}/api/repos/${REPO_ID}/pull-requests/42`);
        expect(res.status).toBe(200);
        const body = await res.json() as { number: number };
        expect(body.number).toBe(42);
    });

    it('returns 404 when repo not found', async () => {
        mockResolveRepo.mockResolvedValueOnce(null);
        const res = await fetch(`${baseUrl}/api/repos/unknown/pull-requests/42`);
        expect(res.status).toBe(404);
    });

    it('returns 404 when PR not found', async () => {
        (mockSvc.getPullRequest as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('PR 999 not found'));
        const res = await fetch(`${baseUrl}/api/repos/${REPO_ID}/pull-requests/999`);
        expect(res.status).toBe(404);
    });

    it('returns 401 when unconfigured', async () => {
        (ProviderFactory.createPullRequestsService as ReturnType<typeof vi.fn>).mockResolvedValue(null);
        const res = await fetch(`${baseUrl}/api/repos/${REPO_ID}/pull-requests/42`);
        expect(res.status).toBe(401);
        const body = await res.json() as { error: string };
        expect(body.error).toBe('unconfigured');
    });

    it('returns 500 on unexpected error', async () => {
        (mockSvc.getPullRequest as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('oops'));
        const res = await fetch(`${baseUrl}/api/repos/${REPO_ID}/pull-requests/42`);
        expect(res.status).toBe(500);
    });
});

// ── GET /api/repos/:id/pull-requests/:prId/threads ───────────────────────────

describe('GET /api/repos/:id/pull-requests/:prId/threads', () => {
    it('returns threads array on success', async () => {
        const res = await fetch(`${baseUrl}/api/repos/${REPO_ID}/pull-requests/42/threads`);
        expect(res.status).toBe(200);
        const body = await res.json() as { threads: unknown[] };
        expect(Array.isArray(body.threads)).toBe(true);
        expect(body.threads).toHaveLength(1);
    });

    it('returns 404 when repo not found', async () => {
        mockResolveRepo.mockResolvedValueOnce(null);
        const res = await fetch(`${baseUrl}/api/repos/unknown/pull-requests/42/threads`);
        expect(res.status).toBe(404);
    });

    it('returns 500 on unexpected error', async () => {
        (mockSvc.getThreads as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('network'));
        const res = await fetch(`${baseUrl}/api/repos/${REPO_ID}/pull-requests/42/threads`);
        expect(res.status).toBe(500);
    });
});

// ── GET /api/repos/:id/pull-requests/:prId/reviewers ─────────────────────────

describe('GET /api/repos/:id/pull-requests/:prId/reviewers', () => {
    it('returns reviewers array on success', async () => {
        const res = await fetch(`${baseUrl}/api/repos/${REPO_ID}/pull-requests/42/reviewers`);
        expect(res.status).toBe(200);
        const body = await res.json() as { reviewers: unknown[] };
        expect(Array.isArray(body.reviewers)).toBe(true);
        expect(body.reviewers).toHaveLength(1);
    });

    it('returns 404 when repo not found', async () => {
        mockResolveRepo.mockResolvedValueOnce(null);
        const res = await fetch(`${baseUrl}/api/repos/unknown/pull-requests/42/reviewers`);
        expect(res.status).toBe(404);
    });

    it('returns 500 on unexpected error', async () => {
        (mockSvc.getReviewers as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('network'));
        const res = await fetch(`${baseUrl}/api/repos/${REPO_ID}/pull-requests/42/reviewers`);
        expect(res.status).toBe(500);
    });
});

// ── GET /api/repos/:id/pull-requests/:prId/commits ──────────────────────────

describe('GET /api/repos/:id/pull-requests/:prId/commits', () => {
    it('returns commits array on success', async () => {
        const res = await fetch(`${baseUrl}/api/repos/${REPO_ID}/pull-requests/42/commits`);
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

        const res = await fetch(`${baseUrl}/api/repos/${REPO_ID}/pull-requests/42/commits`);
        expect(res.status).toBe(200);
        const body = await res.json() as { commits: unknown[] };
        expect(body.commits).toEqual([]);
    });

    it('returns 404 when repo not found', async () => {
        mockResolveRepo.mockResolvedValueOnce(null);
        const res = await fetch(`${baseUrl}/api/repos/unknown/pull-requests/42/commits`);
        expect(res.status).toBe(404);
    });

    it('returns 401 when unconfigured', async () => {
        (ProviderFactory.createPullRequestsService as ReturnType<typeof vi.fn>).mockResolvedValue(null);
        const res = await fetch(`${baseUrl}/api/repos/${REPO_ID}/pull-requests/42/commits`);
        expect(res.status).toBe(401);
        const body = await res.json() as { error: string };
        expect(body.error).toBe('unconfigured');
    });

    it('returns 500 on unexpected error', async () => {
        (mockSvc.getCommits as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('network'));
        const res = await fetch(`${baseUrl}/api/repos/${REPO_ID}/pull-requests/42/commits`);
        expect(res.status).toBe(500);
    });
});

// ── GET /api/repos/:id/pull-requests/:prId/diff ───────────────────────────────

describe('GET /api/repos/:id/pull-requests/:prId/diff', () => {
    it('returns diff text on success', async () => {
        const res = await fetch(`${baseUrl}/api/repos/${REPO_ID}/pull-requests/42/diff`);
        expect(res.status).toBe(200);
        const text = await res.text();
        expect(text).toContain('diff --git');
    });

    it('returns empty string when getDiff is not implemented', async () => {
        const svcWithoutDiff = { ...mockSvc };
        delete (svcWithoutDiff as any).getDiff;
        (ProviderFactory.createPullRequestsService as ReturnType<typeof vi.fn>).mockResolvedValue(svcWithoutDiff);

        const res = await fetch(`${baseUrl}/api/repos/${REPO_ID}/pull-requests/42/diff`);
        expect(res.status).toBe(200);
        const text = await res.text();
        expect(text).toBe('');
    });

    it('returns 404 when repo not found', async () => {
        mockResolveRepo.mockResolvedValueOnce(null);
        const res = await fetch(`${baseUrl}/api/repos/unknown/pull-requests/42/diff`);
        expect(res.status).toBe(404);
    });

    it('returns 401 when unconfigured', async () => {
        (ProviderFactory.createPullRequestsService as ReturnType<typeof vi.fn>).mockResolvedValue(null);
        const res = await fetch(`${baseUrl}/api/repos/${REPO_ID}/pull-requests/42/diff`);
        expect(res.status).toBe(401);
        const body = await res.json() as { error: string };
        expect(body.error).toBe('unconfigured');
    });

    it('returns 500 on unexpected error', async () => {
        (mockSvc.getDiff as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('network'));
        const res = await fetch(`${baseUrl}/api/repos/${REPO_ID}/pull-requests/42/diff`);
        expect(res.status).toBe(500);
    });
});

// ── GET /api/repos/:id/pull-requests/:prId/commits ────────────────────────────

describe('GET /api/repos/:id/pull-requests/:prId/commits', () => {
    it('returns commits array on success', async () => {
        const res = await fetch(`${baseUrl}/api/repos/${REPO_ID}/pull-requests/42/commits`);
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

        const res = await fetch(`${baseUrl}/api/repos/${REPO_ID}/pull-requests/42/commits`);
        expect(res.status).toBe(200);
        const body = await res.json() as { commits: unknown[] };
        expect(body.commits).toEqual([]);
    });

    it('returns 404 when repo not found', async () => {
        mockResolveRepo.mockResolvedValueOnce(null);
        const res = await fetch(`${baseUrl}/api/repos/unknown/pull-requests/42/commits`);
        expect(res.status).toBe(404);
    });

    it('returns 401 when unconfigured', async () => {
        (ProviderFactory.createPullRequestsService as ReturnType<typeof vi.fn>).mockResolvedValue(null);
        const res = await fetch(`${baseUrl}/api/repos/${REPO_ID}/pull-requests/42/commits`);
        expect(res.status).toBe(401);
        const body = await res.json() as { error: string };
        expect(body.error).toBe('unconfigured');
    });

    it('returns 401 with no-ado-credentials when ADO az CLI fails', async () => {
        (ProviderFactory.createPullRequestsService as ReturnType<typeof vi.fn>).mockResolvedValue({ error: 'no-ado-credentials' });
        const res = await fetch(`${baseUrl}/api/repos/${REPO_ID}/pull-requests/42/commits`);
        expect(res.status).toBe(401);
        const body = await res.json() as { error: string };
        expect(body.error).toBe('no-ado-credentials');
    });

    it('returns 500 on unexpected error', async () => {
        (mockSvc.getCommits as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('network'));
        const res = await fetch(`${baseUrl}/api/repos/${REPO_ID}/pull-requests/42/commits`);
        expect(res.status).toBe(500);
    });
});

// ── GET /api/repos/:id/pull-requests/:prId/diff/files/:filePath ─────────────

describe('GET /api/repos/:id/pull-requests/:prId/diff/files/:filePath', () => {
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
        const res = await fetch(`${baseUrl}/api/repos/${REPO_ID}/pull-requests/42/diff/files/${encodeURIComponent('src/foo.ts')}`);
        expect(res.status).toBe(200);
        const body = await res.json() as { diff: string };
        expect(body.diff).toContain('diff --git a/src/foo.ts b/src/foo.ts');
        expect(body.diff).toContain('+added');
        expect(body.diff).not.toContain('src/bar.ts');
    });

    it('returns empty diff when file not found in combined diff', async () => {
        (mockSvc.getDiff as ReturnType<typeof vi.fn>).mockResolvedValue(combinedDiff);
        const res = await fetch(`${baseUrl}/api/repos/${REPO_ID}/pull-requests/42/diff/files/${encodeURIComponent('src/missing.ts')}`);
        expect(res.status).toBe(200);
        const body = await res.json() as { diff: string };
        expect(body.diff).toBe('');
    });

    it('returns empty diff when getDiff is not implemented', async () => {
        const svcWithoutDiff = { ...mockSvc };
        delete (svcWithoutDiff as any).getDiff;
        (ProviderFactory.createPullRequestsService as ReturnType<typeof vi.fn>).mockResolvedValue(svcWithoutDiff);

        const res = await fetch(`${baseUrl}/api/repos/${REPO_ID}/pull-requests/42/diff/files/${encodeURIComponent('src/foo.ts')}`);
        expect(res.status).toBe(200);
        const body = await res.json() as { diff: string };
        expect(body.diff).toBe('');
    });

    it('returns 404 when repo not found', async () => {
        mockResolveRepo.mockResolvedValueOnce(null);
        const res = await fetch(`${baseUrl}/api/repos/unknown/pull-requests/42/diff/files/${encodeURIComponent('src/foo.ts')}`);
        expect(res.status).toBe(404);
    });

    it('returns 401 when unconfigured', async () => {
        (ProviderFactory.createPullRequestsService as ReturnType<typeof vi.fn>).mockResolvedValue(null);
        const res = await fetch(`${baseUrl}/api/repos/${REPO_ID}/pull-requests/42/diff/files/${encodeURIComponent('src/foo.ts')}`);
        expect(res.status).toBe(401);
        const body = await res.json() as { error: string };
        expect(body.error).toBe('unconfigured');
    });

    it('returns 401 with no-ado-credentials when ADO az CLI fails', async () => {
        (ProviderFactory.createPullRequestsService as ReturnType<typeof vi.fn>).mockResolvedValue({ error: 'no-ado-credentials' });
        const res = await fetch(`${baseUrl}/api/repos/${REPO_ID}/pull-requests/42/diff/files/${encodeURIComponent('src/foo.ts')}`);
        expect(res.status).toBe(401);
        const body = await res.json() as { error: string };
        expect(body.error).toBe('no-ado-credentials');
    });

    it('returns 500 on unexpected error', async () => {
        (mockSvc.getDiff as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('network'));
        const res = await fetch(`${baseUrl}/api/repos/${REPO_ID}/pull-requests/42/diff/files/${encodeURIComponent('src/foo.ts')}`);
        expect(res.status).toBe(500);
    });

    it('decodes URL-encoded file paths', async () => {
        const diffWithSpaces = 'diff --git a/path with spaces/file.ts b/path with spaces/file.ts\n--- a/path with spaces/file.ts\n+++ b/path with spaces/file.ts\n@@ -1 +1 @@\n-old\n+new\n';
        (mockSvc.getDiff as ReturnType<typeof vi.fn>).mockResolvedValue(diffWithSpaces);
        const res = await fetch(`${baseUrl}/api/repos/${REPO_ID}/pull-requests/42/diff/files/${encodeURIComponent('path with spaces/file.ts')}`);
        expect(res.status).toBe(200);
        const body = await res.json() as { diff: string };
        expect(body.diff).toContain('path with spaces/file.ts');
    });
});

// ── GET /api/repos/:id/pull-requests/:prId/diff/files/:path?fullContext=true (AC-02) ──

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
        const res = await fetch(`${baseUrl}/api/repos/${REPO_ID}/pull-requests/42/diff/files/${encodeURIComponent('src/foo.ts')}`);
        expect(res.status).toBe(200);
        const body = await res.json() as { diff: string; fullContextUnavailable?: boolean };
        expect(body.diff).toContain('diff --git a/src/foo.ts');
        expect(body.fullContextUnavailable).toBeUndefined();
    });

    it('with ?fullContext=true and no cached PR detail: returns hunk diff with fullContextUnavailable=true', async () => {
        // No prior GET /pull-requests/42 call, so prDetailCache is empty
        const res = await fetch(`${baseUrl}/api/repos/${REPO_ID}/pull-requests/42/diff/files/${encodeURIComponent('src/foo.ts')}?fullContext=true`);
        expect(res.status).toBe(200);
        const body = await res.json() as { diff: string; fullContextUnavailable: boolean };
        expect(body.fullContextUnavailable).toBe(true);
        // Should still include the hunk diff as fallback
        expect(body.diff).toContain('diff --git a/src/foo.ts');
        expect(mockSvc.getPullRequest).toHaveBeenCalledWith(REPO_ID, '42');
    });

    it('with ?fullContext=true and cached PR detail missing SHAs: returns fullContextUnavailable=true', async () => {
        // Warm the PR detail cache (mockPr has no baseSha/headSha)
        await fetch(`${baseUrl}/api/repos/${REPO_ID}/pull-requests/42`);

        const res = await fetch(`${baseUrl}/api/repos/${REPO_ID}/pull-requests/42/diff/files/${encodeURIComponent('src/foo.ts')}?fullContext=true`);
        expect(res.status).toBe(200);
        const body = await res.json() as { diff: string; fullContextUnavailable: boolean };
        expect(body.fullContextUnavailable).toBe(true);
        // Fallback hunk diff still returned
        expect(body.diff).toContain('diff --git a/src/foo.ts');
    });

    it('with ?fullContext=true and cached PR detail has SHAs but git fails: returns fullContextUnavailable=true', async () => {
        // Override getPullRequest to return a PR with SHAs
        const prWithShas = { ...mockPr, headSha: 'deadbeef111', baseSha: 'cafebabe222' };
        (mockSvc.getPullRequest as ReturnType<typeof vi.fn>).mockResolvedValueOnce(prWithShas);

        // Warm the PR detail cache with SHAs
        await fetch(`${baseUrl}/api/repos/${REPO_ID}/pull-requests/42`);

        // The repo.localPath is /tmp/repo which is not a real git repo, so git diff fails
        const res = await fetch(`${baseUrl}/api/repos/${REPO_ID}/pull-requests/42/diff/files/${encodeURIComponent('src/foo.ts')}?fullContext=true`);
        expect(res.status).toBe(200);
        const body = await res.json() as { diff: string; fullContextUnavailable: boolean };
        expect(body.fullContextUnavailable).toBe(true);
        expect(body.diff).toContain('diff --git a/src/foo.ts');
    });

    it('with ?fullContext=true and PR detail fetch fails: returns hunk diff fallback', async () => {
        (mockSvc.getPullRequest as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('detail unavailable'));

        const res = await fetch(`${baseUrl}/api/repos/${REPO_ID}/pull-requests/42/diff/files/${encodeURIComponent('src/foo.ts')}?fullContext=true`);
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

        const res = await fetch(`${baseUrl}/api/repos/${REPO_ID}/pull-requests/42/diff/files/${encodeURIComponent('src/foo.ts')}?fullContext=true`);
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
        const r1 = await fetch(`${baseUrl}/api/repos/${REPO_ID}/pull-requests/42/diff`);
        expect(r1.status).toBe(200);

        const r2 = await fetch(`${baseUrl}/api/repos/${REPO_ID}/pull-requests/42/diff`);
        expect(r2.status).toBe(200);
        expect(mockSvc.getDiff).toHaveBeenCalledTimes(1);
    });

    it('caches the combined diff so /diff/files endpoint hits once on second request', async () => {
        const r1 = await fetch(`${baseUrl}/api/repos/${REPO_ID}/pull-requests/42/diff/files/${encodeURIComponent('src/foo.ts')}`);
        expect(r1.status).toBe(200);

        const r2 = await fetch(`${baseUrl}/api/repos/${REPO_ID}/pull-requests/42/diff/files/${encodeURIComponent('src/bar.ts')}`);
        expect(r2.status).toBe(200);
        // Both per-file requests share one upstream fetch
        expect(mockSvc.getDiff).toHaveBeenCalledTimes(1);
    });

    it('full /diff and /diff/files requests share the same cached combined diff', async () => {
        await fetch(`${baseUrl}/api/repos/${REPO_ID}/pull-requests/42/diff`);
        await fetch(`${baseUrl}/api/repos/${REPO_ID}/pull-requests/42/diff/files/${encodeURIComponent('src/foo.ts')}`);
        // Second call should reuse the cache set by the first
        expect(mockSvc.getDiff).toHaveBeenCalledTimes(1);
    });

    it('force-refreshing PR detail clears the diff cache and the next diff request refetches', async () => {
        // Warm the diff cache via /diff
        await fetch(`${baseUrl}/api/repos/${REPO_ID}/pull-requests/42/diff`);
        expect(mockSvc.getDiff).toHaveBeenCalledTimes(1);

        // Force-refresh PR detail
        await fetch(`${baseUrl}/api/repos/${REPO_ID}/pull-requests/42?force=true`);

        // Next diff request must refetch from provider
        await fetch(`${baseUrl}/api/repos/${REPO_ID}/pull-requests/42/diff`);
        expect(mockSvc.getDiff).toHaveBeenCalledTimes(2);
    });

    it('uses separate cache entries per PR so switching PRs does not cross-pollute', async () => {
        const pr2Diff = 'diff --git a/other.ts b/other.ts\n';
        (mockSvc.getDiff as ReturnType<typeof vi.fn>)
            .mockResolvedValueOnce(combinedDiff)  // PR 42
            .mockResolvedValueOnce(pr2Diff);        // PR 99

        await fetch(`${baseUrl}/api/repos/${REPO_ID}/pull-requests/42/diff`);
        const r99 = await fetch(`${baseUrl}/api/repos/${REPO_ID}/pull-requests/99/diff`);
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

        await fetch(`${baseUrl}/api/repos/${REPO_ID}/pull-requests/42/diff`);
        await fetch(`${baseUrl}/api/repos/${REPO_ID}/pull-requests/99/diff`);
        expect(mockSvc.getDiff).toHaveBeenCalledTimes(2);

        // Force-refresh PR 42 detail only
        await fetch(`${baseUrl}/api/repos/${REPO_ID}/pull-requests/42?force=true`);

        // PR 99 diff still cached
        await fetch(`${baseUrl}/api/repos/${REPO_ID}/pull-requests/99/diff`);
        expect(mockSvc.getDiff).toHaveBeenCalledTimes(2);
    });
});

// ── GET /api/repos/:id/pull-requests/:prId/checks ─────────────────────────────

describe('GET /api/repos/:id/pull-requests/:prId/checks', () => {
    it('returns checks array on success', async () => {
        const res = await fetch(`${baseUrl}/api/repos/${REPO_ID}/pull-requests/42/checks`);
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

        const res = await fetch(`${baseUrl}/api/repos/${REPO_ID}/pull-requests/42/checks`);
        expect(res.status).toBe(200);
        const body = await res.json() as { checks: unknown[] };
        expect(body.checks).toEqual([]);
    });

    it('returns 404 when repo not found', async () => {
        mockResolveRepo.mockResolvedValueOnce(null);
        const res = await fetch(`${baseUrl}/api/repos/unknown/pull-requests/42/checks`);
        expect(res.status).toBe(404);
    });

    it('returns 401 when unconfigured', async () => {
        (ProviderFactory.createPullRequestsService as ReturnType<typeof vi.fn>).mockResolvedValue(null);
        const res = await fetch(`${baseUrl}/api/repos/${REPO_ID}/pull-requests/42/checks`);
        expect(res.status).toBe(401);
        const body = await res.json() as { error: string };
        expect(body.error).toBe('unconfigured');
    });

    it('returns 401 with no-ado-credentials when ADO az CLI fails', async () => {
        (ProviderFactory.createPullRequestsService as ReturnType<typeof vi.fn>).mockResolvedValue({ error: 'no-ado-credentials' });
        const res = await fetch(`${baseUrl}/api/repos/${REPO_ID}/pull-requests/42/checks`);
        expect(res.status).toBe(401);
        const body = await res.json() as { error: string };
        expect(body.error).toBe('no-ado-credentials');
    });

    it('returns 500 on unexpected error', async () => {
        (mockSvc.getChecks as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('network'));
        const res = await fetch(`${baseUrl}/api/repos/${REPO_ID}/pull-requests/42/checks`);
        expect(res.status).toBe(500);
    });
});

// ── threads cache tests ───────────────────────────────────────────────────────

describe('threads cache (GET /api/repos/:id/pull-requests/:prId/threads)', () => {
    it('cache miss calls provider', async () => {
        const res = await fetch(`${baseUrl}/api/repos/${REPO_ID}/pull-requests/42/threads`);
        expect(res.status).toBe(200);
        expect(mockSvc.getThreads).toHaveBeenCalledTimes(1);
    });

    it('cache hit does not call provider', async () => {
        await fetch(`${baseUrl}/api/repos/${REPO_ID}/pull-requests/42/threads`);
        expect(mockSvc.getThreads).toHaveBeenCalledTimes(1);

        const res2 = await fetch(`${baseUrl}/api/repos/${REPO_ID}/pull-requests/42/threads`);
        expect(res2.status).toBe(200);
        const body = await res2.json() as { threads: unknown[] };
        expect(body.threads).toHaveLength(1);
        expect(mockSvc.getThreads).toHaveBeenCalledTimes(1);
    });

    it('expired TTL refetches from provider', async () => {
        vi.useFakeTimers();
        try {
            await fetch(`${baseUrl}/api/repos/${REPO_ID}/pull-requests/42/threads`);
            expect(mockSvc.getThreads).toHaveBeenCalledTimes(1);

            vi.advanceTimersByTime(11 * 60 * 1000); // 11 minutes

            await fetch(`${baseUrl}/api/repos/${REPO_ID}/pull-requests/42/threads`);
            expect(mockSvc.getThreads).toHaveBeenCalledTimes(2);
        } finally {
            vi.useRealTimers();
        }
    });

    it('force=true on PR detail evicts threads cache', async () => {
        await fetch(`${baseUrl}/api/repos/${REPO_ID}/pull-requests/42/threads`);
        expect(mockSvc.getThreads).toHaveBeenCalledTimes(1);

        // Force-refresh the detail endpoint
        await fetch(`${baseUrl}/api/repos/${REPO_ID}/pull-requests/42?force=true`);

        // Next threads call must hit upstream again
        await fetch(`${baseUrl}/api/repos/${REPO_ID}/pull-requests/42/threads`);
        expect(mockSvc.getThreads).toHaveBeenCalledTimes(2);
    });
});

// ── commits cache tests ───────────────────────────────────────────────────────

describe('commits cache (GET /api/repos/:id/pull-requests/:prId/commits)', () => {
    it('cache miss calls provider', async () => {
        const res = await fetch(`${baseUrl}/api/repos/${REPO_ID}/pull-requests/42/commits`);
        expect(res.status).toBe(200);
        expect(mockSvc.getCommits).toHaveBeenCalledTimes(1);
    });

    it('cache hit does not call provider', async () => {
        await fetch(`${baseUrl}/api/repos/${REPO_ID}/pull-requests/42/commits`);
        expect(mockSvc.getCommits).toHaveBeenCalledTimes(1);

        const res2 = await fetch(`${baseUrl}/api/repos/${REPO_ID}/pull-requests/42/commits`);
        expect(res2.status).toBe(200);
        const body = await res2.json() as { commits: unknown[] };
        expect(body.commits).toHaveLength(1);
        expect(mockSvc.getCommits).toHaveBeenCalledTimes(1);
    });

    it('expired TTL refetches from provider', async () => {
        vi.useFakeTimers();
        try {
            await fetch(`${baseUrl}/api/repos/${REPO_ID}/pull-requests/42/commits`);
            expect(mockSvc.getCommits).toHaveBeenCalledTimes(1);

            vi.advanceTimersByTime(31 * 60 * 1000); // 31 minutes

            await fetch(`${baseUrl}/api/repos/${REPO_ID}/pull-requests/42/commits`);
            expect(mockSvc.getCommits).toHaveBeenCalledTimes(2);
        } finally {
            vi.useRealTimers();
        }
    });

    it('force=true on PR detail evicts commits cache', async () => {
        await fetch(`${baseUrl}/api/repos/${REPO_ID}/pull-requests/42/commits`);
        expect(mockSvc.getCommits).toHaveBeenCalledTimes(1);

        await fetch(`${baseUrl}/api/repos/${REPO_ID}/pull-requests/42?force=true`);

        await fetch(`${baseUrl}/api/repos/${REPO_ID}/pull-requests/42/commits`);
        expect(mockSvc.getCommits).toHaveBeenCalledTimes(2);
    });
});

// ── reviewers cache tests ─────────────────────────────────────────────────────

describe('reviewers cache (GET /api/repos/:id/pull-requests/:prId/reviewers)', () => {
    it('cache miss calls provider', async () => {
        const res = await fetch(`${baseUrl}/api/repos/${REPO_ID}/pull-requests/42/reviewers`);
        expect(res.status).toBe(200);
        expect(mockSvc.getReviewers).toHaveBeenCalledTimes(1);
    });

    it('cache hit does not call provider', async () => {
        await fetch(`${baseUrl}/api/repos/${REPO_ID}/pull-requests/42/reviewers`);
        expect(mockSvc.getReviewers).toHaveBeenCalledTimes(1);

        const res2 = await fetch(`${baseUrl}/api/repos/${REPO_ID}/pull-requests/42/reviewers`);
        expect(res2.status).toBe(200);
        const body = await res2.json() as { reviewers: unknown[] };
        expect(body.reviewers).toHaveLength(1);
        expect(mockSvc.getReviewers).toHaveBeenCalledTimes(1);
    });

    it('expired TTL refetches from provider', async () => {
        vi.useFakeTimers();
        try {
            await fetch(`${baseUrl}/api/repos/${REPO_ID}/pull-requests/42/reviewers`);
            expect(mockSvc.getReviewers).toHaveBeenCalledTimes(1);

            vi.advanceTimersByTime(31 * 60 * 1000); // 31 minutes

            await fetch(`${baseUrl}/api/repos/${REPO_ID}/pull-requests/42/reviewers`);
            expect(mockSvc.getReviewers).toHaveBeenCalledTimes(2);
        } finally {
            vi.useRealTimers();
        }
    });

    it('force=true on PR detail evicts reviewers cache', async () => {
        await fetch(`${baseUrl}/api/repos/${REPO_ID}/pull-requests/42/reviewers`);
        expect(mockSvc.getReviewers).toHaveBeenCalledTimes(1);

        await fetch(`${baseUrl}/api/repos/${REPO_ID}/pull-requests/42?force=true`);

        await fetch(`${baseUrl}/api/repos/${REPO_ID}/pull-requests/42/reviewers`);
        expect(mockSvc.getReviewers).toHaveBeenCalledTimes(2);
    });
});

// ── checks cache tests ────────────────────────────────────────────────────────

describe('checks cache (GET /api/repos/:id/pull-requests/:prId/checks)', () => {
    it('cache miss calls provider', async () => {
        const res = await fetch(`${baseUrl}/api/repos/${REPO_ID}/pull-requests/42/checks`);
        expect(res.status).toBe(200);
        expect(mockSvc.getChecks).toHaveBeenCalledTimes(1);
    });

    it('cache hit does not call provider', async () => {
        await fetch(`${baseUrl}/api/repos/${REPO_ID}/pull-requests/42/checks`);
        expect(mockSvc.getChecks).toHaveBeenCalledTimes(1);

        const res2 = await fetch(`${baseUrl}/api/repos/${REPO_ID}/pull-requests/42/checks`);
        expect(res2.status).toBe(200);
        const body = await res2.json() as { checks: unknown[] };
        expect(body.checks).toHaveLength(1);
        expect(mockSvc.getChecks).toHaveBeenCalledTimes(1);
    });

    it('expired TTL refetches from provider', async () => {
        vi.useFakeTimers();
        try {
            await fetch(`${baseUrl}/api/repos/${REPO_ID}/pull-requests/42/checks`);
            expect(mockSvc.getChecks).toHaveBeenCalledTimes(1);

            vi.advanceTimersByTime(11 * 60 * 1000); // 11 minutes

            await fetch(`${baseUrl}/api/repos/${REPO_ID}/pull-requests/42/checks`);
            expect(mockSvc.getChecks).toHaveBeenCalledTimes(2);
        } finally {
            vi.useRealTimers();
        }
    });

    it('force=true on PR detail evicts checks cache', async () => {
        await fetch(`${baseUrl}/api/repos/${REPO_ID}/pull-requests/42/checks`);
        expect(mockSvc.getChecks).toHaveBeenCalledTimes(1);

        await fetch(`${baseUrl}/api/repos/${REPO_ID}/pull-requests/42?force=true`);

        await fetch(`${baseUrl}/api/repos/${REPO_ID}/pull-requests/42/checks`);
        expect(mockSvc.getChecks).toHaveBeenCalledTimes(2);
    });
});

// ── PR detail cache tests ─────────────────────────────────────────────────────

describe('PR detail cache (GET /api/repos/:id/pull-requests/:prId)', () => {
    it('serves from cache on second call without hitting upstream', async () => {
        await fetch(`${baseUrl}/api/repos/${REPO_ID}/pull-requests/42`);
        expect(mockSvc.getPullRequest).toHaveBeenCalledTimes(1);

        const res2 = await fetch(`${baseUrl}/api/repos/${REPO_ID}/pull-requests/42`);
        expect(res2.status).toBe(200);
        const body = await res2.json() as { number: number };
        expect(body.number).toBe(42);
        // Still only one upstream call
        expect(mockSvc.getPullRequest).toHaveBeenCalledTimes(1);
    });

    it('force=true bypasses cache and repopulates', async () => {
        // Warm the cache
        await fetch(`${baseUrl}/api/repos/${REPO_ID}/pull-requests/42`);
        expect(mockSvc.getPullRequest).toHaveBeenCalledTimes(1);

        // Force refresh
        const res = await fetch(`${baseUrl}/api/repos/${REPO_ID}/pull-requests/42?force=true`);
        expect(res.status).toBe(200);
        expect(mockSvc.getPullRequest).toHaveBeenCalledTimes(2);
    });

    it('re-fetches after TTL expiry', async () => {
        // Warm the cache
        await fetch(`${baseUrl}/api/repos/${REPO_ID}/pull-requests/42`);
        expect(mockSvc.getPullRequest).toHaveBeenCalledTimes(1);

        // Expire the cache by manipulating Date.now
        const realNow = Date.now;
        Date.now = () => realNow() + 11 * 60 * 1000; // 11 minutes into the future
        try {
            const res = await fetch(`${baseUrl}/api/repos/${REPO_ID}/pull-requests/42`);
            expect(res.status).toBe(200);
            expect(mockSvc.getPullRequest).toHaveBeenCalledTimes(2);
        } finally {
            Date.now = realNow;
        }
    });

    it('uses separate cache entries per repo and PR', async () => {
        // Fetch PR 42 for repo-abc123
        await fetch(`${baseUrl}/api/repos/${REPO_ID}/pull-requests/42`);
        // Fetch PR 99 for repo-abc123
        await fetch(`${baseUrl}/api/repos/${REPO_ID}/pull-requests/99`);
        expect(mockSvc.getPullRequest).toHaveBeenCalledTimes(2);

        // Both are now cached — no additional calls
        await fetch(`${baseUrl}/api/repos/${REPO_ID}/pull-requests/42`);
        await fetch(`${baseUrl}/api/repos/${REPO_ID}/pull-requests/99`);
        expect(mockSvc.getPullRequest).toHaveBeenCalledTimes(2);
    });

    it('does not cache 404 errors', async () => {
        (mockSvc.getPullRequest as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('PR 999 not found'));
        const res1 = await fetch(`${baseUrl}/api/repos/${REPO_ID}/pull-requests/999`);
        expect(res1.status).toBe(404);

        // Retry should hit upstream again (not serve cached error)
        (mockSvc.getPullRequest as ReturnType<typeof vi.fn>).mockResolvedValueOnce(mockPr);
        const res2 = await fetch(`${baseUrl}/api/repos/${REPO_ID}/pull-requests/999`);
        expect(res2.status).toBe(200);
        expect(mockSvc.getPullRequest).toHaveBeenCalledTimes(2);
    });

    it('does not cache auth errors', async () => {
        (mockSvc.getPullRequest as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('401 unauthorized'));
        const res1 = await fetch(`${baseUrl}/api/repos/${REPO_ID}/pull-requests/42`);
        expect(res1.status).toBe(401);

        // Retry should hit upstream again
        (mockSvc.getPullRequest as ReturnType<typeof vi.fn>).mockResolvedValueOnce(mockPr);
        const res2 = await fetch(`${baseUrl}/api/repos/${REPO_ID}/pull-requests/42`);
        expect(res2.status).toBe(200);
        expect(mockSvc.getPullRequest).toHaveBeenCalledTimes(2);
    });

    it('clearPrDetailCache() clears all detail entries', async () => {
        // Warm the cache
        await fetch(`${baseUrl}/api/repos/${REPO_ID}/pull-requests/42`);
        expect(mockSvc.getPullRequest).toHaveBeenCalledTimes(1);

        // Clear and verify re-fetch
        clearPrDetailCache();
        await fetch(`${baseUrl}/api/repos/${REPO_ID}/pull-requests/42`);
        expect(mockSvc.getPullRequest).toHaveBeenCalledTimes(2);
    });

    it('clearPrDetailCache() also clears threads/commits/reviewers/checks caches', async () => {
        // Warm all sub-endpoint caches
        await fetch(`${baseUrl}/api/repos/${REPO_ID}/pull-requests/42/threads`);
        await fetch(`${baseUrl}/api/repos/${REPO_ID}/pull-requests/42/commits`);
        await fetch(`${baseUrl}/api/repos/${REPO_ID}/pull-requests/42/reviewers`);
        await fetch(`${baseUrl}/api/repos/${REPO_ID}/pull-requests/42/checks`);
        expect(mockSvc.getThreads).toHaveBeenCalledTimes(1);
        expect(mockSvc.getCommits).toHaveBeenCalledTimes(1);
        expect(mockSvc.getReviewers).toHaveBeenCalledTimes(1);
        expect(mockSvc.getChecks).toHaveBeenCalledTimes(1);

        clearPrDetailCache();

        // All sub-endpoint caches must be evicted
        await fetch(`${baseUrl}/api/repos/${REPO_ID}/pull-requests/42/threads`);
        await fetch(`${baseUrl}/api/repos/${REPO_ID}/pull-requests/42/commits`);
        await fetch(`${baseUrl}/api/repos/${REPO_ID}/pull-requests/42/reviewers`);
        await fetch(`${baseUrl}/api/repos/${REPO_ID}/pull-requests/42/checks`);
        expect(mockSvc.getThreads).toHaveBeenCalledTimes(2);
        expect(mockSvc.getCommits).toHaveBeenCalledTimes(2);
        expect(mockSvc.getReviewers).toHaveBeenCalledTimes(2);
        expect(mockSvc.getChecks).toHaveBeenCalledTimes(2);
    });
});

// ── GET /api/repos/:id/pull-requests/review-history ──────────────────────────

describe('GET /api/repos/:id/pull-requests/review-history', () => {
    it('returns empty reviews when no cache exists', async () => {
        const res = await fetch(`${baseUrl}/api/repos/${REPO_ID}/pull-requests/review-history`);
        expect(res.status).toBe(200);
        const body = await res.json() as { reviews: unknown[]; fetchedAt: string | null };
        expect(body.reviews).toEqual([]);
        expect(body.fetchedAt).toBeNull();
    });

    it('returns cached review history from disk', async () => {
        // Write a cache file
        const repoDir = path.join(dataDir, 'repos', REPO_ID);
        fs.mkdirSync(repoDir, { recursive: true });
        const cache = {
            fetchedAt: '2024-06-01T12:00:00.000Z',
            reviews: [{ number: 1, title: 'Test PR', author: { id: 'u1', displayName: 'Alice' }, filesChanged: [], labels: [], reviewedAt: '2024-06-01T10:00:00.000Z', targetBranch: 'main', url: 'https://example.com/pr/1' }],
        };
        fs.writeFileSync(path.join(repoDir, 'pr-review-history.json'), JSON.stringify(cache), 'utf-8');

        const res = await fetch(`${baseUrl}/api/repos/${REPO_ID}/pull-requests/review-history`);
        expect(res.status).toBe(200);
        const body = await res.json() as { reviews: unknown[]; fetchedAt: string };
        expect(body.reviews).toHaveLength(1);
        expect(body.fetchedAt).toBe('2024-06-01T12:00:00.000Z');
    });

    it('returns 404 when repo not found', async () => {
        mockResolveRepo.mockResolvedValueOnce(null);
        const res = await fetch(`${baseUrl}/api/repos/unknown/pull-requests/review-history`);
        expect(res.status).toBe(404);
    });
});

// ── POST /api/repos/:id/pull-requests/review-history/refresh ─────────────────

describe('POST /api/repos/:id/pull-requests/review-history/refresh', () => {
    it('fetches review history and caches to disk', async () => {
        const mockReviews = [
            { number: 10, title: 'PR 10', author: { id: 'u1', displayName: 'Alice' }, filesChanged: ['a.ts'], labels: [], reviewedAt: new Date('2024-01-01'), targetBranch: 'main', url: 'https://example.com/pr/10' },
        ];
        mockSvc.getReviewedPullRequests = vi.fn().mockResolvedValue(mockReviews);

        const res = await fetch(`${baseUrl}/api/repos/${REPO_ID}/pull-requests/review-history/refresh`, { method: 'POST' });
        expect(res.status).toBe(200);
        const body = await res.json() as { reviews: unknown[]; fetchedAt: string };
        expect(body.reviews).toHaveLength(1);
        expect(body.fetchedAt).toBeTruthy();

        // Verify written to disk
        const cached = fs.readFileSync(path.join(dataDir, 'repos', REPO_ID, 'pr-review-history.json'), 'utf-8');
        expect(JSON.parse(cached).reviews).toHaveLength(1);
    });

    it('returns 501 when provider does not support review history', async () => {
        // Ensure getReviewedPullRequests is NOT present
        delete (mockSvc as any).getReviewedPullRequests;

        const res = await fetch(`${baseUrl}/api/repos/${REPO_ID}/pull-requests/review-history/refresh`, { method: 'POST' });
        expect(res.status).toBe(501);
    });

    it('returns an informational empty cache when provider has review history support but no reviews', async () => {
        mockSvc.getReviewedPullRequests = vi.fn().mockResolvedValue([]);

        const res = await fetch(`${baseUrl}/api/repos/${REPO_ID}/pull-requests/review-history/refresh`, { method: 'POST' });

        expect(res.status).toBe(200);
        const body = await res.json() as { reviews: unknown[]; fetchedAt: string };
        expect(body.reviews).toEqual([]);
        expect(body.fetchedAt).toBeTruthy();
        expect(body).not.toHaveProperty('error');
    });

    it('returns 404 when repo not found', async () => {
        mockResolveRepo.mockResolvedValueOnce(null);
        const res = await fetch(`${baseUrl}/api/repos/unknown/pull-requests/review-history/refresh`, { method: 'POST' });
        expect(res.status).toBe(404);
    });

    it('returns 401 when no credentials', async () => {
        (ProviderFactory.createPullRequestsService as ReturnType<typeof vi.fn>).mockResolvedValue(null);
        const res = await fetch(`${baseUrl}/api/repos/${REPO_ID}/pull-requests/review-history/refresh`, { method: 'POST' });
        expect(res.status).toBe(401);
    });
});
