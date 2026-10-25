import { observeElementOffset, type Virtualizer } from '@tanstack/react-virtual';

export function observeOffsetUntilCleanup<
    TScrollElement extends Element,
    TItemElement extends Element,
>(
    instance: Virtualizer<TScrollElement, TItemElement>,
    callback: (offset: number, isScrolling: boolean) => void,
): () => void {
    let live = true;
    const stop = observeElementOffset(instance, (offset, isScrolling) => {
        if (live) callback(offset, isScrolling);
    });

    return () => {
        // The native observer removes listeners but leaves its trailing timer active.
        live = false;
        stop?.();
    };
}
