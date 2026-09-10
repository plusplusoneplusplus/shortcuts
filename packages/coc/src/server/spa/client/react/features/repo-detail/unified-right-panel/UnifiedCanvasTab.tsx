/**
 * UnifiedCanvasTab — the body of a `canvas` tab in the unified right panel.
 *
 * `CanvasPanel` does all the editing work; this component is the wiring that
 * makes a canvas usable outside the chat it belongs to. It resolves three
 * things a tab body cannot get from props alone:
 *
 *  - the live `canvas-updated` event, keyed by the OWNING clone plus the canvas
 *    id, so a canvas from a repo-group member or a remote workspace reconciles
 *    from its own server's events and never from a similarly named canvas
 *    elsewhere;
 *  - the ORIGINATING chat's composer actions (`unifiedChatCanvasActions`), so
 *    "Ask AI" and "Send comments" reach that conversation even while another
 *    chat is selected — and are hidden outright when that chat is not mounted,
 *    rather than silently doing nothing;
 *  - pop-out and Kusto creation, which used to belong to the chat's own canvas
 *    column: the window opens/focuses per canvas, and a created query becomes
 *    its own tab beside this one, linked to the same conversation.
 *
 * A tab body is rendered from a switch over the tab kind, where conditional
 * hooks are not an option, so these lookups get their own component — the same
 * shape `UnifiedDiffTab` and `UnifiedNoteTab` already use.
 */

import { useCallback } from 'react';
import { CanvasPanel } from '../../canvas/CanvasPanel';
import { openCanvasPopOut } from '../../canvas/canvasPopOut';
import { useUnifiedCanvasEvent } from './unifiedCanvasEvents';
import { useUnifiedChatCanvasActions } from './unifiedChatCanvasActions';
import { canvasOpenInput } from './unifiedPanelOpenMenuModel';
import { openUnifiedPanelTab } from './unifiedPanelOpen';

export interface UnifiedCanvasTabProps {
    /** The clone that owns the canvas — routes content and matches its events. */
    workspaceId: string;
    /** The panel's own workspace (a group id inside a repo group). */
    scopeWorkspaceId: string;
    /** The tab's `resourceId` — the canvas id. */
    canvasId: string;
    /** The conversation this canvas is linked to — where chat actions go. */
    chatId: string | null;
    /** Owner name shown on the strip when the owner is not the panel's scope. */
    repoLabel?: string;
    onClose: () => void;
    onDirtyChange?: (isDirty: boolean) => void;
    onRegisterSave?: (save: (() => Promise<boolean>) | null) => void;
}

export function UnifiedCanvasTab({
    workspaceId, scopeWorkspaceId, canvasId, chatId, repoLabel,
    onClose, onDirtyChange, onRegisterSave,
}: UnifiedCanvasTabProps) {
    const liveEvent = useUnifiedCanvasEvent(workspaceId, canvasId);
    // The chat that OWNS this canvas, never the selected one, so a late send
    // cannot land in a conversation the user happened to switch to.
    const chatActions = useUnifiedChatCanvasActions(chatId);

    const handlePopOut = useCallback(() => {
        openCanvasPopOut(workspaceId, canvasId);
    }, [workspaceId, canvasId]);

    // A query created from this canvas is linked to the same conversation, so it
    // opens as its own tab here (and shows up in the "+" menu's linked list on
    // its next read). This tab keeps its draft — nothing about it is touched.
    const handleCanvasCreated = useCallback((createdId: string) => {
        openUnifiedPanelTab(scopeWorkspaceId, canvasOpenInput(
            { id: createdId, title: 'Kusto Query' },
            {
                ownerWorkspaceId: workspaceId,
                scopeWorkspaceId,
                chatId,
                ...(repoLabel ? { ownerLabel: repoLabel } : {}),
            },
        ));
    }, [scopeWorkspaceId, workspaceId, chatId, repoLabel]);

    return (
        <CanvasPanel
            workspaceId={workspaceId}
            canvasId={canvasId}
            liveEvent={liveEvent}
            onClose={onClose}
            onDirtyChange={onDirtyChange}
            onRegisterSave={onRegisterSave}
            onPopOut={handlePopOut}
            onCanvasCreated={handleCanvasCreated}
            {...(chatActions ? {
                onAskAi: chatActions.askAi,
                onSendToAi: chatActions.sendToAi,
            } : {})}
        />
    );
}
