/**
 * TopBar remote-shell header tests.
 *
 * The remote-first shell is the visual system gate: when features.remoteShell is
 * on (desktop), TopBar always renders RemoteShellHeader — including on top-level
 * pages (Admin / Settings / Wiki) and cold loads with no repository selected.
 * Repository selection controls what appears *inside* the header (full clusters
 * vs. the unselected "Select repository" picker), not which header system is shown.
 * RepoTabStrip is only rendered in classic mode (remoteShell off).
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
let mockMyWorkEnabled = false;
let mockMyLifeEnabled = false;
let mockSplitPanel = false;
let mockIsMobile = false;

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
vi.mock('../../../../src/server/spa/client/react/features/remote-shell/VirtualWorkspaceShellHeader', () => ({
    VirtualWorkspaceShellHeader: (props: any) => (
        <div data-testid="virtual-workspace-shell-header" data-workspace={props.config?.workspaceId} />
    ),
}));
vi.mock('../../../../src/server/spa/client/react/hooks/feature-flags/useRemoteShellEnabled', () => ({
    useRemoteShellEnabled: () => mockRemoteShell,
}));
vi.mock('../../../../src/server/spa/client/react/hooks/feature-flags/useMyWorkEnabled', () => ({
    useMyWorkEnabled: () => mockMyWorkEnabled,
}));
vi.mock('../../../../src/server/spa/client/react/hooks/feature-flags/useMyLifeEnabled', () => ({
    useMyLifeEnabled: () => mockMyLifeEnabled,
}));
vi.mock('../../../../src/server/spa/client/react/hooks/feature-flags/useSplitWorkspacePanelEnabled', () => ({
    useSplitWorkspacePanelEnabled: () => mockSplitPanel,
}));
vi.mock('../../../../src/server/spa/client/react/hooks/ui/useBreakpoint', () => ({
    useBreakpoint: () => ({
        breakpoint: mockIsMobile ? 'mobile' : 'desktop',
        isMobile: mockIsMobile,
        isTablet: false,
        isDesktop: !mockIsMobile,
    }),
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
    mockMyWorkEnabled = false;
    mockMyLifeEnabled = false;
    mockSplitPanel = false;
    mockIsMobile = false;
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

    it('keeps the RemoteShellHeader off the repos tab (e.g. Wiki) when a clone is selected', () => {
        mockAppState = { ...mockAppState, activeTab: 'wiki' };
        render(<TopBar />);

        // The workspace-specific header (and its + New) stay put on the top-level
        // pages so the top row matches the workspace views...
        expect(screen.getByTestId('remote-shell-header')).toBeTruthy();
        expect(screen.getByTestId('header-new-btn')).toBeTruthy();
        // ...and the plain repo strip does not take over.
        expect(screen.queryByTestId('repo-tab-strip')).toBeNull();
    });

    it('keeps the RemoteShellHeader on the admin tab when a clone is selected', () => {
        mockAppState = { ...mockAppState, activeTab: 'admin' };
        render(<TopBar />);

        expect(screen.getByTestId('remote-shell-header')).toBeTruthy();
        expect(screen.getByTestId('header-new-btn')).toBeTruthy();
        expect(screen.queryByTestId('repo-tab-strip')).toBeNull();
    });

    it('renders the unselected remote picker (not RepoTabStrip) when no clone is selected', () => {
        mockAppState = { ...mockAppState, selectedRepoId: null };
        render(<TopBar />);

        // Remote shell is on — the header stays in the remote-first design even
        // without a concrete clone; the unselected picker fills the left cluster.
        expect(screen.getByTestId('remote-shell-header')).toBeTruthy();
        expect(screen.queryByTestId('repo-tab-strip')).toBeNull();
        // + New and dock toggle require a concrete clone.
        expect(screen.queryByTestId('header-new-btn')).toBeNull();
    });

    it('renders the unselected remote picker on Admin cold load (no clone selected)', () => {
        mockAppState = { ...mockAppState, activeTab: 'admin', selectedRepoId: null };
        render(<TopBar />);

        // No selection + Admin tab → remote-first shell still holds; no strip swap.
        expect(screen.getByTestId('remote-shell-header')).toBeTruthy();
        expect(screen.queryByTestId('repo-tab-strip')).toBeNull();
        expect(screen.queryByTestId('header-new-btn')).toBeNull();
    });

    it('renders the virtual-workspace header for the My Work virtual workspace', () => {
        mockMyWorkEnabled = true;
        mockAppState = { ...mockAppState, selectedRepoId: 'my_work' };
        render(<TopBar />);

        const header = screen.getByTestId('virtual-workspace-shell-header');
        expect(header).toBeTruthy();
        expect(header.getAttribute('data-workspace')).toBe('my_work');
        // Neither the repo strip nor the repo-scoped remote header / + New apply.
        expect(screen.queryByTestId('repo-tab-strip')).toBeNull();
        expect(screen.queryByTestId('remote-shell-header')).toBeNull();
        expect(screen.queryByTestId('header-new-btn')).toBeNull();
    });

    it('renders the virtual-workspace header for the My Life virtual workspace', () => {
        mockMyLifeEnabled = true;
        mockAppState = { ...mockAppState, selectedRepoId: 'my_life' };
        render(<TopBar />);

        const header = screen.getByTestId('virtual-workspace-shell-header');
        expect(header).toBeTruthy();
        expect(header.getAttribute('data-workspace')).toBe('my_life');
        expect(screen.queryByTestId('repo-tab-strip')).toBeNull();
        expect(screen.queryByTestId('remote-shell-header')).toBeNull();
    });

    it('does not render the virtual header for My Work when it is disabled', () => {
        mockMyWorkEnabled = false;
        mockAppState = { ...mockAppState, selectedRepoId: 'my_work' };
        render(<TopBar />);

        expect(screen.queryByTestId('virtual-workspace-shell-header')).toBeNull();
        // Remote shell is on; no real clone resolves for 'my_work', so the
        // unselected remote picker is shown — not the classic strip.
        expect(screen.getByTestId('remote-shell-header')).toBeTruthy();
        expect(screen.queryByTestId('repo-tab-strip')).toBeNull();
    });

    it('falls back to the classic RepoTabStrip for My Work when remoteShell is off', () => {
        mockMyWorkEnabled = true;
        mockRemoteShell = false;
        mockAppState = { ...mockAppState, selectedRepoId: 'my_work' };
        render(<TopBar />);

        expect(screen.queryByTestId('virtual-workspace-shell-header')).toBeNull();
        expect(screen.getByTestId('repo-tab-strip')).toBeTruthy();
    });

    it('does not render the virtual header off the repos tab (e.g. on Wiki)', () => {
        mockMyWorkEnabled = true;
        mockAppState = { ...mockAppState, activeTab: 'wiki', selectedRepoId: 'my_work' };
        render(<TopBar />);

        // Virtual header requires isOnReposTab; off that tab the remote-first shell
        // renders instead (not the classic strip).
        expect(screen.queryByTestId('virtual-workspace-shell-header')).toBeNull();
        expect(screen.getByTestId('remote-shell-header')).toBeTruthy();
        expect(screen.queryByTestId('repo-tab-strip')).toBeNull();
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
