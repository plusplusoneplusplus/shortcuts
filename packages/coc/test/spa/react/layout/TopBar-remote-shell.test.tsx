/**
 * TopBar remote-shell header tests.
 *
 * The remote-first shell is now a single header row: when features.remoteShell
 * is on (desktop, repos tab, a clone selected), the TopBar renders
 * RemoteShellHeader. When there is no concrete clone selected (cold start or a
 * virtual workspace), it falls back to the normal repo strip.
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
    repoRouteState: {},
    notePathState: {},
    wsStatus: 'open',
};
let mockRepos: any[] = [];
let mockRemoteShell = true;
let mockMyLifeEnabled = false;
let mockSplitPanel = false;

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
    useMyLifeEnabled: () => mockMyLifeEnabled,
}));
vi.mock('../../../../src/server/spa/client/react/hooks/feature-flags/useSplitWorkspacePanelEnabled', () => ({
    useSplitWorkspacePanelEnabled: () => mockSplitPanel,
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
    mockMyLifeEnabled = false;
    mockSplitPanel = false;
    localStorage.clear();
    mockAppState = {
        activeTab: 'repos',
        selectedRepoId: 'a',
        currentAgentId: null,
        repoTabState: {},
        repoRouteState: {},
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

    it('falls back to the RepoTabStrip off the repos tab so the header stays consistent', () => {
        mockAppState = { ...mockAppState, activeTab: 'wiki' };
        render(<TopBar />);

        // No workspace-specific remote header / + New off the repos tab...
        expect(screen.queryByTestId('remote-shell-header')).toBeNull();
        expect(screen.queryByTestId('header-new-btn')).toBeNull();
        // ...but the repo strip still renders so the top row matches the default page.
        expect(screen.getByTestId('repo-tab-strip')).toBeTruthy();
    });

    it('renders the RepoTabStrip on the admin tab (consistent top row)', () => {
        mockAppState = { ...mockAppState, activeTab: 'admin' };
        render(<TopBar />);

        expect(screen.queryByTestId('remote-shell-header')).toBeNull();
        expect(screen.queryByTestId('header-new-btn')).toBeNull();
        expect(screen.getByTestId('repo-tab-strip')).toBeTruthy();
    });

    it('falls back to the classic RepoTabStrip when no clone is selected', () => {
        mockAppState = { ...mockAppState, selectedRepoId: null };
        render(<TopBar />);

        expect(screen.queryByTestId('remote-shell-header')).toBeNull();
        expect(screen.queryByTestId('header-new-btn')).toBeNull();
        expect(screen.getByTestId('repo-tab-strip')).toBeTruthy();
    });

    it('falls back to the classic RepoTabStrip for the My Life virtual workspace', () => {
        mockMyLifeEnabled = true;
        mockAppState = { ...mockAppState, selectedRepoId: 'my_life' };
        render(<TopBar />);

        expect(screen.queryByTestId('remote-shell-header')).toBeNull();
        expect(screen.queryByTestId('header-new-btn')).toBeNull();
        expect(screen.getByTestId('repo-tab-strip')).toBeTruthy();
    });
});

describe('TopBar remote-shell — workspace dock toggle', () => {
    it('renders the dock toggle immediately after + New when splitWorkspacePanel is on', () => {
        mockSplitPanel = true;
        render(<TopBar />);

        const actions = screen.getByTestId('topbar-actions');
        const kids = Array.from(actions.children).map(c => c.getAttribute('data-testid'));
        // Order: [+ New][dock toggle][…status cluster]
        expect(kids[0]).toBe('header-new-btn');
        expect(kids[1]).toBe('workspace-dock-toggle');
    });

    it('toggles the shared open state (aria-pressed + persistence) for the active clone', () => {
        mockSplitPanel = true;
        render(<TopBar />);

        const toggle = screen.getByTestId('workspace-dock-toggle');
        expect(toggle.getAttribute('aria-pressed')).toBe('false');

        fireEvent.click(toggle);
        expect(screen.getByTestId('workspace-dock-toggle').getAttribute('aria-pressed')).toBe('true');
        // Persisted under the active clone's per-workspace key ('a').
        expect(localStorage.getItem('split-workspace:a:dock-open')).toBe('1');
    });

    it('hides the dock toggle when splitWorkspacePanel is off', () => {
        mockSplitPanel = false;
        render(<TopBar />);
        expect(screen.getByTestId('header-new-btn')).toBeTruthy();
        expect(screen.queryByTestId('workspace-dock-toggle')).toBeNull();
    });

    it('hides the dock toggle outside the remote-first shell', () => {
        mockSplitPanel = true;
        mockRemoteShell = false;
        render(<TopBar />);
        // No remote header → no + New and no dock toggle in the TopBar (the classic
        // shell keeps its dock toggle in RepoDetail's own header).
        expect(screen.queryByTestId('workspace-dock-toggle')).toBeNull();
    });
});
