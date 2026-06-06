/**
 * Regression tests for TopBar.selectRepo — verifies that the target repo's
 * last-visited sub-tab (from repoTabState) is used in location.hash when
 * switching repos.
 *
 * Previously, switching repos used the *current* repo's activeRepoSubTab
 * instead of looking up the *target* repo's saved tab from repoTabState.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, act } from '@testing-library/react';
import type { RepoSubTab, SettingsSection } from '../../../../src/server/spa/client/react/types/dashboard';

// Capture the onSelect callback injected into the mocked RepoTabStrip
let capturedOnSelect: ((id: string) => void) | null = null;

const mockDispatch = vi.fn();

let mockRepoTabState: Record<string, RepoSubTab> = {};
let mockSettingsSection: SettingsSection = 'info';
let mockSelectedTaskIdByRepo: Record<string, string | null> = {};

vi.mock('../../../../src/server/spa/client/react/contexts/AppContext', () => ({
    useApp: () => ({
        state: {
            activeTab: 'repos',
            activeRepoSubTab: 'git',
            settingsSection: mockSettingsSection,
            reposSidebarCollapsed: false,
            wsStatus: 'open',
            selectedRepoId: null,
            repoTabState: mockRepoTabState,
        },
        dispatch: mockDispatch,
    }),
    AppProvider: ({ children }: { children: React.ReactNode }) => children,
}));

vi.mock('../../../../src/server/spa/client/react/contexts/QueueContext', () => ({
    useQueue: () => ({
        state: {
            selectedTaskId: null,
            selectedTaskIdByRepo: mockSelectedTaskIdByRepo,
        },
        dispatch: vi.fn(),
    }),
}));

vi.mock('../../../../src/server/spa/client/react/features/repo-detail/RepoTabStrip', () => ({
    RepoTabStrip: ({ onSelect }: { onSelect: (id: string) => void }) => {
        capturedOnSelect = onSelect;
        return <button data-testid="mock-repo-btn" onClick={() => onSelect('new-repo')} />;
    },
}));

vi.mock('../../../../src/server/spa/client/react/contexts/ReposContext', () => ({
    useRepos: () => ({ repos: [], unseenCounts: {}, fetchRepos: vi.fn(), loading: false }),
}));

vi.mock('../../../../src/server/spa/client/react/layout/ThemeProvider', () => ({
    useTheme: () => ({ theme: 'auto', toggleTheme: vi.fn() }),
}));

vi.mock('../../../../src/server/spa/client/react/shared/NotificationBell', () => ({
    NotificationBell: () => null,
}));

vi.mock('../../../../src/server/spa/client/react/shared/AgentProviderQuotaIndicator', () => ({
    agentProviderQuotaIndicator: () => null,
}));

vi.mock('../../../../src/server/spa/client/react/repos/RepoManagementPopover', () => ({
    RepoManagementPopover: () => null,
}));

vi.mock('../../../../src/server/spa/client/react/hooks/ui/useBreakpoint', () => ({
    useBreakpoint: () => ({ breakpoint: 'desktop', isMobile: false }),
}));

import { TopBar } from '../../../../src/server/spa/client/react/layout/TopBar';

describe('TopBar — selectRepo restores target repo sub-tab from repoTabState', () => {
    beforeEach(() => {
        location.hash = '';
        capturedOnSelect = null;
        mockDispatch.mockClear();
        mockRepoTabState = {};
        mockSettingsSection = 'info';
        mockSelectedTaskIdByRepo = {};
    });

    afterEach(() => {
        location.hash = '';
    });

    it('restores git sub-tab from repoTabState for target repo', () => {
        mockRepoTabState = { 'repo-abc': 'git' };
        render(<TopBar />);
        act(() => { capturedOnSelect?.('repo-abc'); });
        expect(location.hash).toBe('#repos/repo-abc/git');
    });

    it('restores templates sub-tab from repoTabState for target repo', () => {
        mockRepoTabState = { 'repo-xyz': 'templates' };
        render(<TopBar />);
        act(() => { capturedOnSelect?.('repo-xyz'); });
        expect(location.hash).toBe('#repos/repo-xyz/templates');
    });

    it('restores explorer sub-tab from repoTabState for target repo', () => {
        mockRepoTabState = { 'repo-123': 'explorer' };
        render(<TopBar />);
        act(() => { capturedOnSelect?.('repo-123'); });
        expect(location.hash).toBe('#repos/repo-123/explorer');
    });

    it('restores activity sub-tab from repoTabState for target repo', () => {
        mockRepoTabState = { 'repo-abc': 'activity' };
        render(<TopBar />);
        act(() => { capturedOnSelect?.('repo-abc'); });
        expect(location.hash).toBe('#repos/repo-abc/activity');
    });

    it('restores settings sub-tab with section from repoTabState', () => {
        mockRepoTabState = { 'repo-xyz': 'settings' };
        mockSettingsSection = 'mcp';
        render(<TopBar />);
        act(() => { capturedOnSelect?.('repo-xyz'); });
        expect(location.hash).toBe('#repos/repo-xyz/settings/mcp');
    });

    it('restores settings/info section from repoTabState', () => {
        mockRepoTabState = { 'repo-abc': 'settings' };
        mockSettingsSection = 'info';
        render(<TopBar />);
        act(() => { capturedOnSelect?.('repo-abc'); });
        expect(location.hash).toBe('#repos/repo-abc/settings/info');
    });

    it('defaults to chats when target repo has no saved sub-tab', () => {
        mockRepoTabState = {};
        mockSettingsSection = 'info';
        render(<TopBar />);
        act(() => { capturedOnSelect?.('new-repo'); });
        expect(location.hash).toBe('#repos/new-repo/chats');
    });

    it('preserves selected chat id when target repo restores chats', () => {
        mockRepoTabState = { 'repo-abc': 'chats' };
        mockSelectedTaskIdByRepo = { 'repo-abc': 'queue task/1' };
        render(<TopBar />);
        act(() => { capturedOnSelect?.('repo-abc'); });
        expect(location.hash).toBe('#repos/repo-abc/chats/queue%20task%2F1');
    });

    it('preserves selected task id when target repo restores tasks', () => {
        mockRepoTabState = { 'repo-abc': 'tasks' };
        mockSelectedTaskIdByRepo = { 'repo-abc': 'queue_task_1' };
        render(<TopBar />);
        act(() => { capturedOnSelect?.('repo-abc'); });
        expect(location.hash).toBe('#repos/repo-abc/tasks/queue_task_1');
    });

    it('dispatches SET_SELECTED_REPO with the new repo id', () => {
        mockRepoTabState = { 'repo-abc': 'git' };
        render(<TopBar />);
        act(() => { capturedOnSelect?.('repo-abc'); });
        expect(mockDispatch).toHaveBeenCalledWith({ type: 'SET_SELECTED_REPO', id: 'repo-abc' });
    });

    it('uses target repo tab, not current repo activeRepoSubTab', () => {
        // activeRepoSubTab is 'git' (set in mock), but target repo has 'explorer'
        mockRepoTabState = { 'some-repo': 'explorer' };
        render(<TopBar />);
        act(() => { capturedOnSelect?.('some-repo'); });
        expect(location.hash).not.toContain('/git');
        expect(location.hash).toContain('/explorer');
    });

    it('URL-encodes repo ids with special characters', () => {
        mockRepoTabState = { 'repo/with spaces': 'git' };
        render(<TopBar />);
        act(() => { capturedOnSelect?.('repo/with spaces'); });
        expect(location.hash).toBe('#repos/' + encodeURIComponent('repo/with spaces') + '/git');
    });
});
