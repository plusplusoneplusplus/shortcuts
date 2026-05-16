import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Readable } from 'node:stream';
import { AdoPullRequestsService, AdoPullRequestError, AdoPullRequestNotFoundError, GitVersionType } from '../../src/ado/pull-requests-service';
import type { WebApi } from 'azure-devops-node-api';
import { setLogger, nullLogger } from '../../src/logger';
import type { Logger } from '../../src/logger';

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
        getPullRequestCommits: vi.fn().mockResolvedValue([]),
        getPullRequestIterations: vi.fn().mockResolvedValue([]),
        getPullRequestIterationChanges: vi.fn().mockResolvedValue({ changeEntries: [] }),
        getPullRequestCommits: vi.fn().mockResolvedValue([]),
        getItemText: vi.fn().mockResolvedValue(null),
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
    let mockLogger: Logger;

    beforeEach(() => {
        gitApi = makeMockGitApi();
        connection = makeMockConnection(gitApi);
        service = new AdoPullRequestsService(connection);
        mockLogger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
        setLogger(mockLogger);
    });

    afterEach(() => {
        setLogger(nullLogger);
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

    // ── getPullRequestCommits ───────────────────────────────

    it('getPullRequestCommits delegates to gitApi.getPullRequestCommits and returns array', async () => {
        const commits = [{ commitId: 'abc123', comment: 'Fix bug' }];
        gitApi.getPullRequestCommits.mockResolvedValue(commits);

        const result = await service.getPullRequestCommits('repo-id', 42, 'proj');

        expect(gitApi.getPullRequestCommits).toHaveBeenCalledWith('repo-id', 42, 'proj');
        expect(result).toEqual(commits);
    });

    it('getPullRequestCommits returns [] when API returns undefined', async () => {
        gitApi.getPullRequestCommits.mockResolvedValue(undefined);

        const result = await service.getPullRequestCommits('repo-id', 42);

        expect(result).toEqual([]);
    });

    it('getPullRequestCommits throws AdoPullRequestError when the API rejects', async () => {
        gitApi.getPullRequestCommits.mockRejectedValue(new Error('timeout'));

        await expect(service.getPullRequestCommits('repo-id', 42)).rejects.toThrow(AdoPullRequestError);
        await expect(service.getPullRequestCommits('repo-id', 42)).rejects.toThrow('Failed to get commits for PR 42');
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

    // ── logging ──────────────────────────────────────────────

    it('logs info before and after listPullRequests', async () => {
        const prs = [{ pullRequestId: 1 }];
        gitApi.getPullRequests.mockResolvedValue(prs);

        await service.listPullRequests('repo-id', { status: 1 }, 'proj', 10, 5);

        const infoCalls = (mockLogger.info as ReturnType<typeof vi.fn>).mock.calls.map((c: unknown[]) => c[1] as string);
        expect(infoCalls.some(m => m.includes('listPullRequests') && m.includes('repo-id') && m.includes('proj'))).toBe(true);
        expect(infoCalls.some(m => m.includes('listPullRequests') && m.includes('1 PR'))).toBe(true);
    });

    it('logs error when listPullRequests throws', async () => {
        gitApi.getPullRequests.mockRejectedValue(new Error('timeout'));

        await expect(service.listPullRequests('repo-id', {})).rejects.toThrow(AdoPullRequestError);

        const errorCalls = (mockLogger.error as ReturnType<typeof vi.fn>).mock.calls.map((c: unknown[]) => c[1] as string);
        expect(errorCalls.some(m => m.includes('listPullRequests failed') && m.includes('repo-id') && m.includes('timeout'))).toBe(true);
    });

    it('logs warn when getPullRequestById returns not found', async () => {
        gitApi.getPullRequestById.mockResolvedValue(undefined);

        await expect(service.getPullRequestById(99)).rejects.toThrow(AdoPullRequestNotFoundError);

        const warnCalls = (mockLogger.warn as ReturnType<typeof vi.fn>).mock.calls.map((c: unknown[]) => c[1] as string);
        expect(warnCalls.some(m => m.includes('99') && m.includes('not found'))).toBe(true);
    });

    it('logs info when getGitApi initializes successfully', async () => {
        await service.listPullRequests('repo-id', {});

        const infoCalls = (mockLogger.info as ReturnType<typeof vi.fn>).mock.calls.map((c: unknown[]) => c[1] as string);
        expect(infoCalls.some(m => m.includes('Git API client initialized'))).toBe(true);
    });

    // ── getPullRequestIterations ────────────────────────────

    it('getPullRequestIterations delegates with correct arguments and returns the array', async () => {
        gitApi.getPullRequestIterations.mockResolvedValue([{ id: 1 }, { id: 2 }]);

        const result = await service.getPullRequestIterations('repo-1', 42, 'proj');

        expect(gitApi.getPullRequestIterations).toHaveBeenCalledOnce();
        expect(gitApi.getPullRequestIterations).toHaveBeenCalledWith('repo-1', 42, 'proj', false);
        expect(result).toEqual([{ id: 1 }, { id: 2 }]);
    });

    it('getPullRequestIterations returns [] when the API resolves with undefined', async () => {
        gitApi.getPullRequestIterations.mockResolvedValue(undefined);
        const result = await service.getPullRequestIterations('repo-1', 42);
        expect(result).toEqual([]);
    });

    it('getPullRequestIterations throws AdoPullRequestError when the API rejects', async () => {
        gitApi.getPullRequestIterations.mockRejectedValue(new Error('network error'));

        await expect(service.getPullRequestIterations('repo-1', 42)).rejects.toThrow(AdoPullRequestError);
        await expect(service.getPullRequestIterations('repo-1', 42)).rejects.toThrow('Failed to get iterations for PR 42');
    });

    // ── getPullRequestIterationChanges ───────────────────────

    it('getPullRequestIterationChanges delegates with correct arguments and returns the changes object', async () => {
        gitApi.getPullRequestIterationChanges.mockResolvedValue({ changeEntries: [{ changeTrackingId: 1 }] });

        const result = await service.getPullRequestIterationChanges('repo-1', 42, 3, 'proj');

        expect(gitApi.getPullRequestIterationChanges).toHaveBeenCalledOnce();
        expect(gitApi.getPullRequestIterationChanges).toHaveBeenCalledWith('repo-1', 42, 3, 'proj');
        expect(result).toEqual({ changeEntries: [{ changeTrackingId: 1 }] });
    });

    it('getPullRequestIterationChanges returns { changeEntries: [] } when the API resolves with undefined', async () => {
        gitApi.getPullRequestIterationChanges.mockResolvedValue(undefined);
        const result = await service.getPullRequestIterationChanges('repo-1', 42, 3);
        expect(result).toEqual({ changeEntries: [] });
    });

    it('getPullRequestIterationChanges throws AdoPullRequestError when the API rejects', async () => {
        gitApi.getPullRequestIterationChanges.mockRejectedValue(new Error('timeout'));

        await expect(service.getPullRequestIterationChanges('repo-1', 42, 3)).rejects.toThrow(AdoPullRequestError);
        await expect(service.getPullRequestIterationChanges('repo-1', 42, 3)).rejects.toThrow('Failed to get iteration changes for PR 42, iteration 3');
    });

    // ── getPullRequestCommits ────────────────────────────────

    it('getPullRequestCommits delegates to gitApi.getPullRequestCommits and returns the array', async () => {
        const commits = [{ commitId: 'sha-1', comment: 'fix: thing' }, { commitId: 'sha-2', comment: 'docs: tweak' }];
        gitApi.getPullRequestCommits.mockResolvedValue(commits);

        const result = await service.getPullRequestCommits('repo-1', 42, 'proj');

        expect(gitApi.getPullRequestCommits).toHaveBeenCalledOnce();
        expect(gitApi.getPullRequestCommits).toHaveBeenCalledWith('repo-1', 42, 'proj');
        expect(result).toEqual(commits);
    });

    it('getPullRequestCommits returns [] when the API resolves with undefined', async () => {
        gitApi.getPullRequestCommits.mockResolvedValue(undefined);
        const result = await service.getPullRequestCommits('repo-1', 42);
        expect(result).toEqual([]);
    });

    it('getPullRequestCommits throws AdoPullRequestError when the API rejects', async () => {
        gitApi.getPullRequestCommits.mockRejectedValue(new Error('network down'));

        await expect(service.getPullRequestCommits('repo-1', 42)).rejects.toThrow(AdoPullRequestError);
        await expect(service.getPullRequestCommits('repo-1', 42)).rejects.toThrow('Failed to get commits for PR 42');
    });

    // ── getFileContent ───────────────────────────────────────

    it('getFileContent reads stream chunks and returns them joined as a string', async () => {
        const stream = Readable.from(['hello', ' ', 'world']);
        gitApi.getItemText.mockResolvedValue(stream);

        const result = await service.getFileContent('repo-1', '/src/foo.ts', 'abc123', 'proj');

        expect(gitApi.getItemText).toHaveBeenCalledOnce();
        expect(gitApi.getItemText).toHaveBeenCalledWith(
            'repo-1', '/src/foo.ts', 'proj',
            undefined, undefined, false, false, false,
            { version: 'abc123', versionType: GitVersionType.Commit },
        );
        expect(result).toBe('hello world');
    });

    it('getFileContent returns empty string when the API resolves with null', async () => {
        gitApi.getItemText.mockResolvedValue(null);
        const result = await service.getFileContent('repo-1', '/src/foo.ts', 'abc123');
        expect(result).toBe('');
    });

    it('getFileContent returns empty string and does not throw when the API rejects', async () => {
        gitApi.getItemText.mockRejectedValue(new Error('TF401174: File not found'));
        const result = await service.getFileContent('repo-1', '/src/new-file.ts', 'abc123');
        expect(result).toBe('');
    });

    it('getFileContent passes versionDescriptor with GitVersionType.Commit (value 2)', async () => {
        const stream = Readable.from([]);
        gitApi.getItemText.mockResolvedValue(stream);

        await service.getFileContent('repo-1', '/src/foo.ts', 'deadbeef');

        const versionDescriptor = gitApi.getItemText.mock.calls[0][8];
        expect(versionDescriptor).toEqual({ version: 'deadbeef', versionType: 2 });
    });

    it('logs error when getGitApi fails', async () => {
        const failConn = { getGitApi: vi.fn().mockRejectedValue(new Error('auth error')) } as unknown as WebApi;
        const failService = new AdoPullRequestsService(failConn);

        await expect(failService.listPullRequests('repo-id', {})).rejects.toThrow();

        const errorCalls = (mockLogger.error as ReturnType<typeof vi.fn>).mock.calls.map((c: unknown[]) => c[1] as string);
        expect(errorCalls.some(m => m.includes('Git API client') && m.includes('auth error'))).toBe(true);
    });
});
