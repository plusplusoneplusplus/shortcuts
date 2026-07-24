/**
 * useScopeNavigation — virtual-scope (My Work / My Life) navigation.
 *
 * Each virtual scope is its own navigation owner: switching to it restores its
 * remembered full route / top-level tab and only falls back to its first-visit
 * landing tab when it has no memory. The departing scope's active tab is never
 * carried into the virtual target's hash.
 *
 * @vitest-environment jsdom
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';

const mockDispatch = vi.fn();
let mockState: any;
let mockTodayView = false;

vi.mock('../../../../src/server/spa/client/react/contexts/AppContext', () => ({
    useApp: () => ({ state: mockState, dispatch: mockDispatch }),
}));
vi.mock('../../../../src/server/spa/client/react/contexts/QueueContext', () => ({
    useQueue: () => ({ state: { selectedTaskIdByRepo: {} } }),
}));
vi.mock('../../../../src/server/spa/client/react/layout/Router', () => ({
    buildRepoSubTabSuffix: (tab: string, state: any) =>
        tab === 'notes' && state?.selectedNotePath ? '/notes/' + state.selectedNotePath : '/' + tab,
}));
vi.mock('../../../../src/server/spa/client/react/hooks/feature-flags/useMyWorkTodayViewEnabled', () => ({
    useMyWorkTodayViewEnabled: () => mockTodayView,
}));
// Keep the hook test lightweight — only the ids are needed from the views.
vi.mock('../../../../src/server/spa/client/react/repos/MyWorkView', () => ({ MY_WORK_WORKSPACE_ID: 'my_work' }));
vi.mock('../../../../src/server/spa/client/react/repos/MyLifeView', () => ({ MY_LIFE_WORKSPACE_ID: 'my_life' }));

import { useScopeNavigation } from '../../../../src/server/spa/client/react/hooks/useScopeNavigation';
import { useShellNavigation } from '../../../../src/server/spa/client/react/features/remote-shell/useShellNavigation';
import {
    setExplorerInstanceDirty,
    clearExplorerDirty,
} from '../../../../src/server/spa/client/react/features/repo-detail/explorer/explorerDirtyStore';

beforeEach(() => {
    mockDispatch.mockReset();
    location.hash = '';
    mockTodayView = false;
    mockState = { selectedRepoId: 'a', activeTab: 'repos', activeRepoSubTab: 'chats', notePathState: {}, repoRouteState: {}, repoTabState: {} };
    clearExplorerDirty();
    vi.restoreAllMocks();
});

describe('useScopeNavigation — first-visit landing tabs', () => {
    it('My Life lands on Notes on first visit', () => {
        const { result } = renderHook(() => useScopeNavigation());

        act(() => result.current.goToMyLife());

        expect(mockDispatch).toHaveBeenCalledWith({ type: 'SET_ACTIVE_TAB', tab: 'repos' });
        expect(mockDispatch).toHaveBeenCalledWith({ type: 'SET_SELECTED_REPO', id: 'my_life' });
        expect(location.hash).toBe('#repos/my_life/notes');
    });

    it('My Work lands on Notes on first visit when the Today view is off', () => {
        const { result } = renderHook(() => useScopeNavigation());

        act(() => result.current.goToMyWork());

        expect(location.hash).toBe('#repos/my_work/notes');
    });

    it('My Work lands on Today on first visit when the Today view is on', () => {
        mockTodayView = true;
        const { result } = renderHook(() => useScopeNavigation());

        act(() => result.current.goToMyWork());

        expect(location.hash).toBe('#repos/my_work/today');
    });
});

describe('useScopeNavigation — remembered state per scope', () => {
    it('My Work and My Life each restore their own remembered top-level tab', () => {
        mockState = { ...mockState, repoTabState: { my_work: 'git', my_life: 'activity' } };
        const { result } = renderHook(() => useScopeNavigation());

        act(() => result.current.goToMyWork());
        expect(location.hash).toBe('#repos/my_work/git');

        act(() => result.current.goToMyLife());
        expect(location.hash).toBe('#repos/my_life/activity');
    });

    it('restores a remembered virtual deep-note route verbatim (over the Notes default)', () => {
        mockState = { ...mockState, repoRouteState: { my_life: '/notes/Journal/2026-07-24.md' } };
        const { result } = renderHook(() => useScopeNavigation());

        act(() => result.current.goToMyLife());

        expect(location.hash).toBe('#repos/my_life/notes/Journal/2026-07-24.md');
    });

    it('rebuilds the Notes suffix from the scope\'s own saved note path on first visit', () => {
        mockState = { ...mockState, notePathState: { my_life: 'Plans/today.md' } };
        const { result } = renderHook(() => useScopeNavigation());

        act(() => result.current.goToMyLife());

        expect(location.hash).toBe('#repos/my_life/notes/Plans/today.md');
    });

    it('never carries the departing real workspace\'s active tab into the virtual target', () => {
        // Departing scope 'a' is on Git; My Life has no memory → its own Notes default.
        mockState = { ...mockState, selectedRepoId: 'a', activeRepoSubTab: 'git' };
        const { result } = renderHook(() => useScopeNavigation());

        act(() => result.current.goToMyLife());

        expect(location.hash).toBe('#repos/my_life/notes');
    });
});

describe('scope isolation — navigation-level regression sequence', () => {
    it('each scope restores its own remembered route across repeated switches, and the maps stay owned by their scope', () => {
        // Repo A last on Chats, My Work on Activity, My Life on Notes — each entry
        // owned by its own scope (as Router would have recorded them).
        const repoRouteState = { A: '/chats', my_work: '/activity', my_life: '/notes' };
        mockState = { ...mockState, selectedRepoId: 'A', activeRepoSubTab: 'git', repoRouteState };
        const scope = renderHook(() => useScopeNavigation());
        const shell = renderHook(() => useShellNavigation());

        // 1. Repo A restores Workspace/Chats (not the live 'git' sub-tab).
        act(() => shell.result.current.selectClone('A'));
        expect(location.hash).toBe('#repos/A/chats');

        // 2. My Life restores Notes.
        act(() => scope.result.current.goToMyLife());
        expect(location.hash).toBe('#repos/my_life/notes');

        // 3. Returning to Repo A restores Workspace/Chats again.
        act(() => shell.result.current.selectClone('A'));
        expect(location.hash).toBe('#repos/A/chats');

        // 4. My Work restores Activity.
        act(() => scope.result.current.goToMyWork());
        expect(location.hash).toBe('#repos/my_work/activity');

        // 5. My Life still restores Notes.
        act(() => scope.result.current.goToMyLife());
        expect(location.hash).toBe('#repos/my_life/notes');

        // 6. No navigation mutated another scope's remembered route.
        expect(repoRouteState).toEqual({ A: '/chats', my_work: '/activity', my_life: '/notes' });
    });
});

describe('useScopeNavigation — unsaved Explorer guard (AC-03)', () => {
    it('does not switch when the user cancels the dirty-Explorer prompt', () => {
        setExplorerInstanceDirty('a', 'inst', true);
        const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false);
        const { result } = renderHook(() => useScopeNavigation());

        act(() => result.current.goToMyLife());

        expect(confirmSpy).toHaveBeenCalledTimes(1);
        expect(mockDispatch).not.toHaveBeenCalled();
        expect(location.hash).toBe('');
    });
});
