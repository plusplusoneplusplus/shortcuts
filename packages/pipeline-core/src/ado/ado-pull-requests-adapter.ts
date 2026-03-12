import type { GitPullRequest, GitPullRequestCommentThread, IdentityRefWithVote } from 'azure-devops-node-api/interfaces/GitInterfaces';
import { PullRequestStatus as AdoPrStatus } from 'azure-devops-node-api/interfaces/GitInterfaces';
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
import type { AdoPullRequestsService } from './pull-requests-service';

// ── mapping helpers ──────────────────────────────────────────

function mapAdoVoteToReviewVote(vote: number | undefined): ReviewVote {
    switch (vote) {
        case 10: return 'approved';
        case 5:  return 'approved-with-suggestions';
        case -10: return 'rejected';
        case -5: return 'waiting-for-author';
        default: return 'no-vote';
    }
}

function mapAdoStatusToPrStatus(status: number | undefined): PullRequestStatus {
    switch (status) {
        case AdoPrStatus.Active:    return 'open';
        case AdoPrStatus.Completed: return 'merged';
        case AdoPrStatus.Abandoned: return 'closed';
        default:                    return 'open';
    }
}

function mapAdoIdentity(ref: { id?: string; displayName?: string; uniqueName?: string; imageUrl?: string } | undefined): Identity {
    return {
        id: ref?.id ?? '',
        displayName: ref?.displayName ?? '',
        email: ref?.uniqueName,
        avatarUrl: ref?.imageUrl,
    };
}

function mapAdoReviewer(r: IdentityRefWithVote): Reviewer {
    return {
        identity: mapAdoIdentity(r),
        vote: mapAdoVoteToReviewVote(r.vote),
        isRequired: r.isRequired ?? false,
    };
}

function stripBranchPrefix(ref: string | undefined): string {
    return (ref ?? '').replace(/^refs\/heads\//, '');
}

function mapAdoPullRequest(pr: GitPullRequest, repositoryId: string): PullRequest {
    const isDraft = pr.isDraft ?? false;
    const status = isDraft ? 'draft' : mapAdoStatusToPrStatus(pr.status);
    return {
        id: pr.pullRequestId ?? 0,
        number: pr.pullRequestId ?? 0,
        title: pr.title ?? '',
        description: pr.description ?? '',
        author: mapAdoIdentity(pr.createdBy),
        sourceBranch: stripBranchPrefix(pr.sourceRefName),
        targetBranch: stripBranchPrefix(pr.targetRefName),
        status,
        isDraft,
        createdAt: pr.creationDate ? new Date(pr.creationDate) : new Date(0),
        updatedAt: pr.creationDate ? new Date(pr.creationDate) : new Date(0),
        mergedAt: pr.closedDate && status === 'merged' ? new Date(pr.closedDate) : undefined,
        closedAt: pr.closedDate && status === 'closed' ? new Date(pr.closedDate) : undefined,
        url: pr.url ?? '',
        repositoryId,
        reviewers: (pr.reviewers ?? []).map(mapAdoReviewer),
        labels: (pr.labels ?? []).map((l: { name?: string }) => l.name ?? '').filter(Boolean),
        raw: pr,
    };
}

function mapAdoComment(c: { id?: number; author?: { id?: string; displayName?: string; uniqueName?: string; imageUrl?: string }; content?: string; publishedDate?: Date; lastUpdatedDate?: Date; _links?: { self?: { href?: string } } }): Comment {
    return {
        id: c.id ?? 0,
        author: mapAdoIdentity(c.author),
        body: c.content ?? '',
        createdAt: c.publishedDate ? new Date(c.publishedDate) : new Date(0),
        updatedAt: c.lastUpdatedDate ? new Date(c.lastUpdatedDate) : undefined,
        url: c._links?.self?.href,
    };
}

function mapAdoThread(t: GitPullRequestCommentThread): CommentThread {
    const statusMap: Record<number, CommentThread['status']> = {
        1: 'active',
        2: 'resolved',
        4: 'closed',
    };
    return {
        id: t.id ?? 0,
        comments: (t.comments ?? []).map((c: Parameters<typeof mapAdoComment>[0]) => mapAdoComment(c)),
        status: statusMap[t.status ?? 0] ?? 'unknown',
        createdAt: t.publishedDate ? new Date(t.publishedDate) : new Date(0),
    };
}

// ── adapter ──────────────────────────────────────────────────

/**
 * Adapter that wraps `AdoPullRequestsService` and implements the
 * provider-agnostic `IPullRequestsService` interface.
 */
export class AdoPullRequestsAdapter implements IPullRequestsService {
    constructor(
        private readonly service: AdoPullRequestsService,
        private readonly project?: string,
    ) {}

    async listPullRequests(repositoryId: string, criteria?: SearchCriteria): Promise<PullRequest[]> {
        const adoCriteria: Record<string, unknown> = {};
        if (criteria?.sourceBranch) { adoCriteria['sourceRefName'] = `refs/heads/${criteria.sourceBranch}`; }
        if (criteria?.targetBranch) { adoCriteria['targetRefName'] = `refs/heads/${criteria.targetBranch}`; }

        const results = await this.service.listPullRequests(
            repositoryId,
            adoCriteria,
            this.project,
            criteria?.top,
            criteria?.skip,
        );
        return results.map(pr => mapAdoPullRequest(pr, repositoryId));
    }

    async getPullRequest(repositoryId: string, pullRequestId: number | string): Promise<PullRequest> {
        const pr = await this.service.getPullRequestById(Number(pullRequestId), this.project);
        return mapAdoPullRequest(pr, repositoryId);
    }

    async createPullRequest(repositoryId: string, input: CreatePullRequestInput): Promise<PullRequest> {
        const pr = await this.service.createPullRequest(
            repositoryId,
            {
                title: input.title,
                description: input.description,
                sourceRefName: `refs/heads/${input.sourceBranch}`,
                targetRefName: `refs/heads/${input.targetBranch}`,
                reviewers: (input.reviewerIds ?? []).map(id => ({ id })),
            },
            this.project,
        );
        return mapAdoPullRequest(pr, repositoryId);
    }

    async updatePullRequest(
        repositoryId: string,
        pullRequestId: number | string,
        update: UpdatePullRequestInput,
    ): Promise<PullRequest> {
        const adoUpdate: Record<string, unknown> = {};
        if (update.title !== undefined) { adoUpdate['title'] = update.title; }
        if (update.description !== undefined) { adoUpdate['description'] = update.description; }

        const pr = await this.service.updatePullRequest(
            repositoryId,
            Number(pullRequestId),
            adoUpdate,
            this.project,
        );
        return mapAdoPullRequest(pr, repositoryId);
    }

    async getThreads(repositoryId: string, pullRequestId: number | string): Promise<CommentThread[]> {
        const threads = await this.service.getThreads(repositoryId, Number(pullRequestId), this.project);
        return threads.map(mapAdoThread);
    }

    async createThread(
        repositoryId: string,
        pullRequestId: number | string,
        body: string,
    ): Promise<CommentThread> {
        const thread = await this.service.createThread(
            repositoryId,
            Number(pullRequestId),
            { comments: [{ content: body, commentType: 1 }] },
            this.project,
        );
        return mapAdoThread(thread);
    }

    async getReviewers(repositoryId: string, pullRequestId: number | string): Promise<Reviewer[]> {
        const reviewers = await this.service.getReviewers(repositoryId, Number(pullRequestId), this.project);
        return reviewers.map(mapAdoReviewer);
    }

    async addReviewers(
        repositoryId: string,
        pullRequestId: number | string,
        reviewerIds: string[],
    ): Promise<Reviewer[]> {
        const reviewers = await this.service.addReviewers(
            repositoryId,
            Number(pullRequestId),
            reviewerIds.map(id => ({ id })),
            this.project,
        );
        return reviewers.map(mapAdoReviewer);
    }
}
