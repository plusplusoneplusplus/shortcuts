import type { IGitApi } from 'azure-devops-node-api/GitApi';
import type {
    GitCommitRef,
    GitPullRequest,
    GitPullRequestSearchCriteria,
    GitPullRequestCommentThread,
    GitPullRequestStatus,
    GitStatus,
    IdentityRefWithVote,
    GitPullRequestIteration,
    GitPullRequestIterationChanges,
    GitPullRequestChange,
    GitVersionDescriptor,
} from 'azure-devops-node-api/interfaces/GitInterfaces';
import {
    GitStatusState,
    VersionControlChangeType,
    GitVersionType,
    PullRequestStatus,
} from 'azure-devops-node-api/interfaces/GitInterfaces';
import type { WebApi } from 'azure-devops-node-api';
import { getLogger, LogCategory } from '../logger';

export type { GitPullRequest, GitPullRequestSearchCriteria, GitPullRequestCommentThread };
export type { IdentityRefWithVote };
export type { GitPullRequestIteration, GitPullRequestIterationChanges, GitPullRequestChange, GitCommitRef };
export type { GitPullRequestStatus, GitStatus };
export { GitStatusState, VersionControlChangeType, GitVersionType, PullRequestStatus };

export interface AdoReviewedPullRequestCandidate {
    pullRequest: GitPullRequest;
    reviewer: IdentityRefWithVote;
}

const MEANINGFUL_REVIEW_VOTES = new Set([10, 5, -10, -5]);

function sameAdoIdentity(left: string | undefined, right: string): boolean {
    return (left ?? '').toLowerCase() === right.toLowerCase();
}

function getReviewHistoryTimestamp(pr: GitPullRequest): number {
    const closedDate = pr.closedDate ? new Date(pr.closedDate).getTime() : Number.NaN;
    if (Number.isFinite(closedDate)) return closedDate;
    const createdDate = pr.creationDate ? new Date(pr.creationDate).getTime() : Number.NaN;
    return Number.isFinite(createdDate) ? createdDate : 0;
}

/** Error class for pull-request operations. */
export class AdoPullRequestError extends Error {
    constructor(message: string, public readonly cause?: unknown) {
        super(message);
        this.name = 'AdoPullRequestError';
    }
}

/** Thrown when a pull request lookup returns null/undefined. */
export class AdoPullRequestNotFoundError extends Error {
    constructor(pullRequestId: number) {
        super(`ADO pull request #${pullRequestId} not found`);
        this.name = 'AdoPullRequestNotFoundError';
    }
}

/**
 * Ergonomic wrapper around `IGitApi` for common pull-request
 * operations: list, get, create, update, threads, and reviewers.
 */
export class AdoPullRequestsService {
    private gitApi: IGitApi | null = null;

    constructor(private readonly connection: WebApi) {}

    // ── query ────────────────────────────────────────────────

    async listPullRequests(
        repositoryId: string,
        searchCriteria: GitPullRequestSearchCriteria,
        project?: string,
        top?: number,
        skip?: number,
    ): Promise<GitPullRequest[]> {
        const logger = getLogger();
        logger.info(LogCategory.ADO, `listPullRequests: repo=${repositoryId} project=${project ?? '(default)'} top=${top ?? '(all)'} skip=${skip ?? 0} criteria=${JSON.stringify(searchCriteria)}`);
        const api = await this.getGitApi();
        try {
            const result = await api.getPullRequests(repositoryId, searchCriteria, project, undefined, skip, top);
            const prs = result ?? [];
            logger.info(LogCategory.ADO, `listPullRequests: returned ${prs.length} PR(s) for repo=${repositoryId}`);
            return prs;
        } catch (err) {
            const errMsg = err instanceof Error ? err.message : String(err);
            logger.error(LogCategory.ADO, `listPullRequests failed: repo=${repositoryId}: ${errMsg}`);
            throw new AdoPullRequestError(`Failed to list pull requests for repo ${repositoryId}`, err);
        }
    }

    async getPullRequestById(
        pullRequestId: number,
        project?: string,
    ): Promise<GitPullRequest> {
        const logger = getLogger();
        logger.info(LogCategory.ADO, `getPullRequestById: id=${pullRequestId} project=${project ?? '(default)'}`);
        const api = await this.getGitApi();
        try {
            const result = await api.getPullRequestById(pullRequestId, project);
            if (!result) {
                logger.warn(LogCategory.ADO, `getPullRequestById: PR #${pullRequestId} not found`);
                throw new AdoPullRequestNotFoundError(pullRequestId);
            }
            logger.info(LogCategory.ADO, `getPullRequestById: found PR #${pullRequestId} title="${result.title ?? ''}"`);
            return result;
        } catch (err) {
            if (err instanceof AdoPullRequestNotFoundError) { throw err; }
            const errMsg = err instanceof Error ? err.message : String(err);
            logger.error(LogCategory.ADO, `getPullRequestById failed: id=${pullRequestId}: ${errMsg}`);
            throw new AdoPullRequestError(`Failed to get pull request ${pullRequestId}`, err);
        }
    }

    // ── mutations ────────────────────────────────────────────

    /**
     * Create a new pull request.
     * `sourceRefName` and `targetRefName` must be full ref paths (e.g. `refs/heads/my-branch`).
     */
    async createPullRequest(
        repositoryId: string,
        pr: Pick<GitPullRequest, 'title' | 'description' | 'sourceRefName' | 'targetRefName'> & { reviewers?: GitPullRequest['reviewers'] },
        project?: string,
    ): Promise<GitPullRequest> {
        const logger = getLogger();
        logger.info(LogCategory.ADO, `createPullRequest: repo=${repositoryId} project=${project ?? '(default)'} "${pr.sourceRefName}" -> "${pr.targetRefName}" title="${pr.title ?? ''}"`);
        const api = await this.getGitApi();
        const payload: GitPullRequest = {
            title: pr.title,
            description: pr.description,
            sourceRefName: pr.sourceRefName,
            targetRefName: pr.targetRefName,
            reviewers: pr.reviewers,
        };
        try {
            const result = await api.createPullRequest(payload, repositoryId, project);
            logger.info(LogCategory.ADO, `createPullRequest: created PR #${result.pullRequestId ?? '?'} in repo=${repositoryId}`);
            return result;
        } catch (err) {
            const errMsg = err instanceof Error ? err.message : String(err);
            logger.error(LogCategory.ADO, `createPullRequest failed: repo=${repositoryId}: ${errMsg}`);
            throw new AdoPullRequestError(`Failed to create pull request in repo ${repositoryId}`, err);
        }
    }

    async updatePullRequest(
        repositoryId: string,
        pullRequestId: number,
        update: Partial<Pick<GitPullRequest, 'title' | 'description' | 'status' | 'autoCompleteSetBy' | 'completionOptions' | 'mergeOptions'>>,
        project?: string,
    ): Promise<GitPullRequest> {
        const logger = getLogger();
        logger.info(LogCategory.ADO, `updatePullRequest: repo=${repositoryId} id=${pullRequestId} project=${project ?? '(default)'} fields=${Object.keys(update).join(',')}`);
        const api = await this.getGitApi();
        try {
            const result = await api.updatePullRequest(update as GitPullRequest, repositoryId, pullRequestId, project);
            logger.info(LogCategory.ADO, `updatePullRequest: updated PR #${pullRequestId} in repo=${repositoryId}`);
            return result;
        } catch (err) {
            const errMsg = err instanceof Error ? err.message : String(err);
            logger.error(LogCategory.ADO, `updatePullRequest failed: repo=${repositoryId} id=${pullRequestId}: ${errMsg}`);
            throw new AdoPullRequestError(`Failed to update pull request ${pullRequestId}`, err);
        }
    }

    // ── review threads ───────────────────────────────────────

    async createThread(
        repositoryId: string,
        pullRequestId: number,
        thread: GitPullRequestCommentThread,
        project?: string,
    ): Promise<GitPullRequestCommentThread> {
        const logger = getLogger();
        logger.info(LogCategory.ADO, `createThread: repo=${repositoryId} PR #${pullRequestId} project=${project ?? '(default)'} comments=${thread.comments?.length ?? 0}`);
        const api = await this.getGitApi();
        try {
            const result = await api.createThread(thread, repositoryId, pullRequestId, project);
            logger.info(LogCategory.ADO, `createThread: created thread id=${result.id ?? '?'} on PR #${pullRequestId}`);
            return result;
        } catch (err) {
            const errMsg = err instanceof Error ? err.message : String(err);
            logger.error(LogCategory.ADO, `createThread failed: repo=${repositoryId} PR #${pullRequestId}: ${errMsg}`);
            throw new AdoPullRequestError(`Failed to create thread on PR ${pullRequestId}`, err);
        }
    }

    async getThreads(
        repositoryId: string,
        pullRequestId: number,
        project?: string,
    ): Promise<GitPullRequestCommentThread[]> {
        const logger = getLogger();
        logger.info(LogCategory.ADO, `getThreads: repo=${repositoryId} PR #${pullRequestId} project=${project ?? '(default)'}`);
        const api = await this.getGitApi();
        try {
            const result = await api.getThreads(repositoryId, pullRequestId, project);
            const threads = result ?? [];
            logger.info(LogCategory.ADO, `getThreads: returned ${threads.length} thread(s) for PR #${pullRequestId}`);
            return threads;
        } catch (err) {
            const errMsg = err instanceof Error ? err.message : String(err);
            logger.error(LogCategory.ADO, `getThreads failed: repo=${repositoryId} PR #${pullRequestId}: ${errMsg}`);
            throw new AdoPullRequestError(`Failed to get threads for PR ${pullRequestId}`, err);
        }
    }

    // ── reviewers ────────────────────────────────────────────

    async addReviewers(
        repositoryId: string,
        pullRequestId: number,
        reviewers: IdentityRefWithVote[],
        project?: string,
    ): Promise<IdentityRefWithVote[]> {
        const logger = getLogger();
        logger.info(LogCategory.ADO, `addReviewers: repo=${repositoryId} PR #${pullRequestId} project=${project ?? '(default)'} count=${reviewers.length}`);
        const api = await this.getGitApi();
        try {
            const result = await api.createPullRequestReviewers(reviewers, repositoryId, pullRequestId, project);
            const added = result ?? [];
            logger.info(LogCategory.ADO, `addReviewers: added ${added.length} reviewer(s) to PR #${pullRequestId}`);
            return added;
        } catch (err) {
            const errMsg = err instanceof Error ? err.message : String(err);
            logger.error(LogCategory.ADO, `addReviewers failed: repo=${repositoryId} PR #${pullRequestId}: ${errMsg}`);
            throw new AdoPullRequestError(`Failed to add reviewers to PR ${pullRequestId}`, err);
        }
    }

    async getReviewers(
        repositoryId: string,
        pullRequestId: number,
        project?: string,
    ): Promise<IdentityRefWithVote[]> {
        const logger = getLogger();
        logger.info(LogCategory.ADO, `getReviewers: repo=${repositoryId} PR #${pullRequestId} project=${project ?? '(default)'}`);
        const api = await this.getGitApi();
        try {
            const result = await api.getPullRequestReviewers(repositoryId, pullRequestId, project);
            const reviewers = result ?? [];
            logger.info(LogCategory.ADO, `getReviewers: returned ${reviewers.length} reviewer(s) for PR #${pullRequestId}`);
            return reviewers;
        } catch (err) {
            const errMsg = err instanceof Error ? err.message : String(err);
            logger.error(LogCategory.ADO, `getReviewers failed: repo=${repositoryId} PR #${pullRequestId}: ${errMsg}`);
            throw new AdoPullRequestError(`Failed to get reviewers for PR ${pullRequestId}`, err);
        }
    }

    async listReviewedPullRequestCandidates(
        repositoryId: string,
        currentUserId: string | undefined,
        project?: string,
        top: number = 50,
    ): Promise<AdoReviewedPullRequestCandidate[]> {
        if (!currentUserId || top <= 0) {
            return [];
        }

        const candidateTop = Math.min(Math.max(top * 4, top), 200);
        const statuses = [PullRequestStatus.Completed, PullRequestStatus.Abandoned];
        const candidates = (
            await Promise.all(statuses.map(status => this.listPullRequests(
                repositoryId,
                { status, reviewerId: currentUserId },
                project,
                candidateTop,
            )))
        ).flat();

        const byId = new Map<number, AdoReviewedPullRequestCandidate>();
        for (const pullRequest of candidates) {
            const pullRequestId = pullRequest.pullRequestId;
            if (pullRequestId == null || byId.has(pullRequestId)) {
                continue;
            }
            const reviewer = (pullRequest.reviewers ?? []).find(candidate =>
                sameAdoIdentity(candidate.id, currentUserId)
                && MEANINGFUL_REVIEW_VOTES.has(candidate.vote ?? 0),
            );
            if (!reviewer) {
                continue;
            }
            byId.set(pullRequestId, { pullRequest, reviewer });
        }

        return [...byId.values()]
            .sort((a, b) => getReviewHistoryTimestamp(b.pullRequest) - getReviewHistoryTimestamp(a.pullRequest))
            .slice(0, top);
    }

    // ── iterations & file content ───────────────────────────

    async getPullRequestIterations(
        repositoryId: string,
        pullRequestId: number,
        project?: string,
    ): Promise<GitPullRequestIteration[]> {
        const api = await this.getGitApi();
        try {
            getLogger().info(
                LogCategory.ADO,
                `Getting iterations for PR ${pullRequestId} in repo ${repositoryId}`,
            );
            const result = await api.getPullRequestIterations(
                repositoryId,
                pullRequestId,
                project,
                false,
            );
            return result ?? [];
        } catch (error) {
            throw new AdoPullRequestError(
                `Failed to get iterations for PR ${pullRequestId}: ${error}`,
            );
        }
    }

    async getPullRequestIterationChanges(
        repositoryId: string,
        pullRequestId: number,
        iterationId: number,
        project?: string,
    ): Promise<GitPullRequestIterationChanges> {
        const api = await this.getGitApi();
        try {
            getLogger().info(
                LogCategory.ADO,
                `Getting iteration changes for PR ${pullRequestId}, iteration ${iterationId}`,
            );
            const result = await api.getPullRequestIterationChanges(
                repositoryId,
                pullRequestId,
                iterationId,
                project,
            );
            return result ?? { changeEntries: [] };
        } catch (error) {
            throw new AdoPullRequestError(
                `Failed to get iteration changes for PR ${pullRequestId}, iteration ${iterationId}: ${error}`,
            );
        }
    }

    async getPullRequestCommits(
        repositoryId: string,
        pullRequestId: number,
        project?: string,
    ): Promise<GitCommitRef[]> {
        const api = await this.getGitApi();
        const logger = getLogger();
        try {
            logger.info(
                LogCategory.ADO,
                `getPullRequestCommits: repo=${repositoryId} PR #${pullRequestId} project=${project ?? '(default)'}`,
            );
            const result = await api.getPullRequestCommits(repositoryId, pullRequestId, project);
            // ADO returns a PagedList<GitCommitRef>; it's array-shaped at runtime.
            const commits = (result as unknown as GitCommitRef[] | undefined) ?? [];
            logger.info(
                LogCategory.ADO,
                `getPullRequestCommits: returned ${commits.length} commit(s) for PR #${pullRequestId}`,
            );
            return commits;
        } catch (err) {
            const errMsg = err instanceof Error ? err.message : String(err);
            logger.error(
                LogCategory.ADO,
                `getPullRequestCommits failed: repo=${repositoryId} PR #${pullRequestId}: ${errMsg}`,
            );
            throw new AdoPullRequestError(
                `Failed to get commits for PR ${pullRequestId}`,
                err,
            );
        }
    }

    /**
     * Fetch all per-PR statuses (e.g. build/CI statuses posted against the
     * pull request itself). Returns an empty list on failure (best-effort).
     */
    async getPullRequestStatuses(
        repositoryId: string,
        pullRequestId: number,
        project?: string,
    ): Promise<GitPullRequestStatus[]> {
        const logger = getLogger();
        const api = await this.getGitApi();
        try {
            logger.info(
                LogCategory.ADO,
                `getPullRequestStatuses: repo=${repositoryId} PR #${pullRequestId} project=${project ?? '(default)'}`,
            );
            const result = await api.getPullRequestStatuses(repositoryId, pullRequestId, project);
            const statuses = (result as unknown as GitPullRequestStatus[] | undefined) ?? [];
            logger.info(
                LogCategory.ADO,
                `getPullRequestStatuses: returned ${statuses.length} status(es) for PR #${pullRequestId}`,
            );
            return statuses;
        } catch (err) {
            const errMsg = err instanceof Error ? err.message : String(err);
            logger.warn(
                LogCategory.ADO,
                `getPullRequestStatuses failed: repo=${repositoryId} PR #${pullRequestId}: ${errMsg}`,
            );
            return [];
        }
    }

    /**
     * Fetch per-commit statuses for a given commit SHA (latest run per
     * context). Returns an empty list on failure (best-effort).
     */
    async getCommitStatuses(
        repositoryId: string,
        commitId: string,
        project?: string,
    ): Promise<GitStatus[]> {
        const logger = getLogger();
        const api = await this.getGitApi();
        try {
            logger.info(
                LogCategory.ADO,
                `getCommitStatuses: repo=${repositoryId} commit=${commitId} project=${project ?? '(default)'}`,
            );
            const result = await api.getStatuses(commitId, repositoryId, project, undefined, undefined, true);
            const statuses = (result as unknown as GitStatus[] | undefined) ?? [];
            logger.info(
                LogCategory.ADO,
                `getCommitStatuses: returned ${statuses.length} status(es) for commit ${commitId}`,
            );
            return statuses;
        } catch (err) {
            const errMsg = err instanceof Error ? err.message : String(err);
            logger.warn(
                LogCategory.ADO,
                `getCommitStatuses failed: repo=${repositoryId} commit=${commitId}: ${errMsg}`,
            );
            return [];
        }
    }

    async getFileContent(
        repositoryId: string,
        filePath: string,
        commitId: string,
        project?: string,
    ): Promise<string> {
        const api = await this.getGitApi();
        try {
            getLogger().info(
                LogCategory.ADO,
                `Getting file content for ${filePath} at commit ${commitId}`,
            );
            const versionDescriptor: GitVersionDescriptor = {
                version: commitId,
                versionType: GitVersionType.Commit,
            };
            const stream = await api.getItemText(
                repositoryId,
                filePath,
                project,
                undefined,           // scopePath
                undefined,           // recursionLevel
                false,               // includeContentMetadata
                false,               // latestProcessedChange
                false,               // download
                versionDescriptor,
            );
            if (!stream) {
                return '';
            }
            const chunks: string[] = [];
            await new Promise<void>((resolve, reject) => {
                stream.on('data', (chunk: Buffer | string) => {
                    chunks.push(typeof chunk === 'string' ? chunk : chunk.toString('utf8'));
                });
                stream.on('end', resolve);
                stream.on('error', reject);
            });
            return chunks.join('');
        } catch (error) {
            // File may not exist at this commit (Add/Delete cases) — return empty string.
            getLogger().info(
                LogCategory.ADO,
                `File ${filePath} not found at commit ${commitId}: ${error}`,
            );
            return '';
        }
    }

    // ── internals ────────────────────────────────────────────

    private async getGitApi(): Promise<IGitApi> {
        if (this.gitApi) { return this.gitApi; }
        const logger = getLogger();
        try {
            this.gitApi = await this.connection.getGitApi();
            logger.info(LogCategory.ADO, 'getGitApi: Git API client initialized');
            return this.gitApi;
        } catch (err) {
            const errMsg = err instanceof Error ? err.message : String(err);
            logger.error(LogCategory.ADO, `getGitApi: failed to initialize Git API client: ${errMsg}`);
            throw new AdoPullRequestError('Failed to get Git API client', err);
        }
    }
}
