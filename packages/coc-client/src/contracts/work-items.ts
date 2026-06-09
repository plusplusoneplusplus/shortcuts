import type { ChatProvider, JsonObject, ReasoningEffort } from './common';
import type { EffortTierKey } from './queue';

export type KnownWorkItemStatus =
  | 'created'
  | 'drafting'
  | 'planning'
  | 'readyToExecute'
  | 'executing'
  | 'aiDone'
  | 'aiFailed'
  | 'done'
  | 'failed';
export type WorkItemStatus = KnownWorkItemStatus | (string & {});
export type WorkItemPriority = 'high' | 'normal' | 'low';
export type WorkItemSource = 'manual' | 'chat' | 'schedule';
export type WorkItemType = 'work-item' | 'bug' | 'goal' | 'epic' | 'feature' | 'pbi';
export type WorkItemTrackerKind = 'local-only' | 'github-backed' | 'azure-boards-backed';

export interface WorkItemGitHubTrackerMetadata {
  issueId?: string;
  issueNumber?: number;
  issueUrl?: string;
  lastPulledAt?: string;
}

export interface WorkItemGitHubMirrorMetadata {
  issueId?: string;
  issueNumber: number;
  issueUrl?: string;
  state?: string;
  updatedAt?: string;
  lastPulledAt?: string;
}

export interface WorkItemAzureBoardsTrackerMetadata {
  workItemId?: number;
  workItemUrl?: string;
  revision?: number;
  updatedAt?: string;
  lastPulledAt?: string;
}

export interface WorkItemAzureBoardsMirrorMetadata {
  workItemId: number;
  workItemUrl?: string;
  revision?: number;
  workItemType?: string;
  state?: string;
  updatedAt?: string;
  lastPulledAt?: string;
  /** Hash of Azure-owned local fields after the last successful pull/push. */
  lastSyncedLocalFingerprint?: string;
}

export type WorkItemTrackerMetadata =
  | { kind: 'local-only' }
  | { kind: 'github-backed'; provider: 'github'; github: WorkItemGitHubTrackerMetadata }
  | { kind: 'azure-boards-backed'; provider: 'azure-boards'; azureBoards: WorkItemAzureBoardsTrackerMetadata };

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
  goal:        ['pbi'],
};

/**
 * Allowed child types for each work item type.
 * An empty array means the type cannot have children.
 */
export const ALLOWED_CHILD_TYPES: Record<WorkItemType, readonly WorkItemType[]> = {
  epic:        ['feature'],
  feature:     ['pbi'],
  pbi:         ['work-item', 'bug', 'goal'],
  'work-item': [],
  bug:         [],
  goal:        [],
};

export type WorkItemSyncProvider = 'github' | 'azure-boards';

export const WORK_ITEM_SYNC_ITEM_LIMIT = 200;
export type WorkItemSyncDisabledReason = 'hierarchy-disabled' | 'sync-disabled';

export interface WorkItemSyncRepository {
  provider: WorkItemSyncProvider;
  owner?: string;
  repo?: string;
  organizationUrl?: string;
  project?: string;
  projectId?: string;
  url?: string;
  source?: 'preference' | 'workspaceRemote' | 'origin';
}

export interface WorkItemSyncProviderStatus {
  provider: WorkItemSyncProvider;
  available: boolean;
  reason?:
    | 'provider-unavailable'
    | 'provider-disabled'
    | 'incomplete-preference'
    | 'missing-workspace'
    | 'missing-origin'
    | 'missing-org-url'
    | 'missing-project'
    | 'non-github-origin'
    | 'auth-unavailable'
    | 'unknown';
  message?: string;
  repository?: WorkItemSyncRepository;
  auth?: {
    mode: 'external';
    authenticated?: boolean;
    message?: string;
  };
}

export interface WorkItemSyncStatusResponse {
  enabled: boolean;
  disabled?: boolean;
  disabledReason?: WorkItemSyncDisabledReason;
  maxItems: number;
  /** Provider derived from the workspace repository remote URL, when supported. */
  remoteProvider?: WorkItemSyncProvider;
  provider?: WorkItemSyncProviderStatus;
  providers: WorkItemSyncProviderStatus[];
}

export interface WorkItemPlan {
  version: number;
  currentVersion?: number;
  content: string;
  updatedAt?: string;
  resolvedBy?: 'user' | 'ai' | string;
  source?: 'user' | 'ai' | 'system' | string;
  reason?: string;
  restoredFromVersion?: number;
}

export interface WorkItemPlanVersion extends WorkItemPlan {
  createdAt?: string;
  authorType?: 'user' | 'ai' | 'system' | string;
  summary?: string;
}

export interface WorkItemPlanVersionDiffChunk {
  type: 'equal' | 'added' | 'removed';
  lines: string[];
}

export interface WorkItemPlanVersionComparison {
  base: WorkItemPlanVersion;
  target: WorkItemPlanVersion;
  diff: WorkItemPlanVersionDiffChunk[];
}

export interface WorkItemPlanResponse {
  plan: WorkItemPlan | null;
  versions: number;
}

export interface WorkItemPlanUpdateResponse {
  plan: WorkItemPlanVersion;
  version: number;
}

export interface WorkItemPlanRestoreRequest extends JsonObject {
  summary?: string;
  reason?: string;
}

export interface WorkItemPlanRestoreResponse extends WorkItemPlanUpdateResponse {
  restoredFromVersion: number;
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
  /** Epic-rooted tracker identity. Set on Epic roots; descendants inherit it. */
  tracker?: WorkItemTrackerMetadata;
  /** GitHub read-mirror identity for items inside a GitHub-backed Epic tree. */
  githubMirror?: WorkItemGitHubMirrorMetadata;
  /** Azure Boards read-mirror identity for items inside an Azure Boards-backed Epic tree. */
  azureBoardsMirror?: WorkItemAzureBoardsMirrorMetadata;
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
  currentContentVersion?: number;
  /** Success criteria defining "done" for a `goal` item (markdown). */
  successCriteria?: string;
  /** Linked spec-drafting (Ralph grilling) chat process ID for a `goal` item. */
  grillSessionId?: string;
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
  tracker?: WorkItemTrackerKind;
  q?: string;
  offset?: number;
  limit?: number;
}

export interface WorkItemListResponse {
  items: WorkItem[];
  total: number;
  hasMore: boolean;
}

export interface WorkItemChatBinding {
  workItemId: string;
  taskId: string;
}

export interface WorkItemChatBindingListResponse {
  bindings: Record<string, { taskId: string; createdAt: string }>;
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
  /** Epic-rooted tracker identity. Only accepted on root Epic items. */
  tracker?: WorkItemTrackerMetadata;
  source?: WorkItemSource;
  sourceId?: string;
  priority?: WorkItemPriority;
  tags?: string[];
  autoExecute?: boolean;
  /** Success criteria for a `goal` item (markdown). */
  successCriteria?: string;
  plan?: { content: string; resolvedBy?: string };
}

export interface ImportFromGitHubRequest extends JsonObject {
  /** Full GitHub issue URL, e.g. https://github.com/<owner>/<repo>/issues/<number>. */
  issueUrl?: string;
  /** Issue number in the workspace-configured GitHub repository. */
  issueNumber?: number;
}

export interface ImportFromAzureBoardsRequest extends JsonObject {
  /** Full Azure Boards work item URL, e.g. https://dev.azure.com/<org>/<project>/_workitems/edit/<id>. */
  workItemUrl?: string;
  /** Azure Boards work item ID in the workspace-configured project. */
  workItemId?: number;
}

export interface WorkItemSyncWarning extends JsonObject {
  provider: WorkItemSyncProvider;
  code: 'remote-wins-conflict' | string;
  workItemId: string;
  remoteWorkItemId?: number;
  fields: string[];
  message: string;
  localUpdatedAt?: string;
  lastPulledAt?: string;
  previousRevision?: number;
  remoteRevision?: number;
  previousUpdatedAt?: string;
  remoteUpdatedAt?: string;
}

/**
 * Error `code` returned by the work-item PATCH route when a remote-backed save is
 * blocked because the provider item changed since CoC last synced its mirror.
 * The error body carries a typed {@link WorkItemSyncConflictDetails} in `details`.
 */
export const WORK_ITEM_SYNC_CONFLICT_CODE = 'WORK_ITEM_SYNC_CONFLICT';

/** Provider-owned fields that can diverge and produce a save conflict. */
export type WorkItemSyncConflictField =
  | 'title'
  | 'description'
  | 'status'
  | 'priority'
  | 'tags'
  | 'parent';

/**
 * A single provider-owned field whose current provider value diverged from the
 * local mirror base. Values are normalized strings (or `null` when unset/empty)
 * so the inline merge UI can render side-by-side cards uniformly.
 */
export interface WorkItemSyncConflictFieldDetail {
  field: WorkItemSyncConflictField;
  /** The local draft value the user is attempting to save. */
  draft: string | null;
  /** The local mirror/base value last synced from the provider. */
  base: string | null;
  /** The current value on the provider. */
  remote: string | null;
}

/**
 * Structured, provider-agnostic conflict payload returned from the work-item
 * PATCH route when a stale remote-backed save is blocked. Shared by the GitHub
 * (`updatedAt`) and Azure Boards (`revision`) staleness paths so the SPA can show
 * one inline per-field merge panel regardless of provider.
 */
export interface WorkItemSyncConflictDetails extends JsonObject {
  /** Discriminant so clients can detect the typed conflict from an error body. */
  kind: 'work-item-sync-conflict';
  provider: WorkItemSyncProvider;
  /** Friendly provider name for UI labels, e.g. "GitHub" or "Azure Boards". */
  providerLabel: string;
  /** Local work item under edit. */
  workItemId: string;
  /** GitHub backing issue number (when provider === 'github'). */
  issueNumber?: number;
  /** Azure Boards backing work item id (when provider === 'azure-boards'). */
  remoteWorkItemId?: number;
  /** Local mirror timestamp known to CoC before the save (GitHub). */
  localUpdatedAt?: string;
  /** Local mirror revision known to CoC before the save (Azure Boards). */
  localRevision?: number;
  /** Current provider timestamp at conflict detection (GitHub). */
  remoteUpdatedAt?: string;
  /** Current provider revision at conflict detection (Azure Boards). */
  remoteRevision?: number;
  /** Provider-owned fields whose current provider value diverged from the local base. */
  fields: WorkItemSyncConflictFieldDetail[];
}

/**
 * Acknowledgement that the user has reviewed a {@link WorkItemSyncConflictDetails}
 * and resolved it in the inline merge UI. Sent on the retry PATCH so the
 * remote-first save can proceed against a stale-but-reviewed provider revision.
 *
 * The save still re-checks the live provider state: it only proceeds when the
 * acknowledged revision/timestamp still matches the current provider value, so a
 * provider change that lands between review and retry produces a fresh conflict
 * rather than silently overwriting newer remote data.
 */
export interface WorkItemSyncConflictResolution extends JsonObject {
  provider: WorkItemSyncProvider;
  /** The provider `updatedAt` the user reviewed (GitHub). */
  acknowledgedRemoteUpdatedAt?: string;
  /** The provider `revision` the user reviewed (Azure Boards). */
  acknowledgedRemoteRevision?: number;
}

export interface ConvertWorkItemTrackerResponse extends JsonObject {
  root: WorkItem;
  items: WorkItem[];
  remoteCreated: number;
  localUpdated: number;
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

export interface UpdateWorkItemRequest extends Partial<Pick<WorkItem, 'title' | 'description' | 'status' | 'priority' | 'tags' | 'autoExecute' | 'tracker'>> {
  completedAt?: string;
  reviewComments?: unknown[];
  /** Update the current plan as part of the work-item PATCH batch. */
  plan?: {
    content: string;
    resolvedBy?: 'user' | 'ai';
    summary?: string;
  };
  /** Update success criteria for a `goal` item (markdown). */
  successCriteria?: string;
  /** Link a spec-drafting chat process to a `goal` item. */
  grillSessionId?: string;
  /** Update parent link (hierarchy). Only accepted when hierarchy flag is enabled. */
  parentId?: string | null;
  /**
   * Acknowledge a reviewed remote-sync conflict so a stale-but-reviewed
   * remote-first save may proceed. Sent by the inline merge UI when retrying the
   * normal Save after the user resolves each provider-owned field.
   */
  syncConflictResolution?: WorkItemSyncConflictResolution;
}

export interface ExecuteWorkItemRequest extends JsonObject {
  model?: string;
  provider?: ChatProvider;
  reasoningEffort?: ReasoningEffort;
  effortTier?: EffortTierKey;
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
  planVersion?: number;
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
    goal: number;
  };
  byStatus: Record<KnownWorkItemStatus, number> & Record<string, number>;
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
  /** Filter by inherited Epic-rooted tracker kind. */
  tracker?: WorkItemTrackerKind;
  includeArchived?: boolean;
  /** When true, items with status "done" are included. Defaults to false. */
  includeDone?: boolean;
}

// ============================================================================
// AI Authoring types
// ============================================================================

/** Fields that an AI draft can carry for a work item (all optional). */
export interface WorkItemAiDraftFields {
  title?: string;
  description?: string;
  priority?: WorkItemPriority;
  tags?: string[];
  /** Markdown plan / goal content (maps to plan.content). */
  plan?: string;
  /** For goal type items: success criteria. */
  successCriteria?: string;
  /** Work item type suggested by the AI. */
  type?: WorkItemType;
}

/** A drafted child task (leaf work item) for a hierarchy breakdown. */
export interface WorkItemChildTaskDraft {
  title: string;
  description?: string;
  /** 'work-item' or 'bug' — child leaf types. */
  type?: 'work-item' | 'bug';
}

/** Response when the AI needs more information before generating a draft. */
export interface WorkItemAiClarificationResponse {
  kind: 'clarification';
  /** Up to 3 concise clarification questions. */
  questions: string[];
  /** Total number of clarification rounds completed so far (0-based). */
  clarificationCount: number;
}

/** Response when the AI has produced a complete draft. */
export interface WorkItemAiDraftResult {
  kind: 'draft';
  /** The generated work item fields. */
  workItem: WorkItemAiDraftFields;
  /** Optional goal/plan markdown stored as plan.content. */
  goal?: string;
  /** Optional child task breakdown (only when hierarchy is applicable). */
  childTasks?: WorkItemChildTaskDraft[];
}

/** Union of all possible AI draft API responses. */
export type WorkItemAiGenerationResponse = WorkItemAiClarificationResponse | WorkItemAiDraftResult;

/** Request body for POST /api/workspaces/:id/work-items/ai-draft */
export interface NewWorkItemAiDraftRequest extends JsonObject {
  /** Free-text user prompt describing the feature / problem. Required. */
  prompt: string;
  /** Hint for the type to generate (defaults to 'work-item'). */
  type?: WorkItemType;
  /** Parent work item ID for hierarchy context. */
  parentId?: string;
  /** Answers to previous clarification questions. */
  clarificationAnswers?: string[];
  /** Number of clarification rounds already completed (0 = first request). */
  clarificationCount?: number;
}

/** Request body for POST /api/workspaces/:id/work-items/:workItemId/ai-draft */
export interface ImproveWorkItemAiDraftRequest extends JsonObject {
  /** Instruction for what to improve. Required. */
  prompt: string;
  /** Which aspects to draft ('fields', 'goal', 'childTasks'). Defaults to ['fields', 'goal']. */
  targets?: Array<'fields' | 'goal' | 'childTasks'>;
  /** Answers to previous clarification questions. */
  clarificationAnswers?: string[];
  /** Number of clarification rounds already completed. */
  clarificationCount?: number;
}
