import { useCallback } from 'react';
import { useWorkspaceNavigation } from './useWorkspaceNavigation';
import { useMyWorkTodayViewEnabled } from './feature-flags/useMyWorkTodayViewEnabled';
import { MY_WORK_WORKSPACE_ID } from '../repos/MyWorkView';
import { MY_LIFE_WORKSPACE_ID } from '../repos/MyLifeView';
import type { RepoSubTab } from '../types/dashboard';

/**
 * Shared navigation for the virtual scopes (My Work / My Life). Single source
 * for the legacy 💼/🏠 TopBar toggles and the ScopeSlideSwitcher segments.
 *
 * Each virtual scope is an independent navigation owner: switching to it restores
 * *its own* remembered full route (else its remembered top-level tab, else its
 * first-visit landing tab) through the shared target-aware workspace navigation.
 * The landing tab is only a first-visit fallback — a remembered Activity, Git,
 * Settings, Today, or deep note route for that scope always wins, and the
 * departing scope's active tab is never carried across.
 */
export function useScopeNavigation() {
    const { navigateToWorkspace } = useWorkspaceNavigation();
    const todayViewEnabled = useMyWorkTodayViewEnabled();

    const goToVirtual = useCallback((workspaceId: string, firstVisitTab: RepoSubTab) => {
        navigateToWorkspace(workspaceId, { firstVisitTab });
    }, [navigateToWorkspace]);

    // My Work's first-visit landing tab follows the `myWork.todayView` flag
    // (Today when on, else Notes); My Life always lands on Notes.
    const goToMyWork = useCallback(
        () => goToVirtual(MY_WORK_WORKSPACE_ID, todayViewEnabled ? 'today' : 'notes'),
        [goToVirtual, todayViewEnabled],
    );
    const goToMyLife = useCallback(() => goToVirtual(MY_LIFE_WORKSPACE_ID, 'notes'), [goToVirtual]);

    return { goToMyWork, goToMyLife };
}
