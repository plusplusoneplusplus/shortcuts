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
