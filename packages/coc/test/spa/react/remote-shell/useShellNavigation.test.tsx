/**
 * useShellNavigation — selection + sub-tab routing for the remote-first shell.
 *
 * Focus: switching a workspace sub-tab must pull back onto the repos tab. The
 * shell header now renders on the top-level pages (Admin / Settings / Wiki) too,
 * so a sub-tab click from there has to navigate into the workspace, not just flip
 * the remembered sub-tab.
 *
 * @vitest-environment jsdom
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';

const mockDispatch = vi.fn();
let mockState: any = { selectedRepoId: 'a', activeTab: 'repos', activeRepoSubTab: 'chats', notePathState: {}, repoRouteState: {}, repoTabState: {} };

vi.mock('../../../../src/server/spa/client/react/contexts/AppContext', () => ({
    useApp: () => ({ state: mockState, dispatch: mockDispatch }),
}));
vi.mock('../../../../src/server/spa/client/react/contexts/QueueContext', () => ({
    useQueue: () => ({ state: { selectedTaskIdByRepo: {} } }),
}));
vi.mock('../../../../src/server/spa/client/react/layout/Router', () => ({
    buildRepoSubTabSuffix: (tab: string) => '/' + tab,
}));

import { useShellNavigation } from '../../../../src/server/spa/client/react/features/remote-shell/useShellNavigation';
import {
    setExplorerInstanceDirty,
    clearExplorerDirty,
} from '../../../../src/server/spa/client/react/features/repo-detail/explorer/explorerDirtyStore';

beforeEach(() => {
    mockDispatch.mockReset();
    location.hash = '';
    mockState = { selectedRepoId: 'a', activeTab: 'repos', activeRepoSubTab: 'chats', notePathState: {}, repoRouteState: {}, repoTabState: {} };
    clearExplorerDirty();
    vi.restoreAllMocks();
});

describe('useShellNavigation.switchSubTab', () => {
    it('pulls back onto the repos tab and navigates into the workspace (from Admin)', () => {
        mockState = { ...mockState, activeTab: 'admin' };
        const { result } = renderHook(() => useShellNavigation());

        act(() => result.current.switchSubTab('git'));

        // Sets the active tab back to repos (not just the sub-tab)...
        expect(mockDispatch).toHaveBeenCalledWith({ type: 'SET_ACTIVE_TAB', tab: 'repos' });
        expect(mockDispatch).toHaveBeenCalledWith({ type: 'SET_REPO_SUB_TAB', tab: 'git' });
        // ...and routes to the selected clone's sub-tab.
        expect(location.hash).toBe('#repos/a/git');
    });

    it('still switches the sub-tab (and returns to repos) when no clone is selected', () => {
        mockState = { ...mockState, activeTab: 'admin', selectedRepoId: null };
        location.hash = '#admin';
        const { result } = renderHook(() => useShellNavigation());

        act(() => result.current.switchSubTab('git'));

        expect(mockDispatch).toHaveBeenCalledWith({ type: 'SET_ACTIVE_TAB', tab: 'repos' });
        expect(mockDispatch).toHaveBeenCalledWith({ type: 'SET_REPO_SUB_TAB', tab: 'git' });
        // No selected clone → no repo navigation, so the hash is left as-is.
        expect(location.hash).toBe('#admin');
    });
});

describe('useShellNavigation.selectClone — target-scope restoration', () => {
    it('reproduces the reported bug: from my_life/Notes, returning to a workspace restores ITS remembered route (not Notes)', () => {
        // Source scope `my_life` is on Notes; the target `shortcuts` was last on
        // Activity. Returning must not carry the departing scope's Notes tab.
        mockState = {
            ...mockState,
            selectedRepoId: 'my_life',
            activeRepoSubTab: 'notes',
            repoRouteState: { shortcuts: '/activity' },
        };
        const { result } = renderHook(() => useShellNavigation());

        act(() => result.current.selectClone('shortcuts'));

        expect(mockDispatch).toHaveBeenCalledWith({ type: 'SET_SELECTED_REPO', id: 'shortcuts' });
        expect(location.hash).toBe('#repos/shortcuts/activity');
    });

    it('restores a remembered deep route verbatim, taking precedence over a remembered tab', () => {
        mockState = {
            ...mockState,
            repoRouteState: { b: '/git/abc123/src%2Ffile.ts' },
            repoTabState: { b: 'chats' },
        };
        const { result } = renderHook(() => useShellNavigation());

        act(() => result.current.selectClone('b'));

        expect(location.hash).toBe('#repos/b/git/abc123/src%2Ffile.ts');
    });

    it('falls back to the target\'s remembered top-level tab when no full route exists', () => {
        mockState = { ...mockState, activeRepoSubTab: 'notes', repoTabState: { b: 'settings' } };
        const { result } = renderHook(() => useShellNavigation());

        act(() => result.current.selectClone('b'));

        expect(location.hash).toBe('#repos/b/settings');
    });

    it('uses the ordinary-workspace first-visit default (chats) when the target has no memory', () => {
        mockState = { ...mockState, activeRepoSubTab: 'notes' };
        const { result } = renderHook(() => useShellNavigation());

        act(() => result.current.selectClone('b'));

        expect(mockDispatch).toHaveBeenCalledWith({ type: 'SET_SELECTED_REPO', id: 'b' });
        expect(location.hash).toBe('#repos/b/chats');
    });

    it('honors an explicit sub-tab override over the target\'s remembered route/tab', () => {
        mockState = { ...mockState, repoRouteState: { b: '/activity' }, repoTabState: { b: 'activity' } };
        const { result } = renderHook(() => useShellNavigation());

        act(() => result.current.selectClone('b', 'git'));

        expect(location.hash).toBe('#repos/b/git');
    });

    it('activates the repos tab through the shared navigation path (from Admin)', () => {
        mockState = { ...mockState, activeTab: 'admin' };
        const { result } = renderHook(() => useShellNavigation());

        act(() => result.current.selectClone('b'));

        expect(mockDispatch).toHaveBeenCalledWith({ type: 'SET_ACTIVE_TAB', tab: 'repos' });
    });
});

describe('useShellNavigation.selectClone — unsaved explorer edits guard (AC-03)', () => {
    it('switches without prompting when the current workspace explorer is clean', () => {
        const confirmSpy = vi.spyOn(window, 'confirm');
        const { result } = renderHook(() => useShellNavigation());

        act(() => result.current.selectClone('b'));

        expect(confirmSpy).not.toHaveBeenCalled();
        expect(mockDispatch).toHaveBeenCalledWith({ type: 'SET_SELECTED_REPO', id: 'b' });
        expect(location.hash).toBe('#repos/b/chats');
    });

    it('discards and switches when the explorer is dirty and the user confirms', () => {
        setExplorerInstanceDirty('a', 'inst', true);
        const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
        const { result } = renderHook(() => useShellNavigation());

        act(() => result.current.selectClone('b'));

        expect(confirmSpy).toHaveBeenCalledTimes(1);
        expect(mockDispatch).toHaveBeenCalledWith({ type: 'SET_SELECTED_REPO', id: 'b' });
        expect(location.hash).toBe('#repos/b/chats');
    });

    it('stays on the current workspace (no dispatch, no route) when the user cancels', () => {
        setExplorerInstanceDirty('a', 'inst', true);
        const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false);
        const { result } = renderHook(() => useShellNavigation());

        act(() => result.current.selectClone('b'));

        expect(confirmSpy).toHaveBeenCalledTimes(1);
        expect(mockDispatch).not.toHaveBeenCalledWith({ type: 'SET_SELECTED_REPO', id: 'b' });
        expect(location.hash).toBe('');
    });
});
