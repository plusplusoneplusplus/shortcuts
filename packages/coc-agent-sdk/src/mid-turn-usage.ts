/**
 * Mid-turn token-usage reporting.
 *
 * The context-window meter in CoC only used to move at turn boundaries, because
 * usage could escape a provider service only through the returned
 * `IInvocationResult.tokenUsage` — which by definition exists only once the turn
 * has resolved. `SendMessageOptions.onTokenUsage` is the route out for usage a
 * provider learns *during* a turn; this module holds the shared payload shape
 * and the coalescing throttle every provider funnels through.
 *
 * Mid-turn usage is strictly best-effort: it must never delay streaming output
 * and must never fail a turn. The turn-end value stays authoritative.
 */

import type { TokenUsage } from './types';

/**
 * Minimum gap between two mid-turn usage emissions, per turn.
 *
 * Tradeoff: the meter should visibly move during a long turn, but each emission
 * costs an SSE frame to every connected client — and for Claude/Codex, which
 * have no natural mid-turn usage event, it also costs a live poll of the
 * provider (a control request to the SDK subprocess, or a rollout-file read).
 * 3s is slow enough that those polls stay negligible next to the turn itself,
 * and fast enough that a multi-minute turn produces a steadily moving bar.
 */
export const MID_TURN_TOKEN_USAGE_INTERVAL_MS = 3000;

/**
 * A partial usage snapshot observed mid-turn.
 *
 * Deliberately reuses {@link TokenUsage} field names so no new wire vocabulary
 * is introduced — consumers relay these straight onto the existing `token-usage`
 * process event. Providers populate whatever subset they know: at minimum
 * `tokenLimit`/`currentTokens`, plus the 3-way breakdown when available.
 */
export type MidTurnTokenUsage = Partial<TokenUsage>;

/** Callback fired with each mid-turn usage snapshot. */
export type MidTurnTokenUsageCallback = (usage: MidTurnTokenUsage) => void;

/** A throttled sink for mid-turn usage snapshots. */
export interface MidTurnUsageThrottle {
    /**
     * Record a new snapshot. At most one emission happens per interval; when
     * several snapshots land inside one window they collapse into a single
     * emission carrying the *latest* value.
     */
    report(usage: MidTurnTokenUsage): void;
    /**
     * Cancel any pending emission and drop the buffered value. Called at turn
     * end so the authoritative turn-end emission is never followed by a stale
     * mid-turn one, and so no timer outlives the turn.
     */
    dispose(): void;
}

/** No-op throttle used when the caller supplied no callback. */
const NOOP_THROTTLE: MidTurnUsageThrottle = {
    report: () => { /* no consumer */ },
    dispose: () => { /* nothing to cancel */ },
};

/**
 * Wrap a mid-turn usage callback in a trailing-edge coalescing throttle.
 *
 * Trailing edge rather than leading: two updates inside one window must produce
 * one emission carrying the second value, not two emissions. A leading-edge
 * throttle would publish the already-stale first value immediately and then
 * still owe a second emission.
 *
 * Returns a no-op throttle when `callback` is undefined, so providers can call
 * `report()` unconditionally.
 */
export function createMidTurnUsageThrottle(
    callback: MidTurnTokenUsageCallback | undefined,
    intervalMs: number = MID_TURN_TOKEN_USAGE_INTERVAL_MS,
    onError?: (err: unknown) => void,
): MidTurnUsageThrottle {
    if (!callback) { return NOOP_THROTTLE; }

    let pending: MidTurnTokenUsage | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let disposed = false;

    const flush = (): void => {
        timer = undefined;
        const usage = pending;
        pending = undefined;
        if (disposed || !usage) { return; }
        try {
            callback(usage);
        } catch (err) {
            // Best-effort by contract: a broken consumer must not fail the turn.
            onError?.(err);
        }
    };

    return {
        report(usage: MidTurnTokenUsage): void {
            if (disposed) { return; }
            pending = usage;
            if (timer) { return; }
            timer = setTimeout(flush, intervalMs);
            // Never hold the process open for a usage tick.
            (timer as unknown as { unref?: () => void }).unref?.();
        },
        dispose(): void {
            disposed = true;
            pending = undefined;
            if (timer) {
                clearTimeout(timer);
                timer = undefined;
            }
        },
    };
}

/** A running mid-turn usage poll. */
export interface MidTurnUsagePoller {
    /** Stop polling and drop any in-flight read's result. Idempotent. */
    dispose(): void;
}

/** Poller that never runs — used when nobody is listening. */
const NOOP_POLLER: MidTurnUsagePoller = { dispose: () => { /* never started */ } };

export interface MidTurnUsagePollerOptions {
    /** Consumer of each snapshot. When undefined the poller never reads. */
    callback: MidTurnTokenUsageCallback | undefined;
    /** Fetch the current usage. Resolving `undefined` is a silent no-op tick. */
    read: () => Promise<MidTurnTokenUsage | undefined>;
    /** Checked before every read; returning false stops the poll for good. */
    isActive?: () => boolean;
    intervalMs?: number;
    onError?: (err: unknown) => void;
}

/**
 * Poll a provider that has no natural mid-turn usage event (Claude, Codex).
 *
 * Ticks are *chained*, not periodic: the next tick is scheduled only after the
 * previous read settles, so a slow read can never stack up concurrent provider
 * calls, and the interval is a floor on cost rather than a fixed cadence.
 *
 * Every read is best-effort — a rejection is routed to `onError` and the poll
 * carries on, because a mid-turn read must never fail the turn. Nothing here
 * runs on the streaming hot path: it is all timer-driven.
 *
 * Returns a no-op poller when `callback` is undefined, so a provider pays no
 * polling cost at all when the caller did not ask for mid-turn usage.
 */
export function createMidTurnUsagePoller(options: MidTurnUsagePollerOptions): MidTurnUsagePoller {
    const { callback, read, isActive, onError } = options;
    if (!callback) { return NOOP_POLLER; }
    const intervalMs = options.intervalMs ?? MID_TURN_TOKEN_USAGE_INTERVAL_MS;

    let timer: ReturnType<typeof setTimeout> | undefined;
    let disposed = false;

    const schedule = (): void => {
        if (disposed) { return; }
        timer = setTimeout(tick, intervalMs);
        // Never hold the process open for a usage tick.
        (timer as unknown as { unref?: () => void }).unref?.();
    };

    const tick = async (): Promise<void> => {
        timer = undefined;
        if (disposed || isActive?.() === false) { return; }
        try {
            const usage = await read();
            // The turn may have ended while the read was in flight; a snapshot
            // that lands after teardown must not follow the final value.
            if (!disposed && usage && Object.keys(usage).length > 0) {
                callback(usage);
            }
        } catch (err) {
            onError?.(err);
        }
        schedule();
    };

    schedule();
    return {
        dispose(): void {
            disposed = true;
            if (timer) {
                clearTimeout(timer);
                timer = undefined;
            }
        },
    };
}
