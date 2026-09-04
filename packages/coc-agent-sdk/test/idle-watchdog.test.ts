/**
 * IdleWatchdog — the shared idle/wall-clock timer used by every provider.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { IdleWatchdog, idleTimeoutErrorMessage } from '../src/idle-watchdog';

describe('IdleWatchdog', () => {
    beforeEach(() => { vi.useFakeTimers(); });
    afterEach(() => { vi.useRealTimers(); });

    it('fires onIdle after the window with no activity', () => {
        const onIdle = vi.fn();
        const w = new IdleWatchdog({ idleTimeoutMs: 500, onIdle });
        w.start();

        vi.advanceTimersByTime(499);
        expect(onIdle).not.toHaveBeenCalled();

        vi.advanceTimersByTime(2);
        expect(onIdle).toHaveBeenCalledTimes(1);
        expect(onIdle).toHaveBeenCalledWith(500);
    });

    it('reset() defers the fire by a full window', () => {
        const onIdle = vi.fn();
        const w = new IdleWatchdog({ idleTimeoutMs: 500, onIdle });
        w.start();

        vi.advanceTimersByTime(400);
        w.reset();
        vi.advanceTimersByTime(400);
        expect(onIdle).not.toHaveBeenCalled();

        vi.advanceTimersByTime(200);
        expect(onIdle).toHaveBeenCalledTimes(1);
    });

    it('suppression reschedules instead of firing, and fires once released', () => {
        let blocked = true;
        const onIdle = vi.fn();
        const onSuppressed = vi.fn();
        const w = new IdleWatchdog({
            idleTimeoutMs: 500,
            isSuppressed: () => blocked,
            onSuppressed,
            onIdle,
        });
        w.start();

        vi.advanceTimersByTime(5000);
        expect(onIdle).not.toHaveBeenCalled();
        expect(onSuppressed).toHaveBeenCalled();

        blocked = false;
        // The window restarts at each suppressed fire, so a full window from
        // release is still needed.
        vi.advanceTimersByTime(501);
        expect(onIdle).toHaveBeenCalledTimes(1);
    });

    it('idleTimeoutMs of 0 or undefined disables the idle timer', () => {
        const zero = vi.fn();
        new IdleWatchdog({ idleTimeoutMs: 0, onIdle: zero }).start();
        const missing = vi.fn();
        const w = new IdleWatchdog({ onIdle: missing });
        w.start();

        vi.advanceTimersByTime(1_000_000);
        expect(zero).not.toHaveBeenCalled();
        expect(missing).not.toHaveBeenCalled();
        expect(w.idleEnabled).toBe(false);
    });

    it('fires onTimeout after the wall-clock cap', () => {
        const onTimeout = vi.fn();
        const w = new IdleWatchdog({ timeoutMs: 1000, onTimeout, onIdle: vi.fn() });
        w.start();

        vi.advanceTimersByTime(1001);
        expect(onTimeout).toHaveBeenCalledWith(1000);
    });

    it('wall-clock cap still fires while idle is suppressed', () => {
        const onTimeout = vi.fn();
        const onIdle = vi.fn();
        const w = new IdleWatchdog({
            idleTimeoutMs: 200,
            timeoutMs: 1000,
            isSuppressed: () => true,
            onIdle,
            onTimeout,
        });
        w.start();

        vi.advanceTimersByTime(1001);
        expect(onIdle).not.toHaveBeenCalled();
        expect(onTimeout).toHaveBeenCalledTimes(1);
    });

    it('does not arm the wall-clock cap without onTimeout or a positive window', () => {
        const onTimeout = vi.fn();
        new IdleWatchdog({ timeoutMs: 0, onTimeout, onIdle: vi.fn() }).start();
        new IdleWatchdog({ onIdle: vi.fn() }).start();

        vi.advanceTimersByTime(1_000_000);
        expect(onTimeout).not.toHaveBeenCalled();
    });

    it('dispose clears every timer and makes reset a no-op', () => {
        const onIdle = vi.fn();
        const onTimeout = vi.fn();
        const w = new IdleWatchdog({ idleTimeoutMs: 200, timeoutMs: 500, onIdle, onTimeout });
        w.start();

        w.dispose();
        w.reset();
        vi.advanceTimersByTime(10_000);

        expect(onIdle).not.toHaveBeenCalled();
        expect(onTimeout).not.toHaveBeenCalled();
    });

    it('exposes the shared error text', () => {
        expect(idleTimeoutErrorMessage(500)).toBe('Request idle-timed out after 500ms with no activity');
    });
});
