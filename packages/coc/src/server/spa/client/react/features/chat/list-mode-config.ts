/**
 * list-mode-config — declarative configuration for the three `ChatListPane`
 * variants (Activity / Chats / Tasks).
 *
 * The 001 refactor introduces this config so the giant `activeTab === 'chats'`
 * and `!activeTab` JSX branches inside `ChatListPane` can collapse into a
 * single config-driven renderer. This file currently only defines the types
 * and the {@link getListModeConfig} factory; subsequent steps wire it into
 * the renderer.
 *
 * No React, no DOM, no side effects — pure data.
 */

import type { ActivityTabMode } from './ChatListPane';

/**
 * Logical "mode" the list pane is operating in.
 *
 * - `chats` — the dedicated Chats tab (`activeTab === 'chats'` today).
 * - `tasks` — the dedicated Tasks tab (`activeTab === 'tasks'` today).
 * - `activity` — the original mixed Activity tab (`!activeTab` today).
 */
export type ListMode = 'chats' | 'tasks' | 'activity';

/** Which baseline scope predicate the mode applies. */
export type ListScopeMode = 'chat-only' | 'task-only' | 'scoped';

/** Layout strategy for the history portion of the list. */
export type HistoryLayout = 'status-priority' | 'pinned-completed-archived';

/** Where the search input renders, if at all. */
export type SearchInputPlacement = 'inline' | 'toolbar' | 'none';

/** The kinds of sections the renderer knows how to emit. */
export type SectionVariant =
    | 'running'
    | 'queued'
    | 'pinned'
    | 'date-bucket-today'
    | 'date-bucket-week'
    | 'date-bucket-older'
    | 'archived';

/** Declarative section entry; the renderer walks this list in order. */
export interface SectionDef {
    /** Stable id for keys + `data-section` test hooks. */
    id: string;
    /** Visible header label. Renderer may suffix with counts. */
    label: string;
    /** Drives which body component (renderEntry shape) the section uses. */
    variant: SectionVariant;
    /** Optional default for the section's collapsed/expanded state. */
    defaultCollapsed?: boolean;
}

/**
 * Behavioral knobs for a single list mode. The renderer reads this object
 * instead of branching on `activeTab`.
 */
export interface ListModeConfig {
    mode: ListMode;
    scope: ListScopeMode;
    /** Activity & Tasks render the queue/autopilot pause banners. */
    showPauseBanner: boolean;
    /** Activity-only segmented control: Chats / Automations / All. */
    showScopeSegmented: boolean;
    /** Chats-only chip row: All / Running / Failed. */
    showFilterChips: boolean;
    /** Where the search input lives. */
    showSearchInput: SearchInputPlacement;
    historyLayout: HistoryLayout;
    /** Collapse consecutive Ralph iterations into a single session row. */
    enableRalphGrouping: boolean;
    /** Group consecutive history entries that share a planFilePath. */
    enablePlanGrouping: boolean;
    /** Render the FTS5 server-search results panel above the list. */
    enableServerSearchPanel: boolean;
    /** Ordered list of sections to render. */
    sections: SectionDef[];
}

/**
 * Resolve the {@link ListMode} from the legacy `activeTab` prop.
 *
 * `activeTab === undefined` corresponds to the original mixed Activity tab;
 * named tabs map 1:1.
 */
export function resolveListMode(activeTab: ActivityTabMode | undefined): ListMode {
    if (activeTab === 'chats') return 'chats';
    if (activeTab === 'tasks') return 'tasks';
    return 'activity';
}

/**
 * Build the {@link ListModeConfig} for a given mode. Pure: no state, no
 * window/document access. The returned object is safe to memoise on `mode`.
 */
export function getListModeConfig(mode: ListMode | ActivityTabMode | undefined): ListModeConfig {
    const resolved: ListMode = (mode === 'chats' || mode === 'tasks' || mode === 'activity')
        ? mode
        : resolveListMode(mode);

    if (resolved === 'chats') {
        return {
            mode: 'chats',
            scope: 'chat-only',
            showPauseBanner: false,
            showScopeSegmented: false,
            showFilterChips: true,
            showSearchInput: 'inline',
            historyLayout: 'status-priority',
            enableRalphGrouping: true,
            enablePlanGrouping: false,
            enableServerSearchPanel: true,
            sections: [
                { id: 'running', label: 'Running', variant: 'running' },
                { id: 'pinned', label: 'Pinned', variant: 'pinned' },
                { id: 'today', label: 'Today', variant: 'date-bucket-today' },
                { id: 'week', label: 'This week', variant: 'date-bucket-week' },
                { id: 'older', label: 'Older', variant: 'date-bucket-older' },
                { id: 'archived', label: 'Archived', variant: 'archived', defaultCollapsed: true },
            ],
        };
    }

    if (resolved === 'tasks') {
        return {
            mode: 'tasks',
            scope: 'task-only',
            showPauseBanner: true,
            showScopeSegmented: false,
            showFilterChips: false,
            showSearchInput: 'toolbar',
            historyLayout: 'pinned-completed-archived',
            enableRalphGrouping: false,
            enablePlanGrouping: true,
            enableServerSearchPanel: false,
            sections: [
                { id: 'running', label: 'Running', variant: 'running' },
                { id: 'queued', label: 'Queued', variant: 'queued' },
                { id: 'pinned', label: 'Pinned', variant: 'pinned' },
                { id: 'today', label: 'Today', variant: 'date-bucket-today' },
                { id: 'week', label: 'This week', variant: 'date-bucket-week' },
                { id: 'older', label: 'Older', variant: 'date-bucket-older' },
                { id: 'archived', label: 'Archived', variant: 'archived', defaultCollapsed: true },
            ],
        };
    }

    // activity (default / mixed)
    return {
        mode: 'activity',
        scope: 'scoped',
        showPauseBanner: true,
        showScopeSegmented: true,
        showFilterChips: false,
        showSearchInput: 'toolbar',
        historyLayout: 'pinned-completed-archived',
        // 001 keeps Activity's existing flat layout. Plan 002 will flip
        // this to true once parity is confirmed.
        enableRalphGrouping: false,
        enablePlanGrouping: true,
        enableServerSearchPanel: false,
        sections: [
            { id: 'running', label: 'Running', variant: 'running' },
            { id: 'queued', label: 'Queued', variant: 'queued' },
            { id: 'pinned', label: 'Pinned', variant: 'pinned' },
            { id: 'today', label: 'Today', variant: 'date-bucket-today' },
            { id: 'week', label: 'This week', variant: 'date-bucket-week' },
            { id: 'older', label: 'Older', variant: 'date-bucket-older' },
            { id: 'archived', label: 'Archived', variant: 'archived', defaultCollapsed: true },
        ],
    };
}
