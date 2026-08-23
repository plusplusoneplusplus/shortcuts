/**
 * TopBar — repo-group virtual workspace header dispatch (AC-02).
 *
 * When a `group-<slug>` workspace is selected on the repos tab, the TopBar picks
 * the virtual-workspace shell header by ID PREFIX (unlike My Work / My Life,
 * which match by id equality), labels it with the registered group name, and
 * shows only the group's Workspace + Notes sub-tabs.
 *
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
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

import { AppProvider, useApp } from '../../../src/server/spa/client/react/contexts/AppContext';
import { NotificationProvider } from '../../../src/server/spa/client/react/contexts/NotificationContext';
import { ThemeProvider } from '../../../src/server/spa/client/react/layout/ThemeProvider';
import { TopBar } from '../../../src/server/spa/client/react/layout/TopBar';

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
    it('renders the virtual-workspace shell header for a group selection with only Workspace + Notes tabs', () => {
        renderTopBarWithGroup();
        const header = screen.getByTestId('virtual-workspace-shell-header');
        expect(header.getAttribute('data-workspace')).toBe(GROUP_ID);
        expect(screen.getByTestId('repo-group-shell-tab-chats').textContent).toBe('Workspace');
        expect(screen.getByTestId('repo-group-shell-tab-notes').textContent).toBe('Notes');
        expect(header.querySelectorAll('button[data-subtab]')).toHaveLength(2);
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
