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
    // Reflect the inputs faithfully enough to prove target-scoped note/task data
    // is threaded through when a fallback suffix must be rebuilt.
    buildRepoSubTabSuffix: (tab: string, state: any, selectedTaskId?: string | null) => {
        if (tab === 'notes' && state?.selectedNotePath) return '/notes/' + state.selectedNotePath;
        if ((tab === 'chats' || tab === 'activity' || tab === 'tasks') && selectedTaskId) return '/' + tab + '/' + selectedTaskId;
        return '/' + tab;
    },
}));

import {
    resolveWorkspaceRouteSuffix,
    useWorkspaceNavigation,
} from '../../../../src/server/spa/client/react/hooks/useWorkspaceNavigation';
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

describe('resolveWorkspaceRouteSuffix — target-aware precedence', () => {
    const base: any = { repoRouteState: {}, repoTabState: {}, notePathState: {} };

    it('1. an explicit override wins over the remembered route and tab', () => {
        const state = { ...base, repoRouteState: { b: '/git/abc' }, repoTabState: { b: 'notes' } };
        expect(resolveWorkspaceRouteSuffix(state, {}, 'b', { subTabOverride: 'settings' })).toBe('/settings');
    });

    it('2. a remembered full route wins over the remembered tab and first-visit tab', () => {
        const state = { ...base, repoRouteState: { b: '/git/abc/file.ts' }, repoTabState: { b: 'notes' } };
        expect(resolveWorkspaceRouteSuffix(state, {}, 'b', { firstVisitTab: 'today' })).toBe('/git/abc/file.ts');
    });

    it('3. a remembered top-level tab wins over the first-visit tab', () => {
        const state = { ...base, repoTabState: { b: 'activity' } };
        expect(resolveWorkspaceRouteSuffix(state, {}, 'b', { firstVisitTab: 'notes' })).toBe('/activity');
    });

    it('4. the first-visit tab is used only when the target has no memory', () => {
        expect(resolveWorkspaceRouteSuffix(base, {}, 'b', { firstVisitTab: 'today' })).toBe('/today');
    });

    it('defaults to chats when neither memory nor a first-visit tab is supplied', () => {
        expect(resolveWorkspaceRouteSuffix(base, {}, 'b')).toBe('/chats');
    });

    it('rebuilds a fallback suffix from the TARGET id\'s note path, not the departing scope\'s', () => {
        const state = { ...base, repoTabState: { b: 'notes' }, notePathState: { a: 'departing.md', b: 'Plans/target.md' } };
        expect(resolveWorkspaceRouteSuffix(state, {}, 'b')).toBe('/notes/Plans/target.md');
    });

    it('rebuilds a fallback suffix from the TARGET id\'s selected task', () => {
        const state = { ...base, repoTabState: { b: 'chats' } };
        expect(resolveWorkspaceRouteSuffix(state, { a: 'other', b: 'task-9' }, 'b')).toBe('/chats/task-9');
    });
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
