/**
 * ScopePickerSheet — the mobile presentation of the desktop scope picker, plus
 * the model-parity check that keeps the two shells from drifting.
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
    useMyWorkEnabled: () => true,
}));
vi.mock('../../../../src/server/spa/client/react/hooks/feature-flags/useMyLifeEnabled', () => ({
    useMyLifeEnabled: () => true,
}));
vi.mock('../../../../src/server/spa/client/react/hooks/feature-flags/usePinnedScopesEnabled', () => ({
    usePinnedScopesEnabled: () => false,
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
    removeWorkspace: vi.fn().mockResolvedValue(undefined),
}));

import { ScopePickerSheet } from '../../../../src/server/spa/client/react/features/remote-shell/ScopePickerSheet';
import { WorkspaceIdentityChip } from '../../../../src/server/spa/client/react/features/remote-shell/WorkspaceIdentityChip';
import { useScopePickerModel } from '../../../../src/server/spa/client/react/features/remote-shell/useScopePickerModel';

const SHORTCUTS = 'https://github.com/acme/shortcuts.git';
const FORGE = 'https://github.com/acme/forge.git';

const repo = (id: string, name: string, remoteUrl: string) => ({
    workspace: { id, name, color: '#0078d4', remoteUrl, rootPath: `/r/${id}` },
    gitInfo: { isGitRepo: true, branch: 'main', dirty: false, remoteUrl },
});

beforeEach(() => {
    cleanup();
    mockSelectClone.mockReset();
    mockDispatch.mockReset();
    mockGoToMyWork.mockReset();
    mockGoToMyLife.mockReset();
    mockQueueState = { repoQueueMap: {} };
    mockUnseen = {};
    mockWorkspaces = [];
    mockSelectedRepoId = null;
    mockRemoteGroupWorkspaces = [];
});

function sheetSections(): string[] {
    return [...document.querySelectorAll('[data-testid="scope-picker-sheet"] .uppercase')]
        .map(el => el.textContent ?? '');
}

describe('ScopePickerSheet', () => {
    it('renders all four sections plus the add-repository footer', () => {
        mockWorkspaces = [{ id: 'group-frontend', name: 'Frontend' }];
        render(<ScopePickerSheet open onClose={vi.fn()} repos={[repo('a', 'shortcuts', SHORTCUTS)] as any} />);

        expect(sheetSections()).toEqual(['Scopes', 'Repo groups', 'Repositories', 'Add repository']);
        expect(screen.getByTestId('remote-new-repo-group-option')).toBeTruthy();
    });

    it('filters across sections from one search box', () => {
        mockWorkspaces = [{ id: 'group-frontend', name: 'Frontend' }, { id: 'group-forgery', name: 'Forge team' }];
        const repos = [repo('a', 'shortcuts', SHORTCUTS), repo('f', 'forge', FORGE)];
        render(<ScopePickerSheet open onClose={vi.fn()} repos={repos as any} />);

        fireEvent.change(screen.getByTestId('scope-picker-search'), { target: { value: 'forge' } });

        // The group name and the remote both match; My Work / My Life do not.
        expect(screen.getAllByTestId('repo-group-item').map(el => el.textContent)).toHaveLength(1);
        expect(screen.getByTestId('repo-group-item').textContent).toContain('Forge team');
        expect(screen.getAllByTestId('remote-dropdown-item')).toHaveLength(1);
        expect(screen.getByTestId('remote-dropdown-item').textContent).toContain('forge');
        expect(screen.queryByTestId('scope-picker-virtual-item')).toBeNull();
    });

    it('routes a cluster pick through selectClone and closes', () => {
        const onClose = vi.fn();
        render(<ScopePickerSheet open onClose={onClose} repos={[repo('a', 'shortcuts', SHORTCUTS)] as any} />);

        fireEvent.click(screen.getByTestId('remote-dropdown-item'));
        expect(mockSelectClone).toHaveBeenCalledWith('a');
        expect(onClose).toHaveBeenCalled();
    });

    it('opens the group dialog from the footer', () => {
        render(<ScopePickerSheet open onClose={vi.fn()} repos={[] as any} />);

        fireEvent.click(screen.getByTestId('remote-new-repo-group-option'));
        expect(screen.getByTestId('repo-group-dialog').getAttribute('data-group-id')).toBe('');
    });

    it('renders nothing when closed', () => {
        const { container } = render(<ScopePickerSheet open={false} onClose={vi.fn()} repos={[] as any} />);
        expect(container.querySelector('[data-testid="scope-picker-sheet"]')).toBeNull();
    });
});

/**
 * Model parity — the point of extracting `useScopePickerModel`. If the desktop
 * dropdown ever grows a row the model does not know about (or vice versa), this
 * fails rather than the two shells silently disagreeing.
 */
describe('useScopePickerModel parity with the desktop picker', () => {
    function ModelProbe({ repos }: { repos: any[] }) {
        const model = useScopePickerModel(repos);
        return (
            <div
                data-testid="model-probe"
                data-groups={model.groupRows.map(r => r.id).join(',')}
                data-remotes={model.remoteRows.map(r => r.key).join(',')}
                data-remote-names={model.remoteRows.map(r => r.summary.name).join(',')}
                data-footer={model.footerActions.map(a => a.testId).join(',')}
            />
        );
    }

    it('returns exactly the rows the desktop dropdown renders', () => {
        mockWorkspaces = [{ id: 'group-frontend', name: 'Frontend' }, { id: 'group-infra', name: 'Infra' }];
        const repos = [repo('a', 'shortcuts', SHORTCUTS), repo('f', 'forge', FORGE)];

        render(<WorkspaceIdentityChip repo={repos[0] as any} repos={repos as any} />);
        fireEvent.click(screen.getByTestId('remote-chip'));
        const renderedGroups = screen.getAllByTestId('repo-group-item').map(el => el.getAttribute('data-remote-key'));
        const renderedRemotes = screen.getAllByTestId('remote-dropdown-item').map(el => el.getAttribute('data-remote-key'));
        const renderedFooter = [...document.querySelectorAll('[data-testid="remote-dropdown"] ~ *, [data-testid="remote-dropdown"] [role="menuitem"]')]
            .map(el => el.getAttribute('data-testid'))
            .filter((id): id is string => !!id && id.endsWith('-option'));
        // Guard the comparison against trivially matching two empty lists.
        expect(renderedGroups).toEqual(['group-frontend', 'group-infra']);
        expect(renderedRemotes).toHaveLength(2);
        expect(renderedFooter).toHaveLength(4);
        cleanup();

        render(<ModelProbe repos={repos} />);
        const probe = screen.getByTestId('model-probe');
        expect(probe.getAttribute('data-groups')).toBe(renderedGroups.join(','));
        expect(probe.getAttribute('data-remotes')).toBe(renderedRemotes.join(','));
        expect(probe.getAttribute('data-footer')).toBe(renderedFooter.join(','));
    });

    it('feeds the mobile sheet the same cluster rows the desktop dropdown shows', () => {
        const repos = [repo('a', 'shortcuts', SHORTCUTS), repo('f', 'forge', FORGE)];

        render(<WorkspaceIdentityChip repo={repos[0] as any} repos={repos as any} />);
        fireEvent.click(screen.getByTestId('remote-chip'));
        const desktop = screen.getAllByTestId('remote-dropdown-item').map(el => el.getAttribute('data-remote-key'));
        expect(desktop).toHaveLength(2);
        cleanup();

        render(<ScopePickerSheet open onClose={vi.fn()} repos={repos as any} />);
        const mobile = screen.getAllByTestId('remote-dropdown-item').map(el => el.getAttribute('data-remote-key'));
        expect(mobile).toEqual(desktop);
    });
});
