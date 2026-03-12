import type { Octokit } from '@octokit/rest';
import type { IPullRequestsService } from '../providers/interfaces';
import type {
    Comment,
    CommentThread,
    CreatePullRequestInput,
    Identity,
    PullRequest,
    PullRequestStatus,
    Reviewer,
    ReviewVote,
    SearchCriteria,
    UpdatePullRequestInput,
} from '../providers/types';
import type { GitHubComment, GitHubPullRequest, GitHubReview, GitHubUser } from './types';

// ── mapping helpers ──────────────────────────────────────────

function mapGitHubUser(user: GitHubUser | null | undefined): Identity {
    return {
        id: String(user?.id ?? ''),
        displayName: user?.name ?? user?.login ?? '',
        email: user?.email ?? undefined,
        avatarUrl: user?.avatar_url,
    };
}

function mapGitHubPrStatus(pr: GitHubPullRequest): PullRequestStatus {
    if (pr.draft) { return 'draft'; }
    if (pr.state === 'closed') {
        return pr.merged_at ? 'merged' : 'closed';
    }
    return 'open';
}

function mapGitHubReviewVote(state: GitHubReview['state']): ReviewVote {
    switch (state) {
        case 'APPROVED':           return 'approved';
        case 'CHANGES_REQUESTED':  return 'rejected';
        case 'DISMISSED':          return 'no-vote';
        default:                   return 'no-vote';
    }
}

function mapGitHubPullRequest(pr: GitHubPullRequest, owner: string, repo: string): PullRequest {
    return {
        id: pr.id,
        number: pr.number,
        title: pr.title,
        description: pr.body ?? '',
        author: mapGitHubUser(pr.user),
        sourceBranch: pr.head.ref,
        targetBranch: pr.base.ref,
        status: mapGitHubPrStatus(pr),
        isDraft: pr.draft,
        createdAt: new Date(pr.created_at),
        updatedAt: new Date(pr.updated_at),
        mergedAt: pr.merged_at ? new Date(pr.merged_at) : undefined,
        closedAt: pr.closed_at ? new Date(pr.closed_at) : undefined,
        url: pr.html_url,
        repositoryId: `${owner}/${repo}`,
        reviewers: [],
        labels: pr.labels.map(l => l.name),
        raw: pr,
    };
}

function mapGitHubComment(c: GitHubComment): Comment {
    return {
        id: c.id,
        author: mapGitHubUser(c.user),
        body: c.body,
        createdAt: new Date(c.created_at),
        updatedAt: new Date(c.updated_at),
        url: c.html_url,
    };
}

// ── adapter ──────────────────────────────────────────────────

/**
 * Skeleton GitHub adapter implementing `IPullRequestsService` via
 * the GitHub REST API (Octokit). Supports PAT and GitHub App tokens.
 */
export class GitHubPullRequestsAdapter implements IPullRequestsService {
    private readonly owner: string;
    private readonly repo: string;

    constructor(
        private readonly octokit: Octokit,
        ownerRepo: { owner: string; repo: string },
    ) {
        this.owner = ownerRepo.owner;
        this.repo = ownerRepo.repo;
    }

    async listPullRequests(_repositoryId: string, criteria?: SearchCriteria): Promise<PullRequest[]> {
        const state = criteria?.status === 'closed' || criteria?.status === 'merged' ? 'closed'
            : criteria?.status === 'open' ? 'open'
            : 'open';

        const { data } = await this.octokit.pulls.list({
            owner: this.owner,
            repo: this.repo,
            state,
            head: criteria?.sourceBranch ? `${this.owner}:${criteria.sourceBranch}` : undefined,
            base: criteria?.targetBranch,
            per_page: criteria?.top ?? 30,
        });

        return (data as unknown as GitHubPullRequest[]).map(pr =>
            mapGitHubPullRequest(pr, this.owner, this.repo),
        );
    }

    async getPullRequest(_repositoryId: string, pullRequestId: number | string): Promise<PullRequest> {
        const { data } = await this.octokit.pulls.get({
            owner: this.owner,
            repo: this.repo,
            pull_number: Number(pullRequestId),
        });

        return mapGitHubPullRequest(data as unknown as GitHubPullRequest, this.owner, this.repo);
    }

    async createPullRequest(_repositoryId: string, input: CreatePullRequestInput): Promise<PullRequest> {
        const { data } = await this.octokit.pulls.create({
            owner: this.owner,
            repo: this.repo,
            title: input.title,
            body: input.description,
            head: input.sourceBranch,
            base: input.targetBranch,
            draft: input.isDraft,
        });

        return mapGitHubPullRequest(data as unknown as GitHubPullRequest, this.owner, this.repo);
    }

    async updatePullRequest(
        _repositoryId: string,
        pullRequestId: number | string,
        update: UpdatePullRequestInput,
    ): Promise<PullRequest> {
        const { data } = await this.octokit.pulls.update({
            owner: this.owner,
            repo: this.repo,
            pull_number: Number(pullRequestId),
            title: update.title,
            body: update.description,
        });

        return mapGitHubPullRequest(data as unknown as GitHubPullRequest, this.owner, this.repo);
    }

    async getThreads(_repositoryId: string, pullRequestId: number | string): Promise<CommentThread[]> {
        const { data } = await this.octokit.pulls.listReviewComments({
            owner: this.owner,
            repo: this.repo,
            pull_number: Number(pullRequestId),
        });

        // GitHub review comments are flat; group each as a single-comment thread
        return (data as unknown as GitHubComment[]).map(c => ({
            id: c.id,
            comments: [mapGitHubComment(c)],
            status: 'active' as const,
            createdAt: new Date(c.created_at),
        }));
    }

    async createThread(
        _repositoryId: string,
        pullRequestId: number | string,
        body: string,
    ): Promise<CommentThread> {
        const { data } = await this.octokit.issues.createComment({
            owner: this.owner,
            repo: this.repo,
            issue_number: Number(pullRequestId),
            body,
        });

        const comment = mapGitHubComment(data as unknown as GitHubComment);
        return {
            id: comment.id,
            comments: [comment],
            status: 'active',
            createdAt: comment.createdAt,
        };
    }

    async getReviewers(_repositoryId: string, pullRequestId: number | string): Promise<Reviewer[]> {
        const { data } = await this.octokit.pulls.listReviews({
            owner: this.owner,
            repo: this.repo,
            pull_number: Number(pullRequestId),
        });

        return (data as unknown as GitHubReview[]).map(r => ({
            identity: mapGitHubUser(r.user),
            vote: mapGitHubReviewVote(r.state),
            isRequired: false,
        }));
    }

    async addReviewers(
        _repositoryId: string,
        pullRequestId: number | string,
        reviewerIds: string[],
    ): Promise<Reviewer[]> {
        await this.octokit.pulls.requestReviewers({
            owner: this.owner,
            repo: this.repo,
            pull_number: Number(pullRequestId),
            reviewers: reviewerIds,
        });

        return this.getReviewers(_repositoryId, pullRequestId);
    }
}
