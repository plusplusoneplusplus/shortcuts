/**
 * WarmStatusBroadcaster — fan-out for {@link WarmClientRegistry} state changes.
 *
 * A {@link WarmClientRegistry} accepts only a single `onStateChange` listener,
 * but an SDK service needs to publish those transitions to several independent
 * observers (e.g. one bridge per SSE-connected conversation in CoC). This tiny
 * helper bridges the gap: the service wires the registry's single
 * `onStateChange` to {@link emit}, and any number of consumers attach via
 * {@link subscribe}. Each transition `(key, status)` is delivered to every
 * current subscriber.
 *
 * Subscriber isolation: a throwing subscriber is swallowed so it can neither
 * break the registry mutation that triggered the notification nor starve its
 * sibling subscribers.
 */

import type { WarmStateChangeListener, WarmStatus } from './warm-client-registry';

export class WarmStatusBroadcaster {
    private readonly listeners = new Set<WarmStateChangeListener>();

    /**
     * Registry-facing handler: pass this as `WarmClientRegistryOptions.onStateChange`.
     * It is an arrow property so it stays bound to this broadcaster when handed
     * off as a bare function reference. Fans the transition out to every current
     * subscriber, isolating each from the others' failures.
     */
    readonly emit: WarmStateChangeListener = (key: string, status: WarmStatus): void => {
        // Snapshot so a subscriber that unsubscribes itself mid-dispatch cannot
        // mutate the set we are iterating.
        for (const listener of [...this.listeners]) {
            try {
                listener(key, status);
            } catch {
                /* a misbehaving subscriber must never break the registry or its siblings */
            }
        }
    };

    /**
     * Attach a listener for warm-status transitions. Returns an idempotent
     * unsubscribe function; calling it more than once is harmless.
     */
    subscribe(listener: WarmStateChangeListener): () => void {
        this.listeners.add(listener);
        return () => {
            this.listeners.delete(listener);
        };
    }

    /** Number of currently attached subscribers (diagnostics / tests). */
    get size(): number {
        return this.listeners.size;
    }

    /** Detach every subscriber. Used on service dispose. */
    clear(): void {
        this.listeners.clear();
    }
}
