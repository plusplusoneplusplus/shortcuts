/**
 * activeChatAttach — a tiny module-level pub/sub channel that routes a
 * selection attached from a Monaco editor ("Attach as context" pill) to the
 * chat composer open in the same repo view.
 *
 * The editors (explorer preview, right-panel file tabs, diff viewer) and the
 * chat composer live in unrelated subtrees, so there is no shared React state
 * to thread the payload through. A mounted follow-up composer subscribes for
 * its workspace; the pill calls `attachSelectionToChat`, which hands the
 * payload to the most relevant subscriber for that workspace. When no chat is
 * open for the workspace the payload falls back to the new-chat composer via
 * `pushNewChatSeedContext`.
 *
 * Subscriptions are keyed by workspace id so a selection never leaks into a
 * chat bound to another workspace or remote clone.
 */

import type { SessionContextAttachmentDragPayload } from './sessionContextDrag';
import { pushNewChatSeedContext } from './newChatSeedContext';

/**
 * Handle an attached payload. Return `false` to decline (e.g. the composer is
 * no longer visible) so the next subscriber or the new-chat fallback gets it.
 */
export type ActiveChatAttachHandler = (payload: SessionContextAttachmentDragPayload) => boolean | void;

interface Subscriber {
    workspaceId: string;
    handler: ActiveChatAttachHandler;
}

// Ordered oldest → newest; the newest (or most recently bumped) wins.
let subscribers: Subscriber[] = [];

/**
 * Subscribe a chat composer for `workspaceId`. Returns an object with an
 * unsubscribe function and a `bump` function that marks this composer as the
 * most recent target (call it when the composer gains focus).
 */
export function subscribeActiveChatAttach(
    workspaceId: string,
    handler: ActiveChatAttachHandler,
): { unsubscribe: () => void; bump: () => void } {
    const entry: Subscriber = { workspaceId, handler };
    subscribers = [...subscribers, entry];
    return {
        unsubscribe: () => {
            subscribers = subscribers.filter(s => s !== entry);
        },
        bump: () => {
            if (!subscribers.includes(entry)) return;
            subscribers = [...subscribers.filter(s => s !== entry), entry];
        },
    };
}

/** Where an attached payload ended up. */
export type ActiveChatAttachTarget = 'active-chat' | 'new-chat';

/**
 * Route `payload` to the chat composer for `workspaceId`. Falls back to the
 * new-chat composer seed buffer when no subscriber accepts it.
 */
export function attachSelectionToChat(
    workspaceId: string,
    payload: SessionContextAttachmentDragPayload,
): ActiveChatAttachTarget {
    const candidates = subscribers.filter(s => s.workspaceId === workspaceId).reverse();
    for (const candidate of candidates) {
        let accepted: boolean | void = false;
        try {
            accepted = candidate.handler(payload);
        } catch {
            accepted = false;
        }
        if (accepted !== false) return 'active-chat';
    }
    pushNewChatSeedContext([payload]);
    return 'new-chat';
}

/** True when a chat composer for `workspaceId` is subscribed (used by tests). */
export function hasActiveChatAttachSubscriber(workspaceId: string): boolean {
    return subscribers.some(s => s.workspaceId === workspaceId);
}

/** Test helper — clear all subscribers. */
export function resetActiveChatAttach(): void {
    subscribers = [];
}
