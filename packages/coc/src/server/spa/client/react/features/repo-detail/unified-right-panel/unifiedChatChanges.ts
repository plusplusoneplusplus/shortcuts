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
 * The key is `(panel scope workspace, chat id)`. The scope — not the clone the
 * edited files live in — is what isolates a chat's changes across repos, repo
 * groups, and remote clones: two panels showing different workspaces never read
 * each other's entry, and a background chat's publish cannot repoint the visible
 * menu because only the hosted chat publishes at all.
 */

import { useCallback, useSyncExternalStore } from 'react';
import type { WhisperDiffOpenContext } from '../../chat/conversation/tool-calls/WhisperCollapsedGroup';
import { registerUnifiedDiffSource } from './unifiedDiffSources';
import type { OpenUnifiedTabInput } from './unifiedPanelTabsModel';

/** What a chat publishes: the replayable context plus its display routing. */
export interface UnifiedChatChanges {
    /** Every completed edit of the chat, as the existing diff viewer's input. */
    ctx: WhisperDiffOpenContext;
    /** Root the paths are relative to, for the panel header. */
    workspaceRootPath?: string | null;
}

const entries = new Map<string, UnifiedChatChanges>();
const listeners = new Map<string, Set<() => void>>();

function entryKey(scopeWorkspaceId: string, chatId: string): string {
    return `${scopeWorkspaceId}\n${chatId}`;
}

/** The stable resource id a chat's Changes tab is filed under. */
export function chatChangesSourceId(chatId: string): string {
    return `chat-changes-${chatId}`;
}

/**
 * Record (or clear, with `null`) a chat's changes and wake whoever is showing
 * them. Returns whether the registry moved, so a re-render that recomputes an
 * equal context does not notify — the popover's action list and the open tab
 * both key on this value.
 */
export function publishUnifiedChatChanges(
    scopeWorkspaceId: string,
    chatId: string,
    changes: UnifiedChatChanges | null,
): boolean {
    const key = entryKey(scopeWorkspaceId, chatId);
    const current = entries.get(key) ?? null;
    if (changes === null) {
        if (current === null) return false;
        entries.delete(key);
    } else {
        if (current !== null && current.ctx === changes.ctx
            && (current.workspaceRootPath ?? null) === (changes.workspaceRootPath ?? null)) {
            return false;
        }
        entries.set(key, changes);
    }
    listeners.get(key)?.forEach(listener => listener());
    return true;
}

/** The published changes for a chat, or null when it has none. */
export function getUnifiedChatChanges(
    scopeWorkspaceId: string,
    chatId: string | null,
): UnifiedChatChanges | null {
    if (chatId === null) return null;
    return entries.get(entryKey(scopeWorkspaceId, chatId)) ?? null;
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
        useCallback(() => (key === null ? null : entries.get(key) ?? null), [key]),
        () => null,
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
