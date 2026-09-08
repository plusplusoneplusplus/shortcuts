/**
 * unifiedChatCanvasActions — the seam a canvas tab uses to talk to the chat
 * that owns it.
 *
 * A canvas in the shared right panel keeps two chat-directed actions: "Ask AI"
 * puts a selection-targeted prompt into the composer, and "Send comments"
 * submits through the chat's normal follow-up path. The tab is nowhere near the
 * conversation in the tree — it can be showing a chat that is scrolled past, in
 * another column, or in a panel scoped to a repo group — so the chat publishes
 * its handlers here and the tab looks them up.
 *
 * The key is the chat id alone, which is globally unique: one conversation is
 * one composer however many panels or workspaces host it. That is also what
 * keeps the actions correct under a chat switch — the tab's descriptor carries
 * the ORIGINATING chat id, so an action fired from a canvas belonging to chat A
 * reaches A's composer even while chat B is selected, and a pending send never
 * follows the user's new selection.
 *
 * A chat with no published entry is genuinely unavailable (its transcript is
 * not mounted anywhere), so the tab hides those actions rather than pretending
 * they worked. This mirrors `unifiedChatChanges`: chat-side data reaching the
 * panel through a small `useSyncExternalStore` registry rather than a context
 * that would have to span two subtrees.
 */

import { useCallback, useSyncExternalStore } from 'react';

/** What a mounted chat offers a canvas tab that belongs to it. */
export interface UnifiedChatCanvasActions {
    /** Prefill this chat's composer with a prompt and focus it. Never sends. */
    askAi: (prompt: string) => void;
    /** Send a message through this chat's normal follow-up path. */
    sendToAi: (message: string) => Promise<void>;
}

const entries = new Map<string, UnifiedChatCanvasActions>();
const listeners = new Map<string, Set<() => void>>();

function notify(chatId: string): void {
    listeners.get(chatId)?.forEach(listener => listener());
}

/**
 * Publish a chat's canvas actions. The caller must pass a STABLE object (one
 * that reads its latest closures through refs); re-publishing an equal
 * reference is a no-op, so a re-render cannot churn the tabs reading it.
 * Returns whether the registry moved.
 */
export function publishUnifiedChatCanvasActions(
    chatId: string,
    actions: UnifiedChatCanvasActions,
): boolean {
    if (!chatId) return false;
    if (entries.get(chatId) === actions) return false;
    entries.set(chatId, actions);
    notify(chatId);
    return true;
}

/**
 * Drop a chat's actions — it unmounted, so nothing can speak for its composer.
 * Only withdraws the entry the caller published: a chat mounted twice (a
 * pop-out window plus the main view) must not have the survivor unregistered by
 * the one that went away.
 */
export function withdrawUnifiedChatCanvasActions(
    chatId: string,
    actions?: UnifiedChatCanvasActions,
): boolean {
    if (!entries.has(chatId)) return false;
    if (actions !== undefined && entries.get(chatId) !== actions) return false;
    entries.delete(chatId);
    notify(chatId);
    return true;
}

/** The published actions for a chat, or null when none is mounted. */
export function getUnifiedChatCanvasActions(chatId: string | null): UnifiedChatCanvasActions | null {
    if (!chatId) return null;
    return entries.get(chatId) ?? null;
}

/** Drop every published entry (test isolation). */
export function clearUnifiedChatCanvasActions(): void {
    const keys = [...entries.keys()];
    entries.clear();
    for (const key of keys) notify(key);
}

/**
 * Subscribe a canvas tab to its chat's actions. Reactive because a tab can be
 * restored before its chat mounts: the actions have to appear without the user
 * reopening the tab.
 */
export function useUnifiedChatCanvasActions(chatId: string | null): UnifiedChatCanvasActions | null {
    return useSyncExternalStore(
        useCallback(listener => {
            if (!chatId) return () => {};
            let set = listeners.get(chatId);
            if (!set) {
                set = new Set();
                listeners.set(chatId, set);
            }
            set.add(listener);
            return () => {
                set!.delete(listener);
                if (set!.size === 0) listeners.delete(chatId);
            };
        }, [chatId]),
        useCallback(() => (chatId ? entries.get(chatId) ?? null : null), [chatId]),
        () => null,
    );
}
