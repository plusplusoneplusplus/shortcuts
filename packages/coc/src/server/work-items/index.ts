export type {
    WorkItemStatus,
    WorkItemSource,
    WorkItemPriority,
    WorkItemType,
    WorkItemSyncProvider,
    WorkItemSyncRemoteIdentity,
    WorkItemSyncParentReference,
    WorkItemSyncLink,
    WorkItemPlan,
    WorkItemPlanVersion,
    WorkItemExecution,
    WorkItem,
    WorkItemIndexEntry,
    WorkItemFilter,
    WorkItemStore,
    ReviewComment,
} from './types';

export {
    WORK_ITEM_STATUSES,
    WORK_ITEM_TYPES,
    TERMINAL_WORK_ITEM_STATUSES,
    VALID_TRANSITIONS,
    isTerminalStatus,
    isValidTransition,
    toIndexEntry,
} from './types';

export { FileWorkItemStore, type FileWorkItemStoreOptions } from './work-item-store';
export {
    DEFAULT_WORK_ITEM_SYNC_PROVIDER,
    SUPPORTED_WORK_ITEM_SYNC_PROVIDERS,
    WORK_ITEM_SYNC_MAX_ITEMS,
    collectWorkItemSyncScope,
    isSupportedWorkItemSyncProvider,
    unavailableWorkItemSyncProviderStatus,
    type WorkItemSyncProviderAdapter,
    type WorkItemSyncProviderApplyContext,
    type WorkItemSyncProviderContext,
    type WorkItemSyncProviderPreviewContext,
    type WorkItemSyncScope,
} from './work-item-sync-provider';
export {
    buildGitHubWorkItemIssueUpdate,
    buildGitHubWorkItemLabels,
    buildGitHubWorkItemSyncMetadata,
    formatGitHubWorkItemSyncMetadataBlock,
    hasExactlyOneGitHubWorkItemSyncMetadataBlock,
    parseGitHubWorkItemIssue,
    parseGitHubWorkItemSyncMetadataBlocks,
    stripGitHubWorkItemSyncMetadataBlocks,
    upsertGitHubWorkItemSyncMetadataBlock,
    type GitHubIssueLabel,
    type GitHubWorkItemIssueSnapshot,
    type GitHubWorkItemIssueUpdate,
    type GitHubWorkItemSyncMetadata,
    type ParseGitHubWorkItemSyncMetadataResult,
    type ParsedGitHubWorkItemIssue,
} from './work-item-sync-github-issue';
export {
    GhCliGitHubWorkItemIssueTransport,
    createGitHubWorkItemSyncProviderAdapter,
    type CreateGitHubWorkItemSyncProviderOptions,
    type GitHubWorkItemIssue,
    type GitHubWorkItemIssueListFilters,
    type GitHubWorkItemIssueTransport,
} from './work-item-sync-github-provider';
export {
    executeWorkItem,
    handleWorkItemTaskComplete,
    buildExecutionPrompt,
    resolveWorkItemComments,
    isResolveSessionCategory,
    type EnqueueFunction,
    type ExecuteWorkItemOptions,
    type ResolveWorkItemCommentsOptions,
} from './work-item-executor';

export type { WorkItemChange, WorkItemChangeCommit } from './types';
