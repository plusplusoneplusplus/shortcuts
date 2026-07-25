/**
 * useAutoPullTimer — recurring, lifecycle-aware timer for per-repo auto-pull.
 *
 * Fires `onTick` every `intervalMinutes` while `enabled`, mirroring the lifecycle
 * discipline of useGitOperationPoller: the interval handle lives in a ref and is
 * cleared on unmount, on workspace change, when disabled, and whenever the
 * interval changes — so a setting change re-arms the timer rather than leaking a
 * second one. The latest `onTick` is read through a ref, so the interval is not
 * torn down just because the callback identity changed on re-render (which it
 * does every render, since the tick closes over `pulling` and friends).
 *
 * Changing `resetSignal` re-arms the timer, restarting the countdown to a full
 * interval — used after a manual pull or a successful auto-pull so the next tick
 * is a full interval later rather than an immediate double-pull.
 *
 * The hook owns LIFECYCLE only. What a tick does (dirty pre-check, single-flight
 * guard, running the pull, toast) lives in the caller's `onTick` — see
 * `runAutoPullTick`.
 */

import { useEffect, useRef } from 'react';

/** Minutes → milliseconds. Exported so tests can reason about tick timing. */
export const MINUTE_MS = 60_000;

export interface UseAutoPullTimerOptions {
    /** Workspace / repo scope. Changing it tears down and (if enabled) rebuilds the timer. */
    workspaceId: string;
    /** Whether auto-pull is on for this repo. */
    enabled: boolean;
    /** Interval between ticks, in minutes. Must be a positive integer to arm the timer. */
    intervalMinutes: number | undefined;
    /** Called on every tick while enabled. Read through a ref, so its identity may change freely. */
    onTick: () => void;
    /** Change this value to restart the countdown (e.g. after a manual/successful pull). */
    resetSignal?: unknown;
}

/** A positive-integer minute count is required before the timer is armed. */
function isArmable(enabled: boolean, intervalMinutes: number | undefined): intervalMinutes is number {
    return enabled && intervalMinutes != null && Number.isInteger(intervalMinutes) && intervalMinutes >= 1;
}

/**
 * Arm a per-repo auto-pull interval with mount/workspace-aware cleanup.
 *
 * Re-arms (never duplicates) whenever `workspaceId`, `enabled`, `intervalMinutes`,
 * or `resetSignal` changes; clears the interval on unmount and when disabled.
 */
export function useAutoPullTimer({
    workspaceId,
    enabled,
    intervalMinutes,
    onTick,
    resetSignal,
}: UseAutoPullTimerOptions): void {
    const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
    // Latest onTick, so a callback-identity change doesn't force a re-arm.
    const onTickRef = useRef(onTick);
    onTickRef.current = onTick;

    useEffect(() => {
        if (!isArmable(enabled, intervalMinutes)) return;
        const periodMs = intervalMinutes * MINUTE_MS;
        intervalRef.current = setInterval(() => {
            onTickRef.current();
        }, periodMs);
        return () => {
            if (intervalRef.current) {
                clearInterval(intervalRef.current);
                intervalRef.current = null;
            }
        };
    }, [workspaceId, enabled, intervalMinutes, resetSignal]);
}
