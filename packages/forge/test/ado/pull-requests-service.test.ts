import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AdoPullRequestsService, AdoPullRequestError, AdoPullRequestNotFoundError } from '../../src/ado/pull-requests-service';
import type { WebApi } from 'azure-devops-node-api';

function makeMockGitApi(overrides: Record<string, unknown> = {}) {
    return {
        getPullRequests: vi.fn().mockResolvedValue([]),
        getPullRequestById: vi.fn().mockResolvedValue({ pullRequestId: 1 }),
        createPullRequest: vi.fn().mockResolvedValue({ pullRequestId: 2 }),
        updatePullRequest: vi.fn().mockResolvedValue({ pullRequestId: 1 }),
        createThread: vi.fn().mockResolvedValue({ id: 10 }),
        getThreads: vi.fn().mockResolvedValue([]),
        createPullRequestReviewers: vi.fn().mockResolvedValue([]),
        getPullRequestReviewers: vi.fn().mockResolvedValue([]),
        ...overrides,
    };
}

function makeMockConnection(gitApi: unknown) {
    return { getGitApi: vi.fn().mockResolvedValue(gitApi) } as unknown as WebApi;
}

describe('AdoPullRequestsService', () => {
    let gitApi: ReturnType<typeof makeMockGitApi>;
    let connection: ReturnType<typeof makeMockConnection>;
    let service: AdoPullRequestsService;

    beforeEach(() => {
        gitApi = makeMockGitApi();
        connection = makeMockConnection(gitApi);
        service = new AdoPullRequestsService(connection);
    });

    // ── listPullRequests ─────────────────────────────────────

    it('listPullRequests delegates to gitApi.getPullRequests with correct args', async () => {
        const criteria = { status: 1 };
        const prs = [{ pullRequestId: 1 }, { pullRequestId: 2 }];
        gitApi.getPullRequests.mockResolvedValue(prs);

        const result = await service.listPullRequests('repo-id', criteria, 'my-project');

        expect(gitApi.getPullRequests).toHaveBeenCalledWith('repo-id', criteria, 'my-project', undefined, undefined, undefined);
        expect(result).toEqual(prs);
    });

    it('listPullRequests returns empty array when API returns undefined', async () => {
        gitApi.getPullRequests.mockResolvedValue(undefined);
        const result = await service.listPullRequests('repo-id', {});
        expect(result).toEqual([]);
    });

    it('listPullRequests passes top and skip positionally', async () => {
        await service.listPullRequests('repo-id', {}, undefined, 10, 5);
        expect(gitApi.getPullRequests).toHaveBeenCalledWith('repo-id', {}, undefined, undefined, 5, 10);
    });

    // ── getPullRequestById ───────────────────────────────────

    it('getPullRequestById returns GitPullRequest from gitApi', async () => {
        const pr = { pullRequestId: 42, title: 'Test PR' };
        gitApi.getPullRequestById.mockResolvedValue(pr);

        const result = await service.getPullRequestById(42, 'my-project');

        expect(gitApi.getPullRequestById).toHaveBeenCalledWith(42, 'my-project');
        expect(result).toEqual(pr);
    });

    it('getPullRequestById throws AdoPullRequestNotFoundError when not found', async () => {
        gitApi.getPullRequestById.mockResolvedValue(undefined);
        await expect(service.getPullRequestById(99)).rejects.toThrow(AdoPullRequestNotFoundError);
        await expect(service.getPullRequestById(99)).rejects.toThrow('ADO pull request #99 not found');
    });

    // ── createPullRequest ────────────────────────────────────

    it('createPullRequest assembles payload and delegates to gitApi', async () => {
        const created = { pullRequestId: 3, title: 'New PR' };
        gitApi.createPullRequest.mockResolvedValue(created);

        const input = {
            title: 'New PR',
            description: 'Description',
            sourceRefName: 'refs/heads/feature',
            targetRefName: 'refs/heads/main',
            reviewers: [{ id: 'user-1' }],
        };

        const result = await service.createPullRequest('repo-id', input, 'proj');

        expect(gitApi.createPullRequest).toHaveBeenCalledWith(
            {
                title: 'New PR',
                description: 'Description',
                sourceRefName: 'refs/heads/feature',
                targetRefName: 'refs/heads/main',
                reviewers: [{ id: 'user-1' }],
            },
            'repo-id',
            'proj',
        );
        expect(result).toEqual(created);
    });

    // ── updatePullRequest ────────────────────────────────────

    it('updatePullRequest delegates with correct pullRequestId', async () => {
        const updated = { pullRequestId: 1, title: 'Updated' };
        gitApi.updatePullRequest.mockResolvedValue(updated);

        const result = await service.updatePullRequest('repo-id', 1, { title: 'Updated' }, 'proj');

        expect(gitApi.updatePullRequest).toHaveBeenCalledWith({ title: 'Updated' }, 'repo-id', 1, 'proj');
        expect(result).toEqual(updated);
    });

    // ── createThread ─────────────────────────────────────────

    it('createThread delegates to gitApi.createThread', async () => {
        const thread = { id: 20, comments: [] };
        gitApi.createThread.mockResolvedValue(thread);

        const input = { comments: [{ content: 'LGTM' }] };
        const result = await service.createThread('repo-id', 1, input as any, 'proj');

        expect(gitApi.createThread).toHaveBeenCalledWith(input, 'repo-id', 1, 'proj');
        expect(result).toEqual(thread);
    });

    // ── getThreads ───────────────────────────────────────────

    it('getThreads delegates to gitApi.getThreads and returns array', async () => {
        const threads = [{ id: 1 }, { id: 2 }];
        gitApi.getThreads.mockResolvedValue(threads);

        const result = await service.getThreads('repo-id', 1, 'proj');

        expect(gitApi.getThreads).toHaveBeenCalledWith('repo-id', 1, 'proj');
        expect(result).toEqual(threads);
    });

    // ── addReviewers ─────────────────────────────────────────

    it('addReviewers delegates to gitApi.createPullRequestReviewers', async () => {
        const reviewerResults = [{ id: 'user-1', vote: 0 }];
        gitApi.createPullRequestReviewers.mockResolvedValue(reviewerResults);

        const reviewers = [{ id: 'user-1' }];
        const result = await service.addReviewers('repo-id', 1, reviewers as any, 'proj');

        expect(gitApi.createPullRequestReviewers).toHaveBeenCalledWith(reviewers, 'repo-id', 1, 'proj');
        expect(result).toEqual(reviewerResults);
    });

    // ── getReviewers ─────────────────────────────────────────

    it('getReviewers delegates to gitApi.getPullRequestReviewers', async () => {
        const reviewers = [{ id: 'user-1', vote: 10 }];
        gitApi.getPullRequestReviewers.mockResolvedValue(reviewers);

        const result = await service.getReviewers('repo-id', 1, 'proj');

        expect(gitApi.getPullRequestReviewers).toHaveBeenCalledWith('repo-id', 1, 'proj');
        expect(result).toEqual(reviewers);
    });

    // ── getGitApi caching ────────────────────────────────────

    it('caches IGitApi instance — connection.getGitApi called once across multiple method calls', async () => {
        await service.listPullRequests('repo-id', {});
        await service.getThreads('repo-id', 1);

        expect(connection.getGitApi).toHaveBeenCalledTimes(1);
    });

    // ── getGitApi failure ────────────────────────────────────

    it('wraps getGitApi rejection with AdoPullRequestError', async () => {
        const failConn = { getGitApi: vi.fn().mockRejectedValue(new Error('network down')) } as unknown as WebApi;
        const failService = new AdoPullRequestsService(failConn);

        await expect(failService.listPullRequests('repo-id', {})).rejects.toThrow(AdoPullRequestError);
        await expect(failService.listPullRequests('repo-id', {})).rejects.toThrow('Failed to get Git API client');
    });
});
