/**
 * unifiedPanelHost — the context that tells a chat subtree "a unified right
 * panel is on screen for you" (AC-04).
 *
 * `openUnifiedPanelTab` writes straight through the store, so an entry point
 * can file a tab from anywhere. That is exactly why the *decision* to reroute
 * needs a signal: `ChatDetail` renders under a dozen hosts (pop-out windows,
 * note editors, PR/commit side panels, work items). Rerouting a diff or a
 * source link into a panel that is not mounted there would make the resource
 * vanish instead of opening. So the two dock hosts — `RepoDetail` and
 * `RepoGroupView` — publish their panel here, and everything below them asks.
 *
 * Two fields, both load-bearing:
 *  - `workspaceId` is the panel's SCOPE (the group id inside a repo group), the
 *    key its store is saved under — not necessarily the clone a resource's
 *    bytes come from, which travels as the descriptor's `ownerWorkspaceId`.
 *  - `chatId` is the chat whose tabs the panel currently shows. An entry point
 *    in a *different* chat must not reroute: its tab would be filed under its
 *    own scope, invisible in the strip, and the reveal would pop an empty
 *    panel open. `useUnifiedPanelHostForChat` is that check, so callers cannot
 *    forget it.
 */

import { createContext, useContext, useMemo } from 'react';
import type { ReactNode } from 'react';

export interface UnifiedPanelHost {
    /** The panel's scope/storage workspace id (a group id inside a repo group). */
    workspaceId: string;
    /** The chat whose tabs the panel is currently showing, or null for none. */
    chatId: string | null;
}

const UnifiedPanelHostContext = createContext<UnifiedPanelHost | null>(null);

export interface UnifiedPanelHostProviderProps {
    /** The published host, or null when the unified panel is not the right surface here. */
    host: UnifiedPanelHost | null;
    children: ReactNode;
}

/**
 * Publish (or explicitly un-publish) the unified panel to this subtree. Pass
 * `host={null}` with the flag off or the dock unavailable — consumers then see
 * exactly what they see outside a dock host, so there is one code path for
 * "no panel here" rather than a flag check duplicated at every entry point.
 */
export function UnifiedPanelHostProvider({ host, children }: UnifiedPanelHostProviderProps) {
    const value = useMemo(
        () => (host === null ? null : { workspaceId: host.workspaceId, chatId: host.chatId }),
        // `workspaceId` is a non-optional string, so `undefined` here means
        // "no host" — the null case cannot alias a real one.
        [host?.workspaceId, host?.chatId],
    );
    return (
        <UnifiedPanelHostContext.Provider value={value}>
            {children}
        </UnifiedPanelHostContext.Provider>
    );
}

/** The unified panel hosting this subtree, or null when there is none. */
export function useUnifiedPanelHost(): UnifiedPanelHost | null {
    return useContext(UnifiedPanelHostContext);
}

/**
 * The hosting panel, but only when it is currently showing `chatId`'s tabs.
 *
 * Entry points inside a chat use this one: a resource opened from a background
 * chat belongs to that chat's tab set, which the panel is not displaying, so
 * rerouting it would hide the resource instead of showing it. Those callers
 * keep their existing in-chat surface.
 */
export function useUnifiedPanelHostForChat(chatId: string | null | undefined): UnifiedPanelHost | null {
    const host = useUnifiedPanelHost();
    if (host === null) return null;
    if (!chatId || host.chatId !== chatId) return null;
    return host;
}
