/**
 * TopBar locked pop-out window (AC-02).
 *
 * When the window carries `?window=<id>` (surfaced via `useLockedWorkspaceId`),
 * TopBar hides every cross-scope switcher — the segmented ScopeSlideSwitcher,
 * the My Work / My Life toggles, the classic RepoTabStrip — and suppresses the
 * workspace identity chip in the remote/virtual headers, while keeping the
 * in-scope header (RemoteShellHeader / VirtualWorkspaceShellHeader) so the full
 * app for the scope still renders. The main (unlocked) window is unaffected.
 *
 * @vitest-environment jsdom
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

const mockAppDispatch = vi.fn();
const mockQueueDispatch = vi.fn();
let mockAppState: any;
let mockRepos: any[] = [];
let mockRemoteShell = true;
let mockScopeSwitcher = true;
let mockMyWorkEnabled = true;
let mockMyLifeEnabled = true;
let mockIsMobile = false;
let mockLockedId: string | null = null;

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
    agentProviderQuotaIndicator: () => <button aria-label="Agent provider quota" />,
}));
vi.mock('../../../../src/server/spa/client/react/repos/RepoManagementPopover', () => ({
    RepoManagementPopover: () => null,
}));
vi.mock('../../../../src/server/spa/client/react/features/repo-detail/RepoTabStrip', () => ({
    RepoTabStrip: () => <div data-testid="repo-tab-strip" />,
}));
vi.mock('../../../../src/server/spa/client/react/features/remote-shell/RemoteShellHeader', () => ({
    RemoteShellHeader: (props: any) => (
        <div data-testid="remote-shell-header" data-hide-identity={String(!!props.hideIdentity)} />
    ),
}));
vi.mock('../../../../src/server/spa/client/react/features/remote-shell/VirtualWorkspaceShellHeader', () => ({
    VirtualWorkspaceShellHeader: (props: any) => (
        <div
            data-testid="virtual-workspace-shell-header"
            data-workspace={props.config?.workspaceId}
            data-hide-identity={String(!!props.hideIdentity)}
        />
    ),
}));
vi.mock('../../../../src/server/spa/client/react/features/remote-shell/ScopeSlideSwitcher', () => ({
    ScopeSlideSwitcher: () => <div data-testid="scope-switcher" />,
}));
vi.mock('../../../../src/server/spa/client/react/hooks/feature-flags/useRemoteShellEnabled', () => ({
    useRemoteShellEnabled: () => mockRemoteShell,
}));
vi.mock('../../../../src/server/spa/client/react/hooks/feature-flags/useScopeSwitcherEnabled', () => ({
    useScopeSwitcherEnabled: () => mockScopeSwitcher,
}));
vi.mock('../../../../src/server/spa/client/react/hooks/feature-flags/useMyWorkEnabled', () => ({
    useMyWorkEnabled: () => mockMyWorkEnabled,
}));
vi.mock('../../../../src/server/spa/client/react/hooks/feature-flags/useMyLifeEnabled', () => ({
    useMyLifeEnabled: () => mockMyLifeEnabled,
}));
vi.mock('../../../../src/server/spa/client/react/hooks/feature-flags/useSplitWorkspacePanelEnabled', () => ({
    useSplitWorkspacePanelEnabled: () => false,
}));
vi.mock('../../../../src/server/spa/client/react/hooks/ui/useBreakpoint', () => ({
    useBreakpoint: () => ({
        breakpoint: mockIsMobile ? 'mobile' : 'desktop',
        isMobile: mockIsMobile,
        isTablet: false,
        isDesktop: !mockIsMobile,
    }),
}));
vi.mock('../../../../src/server/spa/client/react/features/scope-window/useWindowLock', () => ({
    useLockedWorkspaceId: () => mockLockedId,
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
    mockScopeSwitcher = true;
    mockMyWorkEnabled = true;
    mockMyLifeEnabled = true;
    mockIsMobile = false;
    mockLockedId = null;
    localStorage.clear();
    mockAppState = {
        activeTab: 'repos',
        selectedRepoId: 'a',
        currentAgentId: null,
        lastWorkspaceRepoId: 'a',
        repoTabState: {},
        repoRouteState: {},
        notePathState: {},
        wsStatus: 'open',
    };
    mockRepos = [repo('a', 'shortcuts')];
});

describe('TopBar — unlocked (main window) still shows the switcher', () => {
    it('renders the scope switcher when not locked', () => {
        render(<TopBar />);
        expect(screen.getByTestId('scope-switcher')).toBeTruthy();
        // Identity is owned by the slide switcher → remote header hides it.
        expect(screen.getByTestId('remote-shell-header').getAttribute('data-hide-identity')).toBe('true');
    });
});

describe('TopBar — locked pop-out window (AC-02)', () => {
    it('hides the scope switcher and My Work / My Life toggles for a repo scope', () => {
        mockLockedId = 'a';
        render(<TopBar />);

        expect(screen.queryByTestId('scope-switcher')).toBeNull();
        expect(document.getElementById('my-work-toggle')).toBeNull();
        expect(document.getElementById('my-life-toggle')).toBeNull();
        // The in-scope full-app header stays, with identity suppressed.
        const header = screen.getByTestId('remote-shell-header');
        expect(header).toBeTruthy();
        expect(header.getAttribute('data-hide-identity')).toBe('true');
    });

    it('hides the classic RepoTabStrip when locked (remote shell off)', () => {
        mockRemoteShell = false;
        mockLockedId = 'a';
        render(<TopBar />);
        expect(screen.queryByTestId('repo-tab-strip')).toBeNull();
        expect(screen.queryByTestId('scope-switcher')).toBeNull();
    });

    it('locks a virtual scope identically, suppressing its identity (AC-04)', () => {
        mockLockedId = 'my_work';
        mockAppState = { ...mockAppState, selectedRepoId: 'my_work' };
        render(<TopBar />);

        expect(screen.queryByTestId('scope-switcher')).toBeNull();
        expect(document.getElementById('my-work-toggle')).toBeNull();
        const header = screen.getByTestId('virtual-workspace-shell-header');
        expect(header.getAttribute('data-workspace')).toBe('my_work');
        expect(header.getAttribute('data-hide-identity')).toBe('true');
    });
});
