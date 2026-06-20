/**
 * RemoteSubBar — component tests.
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor, act } from '@testing-library/react';

const mockSelectClone = vi.fn();
const mockSwitchSubTab = vi.fn();
const mockQueueDispatch = vi.fn();
const mockWorkItemDispatch = vi.fn();
const mockFetchRepos = vi.fn().mockResolvedValue(undefined);
const mockRemoveWorkspace = vi.fn().mockResolvedValue(undefined);
let mockAppState: any = { activeRepoSubTab: 'chats' };
let mockQueueState: any = { repoQueueMap: {} };
let mockWorkItemState: any = { unseenByRepo: {} };
let mockQueueStats: any = { running: 0, queued: 0 };
let mockGitInfo: any = { ahead: 0, behind: 0 };

vi.mock('../../../../src/server/spa/client/react/contexts/AppContext', () => ({ useApp: () => ({ state: mockAppState, dispatch: vi.fn() }) }));
vi.mock('../../../../src/server/spa/client/react/contexts/QueueContext', () => ({ useQueue: () => ({ state: mockQueueState, dispatch: mockQueueDispatch }) }));
vi.mock('../../../../src/server/spa/client/react/contexts/WorkItemContext', () => ({ useWorkItems: () => ({ state: mockWorkItemState, dispatch: mockWorkItemDispatch }) }));
vi.mock('../../../../src/server/spa/client/react/contexts/ReposContext', () => ({ useRepos: () => ({ fetchRepos: mockFetchRepos, repos: [], loading: false, unseenCounts: {}, refreshUnseenCounts: vi.fn() }) }));
vi.mock('../../../../src/server/spa/client/react/hooks/feature-flags/useTerminalEnabled', () => ({ useTerminalEnabled: () => true }));
vi.mock('../../../../src/server/spa/client/react/features/notes/hooks/useNotesEnabled', () => ({ useNotesEnabled: () => true }));
vi.mock('../../../../src/server/spa/client/react/hooks/feature-flags/useWorkflowsEnabled', () => ({ useWorkflowsEnabled: () => true }));
vi.mock('../../../../src/server/spa/client/react/hooks/feature-flags/usePullRequestsEnabled', () => ({ usePullRequestsEnabled: () => true }));
vi.mock('../../../../src/server/spa/client/react/hooks/feature-flags/useDreamsEnabled', () => ({ useDreamsEnabled: () => true }));
vi.mock('../../../../src/server/spa/client/react/hooks/feature-flags/useNativeCliSessionsEnabled', () => ({ useNativeCliSessionsEnabled: () => true }));
vi.mock('../../../../src/server/spa/client/react/hooks/preferences/useUiLayoutMode', () => ({ useUiLayoutMode: () => ['dev-workflow', vi.fn()] }));
vi.mock('../../../../src/server/spa/client/react/queue/hooks/useRepoQueueStats', () => ({ useRepoQueueStats: () => mockQueueStats, isHidden: () => false }));
vi.mock('../../../../src/server/spa/client/react/features/git/hooks/useGitInfo', () => ({ useGitInfo: () => mockGitInfo }));
vi.mock('../../../../src/server/spa/client/react/features/remote-shell/useShellNavigation', () => ({
    useShellNavigation: () => ({ selectClone: mockSelectClone, switchSubTab: mockSwitchSubTab }),
}));
vi.mock('../../../../src/server/spa/client/react/repos/repositoryService', () => ({
    removeWorkspace: (...args: any[]) => mockRemoveWorkspace(...args),
}));

import { RemoteSubBar } from '../../../../src/server/spa/client/react/features/remote-shell/RemoteSubBar';

const SHORTCUTS = 'https://github.com/acme/shortcuts.git';
const repo = (id: string, name: string, branch = 'main') => ({
    workspace: { id, name, color: '#0078d4', remoteUrl: SHORTCUTS, rootPath: `/r/${id}` },
    gitInfo: { isGitRepo: true, branch, dirty: false, remoteUrl: SHORTCUTS },
});

// A remote checkout (AC-01/05 marker) of the same origin, foldable into the group.
// `connection`/`queue` drive the AC-05 status dot; defaults keep an online, idle clone.
const remoteRepo = (
    id: string,
    name: string,
    serverLabel = 'devbox',
    remoteUrl: string | undefined = SHORTCUTS,
    branch = 'main',
    connection: string = 'online',
    queue: string = 'idle',
) => ({
    workspace: {
        id, name, color: '#0078d4', remoteUrl, rootPath: `/remote/${id}`,
        baseUrl: 'http://127.0.0.1:4000',
        remote: { baseUrl: 'http://127.0.0.1:4000', serverId: 'srv-1', serverLabel, offline: connection !== 'online', connection, queue },
    },
    gitInfo: remoteUrl ? { isGitRepo: true, branch, dirty: false, remoteUrl } : undefined,
});

const renderBar = () => {
    const repos = [repo('a', 'shortcuts'), repo('b', 'shortcuts-2', 'feat/x')];
    return render(<RemoteSubBar repo={repos[0] as any} repos={repos as any} />);
};

beforeEach(() => {
    cleanup();
    mockSelectClone.mockReset();
    mockSwitchSubTab.mockReset();
    mockQueueDispatch.mockReset();
    mockWorkItemDispatch.mockReset();
    mockFetchRepos.mockReset().mockResolvedValue(undefined);
    mockRemoveWorkspace.mockReset().mockResolvedValue(undefined);
    mockAppState = { activeRepoSubTab: 'chats' };
    mockQueueState = { repoQueueMap: {} };
    mockWorkItemState = { unseenByRepo: {} };
    mockQueueStats = { running: 0, queued: 0 };
    mockGitInfo = { ahead: 0, behind: 0 };
});

describe('RemoteSubBar', () => {
    it('keeps Work Items + Pull Requests in the remote scope', () => {
        renderBar();
        const remoteTabs = screen.getAllByTestId('remote-scope-tab').map(el => el.getAttribute('data-subtab'));
        expect(remoteTabs).toEqual(['work-items', 'pull-requests']);
    });

    it('labels the remote scope by provider (GitHub) and drops the Clone scope label', () => {
        renderBar();
        const label = screen.getByTestId('scope-label-remote');
        expect(label.textContent).toBe('GitHub');
        expect(screen.queryByTestId('scope-label-clone')).toBeNull();
    });

    it('labels the remote scope ADO for Azure DevOps remotes', () => {
        const ado = 'https://dev.azure.com/org/project/_git/repo';
        const adoRepo = (id: string, name: string) => ({
            workspace: { id, name, color: '#0078d4', remoteUrl: ado, rootPath: `/r/${id}` },
            gitInfo: { isGitRepo: true, branch: 'main', dirty: false, remoteUrl: ado },
        });
        const repos = [adoRepo('a', 'repo'), adoRepo('b', 'repo-2')];
        render(<RemoteSubBar repo={repos[0] as any} repos={repos as any} />);
        expect(screen.getByTestId('scope-label-remote').textContent).toBe('ADO');
    });

    it('shows every non-remote tab in the clone scope, inline, when width is unconstrained', () => {
        renderBar();
        const cloneTabs = screen.getAllByTestId('clone-scope-tab').map(el => el.getAttribute('data-subtab'));
        // jsdom reports no layout width → nothing overflows → all clone tabs render inline.
        expect(cloneTabs).toEqual(['chats', 'cli-sessions', 'dreams', 'schedules', 'explorer', 'workflows', 'git', 'terminal', 'tasks', 'settings', 'notes']);
        // No remote-scope tabs leak into the clone scope.
        expect(cloneTabs).not.toContain('work-items');
        expect(cloneTabs).not.toContain('pull-requests');
        // Nothing is forced into an overflow when everything fits.
        expect(screen.queryByTestId('subbar-overflow-toggle')).toBeNull();
    });

    it('switches sub-tab when a clone tab is clicked', () => {
        renderBar();
        const git = screen.getAllByTestId('clone-scope-tab').find(el => el.getAttribute('data-subtab') === 'git')!;
        fireEvent.click(git);
        expect(mockSwitchSubTab).toHaveBeenCalledWith('git');
    });

    it('opens the clone popover and selects another clone', () => {
        renderBar();
        const sw = screen.getByTestId('clone-switch');
        expect(sw.textContent).toContain('shortcuts');
        expect(sw.textContent).toContain('· 2'); // two clones
        fireEvent.click(sw);
        const items = screen.getAllByTestId('clone-popover-item');
        expect(items).toHaveLength(2);
        fireEvent.click(items[1]);
        expect(mockSelectClone).toHaveBeenCalledWith('b');
    });

    it('queues and asks against the active clone', () => {
        renderBar();
        fireEvent.click(screen.getByTestId('subbar-ask'));
        expect(mockQueueDispatch).toHaveBeenCalledWith({ type: 'OPEN_DIALOG', workspaceId: 'a', mode: 'ask' });
        fireEvent.click(screen.getByTestId('subbar-queue'));
        expect(mockQueueDispatch).toHaveBeenCalledWith({ type: 'OPEN_DIALOG', workspaceId: 'a' });
    });

    it('shows a running badge on the activity/chats tab from queue stats', () => {
        mockQueueStats = { running: 2, queued: 0 };
        renderBar();
        expect(screen.getByTestId('subbar-running-badge').textContent).toBe('2');
    });

    // ── AC-04: remote clones in the CLONE dropdown ───────────────────────────

    it('folds a remote clone into the dropdown and badges it with the server label', () => {
        const local = repo('a', 'shortcuts');
        const remote = remoteRepo('b', 'shortcuts-remote', 'devbox');
        render(<RemoteSubBar repo={local as any} repos={[local, remote] as any} />);
        fireEvent.click(screen.getByTestId('clone-switch'));
        const items = screen.getAllByTestId('clone-popover-item');
        expect(items).toHaveLength(2);
        // Exactly the remote row carries the server-label badge.
        const badges = screen.getAllByTestId('clone-remote-badge');
        expect(badges).toHaveLength(1);
        expect(badges[0].textContent).toBe('devbox');
        const remoteRow = items.find(el => el.getAttribute('data-remote') === 'true')!;
        expect(remoteRow.querySelector('[data-testid="clone-remote-badge"]')).toBeTruthy();
    });

    it('shows a Local badge on the local clone, never the remote', () => {
        const local = repo('a', 'shortcuts');
        const remote = remoteRepo('b', 'shortcuts-remote', 'devbox');
        // Remote passed FIRST — grouping must still sort the local clone ahead.
        render(<RemoteSubBar repo={local as any} repos={[remote, local] as any} />);
        fireEvent.click(screen.getByTestId('clone-switch'));
        const items = screen.getAllByTestId('clone-popover-item');
        // The local row must carry the "Local" badge (not "primary").
        const localRow = items.find(el => el.getAttribute('data-remote') === 'false')!;
        expect(localRow).toBeTruthy();
        expect(localRow.textContent?.toLowerCase()).toContain('local');
        expect(localRow.textContent?.toLowerCase()).not.toContain('primary');
        // The remote row must NOT carry the "Local" badge.
        const remoteRow = items.find(el => el.getAttribute('data-remote') === 'true')!;
        expect(remoteRow.textContent?.toLowerCase()).not.toContain('local');
        expect(remoteRow.textContent?.toLowerCase()).not.toContain('primary');
    });

    it('renders a remote-only clone (no local counterpart) with its server badge', () => {
        const remote = remoteRepo('only', 'remote-only', 'edge-1');
        render(<RemoteSubBar repo={remote as any} repos={[remote] as any} />);
        fireEvent.click(screen.getByTestId('clone-switch'));
        const items = screen.getAllByTestId('clone-popover-item');
        expect(items).toHaveLength(1);
        expect(items[0].getAttribute('data-remote')).toBe('true');
        expect(screen.getByTestId('clone-remote-badge').textContent).toBe('edge-1');
    });

    it('does not badge any row when every clone is local', () => {
        renderBar();
        fireEvent.click(screen.getByTestId('clone-switch'));
        expect(screen.queryByTestId('clone-remote-badge')).toBeNull();
        screen.getAllByTestId('clone-popover-item').forEach(el => {
            expect(el.getAttribute('data-remote')).toBe('false');
        });
    });

    // ── AC-05: blended status dot reflected on each clone row ─────────────────

    const openAndGetRow = (repos: any[], activeId: string, rowId: string) => {
        const active = repos.find(r => r.workspace.id === activeId);
        render(<RemoteSubBar repo={active as any} repos={repos as any} />);
        fireEvent.click(screen.getByTestId('clone-switch'));
        return screen.getAllByTestId('clone-popover-item')
            .find(el => el.textContent?.includes(repos.find(r => r.workspace.id === rowId)!.workspace.name))!;
    };

    it('blends an online+running remote clone to a running dot status', () => {
        const local = repo('a', 'shortcuts');
        const remote = remoteRepo('b', 'shortcuts-remote', 'devbox', SHORTCUTS, 'main', 'online', 'running');
        const row = openAndGetRow([local, remote], 'a', 'b');
        expect(row.getAttribute('data-remote')).toBe('true');
        expect(row.getAttribute('data-clone-status')).toBe('running');
    });

    it('shows an offline status for a remote clone whose server is offline', () => {
        const local = repo('a', 'shortcuts');
        const remote = remoteRepo('b', 'shortcuts-remote', 'devbox', SHORTCUTS, 'main', 'offline', 'running');
        const row = openAndGetRow([local, remote], 'a', 'b');
        expect(row.getAttribute('data-clone-status')).toBe('offline');
    });

    it('shows a connecting status for a remote clone whose server is connecting', () => {
        const local = repo('a', 'shortcuts');
        const remote = remoteRepo('b', 'shortcuts-remote', 'devbox', SHORTCUTS, 'main', 'connecting', 'queued');
        const row = openAndGetRow([local, remote], 'a', 'b');
        expect(row.getAttribute('data-clone-status')).toBe('connecting');
    });

    it('keeps local clone dot status queue-derived (idle with no queue)', () => {
        const row = openAndGetRow([repo('a', 'shortcuts'), repo('b', 'shortcuts-2', 'feat/x')], 'a', 'b');
        expect(row.getAttribute('data-remote')).toBe('false');
        expect(row.getAttribute('data-clone-status')).toBe('idle');
    });

    // ── AC-06: offline remote clones are greyed + non-interactive ─────────────

    it('greys an offline remote clone, badges it offline, and disables the row', () => {
        const local = repo('a', 'shortcuts');
        const remote = remoteRepo('b', 'shortcuts-remote', 'devbox', SHORTCUTS, 'main', 'offline', 'running');
        const row = openAndGetRow([local, remote], 'a', 'b');
        // Greyed treatment + disabled state.
        expect(row.getAttribute('data-offline')).toBe('true');
        expect((row as HTMLButtonElement).disabled).toBe(true);
        expect(row.getAttribute('aria-disabled')).toBe('true');
        expect(row.className).toContain('opacity-50');
        expect(row.className).toContain('cursor-not-allowed');
        // Offline badge present (in addition to the server-label badge).
        const offlineBadge = row.querySelector('[data-testid="clone-offline-badge"]');
        expect(offlineBadge).toBeTruthy();
        expect(offlineBadge!.textContent?.toLowerCase()).toContain('offline');
        expect(row.querySelector('[data-testid="clone-remote-badge"]')).toBeTruthy();
    });

    it('does NOT select/navigate when an offline remote clone is clicked', () => {
        const local = repo('a', 'shortcuts');
        const remote = remoteRepo('b', 'shortcuts-remote', 'devbox', SHORTCUTS, 'main', 'offline', 'running');
        const row = openAndGetRow([local, remote], 'a', 'b');
        fireEvent.click(row);
        expect(mockSelectClone).not.toHaveBeenCalled();
        // Popover stays open (no navigation happened).
        expect(screen.queryByTestId('clone-popover')).toBeTruthy();
    });

    it('treats a failed-connection remote clone as offline (greyed + non-interactive)', () => {
        const local = repo('a', 'shortcuts');
        const remote = remoteRepo('b', 'shortcuts-remote', 'devbox', SHORTCUTS, 'main', 'failed', 'idle');
        const row = openAndGetRow([local, remote], 'a', 'b');
        expect(row.getAttribute('data-clone-status')).toBe('offline');
        expect(row.getAttribute('data-offline')).toBe('true');
        fireEvent.click(row);
        expect(mockSelectClone).not.toHaveBeenCalled();
    });

    it('the ONLINE variant of the same remote clone is interactive and not greyed', () => {
        const local = repo('a', 'shortcuts');
        const remote = remoteRepo('b', 'shortcuts-remote', 'devbox', SHORTCUTS, 'main', 'online', 'idle');
        const row = openAndGetRow([local, remote], 'a', 'b');
        expect(row.getAttribute('data-offline')).toBe('false');
        expect((row as HTMLButtonElement).disabled).toBe(false);
        expect(row.querySelector('[data-testid="clone-offline-badge"]')).toBeNull();
        fireEvent.click(row);
        expect(mockSelectClone).toHaveBeenCalledWith('b');
    });

    it('keeps the offline clone VISIBLE in its group (row still rendered)', () => {
        // Group stays stable: an offline remote clone folds in and is still listed.
        const local = repo('a', 'shortcuts');
        const remote = remoteRepo('b', 'shortcuts-remote', 'devbox', SHORTCUTS, 'main', 'offline', 'idle');
        render(<RemoteSubBar repo={local as any} repos={[local, remote] as any} />);
        fireEvent.click(screen.getByTestId('clone-switch'));
        const items = screen.getAllByTestId('clone-popover-item');
        expect(items).toHaveLength(2);
        expect(items.some(el => el.getAttribute('data-offline') === 'true')).toBe(true);
    });

    it('does not grey or disable a connecting (not-yet-offline) remote clone', () => {
        // 'connecting' is distinct from offline — the row stays interactive.
        const local = repo('a', 'shortcuts');
        const remote = remoteRepo('b', 'shortcuts-remote', 'devbox', SHORTCUTS, 'main', 'connecting', 'idle');
        const row = openAndGetRow([local, remote], 'a', 'b');
        expect(row.getAttribute('data-offline')).toBe('false');
        expect((row as HTMLButtonElement).disabled).toBe(false);
        fireEvent.click(row);
        expect(mockSelectClone).toHaveBeenCalledWith('b');
    });

    it('never greys a LOCAL clone (offline treatment is remote-only)', () => {
        const row = openAndGetRow([repo('a', 'shortcuts'), repo('b', 'shortcuts-2', 'feat/x')], 'a', 'b');
        expect(row.getAttribute('data-offline')).toBe('false');
        expect((row as HTMLButtonElement).disabled).toBe(false);
    });

    // ── Context menu on clone rows ────────────────────────────────────────────

    it('right-clicking a clone-popover-item opens the context menu', () => {
        renderBar();
        fireEvent.click(screen.getByTestId('clone-switch'));
        const items = screen.getAllByTestId('clone-popover-item');
        fireEvent.contextMenu(items[0]);
        expect(screen.getByTestId('context-menu')).toBeTruthy();
    });

    it('context menu contains Repo info, Copy path, and Remove from CoC', () => {
        renderBar();
        fireEvent.click(screen.getByTestId('clone-switch'));
        fireEvent.contextMenu(screen.getAllByTestId('clone-popover-item')[0]);
        const menu = screen.getByTestId('context-menu');
        expect(menu.textContent).toContain('Repo info');
        expect(menu.textContent).toContain('Copy path');
        expect(menu.textContent).toContain('Remove from CoC');
    });

    it('Remove from CoC is disabled for remote clones', () => {
        const local = repo('a', 'shortcuts');
        const remote = remoteRepo('b', 'shortcuts-remote', 'devbox');
        render(<RemoteSubBar repo={local as any} repos={[local, remote] as any} />);
        fireEvent.click(screen.getByTestId('clone-switch'));
        const remoteRow = screen.getAllByTestId('clone-popover-item')
            .find(el => el.getAttribute('data-remote') === 'true')!;
        fireEvent.contextMenu(remoteRow);
        const removeBtn = Array.from(screen.getByTestId('context-menu').querySelectorAll('button'))
            .find(btn => btn.textContent?.includes('Remove from CoC'))!;
        expect(removeBtn.disabled).toBe(true);
    });

    it('Remove from CoC is enabled for local clones', () => {
        renderBar();
        fireEvent.click(screen.getByTestId('clone-switch'));
        fireEvent.contextMenu(screen.getAllByTestId('clone-popover-item')[0]);
        const removeBtn = Array.from(screen.getByTestId('context-menu').querySelectorAll('button'))
            .find(btn => btn.textContent?.includes('Remove from CoC'))!;
        expect(removeBtn.disabled).toBe(false);
    });

    it('clicking Repo info opens the info dialog with path and branch', () => {
        renderBar();
        fireEvent.click(screen.getByTestId('clone-switch'));
        fireEvent.contextMenu(screen.getAllByTestId('clone-popover-item')[0]);
        const infoBtn = Array.from(screen.getByTestId('context-menu').querySelectorAll('button'))
            .find(btn => btn.textContent?.includes('Repo info'))!;
        fireEvent.click(infoBtn);
        expect(screen.getByTestId('clone-info-content')).toBeTruthy();
        expect(screen.getByTestId('clone-info-path').textContent).toBe('/r/a');
        expect(screen.getByTestId('clone-info-branch').textContent).toBe('main');
    });

    it('clicking Remove from CoC shows a confirmation dialog', () => {
        renderBar();
        fireEvent.click(screen.getByTestId('clone-switch'));
        fireEvent.contextMenu(screen.getAllByTestId('clone-popover-item')[0]);
        const removeBtn = Array.from(screen.getByTestId('context-menu').querySelectorAll('button'))
            .find(btn => btn.textContent?.includes('Remove from CoC'))!;
        fireEvent.click(removeBtn);
        expect(screen.getByTestId('clone-remove-confirm-btn')).toBeTruthy();
        expect(screen.getByText(/folder on disk is left untouched/i)).toBeTruthy();
    });

    it('confirming remove calls removeWorkspace and fetchRepos', async () => {
        renderBar();
        fireEvent.click(screen.getByTestId('clone-switch'));
        fireEvent.contextMenu(screen.getAllByTestId('clone-popover-item')[1]);
        const removeBtn = Array.from(screen.getByTestId('context-menu').querySelectorAll('button'))
            .find(btn => btn.textContent?.includes('Remove from CoC'))!;
        fireEvent.click(removeBtn);
        await act(async () => {
            fireEvent.click(screen.getByTestId('clone-remove-confirm-btn'));
        });
        await waitFor(() => {
            expect(mockRemoveWorkspace).toHaveBeenCalledWith('b');
            expect(mockFetchRepos).toHaveBeenCalled();
        });
    });

    it('confirming remove of the selected clone calls selectClone with a sibling', async () => {
        renderBar(); // active repo is 'a'; repos are ['a', 'b']
        fireEvent.click(screen.getByTestId('clone-switch'));
        // Right-click the first row (selected clone 'a')
        fireEvent.contextMenu(screen.getAllByTestId('clone-popover-item')[0]);
        const removeBtn = Array.from(screen.getByTestId('context-menu').querySelectorAll('button'))
            .find(btn => btn.textContent?.includes('Remove from CoC'))!;
        fireEvent.click(removeBtn);
        await act(async () => {
            fireEvent.click(screen.getByTestId('clone-remove-confirm-btn'));
        });
        await waitFor(() => {
            expect(mockRemoveWorkspace).toHaveBeenCalledWith('a');
            expect(mockSelectClone).toHaveBeenCalledWith('b');
        });
    });

    // ── AC-01: clone-switch button label excludes git branch ──────────────────

    it('clone-switch button does not include branch name in visible text', () => {
        const repos = [repo('a', 'shortcuts', 'feat/my-feature'), repo('b', 'shortcuts-2', 'main')];
        render(<RemoteSubBar repo={repos[0] as any} repos={repos as any} />);
        const sw = screen.getByTestId('clone-switch');
        expect(sw.textContent).toContain('shortcuts');
        expect(sw.textContent).not.toContain('feat/my-feature');
    });

    it('clone-switch button title attribute is just the workspace name (no branch)', () => {
        const repos = [repo('a', 'shortcuts', 'feat/my-feature')];
        render(<RemoteSubBar repo={repos[0] as any} repos={repos as any} />);
        const sw = screen.getByTestId('clone-switch');
        expect(sw.getAttribute('title')).toBe('shortcuts');
        expect(sw.getAttribute('title')).not.toContain('feat/my-feature');
    });

    // ── AC-02: Local badge on local clone only when mixed local+remote group ──

    it('does not show Local badge when all clones are local (no distinction)', () => {
        const repos = [repo('a', 'shortcuts'), repo('b', 'shortcuts-2')];
        render(<RemoteSubBar repo={repos[0] as any} repos={repos as any} />);
        fireEvent.click(screen.getByTestId('clone-switch'));
        const items = screen.getAllByTestId('clone-popover-item');
        items.forEach(item => {
            expect(item.textContent?.toLowerCase()).not.toContain('local');
        });
    });

    it('shows Local badge on local clone when remote is also in the group', () => {
        const local = repo('a', 'shortcuts');
        const remote = remoteRepo('b', 'shortcuts-remote', 'devbox');
        render(<RemoteSubBar repo={local as any} repos={[local, remote] as any} />);
        fireEvent.click(screen.getByTestId('clone-switch'));
        const localRow = screen.getAllByTestId('clone-popover-item')
            .find(el => el.getAttribute('data-remote') === 'false')!;
        expect(localRow.textContent?.toLowerCase()).toContain('local');
    });

    it('does not show Local badge on the remote clone', () => {
        const local = repo('a', 'shortcuts');
        const remote = remoteRepo('b', 'shortcuts-remote', 'devbox');
        render(<RemoteSubBar repo={local as any} repos={[local, remote] as any} />);
        fireEvent.click(screen.getByTestId('clone-switch'));
        const remoteRow = screen.getAllByTestId('clone-popover-item')
            .find(el => el.getAttribute('data-remote') === 'true')!;
        expect(remoteRow.textContent?.toLowerCase()).not.toContain('local');
    });
});
