import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GitHubIssuesAdapter } from '../../src/github/github-issues-adapter';
import type { Octokit } from '@octokit/rest';

// ── fixtures ─────────────────────────────────────────────────

const mockGitHubIssue = {
    id: 2001,
    number: 10,
    title: 'Memory leak in parser',
    body: 'Description of the memory leak',
    user: { id: 100, login: 'alice', name: 'Alice Smith', email: 'alice@example.com', avatar_url: 'https://avatar/alice' },
    assignees: [{ id: 101, login: 'bob', name: 'Bob Jones', avatar_url: 'https://avatar/bob' }],
    state: 'open' as const,
    created_at: '2024-01-01T00:00:00Z',
    updated_at: '2024-01-02T00:00:00Z',
    closed_at: null,
    html_url: 'https://github.com/owner/repo/issues/10',
    labels: [{ id: 1, name: 'bug', color: 'red' }, { id: 2, name: 'high-priority', color: 'orange' }],
};

const mockGitHubComment = {
    id: 500,
    user: { id: 100, login: 'alice', name: 'Alice Smith', email: 'alice@example.com' },
    body: 'Can reproduce this.',
    created_at: '2024-01-03T00:00:00Z',
    updated_at: '2024-01-03T01:00:00Z',
    html_url: 'https://github.com/owner/repo/issues/10#issuecomment-500',
};

function makeMockOctokit(): Octokit {
    return {
        issues: {
            get: vi.fn().mockResolvedValue({ data: mockGitHubIssue }),
            create: vi.fn().mockResolvedValue({ data: mockGitHubIssue }),
            update: vi.fn().mockResolvedValue({ data: mockGitHubIssue }),
            listComments: vi.fn().mockResolvedValue({ data: [mockGitHubComment] }),
            createComment: vi.fn().mockResolvedValue({ data: mockGitHubComment }),
        },
        search: {
            issuesAndPullRequests: vi.fn().mockResolvedValue({ data: { items: [mockGitHubIssue] } }),
        },
    } as unknown as Octokit;
}

// ── tests ─────────────────────────────────────────────────────

describe('GitHubIssuesAdapter', () => {
    let octokit: Octokit;
    let adapter: GitHubIssuesAdapter;

    beforeEach(() => {
        octokit = makeMockOctokit();
        adapter = new GitHubIssuesAdapter(octokit, { owner: 'owner', repo: 'repo' });
    });

    describe('getWorkItem', () => {
        it('maps GitHub issue to canonical WorkItem', async () => {
            const wi = await adapter.getWorkItem(10);
            expect(wi.id).toBe(2001);
            expect(wi.title).toBe('Memory leak in parser');
            expect(wi.type).toBe('Issue');
            expect(wi.state).toBe('open');
            expect(wi.author.id).toBe('100');
            expect(wi.author.displayName).toBe('Alice Smith');
            expect(wi.author.email).toBe('alice@example.com');
            expect(wi.assignees).toHaveLength(1);
            expect(wi.assignees[0].displayName).toBe('Bob Jones');
            expect(wi.description).toBe('Description of the memory leak');
            expect(wi.labels).toEqual(['bug', 'high-priority']);
            expect(wi.repositoryId).toBe('owner/repo');
            expect(wi.url).toBe('https://github.com/owner/repo/issues/10');
            expect(wi.raw).toBe(mockGitHubIssue);
        });

        it('calls octokit.issues.get with correct args', async () => {
            await adapter.getWorkItem(10);
            expect(octokit.issues.get).toHaveBeenCalledWith({
                owner: 'owner',
                repo: 'repo',
                issue_number: 10,
            });
        });
    });

    describe('getWorkItems', () => {
        it('fetches each issue individually and returns array', async () => {
            const items = await adapter.getWorkItems([10, 11]);
            expect(octokit.issues.get).toHaveBeenCalledTimes(2);
            expect(items).toHaveLength(2);
        });
    });

    describe('createWorkItem', () => {
        it('calls issues.create with correct args', async () => {
            await adapter.createWorkItem('owner/repo', 'Issue', {
                title: 'New Issue',
                description: 'desc',
                assigneeIds: ['alice', 'bob'],
                labels: ['bug'],
            });
            expect(octokit.issues.create).toHaveBeenCalledWith({
                owner: 'owner',
                repo: 'repo',
                title: 'New Issue',
                body: 'desc',
                assignees: ['alice', 'bob'],
                labels: ['bug'],
            });
        });

        it('returns mapped canonical WorkItem', async () => {
            const wi = await adapter.createWorkItem('owner/repo', 'Issue', { title: 'x' });
            expect(wi.type).toBe('Issue');
        });
    });

    describe('updateWorkItem', () => {
        it('calls issues.update with correct args including state', async () => {
            await adapter.updateWorkItem(10, {
                title: 'Updated',
                state: 'closed',
                assigneeIds: ['carol'],
                labels: ['wont-fix'],
            });
            expect(octokit.issues.update).toHaveBeenCalledWith({
                owner: 'owner',
                repo: 'repo',
                issue_number: 10,
                title: 'Updated',
                body: undefined,
                state: 'closed',
                assignees: ['carol'],
                labels: ['wont-fix'],
            });
        });

        it('maps unknown state to undefined (no state change)', async () => {
            await adapter.updateWorkItem(10, { title: 'x', state: 'active' });
            const call = (octokit.issues.update as ReturnType<typeof vi.fn>).mock.calls[0][0];
            expect(call.state).toBeUndefined();
        });
    });

    describe('searchWorkItems', () => {
        it('calls search.issuesAndPullRequests with correct query', async () => {
            const items = await adapter.searchWorkItems('memory leak', undefined, 15);
            expect(octokit.search.issuesAndPullRequests).toHaveBeenCalledWith({
                q: 'memory leak repo:owner/repo is:issue',
                per_page: 15,
            });
            expect(items).toHaveLength(1);
            expect(items[0].title).toBe('Memory leak in parser');
        });
    });

    describe('getComments', () => {
        it('maps GitHub comments to canonical Comment', async () => {
            const comments = await adapter.getComments(10);
            expect(comments).toHaveLength(1);
            expect(comments[0].id).toBe(500);
            expect(comments[0].body).toBe('Can reproduce this.');
            expect(comments[0].author.email).toBe('alice@example.com');
            expect(comments[0].url).toBe('https://github.com/owner/repo/issues/10#issuecomment-500');
        });

        it('calls issues.listComments with correct args', async () => {
            await adapter.getComments(10);
            expect(octokit.issues.listComments).toHaveBeenCalledWith({
                owner: 'owner',
                repo: 'repo',
                issue_number: 10,
            });
        });
    });

    describe('addComment', () => {
        it('calls issues.createComment and returns mapped Comment', async () => {
            const comment = await adapter.addComment(10, 'LGTM');
            expect(octokit.issues.createComment).toHaveBeenCalledWith({
                owner: 'owner',
                repo: 'repo',
                issue_number: 10,
                body: 'LGTM',
            });
            expect(comment.body).toBe('Can reproduce this.');
        });
    });

    describe('closed issue mapping', () => {
        it('maps closed_at date for closed issue', async () => {
            (octokit.issues.get as ReturnType<typeof vi.fn>).mockResolvedValue({
                data: { ...mockGitHubIssue, state: 'closed', closed_at: '2024-02-01T00:00:00Z' },
            });
            const wi = await adapter.getWorkItem(10);
            expect(wi.state).toBe('closed');
            expect(wi.closedAt).toEqual(new Date('2024-02-01T00:00:00Z'));
        });
    });
});
