import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GitHubPullRequestsAdapter, mapGitHubAutoMerge } from '../../src/github/github-pull-requests-adapter';
import type { GitHubPullRequest } from '../../src/github/types';
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

const mockGitHubPrCommit = {
    sha: 'abc1234deadbeef0000000000000000000000000',
    html_url: 'https://github.com/owner/repo/commit/abc1234',
    commit: {
        message: 'feat: stream JSONL parser\n\nMore details about the change.',
        author: {
            name: 'Alice Smith',
            email: 'alice@example.com',
            date: '2024-01-04T12:34:56Z',
        },
        committer: {
            name: 'Alice Smith',
            email: 'alice@example.com',
            date: '2024-01-04T12:34:56Z',
        },
    },
    author: { id: 100, login: 'alice', name: 'Alice Smith', email: 'alice@example.com', avatar_url: 'https://avatar/alice' },
    committer: { id: 100, login: 'alice', name: 'Alice Smith', email: 'alice@example.com', avatar_url: 'https://avatar/alice' },
};

const mockGitHubCheckRun = {
    id: 9001,
    name: 'build',
    status: 'completed' as const,
    conclusion: 'success' as const,
    started_at: '2024-01-06T10:00:00Z',
    completed_at: '2024-01-06T10:03:18Z',
    html_url: 'https://github.com/owner/repo/runs/9001',
    details_url: 'https://github.com/owner/repo/runs/9001/details',
    output: { title: 'Build OK', summary: 'All targets built.' },
    app: { slug: 'github-actions', name: 'GitHub Actions' },
};

const mockGitHubCombinedStatusItem = {
    id: 5005,
    state: 'failure' as const,
    context: 'ci/legacy',
    description: 'Legacy CI failed on macOS',
    target_url: 'https://example.com/builds/5005',
    created_at: '2024-01-06T11:00:00Z',
    updated_at: '2024-01-06T11:02:00Z',
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
            listCommits: vi.fn().mockResolvedValue({ data: [mockGitHubPrCommit] }),
            requestReviewers: vi.fn().mockResolvedValue({ data: {} }),
        },
        issues: {
            createComment: vi.fn().mockResolvedValue({ data: mockGitHubComment }),
        },
        checks: {
            listForRef: vi.fn().mockResolvedValue({ data: { check_runs: [mockGitHubCheckRun] } }),
        },
        repos: {
            getCombinedStatusForRef: vi.fn().mockResolvedValue({
                data: {
                    state: 'failure',
                    sha: 'abc123',
                    total_count: 1,
                    statuses: [mockGitHubCombinedStatusItem],
                },
            }),
        },
        search: {
            issuesAndPullRequests: vi.fn().mockResolvedValue({ data: { items: [] } }),
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
            expect(pr.headSha).toBe('abc123');
            expect(pr.baseSha).toBe('def456');
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

        it('maps skip and top criteria to GitHub pull request pages', async () => {
            await adapter.listPullRequests('repo', {
                status: 'open',
                top: 20,
                skip: 40,
            });

            expect(octokit.pulls.list).toHaveBeenCalledWith(expect.objectContaining({
                state: 'open',
                per_page: 20,
                page: 3,
            }));
        });
    });

    describe('listPullRequests with authorId (Search API)', () => {
        it('uses Search API when authorId is specified', async () => {
            const searchItem = {
                id: 1001,
                number: 42,
                title: 'Fix bug',
                body: 'Fixes a nasty bug',
                user: { id: 100, login: 'alice', name: 'Alice Smith', avatar_url: 'https://avatar/alice' },
                state: 'open',
                draft: false,
                created_at: '2024-01-01T00:00:00Z',
                updated_at: '2024-01-02T00:00:00Z',
                pull_request: { merged_at: null },
                labels: [{ id: 1, name: 'bug', color: 'red' }],
                html_url: 'https://github.com/owner/repo/pull/42',
            };
            ((octokit as any).search.issuesAndPullRequests as ReturnType<typeof vi.fn>).mockResolvedValue({
                data: { items: [searchItem] },
            });

            const prs = await adapter.listPullRequests('repo', { status: 'open', authorId: 'alice', top: 25 });
            expect(prs).toHaveLength(1);
            expect(prs[0].number).toBe(42);
            expect(prs[0].author.id).toBe('100');
            expect(prs[0].author.login).toBe('alice');
            expect((octokit as any).search.issuesAndPullRequests).toHaveBeenCalledWith({
                q: 'is:pr is:open repo:owner/repo author:alice',
                sort: 'updated',
                order: 'desc',
                per_page: 25,
            });
            // Should NOT call pulls.list
            expect(octokit.pulls.list).not.toHaveBeenCalled();
        });

        it('falls back to pulls.list filter when Search API throws', async () => {
            ((octokit as any).search.issuesAndPullRequests as ReturnType<typeof vi.fn>).mockRejectedValue(
                new Error('Search failed'),
            );
            // pulls.list returns all PRs; fallback filters by author ID
            (octokit.pulls.list as ReturnType<typeof vi.fn>).mockResolvedValue({
                data: [
                    mockGitHubPr,
                    { ...mockGitHubPr, id: 2002, number: 99, user: { id: 200, login: 'bob', name: 'Bob' } },
                ],
            });

            const prs = await adapter.listPullRequests('repo', { status: 'open', authorId: '100', top: 25 });
            // Only Alice's PR (author.id === '100') should be returned
            expect(prs).toHaveLength(1);
            expect(prs[0].author.id).toBe('100');
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
        it('maps GitHub PR commits to canonical PullRequestCommit', async () => {
            const commits = await adapter.getCommits('repo', 42);
            expect(commits).toHaveLength(1);
            const commit = commits[0];
            expect(commit.id).toBe('abc1234deadbeef0000000000000000000000000');
            expect(commit.shortId).toBe('abc1234');
            expect(commit.subject).toBe('feat: stream JSONL parser');
            expect(commit.message).toBe('feat: stream JSONL parser\n\nMore details about the change.');
            expect(commit.author.displayName).toBe('Alice Smith');
            expect(commit.author.email).toBe('alice@example.com');
            expect(commit.committer?.displayName).toBe('Alice Smith');
            expect(commit.authoredAt).toEqual(new Date('2024-01-04T12:34:56Z'));
            expect(commit.committedAt).toEqual(new Date('2024-01-04T12:34:56Z'));
            expect(commit.url).toBe('https://github.com/owner/repo/commit/abc1234');
            expect(octokit.pulls.listCommits).toHaveBeenCalledWith({
                owner: 'owner',
                repo: 'repo',
                pull_number: 42,
                per_page: 100,
            });
        });

        it('falls back to commit.author name/email when GitHub user is unmatched', async () => {
            (octokit.pulls.listCommits as ReturnType<typeof vi.fn>).mockResolvedValue({
                data: [{
                    ...mockGitHubPrCommit,
                    author: null,
                    committer: null,
                }],
            });
            const [commit] = await adapter.getCommits('repo', 42);
            expect(commit.author.id).toBe('');
            expect(commit.author.displayName).toBe('Alice Smith');
            expect(commit.author.email).toBe('alice@example.com');
        });

        it('returns an empty array when octokit returns no commits', async () => {
            (octokit.pulls.listCommits as ReturnType<typeof vi.fn>).mockResolvedValue({ data: [] });
            const commits = await adapter.getCommits('repo', 42);
            expect(commits).toEqual([]);
        });
    });

    describe('getChecks', () => {
        it('resolves head SHA from the PR then maps check-runs and combined statuses', async () => {
            const checks = await adapter.getChecks('repo', 42);
            expect(octokit.pulls.get).toHaveBeenCalledWith({ owner: 'owner', repo: 'repo', pull_number: 42 });
            expect((octokit as any).checks.listForRef).toHaveBeenCalledWith({
                owner: 'owner',
                repo: 'repo',
                ref: 'abc123',
                per_page: 100,
            });
            expect((octokit as any).repos.getCombinedStatusForRef).toHaveBeenCalledWith({
                owner: 'owner',
                repo: 'repo',
                ref: 'abc123',
            });
            expect(checks).toHaveLength(2);

            const checkRun = checks.find(c => c.source === 'check');
            expect(checkRun).toBeDefined();
            expect(checkRun!.id).toBe('check-9001');
            expect(checkRun!.name).toBe('build');
            expect(checkRun!.group).toBe('GitHub Actions');
            expect(checkRun!.status).toBe('success');
            expect(checkRun!.description).toBe('All targets built.');
            expect(checkRun!.detailsUrl).toBe('https://github.com/owner/repo/runs/9001');
            expect(checkRun!.startedAt).toEqual(new Date('2024-01-06T10:00:00Z'));
            expect(checkRun!.completedAt).toEqual(new Date('2024-01-06T10:03:18Z'));
            expect(checkRun!.durationMs).toBe(198 * 1000);

            const status = checks.find(c => c.source === 'status');
            expect(status).toBeDefined();
            expect(status!.id).toBe('status-5005');
            expect(status!.name).toBe('ci/legacy');
            expect(status!.status).toBe('failure');
            expect(status!.description).toBe('Legacy CI failed on macOS');
            expect(status!.detailsUrl).toBe('https://example.com/builds/5005');
        });

        it('returns empty array when the PR has no head SHA', async () => {
            (octokit.pulls.get as ReturnType<typeof vi.fn>).mockResolvedValue({
                data: { ...mockGitHubPr, head: { ref: 'feature/fix', sha: undefined } },
            });
            const checks = await adapter.getChecks('repo', 42);
            expect(checks).toEqual([]);
        });

        it.each([
            ['queued',      null,              'pending'],
            ['in_progress', null,              'running'],
            ['completed',   'success',         'success'],
            ['completed',   'neutral',         'success'],
            ['completed',   'failure',         'failure'],
            ['completed',   'timed_out',       'failure'],
            ['completed',   'cancelled',       'cancelled'],
            ['completed',   'skipped',         'skipped'],
            ['completed',   'stale',           'skipped'],
            ['completed',   'action_required', 'warning'],
        ] as const)('maps check-run status=%s conclusion=%s to %s', async (status, conclusion, expected) => {
            (octokit as any).checks.listForRef = vi.fn().mockResolvedValue({
                data: {
                    check_runs: [{ ...mockGitHubCheckRun, status, conclusion }],
                },
            });
            (octokit as any).repos.getCombinedStatusForRef = vi.fn().mockResolvedValue({
                data: { state: 'success', sha: 'abc123', statuses: [] },
            });
            const [check] = await adapter.getChecks('repo', 42);
            expect(check.status).toBe(expected);
        });

        it.each([
            ['success', 'success'],
            ['failure', 'failure'],
            ['error',   'failure'],
            ['pending', 'pending'],
        ] as const)('maps combined-status state=%s to %s', async (state, expected) => {
            (octokit as any).checks.listForRef = vi.fn().mockResolvedValue({ data: { check_runs: [] } });
            (octokit as any).repos.getCombinedStatusForRef = vi.fn().mockResolvedValue({
                data: {
                    state: 'success',
                    sha: 'abc123',
                    statuses: [{ ...mockGitHubCombinedStatusItem, state }],
                },
            });
            const [check] = await adapter.getChecks('repo', 42);
            expect(check.status).toBe(expected);
        });

        it('still returns combined statuses when check-runs lookup throws', async () => {
            (octokit as any).checks.listForRef = vi.fn().mockRejectedValue(new Error('403 forbidden'));
            const checks = await adapter.getChecks('repo', 42);
            expect(checks).toHaveLength(1);
            expect(checks[0].source).toBe('status');
        });

        it('still returns check-runs when combined-status lookup throws', async () => {
            (octokit as any).repos.getCombinedStatusForRef = vi.fn().mockRejectedValue(new Error('500 oops'));
            const checks = await adapter.getChecks('repo', 42);
            expect(checks).toHaveLength(1);
            expect(checks[0].source).toBe('check');
        });
    });

    describe('getReviewedPullRequests', () => {
        it('returns reviewed PRs from search API', async () => {
            const mockSearchItem = {
                number: 99,
                title: 'Reviewed PR',
                user: { id: 200, login: 'bob', name: 'Bob' },
                updated_at: '2024-02-01T00:00:00Z',
                html_url: 'https://github.com/owner/repo/pull/99',
                labels: [{ name: 'bug' }],
            };

            (octokit as any).search = {
                issuesAndPullRequests: vi.fn().mockResolvedValue({
                    data: { items: [mockSearchItem] },
                }),
            };
            (octokit as any).pulls.listFiles = vi.fn().mockResolvedValue({
                data: [{ filename: 'src/fix.ts' }, { filename: 'test/fix.test.ts' }],
            });

            const result = await adapter.getReviewedPullRequests('repo', 10);
            expect(result).toHaveLength(1);
            expect(result[0].number).toBe(99);
            expect(result[0].title).toBe('Reviewed PR');
            expect(result[0].author.displayName).toBe('Bob');
            expect(result[0].filesChanged).toEqual(['src/fix.ts', 'test/fix.test.ts']);
            expect(result[0].labels).toEqual(['bug']);
        });

        it('handles file listing failure gracefully', async () => {
            const mockSearchItem = {
                number: 50,
                title: 'PR without files',
                user: { id: 300, login: 'carol' },
                updated_at: '2024-03-01T00:00:00Z',
                html_url: 'https://github.com/owner/repo/pull/50',
                labels: [],
            };

            (octokit as any).search = {
                issuesAndPullRequests: vi.fn().mockResolvedValue({
                    data: { items: [mockSearchItem] },
                }),
            };
            (octokit as any).pulls.listFiles = vi.fn().mockRejectedValue(new Error('404'));

            const result = await adapter.getReviewedPullRequests('repo', 10);
            expect(result).toHaveLength(1);
            expect(result[0].filesChanged).toEqual([]);
        });

        it('respects the top parameter', async () => {
            const items = Array.from({ length: 5 }, (_, i) => ({
                number: i + 1,
                title: `PR ${i + 1}`,
                user: { id: i, login: `user${i}` },
                updated_at: '2024-01-01T00:00:00Z',
                html_url: `https://github.com/owner/repo/pull/${i + 1}`,
                labels: [],
            }));

            (octokit as any).search = {
                issuesAndPullRequests: vi.fn().mockResolvedValue({
                    data: { items },
                }),
            };
            (octokit as any).pulls.listFiles = vi.fn().mockResolvedValue({ data: [] });

            const result = await adapter.getReviewedPullRequests('repo', 3);
            expect(result).toHaveLength(3);
        });

        it('returns empty array when no reviewed PRs found', async () => {
            (octokit as any).search = {
                issuesAndPullRequests: vi.fn().mockResolvedValue({
                    data: { items: [] },
                }),
            };

            const result = await adapter.getReviewedPullRequests('repo', 10);
            expect(result).toEqual([]);
        });
    });

    // ── auto-merge mapping (AC-04) ───────────────────────────
    describe('mapGitHubAutoMerge', () => {
        function prWith(overrides: Partial<GitHubPullRequest>): GitHubPullRequest {
            return { ...mockGitHubPr, ...overrides } as GitHubPullRequest;
        }

        it('reports not-enabled when auto_merge is absent (off)', () => {
            expect(mapGitHubAutoMerge(prWith({}))).toEqual({ enabled: false, state: 'not-enabled' });
        });

        it('reports not-enabled when auto_merge is null', () => {
            expect(mapGitHubAutoMerge(prWith({ auto_merge: null }))).toEqual({
                enabled: false,
                state: 'not-enabled',
            });
        });

        it('reports armed with enabledBy + merge method when enabled and clean (on)', () => {
            const result = mapGitHubAutoMerge(prWith({
                auto_merge: {
                    enabled_by: { id: 7, login: 'carol', name: 'Carol' },
                    merge_method: 'squash',
                },
                mergeable: true,
                mergeable_state: 'clean',
            }));
            expect(result.enabled).toBe(true);
            expect(result.state).toBe('armed');
            expect(result.mergeMethod).toBe('squash');
            expect(result.enabledBy).toEqual({
                id: '7',
                displayName: 'Carol',
                email: undefined,
                avatarUrl: undefined,
            });
            expect(result.blockedReason).toBeUndefined();
        });

        it('stays armed for a behind/unknown mergeable_state', () => {
            const result = mapGitHubAutoMerge(prWith({
                auto_merge: { enabled_by: null, merge_method: 'merge' },
                mergeable: null,
                mergeable_state: 'behind',
            }));
            expect(result.state).toBe('armed');
            expect(result.enabledBy).toBeUndefined();
            expect(result.mergeMethod).toBe('merge');
        });

        it('reports blocked/conflicts when mergeable is false (blocked)', () => {
            const result = mapGitHubAutoMerge(prWith({
                auto_merge: { merge_method: 'merge' },
                mergeable: false,
                mergeable_state: 'dirty',
            }));
            expect(result).toMatchObject({ enabled: true, state: 'blocked', blockedReason: 'conflicts' });
        });

        it('reports blocked/pending-review for mergeable_state "blocked"', () => {
            const result = mapGitHubAutoMerge(prWith({
                auto_merge: { merge_method: 'rebase' },
                mergeable: true,
                mergeable_state: 'blocked',
            }));
            expect(result).toMatchObject({ state: 'blocked', blockedReason: 'pending-review', mergeMethod: 'rebase' });
        });

        it('reports blocked/failing-checks for mergeable_state "unstable"', () => {
            const result = mapGitHubAutoMerge(prWith({
                auto_merge: { merge_method: 'merge' },
                mergeable: true,
                mergeable_state: 'unstable',
            }));
            expect(result).toMatchObject({ state: 'blocked', blockedReason: 'failing-checks' });
        });

        it('drops an unrecognized merge_method to undefined', () => {
            const result = mapGitHubAutoMerge(prWith({
                auto_merge: { merge_method: 'fast-forward' as never },
                mergeable_state: 'clean',
            }));
            expect(result.mergeMethod).toBeUndefined();
        });

        it('surfaces autoMerge through getPullRequest', async () => {
            octokit.pulls.get = vi.fn().mockResolvedValue({
                data: prWith({
                    auto_merge: { enabled_by: { id: 7, login: 'carol' }, merge_method: 'squash' },
                    mergeable: true,
                    mergeable_state: 'clean',
                }),
            });
            const pr = await adapter.getPullRequest('repo', 42);
            expect(pr.autoMerge).toMatchObject({ enabled: true, state: 'armed', mergeMethod: 'squash' });
        });
    });
});
