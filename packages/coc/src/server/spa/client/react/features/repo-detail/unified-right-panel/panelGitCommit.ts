/**
 * panelGitCommit — open one commit in the workspace's split Git detail (the
 * unified right panel's Git tab) without leaving the current surface.
 *
 * Generic hash navigation switches the workspace sub-tab, so callers that
 * must keep the chat or rail on screen publish the Git route in place:
 * `replaceState` the URL, remember the route suffix, and dispatch the atomic
 * `SET_GIT_ROUTE` the router would have produced. The mounted `RepoGitTab` (or
 * group member host) then selects the commit and opens its panel tab.
 */

import type { GitCommit } from '@plusplusoneplusplus/coc-client';
import type { AppAction } from '../../../contexts/AppContext';
import { buildGitRouteHash, buildGitRouteSuffix } from '../../../layout/gitRoute';
import { isRepoGroupWorkspaceId } from '../../../repos/virtualWorkspaceIds';
import type { UnifiedPanelHost } from './unifiedPanelHost';
import { routingRefForPanelOwner } from './unifiedPanelOwnerRouting';

export interface PanelGitCommitTarget {
    /** Workspace that owns the page: the group selection id, or the repo itself. */
    routeWorkspaceId: string;
    /** Workspace that owns the git data (the group member, or the repo). */
    workspaceId: string;
    /** Concrete clone owner of the git data (remote clone key or local id). */
    sourceSelectionId: string;
}

export function openPanelGitCommit(
    dispatch: (action: AppAction) => void,
    { routeWorkspaceId, workspaceId, sourceSelectionId }: PanelGitCommitTarget,
    commitHash: string,
    knownCommit?: GitCommit,
): void {
    const route = { routeWorkspaceId, workspaceId, commitHash, filePath: null };
    const routeSelectionId = routeWorkspaceId === workspaceId ? sourceSelectionId : routeWorkspaceId;
    window.history.replaceState(null, '', buildGitRouteHash({ ...route, routeWorkspaceId: routeSelectionId }));
    dispatch({ type: 'RECORD_REPO_ROUTE_SUFFIX', repoId: routeSelectionId, suffix: buildGitRouteSuffix(route) });
    dispatch({ type: 'SET_GIT_ROUTE', ...route, ...(knownCommit ? { knownCommit: { sourceSelectionId, commit: knownCommit } } : {}) });
}

/**
 * The panel Git target for a chat's own commits, or null when the hosting
 * panel cannot show them: a group-level chat names no member repo, and a repo
 * panel only hosts its own repository.
 */
export function chatCommitPanelTarget(
    host: UnifiedPanelHost,
    chatWorkspaceId: string | undefined,
): PanelGitCommitTarget | null {
    if (!chatWorkspaceId || isRepoGroupWorkspaceId(chatWorkspaceId)) return null;
    if (isRepoGroupWorkspaceId(host.workspaceId)) {
        return {
            routeWorkspaceId: host.routingRef ?? host.workspaceId,
            workspaceId: chatWorkspaceId,
            sourceSelectionId: routingRefForPanelOwner(host.routingRef, chatWorkspaceId) ?? chatWorkspaceId,
        };
    }
    if (chatWorkspaceId !== host.workspaceId) return null;
    return {
        routeWorkspaceId: host.workspaceId,
        workspaceId: host.workspaceId,
        sourceSelectionId: host.routingRef ?? host.workspaceId,
    };
}
