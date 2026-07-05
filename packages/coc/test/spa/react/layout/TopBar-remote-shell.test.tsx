/**
 * TopBar remote-shell header tests.
 *
 * The remote-first shell is now a single header row: when features.remoteShell
 * is on (desktop, repos tab, a clone selected), the TopBar renders
 * RemoteShellHeader unconditionally — there is no experimental flag gate and no
 * two-row RemoteTopBar fallback anymore.
 *
 * @vitest-environment jsdom
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';

const mockAppDispatch = vi.fn();
const mockQueueDispatch = vi.fn();
let mockAppState: any = {
    activeTab: 'repos',
    selectedRepoId: 'a',
    currentAgentId: null,
    repoTabState: {},
    notePathState: {},
    wsStatus: 'open',
};
let mockRepos: any[] = [];
let mockRemoteShell = true;

vi.mock('../../../../src/server/spa/client/react/contexts/AppContext', () => ({
    useApp: () => ({ state: mockAppState, dispatch: mockAppDispatch }),
}));
vi.mock('../../../../src/server/spa/client/react/contexts/QueueContext', () => ({
    useQueue: () => ({ state: { selectedTaskIdByRepo: {} }, dispatch: mockQueueDispatch }),
}));
vi.mock('../../../../src/server/spa/client/react/contexts/ReposContext', () => ({
    useRepos: () => ({ repos: mockRepos, unseenCounts: {}, fetchRepos: vi.fn(), loading: false }),
}));
vi.mock('../../../../src/server/spa/client/react/layout/ThemeProvider', () => ({
    useTheme: () => ({ theme: 'auto', toggleTheme: vi.fn() }),
}));
vi.mock('../../../../src/server/spa/client/react/shared/NotificationBell', () => ({
    NotificationBell: () => <button aria-label="Notifications" data-testid="notification-bell" />,
}));
vi.mock('../../../../src/server/spa/client/react/shared/AgentProviderQuotaIndicator', () => ({
    agentProviderQuotaIndicator: () => <button aria-label="Agent provider quota" data-testid="agent-provider-quota-indicator" />,
}));
vi.mock('../../../../src/server/spa/client/react/repos/RepoManagementPopover', () => ({
    RepoManagementPopover: () => null,
}));
vi.mock('../../../../src/server/spa/client/react/features/repo-detail/RepoTabStrip', () => ({
    RepoTabStrip: () => <div data-testid="repo-tab-strip" />,
}));
vi.mock('../../../../src/server/spa/client/react/features/remote-shell/RemoteShellHeader', () => ({
    RemoteShellHeader: () => <div data-testid="remote-shell-header" />,
}));
vi.mock('../../../../src/server/spa/client/react/hooks/feature-flags/useRemoteShellEnabled', () => ({
    useRemoteShellEnabled: () => mockRemoteShell,
}));
vi.mock('../../../../src/server/spa/client/react/hooks/feature-flags/useMyWorkEnabled', () => ({
    useMyWorkEnabled: () => false,
}));
vi.mock('../../../../src/server/spa/client/react/hooks/feature-flags/useMyLifeEnabled', () => ({
    useMyLifeEnabled: () => false,
}));
vi.mock('../../../../src/server/spa/client/react/hooks/ui/useBreakpoint', () => ({
    useBreakpoint: () => ({ breakpoint: 'desktop', isMobile: false, isTablet: false, isDesktop: true }),
}));

import { TopBar } from '../../../../src/server/spa/client/react/layout/TopBar';

const repo = (id: string, name: string) => ({
    workspace: { id, name, rootPath: `/r/${id}`, remoteUrl: `https://github.com/acme/${name}.git` },
    gitInfo: { isGitRepo: true, branch: 'main', dirty: false, remoteUrl: `https://github.com/acme/${name}.git` },
});

beforeEach(() => {
    mockAppDispatch.mockReset();
    mockQueueDispatch.mockReset();
    mockRemoteShell = true;
    mockAppState = {
        activeTab: 'repos',
        selectedRepoId: 'a',
        currentAgentId: null,
        repoTabState: {},
        notePathState: {},
        wsStatus: 'open',
    };
    mockRepos = [repo('a', 'shortcuts')];
});

describe('TopBar remote-shell header', () => {
    it('renders RemoteShellHeader as the sole remote header (no RepoTabStrip)', () => {
        render(<TopBar />);

        expect(screen.getByTestId('remote-shell-header')).toBeTruthy();
        expect(screen.queryByTestId('repo-tab-strip')).toBeNull();
    });

    it('places + New before the connection indicator and opens the queue dialog for the active clone', () => {
        render(<TopBar />);

        const actions = screen.getByTestId('topbar-actions');
        expect(actions.firstElementChild?.getAttribute('data-testid')).toBe('header-new-btn');
        fireEvent.click(screen.getByTestId('header-new-btn'));
        expect(mockQueueDispatch).toHaveBeenCalledWith({ type: 'OPEN_DIALOG', workspaceId: 'a' });
    });

    it('falls back to the classic RepoTabStrip when remoteShell is off', () => {
        mockRemoteShell = false;
        render(<TopBar />);

        expect(screen.queryByTestId('remote-shell-header')).toBeNull();
        expect(screen.getByTestId('repo-tab-strip')).toBeTruthy();
        expect(screen.queryByTestId('header-new-btn')).toBeNull();
    });

    it('renders no remote header off the repos tab', () => {
        mockAppState = { ...mockAppState, activeTab: 'wiki' };
        render(<TopBar />);

        expect(screen.queryByTestId('remote-shell-header')).toBeNull();
        expect(screen.queryByTestId('header-new-btn')).toBeNull();
    });

    it('renders no remote header (and no RepoTabStrip) when no clone is selected', () => {
        mockAppState = { ...mockAppState, selectedRepoId: null };
        render(<TopBar />);

        expect(screen.queryByTestId('remote-shell-header')).toBeNull();
        expect(screen.queryByTestId('header-new-btn')).toBeNull();
        expect(screen.queryByTestId('repo-tab-strip')).toBeNull();
    });
});
