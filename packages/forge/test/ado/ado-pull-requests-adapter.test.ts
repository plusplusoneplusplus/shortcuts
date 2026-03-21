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
};

const mockAdoReviewer = {
    id: 'user-2',
    displayName: 'Bob',
    uniqueName: 'bob@example.com',
    vote: 10,
    isRequired: true,
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
                { sourceRefName: 'refs/heads/feature/fix', targetRefName: 'refs/heads/main' },
                'my-project',
                5,
                10,
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

        it('logs info warning when criteria.status is provided (not mapped to ADO)', async () => {
            await adapter.listPullRequests('repo-id', { status: 'merged' });

            const infoCalls = (mockLogger.info as ReturnType<typeof vi.fn>).mock.calls.map((c: unknown[]) => c[1] as string);
            expect(infoCalls.some(m => m.includes('criteria.status') && m.includes('merged') && m.includes('not mapped'))).toBe(true);
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
