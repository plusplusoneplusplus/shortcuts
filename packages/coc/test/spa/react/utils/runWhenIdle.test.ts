/**
 * Tests for runWhenIdle — the post-paint / idle deferral helper used to push
 * non-critical per-conversation fetches off the message-render critical path
 * (chat-load-perf AC-03).
 */
// @vitest-environment jsdom

import { describe, it, expect, vi, afterEach } from 'vitest';
import { runWhenIdle } from '../../../../src/server/spa/client/react/utils/runWhenIdle';

describe('runWhenIdle', () => {
    afterEach(() => {
        vi.useRealTimers();
        // Remove any requestIdleCallback stub a test installed.
        delete (window as unknown as Record<string, unknown>).requestIdleCallback;
        delete (window as unknown as Record<string, unknown>).cancelIdleCallback;
    });

    describe('setTimeout fallback (no requestIdleCallback — jsdom default)', () => {
        it('runs the callback on a macrotask, not synchronously', () => {
            vi.useFakeTimers();
            const cb = vi.fn();
            runWhenIdle(cb);
            // Deferred: nothing runs in the current tick.
            expect(cb).not.toHaveBeenCalled();
            vi.advanceTimersByTime(0);
            expect(cb).toHaveBeenCalledTimes(1);
        });

        it('disposer cancels the pending callback before it runs', () => {
            vi.useFakeTimers();
            const cb = vi.fn();
            const cancel = runWhenIdle(cb);
            cancel();
            vi.advanceTimersByTime(0);
            expect(cb).not.toHaveBeenCalled();
        });
    });

    describe('requestIdleCallback path (when available)', () => {
        it('uses requestIdleCallback with a timeout bound and runs the callback', () => {
            const ric = vi.fn((fn: IdleRequestCallback) => {
                fn({ didTimeout: false, timeRemaining: () => 0 } as IdleDeadline);
                return 7;
            });
            (window as unknown as Record<string, unknown>).requestIdleCallback = ric;

            const cb = vi.fn();
            runWhenIdle(cb, 123);

            expect(ric).toHaveBeenCalledTimes(1);
            expect(ric.mock.calls[0][1]).toEqual({ timeout: 123 });
            expect(cb).toHaveBeenCalledTimes(1);
        });

        it('disposer calls cancelIdleCallback with the handle', () => {
            const ric = vi.fn(() => 42);
            const cic = vi.fn();
            (window as unknown as Record<string, unknown>).requestIdleCallback = ric;
            (window as unknown as Record<string, unknown>).cancelIdleCallback = cic;

            const cancel = runWhenIdle(vi.fn());
            cancel();

            expect(cic).toHaveBeenCalledWith(42);
        });
    });
});
