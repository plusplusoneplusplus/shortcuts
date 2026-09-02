/**
 * useVirtualWorkspaceHeader — shared state/behaviour for the virtual-workspace
 * shell headers (My Work / My Life), used by both `VirtualWorkspaceShellHeader`
 * (remote-first desktop TopBar) and `VirtualWorkspaceInlineHeader` (classic shell
 * / mobile). Encapsulates sub-tab visibility, active-tab resolution, tab
 * navigation, and running the header action buttons (sync / generate) with their
 * busy + status-message state.
 */
import { useCallback, useMemo, useState } from 'react';
import { useApp } from '../../contexts/AppContext';
import { useQueue } from '../../contexts/QueueContext';
import { buildWorkspaceSubTabSuffix } from '../../layout/Router';
import { useSchedulesInScheduledSlideEnabled } from '../../hooks/feature-flags/useSchedulesInScheduledSlideEnabled';
import type { RepoSubTab } from '../../types/dashboard';
import type {
    VirtualWorkspaceHeaderAction,
    VirtualWorkspaceHeaderConfig,
    VirtualWorkspaceHeaderTab,
} from './virtualWorkspaceHeader';

/** How long a success status message stays visible before auto-clearing. */
const STATUS_CLEAR_MS = 4000;

export interface VirtualWorkspaceHeaderState {
    visibleTabs: VirtualWorkspaceHeaderTab[];
    activeTab: RepoSubTab;
    switchTab: (tab: RepoSubTab) => void;
    statusMsg: string | null;
    isActionRunning: (key: string) => boolean;
    runAction: (action: VirtualWorkspaceHeaderAction) => Promise<void>;
}

export function useVirtualWorkspaceHeader(config: VirtualWorkspaceHeaderConfig): VirtualWorkspaceHeaderState {
    const { state, dispatch } = useApp();
    const { state: queueState } = useQueue();
    const schedulesInScheduledSlideEnabled = useSchedulesInScheduledSlideEnabled();

    // Hide the standalone Schedules tab when schedule management has moved into
    // the chat-list "Scheduled" slide (feature flag). The Activity tab reuses
    // RepoChatTab, which hosts that slide, so nothing is stranded.
    const visibleTabs = useMemo(
        () => (schedulesInScheduledSlideEnabled ? config.tabs.filter(t => t.key !== 'schedules') : config.tabs),
        [schedulesInScheduledSlideEnabled, config.tabs],
    );

    // Fall back to the config's landing tab (default `notes`) when the current
    // sub-tab is not one of the visible tabs. Guard the fallback against being a
    // hidden tab so we never land on something the header doesn't show.
    const fallbackTab: RepoSubTab =
        config.defaultTab && visibleTabs.some(t => t.key === config.defaultTab)
            ? config.defaultTab
            : 'notes';
    const activeTab: RepoSubTab = visibleTabs.some(t => t.key === state.activeRepoSubTab)
        ? state.activeRepoSubTab
        : fallbackTab;

    const switchTab = useCallback((tab: RepoSubTab) => {
        dispatch({ type: 'SET_REPO_SUB_TAB', tab });
        // Mirror useShellNavigation.navigate: build the hash suffix through
        // buildWorkspaceSubTabSuffix so each tab keeps its remembered detail (open
        // note, selected chat/task, open commit) instead of resetting to a bare
        // `/<tab>`. Resolve this workspace's remembered note path and selected
        // task the same way, so returning to Notes preserves the mounted view.
        const workspaceId = config.workspaceId;
        const selectedTaskId = queueState.selectedTaskIdByRepo?.[workspaceId] ?? null;
        const suffix = buildWorkspaceSubTabSuffix(
            workspaceId,
            tab,
            { ...state, selectedNotePath: state.notePathState?.[workspaceId] ?? state.selectedNotePath },
            selectedTaskId,
        );
        location.hash = '#repos/' + encodeURIComponent(workspaceId) + suffix;
    }, [dispatch, config.workspaceId, queueState.selectedTaskIdByRepo, state]);

    const [statusMsg, setStatusMsg] = useState<string | null>(null);
    const [runningKeys, setRunningKeys] = useState<ReadonlySet<string>>(() => new Set());

    const runAction = useCallback(async (action: VirtualWorkspaceHeaderAction) => {
        setRunningKeys(prev => new Set(prev).add(action.key));
        setStatusMsg(null);
        try {
            const msg = await action.run();
            if (msg !== null) {
                setStatusMsg(msg);
                setTimeout(() => setStatusMsg(null), STATUS_CLEAR_MS);
            }
        } catch (err) {
            const detail = err instanceof Error ? err.message : String(err);
            setStatusMsg(`${action.errorLabel}: ${detail}`);
        } finally {
            setRunningKeys(prev => {
                const next = new Set(prev);
                next.delete(action.key);
                return next;
            });
        }
    }, []);

    const isActionRunning = useCallback((key: string) => runningKeys.has(key), [runningKeys]);

    return { visibleTabs, activeTab, switchTab, statusMsg, isActionRunning, runAction };
}
