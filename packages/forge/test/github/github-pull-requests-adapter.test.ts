import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GitHubPullRequestsAdapter } from '../../src/github/github-pull-requests-adapter';
import type { Octokit } from '@octokit/rest';

// ── fixtures ─────────────────────────────────────────────────

const mockGitHubPr = {
    id: 1001,
    number: 42,
    title: 'Fix bug',
    body: 'Fixes a nasty bug',
    user: { id: 100, login: 'alice', name: 'Alice Smith', email: 'alice@example.com', avatar_url: 'https://avatar/alice' },
    head: { ref: 'feature/fix', sha: 'abc123' },
    base: { ref: 'main', sha: 'def456' },
    state: 'open' as const,
    draft: false,
    created_at: '2024-01-01T00:00:00Z',
    updated_at: '2024-01-02T00:00:00Z',
    merged_at: null,
    closed_at: null,
    html_url: 'https://github.com/owner/repo/pull/42',
    labels: [{ id: 1, name: 'bug', color: 'red' }],
};

const mockGitHubReview = {
    id: 200,
    user: { id: 101, login: 'bob', name: 'Bob Jones', avatar_url: 'https://avatar/bob' },
    state: 'APPROVED' as const,
    submitted_at: '2024-01-02T00:00:00Z',
    html_url: 'https://github.com/owner/repo/pull/42#pullrequestreview-200',
};

const mockGitHubComment = {
    id: 300,
    user: { id: 100, login: 'alice', name: 'Alice Smith', email: 'alice@example.com' },
    body: 'Looks good!',
    created_at: '2024-01-03T00:00:00Z',
    updated_at: '2024-01-03T00:00:00Z',
    html_url: 'https://github.com/owner/repo/pull/42#issuecomment-300',
    path: 'src/foo.ts',
    line: 12,
    start_line: 10,
    side: 'RIGHT' as const,
};

const mockGitHubCommit = {
    sha: 'abcdef1234567890',
    commit: {
        message: 'Fix bug\n\nDetailed body',
        author: { name: 'Alice Smith', email: 'alice@example.com', date: '2024-01-04T00:00:00Z' },
        committer: { name: 'CI', email: 'ci@example.com', date: '2024-01-04T01:00:00Z' },
    },
    author: { id: 100, login: 'alice', name: 'Alice Smith', email: 'alice@example.com', avatar_url: 'https://avatar/alice' },
    html_url: 'https://github.com/owner/repo/commit/abcdef1234567890',
};

function makeMockOctokit(overrides: Record<string, unknown> = {}): Octokit {
    return {
        pulls: {
            list: vi.fn().mockResolvedValue({ data: [mockGitHubPr] }),
            get: vi.fn().mockResolvedValue({ data: mockGitHubPr }),
            create: vi.fn().mockResolvedValue({ data: mockGitHubPr }),
            update: vi.fn().mockResolvedValue({ data: mockGitHubPr }),
            listReviewComments: vi.fn().mockResolvedValue({ data: [mockGitHubComment] }),
            listReviews: vi.fn().mockResolvedValue({ data: [mockGitHubReview] }),
            listCommits: vi.fn().mockResolvedValue({ data: [mockGitHubCommit] }),
            requestReviewers: vi.fn().mockResolvedValue({ data: {} }),
        },
        issues: {
            createComment: vi.fn().mockResolvedValue({ data: mockGitHubComment }),
        },
        request: vi.fn().mockResolvedValue({ data: 'diff --git a/file.ts b/file.ts\n' }),
        ...overrides,
    } as unknown as Octokit;
}

// ── tests ─────────────────────────────────────────────────────

describe('GitHubPullRequestsAdapter', () => {
    let octokit: Octokit;
    let adapter: GitHubPullRequestsAdapter;

    beforeEach(() => {
        octokit = makeMockOctokit();
        adapter = new GitHubPullRequestsAdapter(octokit, { owner: 'owner', repo: 'repo' });
    });

    describe('listPullRequests', () => {
        it('maps GitHub PR to canonical PullRequest', async () => {
            const prs = await adapter.listPullRequests('repo');
            expect(prs).toHaveLength(1);
            const pr = prs[0];
            expect(pr.id).toBe(1001);
            expect(pr.number).toBe(42);
            expect(pr.title).toBe('Fix bug');
            expect(pr.description).toBe('Fixes a nasty bug');
            expect(pr.author.id).toBe('100');
            expect(pr.author.displayName).toBe('Alice Smith');
            expect(pr.author.email).toBe('alice@example.com');
            expect(pr.sourceBranch).toBe('feature/fix');
            expect(pr.targetBranch).toBe('main');
            expect(pr.status).toBe('open');
            expect(pr.isDraft).toBe(false);
            expect(pr.labels).toEqual(['bug']);
            expect(pr.repositoryId).toBe('owner/repo');
        });

        it('maps draft PR status correctly', async () => {
            (octokit.pulls.list as ReturnType<typeof vi.fn>).mockResolvedValue({
                data: [{ ...mockGitHubPr, draft: true }],
            });
            const [pr] = await adapter.listPullRequests('repo');
            expect(pr.status).toBe('draft');
            expect(pr.isDraft).toBe(true);
        });

        it('maps merged PR status correctly', async () => {
            (octokit.pulls.list as ReturnType<typeof vi.fn>).mockResolvedValue({
                data: [{ ...mockGitHubPr, state: 'closed', merged_at: '2024-01-05T00:00:00Z' }],
            });
            const [pr] = await adapter.listPullRequests('repo');
            expect(pr.status).toBe('merged');
            expect(pr.mergedAt).toEqual(new Date('2024-01-05T00:00:00Z'));
        });

        it('maps closed (not merged) PR status correctly', async () => {
            (octokit.pulls.list as ReturnType<typeof vi.fn>).mockResolvedValue({
                data: [{ ...mockGitHubPr, state: 'closed', merged_at: null }],
            });
            const [pr] = await adapter.listPullRequests('repo');
            expect(pr.status).toBe('closed');
        });

        it('passes criteria to octokit.pulls.list', async () => {
            await adapter.listPullRequests('repo', {
                status: 'closed',
                sourceBranch: 'feature',
                targetBranch: 'main',
                top: 20,
            });
            expect(octokit.pulls.list).toHaveBeenCalledWith(expect.objectContaining({
                state: 'closed',
                head: 'owner:feature',
                base: 'main',
                per_page: 20,
            }));
        });
    });

    describe('getPullRequest', () => {
        it('calls octokit.pulls.get with correct args', async () => {
            const pr = await adapter.getPullRequest('repo', 42);
            expect(pr.number).toBe(42);
            expect(octokit.pulls.get).toHaveBeenCalledWith({
                owner: 'owner',
                repo: 'repo',
                pull_number: 42,
            });
        });
    });

    describe('createPullRequest', () => {
        it('calls octokit.pulls.create with correct args', async () => {
            await adapter.createPullRequest('repo', {
                title: 'New PR',
                description: 'desc',
                sourceBranch: 'feature',
                targetBranch: 'main',
                isDraft: true,
            });
            expect(octokit.pulls.create).toHaveBeenCalledWith({
                owner: 'owner',
                repo: 'repo',
                title: 'New PR',
                body: 'desc',
                head: 'feature',
                base: 'main',
                draft: true,
            });
        });
    });

    describe('updatePullRequest', () => {
        it('calls octokit.pulls.update with correct args', async () => {
            await adapter.updatePullRequest('repo', 42, { title: 'Updated', description: 'New body' });
            expect(octokit.pulls.update).toHaveBeenCalledWith({
                owner: 'owner',
                repo: 'repo',
                pull_number: 42,
                title: 'Updated',
                body: 'New body',
            });
        });
    });

    describe('getThreads', () => {
        it('maps review comments to comment threads', async () => {
            const threads = await adapter.getThreads('repo', 42);
            expect(threads).toHaveLength(1);
            expect(threads[0].id).toBe(300);
            expect(threads[0].status).toBe('active');
            expect(threads[0].comments[0].body).toBe('Looks good!');
            expect(threads[0].threadContext).toEqual({
                filePath: 'src/foo.ts',
                line: 12,
                startLine: 10,
                endLine: 12,
                side: 'right',
            });
        });
    });

    describe('createThread', () => {
        it('calls issues.createComment and returns a thread', async () => {
            const thread = await adapter.createThread('repo', 42, 'LGTM');
            expect(octokit.issues.createComment).toHaveBeenCalledWith({
                owner: 'owner',
                repo: 'repo',
                issue_number: 42,
                body: 'LGTM',
            });
            expect(thread.comments[0].body).toBe('Looks good!');
        });
    });

    describe('getReviewers', () => {
        it('maps GitHub reviews to canonical Reviewer', async () => {
            const reviewers = await adapter.getReviewers('repo', 42);
            expect(reviewers).toHaveLength(1);
            expect(reviewers[0].identity.displayName).toBe('Bob Jones');
            expect(reviewers[0].vote).toBe('approved');
            expect(reviewers[0].isRequired).toBe(false);
        });

        it.each([
            ['APPROVED', 'approved'],
            ['CHANGES_REQUESTED', 'rejected'],
            ['DISMISSED', 'no-vote'],
            ['COMMENTED', 'no-vote'],
            ['PENDING', 'no-vote'],
        ] as const)('maps GitHub review state %s to vote %s', async (state, expected) => {
            (octokit.pulls.listReviews as ReturnType<typeof vi.fn>).mockResolvedValue({
                data: [{ ...mockGitHubReview, state }],
            });
            const [reviewer] = await adapter.getReviewers('repo', 42);
            expect(reviewer.vote).toBe(expected);
        });
    });

    describe('addReviewers', () => {
        it('calls pulls.requestReviewers then getReviewers', async () => {
            await adapter.addReviewers('repo', 42, ['alice', 'bob']);
            expect(octokit.pulls.requestReviewers).toHaveBeenCalledWith({
                owner: 'owner',
                repo: 'repo',
                pull_number: 42,
                reviewers: ['alice', 'bob'],
            });
            expect(octokit.pulls.listReviews).toHaveBeenCalled();
        });
    });

    describe('getDiff', () => {
        it('calls octokit.request with diff accept header', async () => {
            const diff = await adapter.getDiff('repo', 42);
            expect((octokit as any).request).toHaveBeenCalledWith(
                'GET /repos/{owner}/{repo}/pulls/{pull_number}',
                expect.objectContaining({
                    owner: 'owner',
                    repo: 'repo',
                    pull_number: 42,
                    headers: expect.objectContaining({ accept: 'application/vnd.github.diff' }),
                }),
            );
            expect(diff).toBe('diff --git a/file.ts b/file.ts\n');
        });

        it('returns empty string when response data is null', async () => {
            (octokit as any).request = vi.fn().mockResolvedValue({ data: null });
            const diff = await adapter.getDiff('repo', 42);
            expect(diff).toBe('');
        });
    });

    describe('getCommits', () => {
        it('maps GitHub PR commits to canonical commits', async () => {
            const commits = await adapter.getCommits('repo', 42);
            expect(octokit.pulls.listCommits).toHaveBeenCalledWith({
                owner: 'owner',
                repo: 'repo',
                pull_number: 42,
                per_page: 100,
            });
            expect(commits).toHaveLength(1);
            expect(commits[0]).toMatchObject({
                sha: 'abcdef1234567890',
                shortSha: 'abcdef1',
                title: 'Fix bug',
                message: 'Fix bug\n\nDetailed body',
                author: { displayName: 'Alice Smith', email: 'alice@example.com' },
                url: 'https://github.com/owner/repo/commit/abcdef1234567890',
            });
            expect(commits[0].authoredAt).toEqual(new Date('2024-01-04T00:00:00Z'));
            expect(commits[0].committedAt).toEqual(new Date('2024-01-04T01:00:00Z'));
        });
    });
});
