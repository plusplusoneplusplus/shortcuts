/**
 * Sentinel to-do ledger contracts (`/api/workspaces/:ws/sentinel-todos/:processId`).
 *
 * A ledger belongs to one Sentinel chat, scoped to its parent workspace on the
 * owning server. Item `status` is fulfillment; each job link's `execution` is
 * the linked job's own state, derived on read and never a completion verdict.
 */

export type SentinelTodoStatus = 'todo' | 'in_progress' | 'needs_attention' | 'done';
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
    review?: { state: 'pending' | 'queued' | 'delivered' | 'failed'; reason?: string };
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
  execution: SentinelTodoJobExecution;
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
}

export interface SentinelTodoLedgerResponse {
  revision: number;
  items: SentinelTodoItem[];
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
}

/** A write's committed item (without derived job execution) and ledger revision. */
export interface SentinelTodoWriteResponse {
  item: Omit<SentinelTodoItem, 'jobs'> & { jobs: Omit<SentinelTodoJobLink, 'execution'>[] };
  ledgerRevision: number;
  created?: boolean;
}

/** WebSocket event sent after a committed ledger write. */
export interface SentinelTodosChangedEvent {
  type: 'sentinel-todos-changed';
  workspaceId: string;
  processId: string;
  ledgerRevision: number;
  itemId: string;
  timestamp?: number;
}
