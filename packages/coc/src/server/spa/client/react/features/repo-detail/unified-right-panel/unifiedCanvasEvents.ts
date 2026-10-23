/**
 * unifiedCanvasEvents — route document updates and reconcile every canvas kind.
 *
 * Kusto result events only publish: background query results must preserve the
 * selected tab and panel visibility. Explicit embed/menu actions still open them.
 * Other canvas updates open or refocus their tab through `openUnifiedPanelTab`.
 * Reconciliation uses a small store because the panel lives outside the chat's
 * SSE subtree; mounted views refresh in place or retain their dirty-draft UI.
 *
 * Identity is `(owning clone, canvas id)`, never the title: a similarly named
 * canvas in another workspace is a different resource, and the descriptor's
 * `ownerWorkspaceId` is the clone whose canvas API serves its revisions. The
 * revision is the ordering — an event that does not advance it is dropped, so a
 * repeated delivery cannot re-trigger a reload effect that keys on the event's
 * identity.
 *
 * The caller decides whether an event may be routed at all. Only a chat whose
 * tabs the strip is actually showing (`useUnifiedPanelHostForChat`) may call in;
 * a background chat's update must not repoint the visible panel, so it never
 * gets here.
 */

import { useCallback, useSyncExternalStore } from 'react';
import type { CanvasUpdatedEvent } from '../../chat/hooks/useChatSSE';
import { canvasOpenInput } from './unifiedPanelOpenMenuModel';
import { openUnifiedPanelTab } from './unifiedPanelOpen';
import type { OpenUnifiedTabInput } from './unifiedPanelTabsModel';

/** The minimum a workspace needs to supply a repo label for the strip. */
export interface CanvasEventWorkspace {
    id: string;
    name?: string;
}

export interface UnifiedCanvasUpdateArgs {
    /** The SSE payload exactly as `useChatSSE` surfaced it. */
    event: CanvasUpdatedEvent;
    /** The clone whose canvas API served this canvas — where content requests route. */
    ownerWorkspaceId: string;
    /** The panel's own workspace (a group id inside a repo group). */
    scopeWorkspaceId: string;
    /** The chat that received the event, never whichever chat is selected. */
    chatId: string | null;
    /** Workspaces used to name an owning clone that is not the panel's own. */
    workspaces?: readonly CanvasEventWorkspace[];
}

// --- Live event registry -------------------------------------------------

/** `(ownerWorkspaceId, canvasId)` → the newest event seen for that canvas. */
const events = new Map<string, CanvasUpdatedEvent>();
const listeners = new Map<string, Set<() => void>>();

function eventKey(ownerWorkspaceId: string, canvasId: string): string {
    return `${ownerWorkspaceId}\n${canvasId}`;
}

/**
 * Record the newest event for a canvas and wake the view showing it.
 *
 * An event that does not advance the revision is dropped rather than stored: a
 * mounted `CanvasPanel` reloads from the event's *identity*, so re-publishing an
 * equivalent event would make it refetch for nothing. Returns whether the
 * registry moved.
 */
export function publishUnifiedCanvasEvent(
    ownerWorkspaceId: string,
    event: CanvasUpdatedEvent,
): boolean {
    const key = eventKey(ownerWorkspaceId, event.canvasId);
    const current = events.get(key);
    if (current && event.revision <= current.revision) return false;
    events.set(key, event);
    listeners.get(key)?.forEach(listener => listener());
    return true;
}

/**
 * The newest live event for one canvas, or null before any has arrived. Feeds
 * `CanvasPanel`'s existing `liveEvent` prop, which is what keeps a visible
 * canvas current without a second fetch path — and what preserves the conflict
 * UI when the user has unsaved edits.
 */
export function useUnifiedCanvasEvent(
    ownerWorkspaceId: string,
    canvasId: string,
): CanvasUpdatedEvent | null {
    const key = eventKey(ownerWorkspaceId, canvasId);
    return useSyncExternalStore(
        useCallback(listener => {
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
        useCallback(() => events.get(key) ?? null, [key]),
        () => null,
    );
}

/** Drop every recorded event (test isolation). */
export function clearUnifiedCanvasEvents(): void {
    const keys = [...events.keys(), ...listeners.keys()];
    events.clear();
    for (const key of new Set(keys)) listeners.get(key)?.forEach(listener => listener());
}

// --- Routing -------------------------------------------------------------

/**
 * The descriptor a canvas event opens. Built through the "+" menu's own
 * `canvasOpenInput`, the same builder the inline embed uses, so an AI update, a
 * menu pick, and an embed's open action all reach ONE tab id for one canvas
 * instead of stacking duplicates.
 */
export function canvasEventTabInput(args: UnifiedCanvasUpdateArgs): OpenUnifiedTabInput | null {
    const canvasId = args.event.canvasId.trim();
    if (canvasId === '') return null;
    // A canvas is chat-owned: with no chat there is no scope to file it under,
    // and an unowned workspace tab would outlive the conversation that made it.
    if (!args.chatId) return null;
    if (args.ownerWorkspaceId.trim() === '') return null;

    const ownerLabel = args.workspaces?.find(ws => ws.id === args.ownerWorkspaceId)?.name;

    return canvasOpenInput(
        { id: canvasId, title: args.event.title ?? '' },
        {
            ownerWorkspaceId: args.ownerWorkspaceId,
            scopeWorkspaceId: args.scopeWorkspaceId,
            chatId: args.chatId,
            ...(ownerLabel ? { ownerLabel } : {}),
        },
    );
}

/**
 * Show the canvas an AI event just touched: publish the event for a mounted
 * view. Kusto results preserve panel state; other kinds open/activate their tab
 * and reveal the panel. Returns the opened tab id, or null for a passive update
 * or an event this panel cannot own.
 *
 * Publishing first is deliberate — a tab that is already mounted starts
 * reconciling in the same tick it is focused, so the user never sees the
 * previous revision under a freshly activated tab.
 */
export function routeUnifiedCanvasUpdate(args: UnifiedCanvasUpdateArgs): string | null {
    const input = canvasEventTabInput(args);
    if (!input) return null;
    publishUnifiedCanvasEvent(args.ownerWorkspaceId, args.event);
    if (args.event.canvasType === 'kusto') return null;
    return openUnifiedPanelTab(args.scopeWorkspaceId, input);
}
