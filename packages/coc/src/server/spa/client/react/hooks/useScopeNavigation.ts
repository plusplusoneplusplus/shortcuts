import { useCallback } from 'react';
import { useApp } from '../contexts/AppContext';
import { buildNoteHash } from '../layout/dashboardRoutes';
import { MY_WORK_WORKSPACE_ID } from '../repos/MyWorkView';
import { MY_LIFE_WORKSPACE_ID } from '../repos/MyLifeView';

/**
 * Shared navigation for the virtual scopes (My Work / My Life). Single source
 * for the legacy 💼/🏠 TopBar toggles and the ScopeSlideSwitcher segments:
 * selects the virtual workspace and restores its last-viewed note path.
 */
export function useScopeNavigation() {
    const { state, dispatch } = useApp();
    const notePathState = state.notePathState;

    const goToVirtual = useCallback((workspaceId: string) => {
        const savedPath = notePathState?.[workspaceId];
        dispatch({ type: 'SET_ACTIVE_TAB', tab: 'repos' });
        dispatch({ type: 'SET_SELECTED_REPO', id: workspaceId });
        location.hash = savedPath
            ? buildNoteHash(workspaceId, savedPath)
            : '#repos/' + workspaceId + '/notes';
    }, [dispatch, notePathState]);

    const goToMyWork = useCallback(() => goToVirtual(MY_WORK_WORKSPACE_ID), [goToVirtual]);
    const goToMyLife = useCallback(() => goToVirtual(MY_LIFE_WORKSPACE_ID), [goToVirtual]);

    return { goToMyWork, goToMyLife };
}
