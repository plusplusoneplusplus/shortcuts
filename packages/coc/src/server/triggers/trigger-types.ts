/**
 * Trigger Subsystem Types
 *
 * A generic `event → action` framework. A `Trigger` binds an **event** (the
 * thing that is watched / fires) to an **action** (the thing that happens when
 * the event fires), scoped to a conversation `processId` and a `workspaceId`.
 *
 * This is intentionally shaped as a small, extensible abstraction:
 *  - `event` is a discriminated union. The ONLY variant implemented now is a
 *    server-side `condition-monitor` (CI-failure poller). `schedule` and
 *    `interval` variants are designed-for but NOT built this iteration.
 *  - `action` is a discriminated union with one variant: `send-message`.
 *
 * The framework reuses existing plumbing rather than inventing new plumbing:
 *  - `ScheduleTimerRegistry` for timing (see `TriggerManager`)
 *  - `TaskQueueManager` to enqueue and `FollowUpExecutor` to deliver actions
 *  - the `loop-store.ts` SQLite persistence pattern (see `trigger-store.ts`)
 */

// ============================================================================
// Status
// ============================================================================

/**
 * Lifecycle status of a trigger.
 * - `active`   — armed; the manager evaluates its event on each tick.
 * - `paused`   — temporarily disabled (manual toggle); timer disarmed.
 * - `disarmed` — terminally stopped (PR merged/closed or manual delete).
 * - `expired`  — terminally stopped because the TTL elapsed.
 */
export type TriggerStatus = 'active' | 'paused' | 'disarmed' | 'expired';

// ============================================================================
// Event (discriminated union — only `condition-monitor` built this iteration)
// ============================================================================

/** The kind of condition a `condition-monitor` event watches. */
export type ConditionMonitorKind = 'ci-failure';

/**
 * A server-side polling monitor. While the owning trigger is `active`, the
 * manager polls the watched condition on a steady cadence (`pollIntervalMs`)
 * and fires the action ONLY on a meaningful state transition. `lastSeenChecks`
 * carries the per-check last-seen conclusion so transitions can be detected
 * across ticks.
 */
export interface ConditionMonitorEvent {
    type: 'condition-monitor';
    monitor: ConditionMonitorKind;
    /** Origin (provider account/repo) that owns the PR. */
    originId: string;
    /** Pull-request identifier (provider-specific id/number as string). */
    prId: string;
    /** Steady poll cadence in milliseconds. */
    pollIntervalMs: number;
    /** checkId → last-seen conclusion (e.g. `success`, `failure`, `pending`). */
    lastSeenChecks: Record<string, string>;
    /**
     * Head commit SHA the retry counter is currently keyed to (AC-05). The empty
     * string is used as a stable sentinel when the provider snapshot omits a head
     * SHA, so the cap still accumulates. Reset (along with `attemptCount` /
     * `attemptNotified`) when a new commit changes the SHA.
     */
    attemptSha?: string;
    /**
     * Number of auto-fix attempts already FIRED for `attemptSha`. Gated at
     * `MAX_CI_FIX_ATTEMPTS`; once reached, no further fixes fire until a new
     * commit (new SHA) resets the count.
     */
    attemptCount?: number;
    /**
     * Whether the human has already been notified that the retry cap was hit for
     * `attemptSha`, so the notice surfaces once (not on every subsequent poll).
     */
    attemptNotified?: boolean;
}

/**
 * Designed-for, NOT built this iteration. Declared so the union is open for
 * extension without reworking the framework.
 */
// export interface ScheduleEvent { type: 'schedule'; cron: string; }
// export interface IntervalEvent { type: 'interval'; intervalMs: number; }

/** Discriminated union of all event variants. */
export type TriggerEvent = ConditionMonitorEvent;

// ============================================================================
// Action (discriminated union — only `send-message` built this iteration)
// ============================================================================

/** Mode a `send-message` action delivers its prompt in. */
export type TriggerActionMode = 'autopilot';

/**
 * Deliver a message (follow-up) into a conversation. The `processId` is the
 * conversation the message lands in (usually the same conversation the trigger
 * is bound to — i.e. the process the PR banner is rendered in).
 */
export interface SendMessageAction {
    type: 'send-message';
    processId: string;
    prompt: string;
    mode: TriggerActionMode;
}

/** Discriminated union of all action variants. */
export type TriggerAction = SendMessageAction;

// ============================================================================
// Trigger
// ============================================================================

export interface Trigger {
    /** Unique trigger identifier (e.g. `trigger_<random>`). */
    id: string;

    /** Workspace (repo) this trigger belongs to. */
    workspaceId: string;

    /** Conversation (process) the action targets. */
    processId: string;

    /** Current status. */
    status: TriggerStatus;

    /** The watched event. */
    event: TriggerEvent;

    /** The action fired when the event fires. */
    action: TriggerAction;

    /**
     * Suppression guard: while a fire is in flight (action delivered but not
     * yet complete), further fires are suppressed so only one fix runs at a
     * time. Cleared when the action completes.
     */
    inFlight: boolean;

    /** ISO timestamp of creation. */
    createdAt: string;

    /** ISO timestamp when the trigger auto-expires (createdAt + TTL). */
    expiresAt: string;

    /** ISO timestamp of last tick (null if never ticked). */
    lastTickAt: string | null;

    /**
     * ISO timestamp of the next scheduled tick (null if not active). Persisted
     * so active triggers can be re-armed across server restarts.
     */
    nextTickAt: string | null;
}

// ============================================================================
// Change events (for WebSocket/SSE broadcasting)
// ============================================================================

export interface TriggerChangeEvent {
    type:
        | 'trigger-created'
        | 'trigger-updated'
        | 'trigger-fired'
        | 'trigger-disarmed'
        | 'trigger-expired'
        | 'trigger-paused';
    trigger: Trigger;
}

// ============================================================================
// Constants (mirror the loop module)
// ============================================================================

/** Default TTL for triggers (3 days), mirroring loops. */
export const DEFAULT_TRIGGER_TTL_MS = 3 * 24 * 60 * 60 * 1000;

/** Default CI-failure poll cadence (~60s). */
export const DEFAULT_CI_POLL_INTERVAL_MS = 60_000;

/** Minimum allowed poll cadence (10s), mirroring the loop minimum. */
export const MIN_POLL_INTERVAL_MS = 10_000;

/** Max active triggers per server. */
export const MAX_ACTIVE_TRIGGERS = 50;

/**
 * Max auto-fix attempts fired per PR head SHA before the CI-failure monitor
 * stops firing and notifies the human (AC-05). The counter resets when a new
 * commit changes the head SHA.
 */
export const MAX_CI_FIX_ATTEMPTS = 2;
