/**
 * useShellNavigation — selection + sub-tab routing for the remote-first shell.
 *
 * Reuses the exact hash-routing the classic nav uses (buildRepoSubTabSuffix),
 * so the new shell stays interoperable with deep links and the Router.
 */

import { useCallback } from 'react';
import { useApp } from '../../contexts/AppContext';
import { useQueue } from '../../contexts/QueueContext';
import { buildRepoSubTabSuffix } from '../../layout/Router';
import { useWorkspaceNavigation } from '../../hooks/useWorkspaceNavigation';
import type { RepoSubTab } from '../../types/dashboard';

export interface ShellNavigation {
    /**
     * Select a clone (workspace). Restores the *target* scope's own remembered
     * full route (else its remembered top-level tab, else its first-visit
     * default) — the departing scope's active sub-tab is never carried across.
     * Pass `subTabOverride` only for an explicit "open this workspace on this
     * tab" action.
     */
    selectClone: (id: string, subTabOverride?: RepoSubTab) => void;
    /** Switch the active sub-tab for the currently selected clone. */
    switchSubTab: (tab: RepoSubTab) => void;
}

export function useShellNavigation(): ShellNavigation {
    const { state, dispatch } = useApp();
    const { state: queueState } = useQueue();
    const { navigateToWorkspace } = useWorkspaceNavigation();

    const navigate = useCallback((id: string, subTab: RepoSubTab) => {
        const selectedTaskId = queueState.selectedTaskIdByRepo?.[id] ?? null;
        const suffix = buildRepoSubTabSuffix(
            subTab,
            { ...state, selectedNotePath: state.notePathState?.[id] ?? null },
            selectedTaskId,
        );
        location.hash = '#repos/' + encodeURIComponent(id) + suffix;
    }, [queueState.selectedTaskIdByRepo, state]);

    const selectClone = useCallback((id: string, subTabOverride?: RepoSubTab) => {
        // Delegate to the shared, target-aware navigation: it restores the target
        // scope's remembered route/tab, activates the repos tab, runs the unsaved-
        // Explorer guard, and dispatches the selection — all exactly once.
        navigateToWorkspace(id, subTabOverride ? { subTabOverride } : undefined);
    }, [navigateToWorkspace]);

    const switchSubTab = useCallback((tab: RepoSubTab) => {
        // Switching a workspace sub-tab always means "show that workspace", so
        // pull back onto the repos tab. The shell header now renders on the
        // top-level pages (Admin / Settings / Wiki) too, where a sub-tab click
        // must navigate into the workspace rather than just flip the remembered
        // sub-tab. On the repos tab this is a no-op.
        dispatch({ type: 'SET_ACTIVE_TAB', tab: 'repos' });
        dispatch({ type: 'SET_REPO_SUB_TAB', tab });
        const id = state.selectedRepoId;
        if (id) navigate(id, tab);
    }, [dispatch, navigate, state.selectedRepoId]);

    return { selectClone, switchSubTab };
}
