/**
 * newChatSeedContext — a tiny module-level pub/sub buffer that carries
 * session-context drag payloads from the desktop "+ New chat" drop target
 * (ChatListPane) to the new-chat composer (InitialChatComposer).
 *
 * The button and the composer live in sibling subtrees (the button is in the
 * list pane, the composer is rendered by ChatDetailPane once the task is
 * deselected), so there is no shared React state to thread the dropped items
 * through. Instead the drop handler pushes payloads here and calls the normal
 * `onNewChat` flow; when the composer mounts (or is already mounted) it drains
 * the buffer and merges the items into its attached-context via the existing
 * `useAttachedContext` path.
 *
 * Buffering (rather than a fire-once event) matters because the composer is
 * usually NOT mounted at the moment of the drop — it mounts a tick later once
 * `onNewChat` deselects the current task. The pushed items wait in the buffer
 * until the composer's mount effect drains them. When the composer is already
 * open, the subscription fires synchronously so the drop appends (append-keep).
 */

import type { SessionContextAttachmentDragPayload } from './sessionContextDrag';

type SeedListener = () => void;

let pending: SessionContextAttachmentDragPayload[] = [];
const listeners = new Set<SeedListener>();

/**
 * Queue one or more dropped context payloads for the new-chat composer and
 * notify any mounted composer so it can drain immediately (append-keep).
 */
export function pushNewChatSeedContext(payloads: SessionContextAttachmentDragPayload[]): void {
    if (payloads.length === 0) return;
    pending = [...pending, ...payloads];
    for (const listener of Array.from(listeners)) {
        try {
            listener();
        } catch {
            // A listener throwing must not stop the others from being notified.
        }
    }
}

/** Return and clear all buffered payloads. Returns an empty array when empty. */
export function drainNewChatSeedContext(): SessionContextAttachmentDragPayload[] {
    if (pending.length === 0) return [];
    const drained = pending;
    pending = [];
    return drained;
}

/** Non-destructive peek at the buffered payloads (used by tests). */
export function peekNewChatSeedContext(): SessionContextAttachmentDragPayload[] {
    return pending;
}

/** Subscribe to buffer pushes. Returns an unsubscribe function. */
export function subscribeNewChatSeedContext(listener: SeedListener): () => void {
    listeners.add(listener);
    return () => {
        listeners.delete(listener);
    };
}

/** Test helper — clear the buffer and all subscribers. */
export function resetNewChatSeedContext(): void {
    pending = [];
    listeners.clear();
}
