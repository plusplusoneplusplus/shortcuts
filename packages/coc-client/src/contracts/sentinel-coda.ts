import type { SentinelTodoStatus, SentinelTodoWriteResponse } from './sentinel-todos';

/** Coda data is scoped to the ledger's workspace and Sentinel on its owning server. */
export type SentinelCodaRunStatus = 'queued' | 'running' | 'completed' | 'failed' | 'timed_out'
  | 'cancelled' | 'interrupted' | 'skipped';
export type SentinelCodaVerdict = 'done' | 'obsolete' | 'in_progress' | 'deferred' | 'needs_attention' | 'unchanged' | 'unverified';

export interface SentinelCodaConfig {
  enabled: boolean;
  cron: string;
  paused: boolean;
  consecutiveFailures: number;
  revision: number;
  lastInputFingerprint?: string;
  nextRunAt?: string;
}

export interface SentinelCodaEvidence {
  kind: 'pr' | 'commit' | 'job' | 'reference' | 'other';
  ref: string;
  state: 'merged' | 'open' | 'closed' | 'on_default_branch' | 'succeeded' | 'failed' | 'other';
  observedAt?: string;
  checkedAt: string;
}

export interface SentinelCodaFinding {
  itemId: string;
  verdict: SentinelCodaVerdict;
  confidence: 'high' | 'medium' | 'low';
  autoApply: boolean;
  summary: string;
  rationale: string;
  unverifiedReason?: string;
  evidence: SentinelCodaEvidence[];
}

export interface SentinelCodaItemState {
  status: SentinelTodoStatus;
  outcome?: string;
  archived: boolean;
  revision: number;
}

export interface SentinelCodaAuditEntry {
  action: 'applied' | 'accepted' | 'dismissed' | 'undone';
  actor: 'scrubber' | 'user';
  at: string;
  before?: SentinelCodaItemState;
  after?: SentinelCodaItemState;
}

export interface SentinelCodaFindingRecord {
  runId: string;
  itemId: string;
  finding: SentinelCodaFinding;
  fingerprint: string;
  itemRevision: number;
  state: 'pending' | 'applied' | 'proposed' | 'accepted' | 'dismissed' | 'undone'
    | 'unchanged' | 'unverified' | 'suppressed';
  demotedBecause?: 'superseded' | 'user_verdict' | 'manual' | 'evidence_gate';
  audit: SentinelCodaAuditEntry[];
}

/** Queued and running records include snapshots, but findings are read from run detail. */
export interface SentinelCodaRun {
  id: string;
  trigger: 'manual' | 'schedule';
  status: SentinelCodaRunStatus;
  createdAt: string;
  startedAt?: string;
  finishedAt?: string;
  selectedItemIds?: string[];
  childProcessId?: string;
  error?: string;
  skipReason?: 'overlap' | 'unchanged';
  snapshot: { itemId: string; revision: number }[];
  deferredItemIds: string[];
  awaitingReviewItemIds: string[];
  inputFingerprint?: string;
  findingsSubmittedAt?: string;
}

export interface SentinelCodaRunSummary extends Pick<SentinelCodaRun,
  'id' | 'trigger' | 'status' | 'createdAt' | 'startedAt' | 'finishedAt' | 'childProcessId' | 'error' | 'skipReason'> {
  itemCount: number;
  deferredCount: number;
  awaitingReviewCount: number;
  counts: { done: number; proposals: number; unverified: number };
}

export interface SentinelCodaRunDetail extends SentinelCodaRun {
  findings: SentinelCodaFindingRecord[];
}

export interface SentinelCodaResponse {
  config: SentinelCodaConfig;
  activeRun?: SentinelCodaRun;
  runs: SentinelCodaRunSummary[];
}

export interface UpdateSentinelCodaConfigRequest {
  enabled: boolean;
  cron: string;
  expectedRevision: number;
}

export interface StartSentinelCodaRequest {
  /** Omit to scrub all open items; a selection must contain at least one item. */
  itemIds?: string[];
}

export interface StartSentinelCodaResponse {
  runId: string;
  /** Owner-scoped child chat identity, when available. */
  processId?: string;
}

export interface SentinelCodaFindingActionRequest {
  expectedItemRevision: number;
}

/** Accept and Undo return a stored item, without derived job execution. */
export interface SentinelCodaFindingWriteResponse {
  item: SentinelTodoWriteResponse['item'];
  finding: SentinelCodaFindingRecord;
}

/** Dismiss hides a finding and does not write a ledger item. */
export interface SentinelCodaFindingDismissResponse {
  finding: SentinelCodaFindingRecord;
}
