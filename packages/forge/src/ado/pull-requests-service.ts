import type { IGitApi } from 'azure-devops-node-api/GitApi';
import type {
    GitPullRequest,
    GitPullRequestSearchCriteria,
    GitPullRequestCommentThread,
    IdentityRefWithVote,
} from 'azure-devops-node-api/interfaces/GitInterfaces';
import type { WebApi } from 'azure-devops-node-api';

export type { GitPullRequest, GitPullRequestSearchCriteria, GitPullRequestCommentThread };
export type { IdentityRefWithVote };
export { PullRequestStatus } from 'azure-devops-node-api/interfaces/GitInterfaces';

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
        const api = await this.getGitApi();
        try {
            const result = await api.getPullRequests(repositoryId, searchCriteria, project, undefined, skip, top);
            return result ?? [];
        } catch (err) {
            throw new AdoPullRequestError(`Failed to list pull requests for repo ${repositoryId}`, err);
        }
    }

    async getPullRequestById(
        pullRequestId: number,
        project?: string,
    ): Promise<GitPullRequest> {
        const api = await this.getGitApi();
        try {
            const result = await api.getPullRequestById(pullRequestId, project);
            if (!result) {
                throw new AdoPullRequestNotFoundError(pullRequestId);
            }
            return result;
        } catch (err) {
            if (err instanceof AdoPullRequestNotFoundError) { throw err; }
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
        const api = await this.getGitApi();
        const payload: GitPullRequest = {
            title: pr.title,
            description: pr.description,
            sourceRefName: pr.sourceRefName,
            targetRefName: pr.targetRefName,
            reviewers: pr.reviewers,
        };
        try {
            return await api.createPullRequest(payload, repositoryId, project);
        } catch (err) {
            throw new AdoPullRequestError(`Failed to create pull request in repo ${repositoryId}`, err);
        }
    }

    async updatePullRequest(
        repositoryId: string,
        pullRequestId: number,
        update: Partial<Pick<GitPullRequest, 'title' | 'description' | 'status' | 'autoCompleteSetBy' | 'completionOptions' | 'mergeOptions'>>,
        project?: string,
    ): Promise<GitPullRequest> {
        const api = await this.getGitApi();
        try {
            return await api.updatePullRequest(update as GitPullRequest, repositoryId, pullRequestId, project);
        } catch (err) {
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
        const api = await this.getGitApi();
        try {
            return await api.createThread(thread, repositoryId, pullRequestId, project);
        } catch (err) {
            throw new AdoPullRequestError(`Failed to create thread on PR ${pullRequestId}`, err);
        }
    }

    async getThreads(
        repositoryId: string,
        pullRequestId: number,
        project?: string,
    ): Promise<GitPullRequestCommentThread[]> {
        const api = await this.getGitApi();
        try {
            const result = await api.getThreads(repositoryId, pullRequestId, project);
            return result ?? [];
        } catch (err) {
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
        const api = await this.getGitApi();
        try {
            const result = await api.createPullRequestReviewers(reviewers, repositoryId, pullRequestId, project);
            return result ?? [];
        } catch (err) {
            throw new AdoPullRequestError(`Failed to add reviewers to PR ${pullRequestId}`, err);
        }
    }

    async getReviewers(
        repositoryId: string,
        pullRequestId: number,
        project?: string,
    ): Promise<IdentityRefWithVote[]> {
        const api = await this.getGitApi();
        try {
            const result = await api.getPullRequestReviewers(repositoryId, pullRequestId, project);
            return result ?? [];
        } catch (err) {
            throw new AdoPullRequestError(`Failed to get reviewers for PR ${pullRequestId}`, err);
        }
    }

    // ── internals ────────────────────────────────────────────

    private async getGitApi(): Promise<IGitApi> {
        if (this.gitApi) { return this.gitApi; }
        try {
            this.gitApi = await this.connection.getGitApi();
            return this.gitApi;
        } catch (err) {
            throw new AdoPullRequestError('Failed to get Git API client', err);
        }
    }
}
