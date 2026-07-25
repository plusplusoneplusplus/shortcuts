/**
 * renderHook tests for useAutoPullTimer.
 *
 * Covers the recurring-timer lifecycle: fires every interval while enabled, not
 * before; stays silent when disabled or given an invalid interval; reads the
 * latest onTick without re-arming; re-arms (never duplicates) on interval /
 * reset / workspace change; and clears on disable + unmount.
 *
 * The final integration test wires the timer to the real runAutoPullTick to
 * prove AC-3: a tick triggers the pull path, and a second tick during an
 * in-flight pull does not start a second pull.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useAutoPullTimer, MINUTE_MS } from '../../../../src/server/spa/client/react/features/git/hooks/useAutoPullTimer';
import { runAutoPullTick } from '../../../../src/server/spa/client/react/features/git/autoPullTick';

/** Advance fake timers and flush any awaited async continuations. */
async function tick(ms: number): Promise<void> {
    await act(async () => {
        await vi.advanceTimersByTimeAsync(ms);
    });
}

describe('useAutoPullTimer', () => {
    beforeEach(() => { vi.useFakeTimers(); });
    afterEach(() => { vi.useRealTimers(); vi.clearAllMocks(); });

    it('does not fire when disabled', async () => {
        const onTick = vi.fn();
        renderHook(() => useAutoPullTimer({ workspaceId: 'ws-A', enabled: false, intervalMinutes: 5, onTick }));
        await tick(MINUTE_MS * 20);
        expect(onTick).not.toHaveBeenCalled();
    });

    it.each([0, -1, 1.5, undefined])('does not arm for an invalid interval (%s)', async (interval) => {
        const onTick = vi.fn();
        renderHook(() => useAutoPullTimer({
            workspaceId: 'ws-A', enabled: true, intervalMinutes: interval as number | undefined, onTick,
        }));
        await tick(MINUTE_MS * 20);
        expect(onTick).not.toHaveBeenCalled();
    });

    it('fires onTick every intervalMinutes while enabled', async () => {
        const onTick = vi.fn();
        renderHook(() => useAutoPullTimer({ workspaceId: 'ws-A', enabled: true, intervalMinutes: 5, onTick }));

        await tick(MINUTE_MS * 4);
        expect(onTick).not.toHaveBeenCalled(); // not before the interval elapses

        await tick(MINUTE_MS); // t = 5m
        expect(onTick).toHaveBeenCalledTimes(1);

        await tick(MINUTE_MS * 5); // t = 10m
        expect(onTick).toHaveBeenCalledTimes(2);
    });

    it('calls the latest onTick without re-arming when the callback identity changes', async () => {
        const fnA = vi.fn();
        const fnB = vi.fn();
        const { rerender } = renderHook(
            ({ cb }) => useAutoPullTimer({ workspaceId: 'ws-A', enabled: true, intervalMinutes: 5, onTick: cb }),
            { initialProps: { cb: fnA } },
        );

        await tick(MINUTE_MS * 3); // partway through the interval
        rerender({ cb: fnB });      // swap callback — must NOT restart the countdown
        await tick(MINUTE_MS * 2); // t = 5m: original countdown fires

        expect(fnA).not.toHaveBeenCalled();
        expect(fnB).toHaveBeenCalledTimes(1);
    });

    it('re-arms with the new interval when intervalMinutes changes (no leaked interval)', async () => {
        const onTick = vi.fn();
        const { rerender } = renderHook(
            ({ mins }) => useAutoPullTimer({ workspaceId: 'ws-A', enabled: true, intervalMinutes: mins, onTick }),
            { initialProps: { mins: 5 } },
        );

        await tick(MINUTE_MS * 5);
        expect(onTick).toHaveBeenCalledTimes(1);

        rerender({ mins: 10 });        // re-arm at the new cadence
        await tick(MINUTE_MS * 5);     // only half the new interval
        expect(onTick).toHaveBeenCalledTimes(1);

        await tick(MINUTE_MS * 5);     // full new interval reached
        expect(onTick).toHaveBeenCalledTimes(2);
    });

    it('restarts the countdown when resetSignal changes', async () => {
        const onTick = vi.fn();
        const { rerender } = renderHook(
            ({ sig }) => useAutoPullTimer({ workspaceId: 'ws-A', enabled: true, intervalMinutes: 5, onTick, resetSignal: sig }),
            { initialProps: { sig: 0 } },
        );

        await tick(MINUTE_MS * 3);
        rerender({ sig: 1 });          // reset — countdown starts over
        await tick(MINUTE_MS * 3);     // 3m since reset < 5m
        expect(onTick).not.toHaveBeenCalled();

        await tick(MINUTE_MS * 2);     // 5m since reset
        expect(onTick).toHaveBeenCalledTimes(1);
    });

    it('restarts the countdown (no duplicate) when the workspace changes', async () => {
        const onTick = vi.fn();
        const { rerender } = renderHook(
            ({ ws }) => useAutoPullTimer({ workspaceId: ws, enabled: true, intervalMinutes: 5, onTick }),
            { initialProps: { ws: 'ws-A' } },
        );

        await tick(MINUTE_MS * 3);
        rerender({ ws: 'ws-B' });      // switch repo — old interval cleared, new one armed
        await tick(MINUTE_MS * 3);
        expect(onTick).not.toHaveBeenCalled();

        await tick(MINUTE_MS * 2);
        expect(onTick).toHaveBeenCalledTimes(1); // exactly one — no leaked ws-A interval
    });

    it('clears the interval when auto-pull is disabled', async () => {
        const onTick = vi.fn();
        const { rerender } = renderHook(
            ({ on }) => useAutoPullTimer({ workspaceId: 'ws-A', enabled: on, intervalMinutes: 5, onTick }),
            { initialProps: { on: true } },
        );

        await tick(MINUTE_MS * 5);
        expect(onTick).toHaveBeenCalledTimes(1);

        rerender({ on: false });
        await tick(MINUTE_MS * 20);
        expect(onTick).toHaveBeenCalledTimes(1);
    });

    it('clears the interval on unmount', async () => {
        const onTick = vi.fn();
        const { unmount } = renderHook(() =>
            useAutoPullTimer({ workspaceId: 'ws-A', enabled: true, intervalMinutes: 5, onTick }));

        await tick(MINUTE_MS * 5);
        expect(onTick).toHaveBeenCalledTimes(1);

        unmount();
        await tick(MINUTE_MS * 20);
        expect(onTick).toHaveBeenCalledTimes(1);
    });

    // ── AC-3: a tick pulls; a second tick during an in-flight pull does not ──
    it('runs a pull on tick and does not start a second pull while one is in flight', async () => {
        let inFlight = false;
        const getWorkingTreeChanges = vi.fn(async () => ({ changes: [] }));
        const pull = vi.fn(async () => ({ jobId: 'job-1' }));
        const onTick = () => void runAutoPullTick({
            isPullInFlight: () => inFlight,
            getWorkingTreeChanges,
            pull,
            // The real poller would keep the flag set until the job completes;
            // runAutoPullTick already flipped it true via setInFlight before pull().
            onJobStarted: vi.fn(),
            onSyncSuccess: vi.fn(),
            onSkip: vi.fn(),
            setInFlight: (v: boolean) => { inFlight = v; },
        });

        renderHook(() => useAutoPullTimer({ workspaceId: 'ws-A', enabled: true, intervalMinutes: 1, onTick }));

        await tick(MINUTE_MS); // tick 1 — starts the pull
        expect(getWorkingTreeChanges).toHaveBeenCalledTimes(1);
        expect(pull).toHaveBeenCalledTimes(1);
        expect(inFlight).toBe(true);

        await tick(MINUTE_MS); // tick 2 — single-flight no-op
        expect(pull).toHaveBeenCalledTimes(1);
        expect(getWorkingTreeChanges).toHaveBeenCalledTimes(1); // dirty check skipped too
    });
});
