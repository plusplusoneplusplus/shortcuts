/**
 * Turn Performance Types
 *
 * The raw per-turn latency/throughput metric event recorded for every agent
 * turn: time to first token (TTFT), tokens per second (TPS), and the
 * timestamps they are derived from.
 *
 * One event maps to one row in the `turn_performance` table of the shared
 * `processes.db`. Missing data is represented as `null` (mapped to SQL NULL),
 * never as zero, so aggregates can exclude unknowns without skewing.
 *
 * Pure type definitions; no runtime logic.
 */

/** Terminal status of the turn the event describes. */
export type TurnPerformanceStatus = 'completed' | 'errored' | 'cancelled';

/**
 * A raw per-turn performance metric event.
 *
 * Timestamps are ISO 8601 UTC strings and are the source of truth; the
 * derived `*Ms` and `tps*` fields are stored redundantly so aggregation
 * queries stay cheap but remain recomputable from the timestamps.
 */
export interface TurnPerformanceEvent {
    /** Idempotency key: `${processId}:${turnIndex}`. */
    id: string;
    processId: string;
    /** 0-based assistant turn index within the process; 0 = new session. */
    turnIndex: number;
    workspaceId: string | null;
    provider: string | null;
    model: string | null;
    effortTier: string | null;
    /** `ask` | `autopilot`. */
    mode: string | null;
    /** Process kind: `chat` | `ralph` | `workflow` | `subagent` | `cron` | ... */
    kind: string | null;
    /** When the turn was enqueued, if known. */
    enqueuedAt: string | null;
    /** When the executor started running the turn. */
    startedAt: string;
    /** When the first output chunk arrived; null when the turn produced no output. */
    firstOutputAt: string | null;
    /** When the turn settled. */
    endedAt: string;
    /** firstOutputAt - startedAt (model latency, excludes queue wait); null when no output. */
    ttftMs: number | null;
    /** startedAt - enqueuedAt; null when enqueuedAt is unknown. */
    queueWaitMs: number | null;
    /** endedAt - firstOutputAt; null when no output. */
    generationMs: number | null;
    /** endedAt - startedAt. Always present. */
    wallMs: number;
    inputTokens: number | null;
    /** null when the provider reported no token usage for the turn. */
    outputTokens: number | null;
    totalTokens: number | null;
    /** outputTokens / (generationMs / 1000); null when either input is missing or generationMs <= 0. */
    tpsGeneration: number | null;
    /** outputTokens / (wallMs / 1000); null when tokens are missing or wallMs <= 0. */
    tpsWall: number | null;
    status: TurnPerformanceStatus;
}
