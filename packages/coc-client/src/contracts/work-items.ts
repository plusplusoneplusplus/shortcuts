import type { JsonObject } from './common';

export type WorkItemStatus =
  | 'created'
  | 'planning'
  | 'readyToExecute'
  | 'executing'
  | 'aiDone'
  | 'aiFailed'
  | 'done'
  | 'failed'
  | string;
export type WorkItemPriority = 'high' | 'normal' | 'low';
export type WorkItemSource = 'manual' | 'chat' | 'schedule';
export type WorkItemType = 'work-item' | 'bug' | 'epic' | 'feature' | 'pbi';

/**
 * Allowed parent types for each work item type.
 * An empty array means the type cannot have a parent (top-level only).
 * Any item may be temporarily unparented (parentId absent) regardless of type.
 */
export const ALLOWED_PARENT_TYPES: Record<WorkItemType, readonly WorkItemType[]> = {
  epic:        [],
  feature:     ['epic'],
  pbi:         ['feature'],
  'work-item': ['pbi'],
  bug:         ['pbi'],
};

/**
 * Allowed child types for each work item type.
 * An empty array means the type cannot have children.
 */
export const ALLOWED_CHILD_TYPES: Record<WorkItemType, readonly WorkItemType[]> = {
  epic:        ['feature'],
  feature:     ['pbi'],
  pbi:         ['work-item', 'bug'],
  'work-item': [],
  bug:         [],
};

export interface WorkItemPlan {
  version: number;
  content: string;
  updatedAt?: string;
  resolvedBy?: 'user' | 'ai' | string;
}

export interface WorkItemPlanVersion extends WorkItemPlan {
  createdAt?: string;
  summary?: string;
}

export interface WorkItemPlanResponse {
  plan: WorkItemPlan | null;
  versions: number;
}

export interface WorkItemPlanUpdateResponse {
  plan: WorkItemPlanVersion;
  version: number;
}

export interface WorkItemPlanRefineRequest extends JsonObject {
  instructions?: string;
  summary?: string;
}

export interface WorkItemPlanRefineResponse extends WorkItemPlanUpdateResponse {
  previousVersion: number;
}

export interface WorkItem {
  id: string;
  repoId: string;
  title: string;
  description: string;
  status: WorkItemStatus;
  type?: WorkItemType;
  /** Parent work item ID (hierarchy). Only set when hierarchy is enabled. */
  parentId?: string;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
  pinnedAt?: string;
  archivedAt?: string;
  source?: WorkItemSource;
  sourceId?: string;
  priority?: WorkItemPriority;
  tags?: string[];
  autoExecute?: boolean;
  autoResolveAndReExecute?: boolean;
  autoReExecuteCycles?: number;
  plan?: WorkItemPlan;
  planVersion?: number;
  taskId?: string;
  processId?: string;
  executionHistory?: WorkItemExecution[];
  reviewComments?: ReviewComment[];
  changes?: WorkItemChange[];
  [key: string]: unknown;
}

export interface WorkItemFilter {
  status?: WorkItemStatus | WorkItemStatus[];
  source?: WorkItemSource;
  priority?: WorkItemPriority;
  tags?: string[];
  type?: WorkItemType;
  q?: string;
  offset?: number;
  limit?: number;
}

export interface WorkItemListResponse {
  items: WorkItem[];
  total: number;
  hasMore: boolean;
}

export interface WorkItemGroupedResponse {
  groups: Record<string, { items: WorkItem[]; total: number; hasMore: boolean }>;
}

export interface CreateWorkItemRequest {
  id?: string;
  title: string;
  description?: string;
  type?: WorkItemType;
  /** Parent work item ID (hierarchy). Only accepted when hierarchy flag is enabled. */
  parentId?: string;
  source?: WorkItemSource;
  sourceId?: string;
  priority?: WorkItemPriority;
  tags?: string[];
  autoExecute?: boolean;
  plan?: { content: string; resolvedBy?: string };
}

export interface CreateWorkItemFromChatRequest extends JsonObject {
  processId: string;
  id?: string;
  title?: string;
  description?: string;
  priority?: WorkItemPriority;
  tags?: string[];
  extractPlan?: boolean;
}

export interface UpdateWorkItemRequest extends Partial<Pick<WorkItem, 'title' | 'description' | 'status' | 'priority' | 'tags' | 'autoExecute'>> {
  completedAt?: string;
  reviewComments?: unknown[];
  /** Update parent link (hierarchy). Only accepted when hierarchy flag is enabled. */
  parentId?: string | null;
}

export interface ExecuteWorkItemRequest extends JsonObject {
  model?: string;
  mode?: string;
  skillNames?: string[];
}

export interface ExecuteWorkItemResponse {
  taskId: string;
}

export interface RequestWorkItemChangesRequest extends JsonObject {
  comments: string[];
  source?: 'diff-comments' | string;
}

export interface RequestWorkItemChangesResponse {
  plan: WorkItemPlanVersion;
  newVersion: number;
}

export interface ResolveWorkItemCommentsRequest extends JsonObject {
  type: 'plan' | 'commit';
  model?: string;
  commitSha?: string;
  sourceRunIndex?: number;
}

export interface WorkItemExecution {
  taskId: string;
  processId?: string;
  startedAt: string;
  completedAt?: string;
  status: 'running' | 'completed' | 'failed' | 'cancelled' | string;
  error?: string;
  autoReExecuted?: boolean;
  sessionCategory?: string;
  title?: string;
  kind?: string;
  prIteration?: number;
  prUrl?: string;
}

export interface ReviewComment {
  id: string;
  text: string;
  createdAt: string;
  resolved?: boolean;
}

export interface WorkItemChangeCommit {
  sha: string;
  message: string;
  author?: string;
  date?: string;
}

export interface WorkItemChange {
  id: string;
  planVersion: number;
  commits: WorkItemChangeCommit[];
  startedAt: string;
  completedAt?: string;
  taskId?: string;
  headBefore?: string;
  status: 'open' | 'closed' | string;
  branchName?: string;
  prNumber?: number;
  prUrl?: string;
  prStatus?: 'open' | 'merged' | 'closed' | string;
}

// ============================================================================
// Hierarchy tree types
// ============================================================================

/** Descendant count roll-up for a hierarchy tree node. */
export interface WorkItemRollup {
  descendantCount: number;
  byType: {
    epic: number;
    feature: number;
    pbi: number;
    'work-item': number;
    bug: number;
  };
  byStatus: {
    created: number;
    planning: number;
    readyToExecute: number;
    executing: number;
    aiDone: number;
    aiFailed: number;
    done: number;
    failed: number;
  };
}

/** A node in the work item hierarchy tree. */
export interface WorkItemTreeNode {
  item: WorkItem;
  children: WorkItemTreeNode[];
  rollup: WorkItemRollup;
}

/** Response from the work item tree endpoint. */
export interface WorkItemTreeResponse {
  roots: WorkItemTreeNode[];
  total: number;
  /** True when the hierarchy feature flag is disabled. */
  disabled?: boolean;
}

/** Filter options for the tree endpoint. */
export interface WorkItemTreeFilter {
  q?: string;
  type?: WorkItemType;
  status?: WorkItemStatus;
  includeArchived?: boolean;
  /** When true, items with status "done" are included. Defaults to false. */
  includeDone?: boolean;
}
