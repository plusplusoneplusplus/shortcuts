export {
    ProviderType,
    type Identity,
    type Comment,
    type CommentThread,
    type PullRequestStatus,
    type ReviewVote,
    type Reviewer,
    type PullRequest,
    type WorkItem,
    type SearchCriteria,
    type CreatePullRequestInput,
    type UpdatePullRequestInput,
    type CreateWorkItemInput,
    type UpdateWorkItemInput,
} from './types';

export type {
    IProviderConfig,
    AdoProviderConfig,
    GitHubProviderConfig,
    IPullRequestsService,
    IWorkItemsService,
} from './interfaces';
