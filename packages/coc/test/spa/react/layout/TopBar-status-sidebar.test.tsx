/**
 * TopBar — status cluster placement for the remote-first shell.
 *
 * When the remote shell + split "Workspace" panel are on and the chat/activity
 * sub-tab is showing, the status cluster (connection / notifications / quota /
 * admin / theme) moves to a docked footer in the left sidebar, so the topbar
 * hides it. In every other case it must stay in the topbar — otherwise the
 * controls would vanish entirely (regression guard).
 *
 * @vitest-environment jsdom
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

let mockRemoteShell = true;
let mockSplitPanel = true;
let mockAppState: any = {
    activeTab: 'repos',
    activeRepoSubTab: 'chats',
    selectedRepoId: 'a',
    currentAgentId: null,
    repoTabState: {},
    repoRouteState: {},
    notePathState: {},
    wsStatus: 'open',
};
let mockRepos: any[] = [];

vi.mock('../../../../src/server/spa/client/react/contexts/AppContext', () => ({
    useApp: () => ({ state: mockAppState, dispatch: vi.fn() }),
}));
vi.mock('../../../../src/server/spa/client/react/contexts/QueueContext', () => ({
    useQueue: () => ({ state: { selectedTaskIdByRepo: {} }, dispatch: vi.fn() }),
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
vi.mock('../../../../src/server/spa/client/react/hooks/feature-flags/useSplitWorkspacePanelEnabled', () => ({
    useSplitWorkspacePanelEnabled: () => mockSplitPanel,
}));
vi.mock('../../../../src/server/spa/client/react/hooks/feature-flags/useMyWorkEnabled', () => ({
    useMyWorkEnabled: () => false,
}));
vi.mock('../../../../src/server/spa/client/react/hooks/feature-flags/useMyLifeEnabled', () => ({
    useMyLifeEnabled: () => false,
}));
let mockIsMobile = false;
vi.mock('../../../../src/server/spa/client/react/hooks/ui/useBreakpoint', () => ({
    useBreakpoint: () => ({ breakpoint: mockIsMobile ? 'mobile' : 'desktop', isMobile: mockIsMobile, isTablet: false, isDesktop: !mockIsMobile }),
}));

import { TopBar } from '../../../../src/server/spa/client/react/layout/TopBar';

const repo = (id: string, name: string) => ({
    workspace: { id, name, rootPath: `/r/${id}`, remoteUrl: `https://github.com/acme/${name}.git` },
    gitInfo: { isGitRepo: true, branch: 'main', dirty: false, remoteUrl: `https://github.com/acme/${name}.git` },
});

function clusterPresent(): boolean {
    return !!screen.queryByTestId('ws-status-indicator')
        || !!document.getElementById('admin-toggle')
        || !!screen.queryByTestId('notification-bell');
}

beforeEach(() => {
    mockRemoteShell = true;
    mockSplitPanel = true;
    mockIsMobile = false;
    mockRepos = [repo('a', 'shortcuts')];
    mockAppState = {
        activeTab: 'repos',
        activeRepoSubTab: 'chats',
        selectedRepoId: 'a',
        currentAgentId: null,
        repoTabState: {},
        repoRouteState: {},
        notePathState: {},
        wsStatus: 'open',
    };
});

describe('TopBar status cluster placement', () => {
    it('hides the topbar cluster when the sidebar footer hosts it (remote shell + split + chat sub-tab)', () => {
        render(<TopBar />);
        expect(clusterPresent()).toBe(false);
        // The topbar still shows the remote header + New button.
        expect(screen.getByTestId('remote-shell-header')).toBeTruthy();
        expect(screen.getByTestId('header-new-btn')).toBeTruthy();
    });

    it('keeps the topbar cluster on a non-chat repo sub-tab (footer absent there)', () => {
        mockAppState = { ...mockAppState, activeRepoSubTab: 'work-items' };
        render(<TopBar />);
        expect(clusterPresent()).toBe(true);
    });

    it('keeps the topbar cluster when the split workspace panel is disabled (no footer to move into)', () => {
        mockSplitPanel = false;
        render(<TopBar />);
        expect(clusterPresent()).toBe(true);
    });

    it('keeps the topbar cluster when the remote shell is off', () => {
        mockRemoteShell = false;
        render(<TopBar />);
        expect(clusterPresent()).toBe(true);
    });

    it('keeps the topbar cluster off the repos tab', () => {
        mockAppState = { ...mockAppState, activeTab: 'wiki' };
        render(<TopBar />);
        expect(clusterPresent()).toBe(true);
    });

    it('keeps the topbar cluster on mobile (no remote sidebar footer there)', () => {
        mockIsMobile = true;
        render(<TopBar />);
        expect(clusterPresent()).toBe(true);
    });

    it('accepts the classic activity sub-tab as the chat view too', () => {
        mockAppState = { ...mockAppState, activeRepoSubTab: 'activity' };
        render(<TopBar />);
        expect(clusterPresent()).toBe(false);
    });
});
