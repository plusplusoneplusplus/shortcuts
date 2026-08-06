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
