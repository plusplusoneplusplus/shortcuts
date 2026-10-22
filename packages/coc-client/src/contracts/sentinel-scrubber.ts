import type { SentinelTodoStatus, SentinelTodoWriteResponse } from './sentinel-todos';

/** Scrubber data is scoped to the ledger's workspace and Sentinel on its owning server. */
export type SentinelScrubRunStatus = 'queued' | 'running' | 'completed' | 'failed' | 'timed_out'
  | 'cancelled' | 'interrupted' | 'skipped';
export type SentinelScrubVerdict = 'done' | 'obsolete' | 'in_progress' | 'deferred' | 'needs_attention' | 'unchanged' | 'unverified';

export interface SentinelScrubberConfig {
  enabled: boolean;
  cron: string;
  paused: boolean;
  consecutiveFailures: number;
  revision: number;
  lastInputFingerprint?: string;
  nextRunAt?: string;
}

export interface SentinelScrubEvidence {
  kind: 'pr' | 'commit' | 'job' | 'reference' | 'other';
  ref: string;
  state: 'merged' | 'open' | 'closed' | 'on_default_branch' | 'succeeded' | 'failed' | 'other';
  observedAt?: string;
  checkedAt: string;
}

export interface SentinelScrubFinding {
  itemId: string;
  verdict: SentinelScrubVerdict;
  confidence: 'high' | 'medium' | 'low';
  autoApply: boolean;
  summary: string;
  rationale: string;
  unverifiedReason?: string;
  evidence: SentinelScrubEvidence[];
}

export interface SentinelScrubItemState {
  status: SentinelTodoStatus;
  outcome?: string;
  archived: boolean;
  revision: number;
}

export interface SentinelScrubAuditEntry {
  action: 'applied' | 'accepted' | 'dismissed' | 'undone';
  actor: 'scrubber' | 'user';
  at: string;
  before?: SentinelScrubItemState;
  after?: SentinelScrubItemState;
}

export interface SentinelScrubFindingRecord {
  runId: string;
  itemId: string;
  finding: SentinelScrubFinding;
  fingerprint: string;
  itemRevision: number;
  state: 'pending' | 'applied' | 'proposed' | 'accepted' | 'dismissed' | 'undone'
    | 'unchanged' | 'unverified' | 'suppressed';
  demotedBecause?: 'superseded' | 'user_verdict' | 'manual' | 'evidence_gate';
  audit: SentinelScrubAuditEntry[];
}

/** Queued and running records include snapshots, but findings are read from run detail. */
export interface SentinelScrubRun {
  id: string;
  trigger: 'manual' | 'schedule';
  status: SentinelScrubRunStatus;
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

export interface SentinelScrubRunSummary extends Pick<SentinelScrubRun,
  'id' | 'trigger' | 'status' | 'createdAt' | 'startedAt' | 'finishedAt' | 'childProcessId' | 'error' | 'skipReason'> {
  itemCount: number;
  deferredCount: number;
  awaitingReviewCount: number;
  counts: { done: number; proposals: number; unverified: number };
}

export interface SentinelScrubRunDetail extends SentinelScrubRun {
  findings: SentinelScrubFindingRecord[];
}

export interface SentinelScrubberResponse {
  config: SentinelScrubberConfig;
  activeRun?: SentinelScrubRun;
  runs: SentinelScrubRunSummary[];
}

export interface UpdateSentinelScrubberConfigRequest {
  enabled: boolean;
  cron: string;
  expectedRevision: number;
}

export interface StartSentinelScrubRequest {
  /** Omit to scrub all open items; a selection must contain at least one item. */
  itemIds?: string[];
}

export interface StartSentinelScrubResponse {
  runId: string;
  /** Owner-scoped child chat identity, when available. */
  processId?: string;
}

export interface SentinelScrubFindingActionRequest {
  expectedItemRevision: number;
}

/** Accept and Undo return a stored item, without derived job execution. */
export interface SentinelScrubFindingWriteResponse {
  item: SentinelTodoWriteResponse['item'];
  finding: SentinelScrubFindingRecord;
}

/** Dismiss hides a finding and does not write a ledger item. */
export interface SentinelScrubFindingDismissResponse {
  finding: SentinelScrubFindingRecord;
}
