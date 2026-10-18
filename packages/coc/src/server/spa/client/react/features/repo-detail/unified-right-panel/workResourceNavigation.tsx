import { createContext, useCallback, useContext } from 'react';
import { buildWorkResourceHash, parseWorkResourceRoute, type WorkResourceKind, type WorkResourceRoute } from '../../../layout/workResourceRoute';
import { panelOwnerForSelection, panelWorkspaceResourceInput } from './unifiedPanelWorkspaceResources';
import { openTab, type UnifiedPanelTab } from './unifiedPanelTabsModel';
import { updateUnifiedPanelState } from './unifiedPanelOpen';
import { useUnifiedPanelHost } from './unifiedPanelHost';
import { openWorkspaceDock } from '../WorkspaceDockToggle';

export function openWorkResourceRoute(route: WorkResourceRoute, chatId: string | null = null): void {
    const scope = panelOwnerForSelection(route.scopeId, chatId);
    const owner = panelOwnerForSelection(route.ownerId, chatId);
    updateUnifiedPanelState(scope.workspaceId, prev => openTab(prev, {
        ...panelWorkspaceResourceInput(route.kind, owner), workPath: route.path,
        ...(route.ownerId !== route.scopeId ? { repoLabel: owner.workspaceId } : {}),
    }));
    openWorkspaceDock(scope.workspaceId);
}
export const WorkResourceNavigationContext = createContext<{ scopeId: string; tab: UnifiedPanelTab } | null>(null);

/** Panel selection belongs to this descriptor, never the dashboard's global selection. */
export function useWorkResourceNavigation(kind: WorkResourceKind, ownerId: string) {
    const host = useUnifiedPanelHost();
    const context = useContext(WorkResourceNavigationContext);
    const scopeId = context?.scopeId ?? ownerId;
    const path = context?.tab.workPath;
    const navigate = useCallback((hash: string) => {
        const route = parseWorkResourceRoute(hash);
        if (!route) return;
        // Links inside a member keep the group's hosting workspace.
        const next = { ...route, scopeId };
        openWorkResourceRoute(next, host?.chatId ?? null);
        window.location.hash = buildWorkResourceHash(scopeId, route.kind, route.ownerId, route.path);
    }, [scopeId, host?.chatId]);
    return { path, navigate, listHash: buildWorkResourceHash(scopeId, kind, ownerId) };
}
