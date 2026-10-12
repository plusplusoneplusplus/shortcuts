/**
 * Sentinel to-do ledger contracts (`/api/workspaces/:ws/sentinel-todos/:processId`).
 *
 * A ledger belongs to one Sentinel chat, scoped to its parent workspace on the
 * owning server. Item `status` is fulfillment; each job link's `execution` is
 * the linked job's own state, derived on read and never a completion verdict.
 */

export type SentinelTodoStatus = 'todo' | 'in_progress' | 'needs_attention' | 'done';
export const SENTINEL_TODO_RECENT_LIMIT = 50;
export type SentinelTodoType = 'normal' | 'manual';
/** Ledger metadata only, independent of status and of job queue priority. */
export type SentinelTodoPriority = 'high' | 'regular';
export type SentinelTodoActor = 'user' | 'sentinel' | 'system';

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

export type SentinelTodoJobExecution =
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
  };

export interface SentinelTodoJobLink {
  processId: string;
  workspaceId: string;
  serverId?: string;
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
 * A reference-only link to an existing conversation on the owning server. It
 * has no execution state, is never reviewed, and never changes item status.
 */
export interface SentinelTodoReference {
  processId: string;
  workspaceId: string;
  openLink: string;
  title?: string;
  attachedAt: string;
  attachedBy: SentinelTodoActor;
}

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

/** Concrete settings explicitly approved by the owner user; never resolved again at launch. */
export interface SentinelTodoDependencyActionSettings {
  mode: 'ask' | 'autopilot' | 'ralph';
  provider: 'copilot' | 'codex' | 'claude' | 'opencode';
  model: string;
  targetWorkspaceId: string;
  prompt: string;
  scope: string;
}

export interface SentinelTodoDependencyAction extends SentinelTodoDependencyActionSettings {
  revision: number;
  state: 'authorized' | 'revoked' | 'consumed' | 'blocked';
  authorizedAt: string;
  authorizedBy: 'user';
  /** Fixed native child identity, not an invitation to retry. */
  taskId: string;
  error?: string;
  /** Durable evidence-invalidation warning for started work; independent of fulfillment. */
  requiresReview?: boolean;
}

export interface SentinelTodoDependencyReadiness {
  state: 'waiting' | 'ready' | 'needs_approval';
  evaluation?: SentinelTodoDependencyEvaluation;
  activationId?: string;
  delivery?: 'pending' | 'delivered';
  error?: string;
  transportTriggerId?: string;
}

export interface AuthorizeSentinelTodoDependencyActionRequest {
  expectedRevision: number;
  /** Explicit conversation approval, distinct from evidence acceptance. */
  confirmed: true;
  action: SentinelTodoDependencyActionSettings;
}

export interface RevokeSentinelTodoDependencyActionRequest {
  expectedRevision: number;
}

/** Owner-bound portable context; the server validates it against durable authority. */
export interface SentinelTodoTrackedAdmission {
  owner: { workspaceId: string; processId: string };
  itemId: string;
  actionRevision?: number;
}

export interface SentinelTodoItem {
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
  dependencyAction?: SentinelTodoDependencyAction;
  dependencyReadiness?: SentinelTodoDependencyReadiness;
}

export interface SentinelTodoLedgerResponse {
  revision: number;
  items: SentinelTodoItem[];
  /** Recent-list pagination; full snapshots omit these fields. */
  total?: number;
  hasMore?: boolean;
  nextOffset?: number | null;
}

export interface CreateSentinelTodoRequest {
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

/** `null` clears an optional field; omitted fields stay unchanged. */
export interface UpdateSentinelTodoRequest {
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
