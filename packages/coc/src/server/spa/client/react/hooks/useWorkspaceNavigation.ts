import { useCallback } from 'react';
import type { AppContextState } from '../contexts/AppContext';
import { useApp } from '../contexts/AppContext';
import { useQueue } from '../contexts/QueueContext';
import { buildRepoSubTabSuffix } from '../layout/Router';
import type { RepoSubTab } from '../types/dashboard';

export function resolveWorkspaceRouteSuffix(
    state: AppContextState,
    selectedTaskIdByRepo: Record<string, string | null> | undefined,
    id: string,
    subTabOverride?: RepoSubTab,
): string {
    const rememberedRoute = subTabOverride ? null : state.repoRouteState?.[id];
    if (rememberedRoute) return rememberedRoute;
    const subTab = subTabOverride ?? state.repoTabState?.[id] ?? 'chats';
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

    const navigateToWorkspace = useCallback((id: string, subTabOverride?: RepoSubTab) => {
        dispatch({ type: 'SET_ACTIVE_TAB', tab: 'repos' });
        dispatch({ type: 'SET_SELECTED_REPO', id });
        const suffix = resolveWorkspaceRouteSuffix(state, queueState.selectedTaskIdByRepo, id, subTabOverride);
        location.hash = '#repos/' + encodeURIComponent(id) + suffix;
    }, [dispatch, queueState.selectedTaskIdByRepo, state]);

    return { navigateToWorkspace };
}
