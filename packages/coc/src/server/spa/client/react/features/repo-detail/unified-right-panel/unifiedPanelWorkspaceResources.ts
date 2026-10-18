/**
 * unifiedPanelWorkspaceResources — the one way to open or focus a workspace's
 * resource tools. Notes/Settings belong to the panel workspace; WI/PR tabs
 * carry a concrete repo or group-member owner. The add-tab menu and
 * every link outside the panel build the same descriptor and land on the same
 * tab instead of switching a page-level view.
 */

import { useCallback } from 'react';
import { useAppOptional } from '../../../contexts/AppContext';
import { parseRemoteCloneKey } from '../../../repos/cloneIdentity';
import type { SettingsSection } from '../../../types/dashboard';
import { openWorkspaceDock } from '../WorkspaceDockToggle';
import { updateUnifiedPanelState } from './unifiedPanelOpen';
import { useUnifiedPanelHost } from './unifiedPanelHost';
import { openTab, unifiedTabId, updateNotesView, type OpenUnifiedTabInput } from './unifiedPanelTabsModel';

export type PanelWorkspaceResourceKind = 'notes' | 'settings' | 'work-items' | 'pull-requests';

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
    kind: PanelWorkspaceResourceKind,
    owner: PanelWorkspaceResourceOwner,
): OpenUnifiedTabInput {
    return {
        kind,
        ownerWorkspaceId: owner.workspaceId,
        ...(kind !== 'notes' ? { ownerRoutingRef: owner.routingRef } : {}),
        chatId: owner.chatId,
        resourceId: kind,
        label: kind === 'settings' ? 'Settings' : kind === 'notes' ? 'Notes' : kind === 'work-items' ? 'Work Items' : 'Pull Requests',
    };
}

/**
 * Open (or focus) `owner`'s resource tab and reveal its panel. A
 * `notePath` selects that note in the Notes tab, mounted or not.
 */
export function openPanelWorkspaceResource(
    kind: PanelWorkspaceResourceKind,
    owner: PanelWorkspaceResourceOwner,
    options: { notePath?: string } = {},
): string {
    const input = panelWorkspaceResourceInput(kind, owner);
    const id = unifiedTabId(input);
    updateUnifiedPanelState(owner.workspaceId, prev => {
        const opened = openTab(prev, input);
        return kind === 'notes' && options.notePath ? updateNotesView(opened, id, options.notePath) : opened;
    });
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
