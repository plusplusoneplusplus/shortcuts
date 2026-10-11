/**
 * Trigger API contract types — mirrors server-side Trigger serialization.
 *
 * A trigger binds an `event` (watched condition) to an `action` (what fires).
 * Events: the `condition-monitor` `ci-failure` CI auto-fix monitor and the
 * one-shot `pr-merged` watch bound to a Sentinel To-do item. Action:
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
}

export type TriggerEvent = ConditionMonitorEvent | PrMergedMonitorEvent;

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
}

export type TriggerOutcome = 'fired' | 'closed-unmerged' | 'skipped' | 'error';

export interface TriggerDelivery {
  deliveryId: string;
  firedAt: string;
  reason: 'merged' | 'run-now';
  state: 'pending' | 'delivered';
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
  /** `null` for rules that never expire (PR-merge wake rules). */
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

export interface SentinelTodoTriggerInput {
  itemId: string;
  prUrl: string;
  instruction?: string;
  workspaceId?: string;
  originId?: string;
}

export interface CreateSentinelTodoTriggerRequest extends SentinelTodoTriggerInput {
  runNow?: boolean;
  confirmed?: true;
  idempotencyKey?: string;
}

export interface EditSentinelTodoTriggerRequest extends SentinelTodoTriggerInput {
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
