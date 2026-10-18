/**
 * Notes and Settings open only as owner-qualified right-panel tabs: the add-tab
 * menu and links outside the panel share one descriptor, so they focus the same
 * tab, select the right note, reveal the dock, and never target another owner.
 *
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act, cleanup, renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';

import {
    openPanelWorkspaceResource,
    panelOwnerForSelection,
    panelWorkspaceResourceInput,
    usePanelWorkspaceResourceOpener,
} from '../../../../src/server/spa/client/react/features/repo-detail/unified-right-panel/unifiedPanelWorkspaceResources';
import { UnifiedPanelHostProvider } from '../../../../src/server/spa/client/react/features/repo-detail/unified-right-panel/unifiedPanelHost';
import {
    clearUnifiedPanelState,
    readUnifiedPanelState,
} from '../../../../src/server/spa/client/react/features/repo-detail/unified-right-panel/unifiedPanelStore';
import { closeTab, unifiedTabId } from '../../../../src/server/spa/client/react/features/repo-detail/unified-right-panel/unifiedPanelTabsModel';
import { updateUnifiedPanelState } from '../../../../src/server/spa/client/react/features/repo-detail/unified-right-panel/unifiedPanelOpen';
import { workspaceDockOpenStorageKey } from '../../../../src/server/spa/client/react/features/repo-detail/WorkspaceDockToggle';
import { AppProvider, useApp } from '../../../../src/server/spa/client/react/contexts/AppContext';

const REMOTE = 'remote:server-a:ws-a';

beforeEach(() => {
    localStorage.clear();
    clearUnifiedPanelState();
});
afterEach(cleanup);

describe('openPanelWorkspaceResource', () => {
    it('opens a workspace-owned Notes tab, activates it for the current chat and reveals the dock', () => {
        const id = openPanelWorkspaceResource('notes', { workspaceId: 'ws-a', routingRef: null, chatId: 'chat-1' });
        const state = readUnifiedPanelState('ws-a');
        expect(state.workspaceTabs).toEqual([expect.objectContaining({ id, kind: 'notes', ownerWorkspaceId: 'ws-a', chatId: null, label: 'Notes' })]);
        expect(state.activeByScope['chat-1']).toBe(id);
        expect(localStorage.getItem(workspaceDockOpenStorageKey('ws-a'))).toBe('1');
    });

    it('focuses the existing tab instead of duplicating it, and selects a requested note', () => {
        const owner = { workspaceId: 'ws-a', routingRef: null, chatId: null };
        const first = openPanelWorkspaceResource('notes', owner, { notePath: 'a.md' });
        const second = openPanelWorkspaceResource('notes', owner, { notePath: 'dir/b.md' });
        const state = readUnifiedPanelState('ws-a');
        expect(second).toBe(first);
        expect(state.workspaceTabs).toHaveLength(1);
        expect(state.workspaceTabs[0].notesView).toEqual({ notePath: 'dir/b.md' });
    });

    it('reopens a closed Settings tab with the same identity', () => {
        const owner = { workspaceId: 'ws-a', routingRef: null, chatId: null };
        const id = openPanelWorkspaceResource('settings', owner);
        updateUnifiedPanelState('ws-a', prev => closeTab(prev, id));
        expect(readUnifiedPanelState('ws-a').workspaceTabs).toHaveLength(0);
        expect(openPanelWorkspaceResource('settings', owner)).toBe(id);
        expect(readUnifiedPanelState('ws-a').workspaceTabs.map(tab => tab.kind)).toEqual(['settings']);
    });

    it('keeps local and remote Settings owners distinct and matches the add-tab menu descriptor', () => {
        const local = openPanelWorkspaceResource('settings', { workspaceId: 'ws-a', routingRef: null, chatId: null });
        const remote = openPanelWorkspaceResource('settings', panelOwnerForSelection(REMOTE, null));
        expect(remote).not.toBe(local);
        const tabs = readUnifiedPanelState('ws-a').workspaceTabs;
        expect(tabs.map(tab => tab.ownerRoutingRef)).toEqual([null, REMOTE]);
        expect(remote).toBe(unifiedTabId(panelWorkspaceResourceInput('settings', { workspaceId: 'ws-a', routingRef: REMOTE, chatId: 'any' })));
    });

    it('derives a group owner from its selection id', () => {
        expect(panelOwnerForSelection('group-docs', 'c')).toEqual({ workspaceId: 'group-docs', routingRef: null, chatId: 'c' });
        expect(panelOwnerForSelection('remote:server-a:group-docs', null))
            .toEqual({ workspaceId: 'group-docs', routingRef: 'remote:server-a:group-docs', chatId: null });
    });
});

describe('usePanelWorkspaceResourceOpener', () => {
    function hostWrapper(host: { workspaceId: string; chatId: string | null; routingRef?: string | null } | null) {
        return ({ children }: { children: ReactNode }) => (
            <AppProvider><UnifiedPanelHostProvider host={host}>{children}</UnifiedPanelHostProvider></AppProvider>
        );
    }

    it('opens Settings on a section in the hosting panel for its own workspace', () => {
        const { result } = renderHook(() => ({ open: usePanelWorkspaceResourceOpener('ws-a'), app: useApp() }), {
            wrapper: hostWrapper({ workspaceId: 'ws-a', chatId: 'chat-1', routingRef: REMOTE }),
        });
        act(() => result.current.open!('settings', { settingsSection: 'preferences' }));
        expect(result.current.app.state.settingsSection).toBe('preferences');
        const [tab] = readUnifiedPanelState('ws-a').workspaceTabs;
        expect(tab).toMatchObject({ kind: 'settings', ownerWorkspaceId: 'ws-a', ownerRoutingRef: REMOTE });
        expect(readUnifiedPanelState('ws-a').activeByScope['chat-1']).toBe(tab.id);
    });

    it('offers nothing for another workspace or without a hosting panel', () => {
        expect(renderHook(() => usePanelWorkspaceResourceOpener('member-repo'), {
            wrapper: hostWrapper({ workspaceId: 'group-docs', chatId: null }),
        }).result.current).toBeNull();
        expect(renderHook(() => usePanelWorkspaceResourceOpener('ws-a'), { wrapper: hostWrapper(null) }).result.current).toBeNull();
    });
});
