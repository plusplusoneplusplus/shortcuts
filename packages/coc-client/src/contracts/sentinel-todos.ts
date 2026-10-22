/**
 * Sentinel to-do ledger contracts (`/api/workspaces/:ws/sentinel-todos/:processId`).
 *
 * A ledger belongs to one Sentinel chat, scoped to its parent workspace on the
 * owning server. Item `status` is fulfillment; each job link's `execution` is
 * the linked job's own state, derived on read and never a completion verdict.
 */

export type SentinelTodoStatus = 'todo' | 'in_progress' | 'deferred' | 'needs_attention' | 'done';
export const SENTINEL_TODO_RECENT_LIMIT = 50;
export type SentinelTodoType = 'normal' | 'manual';
/** Ledger metadata only, independent of status and of job queue priority. */
export type SentinelTodoPriority = 'high' | 'regular';
export type SentinelTodoActor = 'user' | 'sentinel' | 'system';

export interface SentinelTodoTag {
  id: string;
  name: string;
  color: 'gray' | 'blue' | 'violet' | 'teal' | 'amber';
  description?: string;
}
export interface SentinelTodoTagLibrary {
  revision: number;
  tags: SentinelTodoTag[];
}
export interface WriteSentinelTodoTagRequest {
  expectedRevision: number;
  name: string;
  color: SentinelTodoTag['color'];
  description?: string;
}
export interface DeleteSentinelTodoTagRequest {
  expectedRevision: number;
  confirmed: true;
}
export interface SuggestSentinelTodoTagsRequest {
  expectedRevision: number;
  /** Required for suggestions; guards concurrent manual and automatic tag writes. */
  expectedTagRevision?: number;
  multiple?: boolean;
  confirmed?: boolean;
}
export interface SentinelTodoTagMatch {
  state: 'matched' | 'no_match' | 'unavailable' | 'failed';
  message?: string;
}

export interface SentinelTodoTargetRepo {
  workspaceId: string;
  serverId?: string;
  label?: string;
}

export interface SentinelTodoOutcome {
  summary: string;
  recordedAt: string;
  recordedBy: SentinelTodoActor;
}

export type SentinelTodoJobExecution = (
  | { state: 'queued' | 'running' | 'unknown' | 'unavailable' }
  | {
    state: 'completed' | 'failed' | 'cancelled' | 'capped';
    reason?: string;
    /** Delivery of the result review to the Sentinel chat, not a verdict. */
    review?: {
      state: 'pending' | 'queued' | 'delivered' | 'failed';
      /** Explicit ledger verdict, independent of result transport/parent turn completion. */
      assessment?: 'pending' | 'reviewed' | 'superseded' | 'not_required';
      terminalEventId?: string;
      reason?: string;
    };
  }
) & {
  /** Registered remote result receipt, distinct from parent assessment delivery. */
  delivery?: { state: 'pending' | 'failed' | 'received'; reason?: string };
};

export interface SentinelTodoJobLink {
  processId: string;
  workspaceId: string;
  serverId?: string;
  /** Exact registered result request, independent of the server's routing alias. */
  remote?: { serverIdentity: string; requestId: string };
  kind: 'local' | 'remote' | 'ralph';
  sessionId?: string;
  openLink: string;
  title?: string;
  linkedAt: string;
  /** Current owner-verified conversation mode, or whole-session Ralph identity. Unknown is omitted. */
  mode?: 'ask' | 'autopilot' | 'ralph';
  execution: SentinelTodoJobExecution;
}

/**
 * A reference-only link to an existing conversation. It
 * has no execution state, is never reviewed, and never changes item status.
 */
export interface SentinelTodoConversationReference {
  /** Missing kind identifies an existing conversation reference. */
  kind?: 'conversation';
  /** Durable destination identity; absent means the ledger's owning server.
   * Never a forwarded endpoint or a registry-local server alias. */
  serverIdentity?: string;
  serverLabel?: string;
  workspaceLabel?: string;
  /** Cached offline references remain unverified until checked online. */
  verification?: 'verified' | 'unverified';
  processId: string;
  workspaceId: string;
  /** Stable Ralph session identity; the reference opens the session view. */
  sessionId?: string;
  openLink: string;
  title?: string;
  attachedAt: string;
  attachedBy: SentinelTodoActor;
}

/** Display metadata only: never PR output evidence or execution authority. */
export interface SentinelTodoExternalReference {
  kind: 'pr' | 'email' | 'link';
  url: string;
  title?: string;
}

export type SentinelTodoReference = SentinelTodoConversationReference | SentinelTodoExternalReference;

/** Evidence selectors, not evidence receipts or execution authority. */
export type SentinelTodoDependencyCondition =
  | { kind: 'done' }
  | { kind: 'pr_merge'; outputSlot: string }
  | { kind: 'accepted_artifact'; phase: string; reference: string; version: string };

export interface SentinelTodoDependency {
  /** Resolved only in the dependent item's owning server/workspace/parent ledger. */
  itemId: string;
  condition: SentinelTodoDependencyCondition;
}

export interface SetSentinelTodoDependenciesRequest {
  expectedRevision: number;
  dependsOn: SentinelTodoDependency[];
}

export interface SentinelTodoPrIdentity {
  provider: 'github' | 'ado';
  host: string;
  repoPath: string;
  number: number;
  url: string;
}

export type SentinelTodoPrProvenance =
  | { kind: 'tracked_job'; processId: string; workspaceId: string; reason: string }
  | { kind: 'owner_selection'; reason: string };

interface SentinelTodoEvidenceReceipt {
  receiptId: string;
  /** Prerequisite item revision which committed this exact receipt. */
  recordedRevision: number;
  recordedAt: string;
  recordedBy: 'user' | 'sentinel';
}

export type SentinelTodoEvidence =
  | (SentinelTodoEvidenceReceipt & { kind: 'pr_binding'; outputSlot: string; pr: SentinelTodoPrIdentity; provenance: SentinelTodoPrProvenance })
  | (SentinelTodoEvidenceReceipt & { kind: 'artifact_acceptance'; phase: string; reference: string; version: string; workspaceId: string });

export interface BindSentinelTodoPrRequest {
  expectedRevision: number;
  outputSlot: string;
  prUrl: string;
  provenance: SentinelTodoPrProvenance;
}

/** Version is `sha256:<64 lowercase hex digits>` of the exact current file bytes. */
export interface AcceptSentinelTodoArtifactRequest {
  expectedRevision: number;
  phase: string;
  reference: string;
  version: string;
}

export interface SentinelTodoDependencyEvaluation {
  itemId: string;
  itemRevision: number;
  ledgerRevision: number;
  evaluatedAt: string;
  state: 'ready' | 'waiting';
  blocker?: string;
  /** An evidence snapshot, not authorization or an admission receipt. Re-evaluate before use. */
  edges: {
    dependency: SentinelTodoDependency;
    sourceRevision?: number;
    satisfied: boolean;
    blocker?: string;
    evidenceLink?: string;
    /** Same-server prerequisite content owner, separate from the parent ledger workspace. */
    artifactWorkspaceId?: string;
    receiptId?: string;
    evidenceRevision?: number;
    pr?: SentinelTodoPrIdentity;
    mergedAt?: string;
    mergeCommit?: string;
  }[];
}

export interface SentinelTodoDependencyReadiness {
  state: 'waiting' | 'ready';
  evaluation?: SentinelTodoDependencyEvaluation;
  /** Started work whose prerequisite evidence changed. */
  requiresReview?: boolean;
  activationId?: string;
  delivery?: 'pending' | 'delivered';
  error?: string;
  transportTriggerId?: string;
}

/** Owner-bound tracking context; admission rechecks current prerequisites. */
export interface SentinelTodoTrackedAdmission {
  owner: { workspaceId: string; processId: string };
  itemId: string;
}

export interface SentinelTodoItem {
  /** Independent metadata CAS; absent means zero. Does not affect dependency snapshots. */
  tagRevision?: number;
  tagIds?: string[];
  tagOrigin?: 'manual' | 'suggested';
  tagMatch?: SentinelTodoTagMatch;
  id: string;
  /** Immutable tracking kind; stored items without a type read as `normal`. */
  type: SentinelTodoType;
  title: string;
  completionCondition: string;
  notes: string;
  targetRepo?: SentinelTodoTargetRepo;
  status: SentinelTodoStatus;
  statusReason?: string;
  /** Items stored before priorities existed read as `regular`. */
  priority: SentinelTodoPriority;
  outcome?: SentinelTodoOutcome;
  archived: boolean;
  revision: number;
  createdAt: string;
  updatedAt: string;
  createdBy: SentinelTodoActor;
  updatedBy: SentinelTodoActor;
  jobs: SentinelTodoJobLink[];
  /** Absent from servers that predate conversation references. */
  references?: SentinelTodoReference[];
  /** All edges are required. Absent on records without native dependency support. */
  dependsOn?: SentinelTodoDependency[];
  evidence?: SentinelTodoEvidence[];
  dependencyReadiness?: SentinelTodoDependencyReadiness;
}

export interface SentinelTodoLedgerResponse {
  tagLibrary?: SentinelTodoTagLibrary;
  revision: number;
  items: SentinelTodoItem[];
  /** Recent-list pagination; full snapshots omit these fields. */
  total?: number;
  hasMore?: boolean;
  nextOffset?: number | null;
}

export interface CreateSentinelTodoRequest {
  externalReferences?: SentinelTodoExternalReference[];
  tagIds?: string[];
  matchMultiple?: boolean;
  /** Defaults to `normal`; updates cannot change it. */
  type?: SentinelTodoType;
  title: string;
  completionCondition?: string;
  notes?: string;
  targetRepo?: SentinelTodoTargetRepo;
  status?: SentinelTodoStatus;
  statusReason?: string;
  /** Defaults to `regular`. */
  priority?: SentinelTodoPriority;
  /** Makes a retried create return the first item instead of a duplicate. */
  idempotencyKey?: string;
}

/** Omitted fields stay unchanged; nullable fields explicitly support clearing. */
export interface UpdateSentinelTodoRequest {
  /** Replaces external references only; [] clears them, omission preserves all references. */
  externalReferences?: SentinelTodoExternalReference[];
  /** Required when tagIds is supplied, including an explicit empty selection. */
  expectedTagRevision?: number;
  tagIds?: string[];
  matchMultiple?: boolean;
  expectedRevision: number;
  title?: string;
  completionCondition?: string;
  notes?: string;
  targetRepo?: SentinelTodoTargetRepo | null;
  status?: SentinelTodoStatus;
  statusReason?: string | null;
  priority?: SentinelTodoPriority;
  outcome?: string | null;
  archived?: boolean;
  /** Exact local terminal results assessed by an explicit status verdict. */
  reviewedJobs?: { processId: string; terminalEventId: string }[];
}

/** Attaches an existing conversation on the owning server; re-attaching is a no-op. */
export interface AttachSentinelTodoReferenceRequest {
  expectedRevision: number;
  processId: string;
  workspaceId: string;
}

/** A write's committed item (without derived job execution) and ledger revision. */
export interface SentinelTodoWriteResponse {
  item: Omit<SentinelTodoItem, 'jobs'> & { jobs: Omit<SentinelTodoJobLink, 'execution' | 'mode'>[] };
  ledgerRevision: number;
  created?: boolean;
  /** Reference attachments: false when the conversation was already attached. */
  attached?: boolean;
}

/** WebSocket event sent after a committed ledger write. */
export interface SentinelTodosChangedEvent {
  type: 'sentinel-todos-changed';
  workspaceId: string;
  processId: string;
  ledgerRevision: number;
  itemId?: string;
  /** Metadata invalidation; authority revisions are unchanged. */
  tagOnly?: boolean;
  timestamp?: number;
}

/** Owner-scoped scrubber state invalidation; consumers refetch from the owning server. */
export interface SentinelScrubberChangedEvent {
  type: 'sentinel-scrubber-changed';
  workspaceId: string;
  processId: string;
  runId?: string;
  timestamp?: number;
}
export interface SentinelPrOutcome {
  id: string;
  jobId: string;
  receiptId: string;
  pr: { provider: 'github' | 'ado'; host: string; repoPath: string; number: number; url: string };
  status: 'watching' | 'draft' | 'merged' | 'closed';
  /** `delivered` records queue/buffer admission, not review execution or completion. */
  delivery: 'none' | 'pending' | 'delivered' | 'skipped' | 'error';
  error?: string;
  observedAt?: string;
}

export interface SentinelPrOutcomesResponse {
  paused: boolean;
  revision: number;
  outcomes: SentinelPrOutcome[];
}

export interface SentinelPrOutcomeControlRequest {
  expectedRevision: number;
}
