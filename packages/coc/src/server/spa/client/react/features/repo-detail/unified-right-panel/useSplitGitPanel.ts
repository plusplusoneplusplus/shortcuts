import { useCallback, useEffect, useRef, useState } from 'react';
import { persistGitView, persistedViewIdentity } from '../../git/repoGitTab/selectionModel';
import type { PersistedGitView, RightPanelView } from '../../git/repoGitTab/types';
import { getUnifiedGitTabDirtyBridge } from './unifiedGitTabHost';
import { formatCocAddress, parseCocAddress, type CocAddress } from './unifiedPanelAddresses';
import { openPanelWorkspaceResource } from './unifiedPanelWorkspaceResources';
import { findTab, unifiedTabId, updateBrowserTab } from './unifiedPanelTabsModel';
import { updateUnifiedPanelState } from './unifiedPanelOpen';
import { useUnifiedPanelState } from './unifiedPanelStore';
import { useUnifiedGitTabHost } from './unifiedGitTabHost';

interface SplitGitPanelOptions {
    scopeWorkspaceId: string;
    ownerRoutingRef?: string | null;
    /** Undefined for a standalone repo; a group must name its selected data member. */
    memberId?: string;
    enabled: boolean;
}

/** The workspace-scoped `coc://git` page tab's id — one per panel scope, shared by every chat. */
function gitPageTabId(scopeWorkspaceId: string, ownerRoutingRef: string | null | undefined): string {
    return unifiedTabId({
        kind: 'browser', ownerWorkspaceId: scopeWorkspaceId, ownerRoutingRef, chatId: null, resourceId: 'coc-git',
    });
}

/** The `{ gitMemberId, view }` a `coc://git` tab's current address names, or null. */
function gitAddressOf(browserUrl: string | undefined): Extract<CocAddress, { kind: 'git' }> | null {
    if (!browserUrl) return null;
    const address = parseCocAddress(browserUrl);
    return 'error' in address || address.kind !== 'git' ? null : address;
}

/**
 * The workspace's `coc://git` page tab's current address, so a host (a repo
 * group resolving which member to show) can read the explicit member/view a
 * link or a prior open named, without duplicating the tab lookup.
 */
export function useGitPageTabAddress(
    scopeWorkspaceId: string,
    ownerRoutingRef?: string | null,
): Extract<CocAddress, { kind: 'git' }> | null {
    const [state] = useUnifiedPanelState(scopeWorkspaceId);
    const tab = findTab(state, gitPageTabId(scopeWorkspaceId, ownerRoutingRef));
    return gitAddressOf(tab?.browserUrl);
}

/**
 * Point the workspace's open `coc://git` page at `memberId`'s plain history,
 * in place: no tab is created, focused or revealed. A no-op with no Git page
 * open, where the host's remembered member already decides what to show.
 */
export function setGitPageMember(scopeWorkspaceId: string, ownerRoutingRef: string | null | undefined, memberId: string): void {
    const id = gitPageTabId(scopeWorkspaceId, ownerRoutingRef);
    updateUnifiedPanelState(scopeWorkspaceId, prev => updateBrowserTab(prev, id, {
        url: formatCocAddress({ kind: 'git', gitMemberId: memberId }),
    }));
}

/**
 * Shared desktop Git-tab lifecycle for ordinary repos and repo groups.
 *
 * The Git detail lives in the workspace's single `coc://git` page tab —
 * shared by every chat, exactly like Notes — so there is no chat-owned tab to
 * look up: `scopeWorkspaceId` (plus `ownerRoutingRef`) names the one tab, and
 * its own `browserUrl` address carries the member and view instead of a
 * dedicated tab field.
 */
export function useSplitGitPanel({
    scopeWorkspaceId, ownerRoutingRef, memberId, enabled,
}: SplitGitPanelOptions) {
    const host = useUnifiedGitTabHost(scopeWorkspaceId);
    const [state] = useUnifiedPanelState(scopeWorkspaceId);
    const tabId = gitPageTabId(scopeWorkspaceId, ownerRoutingRef);
    const tab = findTab(state, tabId);
    const address = gitAddressOf(tab?.browserUrl);
    const memberMatches = address?.gitMemberId === memberId;

    // What the detail last asked the tab to show (`onViewChange`), so a
    // self-echo of that write (the tab's address updating to reflect it) is
    // never mistaken for an external open (`panelGitCommit.ts`, a chat commit
    // chip, a blame click, `revealView`).
    // Seeded lazily from whatever the tab already shows on first render, so
    // mounting onto an existing page is not itself treated as an external open.
    const writtenAddressRef = useRef<string | null | undefined>(undefined);
    if (writtenAddressRef.current === undefined) writtenAddressRef.current = tab?.browserUrl ?? null;
    const [externalToken, setExternalToken] = useState(0);
    useEffect(() => {
        const current = tab?.browserUrl ?? null;
        if (current === writtenAddressRef.current) return;
        writtenAddressRef.current = current;
        setExternalToken(value => value + 1);
    }, [tab?.browserUrl]);

    // Open (or focus) the workspace's Git page on `gitView` and reveal the panel.
    const revealView = useCallback((gitView: PersistedGitView) => {
        openPanelWorkspaceResource('git', { workspaceId: scopeWorkspaceId, routingRef: ownerRoutingRef ?? null, chatId: null },
            { gitMemberId: memberId, view: gitView });
    }, [scopeWorkspaceId, ownerRoutingRef, memberId]);

    const openView = useCallback((view: RightPanelView | null) => {
        if (!enabled || !view) return;
        const gitView = persistGitView(view);
        if (memberMatches && address && persistedViewIdentity(gitView) === persistedViewIdentity(address.view)) return;
        writtenAddressRef.current = formatCocAddress({ kind: 'git', ...(memberId === undefined ? {} : { gitMemberId: memberId }), view: gitView });
        revealView(gitView);
    }, [enabled, memberMatches, address, memberId, revealView]);

    // The detail reports its unsaved edits to whichever Git tab body is mounted
    // now, so closing that tab prompts like any dirty editor tab.
    const onDetailDirtyChange = useCallback((isDirty: boolean) => {
        getUnifiedGitTabDirtyBridge(scopeWorkspaceId)?.onDirtyChange(isDirty);
    }, [scopeWorkspaceId]);
    const onDetailRegisterSave = useCallback((save: (() => Promise<boolean>) | null) => {
        getUnifiedGitTabDirtyBridge(scopeWorkspaceId)?.onRegisterSave(save);
    }, [scopeWorkspaceId]);

    return {
        onDetailDirtyChange: enabled ? onDetailDirtyChange : undefined,
        onDetailRegisterSave: enabled ? onDetailRegisterSave : undefined,
        detailContainer: enabled ? host : null,
        detailActive: enabled,
        onViewChange: enabled ? openView : undefined,
        /**
         * Explicit opens from other surfaces: focus the tab even when it
         * already shows `gitView`. A changed address counts as an external
         * open, so the detail switches to it.
         */
        revealView: enabled ? revealView : undefined,
        detailOpen: enabled ? !!tab && memberMatches : undefined,
        restoreView: enabled && memberMatches ? address?.view : undefined,
        /**
         * Changes only when the tab's address changed for a reason other than
         * the detail's own `onViewChange` write — i.e. a genuine external open. `RepoGitTab`
         * treats any change as "re-apply `restoreView`", the same contract a
         * chat switch used under the old chat-owned tab.
         */
        viewScopeKey: enabled ? `${memberId ?? ''}:${externalToken}` : undefined,
    };
}
