/**
 * TopBar remote-shell header tests.
 *
 * On desktop, TopBar always renders RemoteShellHeader — including on top-level
 * pages (Admin / Settings) and cold loads with no repository selected.
 * Repository selection controls what appears *inside* the header (full clusters
 * vs. the unselected "Select repository" picker), not which header system is shown.
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
let mockMyWorkEnabled = false;
let mockMyLifeEnabled = false;
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
vi.mock('../../../../src/server/spa/client/react/hooks/feature-flags/useMyWorkEnabled', () => ({
    useMyWorkEnabled: () => mockMyWorkEnabled,
}));
vi.mock('../../../../src/server/spa/client/react/hooks/feature-flags/useMyLifeEnabled', () => ({
    useMyLifeEnabled: () => mockMyLifeEnabled,
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
    mockMyWorkEnabled = false;
    mockMyLifeEnabled = false;

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

    it.each(['repos', 'stats', 'admin'])('never renders the header + New button on the %s tab', (tab) => {
        mockAppState = { ...mockAppState, activeTab: tab };
        render(<TopBar />);

        // The topbar "+ New" (queue dialog) was removed; the right-panel toggle
        // is now the first right-side action.
        expect(screen.queryByTestId('header-new-btn')).toBeNull();
        expect(screen.queryByRole('button', { name: /^\+?\s*New$/ })).toBeNull();
        expect(screen.getByTestId('topbar-actions').firstElementChild?.getAttribute('data-testid')).toBe('workspace-dock-toggle');
        expect(mockQueueDispatch).not.toHaveBeenCalled();
    });

    it('keeps the RemoteShellHeader off the repos tab (e.g. Stats) when a clone is selected', () => {
        mockAppState = { ...mockAppState, activeTab: 'stats' };
        render(<TopBar />);

        // The workspace-specific header stays put on the top-level pages so the
        // top row matches the workspace views...
        expect(screen.getByTestId('remote-shell-header')).toBeTruthy();
        // ...and the plain repo strip does not take over.
        expect(screen.queryByTestId('repo-tab-strip')).toBeNull();
    });

    it('keeps the RemoteShellHeader on the admin tab when a clone is selected', () => {
        mockAppState = { ...mockAppState, activeTab: 'admin' };
        render(<TopBar />);

        expect(screen.getByTestId('remote-shell-header')).toBeTruthy();
        expect(screen.queryByTestId('repo-tab-strip')).toBeNull();
    });

    it('renders the unselected remote picker (not RepoTabStrip) when no clone is selected', () => {
        mockAppState = { ...mockAppState, selectedRepoId: null };
        render(<TopBar />);

        // Remote shell is on — the header stays in the remote-first design even
        // without a concrete clone; the unselected picker fills the left cluster.
        expect(screen.getByTestId('remote-shell-header')).toBeTruthy();
        expect(screen.queryByTestId('repo-tab-strip')).toBeNull();
        // The dock toggle requires a concrete clone.
        expect(screen.queryByTestId('workspace-dock-toggle')).toBeNull();
    });

    it('renders the unselected remote picker on Admin cold load (no clone selected)', () => {
        mockAppState = { ...mockAppState, activeTab: 'admin', selectedRepoId: null };
        render(<TopBar />);

        // No selection + Admin tab → remote-first shell still holds; no strip swap.
        expect(screen.getByTestId('remote-shell-header')).toBeTruthy();
        expect(screen.queryByTestId('repo-tab-strip')).toBeNull();
    });

    it('renders the virtual-workspace header for the My Work virtual workspace', () => {
        mockMyWorkEnabled = true;
        mockAppState = { ...mockAppState, selectedRepoId: 'my_work' };
        render(<TopBar />);

        const header = screen.getByTestId('virtual-workspace-shell-header');
        expect(header).toBeTruthy();
        expect(header.getAttribute('data-workspace')).toBe('my_work');
        // Neither the repo strip nor the repo-scoped remote header apply.
        expect(screen.queryByTestId('repo-tab-strip')).toBeNull();
        expect(screen.queryByTestId('remote-shell-header')).toBeNull();
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

    it('does not render the virtual header off the repos tab (e.g. on Stats)', () => {
        mockMyWorkEnabled = true;
        mockAppState = { ...mockAppState, activeTab: 'stats', selectedRepoId: 'my_work' };
        render(<TopBar />);

        // Virtual header requires isOnReposTab; off that tab the remote-first shell
        // renders instead (not the classic strip).
        expect(screen.queryByTestId('virtual-workspace-shell-header')).toBeNull();
        expect(screen.getByTestId('remote-shell-header')).toBeTruthy();
        expect(screen.queryByTestId('repo-tab-strip')).toBeNull();
    });
});

describe('TopBar remote-shell — workspace dock toggle', () => {
    it('renders one right-panel toggle as the first right-side action when splitWorkspacePanel is on', () => {
        render(<TopBar />);

        const actions = screen.getByTestId('topbar-actions');
        const kids = Array.from(actions.children).map(c => c.getAttribute('data-testid'));
        // Order: [right-panel toggle][…status cluster]
        expect(kids[0]).toBe('workspace-dock-toggle');
        expect(screen.getByRole('button', { name: 'Show right panel' }).getAttribute('title')).toBe('Show right panel; Ctrl+\\ shows/hides right panel');
        expect(screen.queryByRole('button', { name: 'Show Search' })).toBeNull();
    });

    it('opens and closes the panel for the active clone', () => {
        render(<TopBar />);

        fireEvent.click(screen.getByRole('button', { name: 'Show right panel' }));
        expect(screen.getByRole('button', { name: 'Expand right panel' }).getAttribute('aria-expanded')).toBe('true');
        expect(localStorage.getItem('split-workspace:a:dock-open')).toBe('1');

        fireEvent.click(screen.getByRole('button', { name: 'Expand right panel' }));
        fireEvent.click(screen.getByRole('button', { name: 'Hide right panel' }));
        expect(localStorage.getItem('split-workspace:a:dock-open')).toBe('0');
    });

});
