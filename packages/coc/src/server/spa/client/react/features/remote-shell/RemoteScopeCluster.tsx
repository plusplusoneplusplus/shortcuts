import { useMemo } from 'react';
import { useApp } from '../../contexts/AppContext';
import { useWorkItems } from '../../contexts/WorkItemContext';
import { useTerminalEnabled } from '../../hooks/feature-flags/useTerminalEnabled';
import { useNotesEnabled } from '../notes/hooks/useNotesEnabled';
import { useWorkflowsEnabled } from '../../hooks/feature-flags/useWorkflowsEnabled';
import { usePullRequestsEnabled } from '../../hooks/feature-flags/usePullRequestsEnabled';
import { useDreamsEnabled } from '../../hooks/feature-flags/useDreamsEnabled';
import { useNativeCliSessionsEnabled } from '../../hooks/feature-flags/useNativeCliSessionsEnabled';
import { useShowPlanDepTab } from '../../hooks/feature-flags/useShowPlanDepTab';
import { useUiLayoutMode } from '../../hooks/preferences/useUiLayoutMode';
import { computeVisibleSubTabs, type SubTabDef } from '../repo-detail/repoSubTabs';
import type { RepoData } from '../../repos/repoGrouping';
import { resolveRepoWorkItemOriginScope } from '../work-items/workItemOriginScope';
import type { RepoSubTab } from '../../types/dashboard';
import { partitionShellTabs } from './shellModel';
import { useShellNavigation } from './useShellNavigation';
import { WorkspaceIdentityChip } from './WorkspaceIdentityChip';

export interface RemoteScopeClusterProps {
    repo?: RepoData;
    repos: RepoData[];
    /**
     * Suppress the workspace identity chip when another control owns identity
     * (the ScopeSlideSwitcher renders the chip as its workspace segment);
     * the cluster then carries only the remote-scoped WI/PR tabs.
     */
    hideIdentity?: boolean;
}

export function RemoteScopeCluster({ repo, repos, hideIdentity }: RemoteScopeClusterProps) {
    const { state } = useApp();
    const { state: workItemState, dispatch: workItemDispatch } = useWorkItems();
    const { switchSubTab } = useShellNavigation();

    const terminalEnabled = useTerminalEnabled();
    const notesEnabled = useNotesEnabled();
    const workflowsEnabled = useWorkflowsEnabled();
    const pullRequestsEnabled = usePullRequestsEnabled();
    const dreamsEnabled = useDreamsEnabled();
    const nativeCliSessionsEnabled = useNativeCliSessionsEnabled();
    const showPlanDepTab = useShowPlanDepTab();
    const [uiLayoutMode] = useUiLayoutMode();
    const isGitRepo = !!repo?.gitInfo?.isGitRepo;
    // Only reflect an active sub-tab when we're actually on the repos tab. The
    // header also renders on the top-level pages (Admin / Settings / Wiki), where
    // no workspace sub-tab is being viewed — so WI/PR shouldn't highlight there.
    const activeTab = state.activeTab === 'repos' ? state.activeRepoSubTab : null;

    const tabs = useMemo(() => computeVisibleSubTabs({
        isGitRepo, terminalEnabled, notesEnabled, workflowsEnabled,
        pullRequestsEnabled, dreamsEnabled, nativeCliSessionsEnabled, showPlanDepTab, uiLayoutMode,
    }), [isGitRepo, terminalEnabled, notesEnabled, workflowsEnabled, pullRequestsEnabled, dreamsEnabled, nativeCliSessionsEnabled, showPlanDepTab, uiLayoutMode]);
    const { remote: remoteTabs } = useMemo(() => partitionShellTabs(tabs), [tabs]);
    const workItemOriginId = useMemo(() => repo ? resolveRepoWorkItemOriginScope(repo).originId : '', [repo]);
    const unseenWorkItemCount = repo ? (workItemState.unseenByRepo[workItemOriginId] || []).length : 0;

    const onRemoteTab = (key: RepoSubTab) => {
        if (key === 'work-items') workItemDispatch({ type: 'MARK_WORK_ITEMS_SEEN', repoId: workItemOriginId });
        switchSubTab(key);
    };

    const badge = (key: RepoSubTab) => {
        if (key === 'work-items' && unseenWorkItemCount > 0) {
            return <span data-testid="subbar-work-items-badge" className="ml-0.5 inline-flex items-center justify-center min-w-[18px] h-[17px] text-[10px] font-mono bg-[#0078d4] text-white px-1 rounded-full">{unseenWorkItemCount}</span>;
        }
        return null;
    };

    const renderRemoteTab = (tab: SubTabDef) => {
        const isActive = activeTab === tab.key;
        return (
            <button
                key={tab.key}
                data-testid="remote-scope-tab"
                data-subtab={tab.key}
                data-active={isActive ? 'true' : 'false'}
                aria-current={isActive ? 'page' : undefined}
                title={tab.shortcut}
                onClick={() => onRemoteTab(tab.key)}
                className={
                    'relative inline-flex items-center gap-1 h-[26px] px-2 rounded-md text-[12.5px] whitespace-nowrap shrink-0 transition-colors ' +
                    (isActive
                        ? 'font-bold text-[#0969da] dark:text-[#79c0ff] shadow-[inset_0_-2px_0_#0969da] dark:shadow-[inset_0_-2px_0_#3794ff]'
                        : 'font-semibold text-[#656d76] dark:text-[#999] hover:text-[#1f2328] dark:hover:text-[#cccccc] hover:bg-[#f6f8fa] dark:hover:bg-[#2a2a2a]')
                }
            >
                <span className="hidden xl:inline">{tab.label}</span>
                <span className="xl:hidden">{tab.key === 'work-items' ? 'WI' : tab.key === 'pull-requests' ? 'PR' : tab.label}</span>
                {badge(tab.key)}
            </button>
        );
    };

    // Identity suppressed and no tabs to show → nothing left to render (avoids
    // an empty bordered pill next to the switcher on non-repo pages).
    if (hideIdentity && (!repo || remoteTabs.length === 0)) return null;

    return (
        <div
            className="relative flex items-center gap-0.5 min-w-0 flex-shrink-0 rounded-md border border-[#d0d7de] dark:border-[#3c3c3c] bg-white/70 dark:bg-[#1e1e1e]/70 px-1"
            data-testid="remote-scope-cluster"
        >
            {!hideIdentity && <WorkspaceIdentityChip repo={repo} repos={repos} />}

            {repo && remoteTabs.map(renderRemoteTab)}
        </div>
    );
}
