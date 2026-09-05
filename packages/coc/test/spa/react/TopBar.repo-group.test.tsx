/**
 * TopBar — repo-group virtual workspace header dispatch (AC-02).
 *
 * When a `group-<slug>` workspace is selected on the repos tab, the TopBar picks
 * the virtual-workspace shell header by ID PREFIX (unlike My Work / My Life,
 * which match by id equality), labels it with the registered group name, and
 * shows only the group's Workspace + Git + Notes + Settings sub-tabs.
 *
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useEffect } from 'react';

let mockRemoteGroupWorkspaces: any[] = [];
vi.mock('../../../src/server/spa/client/react/contexts/ReposContext', () => ({
    useRepos: () => ({ repos: [], unseenCounts: {}, fetchRepos: vi.fn(), loading: false, remoteGroupWorkspaces: mockRemoteGroupWorkspaces }),
    ReposProvider: ({ children }: { children: React.ReactNode }) => children,
}));
vi.mock('../../../src/server/spa/client/react/hooks/useApi', () => ({
    fetchApi: vi.fn().mockResolvedValue({}),
}));
vi.mock('../../../src/server/spa/client/react/contexts/QueueContext', () => ({
    QueueProvider: ({ children }: any) => children,
    useQueue: () => ({ state: { repoQueueMap: {}, queued: [], running: [], history: [] }, dispatch: vi.fn() }),
}));
vi.mock('../../../src/server/spa/client/react/shared/AgentProviderQuotaIndicator', () => ({
    agentProviderQuotaIndicator: () => null,
}));
vi.mock('../../../src/server/spa/client/react/hooks/ui/useBreakpoint', () => ({
    useBreakpoint: () => ({ breakpoint: 'desktop', isMobile: false, isTablet: false, isDesktop: true }),
}));
// The virtual shell header only renders in the remote-first desktop shell.
vi.mock('../../../src/server/spa/client/react/hooks/feature-flags/useRemoteShellEnabled', () => ({
    useRemoteShellEnabled: () => true,
}));
// Pin the flags the dock toggle and the other virtual workspaces are gated on,
// so AC-06's present/absent assertions do not depend on admin config defaults.
let mockSplitPanelEnabled = true;
vi.mock('../../../src/server/spa/client/react/hooks/feature-flags/useSplitWorkspacePanelEnabled', () => ({
    useSplitWorkspacePanelEnabled: () => mockSplitPanelEnabled,
}));
vi.mock('../../../src/server/spa/client/react/hooks/feature-flags/useMyWorkEnabled', () => ({
    useMyWorkEnabled: () => true,
}));
vi.mock('../../../src/server/spa/client/react/hooks/feature-flags/useMyLifeEnabled', () => ({
    useMyLifeEnabled: () => true,
}));

import { AppProvider, useApp } from '../../../src/server/spa/client/react/contexts/AppContext';
import { NotificationProvider } from '../../../src/server/spa/client/react/contexts/NotificationContext';
import { ThemeProvider } from '../../../src/server/spa/client/react/layout/ThemeProvider';
import { TopBar } from '../../../src/server/spa/client/react/layout/TopBar';
import { MY_WORK_WORKSPACE_ID } from '../../../src/server/spa/client/react/repos/MyWorkView';
import { MY_LIFE_WORKSPACE_ID } from '../../../src/server/spa/client/react/repos/MyLifeView';
import { workspaceDockOpenStorageKey } from '../../../src/server/spa/client/react/features/repo-detail/WorkspaceDockToggle';

const GROUP_ID = 'group-frontend';

function SeedGroupSelection({ withName, groupId = GROUP_ID }: { withName: boolean; groupId?: string }) {
    const { dispatch } = useApp();
    useEffect(() => {
        if (withName) {
            dispatch({
                type: 'WORKSPACES_LOADED',
                workspaces: [
                    { id: 'r1', name: 'shortcuts', rootPath: '/r/r1' },
                    { id: GROUP_ID, name: 'Frontend', rootPath: `/data/repos/${GROUP_ID}` },
                ],
            });
        }
        dispatch({ type: 'SET_ACTIVE_TAB', tab: 'repos' });
        dispatch({ type: 'SET_SELECTED_REPO', id: groupId });
    }, [dispatch, withName, groupId]);
    return null;
}

function renderTopBarWithGroup(withName = true, groupId = GROUP_ID) {
    return render(
        <AppProvider>
            <NotificationProvider>
                <ThemeProvider>
                    <SeedGroupSelection withName={withName} groupId={groupId} />
                    <TopBar />
                </ThemeProvider>
            </NotificationProvider>
        </AppProvider>
    );
}

beforeEach(() => {
    mockRemoteGroupWorkspaces = [];
    mockSplitPanelEnabled = true;
    localStorage.clear();
    location.hash = '';
    Object.defineProperty(window, 'matchMedia', {
        writable: true,
        configurable: true,
        value: vi.fn().mockImplementation((query: string) => ({
            matches: false,
            media: query,
            onchange: null,
            addListener: vi.fn(),
            removeListener: vi.fn(),
            addEventListener: vi.fn(),
            removeEventListener: vi.fn(),
            dispatchEvent: vi.fn(),
        })),
    });
});

afterEach(() => {
    cleanup();
    location.hash = '';
});

describe('TopBar — repo-group virtual header', () => {
    it('renders the virtual-workspace shell header for a group selection with only Workspace + Git + Notes + Settings tabs', () => {
        renderTopBarWithGroup();
        const header = screen.getByTestId('virtual-workspace-shell-header');
        expect(header.getAttribute('data-workspace')).toBe(GROUP_ID);
        expect(screen.getByTestId('repo-group-shell-tab-chats').textContent).toBe('Workspace');
        expect(screen.getByTestId('repo-group-shell-tab-git').textContent).toBe('Git');
        expect(screen.getByTestId('repo-group-shell-tab-notes').textContent).toBe('Notes');
        expect(screen.getByTestId('repo-group-shell-tab-settings').textContent).toBe('Settings');
        expect(header.querySelectorAll('button[data-subtab]')).toHaveLength(4);
    });

    // AC-01: Git is exposed for groups, but the OTHER git-dependent tabs stay
    // hidden — a group is not a git repo, only its members are.
    it('exposes Git but no other git-dependent tab for a group', () => {
        renderTopBarWithGroup();
        const header = screen.getByTestId('virtual-workspace-shell-header');
        const keys = [...header.querySelectorAll('button[data-subtab]')].map(b => b.getAttribute('data-subtab'));
        expect(keys).toContain('git');
        expect(keys).not.toContain('pull-requests');
        expect(keys).not.toContain('work-items');
        expect(keys).not.toContain('branches');
    });

    it('labels the header with the registered group name', () => {
        renderTopBarWithGroup();
        expect(screen.getByTestId('virtual-workspace-shell-header').textContent).toContain('Frontend');
    });

    it('labels a remote group from the aggregated remote groups, not its raw id', () => {
        mockRemoteGroupWorkspaces = [{ id: 'group-svc', name: 'Services', remote: { serverLabel: 'Devbox' } }];
        renderTopBarWithGroup(true, 'group-svc');
        const header = screen.getByTestId('virtual-workspace-shell-header').textContent ?? '';
        expect(header).toContain('Services');
        expect(header).not.toContain('group-svc');
    });

    it('falls back to the group id while the workspace list has not loaded', () => {
        renderTopBarWithGroup(false);
        expect(screen.getByTestId('virtual-workspace-shell-header').textContent).toContain(GROUP_ID);
    });

    it('does not render the virtual header for no selection', () => {
        render(
            <AppProvider>
                <NotificationProvider>
                    <ThemeProvider>
                        <TopBar />
                    </ThemeProvider>
                </NotificationProvider>
            </AppProvider>
        );
        expect(screen.queryByTestId('virtual-workspace-shell-header')).toBeNull();
    });
});

/**
 * AC-06 — the dock toggle in the TopBar. A repo group's dock body renders in
 * RepoGroupView; the toggle sits in the TopBar next to the virtual header and
 * shares the group-scoped cross-tree open store. My Work / My Life have no dock.
 */
describe('TopBar — repo-group dock toggle (AC-06)', () => {
    it('renders the dock toggle alongside the group virtual header', () => {
        renderTopBarWithGroup();
        expect(screen.getByTestId('workspace-dock-toggle')).toBeTruthy();
    });

    it('toggles the group-scoped dock-open key', () => {
        renderTopBarWithGroup();
        const key = workspaceDockOpenStorageKey(GROUP_ID);
        expect(localStorage.getItem(key)).toBeNull();

        act(() => {
            fireEvent.click(screen.getByTestId('workspace-dock-toggle'));
        });
        expect(localStorage.getItem(key)).toBe('1');
        expect(screen.getByTestId('workspace-dock-toggle').getAttribute('aria-pressed')).toBe('true');

        act(() => {
            fireEvent.click(screen.getByTestId('workspace-dock-toggle'));
        });
        expect(localStorage.getItem(key)).toBe('0');
    });

    it('hides the toggle when the split-workspace flag is off', () => {
        mockSplitPanelEnabled = false;
        renderTopBarWithGroup();
        expect(screen.queryByTestId('workspace-dock-toggle')).toBeNull();
    });

    it('renders no toggle for My Work or My Life', () => {
        renderTopBarWithGroup(true, MY_WORK_WORKSPACE_ID);
        expect(screen.getByTestId('virtual-workspace-shell-header')).toBeTruthy();
        expect(screen.queryByTestId('workspace-dock-toggle')).toBeNull();
        cleanup();

        renderTopBarWithGroup(true, MY_LIFE_WORKSPACE_ID);
        expect(screen.getByTestId('virtual-workspace-shell-header')).toBeTruthy();
        expect(screen.queryByTestId('workspace-dock-toggle')).toBeNull();
    });
});
