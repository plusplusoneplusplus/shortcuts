/**
 * Tests for pr-routes — HTTP handler unit tests using in-process HTTP.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as http from 'http';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { createRouter } from '../../src/server/shared/router';
import { registerPrRoutes, clearPrListCache } from '../../src/server/repos/pr-routes';
import type { Route } from '../../src/server/types';
import { AdoAuthError } from '@plusplusoneplusplus/forge';
import type { IPullRequestsService } from '@plusplusoneplusplus/forge';
import type { PullRequest, CommentThread, Reviewer } from '@plusplusoneplusplus/forge';
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

const mockPr: PullRequest = {
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

function makeServer(dir: string): http.Server {
    const routes: Route[] = [];
    registerPrRoutes(routes, dir);
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

beforeEach(async () => {
    clearPrListCache();
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
        const body = await res.json() as { pullRequests: unknown[]; total: number };
        expect(Array.isArray(body.pullRequests)).toBe(true);
        expect(body.pullRequests).toHaveLength(1);
        expect(body.total).toBe(1);
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

    it('force-refreshes credentials once and returns PRs when an ADO auth error recovers', async () => {
        const refreshedPr = { ...mockPr, id: 43, number: 43, title: 'Recovered PR' };
        const refreshedSvc = {
            ...mockSvc,
            listPullRequests: vi.fn().mockResolvedValue([refreshedPr]),
        };
        (mockSvc.listPullRequests as ReturnType<typeof vi.fn>).mockRejectedValue(
            new AdoAuthError('Failed to get Git API client', new Error('HTTP 401 Unauthorized')),
        );
        (ProviderFactory.createPullRequestsService as ReturnType<typeof vi.fn>)
            .mockResolvedValueOnce(mockSvc)
            .mockResolvedValueOnce(refreshedSvc);

        const res = await fetch(`${baseUrl}/api/repos/${REPO_ID}/pull-requests`);

        expect(res.status).toBe(200);
        const body = await res.json() as { pullRequests: Array<{ title: string }> };
        expect(body.pullRequests[0].title).toBe('Recovered PR');
        expect(ProviderFactory.createPullRequestsService).toHaveBeenNthCalledWith(2, REMOTE_URL, { providers: {} }, {
            forceRefresh: true,
            dataDir,
        });
    });

    it('returns ado-auth-expired when retrying after an ADO auth error also fails auth', async () => {
        const refreshedSvc = {
            ...mockSvc,
            listPullRequests: vi.fn().mockRejectedValue(new Error('403 Forbidden')),
        };
        (mockSvc.listPullRequests as ReturnType<typeof vi.fn>).mockRejectedValue(
            new Error('outer failure', { cause: new AdoAuthError('HTTP 401 Unauthorized') }),
        );
        (ProviderFactory.createPullRequestsService as ReturnType<typeof vi.fn>)
            .mockResolvedValueOnce(mockSvc)
            .mockResolvedValueOnce(refreshedSvc);

        const res = await fetch(`${baseUrl}/api/repos/${REPO_ID}/pull-requests`);

        expect(res.status).toBe(401);
        const body = await res.json() as { error: string; message: string };
        expect(body.error).toBe('ado-auth-expired');
        expect(body.message).toContain('az login');
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
