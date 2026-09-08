/**
 * MobileScopeList — the mobile Repos-tab scope list.
 *
 * Covers the sections the old `ReposGrid` could not show (repo groups come from
 * `AppContext.workspaces`, never from `repos`), the single-clone shortcut, the
 * multi-clone expand, the offline-group read-only rule, and that selection runs
 * through the shared `selectClone` path rather than a bare navigate.
 *
 * @vitest-environment jsdom
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

const mockSelectClone = vi.fn();
const mockDispatch = vi.fn();
const mockGoToMyWork = vi.fn();
const mockGoToMyLife = vi.fn();
let mockQueueState: any = { repoQueueMap: {} };
let mockUnseen: Record<string, number> = {};
let mockWorkspaces: any[] = [];
let mockSelectedRepoId: string | null = null;
let mockRemoteGroupWorkspaces: any[] = [];
let mockMyWorkEnabled = true;
let mockMyLifeEnabled = true;
let mockPinnedScopesEnabled = false;

vi.mock('../../../../src/server/spa/client/react/api/cocClient', () => ({
    getSpaCocClient: () => ({
        preferences: {
            getGlobal: vi.fn().mockResolvedValue({ recentRemotes: [] }),
            patchGlobal: vi.fn().mockResolvedValue({}),
        },
    }),
}));
vi.mock('../../../../src/server/spa/client/react/contexts/AppContext', () => ({
    useApp: () => ({
        state: { workspaces: mockWorkspaces, selectedRepoId: mockSelectedRepoId, lastCloneByRemote: {} },
        dispatch: mockDispatch,
    }),
}));
vi.mock('../../../../src/server/spa/client/react/contexts/QueueContext', () => ({
    useQueue: () => ({ state: mockQueueState, dispatch: vi.fn() }),
}));
vi.mock('../../../../src/server/spa/client/react/contexts/ReposContext', () => ({
    useRepos: () => ({
        repos: [],
        unseenCounts: mockUnseen,
        fetchRepos: vi.fn().mockResolvedValue(undefined),
        remoteGroupWorkspaces: mockRemoteGroupWorkspaces,
    }),
}));
vi.mock('../../../../src/server/spa/client/react/features/remote-shell/useShellNavigation', () => ({
    useShellNavigation: () => ({ selectClone: mockSelectClone, switchSubTab: vi.fn() }),
}));
vi.mock('../../../../src/server/spa/client/react/hooks/useScopeNavigation', () => ({
    useScopeNavigation: () => ({ goToMyWork: mockGoToMyWork, goToMyLife: mockGoToMyLife }),
}));
vi.mock('../../../../src/server/spa/client/react/hooks/feature-flags/useMyWorkEnabled', () => ({
    useMyWorkEnabled: () => mockMyWorkEnabled,
}));
vi.mock('../../../../src/server/spa/client/react/hooks/feature-flags/useMyLifeEnabled', () => ({
    useMyLifeEnabled: () => mockMyLifeEnabled,
}));
vi.mock('../../../../src/server/spa/client/react/hooks/feature-flags/usePinnedScopesEnabled', () => ({
    usePinnedScopesEnabled: () => mockPinnedScopesEnabled,
}));
vi.mock('../../../../src/server/spa/client/react/repos/AddFolderDialog', () => ({ AddFolderDialog: () => null }));
vi.mock('../../../../src/server/spa/client/react/repos/AddRepoDialog', () => ({ AddRepoDialog: () => null }));
vi.mock('../../../../src/server/spa/client/react/repos/CloneRepoDialog', () => ({ CloneRepoDialog: () => null }));
vi.mock('../../../../src/server/spa/client/react/repos/RepoGroupDialog', () => ({
    RepoGroupDialog: ({ open, groupId }: { open: boolean; groupId?: string | null }) => (
        open ? <div data-testid="repo-group-dialog" data-group-id={groupId ?? ''} /> : null
    ),
}));
vi.mock('../../../../src/server/spa/client/react/repos/repoGroupService', () => ({
    deleteRepoGroup: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../../../../src/server/spa/client/react/repos/repositoryService', () => ({
    getGlobalPreferences: vi.fn().mockResolvedValue({}),
    removeWorkspace: vi.fn().mockResolvedValue(undefined),
}));

import { buildScopeListFooterText, MobileScopeList } from '../../../../src/server/spa/client/react/repos/MobileScopeList';

const SHORTCUTS = 'https://github.com/acme/shortcuts.git';
const FORGE = 'https://github.com/acme/forge.git';

const repo = (id: string, name: string, remoteUrl: string) => ({
    workspace: { id, name, color: '#0078d4', remoteUrl, rootPath: `/r/${id}` },
    gitInfo: { isGitRepo: true, branch: 'main', dirty: false, remoteUrl },
});

const offlineRemoteGroup = (id: string, name: string) => ({
    id,
    name,
    remote: { serverLabel: 'devbox', offline: true, baseUrl: 'http://127.0.0.1:4000' },
});

beforeEach(() => {
    cleanup();
    localStorage.clear();
    mockSelectClone.mockReset();
    mockDispatch.mockReset();
    mockGoToMyWork.mockReset();
    mockGoToMyLife.mockReset();
    mockQueueState = { repoQueueMap: {} };
    mockUnseen = {};
    mockWorkspaces = [];
    mockSelectedRepoId = null;
    mockRemoteGroupWorkspaces = [];
    mockMyWorkEnabled = true;
    mockMyLifeEnabled = true;
    mockPinnedScopesEnabled = false;
});

function sectionLabels(): string[] {
    return [...document.querySelectorAll('[data-testid="mobile-scope-list"] .uppercase')]
        .map(el => el.textContent ?? '');
}

describe('MobileScopeList', () => {
    it('renders the scope sections, not just a repo grid', () => {
        mockWorkspaces = [{ id: 'group-frontend', name: 'Frontend' }];
        render(<MobileScopeList repos={[repo('a', 'shortcuts', SHORTCUTS)] as any} />);

        expect(sectionLabels()).toEqual(['Scopes', 'Repo groups', 'Repositories']);
        expect(screen.getAllByTestId('scope-list-virtual-item').map(el => el.textContent))
            .toEqual(['💼 My Work', '🏠 My Life']);
    });

    it('surfaces a repo group from AppContext.workspaces even though `repos` holds none', () => {
        // The whole reason groups were unreachable on mobile: ReposContext filters
        // virtual workspaces out of `repos`, and ReposGrid only read `repos`.
        mockWorkspaces = [{ id: 'group-frontend', name: 'Frontend' }];
        render(<MobileScopeList repos={[] as any} />);

        const row = screen.getByTestId('repo-group-item');
        expect(row.textContent).toContain('Frontend');
        fireEvent.click(row);
        expect(mockSelectClone).toHaveBeenCalledWith('group-frontend');
    });

    it('opens a single-clone cluster directly instead of expanding it', () => {
        render(<MobileScopeList repos={[repo('a', 'shortcuts', SHORTCUTS)] as any} />);

        fireEvent.click(screen.getByTestId('scope-list-cluster-row'));
        expect(mockSelectClone).toHaveBeenCalledWith('a');
        expect(screen.queryByTestId('scope-list-clone')).toBeNull();
    });

    it('expands a multi-clone cluster rather than navigating', () => {
        const repos = [repo('a', 'shortcuts', SHORTCUTS), repo('b', 'shortcuts-2', SHORTCUTS)];
        render(<MobileScopeList repos={repos as any} />);

        // Collapsed by default is not the contract — the shared expanded-state key
        // starts every cluster open, so collapse then re-expand.
        const row = screen.getByTestId('scope-list-cluster-row');
        expect(screen.getAllByTestId('scope-list-clone')).toHaveLength(2);
        fireEvent.click(row);
        expect(mockSelectClone).not.toHaveBeenCalled();
        expect(screen.queryByTestId('scope-list-clone')).toBeNull();

        fireEvent.click(row);
        expect(screen.getAllByTestId('scope-list-clone')).toHaveLength(2);
        fireEvent.click(screen.getAllByTestId('scope-list-clone')[1]);
        expect(mockSelectClone).toHaveBeenCalledWith('b');
    });

    it('gives an offline remote group no ⋮ menu (it is read-only until it reconnects)', () => {
        mockRemoteGroupWorkspaces = [offlineRemoteGroup('group-remote', 'Remote group')];
        mockWorkspaces = [{ id: 'group-local', name: 'Local group' }];
        render(<MobileScopeList repos={[] as any} />);

        const menus = screen.getAllByTestId('repo-group-row-menu').map(el => el.getAttribute('data-remote-key'));
        expect(menus).toEqual(['group-local']);
    });

    it('filters clusters and groups from one search box', () => {
        mockWorkspaces = [{ id: 'group-frontend', name: 'Frontend' }];
        const repos = [repo('a', 'shortcuts', SHORTCUTS), repo('f', 'forge', FORGE)];
        render(<MobileScopeList repos={repos as any} />);

        fireEvent.change(screen.getByTestId('scope-list-search'), { target: { value: 'forge' } });
        expect(screen.getAllByTestId('scope-list-cluster-row')).toHaveLength(1);
        expect(screen.getByTestId('scope-list-cluster-row').textContent).toContain('forge');
        expect(screen.queryByTestId('repo-group-item')).toBeNull();
    });

    it('keeps the first-run empty state when nothing is registered', () => {
        render(<MobileScopeList repos={[] as any} />);
        expect(screen.getByTestId('repos-empty')).toBeTruthy();
    });

    it('opens the new-repo-group dialog from the + sheet', () => {
        render(<MobileScopeList repos={[] as any} />);

        fireEvent.click(screen.getByTestId('scope-list-add-btn'));
        fireEvent.click(screen.getByTestId('remote-new-repo-group-option'));
        expect(screen.getByTestId('repo-group-dialog').getAttribute('data-group-id')).toBe('');
    });
});

describe('buildScopeListFooterText', () => {
    it('names repo groups alongside repos, clones and running work', () => {
        const cloneGroup = { normalizedUrl: 'x', label: 'x', expanded: true, repos: [{}, {}] } as any;
        expect(buildScopeListFooterText(11, [cloneGroup], 3, 1))
            .toBe('11 repos · 2 clones in 1 remote · 3 groups · 1 running');
    });

    it('drops the clone and group clauses when there are none', () => {
        expect(buildScopeListFooterText(1, [], 0, 0)).toBe('1 repo · 0 running');
    });
});
