/**
 * WarmStatusBroadcaster — fan-out of WarmClientRegistry state changes (AC-01b).
 *
 * Two layers of coverage:
 *   1. The broadcaster in isolation: multi-subscriber fan-out, unsubscribe,
 *      subscriber-error isolation, mid-dispatch unsubscribe safety, clear().
 *   2. The broadcaster wired to a real WarmClientRegistry exactly as the SDK
 *      services wire it (`onStateChange: broadcaster.emit`), proving that driving
 *      the registry's public lifecycle (prewarm → evict) delivers the
 *      cold→warming→warm→cold transitions to subscribers.
 */

import { describe, it, expect, vi } from 'vitest';
import { WarmStatusBroadcaster } from '../../src/warm-status-broadcaster';
import {
    WarmClientRegistry,
    WarmClientHandle,
    WarmStatus,
} from '../../src/warm-client-registry';

const KEY = 'copilot /work';

function record(): { calls: Array<[string, WarmStatus]>; listener: (k: string, s: WarmStatus) => void } {
    const calls: Array<[string, WarmStatus]> = [];
    return { calls, listener: (k, s) => calls.push([k, s]) };
}

describe('WarmStatusBroadcaster — fan-out and lifecycle', () => {
    it('delivers each transition to every current subscriber', () => {
        const b = new WarmStatusBroadcaster();
        const a = record();
        const c = record();
        b.subscribe(a.listener);
        b.subscribe(c.listener);

        b.emit(KEY, 'warming');
        b.emit(KEY, 'warm');

        expect(a.calls).toEqual([[KEY, 'warming'], [KEY, 'warm']]);
        expect(c.calls).toEqual([[KEY, 'warming'], [KEY, 'warm']]);
        expect(b.size).toBe(2);
    });

    it('unsubscribe stops further deliveries and is idempotent', () => {
        const b = new WarmStatusBroadcaster();
        const a = record();
        const unsub = b.subscribe(a.listener);

        b.emit(KEY, 'active');
        unsub();
        unsub(); // second call must be harmless
        b.emit(KEY, 'cold');

        expect(a.calls).toEqual([[KEY, 'active']]);
        expect(b.size).toBe(0);
    });

    it('isolates a throwing subscriber so siblings still receive the event', () => {
        const b = new WarmStatusBroadcaster();
        const boom = vi.fn(() => { throw new Error('subscriber blew up'); });
        const ok = record();
        b.subscribe(boom);
        b.subscribe(ok.listener);

        expect(() => b.emit(KEY, 'warm')).not.toThrow();
        expect(boom).toHaveBeenCalledTimes(1);
        expect(ok.calls).toEqual([[KEY, 'warm']]);
    });

    it('a subscriber that unsubscribes itself mid-dispatch does not corrupt iteration', () => {
        const b = new WarmStatusBroadcaster();
        const seen = record();
        const unsubSelf = b.subscribe(() => unsubSelf());
        b.subscribe(seen.listener);

        // Snapshotting the set means the second subscriber still fires this round.
        expect(() => b.emit(KEY, 'warm')).not.toThrow();
        expect(seen.calls).toEqual([[KEY, 'warm']]);
        expect(b.size).toBe(1);
    });

    it('clear() detaches every subscriber', () => {
        const b = new WarmStatusBroadcaster();
        const a = record();
        b.subscribe(a.listener);
        b.clear();
        b.emit(KEY, 'warm');

        expect(a.calls).toEqual([]);
        expect(b.size).toBe(0);
    });
});

describe('WarmStatusBroadcaster — wired to a real WarmClientRegistry', () => {
    function makeHandle(): WarmClientHandle {
        return { client: {}, stop: vi.fn(async () => undefined) };
    }

    it('relays cold→warming→warm→cold across a prewarm + evict lifecycle', async () => {
        const b = new WarmStatusBroadcaster();
        const reg = new WarmClientRegistry({ ttlMs: 60_000, onStateChange: b.emit });
        const a = record();
        b.subscribe(a.listener);

        await reg.prewarm(KEY, async () => makeHandle()); // absent→warming→warm
        await reg.evict(KEY); // warm→cold

        expect(a.calls).toEqual([
            [KEY, 'warming'],
            [KEY, 'warm'],
            [KEY, 'cold'],
        ]);
    });

    it('fans a single registry transition out to multiple subscribers', async () => {
        const b = new WarmStatusBroadcaster();
        const reg = new WarmClientRegistry({ ttlMs: 60_000, onStateChange: b.emit });
        const a = record();
        const c = record();
        b.subscribe(a.listener);
        b.subscribe(c.listener);

        await reg.prewarm(KEY, async () => makeHandle());

        expect(a.calls).toEqual([[KEY, 'warming'], [KEY, 'warm']]);
        expect(c.calls).toEqual([[KEY, 'warming'], [KEY, 'warm']]);
    });

    it('an unsubscribed listener receives no further registry transitions', async () => {
        const b = new WarmStatusBroadcaster();
        const reg = new WarmClientRegistry({ ttlMs: 60_000, onStateChange: b.emit });
        const a = record();
        const unsub = b.subscribe(a.listener);

        await reg.prewarm(KEY, async () => makeHandle()); // warming, warm
        unsub();
        await reg.evict(KEY); // cold — not delivered

        expect(a.calls).toEqual([[KEY, 'warming'], [KEY, 'warm']]);
    });
});
