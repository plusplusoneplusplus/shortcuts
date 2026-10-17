/**
 * Trigger API contract types — mirrors server-side Trigger serialization.
 *
 * A trigger binds an `event` (watched condition) to an `action` (what fires).
 * Events: the `condition-monitor` `ci-failure` CI auto-fix monitor and the
 * one-shot `pr-merged` watch or absolute `date-time` bound to a Sentinel To-do. Action:
 * `send-message`.
 */

export type TriggerStatus = 'active' | 'paused' | 'disarmed' | 'expired';

export type ConditionMonitorKind = 'ci-failure' | 'pr-merged';

export interface ConditionMonitorEvent {
  type: 'condition-monitor';
  monitor: 'ci-failure';
  originId: string;
  prId: string;
  pollIntervalMs: number;
  lastSeenChecks: Record<string, string>;
  /** Missing scope authorizes CI only. */
  repairScope?: 'ci' | 'ci-and-conflicts';
  prKey?: string;
  repairStatus?: string;
  attemptSha?: string;
  attemptCount?: number;
  attemptNotified?: boolean;
  conflictAttempts?: Record<string, number>;
  conflictAttemptKey?: string;
  conflictAwaitingHead?: string;
  conflictBlocked?: string;
  repairDelivery?: { id: string; prompt: string; state: 'pending' | 'admitted' | 'blocked'; attempts: number; retryAt?: number };
}

/** Provider-qualified pull request watched by URL with server credentials. */
export interface PrIdentity {
  provider: 'github' | 'ado';
  host: string;
  repoPath: string;
  number: number;
  url: string;
  workspaceId?: string;
  originId?: string;
}

export type WatchedPrStatus = 'open' | 'draft' | 'merged' | 'closed';

export interface PrMergedMonitorEvent {
  type: 'condition-monitor';
  monitor: 'pr-merged';
  pr: PrIdentity;
  pollIntervalMs: number;
  lastSeenStatus?: WatchedPrStatus;
  /** Provider PR title (untrusted display text). */
  lastSeenTitle?: string;
  mergeCommit?: string;
  lastError?: { message: string; at: string };
  consecutiveErrors: number;
  terminalObservation?: { status: 'merged' | 'closed'; observedAt: string };
}

export interface DateTimeTriggerEvent {
  type: 'date-time';
  /** Absent on non-polling events; permits monitor-qualified narrowing. */
  monitor?: never;
  firesAt: string;
  timeZone: string;
}

export type TriggerEvent = ConditionMonitorEvent | PrMergedMonitorEvent | DateTimeTriggerEvent;

export type TriggerActionMode = 'autopilot' | 'inherit';

export interface SendMessageAction {
  type: 'send-message';
  processId: string;
  prompt: string;
  mode: TriggerActionMode;
}

export type TriggerAction = SendMessageAction;

export interface SentinelTodoTriggerBinding {
  kind: 'sentinel-todo';
  itemId: string;
  instruction?: string;
  armedBy: 'user' | 'sentinel';
  armedAt: string;
  removedAt?: string;
  idempotencyKey?: string;
  delegatedPr?: { jobId: string; receiptId: string };
}

export type TriggerOutcome = 'fired' | 'closed-unmerged' | 'skipped' | 'error';

export interface TriggerDelivery {
  deliveryId: string;
  firedAt: string;
  reason: 'merged' | 'closed' | 'run-now' | 'due';
  state: 'pending' | 'delivered' | 'failed';
  deliveredAt?: string;
  itemRevision?: number;
  consecutiveErrors?: number;
}

export interface Trigger {
  id: string;
  workspaceId: string;
  processId: string;
  status: TriggerStatus;
  event: TriggerEvent;
  action: TriggerAction;
  inFlight: boolean;
  createdAt: string;
  /** `null` for rules that never expire (one-shot wake rules). */
  expiresAt: string | null;
  lastTickAt: string | null;
  nextTickAt: string | null;
  revision: number;
  binding?: SentinelTodoTriggerBinding;
  outcome?: TriggerOutcome;
  outcomeReason?: string;
  delivery?: TriggerDelivery;
}

/** Request body for creating (and arming) a `ci-failure` condition monitor. */
export interface CreateTriggerRequest {
  /** Conversation (process) the action targets. */
  processId: string;
  event: {
    type: 'condition-monitor';
    monitor: 'ci-failure';
    originId: string;
    prId: string;
    pollIntervalMs?: number;
    /** Explicit ci-and-conflicts also reauthorizes an existing CI-only monitor. */
    repairScope?: 'ci' | 'ci-and-conflicts';
  };
  action?: {
    type?: 'send-message';
    processId?: string;
    prompt?: string;
    mode?: TriggerActionMode;
  };
}

export interface ListTriggersResponse {
  triggers: Trigger[];
}

export interface TriggerMutationResponse {
  trigger: Trigger;
}

export interface TriggerDeleteResponse {
  deleted: boolean;
  trigger: Trigger;
}

export type SentinelTodoTriggerInput = {
  itemId: string;
  instruction?: string;
} & ({
  prUrl: string;
  workspaceId?: string;
  originId?: string;
  event?: never;
} | {
  event: DateTimeTriggerEvent & { localTime: string };
  prUrl?: never;
  workspaceId?: never;
  originId?: never;
});

export type CreateSentinelTodoTriggerRequest = SentinelTodoTriggerInput & {
  runNow?: boolean;
  confirmed?: true;
  idempotencyKey?: string;
}

export type EditSentinelTodoTriggerRequest = SentinelTodoTriggerInput & {
  expectedRevision: number;
}

export interface PrTriggerPreview {
  pr: PrIdentity;
  snapshot: {
    status: WatchedPrStatus;
    title: string;
    url: string;
    mergeCommit?: string;
    mergedAt?: string;
  };
}
