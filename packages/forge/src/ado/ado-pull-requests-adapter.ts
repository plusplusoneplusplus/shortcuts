import type {
    GitCommitRef,
    GitPullRequest,
    GitPullRequestCommentThread,
    GitPullRequestStatus,
    GitStatus,
    IdentityRefWithVote,
} from 'azure-devops-node-api/interfaces/GitInterfaces';
import { PullRequestStatus as AdoPrStatus } from 'azure-devops-node-api/interfaces/GitInterfaces';
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
    ReviewedPullRequest,
    ReviewVote,
    SearchCriteria,
    UpdatePullRequestInput,
} from '../providers/types';
import type { AdoPullRequestsService } from './pull-requests-service';
import { GitStatusState, VersionControlChangeType } from './pull-requests-service';
import { buildUnifiedDiff } from './diff-builder';
import { getLogger, LogCategory } from '../logger';

// ── mapping helpers ──────────────────────────────────────────

/**
 * Resolve the browser-friendly web URL for a pull request.
 * Priority: _links.web.href > constructed from repository.webUrl > converted from API URL > empty.
 */
function resolveWebUrl(pr: GitPullRequest): string {
    if (pr._links?.web?.href) {
        return pr._links.web.href;
    }
    // Construct from repository.webUrl + pullRequestId
    if (pr.repository?.webUrl && pr.pullRequestId != null) {
        return `${pr.repository.webUrl}/pullrequest/${pr.pullRequestId}`;
    }
    // Convert API URL pattern to web URL:
    //   .../org/proj/_apis/git/repositories/<guid>/pullRequests/<id>
    //   → .../org/proj/_git/<repoName>/pullrequest/<id>
    if (pr.url && pr.repository?.name && pr.pullRequestId != null) {
        const apiPrefix = pr.url.match(/^(https?:\/\/.+?\/.+?\/.+?)\/_apis\/git\/repositories\//);
        if (apiPrefix) {
            return `${apiPrefix[1]}/_git/${pr.repository.name}/pullrequest/${pr.pullRequestId}`;
        }
    }
    return pr.url ?? '';
}

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

function firstLine(message: string | undefined): string {
    return (message ?? '').split(/\r?\n/, 1)[0] ?? '';
}

function reviewedAtFromAdoPullRequest(pr: GitPullRequest): Date {
    // ADO reviewer list payloads do not include per-vote timestamps; closedDate
    // is the closest stable approximation for historical completed/abandoned PRs.
    return pr.closedDate ? new Date(pr.closedDate) : pr.creationDate ? new Date(pr.creationDate) : new Date(0);
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
        url: resolveWebUrl(pr),
        repositoryId,
        reviewers: (pr.reviewers ?? []).map(mapAdoReviewer),
        labels: (pr.labels ?? []).map((l: { name?: string }) => l.name ?? '').filter(Boolean),
        headSha: pr.lastMergeSourceCommit?.commitId,
        baseSha: pr.lastMergeTargetCommit?.commitId,
        raw: pr,
    };
}

function mapAdoCommitIdentity(
    user: { name?: string; email?: string; imageUrl?: string } | undefined,
): Identity {
    return {
        id: '',
        displayName: user?.name ?? '',
        email: user?.email,
        avatarUrl: user?.imageUrl,
    };
}

function mapAdoCommit(commit: GitCommitRef): PullRequestCommit {
    const sha = commit.commitId ?? '';
    const message = commit.comment ?? '';
    const authoredAt = commit.author?.date ? new Date(commit.author.date) : new Date(0);
    const committedAt = commit.committer?.date ? new Date(commit.committer.date) : authoredAt;
    return {
        id: sha,
        shortId: sha.slice(0, 7),
        message,
        subject: firstLine(message),
        author: mapAdoCommitIdentity(commit.author),
        committer: mapAdoCommitIdentity(commit.committer),
        authoredAt,
        committedAt,
        url: commit.remoteUrl ?? commit.url,
        raw: commit,
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

interface AdoThreadContextLocation {
    line?: number;
    offset?: number;
}

interface AdoThreadContextShape {
    filePath?: string;
    rightFileStart?: AdoThreadContextLocation;
    rightFileEnd?: AdoThreadContextLocation;
    leftFileStart?: AdoThreadContextLocation;
    leftFileEnd?: AdoThreadContextLocation;
}

function mapAdoThreadContext(t: GitPullRequestCommentThread): CommentThread['threadContext'] | undefined {
    const context = (t as { threadContext?: AdoThreadContextShape }).threadContext;
    if (!context) return undefined;
    const rightLine = context.rightFileEnd?.line ?? context.rightFileStart?.line;
    const leftLine = context.leftFileEnd?.line ?? context.leftFileStart?.line;
    const line = rightLine ?? leftLine;
    if (!context.filePath && line == null) return undefined;
    return {
        filePath: context.filePath,
        line,
        startLine: context.rightFileStart?.line ?? context.leftFileStart?.line,
        endLine: context.rightFileEnd?.line ?? context.leftFileEnd?.line ?? line,
        side: rightLine != null ? 'right' : leftLine != null ? 'left' : 'unknown',
    };
}

function mapAdoStatusState(state: number | undefined): CheckStatus {
    switch (state) {
        case GitStatusState.Pending:            return 'running';
        case GitStatusState.Succeeded:          return 'success';
        case GitStatusState.Failed:             return 'failure';
        case GitStatusState.Error:              return 'failure';
        case GitStatusState.NotApplicable:      return 'skipped';
        case GitStatusState.PartiallySucceeded: return 'warning';
        case GitStatusState.NotSet:             return 'pending';
        default:                                return 'unknown';
    }
}

function adoStatusName(status: GitStatus): string {
    const ctx = status.context;
    if (!ctx) return `status-${status.id ?? 0}`;
    if (ctx.genre && ctx.name) return `${ctx.genre}/${ctx.name}`;
    return ctx.name ?? ctx.genre ?? `status-${status.id ?? 0}`;
}

function mapAdoCheck(
    status: GitPullRequestStatus | GitStatus,
    source: 'check' | 'status',
    idPrefix: string,
): PullRequestCheck {
    const createdAt = status.creationDate ? new Date(status.creationDate) : undefined;
    const updatedAt = status.updatedDate ? new Date(status.updatedDate) : undefined;
    return {
        id: `${idPrefix}-${status.id ?? 0}`,
        name: adoStatusName(status),
        group: status.context?.genre ?? undefined,
        status: mapAdoStatusState(status.state),
        source,
        description: status.description ?? undefined,
        detailsUrl: status.targetUrl ?? undefined,
        startedAt: createdAt,
        completedAt: updatedAt,
        durationMs:
            createdAt && updatedAt
                ? Math.max(0, updatedAt.getTime() - createdAt.getTime())
                : undefined,
        raw: status,
    };
}

function dedupeChecks(checks: PullRequestCheck[]): PullRequestCheck[] {
    // Keep the most recently updated entry per (source, name) — ADO can post
    // multiple status records per context across retries.
    const byKey = new Map<string, PullRequestCheck>();
    for (const check of checks) {
        const key = `${check.source}::${check.name.toLowerCase()}`;
        const existing = byKey.get(key);
        if (!existing) {
            byKey.set(key, check);
            continue;
        }
        const a = existing.completedAt?.getTime() ?? existing.startedAt?.getTime() ?? 0;
        const b = check.completedAt?.getTime() ?? check.startedAt?.getTime() ?? 0;
        if (b >= a) byKey.set(key, check);
    }
    return Array.from(byKey.values());
}

function uniqueChangedFilePaths(entries: Array<{ item?: { path?: string } | null }>): string[] {
    const paths = new Set<string>();
    for (const entry of entries) {
        const filePath = entry.item?.path;
        if (filePath) paths.add(filePath);
    }
    return [...paths];
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
        threadContext: mapAdoThreadContext(t),
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
        private readonly repo?: string,
        private readonly currentUserId?: string,
    ) {}

    async listPullRequests(repositoryId: string, criteria?: SearchCriteria): Promise<PullRequest[]> {
        const logger = getLogger();
        const effectiveRepo = this.repo ?? repositoryId;
        const adoCriteria: Record<string, unknown> = {};
        if (criteria?.sourceBranch) { adoCriteria['sourceRefName'] = `refs/heads/${criteria.sourceBranch}`; }
        if (criteria?.targetBranch) { adoCriteria['targetRefName'] = `refs/heads/${criteria.targetBranch}`; }

        // Status: default to Active when not specified
        const statusMap: Record<string, AdoPrStatus | undefined> = {
            'open': AdoPrStatus.Active,
            'merged': AdoPrStatus.Completed,
            'closed': AdoPrStatus.Abandoned,
            'all': AdoPrStatus.All,
        };
        const statusValue = criteria?.status ?? 'open';
        const mappedStatus = statusMap[statusValue];
        if (mappedStatus !== undefined) {
            adoCriteria['status'] = mappedStatus;
        } else {
            logger.info(LogCategory.ADO, `listPullRequests: criteria.status="${statusValue}" is not a recognized value — defaulting to active PRs only`);
            adoCriteria['status'] = AdoPrStatus.Active;
        }

        // Author: scope=all skips currentUserId default; scope=mine (or unset) uses it
        const scope = criteria?.scope ?? 'mine';
        const authorId = criteria?.authorId ?? (scope === 'mine' ? this.currentUserId : undefined);
        if (authorId) { adoCriteria['creatorId'] = authorId; }

        logger.info(LogCategory.ADO, `listPullRequests: repo=${effectiveRepo} project=${this.project ?? '(default)'} adoCriteria=${JSON.stringify(adoCriteria)}`);

        const results = await this.service.listPullRequests(
            effectiveRepo,
            adoCriteria,
            this.project,
            criteria?.top,
            criteria?.skip,
        );
        logger.info(LogCategory.ADO, `listPullRequests: mapped ${results.length} PR(s) for repo=${effectiveRepo}`);
        return results.map(pr => mapAdoPullRequest(pr, repositoryId));
    }

    async getPullRequest(repositoryId: string, pullRequestId: number | string): Promise<PullRequest> {
        const logger = getLogger();
        logger.info(LogCategory.ADO, `getPullRequest: repo=${repositoryId} id=${pullRequestId} project=${this.project ?? '(default)'}`);
        const pr = await this.service.getPullRequestById(Number(pullRequestId), this.project);
        logger.info(LogCategory.ADO, `getPullRequest: resolved PR #${pr.pullRequestId ?? '?'} status=${pr.status ?? '?'}`);
        return mapAdoPullRequest(pr, repositoryId);
    }

    async createPullRequest(repositoryId: string, input: CreatePullRequestInput): Promise<PullRequest> {
        const logger = getLogger();
        const effectiveRepo = this.repo ?? repositoryId;
        logger.info(LogCategory.ADO, `createPullRequest: repo=${effectiveRepo} project=${this.project ?? '(default)'} "${input.sourceBranch}" -> "${input.targetBranch}" title="${input.title}"`);
        const pr = await this.service.createPullRequest(
            effectiveRepo,
            {
                title: input.title,
                description: input.description,
                sourceRefName: `refs/heads/${input.sourceBranch}`,
                targetRefName: `refs/heads/${input.targetBranch}`,
                reviewers: (input.reviewerIds ?? []).map(id => ({ id })),
            },
            this.project,
        );
        logger.info(LogCategory.ADO, `createPullRequest: created PR #${pr.pullRequestId ?? '?'} in repo=${repositoryId}`);
        return mapAdoPullRequest(pr, repositoryId);
    }

    async updatePullRequest(
        repositoryId: string,
        pullRequestId: number | string,
        update: UpdatePullRequestInput,
    ): Promise<PullRequest> {
        const logger = getLogger();
        const effectiveRepo = this.repo ?? repositoryId;
        logger.info(LogCategory.ADO, `updatePullRequest: repo=${effectiveRepo} id=${pullRequestId} project=${this.project ?? '(default)'} fields=${Object.keys(update).filter(k => update[k as keyof UpdatePullRequestInput] !== undefined).join(',')}`);
        const adoUpdate: Record<string, unknown> = {};
        if (update.title !== undefined) { adoUpdate['title'] = update.title; }
        if (update.description !== undefined) { adoUpdate['description'] = update.description; }

        const pr = await this.service.updatePullRequest(
            effectiveRepo,
            Number(pullRequestId),
            adoUpdate,
            this.project,
        );
        logger.info(LogCategory.ADO, `updatePullRequest: updated PR #${pr.pullRequestId ?? '?'}`);
        return mapAdoPullRequest(pr, repositoryId);
    }

    async getThreads(repositoryId: string, pullRequestId: number | string): Promise<CommentThread[]> {
        const logger = getLogger();
        const effectiveRepo = this.repo ?? repositoryId;
        logger.info(LogCategory.ADO, `getThreads: repo=${effectiveRepo} id=${pullRequestId} project=${this.project ?? '(default)'}`);
        const threads = await this.service.getThreads(effectiveRepo, Number(pullRequestId), this.project);
        logger.info(LogCategory.ADO, `getThreads: returned ${threads.length} thread(s) for PR #${pullRequestId}`);
        return threads.map(mapAdoThread);
    }

    async createThread(
        repositoryId: string,
        pullRequestId: number | string,
        body: string,
    ): Promise<CommentThread> {
        const logger = getLogger();
        const effectiveRepo = this.repo ?? repositoryId;
        logger.info(LogCategory.ADO, `createThread: repo=${effectiveRepo} PR #${pullRequestId} project=${this.project ?? '(default)'}`);
        const thread = await this.service.createThread(
            effectiveRepo,
            Number(pullRequestId),
            { comments: [{ content: body, commentType: 1 }] },
            this.project,
        );
        logger.info(LogCategory.ADO, `createThread: created thread id=${thread.id ?? '?'} on PR #${pullRequestId}`);
        return mapAdoThread(thread);
    }

    async getReviewers(repositoryId: string, pullRequestId: number | string): Promise<Reviewer[]> {
        const logger = getLogger();
        const effectiveRepo = this.repo ?? repositoryId;
        logger.info(LogCategory.ADO, `getReviewers: repo=${effectiveRepo} PR #${pullRequestId} project=${this.project ?? '(default)'}`);
        const reviewers = await this.service.getReviewers(effectiveRepo, Number(pullRequestId), this.project);
        logger.info(LogCategory.ADO, `getReviewers: returned ${reviewers.length} reviewer(s) for PR #${pullRequestId}`);
        return reviewers.map(mapAdoReviewer);
    }

    async addReviewers(
        repositoryId: string,
        pullRequestId: number | string,
        reviewerIds: string[],
    ): Promise<Reviewer[]> {
        const logger = getLogger();
        const effectiveRepo = this.repo ?? repositoryId;
        logger.info(LogCategory.ADO, `addReviewers: repo=${effectiveRepo} PR #${pullRequestId} project=${this.project ?? '(default)'} ids=${reviewerIds.join(',')}`);
        const reviewers = await this.service.addReviewers(
            effectiveRepo,
            Number(pullRequestId),
            reviewerIds.map(id => ({ id })),
            this.project,
        );
        logger.info(LogCategory.ADO, `addReviewers: added ${reviewers.length} reviewer(s) to PR #${pullRequestId}`);
        return reviewers.map(mapAdoReviewer);
    }

    async getCommits(repositoryId: string, pullRequestId: number | string): Promise<PullRequestCommit[]> {
        const logger = getLogger();
        const effectiveRepo = this.repo ?? repositoryId;
        logger.info(
            LogCategory.ADO,
            `getCommits: repo=${effectiveRepo} PR #${pullRequestId} project=${this.project ?? '(default)'}`,
        );
        const commits = await this.service.getPullRequestCommits(
            effectiveRepo,
            Number(pullRequestId),
            this.project,
        );
        logger.info(
            LogCategory.ADO,
            `getCommits: returned ${commits.length} commit(s) for PR #${pullRequestId}`,
        );
        return commits.map(mapAdoCommit);
    }

    async getChecks(repositoryId: string, pullRequestId: number | string): Promise<PullRequestCheck[]> {
        const logger = getLogger();
        const effectiveRepo = this.repo ?? repositoryId;
        logger.info(
            LogCategory.ADO,
            `getChecks: repo=${effectiveRepo} PR #${pullRequestId} project=${this.project ?? '(default)'}`,
        );

        const out: PullRequestCheck[] = [];

        // Per-PR statuses (e.g. build/CI postings against the PR itself).
        const prStatuses = await this.service.getPullRequestStatuses(
            effectiveRepo,
            Number(pullRequestId),
            this.project,
        );
        for (const status of prStatuses) {
            out.push(mapAdoCheck(status, 'check', 'pr-status'));
        }

        // Per-commit statuses on the head SHA (latest iteration). Best-effort.
        try {
            const iterations = await this.service.getPullRequestIterations(
                effectiveRepo,
                Number(pullRequestId),
                this.project,
            );
            const headSha = iterations.length
                ? iterations[iterations.length - 1].sourceRefCommit?.commitId
                : undefined;
            if (headSha) {
                const commitStatuses = await this.service.getCommitStatuses(
                    effectiveRepo,
                    headSha,
                    this.project,
                );
                for (const status of commitStatuses) {
                    out.push(mapAdoCheck(status, 'status', 'commit-status'));
                }
            }
        } catch (err) {
            logger.warn(
                LogCategory.ADO,
                `getChecks: commit-status fetch failed for PR #${pullRequestId}: ${err instanceof Error ? err.message : String(err)}`,
            );
        }

        return dedupeChecks(out);
    }

    async getReviewedPullRequests(repositoryId: string, top: number = 50): Promise<ReviewedPullRequest[]> {
        if (!this.currentUserId) {
            return [];
        }

        const logger = getLogger();
        const effectiveRepo = this.repo ?? repositoryId;
        logger.info(
            LogCategory.ADO,
            `getReviewedPullRequests: repo=${effectiveRepo} project=${this.project ?? '(default)'} top=${top}`,
        );

        const candidates = await this.service.listReviewedPullRequestCandidates(
            effectiveRepo,
            this.currentUserId,
            this.project,
            top,
        );

        const reviews = await Promise.all(candidates.map(async ({ pullRequest }) => {
            const pullRequestId = pullRequest.pullRequestId ?? 0;
            return {
                number: pullRequestId,
                title: pullRequest.title ?? '',
                author: mapAdoIdentity(pullRequest.createdBy),
                filesChanged: await this.getChangedFilesForReviewHistory(effectiveRepo, pullRequestId),
                labels: (pullRequest.labels ?? []).map((l: { name?: string }) => l.name ?? '').filter(Boolean),
                reviewedAt: reviewedAtFromAdoPullRequest(pullRequest),
                targetBranch: stripBranchPrefix(pullRequest.targetRefName),
                url: resolveWebUrl(pullRequest),
            };
        }));

        logger.info(LogCategory.ADO, `getReviewedPullRequests: mapped ${reviews.length} reviewed PR(s) for repo=${effectiveRepo}`);
        return reviews;
    }

    private async getChangedFilesForReviewHistory(repositoryId: string, pullRequestId: number): Promise<string[]> {
        const logger = getLogger();
        try {
            const iterations = await this.service.getPullRequestIterations(
                repositoryId,
                pullRequestId,
                this.project,
            );
            const latestIteration = [...iterations]
                .filter(iteration => iteration.id != null)
                .sort((a, b) => (b.id ?? 0) - (a.id ?? 0))[0];
            if (!latestIteration?.id) {
                return [];
            }

            const changes = await this.service.getPullRequestIterationChanges(
                repositoryId,
                pullRequestId,
                latestIteration.id,
                this.project,
            );
            return uniqueChangedFilePaths(changes.changeEntries ?? []);
        } catch (err) {
            logger.warn(
                LogCategory.ADO,
                `getReviewedPullRequests: changed-file fetch failed for PR #${pullRequestId}: ${err instanceof Error ? err.message : String(err)}`,
            );
            return [];
        }
    }

    async getDiff(repositoryId: string, pullRequestId: number | string): Promise<string> {
        const logger = getLogger();
        const effectiveRepo = this.repo ?? repositoryId;
        logger.info(LogCategory.ADO, `getDiff: repo=${effectiveRepo} PR #${pullRequestId} project=${this.project ?? '(default)'}`);
        try {
            // Step 1: get iterations, pick last one
            const iterations = await this.service.getPullRequestIterations(
                effectiveRepo,
                Number(pullRequestId),
                this.project,
            );
            if (!iterations.length) return '';

            const lastIteration = iterations[iterations.length - 1];
            const headSha = lastIteration.sourceRefCommit?.commitId;
            const baseSha = lastIteration.commonRefCommit?.commitId;
            if (!headSha || !baseSha) return '';

            // Step 2: get changed files for that iteration
            const iterationId = lastIteration.id!;
            const changes = await this.service.getPullRequestIterationChanges(
                effectiveRepo,
                Number(pullRequestId),
                iterationId,
                this.project,
            );
            const entries = changes.changeEntries ?? [];
            if (!entries.length) return '';

            // Step 3: fetch base+head content per file (parallel)
            const fileDiffs = await Promise.all(
                entries.map(async (entry) => {
                    const filePath = entry.item?.path ?? '';
                    const originalPath = (entry.item as Record<string, unknown> | undefined)?.originalPath as string | undefined;
                    const changeType = entry.changeType ?? 0;

                    const isAdd    = (changeType & VersionControlChangeType.Add)    !== 0;
                    const isDelete = (changeType & VersionControlChangeType.Delete) !== 0;

                    const baseContent = isAdd
                        ? ''
                        : await this.service.getFileContent(effectiveRepo, filePath, baseSha, this.project);
                    const headContent = isDelete
                        ? ''
                        : await this.service.getFileContent(effectiveRepo, filePath, headSha, this.project);

                    return buildUnifiedDiff(filePath, originalPath, baseContent, headContent);
                }),
            );

            return fileDiffs.filter(Boolean).join('\n');
        } catch (err) {
            logger.warn(
                LogCategory.ADO,
                `getDiff failed for PR #${pullRequestId}: ${err instanceof Error ? err.message : String(err)}`,
            );
            return '';
        }
    }
}
