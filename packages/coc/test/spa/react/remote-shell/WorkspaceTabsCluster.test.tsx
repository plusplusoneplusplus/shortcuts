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
let mockGitInfo: any = { ahead: 0, behind: 0 };
let mockUnseenCounts: Record<string, number> = {};
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
vi.mock('../../../../src/server/spa/client/react/hooks/feature-flags/useWorkflowsEnabled', () => ({ useWorkflowsEnabled: () => true }));
vi.mock('../../../../src/server/spa/client/react/hooks/feature-flags/usePullRequestsEnabled', () => ({ usePullRequestsEnabled: () => true }));
vi.mock('../../../../src/server/spa/client/react/hooks/feature-flags/useDreamsEnabled', () => ({ useDreamsEnabled: () => true }));
vi.mock('../../../../src/server/spa/client/react/hooks/feature-flags/useNativeCliSessionsEnabled', () => ({ useNativeCliSessionsEnabled: () => true }));
vi.mock('../../../../src/server/spa/client/react/hooks/feature-flags/useShowPlanDepTab', () => ({ useShowPlanDepTab: () => true }));
vi.mock('../../../../src/server/spa/client/react/hooks/feature-flags/useSchedulesInScheduledSlideEnabled', () => ({ useSchedulesInScheduledSlideEnabled: () => mockSchedulesInScheduledSlideEnabled }));
vi.mock('../../../../src/server/spa/client/react/queue/hooks/useRepoQueueStats', () => ({ isHidden: () => false }));
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
    mockGitInfo = { ahead: 0, behind: 0 };
    mockUnseenCounts = {};

    mockSchedulesInScheduledSlideEnabled = false;
});

describe('WorkspaceTabsCluster', () => {
    it('renders clone-scoped tabs without leaking remote-scoped tabs', () => {
        const repos = [repo('a', 'shortcuts'), repo('b', 'shortcuts-2')];
        render(<WorkspaceTabsCluster repo={repos[0] as any} repos={repos as any} />);

        const cloneTabs = screen.getAllByTestId('clone-scope-tab').map(el => el.getAttribute('data-subtab'));
        expect(cloneTabs).not.toContain('git');
        expect(cloneTabs).not.toContain('terminal');
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

        const schedules = screen.getAllByTestId('clone-scope-tab').find(el => el.getAttribute('data-subtab') === 'schedules')!;
        fireEvent.click(schedules);
        expect(mockSwitchSubTab).toHaveBeenCalledWith('schedules');
    });

    it('returns to the workspace when the active clone tab is clicked again', () => {
        mockAppState = { activeTab: 'repos', activeRepoSubTab: 'schedules' };
        const selected = repo('a', 'shortcuts');
        render(<WorkspaceTabsCluster repo={selected as any} repos={[selected] as any} />);
        const schedules = screen.getAllByTestId('clone-scope-tab').find(el => el.getAttribute('data-subtab') === 'schedules')!;
        fireEvent.click(schedules);
        expect(mockSwitchSubTab).toHaveBeenCalledWith('activity');
    });

    it('keeps a remote clone key when switching its sub-tab', () => {
        const base = repo('shared', 'remote');
        const remote = {
            ...base,
            workspace: {
                ...base.workspace,
                remote: { serverId: 'server-1' },
            },
        };
        render(<WorkspaceTabsCluster repo={remote as any} repos={[remote] as any} />);

        const workflows = screen.getAllByTestId('clone-scope-tab')
            .find(el => el.getAttribute('data-subtab') === 'workflows')!;
        fireEvent.click(workflows);

        expect(mockSelectClone).toHaveBeenCalledWith('remote:server-1:shared', 'workflows');
        expect(mockSwitchSubTab).not.toHaveBeenCalled();
    });

    it('highlights the active clone sub-tab on the repos tab', () => {
        mockAppState = { activeTab: 'repos', activeRepoSubTab: 'workflows' };
        const repos = [repo('a', 'shortcuts'), repo('b', 'shortcuts-2')];
        render(<WorkspaceTabsCluster repo={repos[0] as any} repos={repos as any} />);

        const workflows = screen.getAllByTestId('clone-scope-tab').find(el => el.getAttribute('data-subtab') === 'workflows')!;
        expect(workflows.getAttribute('data-active')).toBe('true');
        expect(workflows.getAttribute('aria-current')).toBe('page');
    });

    it.each(['chats', 'activity'])('highlights no header tab on the workspace (%s route)', (activeRepoSubTab) => {
        mockAppState = { activeTab: 'repos', activeRepoSubTab };
        const selected = repo('a', 'shortcuts');
        render(<WorkspaceTabsCluster repo={selected as any} repos={[selected] as any} />);

        const active = screen.getAllByTestId('clone-scope-tab').filter(el => el.getAttribute('data-active') === 'true');
        expect(active).toHaveLength(0);
    });

    it('renders no Workspace, Notes or Settings header tab', () => {
        const selected = repo('a', 'shortcuts');
        render(<WorkspaceTabsCluster repo={selected as any} repos={[selected] as any} />);
        const cluster = screen.getByTestId('workspace-tabs-cluster');
        const keys = screen.getAllByTestId('clone-scope-tab').map(el => el.getAttribute('data-subtab'));
        for (const key of ['activity', 'chats', 'notes', 'settings']) expect(keys).not.toContain(key);
        const labels = screen.getAllByTestId('clone-scope-tab').map(el => el.textContent);
        expect(labels.some(label => /Workspace|Notes|Settings/.test(label ?? ''))).toBe(false);
        expect(cluster.querySelector('[data-measure-key="activity"]')).toBeNull();
    });

    it.each(['workflows', 'chats', 'activity'])('does not highlight %s off the repos tab', (activeRepoSubTab) => {
        // The header still renders on the top-level pages, but no workspace sub-tab
        // is being viewed there — so none should show as active.
        mockAppState = { activeTab: 'admin', activeRepoSubTab };
        const repos = [repo('a', 'shortcuts'), repo('b', 'shortcuts-2')];
        render(<WorkspaceTabsCluster repo={repos[0] as any} repos={repos as any} />);

        const active = screen.getAllByTestId('clone-scope-tab').filter(el => el.getAttribute('data-active') === 'true');
        expect(active).toHaveLength(0);
    });

    it('shows the selected workspace task count and updates it when switching clones', () => {
        const repos = [
            { ...repo('a', 'shortcuts'), taskCount: 3 },
            { ...repo('b', 'shortcuts-2'), taskCount: 7 },
        ];
        const { rerender } = render(<WorkspaceTabsCluster repo={repos[0] as any} repos={repos as any} />);

        expect(screen.getAllByTestId('subbar-tasks-badge')).toHaveLength(1);
        expect(screen.getByTestId('subbar-tasks-badge').textContent).toBe('3');
        expect(screen.getByTestId('subbar-tasks-badge').closest('button')?.getAttribute('data-subtab')).toBe('tasks');

        rerender(<WorkspaceTabsCluster repo={repos[1] as any} repos={repos as any} />);
        expect(screen.getByTestId('subbar-tasks-badge').textContent).toBe('7');
    });

    it.each([undefined, 0])('omits the task badge for count %s', (taskCount) => {
        const selected = { ...repo('a', 'shortcuts'), taskCount };
        render(<WorkspaceTabsCluster repo={selected as any} repos={[selected] as any} />);

        expect(screen.queryByTestId('subbar-tasks-badge')).toBeNull();
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
        const repos = [repo('a', 'shortcuts'), repo('b', 'shortcuts-2')];
        render(<WorkspaceTabsCluster repo={repos[0] as any} repos={repos as any} />);

        const cloneTabs = screen.getAllByTestId('clone-scope-tab');
        expect(cloneTabs.map(el => el.getAttribute('data-subtab'))).not.toContain('git');
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


describe('selected clone machine identity', () => {
    it('follows exact clone ownership when identical workspace IDs switch servers', async () => {
        const local = repo('shared', 'shortcuts');
        const remote = (serverId: string, serverLabel: string) => ({
            ...local,
            workspace: { ...local.workspace, baseUrl: `https://${serverId}.example`, remote: { serverId, serverLabel, connection: 'online' } },
        });
        const ubuntu = remote('ubuntu', 'ubuntu-arm');
        const other = remote('other', 'other-machine');
        const repos = [local, other, ubuntu];
        mockUnseenCounts = { shared: 5, 'remote:ubuntu:shared': 16 };
        const { rerender } = render(<WorkspaceTabsCluster repo={ubuntu} repos={repos} />);
        const trigger = () => screen.getByTestId('clone-switch');
        await waitFor(() => expect(trigger().getAttribute('aria-label')).toBe('shortcuts / ubuntu-arm'));
        expect(screen.getByTestId('workspace-machine-name').textContent).toBe('ubuntu-arm');
        expect(screen.getByTestId('clone-switch-unseen-badge').textContent).toBe('21');
        expect(trigger().textContent).toContain('· 3');
        fireEvent.click(trigger());
        fireEvent.click(screen.getAllByTestId('clone-popover-item')[0]);
        expect(mockSelectClone).toHaveBeenCalledWith('shared');
        rerender(<WorkspaceTabsCluster repo={local} repos={repos} />);
        expect(trigger().getAttribute('aria-label')).toBe('shortcuts / Local');
        rerender(<WorkspaceTabsCluster repo={other} repos={repos} />);
        expect(trigger().getAttribute('title')).toBe('shortcuts / other-machine');
        expect(screen.getByTestId('workspace-machine-name').textContent).toBe('other-machine');
    });

    it('bounds long labels while preserving full accessible identity and focus help', async () => {
        const name = 'very-long-repository-'.repeat(20);
        const machine = 'very-long-machine-'.repeat(20);
        const selected = { ...repo('long', name), workspace: {
            ...repo('long', name).workspace, baseUrl: 'https://long.example', remote: { serverId: 'long', serverLabel: machine },
        } };
        render(<WorkspaceTabsCluster repo={selected} repos={[selected]} />);
        const trigger = screen.getByTestId('clone-switch');
        await waitFor(() => expect(trigger.getAttribute('aria-label')).toBe(`${name} / ${machine}`));
        expect(trigger.className).toContain('max-w-');
        expect(screen.getByTestId('workspace-clone-label').className).toContain('min-w-0');
        expect(screen.getByTestId('workspace-repo-name').className).toContain('truncate');
        const machineNode = screen.getByTestId('workspace-machine-name');
        expect(machineNode.className).toContain('shrink-0');
        expect(machineNode.className).toContain('max-w-[60%]');
        expect(machineNode.className).toContain('truncate');
        const tooltip = screen.getByRole('tooltip', { hidden: true });
        expect(tooltip.textContent).toBe(`${name} / ${machine}`);
        expect(tooltip.className).toContain('group-hover/identity:block');
        expect(tooltip.className).toContain('group-focus-visible/identity:block');
        trigger.focus();
        expect(document.activeElement).toBe(trigger);
    });
});
