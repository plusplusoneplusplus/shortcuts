/**
 * AC-04: the descriptor an inline canvas embed opens in the unified panel.
 *
 * A canvas embed is the one AC-04 entry point that had no open action at all —
 * `CanvasEmbed` renders the canvas inline inside the transcript, so there was
 * never a second surface to reroute. What it does carry is everything the
 * descriptor needs: the clone the canvas was fetched from and its title.
 *
 * Two rules live here rather than in the component:
 *  - A canvas belongs to the chat it was embedded in, never to whichever chat
 *    happens to be selected when the click lands, so `chatId` is required and a
 *    missing one declines instead of filing an unowned workspace tab.
 *  - `ownerWorkspaceId` is the embed's own workspace — the clone whose canvas
 *    API served the bytes — while the panel's scope may be a repo group. When
 *    they differ the strip earns a repo label, which is why the workspace list
 *    is passed in.
 *
 * The descriptor itself is `canvasOpenInput`'s, shared with the "+" menu: two
 * ways of opening the same canvas must reach the same tab id.
 */

import { canvasOpenInput } from './unifiedPanelOpenMenuModel';
import type { OpenUnifiedTabInput } from './unifiedPanelTabsModel';

/** The minimum a workspace needs to supply a repo label. */
export interface CanvasEmbedWorkspace {
    id: string;
    name?: string;
}

export interface CanvasEmbedTabInputArgs {
    canvasId: string;
    /** The canvas title; blank falls back to the shared "Untitled canvas" label. */
    title?: string;
    /** The clone the canvas lives on — where its content requests must route. */
    ownerWorkspaceId: string;
    /** The panel's own workspace (a group id inside a repo group). */
    scopeWorkspaceId: string;
    /** The chat the embed was rendered in, not the selected one. */
    chatId: string | null;
    /** Workspaces used to name an owning clone that is not the panel's own. */
    workspaces?: readonly CanvasEmbedWorkspace[];
}

/**
 * The tab an embed's "open in panel" action files, or null when the embed
 * cannot name a canvas or a chat to own it.
 */
export function canvasEmbedTabInput(args: CanvasEmbedTabInputArgs): OpenUnifiedTabInput | null {
    const canvasId = args.canvasId.trim();
    if (canvasId === '') return null;
    if (!args.chatId) return null;
    if (args.ownerWorkspaceId.trim() === '') return null;

    const ownerLabel = args.workspaces?.find(ws => ws.id === args.ownerWorkspaceId)?.name;

    return canvasOpenInput(
        { id: canvasId, title: args.title ?? '' },
        {
            ownerWorkspaceId: args.ownerWorkspaceId,
            scopeWorkspaceId: args.scopeWorkspaceId,
            chatId: args.chatId,
            ...(ownerLabel ? { ownerLabel } : {}),
        },
    );
}
