/**
 * unifiedChatChanges — the whole-chat "Changes" source behind the panel's `+`
 * menu entry and the tab it opens.
 *
 * A whisper group's diff is registered on demand, when the user clicks its
 * footer. The chat-wide Changes entry is different in two ways, and both are
 * why this module exists on top of `unifiedDiffSources`:
 *
 *  1. **The menu has to know before anything is opened.** The entry is listed
 *     only when the selected chat actually recorded a file change, so the
 *     context must already be published when the popover renders. `ChatDetail`
 *     pushes it here — the same `useSyncExternalStore` shape
 *     `unifiedCanvasEvents` uses to get chat-side data into the panel — and the
 *     menu reads it back. No chat published, or a chat with no edits, is one
 *     answer: `null`, which hides the entry.
 *
 *  2. **The id must survive the chat growing.** `whisperDiffSourceId` hashes the
 *     group's content, which is right for a frozen group and wrong here: a new
 *     edit would hash differently and open a *second* tab. The chat's Changes
 *     tab is filed under `chat-changes-<chatId>` instead, so later edits refresh
 *     the tab the user already has open.
 *
 *  3. **A restored tab has to know the difference between "not yet" and
 *     "nothing".** The registry therefore records *resolution*, not just
 *     content: a key that is absent means the chat's transcript has not loaded
 *     yet, and a key holding `null` means it loaded and recorded no file change.
 *     A Changes tab restored from localStorage after a reload shows loading for
 *     the first and the empty diff for the second, instead of claiming the diff
 *     expired. `withdrawUnifiedChatChanges` is the separate un-host path — a
 *     chat switch drops the key entirely, back to "unknown".
 *
 * The registry key is `(panel scope workspace, chat id)`; the *diff source* id
 * is the chat alone, because a chat id is globally unique — one chat is one
 * transcript and one set of changes however many panels host it.
 *
 * The key is `(panel scope workspace, chat id)`. The scope — not the clone the
 * edited files live in — is what isolates a chat's changes across repos, repo
 * groups, and remote clones: two panels showing different workspaces never read
 * each other's entry, and a background chat's publish cannot repoint the visible
 * menu because only the hosted chat publishes at all.
 */

import { useCallback, useSyncExternalStore } from 'react';
import type { WhisperDiffOpenContext } from '../../chat/conversation/tool-calls/WhisperCollapsedGroup';
import { getUnifiedDiffSource, registerUnifiedDiffSource } from './unifiedDiffSources';
import type { OpenUnifiedTabInput } from './unifiedPanelTabsModel';

/** What a chat publishes: the replayable context plus its display routing. */
export interface UnifiedChatChanges {
    /** Every completed edit of the chat, as the existing diff viewer's input. */
    ctx: WhisperDiffOpenContext;
    /** Root the paths are relative to, for the panel header. */
    workspaceRootPath?: string | null;
}

/**
 * Resolved chats. A missing key is an unresolved chat (no transcript loaded);
 * a `null` value is a chat that resolved with no file changes at all.
 */
const entries = new Map<string, UnifiedChatChanges | null>();
const listeners = new Map<string, Set<() => void>>();

function entryKey(scopeWorkspaceId: string, chatId: string): string {
    return `${scopeWorkspaceId}\n${chatId}`;
}

/** The stable resource id a chat's Changes tab is filed under. */
export function chatChangesSourceId(chatId: string): string {
    return `chat-changes-${chatId}`;
}

/**
 * Record a *resolved* chat's changes and wake whoever is showing them. `null`
 * means the transcript is loaded and holds no file change — which hides the
 * menu entry exactly as before, and additionally tells a restored Changes tab
 * to render the empty diff rather than sit on a spinner. Callers must not
 * publish while the transcript is still loading; that absence is what the tab
 * reads as "loading".
 *
 * Returns whether the registry moved, so a re-render that recomputes an equal
 * context does not notify — the popover's action list and the open tab both key
 * on this value.
 */
export function publishUnifiedChatChanges(
    scopeWorkspaceId: string,
    chatId: string,
    changes: UnifiedChatChanges | null,
): boolean {
    const key = entryKey(scopeWorkspaceId, chatId);
    const current = entries.get(key) ?? null;
    if (changes === null) {
        if (entries.has(key) && current === null) return false;
        entries.set(key, null);
    } else {
        if (current !== null && current.ctx === changes.ctx
            && (current.workspaceRootPath ?? null) === (changes.workspaceRootPath ?? null)) {
            return false;
        }
        entries.set(key, changes);
        refreshOpenChangesSource(chatId, changes);
    }
    listeners.get(key)?.forEach(listener => listener());
    return true;
}

/**
 * Forget a chat entirely — the panel stopped hosting it (a chat switch, the
 * panel closing, unmount), so nothing can speak for its transcript any more.
 * Back to unresolved rather than to "no changes": a Changes tab that is merely
 * off-screen must not be told the chat has nothing in it.
 */
export function withdrawUnifiedChatChanges(
    scopeWorkspaceId: string,
    chatId: string,
): boolean {
    const key = entryKey(scopeWorkspaceId, chatId);
    if (!entries.has(key)) return false;
    entries.delete(key);
    listeners.get(key)?.forEach(listener => listener());
    return true;
}

/**
 * Push a new publish into an already-open Changes tab.
 *
 * The menu registers the diff source when the entry is clicked. Without this,
 * that snapshot would be all the tab ever showed: later edits would update the
 * menu's entry while the open tab kept rendering the chat as it was when it was
 * opened. Only an *existing* source is refreshed — publishing must never mint a
 * source for a tab the user has not opened, or closed.
 *
 * A withdrawal (`null`) deliberately leaves the source alone: switching chats
 * un-hosts the publisher, and blanking the registry there would expire a tab
 * that is simply not on screen.
 *
 * After a reload the registry is empty and nothing is refreshed here at all;
 * the restored tab itself claims its source from the published entry
 * (`UnifiedDiffTab`), which keeps "a tab exists" the precondition for minting.
 */
function refreshOpenChangesSource(chatId: string, changes: UnifiedChatChanges): void {
    const sourceId = chatChangesSourceId(chatId);
    if (getUnifiedDiffSource(sourceId) === null) return;
    registerUnifiedDiffSource(changes.ctx, {
        workspaceRootPath: changes.workspaceRootPath,
        sourceId,
    });
}

/** The published changes for a chat, or null when it has none (or none yet). */
export function getUnifiedChatChanges(
    scopeWorkspaceId: string,
    chatId: string | null,
): UnifiedChatChanges | null {
    return getUnifiedChatChangesEntry(scopeWorkspaceId, chatId) ?? null;
}

/**
 * The raw registry entry, which distinguishes the two shapes of "no changes":
 * `undefined` — nothing has spoken for this chat yet (its transcript is still
 * loading, or no panel hosts it) — versus `null`, a loaded transcript with no
 * file change in it.
 */
export function getUnifiedChatChangesEntry(
    scopeWorkspaceId: string,
    chatId: string | null,
): UnifiedChatChanges | null | undefined {
    if (chatId === null) return undefined;
    return entries.get(entryKey(scopeWorkspaceId, chatId));
}

/** Drop every published entry (test isolation). */
export function clearUnifiedChatChanges(): void {
    const keys = [...entries.keys()];
    entries.clear();
    for (const key of keys) listeners.get(key)?.forEach(listener => listener());
}

/**
 * Subscribe a view to one chat's changes. Reactive because the entry arrives
 * after the menu may already be open: the first completed edit of a streaming
 * turn has to make the entry appear without the user reopening the popover.
 */
export function useUnifiedChatChanges(
    scopeWorkspaceId: string,
    chatId: string | null,
): UnifiedChatChanges | null {
    return useUnifiedChatChangesEntry(scopeWorkspaceId, chatId) ?? null;
}

/**
 * The reactive form of `getUnifiedChatChangesEntry` — for a view that has to
 * tell an unresolved chat from a resolved one with nothing in it. A restored
 * Changes tab is the caller: `undefined` is its loading state, `null` its empty
 * one.
 */
export function useUnifiedChatChangesEntry(
    scopeWorkspaceId: string,
    chatId: string | null,
): UnifiedChatChanges | null | undefined {
    const key = chatId === null ? null : entryKey(scopeWorkspaceId, chatId);
    return useSyncExternalStore(
        useCallback(listener => {
            if (key === null) return () => {};
            let set = listeners.get(key);
            if (!set) {
                set = new Set();
                listeners.set(key, set);
            }
            set.add(listener);
            return () => {
                set!.delete(listener);
                if (set!.size === 0) listeners.delete(key);
            };
        }, [key]),
        useCallback(() => (key === null ? undefined : entries.get(key)), [key]),
        () => undefined,
    );
}

/**
 * The descriptor the Changes entry opens: the chat's whole-chat context filed
 * under its stable per-chat source id, rendered by the same `UnifiedDiffTab`
 * a whisper group opens. Reopening after a close, or clicking the entry again,
 * therefore lands on the one tab rather than stacking duplicates.
 */
export function chatChangesTabInput(input: {
    changes: UnifiedChatChanges;
    /** The clone the edited files belong to — not the page origin. */
    ownerWorkspaceId: string;
    /** The chat the changes belong to; a Changes tab is always chat-owned. */
    chatId: string;
    repoLabel?: string;
}): OpenUnifiedTabInput {
    const resourceId = registerUnifiedDiffSource(input.changes.ctx, {
        workspaceRootPath: input.changes.workspaceRootPath,
        sourceId: chatChangesSourceId(input.chatId),
    });
    return {
        kind: 'diff',
        ownerWorkspaceId: input.ownerWorkspaceId,
        chatId: input.chatId,
        resourceId,
        label: 'Changes',
        ...(input.repoLabel === undefined ? {} : { repoLabel: input.repoLabel }),
    };
}
