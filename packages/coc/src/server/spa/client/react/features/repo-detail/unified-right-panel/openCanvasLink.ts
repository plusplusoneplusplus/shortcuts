/**
 * Open a clicked `canvas://<id>` link as a canvas tab in the unified panel.
 *
 * Shared by the markdown file viewer and the Notes editor. The tab is the same
 * one the inline embed's "Open in panel" and the "+" menu file, so the three
 * paths never create duplicate tabs. A canvas tab belongs to a chat, so with
 * no panel or no visible chat the click declines instead of filing an
 * unowned tab.
 */

import type { UnifiedPanelHost } from './unifiedPanelHost';
import { canvasEmbedTabInput, type CanvasEmbedWorkspace } from './unifiedCanvasEmbeds';
import { openUnifiedPanelTab } from './unifiedPanelOpen';

export const CANVAS_LINK_NO_CHAT_MESSAGE = 'Open a chat in this repo to view the canvas.';

export interface OpenCanvasLinkArgs {
    canvasId: string;
    /** The clone that owns the markdown resource (a member clone, never a group id). */
    ownerWorkspaceId: string;
    host: UnifiedPanelHost | null;
    workspaces?: readonly CanvasEmbedWorkspace[];
}

export function openCanvasLink(args: OpenCanvasLinkArgs): { ok: true } | { ok: false; reason: string } {
    const { host } = args;
    const input = host === null ? null : canvasEmbedTabInput({
        canvasId: args.canvasId,
        ownerWorkspaceId: args.ownerWorkspaceId,
        scopeWorkspaceId: host.workspaceId,
        chatId: host.chatId,
        workspaces: args.workspaces,
    });
    if (host === null || input === null) return { ok: false, reason: CANVAS_LINK_NO_CHAT_MESSAGE };
    openUnifiedPanelTab(host.workspaceId, input);
    return { ok: true };
}
