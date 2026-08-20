/**
 * Turn Performance Tracker
 *
 * Holds the per-turn in-flight timing state (enqueued/started/first-output
 * timestamps) and the pure derivation that turns it into a
 * {@link TurnPerformanceEvent} at settlement.
 *
 * Hot-path contract: {@link TurnPerformanceTracker.markFirstOutput} is called
 * on every output chunk and must stay O(1) with no I/O — it is a map lookup
 * plus one guarded timestamp assignment that fires at most once per turn.
 * The single event emission happens at turn settlement via
 * {@link TurnPerformanceTracker.settle}.
 *
 * State is keyed by processId (one in-flight turn per process at a time),
 * and every derived event carries its own processId + turnIndex — never
 * global. Pure Node.js; cross-platform.
 */

import type { TokenUsage, TurnPerformanceEvent, TurnPerformanceStatus } from '@plusplusoneplusplus/forge';

// ============================================================================
// Types
// ============================================================================

/** In-flight timing state for one running turn. Epoch-ms numbers. */
export interface InFlightTurnTiming {
    /** When the turn was enqueued, if known. */
    enqueuedAt?: number;
    /** When the executor started running the turn. */
    startedAt: number;
    /** Stamped once on the first output chunk; undefined until then. */
    firstOutputAt?: number;
}

/** Descriptive context handed in at settlement to complete the event. */
export interface TurnSettlementContext {
    turnIndex: number;
    workspaceId?: string;
    provider?: string;
    model?: string;
    effortTier?: string;
    mode?: string;
    kind?: string;
    tokenUsage?: TokenUsage;
    status: TurnPerformanceStatus;
}

// ============================================================================
// Pure derivation
// ============================================================================

/** Round to 3 decimal places so stored TPS values stay readable. */
function round3(value: number): number {
    return Math.round(value * 1000) / 1000;
}

/**
 * Derive a complete {@link TurnPerformanceEvent} from in-flight timing,
 * settlement context, and the settlement timestamp.
 *
 * Rules (missing data is `null`, never zero):
 * - `ttftMs` / `generationMs` are null when the turn produced no output.
 * - `queueWaitMs` is null when `enqueuedAt` is unknown.
 * - token fields are null when the provider reported no usage.
 * - `tpsGeneration` / `tpsWall` are null when tokens are missing or the
 *   corresponding duration is <= 0 (never divide by zero).
 */
export function deriveTurnPerformanceEvent(
    processId: string,
    timing: InFlightTurnTiming,
    context: TurnSettlementContext,
    endedAt: number,
): TurnPerformanceEvent {
    const { startedAt, enqueuedAt, firstOutputAt } = timing;
    const usage = context.tokenUsage;

    const wallMs = Math.max(0, endedAt - startedAt);
    const ttftMs = firstOutputAt !== undefined ? Math.max(0, firstOutputAt - startedAt) : null;
    const generationMs = firstOutputAt !== undefined ? Math.max(0, endedAt - firstOutputAt) : null;
    const queueWaitMs = enqueuedAt !== undefined ? Math.max(0, startedAt - enqueuedAt) : null;

    const outputTokens = usage?.outputTokens ?? null;
    const tpsGeneration = outputTokens !== null && generationMs !== null && generationMs > 0
        ? round3(outputTokens / (generationMs / 1000))
        : null;
    const tpsWall = outputTokens !== null && wallMs > 0
        ? round3(outputTokens / (wallMs / 1000))
        : null;

    return {
        id: `${processId}:${context.turnIndex}`,
        processId,
        turnIndex: context.turnIndex,
        workspaceId: context.workspaceId ?? null,
        provider: context.provider ?? null,
        model: context.model ?? null,
        effortTier: context.effortTier ?? null,
        mode: context.mode ?? null,
        kind: context.kind ?? null,
        enqueuedAt: enqueuedAt !== undefined ? new Date(enqueuedAt).toISOString() : null,
        startedAt: new Date(startedAt).toISOString(),
        firstOutputAt: firstOutputAt !== undefined ? new Date(firstOutputAt).toISOString() : null,
        endedAt: new Date(endedAt).toISOString(),
        ttftMs,
        queueWaitMs,
        generationMs,
        wallMs,
        inputTokens: usage?.inputTokens ?? null,
        outputTokens,
        totalTokens: usage?.totalTokens ?? null,
        tpsGeneration,
        tpsWall,
        status: context.status,
    };
}

// ============================================================================
// Tracker
// ============================================================================

/**
 * Per-process registry of in-flight turn timing.
 *
 * Lifecycle: `begin()` when the executor starts a turn, `markFirstOutput()`
 * on every output chunk (idempotent, O(1)), then exactly one of `settle()`
 * (returns the derived event and clears state) or `abandon()` (clears state
 * without an event, e.g. when a retry resets the turn).
 *
 * If `begin()` was never called (e.g. a process resumed mid-turn so
 * `startedAt` is unknown), `markFirstOutput` is a no-op and `settle` returns
 * `undefined` — a bogus TTFT is never recorded.
 */
export class TurnPerformanceTracker {
    private readonly inflight = new Map<string, InFlightTurnTiming>();

    /** Stamp the start of a turn. Overwrites any stale entry for the process. */
    begin(processId: string, options?: { enqueuedAt?: number }): void {
        this.inflight.set(processId, {
            startedAt: Date.now(),
            ...(options?.enqueuedAt !== undefined ? { enqueuedAt: options.enqueuedAt } : {}),
        });
    }

    /**
     * Stamp the first output chunk for the process's in-flight turn.
     * O(1); assigns a timestamp at most once per turn; no-op when no turn
     * is in flight.
     */
    markFirstOutput(processId: string): void {
        const timing = this.inflight.get(processId);
        if (timing && timing.firstOutputAt === undefined) {
            timing.firstOutputAt = Date.now();
        }
    }

    /** Whether a turn is currently being timed for the process. */
    hasInFlight(processId: string): boolean {
        return this.inflight.has(processId);
    }

    /** Read-only view of the in-flight timing (for tests/diagnostics). */
    getInFlight(processId: string): Readonly<InFlightTurnTiming> | undefined {
        return this.inflight.get(processId);
    }

    /**
     * Settle the in-flight turn: derive the event, clear the state.
     * Returns `undefined` when no turn was being timed (never fabricates
     * a row with an unknown `startedAt`).
     */
    settle(processId: string, context: TurnSettlementContext): TurnPerformanceEvent | undefined {
        const timing = this.inflight.get(processId);
        if (!timing) return undefined;
        this.inflight.delete(processId);
        return deriveTurnPerformanceEvent(processId, timing, context, Date.now());
    }

    /** Drop the in-flight timing without producing an event. */
    abandon(processId: string): void {
        this.inflight.delete(processId);
    }
}
