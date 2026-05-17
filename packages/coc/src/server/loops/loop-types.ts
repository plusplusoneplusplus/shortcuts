/**
 * Loop Subsystem Types
 *
 * Defines the `LoopEntry` type and related types for the loop subsystem.
 * Loops are a **separate** concept from schedules — own type, own persistence,
 * own executor.  They reuse `ScheduleTimerRegistry` for timing and
 * `TaskQueueManager` for execution.
 *
 * A loop fires recurring follow-up messages into the same conversation
 * (identified by `processId`).
 */

// ============================================================================
// Status
// ============================================================================

export type LoopStatus = 'active' | 'paused' | 'cancelled' | 'expired';

// ============================================================================
// LoopEntry
// ============================================================================

export interface LoopEntry {
    /** Unique loop identifier (e.g. `loop_<random>`). */
    id: string;

    /** Process (conversation) this loop fires into. */
    processId: string;

    /** Human-readable description of what the loop does. */
    description: string;

    /** Fixed interval in milliseconds between ticks. */
    intervalMs: number;

    /** Current status. */
    status: LoopStatus;

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

    /** Optional model override for loop ticks. */
    model: string | null;

    /**
     * Workspace (repo) this loop belongs to.
     * Persisted at creation time so the workspace filter does not depend
     * on live in-memory task state. May be `undefined` for legacy rows
     * that were created before this field existed.
     */
    workspaceId?: string;
}

// ============================================================================
// LoopChangeEvent (for WebSocket/SSE broadcasting)
// ============================================================================

export interface LoopChangeEvent {
    type:
        | 'loop-created'
        | 'loop-updated'
        | 'loop-paused'
        | 'loop-resumed'
        | 'loop-cancelled'
        | 'loop-expired'
        | 'loop-tick';
    loop: LoopEntry;
}

// ============================================================================
// Constants
// ============================================================================

/** Minimum allowed interval for `createLoop` (10 seconds). */
export const MIN_LOOP_INTERVAL_MS = 10_000;

/** Minimum allowed delay for `scheduleWakeup` (1 second). */
export const MIN_WAKEUP_DELAY_MS = 1_000;

/** Default TTL for loops (3 days). */
export const DEFAULT_LOOP_TTL_MS = 3 * 24 * 60 * 60 * 1000;

/** Max consecutive failures before auto-pause. */
export const MAX_CONSECUTIVE_FAILURES = 3;

/** Max consecutive wakeups per process (resets on manual user message). */
export const MAX_CONSECUTIVE_WAKEUPS_PER_PROCESS = 100;

/** Max active loops per server. */
export const MAX_ACTIVE_LOOPS = 50;
