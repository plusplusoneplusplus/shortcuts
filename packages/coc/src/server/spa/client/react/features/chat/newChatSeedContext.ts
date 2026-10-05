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

interface PendingSeed {
    destinationId: string;
    payload: SessionContextAttachmentDragPayload;
}

let pending: PendingSeed[] = [];
const listeners = new Set<SeedListener>();

/**
 * Queue one or more dropped context payloads for the new-chat composer and
 * notify any mounted composer so it can drain immediately (append-keep).
 * The destination is independent of the payload's server workspace id. Pass a
 * concrete remote clone key for remote owners; omitted destinations use each
 * payload's source workspace id for local callers.
 */
export function pushNewChatSeedContext(
    payloads: SessionContextAttachmentDragPayload[],
    destinationId?: string,
): void {
    if (payloads.length === 0) return;
    pending = [...pending, ...payloads.map(payload => ({
        destinationId: destinationId ?? payload.sourceWorkspaceId,
        payload,
    }))];
    for (const listener of Array.from(listeners)) {
        try {
            listener();
        } catch {
            // A listener throwing must not stop the others from being notified.
        }
    }
}

/** Drain one destination, preserving other owners; omitted id drains all. */
export function drainNewChatSeedContext(destinationId?: string): SessionContextAttachmentDragPayload[] {
    if (pending.length === 0) return [];
    const drained = destinationId === undefined
        ? pending
        : pending.filter(seed => seed.destinationId === destinationId);
    pending = destinationId === undefined
        ? []
        : pending.filter(seed => seed.destinationId !== destinationId);
    return drained.map(seed => seed.payload);
}

/** Non-destructive peek at the buffered payloads (used by tests). */
export function peekNewChatSeedContext(): SessionContextAttachmentDragPayload[] {
    return pending.map(seed => seed.payload);
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
