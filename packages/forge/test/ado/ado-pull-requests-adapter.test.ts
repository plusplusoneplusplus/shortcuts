import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { AdoPullRequestsAdapter } from '../../src/ado/ado-pull-requests-adapter';
import type { AdoPullRequestsService } from '../../src/ado/pull-requests-service';
import { VersionControlChangeType } from '../../src/ado/pull-requests-service';
import type { PullRequest, CommentThread, Reviewer } from '../../src/providers/types';
import { setLogger, nullLogger } from '../../src/logger';
import type { Logger } from '../../src/logger';

// ── fixtures ─────────────────────────────────────────────────

const mockAdoPr = {
    pullRequestId: 42,
    title: 'Fix bug',
    description: 'Fixes a nasty bug',
    createdBy: { id: 'user-1', displayName: 'Alice', uniqueName: 'alice@example.com', imageUrl: 'https://avatar.example.com/alice' },
    sourceRefName: 'refs/heads/feature/fix',
    targetRefName: 'refs/heads/main',
    status: 1, // Active
    isDraft: false,
    creationDate: new Date('2024-01-01T00:00:00Z'),
    url: 'https://dev.azure.com/org/proj/_git/repo/pullrequest/42',
    reviewers: [
        { id: 'user-2', displayName: 'Bob', uniqueName: 'bob@example.com', vote: 10, isRequired: true },
    ],
    labels: [{ name: 'bug' }],
};

const mockAdoThread = {
    id: 1,
    comments: [
        {
            id: 10,
            author: { id: 'user-1', displayName: 'Alice', uniqueName: 'alice@example.com' },
            content: 'LGTM',
            publishedDate: new Date('2024-01-02T00:00:00Z'),
            lastUpdatedDate: new Date('2024-01-03T00:00:00Z'),
            _links: { self: { href: 'https://comment.url' } },
        },
    ],
    status: 1, // active
    publishedDate: new Date('2024-01-02T00:00:00Z'),
    threadContext: {
        filePath: '/src/foo.ts',
        rightFileStart: { line: 8, offset: 1 },
        rightFileEnd: { line: 9, offset: 4 },
    },
};

const mockAdoReviewer = {
    id: 'user-2',
    displayName: 'Bob',
    uniqueName: 'bob@example.com',
    vote: 10,
    isRequired: true,
};

const mockAdoCommit = {
    commitId: 'abcdef1234567890',
    comment: 'Fix bug\n\nDetailed body',
    author: { name: 'Alice', email: 'alice@example.com', date: new Date('2024-01-04T00:00:00Z') },
    committer: { name: 'CI', email: 'ci@example.com', date: new Date('2024-01-04T01:00:00Z') },
    remoteUrl: 'https://dev.azure.com/org/proj/_git/repo/commit/abcdef1234567890',
};

function makeMockService(overrides: Partial<Record<string, ReturnType<typeof vi.fn>>> = {}): AdoPullRequestsService {
    return {
        listPullRequests: vi.fn().mockResolvedValue([mockAdoPr]),
        getPullRequestById: vi.fn().mockResolvedValue(mockAdoPr),
        createPullRequest: vi.fn().mockResolvedValue(mockAdoPr),
        updatePullRequest: vi.fn().mockResolvedValue(mockAdoPr),
        getThreads: vi.fn().mockResolvedValue([mockAdoThread]),
        createThread: vi.fn().mockResolvedValue(mockAdoThread),
        getReviewers: vi.fn().mockResolvedValue([mockAdoReviewer]),
        addReviewers: vi.fn().mockResolvedValue([mockAdoReviewer]),
        getPullRequestCommits: vi.fn().mockResolvedValue([mockAdoCommit]),
        getPullRequestIterations: vi.fn().mockResolvedValue([]),
        getPullRequestIterationChanges: vi.fn().mockResolvedValue({ changeEntries: [] }),
        getFileContent: vi.fn().mockResolvedValue(''),
        ...overrides,
    } as unknown as AdoPullRequestsService;
}

// ── tests ─────────────────────────────────────────────────────

describe('AdoPullRequestsAdapter', () => {
    let service: AdoPullRequestsService;
    let adapter: AdoPullRequestsAdapter;
    let mockLogger: Logger;

    beforeEach(() => {
        service = makeMockService();
        adapter = new AdoPullRequestsAdapter(service, 'my-project');
        mockLogger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
        setLogger(mockLogger);
    });

    afterEach(() => {
        setLogger(nullLogger);
    });

    // ── listPullRequests ─────────────────────────────────────

    describe('listPullRequests', () => {
        it('maps ADO PR to canonical PullRequest', async () => {
            const results = await adapter.listPullRequests('repo-id');
            expect(results).toHaveLength(1);
            const pr: PullRequest = results[0];
            expect(pr.id).toBe(42);
            expect(pr.number).toBe(42);
            expect(pr.title).toBe('Fix bug');
            expect(pr.description).toBe('Fixes a nasty bug');
            expect(pr.author.id).toBe('user-1');
            expect(pr.author.displayName).toBe('Alice');
            expect(pr.author.email).toBe('alice@example.com');
            expect(pr.sourceBranch).toBe('feature/fix');
            expect(pr.targetBranch).toBe('main');
            expect(pr.status).toBe('open');
            expect(pr.isDraft).toBe(false);
            expect(pr.labels).toEqual(['bug']);
            expect(pr.raw).toBe(mockAdoPr);
        });

        it('maps reviewers correctly', async () => {
            const results = await adapter.listPullRequests('repo-id');
            const reviewer: Reviewer = results[0].reviewers[0];
            expect(reviewer.identity.id).toBe('user-2');
            expect(reviewer.vote).toBe('approved');
            expect(reviewer.isRequired).toBe(true);
        });

        it('passes criteria to service', async () => {
            await adapter.listPullRequests('repo-id', { sourceBranch: 'feature/fix', targetBranch: 'main', top: 5, skip: 10 });
            expect(service.listPullRequests).toHaveBeenCalledWith(
                'repo-id',
                { sourceRefName: 'refs/heads/feature/fix', targetRefName: 'refs/heads/main', status: 1 },
                'my-project',
                5,
                10,
            );
        });

        it('defaults to active status when no status is specified', async () => {
            await adapter.listPullRequests('repo-id');
            expect(service.listPullRequests).toHaveBeenCalledWith(
                'repo-id',
                { status: 1 },
                'my-project',
                undefined,
                undefined,
            );
        });

        it.each([
            ['open', 1],      // PullRequestStatus.Active
            ['merged', 3],    // PullRequestStatus.Completed
            ['closed', 2],    // PullRequestStatus.Abandoned
            ['all', 4],       // PullRequestStatus.All
        ])('maps criteria.status="%s" to ADO status %d', async (status, adoStatus) => {
            await adapter.listPullRequests('repo-id', { status });
            expect(service.listPullRequests).toHaveBeenCalledWith(
                'repo-id',
                { status: adoStatus },
                'my-project',
                undefined,
                undefined,
            );
        });

        it('defaults to active status for unrecognized status values', async () => {
            await adapter.listPullRequests('repo-id', { status: 'unknown-value' });
            expect(service.listPullRequests).toHaveBeenCalledWith(
                'repo-id',
                { status: 1 },
                'my-project',
                undefined,
                undefined,
            );
        });
    });

    // ── currentUserId / author filtering ─────────────────────

    describe('currentUserId filtering', () => {
        it('filters by currentUserId when no authorId in criteria', async () => {
            const svc = makeMockService();
            const a = new AdoPullRequestsAdapter(svc, 'my-project', undefined, 'current-user-guid');
            await a.listPullRequests('repo-id');
            expect(svc.listPullRequests).toHaveBeenCalledWith(
                'repo-id',
                { status: 1, creatorId: 'current-user-guid' },
                'my-project',
                undefined,
                undefined,
            );
        });

        it('uses explicit authorId over currentUserId', async () => {
            const svc = makeMockService();
            const a = new AdoPullRequestsAdapter(svc, 'my-project', undefined, 'current-user-guid');
            await a.listPullRequests('repo-id', { authorId: 'other-user-guid' });
            expect(svc.listPullRequests).toHaveBeenCalledWith(
                'repo-id',
                { status: 1, creatorId: 'other-user-guid' },
                'my-project',
                undefined,
                undefined,
            );
        });

        it('does not set creatorId when neither authorId nor currentUserId is provided', async () => {
            const svc = makeMockService();
            const a = new AdoPullRequestsAdapter(svc, 'my-project');
            await a.listPullRequests('repo-id');
            expect(svc.listPullRequests).toHaveBeenCalledWith(
                'repo-id',
                { status: 1 },
                'my-project',
                undefined,
                undefined,
            );
        });

        it('combines currentUserId with status and branch criteria', async () => {
            const svc = makeMockService();
            const a = new AdoPullRequestsAdapter(svc, 'my-project', undefined, 'current-user-guid');
            await a.listPullRequests('repo-id', { status: 'all', targetBranch: 'main' });
            expect(svc.listPullRequests).toHaveBeenCalledWith(
                'repo-id',
                { targetRefName: 'refs/heads/main', status: 4, creatorId: 'current-user-guid' },
                'my-project',
                undefined,
                undefined,
            );
        });

        it('scope=all skips currentUserId even when provided', async () => {
            const svc = makeMockService();
            const a = new AdoPullRequestsAdapter(svc, 'my-project', undefined, 'current-user-guid');
            await a.listPullRequests('repo-id', { scope: 'all' });
            expect(svc.listPullRequests).toHaveBeenCalledWith(
                'repo-id',
                { status: 1 },
                'my-project',
                undefined,
                undefined,
            );
        });

        it('scope=mine uses currentUserId (explicit)', async () => {
            const svc = makeMockService();
            const a = new AdoPullRequestsAdapter(svc, 'my-project', undefined, 'current-user-guid');
            await a.listPullRequests('repo-id', { scope: 'mine' });
            expect(svc.listPullRequests).toHaveBeenCalledWith(
                'repo-id',
                { status: 1, creatorId: 'current-user-guid' },
                'my-project',
                undefined,
                undefined,
            );
        });

        it('scope=all still allows explicit authorId', async () => {
            const svc = makeMockService();
            const a = new AdoPullRequestsAdapter(svc, 'my-project', undefined, 'current-user-guid');
            await a.listPullRequests('repo-id', { scope: 'all', authorId: 'specific-user' });
            expect(svc.listPullRequests).toHaveBeenCalledWith(
                'repo-id',
                { status: 1, creatorId: 'specific-user' },
                'my-project',
                undefined,
                undefined,
            );
        });
    });

    // ── getPullRequest ───────────────────────────────────────

    describe('getPullRequest', () => {
        it('returns canonical PullRequest from getPullRequestById', async () => {
            const pr = await adapter.getPullRequest('repo-id', 42);
            expect(pr.id).toBe(42);
            expect(service.getPullRequestById).toHaveBeenCalledWith(42, 'my-project');
        });
    });

    // ── createPullRequest ────────────────────────────────────

    describe('createPullRequest', () => {
        it('passes correct payload to service.createPullRequest', async () => {
            const input = {
                title: 'New PR',
                description: 'desc',
                sourceBranch: 'feature',
                targetBranch: 'main',
                reviewerIds: ['user-3'],
            };
            await adapter.createPullRequest('repo-id', input);
            expect(service.createPullRequest).toHaveBeenCalledWith(
                'repo-id',
                {
                    title: 'New PR',
                    description: 'desc',
                    sourceRefName: 'refs/heads/feature',
                    targetRefName: 'refs/heads/main',
                    reviewers: [{ id: 'user-3' }],
                },
                'my-project',
            );
        });
    });

    // ── updatePullRequest ────────────────────────────────────

    describe('updatePullRequest', () => {
        it('passes title and description updates', async () => {
            await adapter.updatePullRequest('repo-id', 42, { title: 'Updated', description: 'New desc' });
            expect(service.updatePullRequest).toHaveBeenCalledWith(
                'repo-id',
                42,
                { title: 'Updated', description: 'New desc' },
                'my-project',
            );
        });
    });

    // ── getThreads ───────────────────────────────────────────

    describe('getThreads', () => {
        it('maps ADO threads to canonical CommentThread', async () => {
            const threads = await adapter.getThreads('repo-id', 42);
            expect(threads).toHaveLength(1);
            const thread: CommentThread = threads[0];
            expect(thread.id).toBe(1);
            expect(thread.status).toBe('active');
            expect(thread.comments).toHaveLength(1);
            const comment = thread.comments[0];
            expect(comment.id).toBe(10);
            expect(comment.body).toBe('LGTM');
            expect(comment.author.email).toBe('alice@example.com');
            expect(thread.threadContext).toEqual({
                filePath: '/src/foo.ts',
                line: 9,
                startLine: 8,
                endLine: 9,
                side: 'right',
            });
        });
    });

    // ── createThread ─────────────────────────────────────────

    describe('createThread', () => {
        it('creates thread with comment body', async () => {
            const thread = await adapter.createThread('repo-id', 42, 'Hello');
            expect(service.createThread).toHaveBeenCalledWith(
                'repo-id',
                42,
                { comments: [{ content: 'Hello', commentType: 1 }] },
                'my-project',
            );
            expect(thread.id).toBe(1);
        });
    });

    // ── getReviewers ─────────────────────────────────────────

    describe('getReviewers', () => {
        it('maps ADO reviewers to canonical Reviewer', async () => {
            const reviewers = await adapter.getReviewers('repo-id', 42);
            expect(reviewers).toHaveLength(1);
            expect(reviewers[0].identity.id).toBe('user-2');
            expect(reviewers[0].vote).toBe('approved');
        });
    });

    // ── getCommits ──────────────────────────────────────────

    describe('getCommits', () => {
        it('maps ADO PR commits to canonical commits', async () => {
            const commits = await adapter.getCommits('repo-id', 42);
            expect(service.getPullRequestCommits).toHaveBeenCalledWith('repo-id', 42, 'my-project');
            expect(commits).toHaveLength(1);
            expect(commits[0]).toMatchObject({
                sha: 'abcdef1234567890',
                shortSha: 'abcdef1',
                title: 'Fix bug',
                message: 'Fix bug\n\nDetailed body',
                author: { displayName: 'Alice', email: 'alice@example.com' },
                url: 'https://dev.azure.com/org/proj/_git/repo/commit/abcdef1234567890',
            });
            expect(commits[0].authoredAt).toEqual(new Date('2024-01-04T00:00:00Z'));
            expect(commits[0].committedAt).toEqual(new Date('2024-01-04T01:00:00Z'));
        });
    });

    // ── addReviewers ─────────────────────────────────────────

    describe('addReviewers', () => {
        it('maps reviewer IDs to objects and returns canonical Reviewer', async () => {
            await adapter.addReviewers('repo-id', 42, ['user-3', 'user-4']);
            expect(service.addReviewers).toHaveBeenCalledWith(
                'repo-id',
                42,
                [{ id: 'user-3' }, { id: 'user-4' }],
                'my-project',
            );
        });
    });

    // ── getDiff ──────────────────────────────────────────────

    describe('getDiff', () => {
        const validIteration = {
            id: 1,
            sourceRefCommit: { commitId: 'head-sha-abc' },
            commonRefCommit: { commitId: 'base-sha-xyz' },
        };

        it('returns unified diff for an edited file', async () => {
            const svc = makeMockService({
                getPullRequestIterations: vi.fn().mockResolvedValue([validIteration]),
                getPullRequestIterationChanges: vi.fn().mockResolvedValue({
                    changeEntries: [{ item: { path: '/src/foo.ts' }, changeType: VersionControlChangeType.Edit }],
                }),
                getFileContent: vi.fn().mockImplementation((_repo: string, _path: string, commitId: string) =>
                    Promise.resolve(commitId === 'base-sha-xyz' ? 'old content\n' : 'new content\n'),
                ),
            });
            const a = new AdoPullRequestsAdapter(svc, 'my-project');
            const diff = await a.getDiff('repo-id', 42);
            expect(diff).toContain('---');
            expect(diff).toContain('+++');
            expect(diff).toContain('@@');
        });

        it('returns empty string when no iterations', async () => {
            const svc = makeMockService({
                getPullRequestIterations: vi.fn().mockResolvedValue([]),
            });
            const a = new AdoPullRequestsAdapter(svc, 'my-project');
            const diff = await a.getDiff('repo-id', 42);
            expect(diff).toBe('');
            expect(svc.getPullRequestIterationChanges).not.toHaveBeenCalled();
            expect(svc.getFileContent).not.toHaveBeenCalled();
        });

        it('returns empty string when iteration is missing SHAs', async () => {
            const svc = makeMockService({
                getPullRequestIterations: vi.fn().mockResolvedValue([{ id: 1 }]),
            });
            const a = new AdoPullRequestsAdapter(svc, 'my-project');
            const diff = await a.getDiff('repo-id', 42);
            expect(diff).toBe('');
        });

        it('returns empty string when no change entries', async () => {
            const svc = makeMockService({
                getPullRequestIterations: vi.fn().mockResolvedValue([validIteration]),
                getPullRequestIterationChanges: vi.fn().mockResolvedValue({ changeEntries: [] }),
            });
            const a = new AdoPullRequestsAdapter(svc, 'my-project');
            const diff = await a.getDiff('repo-id', 42);
            expect(diff).toBe('');
            expect(svc.getFileContent).not.toHaveBeenCalled();
        });

        it('added file — base content is empty, old header shows /dev/null', async () => {
            const svc = makeMockService({
                getPullRequestIterations: vi.fn().mockResolvedValue([validIteration]),
                getPullRequestIterationChanges: vi.fn().mockResolvedValue({
                    changeEntries: [{ item: { path: '/src/new-file.ts' }, changeType: VersionControlChangeType.Add }],
                }),
                getFileContent: vi.fn().mockResolvedValue('brand new content\n'),
            });
            const a = new AdoPullRequestsAdapter(svc, 'my-project');
            const diff = await a.getDiff('repo-id', 42);
            // Only called once (head), not for base
            expect(svc.getFileContent).toHaveBeenCalledTimes(1);
            expect(diff).toContain('/dev/null');
        });

        it('deleted file — head content is empty, new header shows /dev/null', async () => {
            const svc = makeMockService({
                getPullRequestIterations: vi.fn().mockResolvedValue([validIteration]),
                getPullRequestIterationChanges: vi.fn().mockResolvedValue({
                    changeEntries: [{ item: { path: '/src/old-file.ts' }, changeType: VersionControlChangeType.Delete }],
                }),
                getFileContent: vi.fn().mockResolvedValue('deleted content\n'),
            });
            const a = new AdoPullRequestsAdapter(svc, 'my-project');
            const diff = await a.getDiff('repo-id', 42);
            // Only called once (base), not for head
            expect(svc.getFileContent).toHaveBeenCalledTimes(1);
            expect(diff).toContain('/dev/null');
        });

        it('renamed file — originalPath in --- header, new path in +++ header', async () => {
            const svc = makeMockService({
                getPullRequestIterations: vi.fn().mockResolvedValue([validIteration]),
                getPullRequestIterationChanges: vi.fn().mockResolvedValue({
                    changeEntries: [{
                        item: { path: '/src/renamed.ts', originalPath: '/src/original.ts' },
                        changeType: VersionControlChangeType.Rename,
                    }],
                }),
                getFileContent: vi.fn().mockResolvedValue('content\n'),
            });
            const a = new AdoPullRequestsAdapter(svc, 'my-project');
            const diff = await a.getDiff('repo-id', 42);
            expect(diff).toContain('a/src/original.ts');
            expect(diff).toContain('b/src/renamed.ts');
        });

        it('returns empty string on service error (outer catch)', async () => {
            const svc = makeMockService({
                getPullRequestIterations: vi.fn().mockRejectedValue(new Error('network timeout')),
            });
            const a = new AdoPullRequestsAdapter(svc, 'my-project');
            const diff = await a.getDiff('repo-id', 42);
            expect(diff).toBe('');
            const warnCalls = (mockLogger.warn as ReturnType<typeof vi.fn>).mock.calls.map((c: unknown[]) => c[1] as string);
            expect(warnCalls.some(m => m.includes('getDiff failed') && m.includes('network timeout'))).toBe(true);
        });
    });

    // ── URL mapping ────────────────────────────────────────────

    describe('URL mapping', () => {
        it('uses _links.web.href for url when available', async () => {
            const prWithWebLink = {
                ...mockAdoPr,
                url: 'https://dev.azure.com/org/proj/_apis/git/repositories/repo-guid/pullRequests/42',
                _links: { web: { href: 'https://dev.azure.com/org/proj/_git/repo/pullrequest/42' } },
            };
            const svc = makeMockService({
                listPullRequests: vi.fn().mockResolvedValue([prWithWebLink]),
            });
            const a = new AdoPullRequestsAdapter(svc, 'my-project');
            const [pr] = await a.listPullRequests('repo-id');
            expect(pr.url).toBe('https://dev.azure.com/org/proj/_git/repo/pullrequest/42');
        });

        it('constructs web URL from repository.webUrl when _links.web.href is absent', async () => {
            const prWithRepoWebUrl = {
                ...mockAdoPr,
                url: 'https://dev.azure.com/org/proj/_apis/git/repositories/repo-guid/pullRequests/42',
                _links: {},
                repository: { webUrl: 'https://dev.azure.com/org/proj/_git/my-repo', name: 'my-repo' },
            };
            const svc = makeMockService({
                listPullRequests: vi.fn().mockResolvedValue([prWithRepoWebUrl]),
            });
            const a = new AdoPullRequestsAdapter(svc, 'my-project');
            const [pr] = await a.listPullRequests('repo-id');
            expect(pr.url).toBe('https://dev.azure.com/org/proj/_git/my-repo/pullrequest/42');
        });

        it('converts API URL to web URL using repository.name when webUrl is absent', async () => {
            const prWithRepoName = {
                ...mockAdoPr,
                url: 'https://dev.azure.com/org/proj/_apis/git/repositories/repo-guid/pullRequests/42',
                _links: {},
                repository: { name: 'my-repo' },
            };
            const svc = makeMockService({
                listPullRequests: vi.fn().mockResolvedValue([prWithRepoName]),
            });
            const a = new AdoPullRequestsAdapter(svc, 'my-project');
            const [pr] = await a.listPullRequests('repo-id');
            expect(pr.url).toBe('https://dev.azure.com/org/proj/_git/my-repo/pullrequest/42');
        });

        it('never returns an API URL for the web link (regression)', async () => {
            const prApiUrlOnly = {
                ...mockAdoPr,
                url: 'https://dev.azure.com/org/proj/_apis/git/repositories/repo-guid/pullRequests/42',
                _links: {},
                repository: { name: 'my-repo' },
            };
            const svc = makeMockService({
                listPullRequests: vi.fn().mockResolvedValue([prApiUrlOnly]),
            });
            const a = new AdoPullRequestsAdapter(svc, 'my-project');
            const [pr] = await a.listPullRequests('repo-id');
            expect(pr.url).not.toContain('/_apis/');
        });

        it('falls back to pr.url when no repository info is available to construct web URL', async () => {
            const prNoRepoInfo = {
                ...mockAdoPr,
                pullRequestId: undefined,
                url: 'https://dev.azure.com/org/proj/_apis/git/repositories/repo-guid/pullRequests/42',
                _links: {},
            };
            const svc = makeMockService({
                listPullRequests: vi.fn().mockResolvedValue([prNoRepoInfo]),
            });
            const a = new AdoPullRequestsAdapter(svc, 'my-project');
            const [pr] = await a.listPullRequests('repo-id');
            expect(pr.url).toBe('https://dev.azure.com/org/proj/_apis/git/repositories/repo-guid/pullRequests/42');
        });

        it('defaults to empty string when both _links.web.href and url are missing', async () => {
            const prNoUrl = { ...mockAdoPr, url: undefined, _links: {} };
            const svc = makeMockService({
                listPullRequests: vi.fn().mockResolvedValue([prNoUrl]),
            });
            const a = new AdoPullRequestsAdapter(svc, 'my-project');
            const [pr] = await a.listPullRequests('repo-id');
            expect(pr.url).toBe('');
        });
    });

    // ── vote mapping ─────────────────────────────────────────

    describe('vote mapping', () => {
        it.each([
            [10, 'approved'],
            [5, 'approved-with-suggestions'],
            [-10, 'rejected'],
            [-5, 'waiting-for-author'],
            [0, 'no-vote'],
            [undefined, 'no-vote'],
        ])('maps ADO vote %s to %s', async (vote, expected) => {
            const overriddenService = makeMockService({
                listPullRequests: vi.fn().mockResolvedValue([{
                    ...mockAdoPr,
                    reviewers: [{ ...mockAdoReviewer, vote }],
                }]),
            });
            const a = new AdoPullRequestsAdapter(overriddenService);
            const [pr] = await a.listPullRequests('repo-id');
            expect(pr.reviewers[0].vote).toBe(expected);
        });
    });

    // ── status mapping ───────────────────────────────────────

    describe('status mapping', () => {
        it.each([
            [{ status: 1, isDraft: false }, 'open'],
            [{ status: 3, isDraft: false }, 'merged'],
            [{ status: 2, isDraft: false }, 'closed'],
            [{ status: 1, isDraft: true }, 'draft'],
        ])('maps ADO status to %s', async (prOverride, expected) => {
            const overriddenService = makeMockService({
                listPullRequests: vi.fn().mockResolvedValue([{ ...mockAdoPr, ...prOverride }]),
            });
            const a = new AdoPullRequestsAdapter(overriddenService);
            const [pr] = await a.listPullRequests('repo-id');
            expect(pr.status).toBe(expected);
        });
    });

    // ── repo override (regression: workspace ID vs ADO repo name) ──

    describe('repo override', () => {
        it('uses constructor repo instead of repositoryId for service calls', async () => {
            const svc = makeMockService();
            const adapterWithRepo = new AdoPullRequestsAdapter(svc, 'my-project', 'my-repo');

            await adapterWithRepo.listPullRequests('ws-48cyxk');
            expect(svc.listPullRequests).toHaveBeenCalledWith('my-repo', expect.any(Object), 'my-project', undefined, undefined);

            await adapterWithRepo.createPullRequest('ws-48cyxk', { title: 'T', description: '', sourceBranch: 'a', targetBranch: 'b' });
            expect(svc.createPullRequest).toHaveBeenCalledWith('my-repo', expect.any(Object), 'my-project');

            await adapterWithRepo.updatePullRequest('ws-48cyxk', 1, { title: 'U' });
            expect(svc.updatePullRequest).toHaveBeenCalledWith('my-repo', 1, expect.any(Object), 'my-project');

            await adapterWithRepo.getThreads('ws-48cyxk', 1);
            expect(svc.getThreads).toHaveBeenCalledWith('my-repo', 1, 'my-project');

            await adapterWithRepo.createThread('ws-48cyxk', 1, 'hi');
            expect(svc.createThread).toHaveBeenCalledWith('my-repo', 1, expect.any(Object), 'my-project');

            await adapterWithRepo.getReviewers('ws-48cyxk', 1);
            expect(svc.getReviewers).toHaveBeenCalledWith('my-repo', 1, 'my-project');

            await adapterWithRepo.getCommits('ws-48cyxk', 1);
            expect(svc.getPullRequestCommits).toHaveBeenCalledWith('my-repo', 1, 'my-project');

            await adapterWithRepo.addReviewers('ws-48cyxk', 1, ['u1']);
            expect(svc.addReviewers).toHaveBeenCalledWith('my-repo', 1, [{ id: 'u1' }], 'my-project');
        });

        it('falls back to repositoryId when repo is not set', async () => {
            const svc = makeMockService();
            const adapterNoRepo = new AdoPullRequestsAdapter(svc, 'my-project');

            await adapterNoRepo.listPullRequests('fallback-repo');
            expect(svc.listPullRequests).toHaveBeenCalledWith('fallback-repo', expect.any(Object), 'my-project', undefined, undefined);

            await adapterNoRepo.getCommits('fallback-repo', 1);
            expect(svc.getPullRequestCommits).toHaveBeenCalledWith('fallback-repo', 1, 'my-project');
        });

        it('preserves repositoryId in mapped PullRequest even when repo override is used', async () => {
            const svc = makeMockService();
            const adapterWithRepo = new AdoPullRequestsAdapter(svc, 'my-project', 'my-repo');

            const [pr] = await adapterWithRepo.listPullRequests('ws-48cyxk');
            expect(pr.repositoryId).toBe('ws-48cyxk');
        });

        it('getDiff uses constructor repo instead of repositoryId for all service calls', async () => {
            const validIteration = {
                id: 1,
                sourceRefCommit: { commitId: 'head-sha' },
                commonRefCommit: { commitId: 'base-sha' },
            };
            const svc = makeMockService({
                getPullRequestIterations: vi.fn().mockResolvedValue([validIteration]),
                getPullRequestIterationChanges: vi.fn().mockResolvedValue({
                    changeEntries: [{ item: { path: '/src/foo.ts' }, changeType: VersionControlChangeType.Edit }],
                }),
                getFileContent: vi.fn().mockResolvedValue('content\n'),
            });
            const adapterWithRepo = new AdoPullRequestsAdapter(svc, 'my-project', 'my-repo');

            await adapterWithRepo.getDiff('ws-48cyxk', 99);

            // All three service calls must use 'my-repo', not the workspace id 'ws-48cyxk'
            expect(svc.getPullRequestIterations).toHaveBeenCalledWith('my-repo', 99, 'my-project');
            expect(svc.getPullRequestIterationChanges).toHaveBeenCalledWith('my-repo', 99, 1, 'my-project');
            expect(svc.getFileContent).toHaveBeenCalledWith('my-repo', expect.any(String), expect.any(String), 'my-project');
        });

        it('getDiff falls back to repositoryId when repo is not set', async () => {
            const validIteration = {
                id: 1,
                sourceRefCommit: { commitId: 'head-sha' },
                commonRefCommit: { commitId: 'base-sha' },
            };
            const svc = makeMockService({
                getPullRequestIterations: vi.fn().mockResolvedValue([validIteration]),
                getPullRequestIterationChanges: vi.fn().mockResolvedValue({
                    changeEntries: [{ item: { path: '/src/foo.ts' }, changeType: VersionControlChangeType.Edit }],
                }),
                getFileContent: vi.fn().mockResolvedValue('content\n'),
            });
            const adapterNoRepo = new AdoPullRequestsAdapter(svc, 'my-project');

            await adapterNoRepo.getDiff('fallback-repo', 99);

            expect(svc.getPullRequestIterations).toHaveBeenCalledWith('fallback-repo', 99, 'my-project');
            expect(svc.getPullRequestIterationChanges).toHaveBeenCalledWith('fallback-repo', 99, 1, 'my-project');
            expect(svc.getFileContent).toHaveBeenCalledWith('fallback-repo', expect.any(String), expect.any(String), 'my-project');
        });
    });

    // ── logging ──────────────────────────────────────────────

    describe('logging', () => {
        it('logs info with resolved adoCriteria when listing PRs', async () => {
            await adapter.listPullRequests('repo-id', { sourceBranch: 'feature', targetBranch: 'main' });

            const infoCalls = (mockLogger.info as ReturnType<typeof vi.fn>).mock.calls.map((c: unknown[]) => c[1] as string);
            expect(infoCalls.some(m => m.includes('listPullRequests') && m.includes('sourceRefName') && m.includes('targetRefName'))).toBe(true);
        });

        it('logs info with result count after listing PRs', async () => {
            await adapter.listPullRequests('repo-id');

            const infoCalls = (mockLogger.info as ReturnType<typeof vi.fn>).mock.calls.map((c: unknown[]) => c[1] as string);
            expect(infoCalls.some(m => m.includes('listPullRequests') && m.includes('mapped') && m.includes('PR(s)'))).toBe(true);
        });

        it('logs info warning when criteria.status is unrecognized', async () => {
            await adapter.listPullRequests('repo-id', { status: 'unknown-value' });

            const infoCalls = (mockLogger.info as ReturnType<typeof vi.fn>).mock.calls.map((c: unknown[]) => c[1] as string);
            expect(infoCalls.some(m => m.includes('criteria.status') && m.includes('unknown-value') && m.includes('not a recognized value'))).toBe(true);
        });

        it('logs info with PR details when getting a single PR', async () => {
            await adapter.getPullRequest('repo-id', 42);

            const infoCalls = (mockLogger.info as ReturnType<typeof vi.fn>).mock.calls.map((c: unknown[]) => c[1] as string);
            expect(infoCalls.some(m => m.includes('getPullRequest') && m.includes('42'))).toBe(true);
        });

        it('does not use debug level for ADO operations (regression)', async () => {
            (mockLogger.debug as ReturnType<typeof vi.fn>).mockClear();
            await adapter.listPullRequests('repo-id');
            await adapter.getPullRequest('repo-id', 42);

            const debugCalls = (mockLogger.debug as ReturnType<typeof vi.fn>).mock.calls;
            expect(debugCalls.length).toBe(0);
        });
    });
});
