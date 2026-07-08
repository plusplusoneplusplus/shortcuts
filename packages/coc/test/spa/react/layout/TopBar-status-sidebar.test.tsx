/**
 * TopBar — status cluster placement for the remote-first shell.
 *
 * In the remote-first shell on desktop the status cluster (connection /
 * notifications / quota / admin / theme) moves to a global bottom status bar
 * (`GlobalStatusDock`) spanning every tab, so the topbar hides its own cluster
 * on EVERY tab and sub-tab — not just the chat/activity view. In classic
 * (non-remote) mode or on mobile the dock is absent, so the cluster must stay
 * in the topbar (otherwise the controls would vanish entirely — regression
 * guard). This must mirror `GlobalStatusDock`'s own `remoteShell && !isMobile`
 * gate so the two never both show and never both hide.
 *
 * @vitest-environment jsdom
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

let mockRemoteShell = true;
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
    it('hides the topbar cluster in the remote-first shell on desktop (chat sub-tab)', () => {
        render(<TopBar />);
        expect(clusterPresent()).toBe(false);
        // The topbar still shows the remote header + New button.
        expect(screen.getByTestId('remote-shell-header')).toBeTruthy();
        expect(screen.getByTestId('header-new-btn')).toBeTruthy();
    });

    it('hides the topbar cluster on every repo sub-tab, not just chat/activity (dock is global)', () => {
        mockAppState = { ...mockAppState, activeRepoSubTab: 'work-items' };
        render(<TopBar />);
        expect(clusterPresent()).toBe(false);
    });

    it('hides the topbar cluster off the repos tab too (dock spans every tab)', () => {
        mockAppState = { ...mockAppState, activeTab: 'wiki' };
        render(<TopBar />);
        expect(clusterPresent()).toBe(false);
    });

    it('still hides on the classic activity sub-tab', () => {
        mockAppState = { ...mockAppState, activeRepoSubTab: 'activity' };
        render(<TopBar />);
        expect(clusterPresent()).toBe(false);
    });

    it('keeps the topbar cluster when the remote shell is off (classic mode)', () => {
        mockRemoteShell = false;
        render(<TopBar />);
        expect(clusterPresent()).toBe(true);
    });

    it('keeps the topbar cluster on mobile (no room for a bottom status bar)', () => {
        mockIsMobile = true;
        render(<TopBar />);
        expect(clusterPresent()).toBe(true);
    });
});
