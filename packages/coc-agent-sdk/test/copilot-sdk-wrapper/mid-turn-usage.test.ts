/**
 * Tests for the mid-turn usage throttle.
 *
 * The contract that matters: several snapshots inside one interval collapse to
 * a single emission carrying the *latest* value, and disposing at turn end
 * leaves nothing pending — a stale mid-turn value must never land after the
 * authoritative turn-end one.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
    MID_TURN_TOKEN_USAGE_INTERVAL_MS,
    createMidTurnUsageThrottle,
    createMidTurnUsagePoller,
} from '../../src/mid-turn-usage';

describe('createMidTurnUsageThrottle', () => {
    beforeEach(() => { vi.useFakeTimers(); });
    afterEach(() => { vi.useRealTimers(); });

    it('collapses two reports inside one interval into one emission carrying the latest value', () => {
        const sink = vi.fn();
        const throttle = createMidTurnUsageThrottle(sink);

        throttle.report({ tokenLimit: 200000, currentTokens: 10000 });
        throttle.report({ tokenLimit: 200000, currentTokens: 42000 });

        // Trailing edge: nothing has been published yet.
        expect(sink).not.toHaveBeenCalled();

        vi.advanceTimersByTime(MID_TURN_TOKEN_USAGE_INTERVAL_MS);

        expect(sink).toHaveBeenCalledTimes(1);
        expect(sink).toHaveBeenCalledWith({ tokenLimit: 200000, currentTokens: 42000 });
    });

    it('emits again for a report that lands after the interval elapsed', () => {
        const sink = vi.fn();
        const throttle = createMidTurnUsageThrottle(sink);

        throttle.report({ currentTokens: 1 });
        vi.advanceTimersByTime(MID_TURN_TOKEN_USAGE_INTERVAL_MS);
        throttle.report({ currentTokens: 2 });
        vi.advanceTimersByTime(MID_TURN_TOKEN_USAGE_INTERVAL_MS);

        expect(sink.mock.calls.map(c => c[0])).toEqual([{ currentTokens: 1 }, { currentTokens: 2 }]);
    });

    it('drops a pending emission on dispose so nothing lands after turn end', () => {
        const sink = vi.fn();
        const throttle = createMidTurnUsageThrottle(sink);

        throttle.report({ currentTokens: 99 });
        throttle.dispose();
        vi.advanceTimersByTime(MID_TURN_TOKEN_USAGE_INTERVAL_MS * 10);

        expect(sink).not.toHaveBeenCalled();
    });

    it('ignores reports made after dispose', () => {
        const sink = vi.fn();
        const throttle = createMidTurnUsageThrottle(sink);

        throttle.dispose();
        throttle.report({ currentTokens: 5 });
        vi.advanceTimersByTime(MID_TURN_TOKEN_USAGE_INTERVAL_MS * 10);

        expect(sink).not.toHaveBeenCalled();
    });

    it('swallows a throwing consumer and routes it to onError', () => {
        const onError = vi.fn();
        const throttle = createMidTurnUsageThrottle(
            () => { throw new Error('consumer blew up'); },
            MID_TURN_TOKEN_USAGE_INTERVAL_MS,
            onError,
        );

        throttle.report({ currentTokens: 1 });
        expect(() => vi.advanceTimersByTime(MID_TURN_TOKEN_USAGE_INTERVAL_MS)).not.toThrow();
        expect(onError).toHaveBeenCalledTimes(1);
    });

    it('is a safe no-op when no callback is supplied', () => {
        const throttle = createMidTurnUsageThrottle(undefined);

        expect(() => {
            throttle.report({ currentTokens: 1 });
            vi.advanceTimersByTime(MID_TURN_TOKEN_USAGE_INTERVAL_MS);
            throttle.dispose();
        }).not.toThrow();
    });

    it('honours a caller-supplied interval', () => {
        const sink = vi.fn();
        const throttle = createMidTurnUsageThrottle(sink, 50);

        throttle.report({ currentTokens: 1 });
        vi.advanceTimersByTime(49);
        expect(sink).not.toHaveBeenCalled();
        vi.advanceTimersByTime(1);
        expect(sink).toHaveBeenCalledTimes(1);
    });
});

describe('createMidTurnUsagePoller', () => {
    beforeEach(() => { vi.useFakeTimers(); });
    afterEach(() => { vi.useRealTimers(); });

    it('polls on the interval and publishes each snapshot', async () => {
        const sink = vi.fn();
        let n = 0;
        const poller = createMidTurnUsagePoller({
            callback: sink,
            intervalMs: 50,
            read: async () => ({ currentTokens: ++n }),
        });

        expect(sink).not.toHaveBeenCalled(); // nothing before the first tick
        await vi.advanceTimersByTimeAsync(50);
        expect(sink).toHaveBeenCalledWith({ currentTokens: 1 });
        await vi.advanceTimersByTimeAsync(50);
        expect(sink).toHaveBeenCalledWith({ currentTokens: 2 });
        expect(sink).toHaveBeenCalledTimes(2);
        poller.dispose();
    });

    it('never reads when no callback is supplied', async () => {
        const read = vi.fn(async () => ({ currentTokens: 1 }));
        const poller = createMidTurnUsagePoller({ callback: undefined, intervalMs: 50, read });

        await vi.advanceTimersByTimeAsync(50 * 10);

        expect(read).not.toHaveBeenCalled();
        expect(() => poller.dispose()).not.toThrow();
    });

    it('swallows a failing read, routes it to onError, and keeps polling', async () => {
        const sink = vi.fn();
        const onError = vi.fn();
        let first = true;
        const poller = createMidTurnUsagePoller({
            callback: sink,
            intervalMs: 50,
            onError,
            read: async () => {
                if (first) { first = false; throw new Error('rollout unreadable'); }
                return { currentTokens: 7 };
            },
        });

        await vi.advanceTimersByTimeAsync(50);
        expect(onError).toHaveBeenCalledTimes(1);
        expect(sink).not.toHaveBeenCalled();

        await vi.advanceTimersByTimeAsync(50);
        expect(sink).toHaveBeenCalledWith({ currentTokens: 7 });
        poller.dispose();
    });

    it('skips a tick that yields no usage', async () => {
        const sink = vi.fn();
        const poller = createMidTurnUsagePoller({
            callback: sink,
            intervalMs: 50,
            read: async () => undefined,
        });

        await vi.advanceTimersByTimeAsync(50 * 3);

        expect(sink).not.toHaveBeenCalled();
        poller.dispose();
    });

    it('stops permanently once isActive returns false', async () => {
        const read = vi.fn(async () => ({ currentTokens: 1 }));
        let active = true;
        const poller = createMidTurnUsagePoller({
            callback: vi.fn(),
            intervalMs: 50,
            isActive: () => active,
            read,
        });

        await vi.advanceTimersByTimeAsync(50);
        expect(read).toHaveBeenCalledTimes(1);

        active = false;
        await vi.advanceTimersByTimeAsync(50 * 10);
        expect(read).toHaveBeenCalledTimes(1);
        poller.dispose();
    });

    it('does not publish a snapshot from a read still in flight at dispose', async () => {
        const sink = vi.fn();
        let release: (() => void) | undefined;
        const poller = createMidTurnUsagePoller({
            callback: sink,
            intervalMs: 50,
            read: async () => {
                await new Promise<void>(resolve => { release = resolve; });
                return { currentTokens: 123 };
            },
        });

        await vi.advanceTimersByTimeAsync(50);
        expect(release).toBeDefined();

        // Turn ends while the control request is still outstanding.
        poller.dispose();
        release?.();
        await vi.advanceTimersByTimeAsync(50 * 10);

        expect(sink).not.toHaveBeenCalled();
    });

    it('chains ticks so a slow read never runs two reads concurrently', async () => {
        let inFlight = 0;
        let maxInFlight = 0;
        const poller = createMidTurnUsagePoller({
            callback: vi.fn(),
            intervalMs: 10,
            read: async () => {
                maxInFlight = Math.max(maxInFlight, ++inFlight);
                await new Promise<void>(resolve => { setTimeout(resolve, 100); });
                inFlight--;
                return { currentTokens: 1 };
            },
        });

        await vi.advanceTimersByTimeAsync(1000);

        expect(maxInFlight).toBe(1);
        poller.dispose();
    });
});
