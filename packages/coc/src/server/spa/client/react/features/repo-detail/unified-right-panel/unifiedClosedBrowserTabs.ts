/**
 * Ctrl/Cmd+Shift+T: the session-only stack of user-closed `browser` tabs.
 *
 * One bounded stack per exact panel scope (owner-qualified panel storage key
 * plus chat), kept in module memory so it survives panel remounts and
 * workspace/chat switches but not a reload. Entries are plain snapshots — the
 * owner, last committed URL and title — never view ids or live guests, so a
 * restore always goes through a fresh browser open with a new view identity.
 *
 * Only deliberate closes record (the panel calls `recordClosedBrowserTab` from
 * its user-close path); lifecycle and cleanup teardown never reach it.
 */

import { browserOpenInput } from './unifiedBrowserTabs';
import { unifiedPanelStorageKey, type OpenUnifiedTabInput, type UnifiedPanelTab } from './unifiedPanelTabsModel';

/** Most closed tabs remembered per panel scope; the oldest falls off. */
export const CLOSED_BROWSER_TAB_LIMIT = 20;

export interface ClosedBrowserTab {
    ownerWorkspaceId: string;
    ownerRoutingRef?: string | null;
    chatId: string | null;
    repoLabel?: string;
    url?: string;
    label: string;
}

const stacks = new Map<string, ClosedBrowserTab[]>();

export function closedBrowserTabScopeKey(workspaceId: string, chatId: string | null): string {
    return JSON.stringify([unifiedPanelStorageKey(workspaceId), chatId]);
}

/** Whether this key event is the reopen-closed-tab shortcut. Mirrors `closeTabShortcut`. */
export function reopenClosedTabShortcut(
    event: Pick<KeyboardEvent, 'ctrlKey' | 'metaKey' | 'altKey' | 'shiftKey' | 'key'>,
): 'reopen' | null {
    if (!(event.ctrlKey || event.metaKey) || event.altKey || !event.shiftKey) return null;
    return event.key.toLowerCase() === 't' ? 'reopen' : null;
}

/** Remember a user-closed tab. Anything but a `browser` tab is ignored. */
export function recordClosedBrowserTab(scopeKey: string, tab: UnifiedPanelTab): void {
    if (tab.kind !== 'browser') return;
    const stack = stacks.get(scopeKey) ?? [];
    stack.push({
        ownerWorkspaceId: tab.ownerWorkspaceId,
        ...(tab.ownerRoutingRef === undefined ? {} : { ownerRoutingRef: tab.ownerRoutingRef }),
        chatId: tab.chatId,
        ...(tab.repoLabel ? { repoLabel: tab.repoLabel } : {}),
        ...(tab.browserUrl ? { url: tab.browserUrl } : {}),
        label: tab.label,
    });
    if (stack.length > CLOSED_BROWSER_TAB_LIMIT) stack.splice(0, stack.length - CLOSED_BROWSER_TAB_LIMIT);
    stacks.set(scopeKey, stack);
}

/** Take the newest closed tab of a scope, or null when there is none. */
export function popClosedBrowserTab(scopeKey: string): ClosedBrowserTab | null {
    const stack = stacks.get(scopeKey);
    const entry = stack?.pop() ?? null;
    if (stack?.length === 0) stacks.delete(scopeKey);
    return entry;
}

/** Test seam: forget every scope, as a reload does. */
export function clearClosedBrowserTabs(): void {
    stacks.clear();
}

/** A fresh browser open for a closed tab: same owner, new view id, stored title as provisional label. */
export function reopenBrowserTabInput(entry: ClosedBrowserTab): OpenUnifiedTabInput {
    return {
        ...browserOpenInput({
            ownerWorkspaceId: entry.ownerWorkspaceId,
            ...(entry.ownerRoutingRef === undefined ? {} : { ownerRoutingRef: entry.ownerRoutingRef }),
            chatId: entry.chatId,
            ...(entry.repoLabel ? { repoLabel: entry.repoLabel } : {}),
        }, entry.url),
        label: entry.label,
    };
}
