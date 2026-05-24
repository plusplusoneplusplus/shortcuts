/**
 * Tests for SessionTimerManager
 *
 * Verifies timer start/reset/cleanup and callback firing using fake timers.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { SessionTimerManager } from '../../src/session-timer-manager';

describe('SessionTimerManager', () => {
    beforeEach(() => { vi.useFakeTimers(); });
    afterEach(() => { vi.useRealTimers(); });

    function makeCallbacks() {
        return {
            onTimeout: vi.fn(),
            onIdleTimeout: vi.fn(),
            onTurnEndGrace: vi.fn(),
        };
    }

    // ── Overall timeout ──────────────────────────────────────────────────

    it('fires onTimeout after timeoutMs', () => {
        const cb = makeCallbacks();
        const tm = new SessionTimerManager({ timeoutMs: 1000 }, cb);
        tm.start();

        vi.advanceTimersByTime(999);
        expect(cb.onTimeout).not.toHaveBeenCalled();

        vi.advanceTimersByTime(2);
        expect(cb.onTimeout).toHaveBeenCalledTimes(1);
    });

    it('cleanup prevents onTimeout from firing', () => {
        const cb = makeCallbacks();
        const tm = new SessionTimerManager({ timeoutMs: 1000 }, cb);
        tm.start();

        vi.advanceTimersByTime(500);
        tm.cleanup();
        vi.advanceTimersByTime(600);

        expect(cb.onTimeout).not.toHaveBeenCalled();
    });

    // ── Idle timeout ─────────────────────────────────────────────────────

    it('fires onIdleTimeout after idleTimeoutMs with no activity', () => {
        const cb = makeCallbacks();
        const tm = new SessionTimerManager({ timeoutMs: 60000, idleTimeoutMs: 500 }, cb);
        tm.start();

        vi.advanceTimersByTime(501);
        expect(cb.onIdleTimeout).toHaveBeenCalledTimes(1);
    });

    it('does not fire idle timeout when idleTimeoutMs is 0', () => {
        const cb = makeCallbacks();
        const tm = new SessionTimerManager({ timeoutMs: 60000, idleTimeoutMs: 0 }, cb);
        tm.start();

        vi.advanceTimersByTime(100000);
        expect(cb.onIdleTimeout).not.toHaveBeenCalled();
    });

    it('does not fire idle timeout when not configured', () => {
        const cb = makeCallbacks();
        const tm = new SessionTimerManager({ timeoutMs: 60000 }, cb);
        tm.start();

        vi.advanceTimersByTime(100000);
        expect(cb.onIdleTimeout).not.toHaveBeenCalled();
    });

    it('resets idle timer on resetIdleTimer()', () => {
        const cb = makeCallbacks();
        const tm = new SessionTimerManager({ timeoutMs: 60000, idleTimeoutMs: 500 }, cb);
        tm.start();

        vi.advanceTimersByTime(400);
        tm.resetIdleTimer();
        vi.advanceTimersByTime(400);

        // Should not have fired — reset pushed the deadline forward
        expect(cb.onIdleTimeout).not.toHaveBeenCalled();

        vi.advanceTimersByTime(200);
        expect(cb.onIdleTimeout).toHaveBeenCalledTimes(1);
    });

    // ── Turn-end grace timer ─────────────────────────────────────────────

    it('fires onTurnEndGrace after default 2s', () => {
        const cb = makeCallbacks();
        const tm = new SessionTimerManager({ timeoutMs: 60000 }, cb);
        tm.start();

        tm.startTurnEndGrace();
        expect(tm.hasTurnEndGraceTimer).toBe(true);

        vi.advanceTimersByTime(2001);
        expect(cb.onTurnEndGrace).toHaveBeenCalledTimes(1);
        expect(tm.hasTurnEndGraceTimer).toBe(false);
    });

    it('fires onTurnEndGrace after custom grace period', () => {
        const cb = makeCallbacks();
        const tm = new SessionTimerManager({ timeoutMs: 60000, turnEndGraceMs: 500 }, cb);
        tm.start();

        tm.startTurnEndGrace();
        vi.advanceTimersByTime(501);
        expect(cb.onTurnEndGrace).toHaveBeenCalledTimes(1);
    });

    it('cancelTurnEndGrace prevents onTurnEndGrace from firing', () => {
        const cb = makeCallbacks();
        const tm = new SessionTimerManager({ timeoutMs: 60000 }, cb);
        tm.start();

        tm.startTurnEndGrace();
        expect(tm.hasTurnEndGraceTimer).toBe(true);

        tm.cancelTurnEndGrace();
        expect(tm.hasTurnEndGraceTimer).toBe(false);

        vi.advanceTimersByTime(3000);
        expect(cb.onTurnEndGrace).not.toHaveBeenCalled();
    });

    it('startTurnEndGrace is a no-op if already active', () => {
        const cb = makeCallbacks();
        const tm = new SessionTimerManager({ timeoutMs: 60000 }, cb);
        tm.start();

        tm.startTurnEndGrace();
        vi.advanceTimersByTime(1000);
        tm.startTurnEndGrace(); // should not reset

        vi.advanceTimersByTime(1001);
        expect(cb.onTurnEndGrace).toHaveBeenCalledTimes(1);
    });

    it('cleanup clears all timers including turn-end grace', () => {
        const cb = makeCallbacks();
        const tm = new SessionTimerManager({ timeoutMs: 1000, idleTimeoutMs: 500 }, cb);
        tm.start();
        tm.startTurnEndGrace();

        tm.cleanup();

        vi.advanceTimersByTime(10000);
        expect(cb.onTimeout).not.toHaveBeenCalled();
        expect(cb.onIdleTimeout).not.toHaveBeenCalled();
        expect(cb.onTurnEndGrace).not.toHaveBeenCalled();
        expect(tm.hasTurnEndGraceTimer).toBe(false);
    });
});
