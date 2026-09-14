import type { editor as monacoEditor, ISelection } from 'monaco-editor';

export const UNIFIED_PANEL_NAVIGATION_LIMIT = 50;
export const UNIFIED_PANEL_NEARBY_LINE_THRESHOLD = 10;

export type NavigationLocationReason = 'user' | 'navigation' | 'jump' | 'programmatic';
export type NavigationDirection = 'back' | 'forward';

export interface UnifiedPanelNavigationLocation {
    scopeWorkspaceId: string;
    tabId: string;
    selection: ISelection;
    viewState: monacoEditor.ICodeEditorViewState;
}

export interface UnifiedPanelNavigationHistory {
    readonly entries: readonly UnifiedPanelNavigationLocation[];
    readonly index: number;
    readonly replaying: boolean;
}

export interface NavigationStep {
    history: UnifiedPanelNavigationHistory;
    location: UnifiedPanelNavigationLocation;
}

export const EMPTY_UNIFIED_PANEL_NAVIGATION_HISTORY: UnifiedPanelNavigationHistory = {
    entries: [],
    index: -1,
    replaying: false,
};

export function sameNavigationLocationIdentity(
    left: UnifiedPanelNavigationLocation,
    right: UnifiedPanelNavigationLocation,
): boolean {
    return left.scopeWorkspaceId === right.scopeWorkspaceId && left.tabId === right.tabId;
}

function selectionsEqual(left: ISelection, right: ISelection): boolean {
    return left.selectionStartLineNumber === right.selectionStartLineNumber
        && left.selectionStartColumn === right.selectionStartColumn
        && left.positionLineNumber === right.positionLineNumber
        && left.positionColumn === right.positionColumn;
}

export function navigationLocationsEqual(
    left: UnifiedPanelNavigationLocation,
    right: UnifiedPanelNavigationLocation,
): boolean {
    return sameNavigationLocationIdentity(left, right)
        && selectionsEqual(left.selection, right.selection)
        && JSON.stringify(left.viewState) === JSON.stringify(right.viewState);
}

function selectionStartLine(selection: ISelection): number {
    return Math.min(selection.selectionStartLineNumber, selection.positionLineNumber);
}

function hasIdenticalHistoryPosition(
    left: UnifiedPanelNavigationLocation,
    right: UnifiedPanelNavigationLocation,
): boolean {
    return sameNavigationLocationIdentity(left, right)
        && selectionStartLine(left.selection) === selectionStartLine(right.selection);
}

function shouldReplaceCurrent(
    current: UnifiedPanelNavigationLocation,
    candidate: UnifiedPanelNavigationLocation,
    reason: NavigationLocationReason,
): boolean {
    if (!sameNavigationLocationIdentity(current, candidate)) return false;

    const lineDelta = Math.abs(selectionStartLine(current.selection) - selectionStartLine(candidate.selection));
    if (lineDelta === 0) return true;

    return lineDelta < UNIFIED_PANEL_NEARBY_LINE_THRESHOLD
        && reason !== 'navigation'
        && reason !== 'jump';
}

export function recordNavigationLocation(
    history: UnifiedPanelNavigationHistory,
    location: UnifiedPanelNavigationLocation,
    reason: NavigationLocationReason,
): UnifiedPanelNavigationHistory {
    if (history.replaying) return history;

    const current = history.entries[history.index];
    if (current && navigationLocationsEqual(current, location)) return history;

    const entries = history.entries.slice(0, history.index + 1);
    if (current && shouldReplaceCurrent(current, location, reason)) {
        entries[entries.length - 1] = location;
        return { entries, index: entries.length - 1, replaying: false };
    }

    entries.push(location);
    if (entries.length > UNIFIED_PANEL_NAVIGATION_LIMIT) entries.shift();
    return { entries, index: entries.length - 1, replaying: false };
}

export function canNavigateHistory(
    history: UnifiedPanelNavigationHistory,
    direction: NavigationDirection,
): boolean {
    if (history.replaying) return false;
    return direction === 'back'
        ? history.index > 0
        : history.index >= 0 && history.index < history.entries.length - 1;
}

export function stepNavigationHistory(
    history: UnifiedPanelNavigationHistory,
    direction: NavigationDirection,
): NavigationStep | null {
    if (!canNavigateHistory(history, direction)) return null;
    const index = history.index + (direction === 'back' ? -1 : 1);
    return {
        history: { ...history, index, replaying: true },
        location: history.entries[index],
    };
}

export function finishNavigationReplay(
    history: UnifiedPanelNavigationHistory,
): UnifiedPanelNavigationHistory {
    return history.replaying ? { ...history, replaying: false } : history;
}

export function pruneClosedNavigationTabs(
    history: UnifiedPanelNavigationHistory,
    openTabIds: ReadonlySet<string>,
): UnifiedPanelNavigationHistory {
    const kept = history.entries.filter(entry => openTabIds.has(entry.tabId));
    if (kept.length === history.entries.length) return history;

    const entries = kept.filter((entry, index) => (
        index === 0 || !hasIdenticalHistoryPosition(kept[index - 1], entry)
    ));
    return {
        entries,
        index: entries.length - 1,
        replaying: false,
    };
}
