import {
    EMPTY_UNIFIED_PANEL_NAVIGATION_HISTORY,
    type UnifiedPanelNavigationHistory,
} from './unifiedPanelNavigationHistory';

const histories = new Map<string, UnifiedPanelNavigationHistory>();

export function readUnifiedPanelNavigationHistory(
    workspaceId: string,
): UnifiedPanelNavigationHistory {
    return histories.get(workspaceId) ?? EMPTY_UNIFIED_PANEL_NAVIGATION_HISTORY;
}

export function writeUnifiedPanelNavigationHistory(
    workspaceId: string,
    history: UnifiedPanelNavigationHistory,
): void {
    histories.set(workspaceId, history);
}

export function clearUnifiedPanelNavigationHistory(workspaceId?: string): void {
    if (workspaceId === undefined) histories.clear();
    else histories.delete(workspaceId);
}
