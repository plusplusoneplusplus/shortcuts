import { useCallback } from 'react';
import type { AppContextState } from '../contexts/AppContext';
import { useApp } from '../contexts/AppContext';
import { useQueue } from '../contexts/QueueContext';
import { buildRepoSubTabSuffix } from '../layout/Router';
import { confirmDiscardExplorerEditsOnSwitch } from '../features/repo-detail/explorer/explorerDirtyStore';
import type { RepoSubTab } from '../types/dashboard';

/** How to resolve the destination sub-route when navigating to a scope. */
export interface WorkspaceNavOptions {
    /**
     * An explicit "open this workspace on this tab" request. Wins over the
     * target's remembered route/tab. Use only when the action genuinely targets
     * a specific tab (e.g. a sub-tab click), never as a plain default.
     */
    subTabOverride?: RepoSubTab;
    /**
     * The target scope's first-visit landing tab, used only when the target has
     * no remembered full route and no remembered top-level tab. A fallback, not
     * an override — it never masks remembered state. Defaults to `chats`.
     */
    firstVisitTab?: RepoSubTab;
}

/**
 * Resolve the route suffix for navigating to workspace `id`, honoring the scope-
 * independent precedence (each scope owns its own remembered state):
 *   1. an explicit caller sub-tab override,
 *   2. the target's remembered full route suffix (`repoRouteState`),
 *   3. the target's remembered top-level tab (`repoTabState`),
 *   4. the caller-supplied first-visit landing tab (default `chats`).
 *
 * Fallback suffixes (3/4) are built from the *target id's* note-path and task
 * selection so a rebuilt suffix stays owned by the target scope, never the
 * departing one.
 */
export function resolveWorkspaceRouteSuffix(
    state: AppContextState,
    selectedTaskIdByRepo: Record<string, string | null> | undefined,
    id: string,
    options?: WorkspaceNavOptions,
): string {
    const { subTabOverride, firstVisitTab } = options ?? {};
    // A remembered full route wins verbatim unless the caller explicitly targets
    // a tab — never downgrade a deep route to a top-level tab.
    if (!subTabOverride) {
        const rememberedRoute = state.repoRouteState?.[id];
        if (rememberedRoute) return rememberedRoute;
    }
    const subTab = subTabOverride ?? state.repoTabState?.[id] ?? firstVisitTab ?? 'chats';
    const selectedTaskId = selectedTaskIdByRepo?.[id] ?? null;
    return buildRepoSubTabSuffix(
        subTab,
        { ...state, selectedNotePath: state.notePathState?.[id] ?? null },
        selectedTaskId,
    );
}

export function useWorkspaceNavigation() {
    const { state, dispatch } = useApp();
    const { state: queueState } = useQueue();

    const navigateToWorkspace = useCallback((id: string, options?: WorkspaceNavOptions) => {
        // Prompt before leaving a workspace whose explorer has unsaved edits (AC-03).
        if (!confirmDiscardExplorerEditsOnSwitch(state.selectedRepoId, id)) return;
        dispatch({ type: 'SET_ACTIVE_TAB', tab: 'repos' });
        dispatch({ type: 'SET_SELECTED_REPO', id });
        const suffix = resolveWorkspaceRouteSuffix(state, queueState.selectedTaskIdByRepo, id, options);
        location.hash = '#repos/' + encodeURIComponent(id) + suffix;
    }, [dispatch, queueState.selectedTaskIdByRepo, state]);

    return { navigateToWorkspace };
}
