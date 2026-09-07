/**
 * VirtualWorkspaceMobileTabBar — the mobile header for a virtual workspace
 * (repo group / My Work / My Life).
 *
 * Repos have had `MobileTabBar` with a back-to-list leading slot for a while;
 * virtual workspaces rendered `VirtualWorkspaceInlineHeader` instead, which has
 * no back affordance at all — so a mobile user who landed on a repo group was
 * stuck there. This gives every workspace kind the same mobile skin: three
 * pinned tabs plus `···`, and a leading slot that returns to the scope list.
 *
 * Tabs and actions still come from the shared `VirtualWorkspaceHeaderConfig`, so
 * the mobile and desktop headers cannot list different tabs.
 */
import { useMemo } from 'react';
import { useApp } from '../../contexts/AppContext';
import { MobileTabBar, type MobileTabBarAction } from '../../layout/MobileTabBar';
import type { RepoSubTab } from '../../types/dashboard';
import { useVirtualWorkspaceHeader } from './useVirtualWorkspaceHeader';
import type { VirtualWorkspaceHeaderConfig } from './virtualWorkspaceHeader';

export interface VirtualWorkspaceMobileTabBarProps {
    config: VirtualWorkspaceHeaderConfig;
    /**
     * Which tabs stay inline; the rest fold into `···`. Defaults to the first
     * three visible tabs, which is the right answer for a repo group
     * (Workspace · Git · Notes, with Settings in the overflow).
     */
    pinnedTabs?: RepoSubTab[];
}

export function VirtualWorkspaceMobileTabBar({ config, pinnedTabs }: VirtualWorkspaceMobileTabBarProps) {
    const { dispatch } = useApp();
    const { visibleTabs, activeTab, switchTab, statusMsg, isActionRunning, runAction } = useVirtualWorkspaceHeader(config);
    const prefix = config.testIdPrefix;

    const tabs = useMemo(() => visibleTabs.map(t => ({ key: t.key, label: t.label })), [visibleTabs]);
    const pinned = useMemo(
        () => pinnedTabs ?? visibleTabs.slice(0, 3).map(t => t.key),
        [pinnedTabs, visibleTabs],
    );

    // Header actions (Sync / Generate) have no room of their own at this width,
    // so they join the `···` sheet above the overflow tabs. A running action
    // shows its busy label rather than being hidden, matching the desktop button.
    const actions = useMemo<MobileTabBarAction[]>(
        () => config.actions.map(action => ({
            label: isActionRunning(action.key) ? action.busyLabel : action.idleLabel,
            onClick: () => { void runAction(action); },
        })),
        [config.actions, isActionRunning, runAction],
    );

    const leadingSlot = (
        <button
            className="flex items-center gap-1 min-w-0 w-full text-left group touch-target"
            onClick={() => { dispatch({ type: 'SET_SELECTED_REPO', id: null }); location.hash = ''; }}
            aria-label={`Back to workspaces from ${config.label}`}
            data-testid={`${prefix}-name-back`}
        >
            <span aria-hidden className="text-[10px] flex-shrink-0">{config.icon}</span>
            <h1 className="text-[10px] font-semibold text-[#1e1e1e] dark:text-[#cccccc] truncate group-active:opacity-70 min-w-0">{config.label}</h1>
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-3 h-3 flex-shrink-0 text-[#999999] dark:text-[#666666]">
                <path strokeLinecap="round" strokeLinejoin="round" d="m19.5 8.25-7.5 7.5-7.5-7.5" />
            </svg>
        </button>
    );

    return (
        <div data-testid={`${prefix}-mobile-header`}>
            <MobileTabBar
                activeTab={activeTab}
                onTabChange={switchTab}
                tabs={tabs}
                pinnedTabs={pinned}
                actions={actions}
                leadingSlot={leadingSlot}
            />
            {statusMsg && (
                <div
                    className="px-3 py-1 text-[11px] text-[#666] dark:text-[#999] border-b border-[#e0e0e0] dark:border-[#3c3c3c] truncate"
                    data-testid={`${prefix}-status`}
                >
                    {statusMsg}
                </div>
            )}
        </div>
    );
}
