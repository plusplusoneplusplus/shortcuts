import type {
    Comment,
    CommentThread,
    CreatePullRequestInput,
    CreateWorkItemInput,
    PullRequest,
    Reviewer,
    SearchCriteria,
    UpdatePullRequestInput,
    UpdateWorkItemInput,
    WorkItem,
} from './types';

// ── Provider config interfaces ───────────────────────────────

export interface IProviderConfig {
    readonly providerType: string;
}

export interface AdoProviderConfig extends IProviderConfig {
    readonly providerType: 'ado';
    orgUrl: string;
    token: string;
    project?: string;
}

export interface GitHubProviderConfig extends IProviderConfig {
    readonly providerType: 'github';
    /** Personal access token or GitHub App installation token. */
    token: string;
    owner: string;
    repo: string;
    baseUrl?: string;
}

// ── Service interfaces ───────────────────────────────────────

export interface IPullRequestsService {
    listPullRequests(repositoryId: string, criteria?: SearchCriteria): Promise<PullRequest[]>;
    getPullRequest(repositoryId: string, pullRequestId: number | string): Promise<PullRequest>;
    createPullRequest(repositoryId: string, input: CreatePullRequestInput): Promise<PullRequest>;
    updatePullRequest(
        repositoryId: string,
        pullRequestId: number | string,
        update: UpdatePullRequestInput,
    ): Promise<PullRequest>;
    getThreads(repositoryId: string, pullRequestId: number | string): Promise<CommentThread[]>;
    createThread(
        repositoryId: string,
        pullRequestId: number | string,
        body: string,
    ): Promise<CommentThread>;
    getReviewers(repositoryId: string, pullRequestId: number | string): Promise<Reviewer[]>;
    addReviewers(
        repositoryId: string,
        pullRequestId: number | string,
        reviewerIds: string[],
    ): Promise<Reviewer[]>;
}

export interface IWorkItemsService {
    getWorkItem(id: number | string, projectId?: string): Promise<WorkItem>;
    getWorkItems(ids: Array<number | string>, projectId?: string): Promise<WorkItem[]>;
    createWorkItem(projectId: string, type: string, input: CreateWorkItemInput): Promise<WorkItem>;
    updateWorkItem(
        id: number | string,
        update: UpdateWorkItemInput,
        projectId?: string,
    ): Promise<WorkItem>;
    searchWorkItems(query: string, projectId?: string, top?: number): Promise<WorkItem[]>;
    getComments(workItemId: number | string, projectId?: string): Promise<Comment[]>;
    addComment(workItemId: number | string, body: string, projectId?: string): Promise<Comment>;
}
