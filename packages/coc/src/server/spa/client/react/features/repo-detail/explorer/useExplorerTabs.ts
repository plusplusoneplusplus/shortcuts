/**
 * useExplorerTabs — the React face of the Explorer's editor-tab session.
 *
 * `explorerTabsModel` holds the rules (what opening, closing and cycling do to
 * an `ExplorerTabsState`) and `explorerStateStore` holds the plumbing (one
 * localStorage key per workspace, shared through `useSyncExternalStore`). This
 * hook is the join: it hands components an operation-shaped API — `openFile`,
 * `activate`, `close`, `move` — instead of asking every call site to thread the
 * previous state through a model function by hand.
 *
 * Two properties matter to the callers:
 *
 *  - **Every action callback is referentially stable.** They are the deps of
 *    keyboard listeners and memoized tab-strip rows; a new identity per render
 *    would tear those down and rebuild them constantly. Actions therefore never
 *    close over the rendered state — they go through the functional setter,
 *    which reads the freshest persisted value at call time. That also makes two
 *    actions fired in the same tick compose correctly instead of the second
 *    clobbering the first.
 *
 *  - **Nothing here is workspace-global.** Everything hangs off the
 *    `workspaceId` passed in, so two Explorers on different repos have
 *    independent tab sessions, and two Explorers on the *same* repo (the
 *    RepoDetail sub-tab and the right dock, which can be mounted at once) stay
 *    in sync through the shared store.
 */

import { useCallback, useMemo, useRef } from 'react';
import { useExplorerTabsState } from './explorerStateStore';
import {
    EMPTY_EXPLORER_TABS,
    activateTab,
    activeTab,
    allTabIds,
    clearTabRevealLine,
    closeTab,
    closeTabs,
    cycleTabs,
    findTab,
    moveTab,
    openFileTab,
    openSearchTab,
    otherTabIds,
    pinTab,
    tabLabels,
    type ExplorerTab,
    type ExplorerTabsState,
    type OpenFileTabInput,
    type OpenSearchTabInput,
    type TabCycleDirection,
} from './explorerTabsModel';

export interface ExplorerTabsApi {
    /** The whole persisted session, for callers that need the raw shape. */
    state: ExplorerTabsState;
    /** Open tabs in strip order. */
    tabs: readonly ExplorerTab[];
    /** Id of the tab whose buffer is showing, or null when none is open. */
    activeId: string | null;
    /** The active tab object, or null when none is open. */
    active: ExplorerTab | null;
    /**
     * Tab id → the label the strip should show: the filename, widened to the
     * shortest distinguishing parent path when two open files share a name.
     */
    labels: Map<string, string>;

    /** Open, or re-activate, a file tab. See `openFileTab` for the rules. */
    openFile(input: OpenFileTabInput): void;
    /** Open, or re-activate, the read-only buffer for a search result set. */
    openSearch(input: OpenSearchTabInput): void;
    /** Show an already-open tab, moving it to the front of the MRU. */
    activate(id: string): void;
    /** Promote a preview tab to a pinned one (double click, or first edit). */
    pin(id: string): void;
    /** Forget a tab's pending reveal line, once the editor has scrolled to it. */
    clearRevealLine(id: string): void;
    /** Close one tab; the most recently used survivor takes over if it was active. */
    close(id: string): void;
    /** Close several tabs at once — Close Others / to the Right / All. */
    closeMany(ids: readonly string[]): void;
    /** Drag-reorder: move the tab at `fromIndex` to sit at `toIndex`. */
    move(fromIndex: number, toIndex: number): void;
    /** Close every tab, leaving an empty strip. */
    closeAll(): void;

    /**
     * The id Ctrl+Tab / Ctrl+Shift+Tab would land on, or null when there is
     * nothing to cycle to. Reports rather than applies, so a held Ctrl can walk
     * several steps before the MRU is rewritten; pass `from` to continue a walk
     * already in progress instead of restarting from the active tab.
     */
    cycle(direction: TabCycleDirection, from?: string): string | null;

    /** Look up an open tab by id, or null. */
    find(id: string): ExplorerTab | null;
    /** Ids of every tab but this one — the Close Others target set. */
    idsOther(id: string): string[];
    /** Ids of every open tab — the Close All target set. */
    idsAll(): string[];
}

/**
 * The persisted editor-tab session for one workspace, plus the actions that
 * change it. Safe to call from several components at once for the same
 * workspace: they share a single session.
 */
export function useExplorerTabs(workspaceId: string): ExplorerTabsApi {
    const [state, setState] = useExplorerTabsState(workspaceId);

    // The latest state, readable from a stable callback without making that
    // callback depend on the render. Only `cycle` and the pure lookups need it;
    // the mutating actions go through the functional setter instead.
    const latest = useRef(state);
    latest.current = state;

    const openFile = useCallback((input: OpenFileTabInput) => {
        setState(prev => openFileTab(prev, input));
    }, [setState]);

    const openSearch = useCallback((input: OpenSearchTabInput) => {
        setState(prev => openSearchTab(prev, input));
    }, [setState]);

    const activate = useCallback((id: string) => {
        setState(prev => activateTab(prev, id));
    }, [setState]);

    const pin = useCallback((id: string) => {
        setState(prev => pinTab(prev, id));
    }, [setState]);

    const clearRevealLine = useCallback((id: string) => {
        setState(prev => clearTabRevealLine(prev, id));
    }, [setState]);

    const close = useCallback((id: string) => {
        setState(prev => closeTab(prev, id));
    }, [setState]);

    const closeMany = useCallback((ids: readonly string[]) => {
        setState(prev => closeTabs(prev, ids));
    }, [setState]);

    const move = useCallback((fromIndex: number, toIndex: number) => {
        setState(prev => moveTab(prev, fromIndex, toIndex));
    }, [setState]);

    const closeAll = useCallback(() => {
        setState(prev => (prev.tabs.length === 0 ? prev : EMPTY_EXPLORER_TABS));
    }, [setState]);

    const cycle = useCallback((direction: TabCycleDirection, from?: string) => {
        const current = latest.current;
        if (from === undefined) return cycleTabs(current, direction);
        // Continuing a walk: pretend the step we already highlighted is the
        // active tab, without having committed it to the MRU.
        return cycleTabs({ ...current, activeId: from }, direction);
    }, []);

    const find = useCallback((id: string) => findTab(latest.current, id), []);
    const idsOther = useCallback((id: string) => otherTabIds(latest.current, id), []);
    const idsAll = useCallback(() => allTabIds(latest.current), []);

    const labels = useMemo(() => tabLabels(state.tabs), [state.tabs]);
    const active = useMemo(() => activeTab(state), [state]);

    return useMemo(() => ({
        state,
        tabs: state.tabs,
        activeId: state.activeId,
        active,
        labels,
        openFile,
        openSearch,
        activate,
        pin,
        clearRevealLine,
        close,
        closeMany,
        move,
        closeAll,
        cycle,
        find,
        idsOther,
        idsAll,
    }), [
        state, active, labels,
        openFile, openSearch, activate, pin, clearRevealLine,
        close, closeMany, move, closeAll, cycle, find, idsOther, idsAll,
    ]);
}
