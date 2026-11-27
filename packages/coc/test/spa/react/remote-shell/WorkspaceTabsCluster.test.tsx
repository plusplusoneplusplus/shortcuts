/**
 * WorkspaceTabsCluster — single-row workspace cluster tests.
 *
 * @vitest-environment jsdom
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

const mockSelectClone = vi.fn();
const mockSwitchSubTab = vi.fn();
let mockAppState: any = { activeTab: 'repos', activeRepoSubTab: 'chats' };
let mockQueueState: any = { repoQueueMap: {} };
let mockGitInfo: any = { ahead: 0, behind: 0 };
let mockUnseenCounts: Record<string, number> = {};
let mockSchedulesInScheduledSlideEnabled = false;
let mockPageTabsEnabled = true;

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
vi.mock('../../../../src/server/spa/client/react/hooks/feature-flags/useWorkflowsEnabled', () => ({ useWorkflowsEnabled: () => mockPageTabsEnabled }));
vi.mock('../../../../src/server/spa/client/react/hooks/feature-flags/usePullRequestsEnabled', () => ({ usePullRequestsEnabled: () => true }));
vi.mock('../../../../src/server/spa/client/react/hooks/feature-flags/useDreamsEnabled', () => ({ useDreamsEnabled: () => mockPageTabsEnabled }));
vi.mock('../../../../src/server/spa/client/react/hooks/feature-flags/useNativeCliSessionsEnabled', () => ({ useNativeCliSessionsEnabled: () => true }));
vi.mock('../../../../src/server/spa/client/react/hooks/feature-flags/useShowPlanDepTab', () => ({ useShowPlanDepTab: () => mockPageTabsEnabled }));
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
    mockPageTabsEnabled = true;
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

    it('lists every clone inline and selects another clone in one click', () => {
        const repos = [repo('a', 'shortcuts'), repo('b', 'shortcuts-2')];
        render(<WorkspaceTabsCluster repo={repos[0] as any} repos={repos as any} />);

        expect(screen.queryByTestId('clone-switch')).toBeNull();
        expect(screen.queryByTestId('clone-popover')).toBeNull();
        const pills = screen.getAllByTestId('clone-pill');
        expect(pills.map(p => p.getAttribute('data-selection-id'))).toEqual(['a', 'b']);
        expect(pills[0].getAttribute('data-active')).toBe('true');
        expect(pills[0].getAttribute('aria-current')).toBe('true');
        expect(pills[1].getAttribute('data-active')).toBe('false');
        expect(pills[1].hasAttribute('aria-current')).toBe(false);
        fireEvent.click(pills[1]);
        expect(mockSelectClone).toHaveBeenCalledWith('b');
    });

    it('re-selects the active clone so it navigates back from top-level pages', () => {
        mockAppState = { activeTab: 'admin', activeRepoSubTab: 'chats' };
        const repos = [repo('a', 'shortcuts'), repo('b', 'shortcuts-2')];
        render(<WorkspaceTabsCluster repo={repos[0] as any} repos={repos as any} />);
        fireEvent.click(screen.getAllByTestId('clone-pill')[0]);
        expect(mockSelectClone).toHaveBeenCalledWith('a');
    });

    it('shows a single clone as one active pill', () => {
        const selected = repo('a', 'shortcuts');
        render(<WorkspaceTabsCluster repo={selected as any} repos={[selected] as any} />);
        const pills = screen.getAllByTestId('clone-pill');
        expect(pills).toHaveLength(1);
        expect(pills[0].getAttribute('data-active')).toBe('true');
        expect(screen.getByTestId('clone-pill-machine').textContent).toBe('Local');
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
        const row = screen.getAllByTestId('clone-pill')
            .find(el => el.querySelector('[data-testid="clone-pill-name"]')?.textContent === target.workspace.name)!;
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


describe('flat clone strip identity', () => {
    const remote = (base: any, serverId: string, serverLabel: string, connection = 'online') => ({
        ...base,
        workspace: { ...base.workspace, baseUrl: `https://${serverId}.example`, remote: { serverId, serverLabel, connection, queue: 'idle' } },
    });

    it('follows exact clone ownership when identical workspace IDs live on several servers', () => {
        const local = repo('shared', 'shortcuts');
        const ubuntu = remote(local, 'ubuntu', 'ubuntu-arm');
        const other = remote(local, 'other', 'other-machine');
        const repos = [local, other, ubuntu];
        mockUnseenCounts = { shared: 5, 'remote:ubuntu:shared': 16 };
        const { rerender } = render(<WorkspaceTabsCluster repo={ubuntu} repos={repos} />);

        const pills = () => screen.getAllByTestId('clone-pill');
        expect(pills().map(p => p.getAttribute('data-selection-id')))
            .toEqual(['shared', 'remote:other:shared', 'remote:ubuntu:shared']);
        expect(pills().map(p => p.getAttribute('aria-label')?.split(',')[0]))
            .toEqual(['shortcuts / Local', 'shortcuts / other-machine', 'shortcuts / ubuntu-arm']);
        expect(pills()[2].getAttribute('data-active')).toBe('true');
        const unread = (pill: HTMLElement) => pill.querySelector('[data-testid="clone-pill-unseen-badge"]')?.textContent;
        expect(unread(pills()[0])).toBe('5');
        expect(unread(pills()[1])).toBeUndefined();
        expect(unread(pills()[2])).toBe('16');
        expect(pills()[2].getAttribute('aria-label')).toContain('16 needing attention');

        fireEvent.click(pills()[0]);
        expect(mockSelectClone).toHaveBeenCalledWith('shared');
        rerender(<WorkspaceTabsCluster repo={local} repos={repos} />);
        expect(pills()[0].getAttribute('data-active')).toBe('true');
        expect(pills()[2].getAttribute('data-active')).toBe('false');
    });

    it('shows local running and queued counts on each clone', () => {
        mockQueueState = { repoQueueMap: { a: { running: [{ id: 1 }, { id: 2 }], queued: [{ id: 3 }] } } };
        const repos = [repo('a', 'shortcuts'), repo('b', 'shortcuts-2')];
        render(<WorkspaceTabsCluster repo={repos[1] as any} repos={repos as any} />);
        const [a, b] = screen.getAllByTestId('clone-pill');
        expect(a.getAttribute('data-clone-status')).toBe('running');
        expect(a.querySelector('[data-testid="clone-pill-running"]')?.textContent).toContain('2');
        expect(a.querySelector('[data-testid="clone-pill-queued"]')?.textContent).toContain('1');
        expect(a.getAttribute('aria-label')).toBe('shortcuts / Local, 2 running, 1 queued');
        expect(b.querySelector('[data-testid="clone-pill-running"]')).toBeNull();
    });

    it('disables an offline remote clone but keeps the selected offline clone reachable', () => {
        const local = repo('a', 'shortcuts');
        const offline = remote(repo('r', 'shortcuts'), 'srv', 'devbox', 'offline');
        const { rerender } = render(<WorkspaceTabsCluster repo={local as any} repos={[local, offline] as any} />);
        let pill = screen.getAllByTestId('clone-pill')[1];
        expect(pill.getAttribute('data-offline')).toBe('true');
        expect(pill.hasAttribute('disabled')).toBe(true);
        expect(pill.querySelector('[data-testid="clone-offline-badge"]')).toBeTruthy();
        fireEvent.click(pill);
        expect(mockSelectClone).not.toHaveBeenCalled();

        rerender(<WorkspaceTabsCluster repo={offline as any} repos={[local, offline] as any} />);
        pill = screen.getAllByTestId('clone-pill')[1];
        expect(pill.getAttribute('data-active')).toBe('true');
        expect(pill.hasAttribute('disabled')).toBe(false);
    });

    it('adds the short path only when clone labels collide', () => {
        const a = { ...repo('a', 'shortcuts'), workspace: { ...repo('a', 'shortcuts').workspace, rootPath: '/home/me/work/shortcuts' } };
        const b = { ...repo('b', 'shortcuts'), workspace: { ...repo('b', 'shortcuts').workspace, rootPath: '/home/me/review/shortcuts' } };
        const c = repo('c', 'shortcuts-3');
        render(<WorkspaceTabsCluster repo={a as any} repos={[a, b, c] as any} />);
        const pills = screen.getAllByTestId('clone-pill');
        expect(pills[0].querySelector('[data-testid="clone-pill-path"]')?.textContent).toBe('work/shortcuts');
        expect(pills[1].querySelector('[data-testid="clone-pill-path"]')?.textContent).toBe('review/shortcuts');
        expect(pills[2].querySelector('[data-testid="clone-pill-path"]')).toBeNull();
    });

    it('shows the full identity and path on hover and focus', () => {
        const name = 'very-long-repository-'.repeat(10);
        const selected = remote(repo('long', name), 'long', 'very-long-machine');
        render(<WorkspaceTabsCluster repo={selected} repos={[selected]} />);
        const pill = screen.getByTestId('clone-pill');
        expect(screen.getByTestId('clone-pill-name').className).toContain('truncate');
        expect(screen.queryByTestId('clone-pill-tooltip')).toBeNull();

        fireEvent.focus(pill);
        const tooltip = screen.getByTestId('clone-pill-tooltip');
        expect(tooltip.textContent).toContain(`${name} / very-long-machine`);
        expect(tooltip.textContent).toContain('/r/long');
        expect(pill.getAttribute('aria-describedby')).toBe(tooltip.id);
        fireEvent.blur(pill);
        expect(screen.queryByTestId('clone-pill-tooltip')).toBeNull();

        fireEvent.mouseEnter(pill);
        expect(screen.getByTestId('clone-pill-tooltip')).toBeTruthy();
        fireEvent.mouseLeave(pill);
        expect(screen.queryByTestId('clone-pill-tooltip')).toBeNull();
    });

    it('moves focus with arrow keys, skipping offline clones, and opens the menu from the keyboard', () => {
        const repos = [repo('a', 'shortcuts'), repo('b', 'shortcuts-2'), remote(repo('r', 'shortcuts'), 'srv', 'devbox', 'offline'), repo('c', 'shortcuts-3')];
        render(<WorkspaceTabsCluster repo={repos[0] as any} repos={repos as any} />);
        const byId = new Map(screen.getAllByTestId('clone-pill').map(p => [p.getAttribute('data-selection-id'), p]));
        // Local clones sort first; the offline remote is last and skipped.
        const pills = [byId.get('a')!, byId.get('b')!, byId.get('c')!];
        expect(byId.get('remote:srv:r')!.hasAttribute('disabled')).toBe(true);
        pills[0].focus();
        fireEvent.keyDown(pills[0], { key: 'ArrowRight' });
        expect(document.activeElement).toBe(pills[1]);
        fireEvent.keyDown(pills[1], { key: 'ArrowRight' });
        expect(document.activeElement).toBe(pills[2]);
        fireEvent.keyDown(pills[2], { key: 'ArrowRight' });
        expect(document.activeElement).toBe(pills[2]);
        fireEvent.keyDown(pills[2], { key: 'Home' });
        expect(document.activeElement).toBe(pills[0]);
        fireEvent.keyDown(pills[0], { key: 'End' });
        expect(document.activeElement).toBe(pills[2]);

        fireEvent.keyDown(pills[2], { key: 'F10', shiftKey: true });
        expect(screen.getAllByRole('menuitem').some(el => el.textContent?.includes('Repo info'))).toBe(true);
    });

    it('keeps many clones in one horizontally scrolling group', () => {
        const repos = Array.from({ length: 12 }, (_, i) => repo(`c${i}`, `shortcuts-${i}`));
        render(<WorkspaceTabsCluster repo={repos[11] as any} repos={repos as any} />);
        const strip = screen.getByTestId('clone-strip');
        expect(strip.getAttribute('role')).toBe('group');
        expect(strip.className).toContain('overflow-x-auto');
        expect(strip.className.split(' ')).toEqual(expect.arrayContaining(['flex-1', 'min-w-0']));
        expect(strip.className).not.toContain('max-w-');
        expect(screen.getAllByTestId('clone-pill')).toHaveLength(12);
    });

    it('gives clone pills and their strip room for long names before truncating', () => {
        const selected = remote(repo('long', 'very-long-repository-name'), 'long', 'very-long-machine');
        render(<WorkspaceTabsCluster repo={selected} repos={[selected]} />);
        const strip = screen.getByTestId('clone-strip').className.split(' ');
        expect(strip).toEqual(expect.arrayContaining(['flex-1', 'min-w-0']));
        expect(screen.getByTestId('clone-pill-name').className).toContain('max-w-[200px]');
        expect(screen.getByTestId('clone-pill-machine').className).toContain('max-w-[140px]');
    });
});

describe('clone strip width allocation', () => {
    it('gives the strip all available space when no page tabs are enabled, including after flag changes', () => {
        mockPageTabsEnabled = false;
        mockSchedulesInScheduledSlideEnabled = true;
        const repos = Array.from({ length: 12 }, (_, i) => repo(`c${i}`, `shortcuts-${i}`));
        const { rerender } = render(<WorkspaceTabsCluster repo={repos[11]} repos={repos} />);

        const expectFullWidthStrip = () => {
            const strip = screen.getByTestId('clone-strip');
            expect(strip.className.split(' ')).toContain('flex-1');
            expect(strip.className).not.toContain('max-w-');
            expect(screen.queryByTestId('clone-tab-region')).toBeNull();
            expect(screen.queryByTestId('subbar-overflow-toggle')).toBeNull();
            expect(screen.getAllByTestId('clone-pill')).toHaveLength(12);
        };
        expectFullWidthStrip();

        mockPageTabsEnabled = true;
        rerender(<WorkspaceTabsCluster repo={repos[11]} repos={repos} />);
        expect(screen.getByTestId('clone-tab-region').className).toContain('min-w-0');
        expect(screen.getAllByTestId('clone-scope-tab').map(el => el.dataset.subtab))
            .toEqual(['dreams', 'workflows', 'tasks']);

        mockPageTabsEnabled = false;
        rerender(<WorkspaceTabsCluster repo={repos[11]} repos={repos} />);
        expectFullWidthStrip();
    });

    it('keeps page tabs reachable through overflow and restores them when their region grows', () => {
        let resize: () => void = () => {};
        const disconnect = vi.fn();
        vi.stubGlobal('ResizeObserver', class {
            constructor(private callback: () => void) {}
            observe(target: HTMLElement) {
                if (target.dataset.testid === 'clone-tab-region') {
                    resize = this.callback;
                }
            }
            disconnect = disconnect;
        });
        try {
            mockAppState = { activeTab: 'repos', activeRepoSubTab: 'workflows' };
            const selected = repo('a', 'shortcuts');
            const { unmount } = render(<WorkspaceTabsCluster repo={selected} repos={[selected]} />);
            const region = screen.getByTestId('clone-tab-region');
            let width = 100;
            Object.defineProperty(region, 'clientWidth', { get: () => width });
            for (const el of screen.getByTestId('workspace-tabs-cluster').querySelectorAll('[data-measure-key]')) {
                Object.defineProperty(el, 'offsetWidth', { value: 80 });
            }
            act(() => resize());
            expect(screen.getAllByTestId('clone-scope-tab').map(el => el.dataset.subtab)).toEqual(['workflows']);
            expect(screen.getByTestId('clone-scope-tab').getAttribute('aria-current')).toBe('page');
            const more = screen.getByRole('button', { name: 'More clone tabs' });
            fireEvent.click(more);
            expect(more.getAttribute('aria-expanded')).toBe('true');
            const dreams = screen.getAllByRole('menuitem').find(el => el.dataset.subtab === 'dreams')!;
            fireEvent.click(dreams);
            expect(mockSwitchSubTab).toHaveBeenCalledWith('dreams');

            width = 500;
            act(() => resize());
            expect(screen.getAllByTestId('clone-scope-tab')).toHaveLength(4);
            expect(screen.queryByTestId('subbar-overflow-toggle')).toBeNull();
            unmount();
            expect(disconnect).toHaveBeenCalled();
        } finally {
            vi.unstubAllGlobals();
        }
    });
});
