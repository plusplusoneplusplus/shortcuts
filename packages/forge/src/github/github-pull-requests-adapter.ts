import type { Octokit } from '@octokit/rest';
import type { IPullRequestsService } from '../providers/interfaces';
import type {
    CheckStatus,
    Comment,
    CommentThread,
    CreatePullRequestInput,
    Identity,
    PullRequest,
    PullRequestCheck,
    PullRequestCommit,
    PullRequestStatus,
    Reviewer,
    ReviewVote,
    SearchCriteria,
    UpdatePullRequestInput,
} from '../providers/types';
import type {
    GitHubCheckRun,
    GitHubComment,
    GitHubCombinedStatusItem,
    GitHubCombinedStatusResponse,
    GitHubPullRequest,
    GitHubPullRequestCommit,
    GitHubReview,
    GitHubUser,
} from './types';

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

function firstLine(text: string): string {
    const idx = text.indexOf('\n');
    return idx === -1 ? text : text.slice(0, idx);
}

function mapGitHubCommitIdentity(
    user: GitHubUser | null | undefined,
    fallbackName: string | null | undefined,
    fallbackEmail: string | null | undefined,
): Identity {
    return {
        id: user ? String(user.id) : '',
        displayName: user?.name ?? user?.login ?? fallbackName ?? '',
        email: user?.email ?? fallbackEmail ?? undefined,
        avatarUrl: user?.avatar_url,
    };
}

function parseGitHubCommitDate(value: string | null | undefined): Date {
    if (!value) return new Date(0);
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? new Date(0) : parsed;
}

function mapGitHubPullRequestCommit(c: GitHubPullRequestCommit): PullRequestCommit {
    const message = c.commit?.message ?? '';
    const authoredAt = parseGitHubCommitDate(c.commit?.author?.date);
    const committedAt = parseGitHubCommitDate(c.commit?.committer?.date);
    return {
        id: c.sha,
        shortId: c.sha.slice(0, 7),
        message,
        subject: firstLine(message),
        author: mapGitHubCommitIdentity(
            c.author ?? null,
            c.commit?.author?.name,
            c.commit?.author?.email,
        ),
        committer: mapGitHubCommitIdentity(
            c.committer ?? null,
            c.commit?.committer?.name,
            c.commit?.committer?.email,
        ),
        authoredAt,
        committedAt,
        url: c.html_url,
        raw: c,
    };
}

function parseGitHubDate(value: string | null | undefined): Date | undefined {
    if (!value) return undefined;
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? undefined : parsed;
}

function mapCheckRunStatus(run: GitHubCheckRun): CheckStatus {
    if (run.status === 'queued' || run.status === 'waiting' || run.status === 'pending') {
        return 'pending';
    }
    if (run.status === 'in_progress') {
        return 'running';
    }
    // completed — use conclusion
    switch (run.conclusion) {
        case 'success':         return 'success';
        case 'neutral':         return 'success';
        case 'failure':         return 'failure';
        case 'timed_out':       return 'failure';
        case 'cancelled':       return 'cancelled';
        case 'skipped':         return 'skipped';
        case 'stale':           return 'skipped';
        case 'action_required': return 'warning';
        default:                return 'unknown';
    }
}

function mapCheckRun(run: GitHubCheckRun): PullRequestCheck {
    const startedAt = parseGitHubDate(run.started_at);
    const completedAt = parseGitHubDate(run.completed_at);
    return {
        id: `check-${run.id}`,
        name: run.name,
        group: run.app?.name ?? run.app?.slug ?? undefined,
        status: mapCheckRunStatus(run),
        source: 'check',
        description: run.output?.summary ?? run.output?.title ?? undefined,
        detailsUrl: run.html_url ?? run.details_url ?? undefined,
        startedAt,
        completedAt,
        durationMs:
            startedAt && completedAt
                ? Math.max(0, completedAt.getTime() - startedAt.getTime())
                : undefined,
        raw: run,
    };
}

function mapCombinedStatusState(state: GitHubCombinedStatusItem['state']): CheckStatus {
    switch (state) {
        case 'success': return 'success';
        case 'failure': return 'failure';
        case 'error':   return 'failure';
        case 'pending': return 'pending';
        default:        return 'unknown';
    }
}

function mapCombinedStatusItem(item: GitHubCombinedStatusItem): PullRequestCheck {
    const startedAt = parseGitHubDate(item.created_at);
    const completedAt = parseGitHubDate(item.updated_at);
    return {
        id: `status-${item.id}`,
        name: item.context,
        group: undefined,
        status: mapCombinedStatusState(item.state),
        source: 'status',
        description: item.description ?? undefined,
        detailsUrl: item.target_url ?? undefined,
        startedAt,
        completedAt,
        durationMs:
            startedAt && completedAt
                ? Math.max(0, completedAt.getTime() - startedAt.getTime())
                : undefined,
        raw: item,
    };
}

function mapGitHubThreadContext(c: GitHubComment): CommentThread['threadContext'] | undefined {
    if (!c.path) return undefined;
    const side = c.side === 'LEFT' ? 'left' : c.side === 'RIGHT' ? 'right' : 'unknown';
    const line = c.line ?? c.original_line ?? undefined;
    const startLine = c.start_line ?? c.original_start_line ?? undefined;
    return {
        filePath: c.path,
        line,
        startLine,
        endLine: line,
        side,
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
            threadContext: mapGitHubThreadContext(c),
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

    async getDiff(_repositoryId: string, pullRequestId: number | string): Promise<string> {
        const response = await (this.octokit as any).request(
            'GET /repos/{owner}/{repo}/pulls/{pull_number}',
            {
                owner: this.owner,
                repo: this.repo,
                pull_number: Number(pullRequestId),
                headers: {
                    accept: 'application/vnd.github.diff',
                },
            },
        );
        return String(response.data ?? '');
    }

    async getCommits(_repositoryId: string, pullRequestId: number | string): Promise<PullRequestCommit[]> {
        const { data } = await this.octokit.pulls.listCommits({
            owner: this.owner,
            repo: this.repo,
            pull_number: Number(pullRequestId),
            per_page: 100,
        });

        return (data as unknown as GitHubPullRequestCommit[]).map(mapGitHubPullRequestCommit);
    }

    async getChecks(_repositoryId: string, pullRequestId: number | string): Promise<PullRequestCheck[]> {
        // Resolve the head SHA for the PR.
        const { data: prData } = await this.octokit.pulls.get({
            owner: this.owner,
            repo: this.repo,
            pull_number: Number(pullRequestId),
        });
        const headSha = (prData as unknown as GitHubPullRequest).head?.sha;
        if (!headSha) return [];

        const checks: PullRequestCheck[] = [];

        // Modern check-runs (GitHub Apps). Best-effort: failures here should
        // not also break the legacy status fetch.
        try {
            const { data: checkData } = await this.octokit.checks.listForRef({
                owner: this.owner,
                repo: this.repo,
                ref: headSha,
                per_page: 100,
            });
            const runs = (checkData as unknown as { check_runs?: GitHubCheckRun[] }).check_runs ?? [];
            for (const run of runs) {
                checks.push(mapCheckRun(run));
            }
        } catch {
            // Token may lack `checks:read` — fall through to combined status.
        }

        // Legacy combined commit-status (per-context). Best-effort.
        try {
            const { data: statusData } = await this.octokit.repos.getCombinedStatusForRef({
                owner: this.owner,
                repo: this.repo,
                ref: headSha,
            });
            const items = (statusData as unknown as GitHubCombinedStatusResponse).statuses ?? [];
            for (const item of items) {
                checks.push(mapCombinedStatusItem(item));
            }
        } catch {
            // Some repos may have neither checks nor statuses configured.
        }

        return checks;
    }
}
