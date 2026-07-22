/**
 * Wakeup Subsystem Types
 *
 * A **wakeup** is a one-shot, durable counterpart to a loop: the
 * `scheduleWakeup` tool records a single future follow-up into a conversation
 * (identified by `processId`) and it fires exactly once. Unlike loops, wakeups
 * do not recur — after they fire (or fail) they are terminal.
 *
 * Wakeups share the timer registry (`ScheduleTimerRegistry`) and the shared
 * `processes.db` SQLite handle with loops, but keep their own table, store, and
 * executor so recurrence/failure-count policy never leaks between the two.
 */

// ============================================================================
// Status
// ============================================================================

/**
 * Wakeup lifecycle status.
 * - `pending`   — armed (or awaiting re-arm after restart); not yet fired.
 * - `fired`     — the follow-up ran successfully. Terminal.
 * - `failed`    — the follow-up threw; `failureReason` holds the message. Terminal.
 * - `cancelled` — cancelled before firing. Terminal.
 */
export type WakeupStatus = 'pending' | 'fired' | 'failed' | 'cancelled';

// ============================================================================
// WakeupEntry
// ============================================================================

export interface WakeupEntry {
    /** Unique wakeup identifier (e.g. `wakeup_<random>`). */
    id: string;

    /** Process (conversation) this wakeup fires into. */
    processId: string;

    /** The follow-up prompt to send when the wakeup fires. */
    prompt: string;

    /** Optional model override for the follow-up turn. */
    model: string | null;

    /** Current status. */
    status: WakeupStatus;

    /** ISO timestamp of creation. */
    createdAt: string;

    /** ISO timestamp of the absolute fire time. */
    firesAt: string;

    /**
     * ISO timestamp of the terminal transition (fired or failed), or `null`
     * while still pending / when cancelled before firing.
     */
    firedAt: string | null;

    /** Failure message when `status === 'failed'`, else `null`. */
    failureReason: string | null;

    /**
     * Workspace (repo) this wakeup belongs to.
     * Persisted at creation time so the workspace filter does not depend on
     * live in-memory task state. May be `undefined` for legacy rows created
     * before this field existed.
     */
    workspaceId?: string;
}

// ============================================================================
// WakeupChangeEvent (for WebSocket/SSE broadcasting)
// ============================================================================

export interface WakeupChangeEvent {
    type: 'wakeup-scheduled' | 'wakeup-fired' | 'wakeup-failed' | 'wakeup-cancelled';
    wakeup: WakeupEntry;
}

// ============================================================================
// Constants
// ============================================================================

/**
 * Retention window for terminal (fired/failed/cancelled) wakeups. Terminal
 * rows older than this are pruned at startup to keep `processes.db` compact.
 * 7 days.
 */
export const WAKEUP_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
