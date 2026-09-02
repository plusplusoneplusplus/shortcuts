/**
 * Defines the `CronEntry` type and related types for the cron subsystem.
 * Crons are a **separate** concept from schedules — own type, own persistence,
 * own executor.  They reuse `ScheduleTimerRegistry` for timing and
 * `TaskQueueManager` for execution.
 *
 * A cron fires recurring follow-up messages into the same conversation
 * (identified by `processId`).
 */

// ============================================================================
// Status
// ============================================================================

export type CronStatus = 'active' | 'paused' | 'cancelled' | 'expired';

// ============================================================================
// CronEntry
// ============================================================================

export interface CronEntry {
    /** Unique cron identifier (e.g. `cron_<random>`). */
    id: string;

    /** Process (conversation) this cron fires into. */
    processId: string;

    /** Human-readable description of what the cron does. */
    description: string;

    /** Fixed interval in milliseconds between ticks. */
    intervalMs: number;

    /** Current status. */
    status: CronStatus;

    /** ISO timestamp of creation. */
    createdAt: string;

    /** ISO timestamp of last successful tick (null if never ticked). */
    lastTickAt: string | null;

    /** ISO timestamp of next scheduled tick (null if paused/cancelled/expired). */
    nextTickAt: string | null;

    /** Number of ticks executed so far. */
    tickCount: number;

    /** Consecutive execution failures (resets on success). */
    consecutiveFailures: number;

    /** TTL expiry ISO timestamp (default: 3 days from creation). */
    expiresAt: string;

    /** Reason for pause (set when auto-paused or manually paused). */
    pausedReason: string | null;

    /** The follow-up prompt to send on each tick. */
    prompt: string;

    /** Optional model override for cron ticks. */
    model: string | null;

    /**
     * Workspace (repo) this cron belongs to.
     * Persisted at creation time so the workspace filter does not depend
     * on live in-memory task state. May be `undefined` for legacy rows
     * that were created before this field existed.
     */
    workspaceId?: string;
}

// ============================================================================
// CronChangeEvent (for WebSocket/SSE broadcasting)
// ============================================================================

export interface CronChangeEvent {
    type:
        | 'cron-created'
        | 'cron-updated'
        | 'cron-paused'
        | 'cron-resumed'
        | 'cron-cancelled'
        | 'cron-expired'
        | 'cron-tick';
    cron: CronEntry;
}

// ============================================================================
// Constants
// ============================================================================

/** Minimum allowed interval for the `cron` tool's create action (10 seconds). */
export const MIN_CRON_INTERVAL_MS = 10_000;

/** Minimum allowed delay for `scheduleWakeup` (1 second). */
export const MIN_WAKEUP_DELAY_MS = 1_000;

/** Default TTL for crons (3 days). */
export const DEFAULT_CRON_TTL_MS = 3 * 24 * 60 * 60 * 1000;

/** Max consecutive failures before auto-pause. */
export const MAX_CONSECUTIVE_FAILURES = 3;

/** Max consecutive wakeups per process (resets on manual user message). */
export const MAX_CONSECUTIVE_WAKEUPS_PER_PROCESS = 100;

/** Max active crons per server. */
export const MAX_ACTIVE_CRONS = 50;
