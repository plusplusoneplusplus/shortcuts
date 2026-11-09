/**
 * unifiedPanelWorkspaceResources — the one way to open or focus a workspace's
 * resource tools. Notes and Settings belong to the panel workspace and are
 * `coc://notes[/<path>]` and `coc://settings` pages. WI/PR tabs
 * carry a concrete repo or group-member owner. The add-tab menu and
 * every link outside the panel build the same descriptor and land on the same
 * tab instead of switching a page-level view.
 */

import { useCallback } from 'react';
import { useAppOptional } from '../../../contexts/AppContext';
import { parseRemoteCloneKey } from '../../../repos/cloneIdentity';
import type { SettingsSection } from '../../../types/dashboard';
import type { PersistedGitView } from '../../git/repoGitTab/types';
import { openWorkspaceDock } from '../WorkspaceDockToggle';
import { updateUnifiedPanelState } from './unifiedPanelOpen';
import { useUnifiedPanelHost } from './unifiedPanelHost';
import { activeTabId, openTab, unifiedTabId, type OpenUnifiedTabInput } from './unifiedPanelTabsModel';
import { browserOpenInput, gitPageInput, notesPageInput, openCocPageTab } from './unifiedBrowserTabs';

export type PanelWorkspaceResourceKind = 'notes' | 'settings' | 'git' | 'work-items' | 'pull-requests';
type PanelTabResourceKind = Exclude<PanelWorkspaceResourceKind, 'settings' | 'notes' | 'git'>;

export interface PanelWorkspaceResourceOwner {
    /** The panel's scope and the resource owner: a raw repo or group workspace id. */
    workspaceId: string;
    /** Remote clone key of that workspace; null pins a local owner to the page origin. */
    routingRef: string | null;
    /** The chat the panel is showing, so the opened tab becomes its active tab. */
    chatId: string | null;
}

/** The owner named by a dashboard selection id (a raw id, or a remote clone key). */
export function panelOwnerForSelection(selectionId: string, chatId: string | null): PanelWorkspaceResourceOwner {
    const remote = parseRemoteCloneKey(selectionId);
    return { workspaceId: remote?.workspaceId ?? selectionId, routingRef: remote ? selectionId : null, chatId };
}

/** One workspace-owned tool descriptor, shared by the menu and external links. */
export function panelWorkspaceResourceInput(
    kind: PanelTabResourceKind,
    owner: PanelWorkspaceResourceOwner,
): OpenUnifiedTabInput {
    return {
        kind,
        ownerWorkspaceId: owner.workspaceId,
        ownerRoutingRef: owner.routingRef,
        chatId: owner.chatId,
        resourceId: kind,
        label: kind === 'work-items' ? 'Work Items' : 'Pull Requests',
    };
}

/** The panel workspace's `coc://notes` page, optionally opened on a note. */
export function panelNotesInput(owner: PanelWorkspaceResourceOwner, notePath?: string): OpenUnifiedTabInput {
    return notesPageInput({
        ownerWorkspaceId: owner.workspaceId,
        ownerRoutingRef: owner.routingRef,
        chatId: owner.chatId,
        browserChatId: null,
    }, notePath);
}

/** The panel workspace's `coc://settings` web tab. */
export function panelSettingsInput(owner: PanelWorkspaceResourceOwner): OpenUnifiedTabInput {
    return browserOpenInput({ ownerWorkspaceId: owner.workspaceId, ownerRoutingRef: owner.routingRef, chatId: owner.chatId }, 'coc://settings');
}

/** The panel workspace's `coc://git` page, optionally deep-linked to a member and/or view. */
export function panelGitInput(
    owner: PanelWorkspaceResourceOwner,
    address?: { gitMemberId?: string; view?: PersistedGitView },
): OpenUnifiedTabInput {
    return gitPageInput({
        ownerWorkspaceId: owner.workspaceId,
        ownerRoutingRef: owner.routingRef,
        chatId: owner.chatId,
    }, address);
}

/**
 * Open (or focus) `owner`'s resource tab and reveal its panel; returns the
 * tab id. A `notePath` selects that note in the Notes tab, mounted or not. A
 * `gitMemberId`/`view` deep-links the Git page, mounted or not.
 */
export function openPanelWorkspaceResource(
    kind: PanelWorkspaceResourceKind,
    owner: PanelWorkspaceResourceOwner,
    options: { notePath?: string; gitMemberId?: string; view?: PersistedGitView } = {},
): string {
    let id = '';
    if (kind === 'settings') {
        const input = panelSettingsInput(owner);
        updateUnifiedPanelState(owner.workspaceId, prev => {
            const opened = openCocPageTab(prev, input);
            id = activeTabId(opened, owner.chatId) ?? '';
            return opened;
        });
    } else if (kind === 'notes') {
        const input = panelNotesInput(owner, options.notePath);
        updateUnifiedPanelState(owner.workspaceId, prev => {
            const opened = openTab(prev, input);
            id = activeTabId(opened, owner.chatId) ?? unifiedTabId(input);
            return opened;
        });
    } else if (kind === 'git') {
        // Like Notes (and unlike the focus-only `openCocPageTab`), every open
        // must land its address on the tab even when one is already open —
        // switching commit, member or view while the page is already showing
        // is the common case, not just the first open.
        const input = panelGitInput(owner, { gitMemberId: options.gitMemberId, view: options.view });
        updateUnifiedPanelState(owner.workspaceId, prev => {
            const opened = openTab(prev, input);
            id = activeTabId(opened, owner.chatId) ?? unifiedTabId(input);
            return opened;
        });
    } else {
        const input = panelWorkspaceResourceInput(kind, owner);
        id = unifiedTabId(input);
        updateUnifiedPanelState(owner.workspaceId, prev => openTab(prev, input));
    }
    openWorkspaceDock(owner.workspaceId);
    return id;
}

export interface PanelWorkspaceResourceOptions {
    notePath?: string;
    settingsSection?: SettingsSection;
}

/**
 * An opener for Notes/Settings in the panel hosting this subtree, or null when
 * `workspaceId` (a raw repo/group id) does not own that panel. A link for
 * another workspace (a group member, a panel-less mobile host) is then not
 * offered, rather than opening a tab for the wrong owner.
 */
export function usePanelWorkspaceResourceOpener(
    workspaceId: string | null | undefined,
): ((kind: PanelWorkspaceResourceKind, options?: PanelWorkspaceResourceOptions) => void) | null {
    const host = useUnifiedPanelHost();
    const dispatch = useAppOptional()?.dispatch;
    const open = useCallback((kind: PanelWorkspaceResourceKind, options: PanelWorkspaceResourceOptions = {}) => {
        if (!host) return;
        if (kind === 'settings' && options.settingsSection) dispatch?.({ type: 'SET_SETTINGS_SECTION', section: options.settingsSection });
        openPanelWorkspaceResource(kind, { workspaceId: host.workspaceId, routingRef: host.routingRef ?? null, chatId: host.chatId },
            { notePath: options.notePath });
    }, [host, dispatch]);
    return host && workspaceId && host.workspaceId === workspaceId ? open : null;
}
