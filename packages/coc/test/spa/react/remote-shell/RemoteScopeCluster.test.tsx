/**
 * RemoteScopeCluster — single-row remote cluster tests.
 *
 * @vitest-environment jsdom
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

const mockSelectClone = vi.fn();
const mockSwitchSubTab = vi.fn();
const mockWorkItemDispatch = vi.fn();
const mockPatchGlobal = vi.fn().mockResolvedValue({});
let mockAppState: any = { selectedRepoId: 'a', activeTab: 'repos', activeRepoSubTab: 'chats' };
let mockQueueState: any = { repoQueueMap: {} };
let mockWorkItemState: any = { unseenByRepo: {} };
let mockRepos: any[] = [];
let mockUnseen: Record<string, number> = {};

vi.mock('../../../../src/server/spa/client/react/api/cocClient', () => ({
    getSpaCocClient: () => ({
        preferences: {
            getGlobal: vi.fn().mockResolvedValue({ recentRemotes: [] }),
            patchGlobal: mockPatchGlobal,
        },
    }),
}));
vi.mock('../../../../src/server/spa/client/react/contexts/AppContext', () => ({
    useApp: () => ({ state: mockAppState, dispatch: vi.fn() }),
}));
vi.mock('../../../../src/server/spa/client/react/contexts/QueueContext', () => ({
    useQueue: () => ({ state: mockQueueState, dispatch: vi.fn() }),
}));
vi.mock('../../../../src/server/spa/client/react/contexts/ReposContext', () => ({
    useRepos: () => ({ repos: mockRepos, unseenCounts: mockUnseen, fetchRepos: vi.fn() }),
}));
vi.mock('../../../../src/server/spa/client/react/contexts/WorkItemContext', () => ({
    useWorkItems: () => ({ state: mockWorkItemState, dispatch: mockWorkItemDispatch }),
}));
vi.mock('../../../../src/server/spa/client/react/hooks/feature-flags/useTerminalEnabled', () => ({ useTerminalEnabled: () => true }));
vi.mock('../../../../src/server/spa/client/react/features/notes/hooks/useNotesEnabled', () => ({ useNotesEnabled: () => true }));
vi.mock('../../../../src/server/spa/client/react/hooks/feature-flags/useWorkflowsEnabled', () => ({ useWorkflowsEnabled: () => true }));
vi.mock('../../../../src/server/spa/client/react/hooks/feature-flags/usePullRequestsEnabled', () => ({ usePullRequestsEnabled: () => true }));
vi.mock('../../../../src/server/spa/client/react/hooks/feature-flags/useDreamsEnabled', () => ({ useDreamsEnabled: () => true }));
vi.mock('../../../../src/server/spa/client/react/hooks/feature-flags/useNativeCliSessionsEnabled', () => ({ useNativeCliSessionsEnabled: () => true }));
vi.mock('../../../../src/server/spa/client/react/hooks/feature-flags/useShowPlanDepTab', () => ({ useShowPlanDepTab: () => true }));
vi.mock('../../../../src/server/spa/client/react/hooks/preferences/useUiLayoutMode', () => ({ useUiLayoutMode: () => ['dev-workflow', vi.fn()] }));
vi.mock('../../../../src/server/spa/client/react/features/remote-shell/useShellNavigation', () => ({
    useShellNavigation: () => ({ selectClone: mockSelectClone, switchSubTab: mockSwitchSubTab }),
}));
vi.mock('../../../../src/server/spa/client/react/repos/AddFolderDialog', () => ({
    AddFolderDialog: ({ open }: { open: boolean }) => (open ? <div data-testid="add-folder-dialog" /> : null),
}));
vi.mock('../../../../src/server/spa/client/react/repos/AddRepoDialog', () => ({
    AddRepoDialog: ({ open }: { open: boolean }) => (open ? <div data-testid="add-repo-dialog" /> : null),
}));
vi.mock('../../../../src/server/spa/client/react/repos/CloneRepoDialog', () => ({
    CloneRepoDialog: ({ open }: { open: boolean }) => (open ? <div data-testid="clone-repo-dialog" /> : null),
}));

import { RemoteScopeCluster } from '../../../../src/server/spa/client/react/features/remote-shell/RemoteScopeCluster';

const repo = (id: string, name: string, remoteUrl: string) => ({
    workspace: { id, name, color: '#0078d4', remoteUrl, rootPath: `/r/${id}` },
    gitInfo: { isGitRepo: true, branch: 'main', dirty: false, remoteUrl },
});

const SHORTCUTS = 'https://github.com/acme/shortcuts.git';
const FORGE = 'https://github.com/acme/forge.git';
const API = 'https://github.com/acme/api.git';
const WEB = 'https://github.com/acme/web.git';
const CLI = 'https://github.com/acme/cli.git';

beforeEach(() => {
    cleanup();
    mockSelectClone.mockReset();
    mockSwitchSubTab.mockReset();
    mockWorkItemDispatch.mockReset();
    mockPatchGlobal.mockClear();
    mockAppState = { selectedRepoId: 'a', activeTab: 'repos', activeRepoSubTab: 'chats' };
    mockQueueState = { repoQueueMap: {} };
    mockWorkItemState = { unseenByRepo: {} };
    mockRepos = [repo('a', 'shortcuts', SHORTCUTS), repo('b', 'shortcuts-2', SHORTCUTS), repo('c', 'forge', FORGE)];
    mockUnseen = {};
});

describe('RemoteScopeCluster', () => {
    it('renders a current remote chip plus remote-scoped WI and PR tabs', () => {
        render(<RemoteScopeCluster repo={mockRepos[0]} repos={mockRepos} />);

        expect(screen.getByTestId('remote-chip').textContent).toContain('shortcuts');
        expect(screen.getAllByTestId('remote-scope-tab').map(el => el.getAttribute('data-subtab')))
            .toEqual(['work-items', 'pull-requests']);
    });

    it('shows the GitHub logo (not a keyword) in the remote chip for GitHub remotes', () => {
        render(<RemoteScopeCluster repo={mockRepos[0]} repos={mockRepos} />);

        const badge = screen.getByTestId('remote-provider-badge');
        expect(badge.getAttribute('data-provider')).toBe('github');
        expect(badge.getAttribute('aria-label')).toBe('GitHub');
        expect(badge.textContent).toBe('');
        expect(badge.querySelector('svg')).not.toBeNull();
    });

    it('shows the Azure DevOps logo in the remote chip for ADO remotes', () => {
        const ADO = 'https://dev.azure.com/org/project/_git/repo';
        mockRepos = [repo('a', 'repo', ADO), repo('b', 'repo-2', ADO)];
        render(<RemoteScopeCluster repo={mockRepos[0]} repos={mockRepos} />);

        const badge = screen.getByTestId('remote-provider-badge');
        expect(badge.getAttribute('data-provider')).toBe('ado');
        expect(badge.getAttribute('aria-label')).toBe('ADO');
        expect(badge.querySelector('svg')).not.toBeNull();
    });

    it('opens the remote dropdown with recent rows, Show all, search, and add actions', () => {
        mockRepos = [
            repo('a', 'shortcuts', SHORTCUTS),
            repo('b', 'shortcuts-2', SHORTCUTS),
            repo('c', 'forge', FORGE),
            repo('d', 'api', API),
            repo('e', 'web', WEB),
            repo('f', 'cli', CLI),
        ];
        render(<RemoteScopeCluster repo={mockRepos[0]} repos={mockRepos} />);

        fireEvent.click(screen.getByTestId('remote-chip'));
        expect(screen.getByTestId('remote-dropdown')).toBeTruthy();
        expect(screen.getAllByTestId('remote-dropdown-item')).toHaveLength(4);
        expect(screen.getByTestId('remote-show-all-btn').textContent).toContain('Show all');
        expect(screen.getByTestId('remote-search-input')).toBeTruthy();
        expect(screen.getByTestId('remote-add-folder-option')).toBeTruthy();
        expect(screen.getByTestId('remote-add-repo-option')).toBeTruthy();
        expect(screen.getByTestId('remote-clone-repo-option')).toBeTruthy();
    });

    it('selects a remote from the dropdown and records it in the MRU preference', async () => {
        render(<RemoteScopeCluster repo={mockRepos[0]} repos={mockRepos} />);

        fireEvent.click(screen.getByTestId('remote-chip'));
        const forge = screen.getAllByTestId('remote-dropdown-item').find(el => el.textContent?.includes('forge'))!;
        fireEvent.click(forge);

        expect(mockSelectClone).toHaveBeenCalledWith('c');
        await waitFor(() => {
            expect(mockPatchGlobal).toHaveBeenCalledWith(expect.objectContaining({
                recentRemotes: expect.arrayContaining(['github.com/acme/forge']),
            }));
        });
    });

    it('search filters across all remote groups without needing Show all first', () => {
        render(<RemoteScopeCluster repo={mockRepos[0]} repos={mockRepos} />);

        fireEvent.click(screen.getByTestId('remote-chip'));
        fireEvent.change(screen.getByTestId('remote-search-input'), { target: { value: 'forge' } });
        const items = screen.getAllByTestId('remote-dropdown-item');
        expect(items).toHaveLength(1);
        expect(items[0].textContent).toContain('forge');
    });

    it('marks Work Items seen before switching to the remote-scoped tab', () => {
        mockWorkItemState = { unseenByRepo: { gh_acme_shortcuts: ['wi-1'] } };
        render(<RemoteScopeCluster repo={mockRepos[0]} repos={mockRepos} />);

        const workItems = screen.getAllByTestId('remote-scope-tab').find(el => el.getAttribute('data-subtab') === 'work-items')!;
        fireEvent.click(workItems);

        expect(mockWorkItemDispatch).toHaveBeenCalledWith({ type: 'MARK_WORK_ITEMS_SEEN', repoId: 'gh_acme_shortcuts' });
        expect(mockSwitchSubTab).toHaveBeenCalledWith('work-items');
    });

    it('highlights the active remote sub-tab on the repos tab', () => {
        mockAppState = { selectedRepoId: 'a', activeTab: 'repos', activeRepoSubTab: 'work-items' };
        render(<RemoteScopeCluster repo={mockRepos[0]} repos={mockRepos} />);

        const workItems = screen.getAllByTestId('remote-scope-tab').find(el => el.getAttribute('data-subtab') === 'work-items')!;
        expect(workItems.getAttribute('data-active')).toBe('true');
    });

    it('does not highlight WI/PR off the repos tab (e.g. Admin)', () => {
        // The header still renders on the top-level pages, but no workspace sub-tab
        // is being viewed there — so WI/PR must not show as active.
        mockAppState = { selectedRepoId: 'a', activeTab: 'admin', activeRepoSubTab: 'work-items' };
        render(<RemoteScopeCluster repo={mockRepos[0]} repos={mockRepos} />);

        const active = screen.getAllByTestId('remote-scope-tab').filter(el => el.getAttribute('data-active') === 'true');
        expect(active).toHaveLength(0);
    });
});
