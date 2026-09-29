import { useCallback, useEffect } from 'react';
import { persistGitView, persistedViewIdentity } from '../../git/repoGitTab/selectionModel';
import type { RightPanelView } from '../../git/repoGitTab/types';
import { closeTab, findTab } from './unifiedPanelTabsModel';
import { updateUnifiedPanelState } from './unifiedPanelOpen';
import { openUnifiedGitTab, unifiedGitTabId, useUnifiedGitTab, useUnifiedGitTabHost } from './unifiedGitTabHost';

interface SplitGitPanelOptions {
    scopeWorkspaceId: string;
    ownerRoutingRef?: string | null;
    chatId: string | null;
    /** Undefined for a standalone repo; a group must name its selected data member. */
    memberId?: string;
    enabled: boolean;
}

/** Shared desktop Git-tab lifecycle for ordinary repos and repo groups. */
export function useSplitGitPanel({
    scopeWorkspaceId, ownerRoutingRef, chatId, memberId, enabled,
}: SplitGitPanelOptions) {
    const host = useUnifiedGitTabHost(scopeWorkspaceId);
    const tab = useUnifiedGitTab(scopeWorkspaceId, {
        ownerWorkspaceId: scopeWorkspaceId,
        ownerRoutingRef,
    });
    const tabId = unifiedGitTabId({ ownerWorkspaceId: scopeWorkspaceId, ownerRoutingRef });
    const memberMatches = tab?.gitMemberId === memberId;

    // A group member switch (including Back/Forward or an unavailable member)
    // must not leave the old repo's detail visible or restore its hash in a new repo.
    useEffect(() => {
        if (!enabled || !tab || memberMatches) return;
        updateUnifiedPanelState(scopeWorkspaceId, state => {
            const current = findTab(state, tabId);
            return current && current.gitMemberId !== memberId ? closeTab(state, tabId) : state;
        });
    }, [enabled, tab, memberMatches, scopeWorkspaceId, tabId, memberId]);

    const openView = useCallback((view: RightPanelView | null) => {
        if (!enabled || !view) return;
        const gitView = persistGitView(view);
        if (memberMatches && tab && persistedViewIdentity(gitView) === persistedViewIdentity(tab.gitView)) return;
        openUnifiedGitTab(scopeWorkspaceId, {
            ownerWorkspaceId: scopeWorkspaceId,
            ownerRoutingRef,
            chatId,
            gitView,
            ...(memberId === undefined ? {} : { gitMemberId: memberId }),
        });
    }, [enabled, memberMatches, tab, scopeWorkspaceId, ownerRoutingRef, chatId, memberId]);

    return {
        detailContainer: enabled ? host : null,
        detailActive: enabled,
        onViewChange: enabled ? openView : undefined,
        detailOpen: enabled ? !!tab && memberMatches : undefined,
        restoreView: enabled && memberMatches ? tab?.gitView : undefined,
    };
}
