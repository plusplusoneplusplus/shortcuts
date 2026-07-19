/**
 * useWorkspaceNavigation.navigateToWorkspace — the classic-shell workspace tab
 * switcher. Focus (AC-03 of preserve-explorer-state): switching away from a
 * workspace whose file explorer has unsaved edits must prompt first, and a cancel
 * must leave the current workspace (and its dirty buffer) untouched.
 *
 * @vitest-environment jsdom
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';

const mockDispatch = vi.fn();
let mockState: any = { selectedRepoId: 'a', activeTab: 'repos', repoTabState: {}, repoRouteState: {}, notePathState: {} };

vi.mock('../../../../src/server/spa/client/react/contexts/AppContext', () => ({
    useApp: () => ({ state: mockState, dispatch: mockDispatch }),
}));
vi.mock('../../../../src/server/spa/client/react/contexts/QueueContext', () => ({
    useQueue: () => ({ state: { selectedTaskIdByRepo: {} } }),
}));
vi.mock('../../../../src/server/spa/client/react/layout/Router', () => ({
    buildRepoSubTabSuffix: (tab: string) => '/' + tab,
}));

import { useWorkspaceNavigation } from '../../../../src/server/spa/client/react/hooks/useWorkspaceNavigation';
import {
    setExplorerInstanceDirty,
    clearExplorerDirty,
} from '../../../../src/server/spa/client/react/features/repo-detail/explorer/explorerDirtyStore';

beforeEach(() => {
    mockDispatch.mockReset();
    location.hash = '';
    mockState = { selectedRepoId: 'a', activeTab: 'repos', repoTabState: {}, repoRouteState: {}, notePathState: {} };
    clearExplorerDirty();
    vi.restoreAllMocks();
});

describe('useWorkspaceNavigation.navigateToWorkspace', () => {
    it('switches without prompting when the current workspace explorer is clean', () => {
        const confirmSpy = vi.spyOn(window, 'confirm');
        const { result } = renderHook(() => useWorkspaceNavigation());

        act(() => result.current.navigateToWorkspace('b'));

        expect(confirmSpy).not.toHaveBeenCalled();
        expect(mockDispatch).toHaveBeenCalledWith({ type: 'SET_SELECTED_REPO', id: 'b' });
        expect(location.hash).toBe('#repos/b/chats');
    });

    it('discards and switches when the explorer is dirty and the user confirms', () => {
        setExplorerInstanceDirty('a', 'inst', true);
        const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
        const { result } = renderHook(() => useWorkspaceNavigation());

        act(() => result.current.navigateToWorkspace('b'));

        expect(confirmSpy).toHaveBeenCalledTimes(1);
        expect(mockDispatch).toHaveBeenCalledWith({ type: 'SET_SELECTED_REPO', id: 'b' });
        expect(location.hash).toBe('#repos/b/chats');
    });

    it('stays on the current workspace (no dispatch, no route) when the user cancels', () => {
        setExplorerInstanceDirty('a', 'inst', true);
        const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false);
        const { result } = renderHook(() => useWorkspaceNavigation());

        act(() => result.current.navigateToWorkspace('b'));

        expect(confirmSpy).toHaveBeenCalledTimes(1);
        expect(mockDispatch).not.toHaveBeenCalled();
        expect(location.hash).toBe('');
    });
});
