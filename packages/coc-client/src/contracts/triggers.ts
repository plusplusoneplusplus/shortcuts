/**
 * Trigger API contract types — mirrors server-side Trigger serialization.
 *
 * A trigger binds an `event` (watched condition) to an `action` (what fires).
 * Only the `condition-monitor` / `ci-failure` event and the `send-message`
 * action are implemented; the shape is left open for future event types.
 */

export type TriggerStatus = 'active' | 'paused' | 'disarmed' | 'expired';

export type ConditionMonitorKind = 'ci-failure';

export interface ConditionMonitorEvent {
  type: 'condition-monitor';
  monitor: ConditionMonitorKind;
  originId: string;
  prId: string;
  pollIntervalMs: number;
  lastSeenChecks: Record<string, string>;
}

export type TriggerEvent = ConditionMonitorEvent;

export type TriggerActionMode = 'autopilot';

export interface SendMessageAction {
  type: 'send-message';
  processId: string;
  prompt: string;
  mode: TriggerActionMode;
}

export type TriggerAction = SendMessageAction;

export interface Trigger {
  id: string;
  workspaceId: string;
  processId: string;
  status: TriggerStatus;
  event: TriggerEvent;
  action: TriggerAction;
  inFlight: boolean;
  createdAt: string;
  expiresAt: string;
  lastTickAt: string | null;
  nextTickAt: string | null;
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
