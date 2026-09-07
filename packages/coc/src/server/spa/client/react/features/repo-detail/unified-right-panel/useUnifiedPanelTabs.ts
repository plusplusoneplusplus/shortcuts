/**
 * useUnifiedPanelTabs — the React face of the unified right panel's tab
 * session, for one workspace viewed from one chat selection.
 *
 * `unifiedPanelTabsModel` holds the rules and `unifiedPanelStore` holds the
 * plumbing; this hook is the join. Callers get an operation-shaped API —
 * `open`, `activate`, `close`, `move` — instead of threading the previous state
 * through a model function by hand.
 *
 * Two properties the call sites depend on:
 *
 *  - **Every action callback is referentially stable.** They are the deps of
 *    keyboard handlers and memoized strip rows. Actions never close over the
 *    rendered state; they go through the functional setter, which reads the
 *    freshest persisted value at call time, so two actions fired in one tick
 *    compose rather than the second clobbering the first.
 *
 *  - **`chatId` selects a view, not a session.** The stored state holds every
 *    chat's tabs at once, so switching chats changes what this hook reports
 *    without touching what is stored — which is what makes chat-owned tabs come
 *    back, with their selection, when the user returns.
 */

import { useCallback, useMemo, useRef } from 'react';
import { useUnifiedPanelState } from './unifiedPanelStore';
import {
    activateTab,
    activeTab,
    activeTabId,
    closeTab,
    findTab,
    moveTab,
    openPreviewTab,
    openTab,
    previewTab,
    previewTabToReplace,
    promoteTab,
    visibleTabIds,
    visibleTabs,
    type OpenUnifiedPreviewTabInput,
    type OpenUnifiedTabInput,
    type UnifiedPanelState,
    type UnifiedPanelTab,
} from './unifiedPanelTabsModel';

export interface UnifiedPanelTabsApi {
    /** The whole persisted layout, for callers that need the raw shape. */
    state: UnifiedPanelState;
    /** Tabs visible for this chat selection: workspace tabs, then the chat's. */
    tabs: readonly UnifiedPanelTab[];
    /** Id of the tab whose view is showing, or null when the panel is empty. */
    activeId: string | null;
    /** The active tab object, or null when the panel is empty. */
    active: UnifiedPanelTab | null;

    /** The section's replaceable preview tab, or null. See `previewTab`. */
    preview: UnifiedPanelTab | null;

    /** Open a resource, or focus its existing tab. See `openTab`. */
    open(input: OpenUnifiedTabInput): void;
    /**
     * Open a file into this section's single preview slot — the file tree's
     * single click. See `openPreviewTab`; the caller resolves an outgoing dirty
     * preview first, exactly as it does before a close.
     */
    openPreview(input: OpenUnifiedPreviewTabInput): void;
    /** Make a preview tab permanent, in place. One-way. See `promoteTab`. */
    promote(id: string): void;
    /** Show an already-visible tab. A no-op for a tab this chat cannot see. */
    activate(id: string): void;
    /**
     * Remove a tab. Layout only: confirming a terminal kill and resolving
     * unsaved edits belong to the caller, before this runs (AC-05).
     */
    close(id: string): void;
    /** Reorder within a section: put `id` where `beforeId` is, or at the end. */
    move(id: string, beforeId: string | null): void;
    /** Close every tab visible in this chat. */
    closeAllVisible(): void;

    /**
     * The preview tab `openPreview(input)` would evict, or null. Ask before
     * opening so an outgoing dirty buffer gets the unsaved-edits prompt first.
     */
    previewToReplace(input: OpenUnifiedPreviewTabInput): UnifiedPanelTab | null;

    /** Look up a tab anywhere in the layout, regardless of scope. */
    find(id: string): UnifiedPanelTab | null;
    /** Ids of every tab visible here — the "close all" target set. */
    visibleIds(): string[];
}

/**
 * The unified panel's tab session for `workspaceId`, viewed from `chatId`
 * (null when no chat is selected). Safe to call from several components at
 * once: they share one persisted session through the store.
 */
export function useUnifiedPanelTabs(workspaceId: string, chatId: string | null): UnifiedPanelTabsApi {
    const [state, setState] = useUnifiedPanelState(workspaceId);

    // The latest state and chat, readable from a stable callback without making
    // that callback depend on the render. Only the pure lookups need them; the
    // mutating actions go through the functional setter instead.
    const latest = useRef(state);
    latest.current = state;
    const latestChat = useRef(chatId);
    latestChat.current = chatId;

    const open = useCallback((input: OpenUnifiedTabInput) => {
        setState(prev => openTab(prev, input));
    }, [setState]);

    const openPreview = useCallback((input: OpenUnifiedPreviewTabInput) => {
        setState(prev => openPreviewTab(prev, input));
    }, [setState]);

    const promote = useCallback((id: string) => {
        setState(prev => promoteTab(prev, id));
    }, [setState]);

    const activate = useCallback((id: string) => {
        setState(prev => activateTab(prev, latestChat.current, id));
    }, [setState]);

    const close = useCallback((id: string) => {
        setState(prev => closeTab(prev, id));
    }, [setState]);

    const move = useCallback((id: string, beforeId: string | null) => {
        setState(prev => moveTab(prev, id, beforeId));
    }, [setState]);

    const closeAllVisible = useCallback(() => {
        setState(prev => visibleTabIds(prev, latestChat.current)
            .reduce((acc, id) => closeTab(acc, id), prev));
    }, [setState]);

    const previewToReplace = useCallback(
        (input: OpenUnifiedPreviewTabInput) => previewTabToReplace(latest.current, latestChat.current, input),
        [],
    );

    const find = useCallback((id: string) => findTab(latest.current, id), []);
    const visibleIds = useCallback(() => visibleTabIds(latest.current, latestChat.current), []);

    const tabs = useMemo(() => visibleTabs(state, chatId), [state, chatId]);
    const activeId = useMemo(() => activeTabId(state, chatId), [state, chatId]);
    const active = useMemo(() => activeTab(state, chatId), [state, chatId]);
    const preview = useMemo(() => previewTab(state, chatId), [state, chatId]);

    return useMemo(() => ({
        state, tabs, activeId, active, preview,
        open, openPreview, promote, activate, close, move, closeAllVisible,
        previewToReplace, find, visibleIds,
    }), [state, tabs, activeId, active, preview,
        open, openPreview, promote, activate, close, move, closeAllVisible,
        previewToReplace, find, visibleIds]);
}
