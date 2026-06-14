/**
 * RemoteSubBar — component tests.
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';

const mockSelectClone = vi.fn();
const mockSwitchSubTab = vi.fn();
const mockQueueDispatch = vi.fn();
const mockWorkItemDispatch = vi.fn();
let mockAppState: any = { activeRepoSubTab: 'chats' };
let mockQueueState: any = { repoQueueMap: {} };
let mockWorkItemState: any = { unseenByRepo: {} };
let mockQueueStats: any = { running: 0, queued: 0 };
let mockGitInfo: any = { ahead: 0, behind: 0 };

vi.mock('../../../../src/server/spa/client/react/contexts/AppContext', () => ({ useApp: () => ({ state: mockAppState, dispatch: vi.fn() }) }));
vi.mock('../../../../src/server/spa/client/react/contexts/QueueContext', () => ({ useQueue: () => ({ state: mockQueueState, dispatch: mockQueueDispatch }) }));
vi.mock('../../../../src/server/spa/client/react/contexts/WorkItemContext', () => ({ useWorkItems: () => ({ state: mockWorkItemState, dispatch: mockWorkItemDispatch }) }));
vi.mock('../../../../src/server/spa/client/react/hooks/feature-flags/useTerminalEnabled', () => ({ useTerminalEnabled: () => true }));
vi.mock('../../../../src/server/spa/client/react/features/notes/hooks/useNotesEnabled', () => ({ useNotesEnabled: () => true }));
vi.mock('../../../../src/server/spa/client/react/hooks/feature-flags/useWorkflowsEnabled', () => ({ useWorkflowsEnabled: () => true }));
vi.mock('../../../../src/server/spa/client/react/hooks/feature-flags/usePullRequestsEnabled', () => ({ usePullRequestsEnabled: () => true }));
vi.mock('../../../../src/server/spa/client/react/hooks/feature-flags/useDreamsEnabled', () => ({ useDreamsEnabled: () => true }));
vi.mock('../../../../src/server/spa/client/react/hooks/feature-flags/useNativeCliSessionsEnabled', () => ({ useNativeCliSessionsEnabled: () => true }));
vi.mock('../../../../src/server/spa/client/react/hooks/preferences/useUiLayoutMode', () => ({ useUiLayoutMode: () => ['dev-workflow', vi.fn()] }));
vi.mock('../../../../src/server/spa/client/react/queue/hooks/useRepoQueueStats', () => ({ useRepoQueueStats: () => mockQueueStats, isHidden: () => false }));
vi.mock('../../../../src/server/spa/client/react/features/git/hooks/useGitInfo', () => ({ useGitInfo: () => mockGitInfo }));
vi.mock('../../../../src/server/spa/client/react/repos/CloneRepoDialog', () => ({
    CloneRepoDialog: ({ open }: { open: boolean }) => (open ? <div data-testid="clone-repo-dialog" /> : null),
}));
vi.mock('../../../../src/server/spa/client/react/features/remote-shell/useShellNavigation', () => ({
    useShellNavigation: () => ({ selectClone: mockSelectClone, switchSubTab: mockSwitchSubTab }),
}));

import { RemoteSubBar } from '../../../../src/server/spa/client/react/features/remote-shell/RemoteSubBar';

const SHORTCUTS = 'https://github.com/acme/shortcuts.git';
const repo = (id: string, name: string, branch = 'main') => ({
    workspace: { id, name, color: '#0078d4', remoteUrl: SHORTCUTS, rootPath: `/r/${id}` },
    gitInfo: { isGitRepo: true, branch, dirty: false, remoteUrl: SHORTCUTS },
});

const renderBar = () => {
    const repos = [repo('a', 'shortcuts'), repo('b', 'shortcuts-2', 'feat/x')];
    return render(<RemoteSubBar repo={repos[0] as any} repos={repos as any} onRefresh={vi.fn()} />);
};

beforeEach(() => {
    cleanup();
    mockSelectClone.mockReset();
    mockSwitchSubTab.mockReset();
    mockQueueDispatch.mockReset();
    mockWorkItemDispatch.mockReset();
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
});
