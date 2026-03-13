/**
 * Tests for pr-routes — HTTP handler unit tests using in-process HTTP.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as http from 'http';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { createRouter } from '../src/shared/router';
import { registerPrRoutes } from '../src/repos/pr-routes';
import type { Route } from '../src/types';
import type { IPullRequestsService } from '@plusplusoneplusplus/pipeline-core';
import type { PullRequest, CommentThread, Reviewer } from '@plusplusoneplusplus/pipeline-core';

// ── Mock ProviderFactory and RepoTreeService ─────────────────────────────────

vi.mock('../src/providers/provider-factory', () => ({
    ProviderFactory: {
        detectProviderType: vi.fn().mockReturnValue('github'),
        createPullRequestsService: vi.fn(),
    },
}));

vi.mock('../src/repos/tree-service', () => ({
    RepoTreeService: vi.fn().mockImplementation(() => ({
        resolveRepo: vi.fn(),
    })),
}));

vi.mock('../src/providers/providers-config', () => ({
    readProvidersConfig: vi.fn().mockResolvedValue({ providers: {} }),
}));

import { ProviderFactory } from '../src/providers/provider-factory';
import { RepoTreeService } from '../src/repos/tree-service';

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

// ── Server helpers ────────────────────────────────────────────────────────────

let tmpDir: string;
let dataDir: string;
let server: http.Server;
let baseUrl: string;
let mockSvc: Partial<IPullRequestsService>;

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
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pr-routes-test-'));
    dataDir = path.join(tmpDir, 'data');
    fs.mkdirSync(dataDir, { recursive: true });

    // Default mocks: repo found, service available
    mockSvc = {
        listPullRequests: vi.fn().mockResolvedValue([mockPr]),
        getPullRequest: vi.fn().mockResolvedValue(mockPr),
        getThreads: vi.fn().mockResolvedValue([mockThread]),
        getReviewers: vi.fn().mockResolvedValue([mockReviewer]),
    };

    (RepoTreeService as ReturnType<typeof vi.fn>).mockImplementation(() => ({
        resolveRepo: vi.fn().mockResolvedValue(mockRepoInfo),
    }));
    (ProviderFactory.createPullRequestsService as ReturnType<typeof vi.fn>).mockReturnValue(mockSvc);

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

    it('passes status, top, skip query params to the service', async () => {
        await fetch(`${baseUrl}/api/repos/${REPO_ID}/pull-requests?status=closed&top=10&skip=5`);
        expect(mockSvc.listPullRequests).toHaveBeenCalledWith(REPO_ID, { status: 'closed', top: 10, skip: 5 });
    });

    it('caps top at 100', async () => {
        await fetch(`${baseUrl}/api/repos/${REPO_ID}/pull-requests?top=200`);
        expect(mockSvc.listPullRequests).toHaveBeenCalledWith(REPO_ID, expect.objectContaining({ top: 100 }));
    });

    it('defaults status=open, top=25, skip=0', async () => {
        await fetch(`${baseUrl}/api/repos/${REPO_ID}/pull-requests`);
        expect(mockSvc.listPullRequests).toHaveBeenCalledWith(REPO_ID, { status: 'open', top: 25, skip: 0 });
    });

    it('returns 401 with unconfigured body when no provider config', async () => {
        (ProviderFactory.createPullRequestsService as ReturnType<typeof vi.fn>).mockReturnValue(null);
        (ProviderFactory.detectProviderType as ReturnType<typeof vi.fn>).mockReturnValue('github');

        const res = await fetch(`${baseUrl}/api/repos/${REPO_ID}/pull-requests`);
        expect(res.status).toBe(401);
        const body = await res.json() as { error: string; detected: string; remoteUrl: string };
        expect(body.error).toBe('unconfigured');
        expect(body.detected).toBe('github');
        expect(body.remoteUrl).toBe(REMOTE_URL);
    });

    it('returns 404 when repo not found', async () => {
        (RepoTreeService as ReturnType<typeof vi.fn>).mockImplementation(() => ({
            resolveRepo: vi.fn().mockResolvedValue(null),
        }));
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
        (RepoTreeService as ReturnType<typeof vi.fn>).mockImplementation(() => ({
            resolveRepo: vi.fn().mockResolvedValue(null),
        }));
        const res = await fetch(`${baseUrl}/api/repos/unknown/pull-requests/42`);
        expect(res.status).toBe(404);
    });

    it('returns 404 when PR not found', async () => {
        (mockSvc.getPullRequest as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('PR 999 not found'));
        const res = await fetch(`${baseUrl}/api/repos/${REPO_ID}/pull-requests/999`);
        expect(res.status).toBe(404);
    });

    it('returns 401 when unconfigured', async () => {
        (ProviderFactory.createPullRequestsService as ReturnType<typeof vi.fn>).mockReturnValue(null);
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
        (RepoTreeService as ReturnType<typeof vi.fn>).mockImplementation(() => ({
            resolveRepo: vi.fn().mockResolvedValue(null),
        }));
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
        (RepoTreeService as ReturnType<typeof vi.fn>).mockImplementation(() => ({
            resolveRepo: vi.fn().mockResolvedValue(null),
        }));
        const res = await fetch(`${baseUrl}/api/repos/unknown/pull-requests/42/reviewers`);
        expect(res.status).toBe(404);
    });

    it('returns 500 on unexpected error', async () => {
        (mockSvc.getReviewers as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('network'));
        const res = await fetch(`${baseUrl}/api/repos/${REPO_ID}/pull-requests/42/reviewers`);
        expect(res.status).toBe(500);
    });
});
