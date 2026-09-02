/**
 * useVirtualWorkspaceHeader.switchTab — hash routing for the virtual-workspace
 * shell headers (My Work / My Life).
 *
 * Regression focus: switching sub-tabs must NOT strip the open note (and other
 * per-tab detail) from the hash. It builds the suffix through
 * `buildRepoSubTabSuffix` — mirroring useShellNavigation.navigate — so returning
 * to Notes preserves the already-mounted view (no reset/reopen), returning to
 * Activity reselects the last chat, and returning to Git reopens the last commit.
 *
 * @vitest-environment jsdom
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';

const mockDispatch = vi.fn();
let mockState: any;
let mockQueueState: any;

vi.mock('../../../../src/server/spa/client/react/contexts/AppContext', () => ({
    useApp: () => ({ state: mockState, dispatch: mockDispatch }),
}));
vi.mock('../../../../src/server/spa/client/react/contexts/QueueContext', () => ({
    useQueue: () => ({ state: mockQueueState }),
}));
// Delegate to the real suffix builder so path encoding is exercised for real,
// without dragging in Router's heavy view tree.
vi.mock('../../../../src/server/spa/client/react/layout/Router', async () => {
    const routes = await import('../../../../src/server/spa/client/react/layout/dashboardRoutes');
    return { buildWorkspaceSubTabSuffix: routes.buildWorkspaceSubTabSuffix };
});
vi.mock(
    '../../../../src/server/spa/client/react/hooks/feature-flags/useSchedulesInScheduledSlideEnabled',
    () => ({ useSchedulesInScheduledSlideEnabled: () => false }),
);

import { useVirtualWorkspaceHeader } from '../../../../src/server/spa/client/react/features/remote-shell/useVirtualWorkspaceHeader';
import type { VirtualWorkspaceHeaderConfig } from '../../../../src/server/spa/client/react/features/remote-shell/virtualWorkspaceHeader';

const config: VirtualWorkspaceHeaderConfig = {
    workspaceId: 'my_life',
    icon: '🌿',
    label: 'My Life',
    testIdPrefix: 'my-life',
    tabs: [
        { key: 'notes', label: 'Notes' },
        { key: 'activity', label: 'Activity' },
        { key: 'git', label: 'Git' },
    ],
    actions: [],
};

beforeEach(() => {
    mockDispatch.mockReset();
    location.hash = '';
    mockState = {
        activeRepoSubTab: 'notes',
        selectedNotePath: null,
        notePathState: {},
        settingsSection: 'general',
        selectedGitCommitHash: null,
        selectedGitFilePath: null,
    };
    mockQueueState = { selectedTaskIdByRepo: {} };
});

describe('useVirtualWorkspaceHeader.switchTab — per-tab detail preservation', () => {
    it('retains the workspace\'s open note in the hash when switching to Notes (AC-01)', () => {
        mockState.notePathState = { my_life: 'daily/2026-07-29.md' };
        const { result } = renderHook(() => useVirtualWorkspaceHeader(config));

        act(() => result.current.switchTab('notes'));

        expect(mockDispatch).toHaveBeenCalledWith({ type: 'SET_REPO_SUB_TAB', tab: 'notes' });
        // The note path is retained, not stripped to a bare `/notes`.
        expect(location.hash).toBe('#repos/my_life/notes/daily/2026-07-29.md');
    });

    it('falls back to state.selectedNotePath when no per-workspace note is remembered', () => {
        mockState.selectedNotePath = 'inbox.md';
        const { result } = renderHook(() => useVirtualWorkspaceHeader(config));

        act(() => result.current.switchTab('notes'));

        expect(location.hash).toBe('#repos/my_life/notes/inbox.md');
    });

    it('round trip Notes → Activity → Notes keeps the note path both ways (AC-01)', () => {
        mockState.notePathState = { my_life: 'projects/plan.md' };
        mockQueueState.selectedTaskIdByRepo = { my_life: 'task-9' };
        const { result } = renderHook(() => useVirtualWorkspaceHeader(config));

        // Leaving Notes for Activity carries the selected chat/task (AC-02)...
        act(() => result.current.switchTab('activity'));
        expect(location.hash).toBe('#repos/my_life/activity/task-9');

        // ...and returning to Notes still has the encoded note path.
        act(() => result.current.switchTab('notes'));
        expect(location.hash).toBe('#repos/my_life/notes/projects/plan.md');
    });

    it('reopens the last commit when returning to Git (AC-02)', () => {
        mockState.selectedGitCommitHash = 'abc123';
        mockState.selectedGitFilePath = 'src/file.ts';
        const { result } = renderHook(() => useVirtualWorkspaceHeader(config));

        act(() => result.current.switchTab('git'));

        expect(location.hash).toBe('#repos/my_life/git/abc123/src%2Ffile.ts');
    });
});
