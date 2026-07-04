/**
 * TopBar single-row remote shell tests.
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
let mockSingleRowShell = true;

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
vi.mock('../../../../src/server/spa/client/react/features/remote-shell/RemoteTopBar', () => ({
    RemoteTopBar: () => <div data-testid="remote-top-bar" />,
}));
vi.mock('../../../../src/server/spa/client/react/features/remote-shell/RemoteShellHeader', () => ({
    RemoteShellHeader: () => <div data-testid="remote-shell-header" />,
}));
vi.mock('../../../../src/server/spa/client/react/hooks/feature-flags/useRemoteShellEnabled', () => ({
    useRemoteShellEnabled: () => mockRemoteShell,
}));
vi.mock('../../../../src/server/spa/client/react/hooks/feature-flags/useSingleRowShellEnabled', () => ({
    useSingleRowShellEnabled: () => mockSingleRowShell,
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
    mockSingleRowShell = true;
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

describe('TopBar single-row remote shell', () => {
    it('renders the merged remote shell header instead of the old remote strip', () => {
        render(<TopBar />);

        expect(screen.getByTestId('remote-shell-header')).toBeTruthy();
        expect(screen.queryByTestId('remote-top-bar')).toBeNull();
    });

    it('places + New before the connection indicator and opens the queue dialog for the active clone', () => {
        render(<TopBar />);

        const actions = screen.getByTestId('topbar-actions');
        expect(actions.firstElementChild?.getAttribute('data-testid')).toBe('header-new-btn');
        fireEvent.click(screen.getByTestId('header-new-btn'));
        expect(mockQueueDispatch).toHaveBeenCalledWith({ type: 'OPEN_DIALOG', workspaceId: 'a' });
    });

    it('falls back to the old remote strip when the single-row flag is off', () => {
        mockSingleRowShell = false;
        render(<TopBar />);

        expect(screen.queryByTestId('remote-shell-header')).toBeNull();
        expect(screen.getByTestId('remote-top-bar')).toBeTruthy();
        expect(screen.queryByTestId('header-new-btn')).toBeNull();
    });

    it('hides the single-row shell off the repos tab', () => {
        mockAppState = { ...mockAppState, activeTab: 'wiki' };
        render(<TopBar />);

        expect(screen.queryByTestId('remote-shell-header')).toBeNull();
        expect(screen.queryByTestId('header-new-btn')).toBeNull();
    });
});
