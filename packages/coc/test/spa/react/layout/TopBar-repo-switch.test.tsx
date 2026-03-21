/**
 * Regression tests for TopBar.selectRepo — verifies that the active sub-tab
 * and settings section are preserved in location.hash when switching repos.
 *
 * Previously, switching repos reset the hash to `#repos/<id>` only,
 * discarding the current sub-tab path.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, act } from '@testing-library/react';
import type { RepoSubTab, SettingsSection } from '../../../../src/server/spa/client/react/types/dashboard';

// Capture the onSelect callback injected into the mocked RepoTabStrip
let capturedOnSelect: ((id: string) => void) | null = null;

const mockDispatch = vi.fn();

let mockActiveRepoSubTab: RepoSubTab = 'git';
let mockSettingsSection: SettingsSection = 'info';

vi.mock('../../../../src/server/spa/client/react/context/AppContext', () => ({
    useApp: () => ({
        state: {
            activeTab: 'repos',
            activeRepoSubTab: mockActiveRepoSubTab,
            settingsSection: mockSettingsSection,
            reposSidebarCollapsed: false,
            wsStatus: 'open',
            selectedRepoId: null,
        },
        dispatch: mockDispatch,
    }),
    AppProvider: ({ children }: { children: React.ReactNode }) => children,
}));

vi.mock('../../../../src/server/spa/client/react/repos/RepoTabStrip', () => ({
    RepoTabStrip: ({ onSelect }: { onSelect: (id: string) => void }) => {
        capturedOnSelect = onSelect;
        return <button data-testid="mock-repo-btn" onClick={() => onSelect('new-repo')} />;
    },
}));

vi.mock('../../../../src/server/spa/client/react/context/ReposContext', () => ({
    useRepos: () => ({ repos: [], unseenCounts: {}, fetchRepos: vi.fn(), loading: false }),
}));

vi.mock('../../../../src/server/spa/client/react/layout/ThemeProvider', () => ({
    useTheme: () => ({ theme: 'auto', toggleTheme: vi.fn() }),
}));

vi.mock('../../../../src/server/spa/client/react/shared/NotificationBell', () => ({
    NotificationBell: () => null,
}));

vi.mock('../../../../src/server/spa/client/react/repos/RepoManagementPopover', () => ({
    RepoManagementPopover: () => null,
}));

vi.mock('../../../../src/server/spa/client/react/hooks/useBreakpoint', () => ({
    useBreakpoint: () => ({ breakpoint: 'desktop', isMobile: false }),
}));

import { TopBar } from '../../../../src/server/spa/client/react/layout/TopBar';

describe('TopBar — selectRepo preserves sub-tab in hash', () => {
    beforeEach(() => {
        location.hash = '';
        capturedOnSelect = null;
        mockDispatch.mockClear();
    });

    afterEach(() => {
        location.hash = '';
    });

    it('preserves git sub-tab when switching repos', () => {
        mockActiveRepoSubTab = 'git';
        render(<TopBar />);
        act(() => { capturedOnSelect?.('repo-abc'); });
        expect(location.hash).toBe('#repos/repo-abc/git');
    });

    it('preserves workflows sub-tab when switching repos', () => {
        mockActiveRepoSubTab = 'workflows';
        render(<TopBar />);
        act(() => { capturedOnSelect?.('repo-xyz'); });
        expect(location.hash).toBe('#repos/repo-xyz/workflows');
    });

    it('preserves explorer sub-tab when switching repos', () => {
        mockActiveRepoSubTab = 'explorer';
        render(<TopBar />);
        act(() => { capturedOnSelect?.('repo-123'); });
        expect(location.hash).toBe('#repos/repo-123/explorer');
    });

    it('preserves activity sub-tab when switching repos', () => {
        mockActiveRepoSubTab = 'activity';
        render(<TopBar />);
        act(() => { capturedOnSelect?.('repo-abc'); });
        expect(location.hash).toBe('#repos/repo-abc/activity');
    });

    it('preserves settings sub-tab with section when switching repos', () => {
        mockActiveRepoSubTab = 'settings';
        mockSettingsSection = 'mcp';
        render(<TopBar />);
        act(() => { capturedOnSelect?.('repo-xyz'); });
        expect(location.hash).toBe('#repos/repo-xyz/settings/mcp');
    });

    it('preserves settings/info section when switching repos', () => {
        mockActiveRepoSubTab = 'settings';
        mockSettingsSection = 'info';
        render(<TopBar />);
        act(() => { capturedOnSelect?.('repo-abc'); });
        expect(location.hash).toBe('#repos/repo-abc/settings/info');
    });

    it('dispatches SET_SELECTED_REPO with the new repo id', () => {
        mockActiveRepoSubTab = 'git';
        render(<TopBar />);
        act(() => { capturedOnSelect?.('repo-abc'); });
        expect(mockDispatch).toHaveBeenCalledWith({ type: 'SET_SELECTED_REPO', id: 'repo-abc' });
    });

    it('regression: does not drop sub-tab (previously only set #repos/<id>)', () => {
        mockActiveRepoSubTab = 'explorer';
        render(<TopBar />);
        act(() => { capturedOnSelect?.('some-repo'); });
        // Must include the sub-tab — not just the bare repo path
        expect(location.hash).not.toBe('#repos/some-repo');
        expect(location.hash).toContain('/explorer');
    });

    it('URL-encodes repo ids with special characters', () => {
        mockActiveRepoSubTab = 'git';
        render(<TopBar />);
        act(() => { capturedOnSelect?.('repo/with spaces'); });
        expect(location.hash).toBe('#repos/' + encodeURIComponent('repo/with spaces') + '/git');
    });
});
