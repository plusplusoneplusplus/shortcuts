import type { ISelection } from 'monaco-editor';
import type { OpenUnifiedPreviewTabInput, UnifiedPanelTab } from './unifiedPanelTabsModel';

export const UNIFIED_PANEL_NAVIGATION_LIMIT = 50;
export const UNIFIED_PANEL_NEARBY_LINE_THRESHOLD = 10;

export type NavigationLocationReason = 'user' | 'navigation' | 'jump' | 'programmatic';
export type NavigationDirection = 'back' | 'forward';

/** What reopening a closed file tab needs: its descriptor minus the chat. */
export type UnifiedPanelNavigationFile = Omit<OpenUnifiedPreviewTabInput, 'chatId' | 'line' | 'column' | 'symbolCandidate' | 'gitView'>;

export interface UnifiedPanelNavigationLocation {
    scopeWorkspaceId: string;
    tabId: string;
    file: UnifiedPanelNavigationFile;
    selection: ISelection;
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
        && selectionsEqual(left.selection, right.selection);
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

    // VS Code's `doReplace` overwrites the current entry in place and keeps the
    // forward branch; only a new entry truncates it.
    if (current && shouldReplaceCurrent(current, location, reason)) {
        const entries = [...history.entries];
        entries[history.index] = location;
        return { entries, index: history.index, replaying: false };
    }

    const entries = history.entries.slice(0, history.index + 1);
    entries.push(location);
    if (entries.length > UNIFIED_PANEL_NAVIGATION_LIMIT) entries.shift();
    return { entries, index: entries.length - 1, replaying: false };
}

function destinationIndex(
    history: UnifiedPanelNavigationHistory,
    direction: NavigationDirection,
    scopeWorkspaceId: string,
): number {
    if (history.replaying) return -1;
    const delta = direction === 'back' ? -1 : 1;
    for (let index = history.index + delta; index >= 0 && index < history.entries.length; index += delta) {
        if (history.entries[index].scopeWorkspaceId === scopeWorkspaceId) return index;
    }
    return -1;
}

export function canNavigateHistory(
    history: UnifiedPanelNavigationHistory,
    direction: NavigationDirection,
    scopeWorkspaceId: string,
): boolean {
    return destinationIndex(history, direction, scopeWorkspaceId) >= 0;
}

export function navigationHistoryDestination(
    history: UnifiedPanelNavigationHistory,
    direction: NavigationDirection,
    scopeWorkspaceId: string,
): UnifiedPanelNavigationLocation | null {
    return history.entries[destinationIndex(history, direction, scopeWorkspaceId)] ?? null;
}

/** Step to the nearest entry of `scopeWorkspaceId`; another scope's entries are never replayed. */
export function stepNavigationHistory(
    history: UnifiedPanelNavigationHistory,
    direction: NavigationDirection,
    scopeWorkspaceId: string,
): NavigationStep | null {
    const index = destinationIndex(history, direction, scopeWorkspaceId);
    if (index < 0) return null;
    return {
        history: { ...history, index, replaying: true },
        location: history.entries[index],
    };
}

/**
 * The file a replay just stepped onto is gone: drop every entry for it and put
 * the index where stepping again in `direction` moves on to the next entry.
 * Neighbours left adjacent at the same position collapse.
 */
export function dropReplayedNavigationEntry(
    history: UnifiedPanelNavigationHistory,
    direction: NavigationDirection,
): UnifiedPanelNavigationHistory {
    const replayed = history.entries[history.index];
    if (replayed === undefined) return finishNavigationReplay(history);
    // A collapsed pair keeps the later entry's original position, so a pair
    // straddling the dropped file counts as after it.
    const entries: UnifiedPanelNavigationLocation[] = [];
    let lastOriginal = -1;
    let keptBefore = 0;
    history.entries.forEach((entry, index) => {
        if (sameNavigationLocationIdentity(entry, replayed)) return;
        const previous = entries[entries.length - 1];
        if (previous && hasIdenticalHistoryPosition(previous, entry)) {
            entries.pop();
            if (lastOriginal < history.index) keptBefore -= 1;
        }
        entries.push(entry);
        lastOriginal = index;
        if (index < history.index) keptBefore += 1;
    });
    if (entries.length === 0) return EMPTY_UNIFIED_PANEL_NAVIGATION_HISTORY;
    const index = direction === 'back' ? keptBefore : keptBefore - 1;
    return { entries, index: Math.min(Math.max(index, 0), entries.length - 1), replaying: false };
}

export function navigationFileOf(tab: UnifiedPanelTab): UnifiedPanelNavigationFile {
    return {
        ownerWorkspaceId: tab.ownerWorkspaceId,
        ...(tab.ownerRoutingRef === undefined ? {} : { ownerRoutingRef: tab.ownerRoutingRef }),
        resourceId: tab.resourceId,
        label: tab.label,
        ...(tab.repoLabel === undefined ? {} : { repoLabel: tab.repoLabel }),
    };
}

/** The preview open that brings a closed entry's file back in `chatId`'s view. */
export function navigationReopenInput(
    location: UnifiedPanelNavigationLocation,
    chatId: string | null,
): OpenUnifiedPreviewTabInput {
    return { ...location.file, chatId };
}

export function finishNavigationReplay(
    history: UnifiedPanelNavigationHistory,
): UnifiedPanelNavigationHistory {
    return history.replaying ? { ...history, replaying: false } : history;
}

// ---------------------------------------------------------------------------
// Persistence
// ---------------------------------------------------------------------------

/** Bump when the persisted entry shape changes; other versions load empty. */
export const UNIFIED_PANEL_NAVIGATION_VERSION = 1;

export function serializeUnifiedPanelNavigationHistory(history: UnifiedPanelNavigationHistory): string {
    return JSON.stringify({
        version: UNIFIED_PANEL_NAVIGATION_VERSION,
        entries: history.entries,
        index: history.index,
    });
}

const isString = (value: unknown): value is string => typeof value === 'string';
const isPositiveNumber = (value: unknown): value is number =>
    typeof value === 'number' && Number.isFinite(value) && value >= 1;

function parseFile(raw: unknown): UnifiedPanelNavigationFile | null {
    if (typeof raw !== 'object' || raw === null) return null;
    const file = raw as Record<string, unknown>;
    if (!isString(file.ownerWorkspaceId) || !isString(file.resourceId) || !isString(file.label)) return null;
    if (file.ownerRoutingRef !== undefined && file.ownerRoutingRef !== null && !isString(file.ownerRoutingRef)) return null;
    if (file.repoLabel !== undefined && !isString(file.repoLabel)) return null;
    return {
        ownerWorkspaceId: file.ownerWorkspaceId,
        ...(file.ownerRoutingRef === undefined ? {} : { ownerRoutingRef: file.ownerRoutingRef as string | null }),
        resourceId: file.resourceId,
        label: file.label,
        ...(file.repoLabel === undefined ? {} : { repoLabel: file.repoLabel }),
    };
}

function parseSelection(raw: unknown): ISelection | null {
    if (typeof raw !== 'object' || raw === null) return null;
    const selection = raw as Record<string, unknown>;
    const {
        selectionStartLineNumber, selectionStartColumn, positionLineNumber, positionColumn,
    } = selection;
    if (
        !isPositiveNumber(selectionStartLineNumber) || !isPositiveNumber(selectionStartColumn)
        || !isPositiveNumber(positionLineNumber) || !isPositiveNumber(positionColumn)
    ) return null;
    return { selectionStartLineNumber, selectionStartColumn, positionLineNumber, positionColumn };
}

function parseLocation(raw: unknown, scopeWorkspaceId: string): UnifiedPanelNavigationLocation | null {
    if (typeof raw !== 'object' || raw === null) return null;
    const entry = raw as Record<string, unknown>;
    if (entry.scopeWorkspaceId !== scopeWorkspaceId || !isString(entry.tabId)) return null;
    const file = parseFile(entry.file);
    const selection = parseSelection(entry.selection);
    if (file === null || selection === null) return null;
    return { scopeWorkspaceId, tabId: entry.tabId, file, selection };
}

/**
 * Read one panel scope's persisted history. Anything unreadable — another
 * version, an entry without reopen data, another scope's entry — is dropped;
 * the index follows the entries that survive. Never loads mid-replay.
 */
export function parseUnifiedPanelNavigationHistory(
    raw: string | null,
    scopeWorkspaceId: string,
): UnifiedPanelNavigationHistory {
    if (raw === null) return EMPTY_UNIFIED_PANEL_NAVIGATION_HISTORY;
    let parsed: unknown;
    try {
        parsed = JSON.parse(raw);
    } catch {
        return EMPTY_UNIFIED_PANEL_NAVIGATION_HISTORY;
    }
    if (typeof parsed !== 'object' || parsed === null) return EMPTY_UNIFIED_PANEL_NAVIGATION_HISTORY;
    const { version, entries: rawEntries, index: rawIndex } = parsed as Record<string, unknown>;
    if (version !== UNIFIED_PANEL_NAVIGATION_VERSION || !Array.isArray(rawEntries)) {
        return EMPTY_UNIFIED_PANEL_NAVIGATION_HISTORY;
    }
    const savedIndex = typeof rawIndex === 'number' ? rawIndex : rawEntries.length - 1;
    const entries: UnifiedPanelNavigationLocation[] = [];
    let index = -1;
    rawEntries.slice(-UNIFIED_PANEL_NAVIGATION_LIMIT).forEach((rawEntry, offset) => {
        const entry = parseLocation(rawEntry, scopeWorkspaceId);
        if (entry === null) return;
        entries.push(entry);
        const originalIndex = offset + Math.max(rawEntries.length - UNIFIED_PANEL_NAVIGATION_LIMIT, 0);
        if (originalIndex <= savedIndex) index = entries.length - 1;
    });
    if (entries.length === 0) return EMPTY_UNIFIED_PANEL_NAVIGATION_HISTORY;
    return { entries, index: Math.max(index, 0), replaying: false };
}
