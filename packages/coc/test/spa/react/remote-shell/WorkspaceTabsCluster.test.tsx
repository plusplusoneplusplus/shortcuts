/**
 * WorkspaceTabsCluster — single-row workspace cluster tests.
 *
 * @vitest-environment jsdom
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

const mockSelectClone = vi.fn();
const mockSwitchSubTab = vi.fn();
let mockAppState: any = { activeTab: 'repos', activeRepoSubTab: 'chats' };
let mockQueueState: any = { repoQueueMap: {} };
let mockQueueStats: any = { running: 0, queued: 0 };
let mockGitInfo: any = { ahead: 0, behind: 0 };
let mockUnseenCounts: Record<string, number> = {};
let mockSplitWorkspacePanelEnabled = false;
let mockSchedulesInScheduledSlideEnabled = false;

vi.mock('../../../../src/server/spa/client/react/api/cocClient', () => ({
    getSpaCocClient: () => ({
        preferences: {
            getGlobal: vi.fn().mockResolvedValue({ recentRemotes: [] }),
            patchGlobal: vi.fn().mockResolvedValue({}),
        },
    }),
}));
vi.mock('../../../../src/server/spa/client/react/contexts/AppContext', () => ({ useApp: () => ({ state: mockAppState, dispatch: vi.fn() }) }));
vi.mock('../../../../src/server/spa/client/react/contexts/QueueContext', () => ({ useQueue: () => ({ state: mockQueueState, dispatch: vi.fn() }) }));
vi.mock('../../../../src/server/spa/client/react/contexts/ReposContext', () => ({ useRepos: () => ({ fetchRepos: vi.fn(), repos: [], unseenCounts: mockUnseenCounts }) }));
vi.mock('../../../../src/server/spa/client/react/hooks/feature-flags/useTerminalEnabled', () => ({ useTerminalEnabled: () => true }));
vi.mock('../../../../src/server/spa/client/react/features/notes/hooks/useNotesEnabled', () => ({ useNotesEnabled: () => true }));
vi.mock('../../../../src/server/spa/client/react/hooks/feature-flags/useWorkflowsEnabled', () => ({ useWorkflowsEnabled: () => true }));
vi.mock('../../../../src/server/spa/client/react/hooks/feature-flags/usePullRequestsEnabled', () => ({ usePullRequestsEnabled: () => true }));
vi.mock('../../../../src/server/spa/client/react/hooks/feature-flags/useDreamsEnabled', () => ({ useDreamsEnabled: () => true }));
vi.mock('../../../../src/server/spa/client/react/hooks/feature-flags/useNativeCliSessionsEnabled', () => ({ useNativeCliSessionsEnabled: () => true }));
vi.mock('../../../../src/server/spa/client/react/hooks/feature-flags/useShowPlanDepTab', () => ({ useShowPlanDepTab: () => true }));
vi.mock('../../../../src/server/spa/client/react/hooks/feature-flags/useSplitWorkspacePanelEnabled', () => ({ useSplitWorkspacePanelEnabled: () => mockSplitWorkspacePanelEnabled }));
vi.mock('../../../../src/server/spa/client/react/hooks/feature-flags/useSchedulesInScheduledSlideEnabled', () => ({ useSchedulesInScheduledSlideEnabled: () => mockSchedulesInScheduledSlideEnabled }));
vi.mock('../../../../src/server/spa/client/react/hooks/preferences/useUiLayoutMode', () => ({ useUiLayoutMode: () => ['dev-workflow', vi.fn()] }));
vi.mock('../../../../src/server/spa/client/react/queue/hooks/useRepoQueueStats', () => ({ useRepoQueueStats: () => mockQueueStats, isHidden: () => false }));
vi.mock('../../../../src/server/spa/client/react/features/git/hooks/useGitInfo', () => ({ useGitInfo: () => mockGitInfo }));
vi.mock('../../../../src/server/spa/client/react/features/remote-shell/useShellNavigation', () => ({
    useShellNavigation: () => ({ selectClone: mockSelectClone, switchSubTab: mockSwitchSubTab }),
}));
const mockRemoveWorkspace = vi.fn().mockResolvedValue(undefined);
vi.mock('../../../../src/server/spa/client/react/repos/repositoryService', () => ({
    removeWorkspace: (...args: unknown[]) => mockRemoveWorkspace(...args),
}));

import { WorkspaceTabsCluster } from '../../../../src/server/spa/client/react/features/remote-shell/WorkspaceTabsCluster';

const SHORTCUTS = 'https://github.com/acme/shortcuts.git';
const repo = (id: string, name: string, branch = 'main') => ({
    workspace: { id, name, color: '#0078d4', remoteUrl: SHORTCUTS, rootPath: `/r/${id}` },
    gitInfo: { isGitRepo: true, branch, dirty: false, remoteUrl: SHORTCUTS },
});

beforeEach(() => {
    cleanup();
    mockSelectClone.mockReset();
    mockSwitchSubTab.mockReset();
    mockRemoveWorkspace.mockReset().mockResolvedValue(undefined);
    mockAppState = { activeTab: 'repos', activeRepoSubTab: 'chats' };
    mockQueueState = { repoQueueMap: {} };
    mockQueueStats = { running: 0, queued: 0 };
    mockGitInfo = { ahead: 0, behind: 0 };
    mockUnseenCounts = {};
    mockSplitWorkspacePanelEnabled = false;
    mockSchedulesInScheduledSlideEnabled = false;
});

describe('WorkspaceTabsCluster', () => {
    it('renders clone-scoped tabs without leaking remote-scoped tabs', () => {
        const repos = [repo('a', 'shortcuts'), repo('b', 'shortcuts-2')];
        render(<WorkspaceTabsCluster repo={repos[0] as any} repos={repos as any} />);

        const cloneTabs = screen.getAllByTestId('clone-scope-tab').map(el => el.getAttribute('data-subtab'));
        expect(cloneTabs).toContain('git');
        expect(cloneTabs).toContain('terminal');
        expect(cloneTabs).not.toContain('work-items');
        expect(cloneTabs).not.toContain('pull-requests');
    });

    it('opens the clone popover and selects another clone', () => {
        const repos = [repo('a', 'shortcuts'), repo('b', 'shortcuts-2')];
        render(<WorkspaceTabsCluster repo={repos[0] as any} repos={repos as any} />);

        fireEvent.click(screen.getByTestId('clone-switch'));
        const items = screen.getAllByTestId('clone-popover-item');
        expect(items).toHaveLength(2);
        fireEvent.click(items[1]);
        expect(mockSelectClone).toHaveBeenCalledWith('b');
    });

    it('switches clone-scoped tabs through shell navigation', () => {
        const repos = [repo('a', 'shortcuts'), repo('b', 'shortcuts-2')];
        render(<WorkspaceTabsCluster repo={repos[0] as any} repos={repos as any} />);

        const git = screen.getAllByTestId('clone-scope-tab').find(el => el.getAttribute('data-subtab') === 'git')!;
        fireEvent.click(git);
        expect(mockSwitchSubTab).toHaveBeenCalledWith('git');
    });

    it('highlights the active clone sub-tab on the repos tab', () => {
        mockAppState = { activeTab: 'repos', activeRepoSubTab: 'git' };
        const repos = [repo('a', 'shortcuts'), repo('b', 'shortcuts-2')];
        render(<WorkspaceTabsCluster repo={repos[0] as any} repos={repos as any} />);

        const git = screen.getAllByTestId('clone-scope-tab').find(el => el.getAttribute('data-subtab') === 'git')!;
        expect(git.getAttribute('data-active')).toBe('true');
    });

    it('does not highlight any sub-tab off the repos tab (e.g. Admin)', () => {
        // The header still renders on the top-level pages, but no workspace sub-tab
        // is being viewed there — so none should show as active.
        mockAppState = { activeTab: 'admin', activeRepoSubTab: 'git' };
        const repos = [repo('a', 'shortcuts'), repo('b', 'shortcuts-2')];
        render(<WorkspaceTabsCluster repo={repos[0] as any} repos={repos as any} />);

        const active = screen.getAllByTestId('clone-scope-tab').filter(el => el.getAttribute('data-active') === 'true');
        expect(active).toHaveLength(0);
    });

    it('shows the schedules tab by default (flag off)', () => {
        const repos = [repo('a', 'shortcuts'), repo('b', 'shortcuts-2')];
        render(<WorkspaceTabsCluster repo={repos[0] as any} repos={repos as any} />);

        const cloneTabs = screen.getAllByTestId('clone-scope-tab').map(el => el.getAttribute('data-subtab'));
        expect(cloneTabs).toContain('schedules');
    });

    it('hides the standalone schedules tab when schedules-in-scheduled-slide is enabled', () => {
        mockSchedulesInScheduledSlideEnabled = true;
        const repos = [repo('a', 'shortcuts'), repo('b', 'shortcuts-2')];
        render(<WorkspaceTabsCluster repo={repos[0] as any} repos={repos as any} />);

        const cloneTabs = screen.getAllByTestId('clone-scope-tab').map(el => el.getAttribute('data-subtab'));
        expect(cloneTabs).not.toContain('schedules');
    });

    it('hides the standalone git tab when split workspace panel is enabled', () => {
        mockSplitWorkspacePanelEnabled = true;
        const repos = [repo('a', 'shortcuts'), repo('b', 'shortcuts-2')];
        render(<WorkspaceTabsCluster repo={repos[0] as any} repos={repos as any} />);

        const cloneTabs = screen.getAllByTestId('clone-scope-tab');
        expect(cloneTabs.map(el => el.getAttribute('data-subtab'))).not.toContain('git');
        const chatTab = cloneTabs.find(el => el.getAttribute('data-subtab') === 'chats');
        expect(chatTab?.textContent).toContain('Workspace');
    });
});

/**
 * AC-02 — "Remove from CoC" works for remote (agent-hosted) repos, except when
 * the owning server is unreachable (removal is routed there, so it would fail).
 */
describe('WorkspaceTabsCluster remove menu (AC-02)', () => {
    const remoteRepo = (id: string, name: string, connection: string) => ({
        workspace: {
            id, name, remoteUrl: SHORTCUTS, rootPath: `/remote/${id}`,
            remote: { baseUrl: 'http://127.0.0.1:4000', serverId: 'srv-1', serverLabel: 'devbox', connection, queue: 'idle' },
        },
        gitInfo: { isGitRepo: true, branch: 'main', dirty: false, remoteUrl: SHORTCUTS },
    });

    const openRemoveItem = (repos: any[], target: any) => {
        render(<WorkspaceTabsCluster repo={repos[0] as any} repos={repos as any} />);
        fireEvent.click(screen.getByTestId('clone-switch'));
        const row = screen.getAllByTestId('clone-popover-item')
            .find(el => el.textContent?.includes(target.workspace.name))!;
        fireEvent.contextMenu(row);
        return screen.getAllByRole('menuitem').find(el => el.textContent?.includes('Remove from CoC'))!;
    };

    it('enables Remove for a remote repo whose server is online', () => {
        const repos = [repo('a', 'shortcuts'), remoteRepo('r', 'shortcuts-remote', 'online')];
        const item = openRemoveItem(repos, repos[1]);
        expect(item).toBeTruthy();
        expect(item.hasAttribute('disabled')).toBe(false);
    });

    it('disables Remove for an offline remote repo and names the server in the tooltip', () => {
        const repos = [repo('a', 'shortcuts'), remoteRepo('r', 'shortcuts-remote', 'offline')];
        const item = openRemoveItem(repos, repos[1]);
        expect(item.hasAttribute('disabled')).toBe(true);
        expect(item.closest('[title]')?.getAttribute('title')).toBe('Cannot remove - devbox is offline');
    });

    it('enables Remove for a local repo', () => {
        const repos = [repo('a', 'shortcuts'), repo('b', 'shortcuts-2')];
        const item = openRemoveItem(repos, repos[0]);
        expect(item.hasAttribute('disabled')).toBe(false);
    });

    it('falls back to a sibling clone when the removed repo is the selected one', async () => {
        const repos = [repo('a', 'shortcuts'), repo('b', 'shortcuts-2')];
        const item = openRemoveItem(repos, repos[0]);
        fireEvent.click(item);
        fireEvent.click(screen.getByTestId('clone-remove-confirm-btn'));

        await waitFor(() => expect(mockRemoveWorkspace).toHaveBeenCalledWith('a'));
        await waitFor(() => expect(mockSelectClone).toHaveBeenCalledWith('b'));
    });

    it('leaves selection alone when removing a non-selected clone', async () => {
        const repos = [repo('a', 'shortcuts'), repo('b', 'shortcuts-2')];
        const item = openRemoveItem(repos, repos[1]);
        fireEvent.click(item);
        fireEvent.click(screen.getByTestId('clone-remove-confirm-btn'));

        await waitFor(() => expect(mockRemoveWorkspace).toHaveBeenCalledWith('b'));
        expect(mockSelectClone).not.toHaveBeenCalled();
    });

    /** AC-03 — the confirm dialog warns about active work but never blocks. */
    it('warns about running/queued chats in the confirm dialog', async () => {
        mockQueueState = {
            repoQueueMap: { b: { running: [{ id: 't1' }, { id: 't2' }], queued: [{ id: 't3' }] } },
        };
        const repos = [repo('a', 'shortcuts'), repo('b', 'shortcuts-2')];
        const item = openRemoveItem(repos, repos[1]);
        fireEvent.click(item);

        expect(screen.getByTestId('clone-remove-active-work').textContent)
            .toBe('2 running, 1 queued chats will keep running');

        // warn, do not block
        fireEvent.click(screen.getByTestId('clone-remove-confirm-btn'));
        await waitFor(() => expect(mockRemoveWorkspace).toHaveBeenCalledWith('b'));
    });

    it('omits the warning line when the repo has no active work', () => {
        const repos = [repo('a', 'shortcuts'), repo('b', 'shortcuts-2')];
        const item = openRemoveItem(repos, repos[1]);
        fireEvent.click(item);

        expect(screen.getByTestId('clone-remove-confirm-btn')).toBeTruthy();
        expect(screen.queryByTestId('clone-remove-active-work')).toBeNull();
    });
});
