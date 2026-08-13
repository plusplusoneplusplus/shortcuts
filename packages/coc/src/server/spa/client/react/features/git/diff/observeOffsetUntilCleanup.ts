/**
 * A virtualizer offset observer that goes quiet the moment it is torn down.
 *
 * `observeElementOffset` from virtual-core debounces a trailing "scrolling has
 * stopped" callback on every scroll event — `isScrollingResetDelay`, 150ms by
 * default. Its cleanup only removes the scroll listeners; the pending timer is
 * left to fire. When it lands it calls back into the virtualizer, which
 * notifies React and schedules an update for a component that is already gone.
 *
 * In a browser that is just wasted work. Under jsdom it is fatal. Each test
 * file tears down its `window` when it finishes, so a timer scheduled by the
 * last scroll of one file fires while the *next* file is running, and React
 * dies reading event priority off a `window` that no longer exists. Vitest
 * reports that as an unhandled error against whichever file happened to be
 * running, and one unhandled error fails the entire run.
 *
 * Gating the callback fixes both: after cleanup the late timer still fires, but
 * it finds a closed gate and returns without touching React or `window`.
 */

import { observeElementOffset, type Virtualizer } from '@tanstack/react-virtual';

/**
 * Drop-in replacement for the virtualizer's `observeElementOffset` option that
 * stops forwarding offsets once its cleanup has run.
 */
export function observeOffsetUntilCleanup<
    TScrollElement extends Element,
    TItemElement extends Element,
>(
    instance: Virtualizer<TScrollElement, TItemElement>,
    cb: (offset: number, isScrolling: boolean) => void,
): () => void {
    let live = true;
    const stopObserving = observeElementOffset(instance, (offset, isScrolling) => {
        if (!live) return;
        cb(offset, isScrolling);
    });
    return () => {
        live = false;
        stopObserving?.();
    };
}
