/**
 * WorkspaceIdentityChip — remotes-picker row menu with "Remove from CoC" (AC-01).
 *
 * Covers the row-level menu affordance on group rows: present only for
 * single-clone groups, disabled when the owning remote server is offline, and
 * driving the shared confirm dialog / removal flow.
 *
 * @vitest-environment jsdom
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

const mockSelectClone = vi.fn();
const mockFetchRepos = vi.fn().mockResolvedValue(undefined);
const mockRemoveWorkspace = vi.fn().mockResolvedValue(undefined);
const mockDeleteRepoGroup = vi.fn().mockResolvedValue(undefined);
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
    useApp: () => ({ state: { workspaces: mockWorkspaces, selectedRepoId: mockSelectedRepoId }, dispatch: vi.fn() }),
}));
vi.mock('../../../../src/server/spa/client/react/contexts/QueueContext', () => ({
    useQueue: () => ({ state: mockQueueState, dispatch: vi.fn() }),
}));
vi.mock('../../../../src/server/spa/client/react/contexts/ReposContext', () => ({
    useRepos: () => ({ repos: [], unseenCounts: mockUnseen, fetchRepos: mockFetchRepos, remoteGroupWorkspaces: mockRemoteGroupWorkspaces }),
}));
vi.mock('../../../../src/server/spa/client/react/features/remote-shell/useShellNavigation', () => ({
    useShellNavigation: () => ({ selectClone: mockSelectClone, switchSubTab: vi.fn() }),
}));
// Both doubles echo the server pre-selection props back as data attributes so the
// chip -> dialog wiring is assertable. Passing them through raw (no `?? ''`) keeps
// "prop was undefined" distinguishable from "prop was an empty string": React drops
// an undefined attribute entirely, so getAttribute() returns null.
type AddDialogProps = { open: boolean; serverId?: string; baseUrl?: string };
vi.mock('../../../../src/server/spa/client/react/repos/AddFolderDialog', () => ({
    AddFolderDialog: ({ open, serverId, baseUrl }: AddDialogProps) => (
        open ? <div data-testid="add-folder-dialog" data-server-id={serverId} data-base-url={baseUrl} /> : null
    ),
}));
vi.mock('../../../../src/server/spa/client/react/repos/AddRepoDialog', () => ({
    AddRepoDialog: ({ open, serverId, baseUrl }: AddDialogProps) => (
        open ? <div data-testid="add-repo-dialog" data-server-id={serverId} data-base-url={baseUrl} /> : null
    ),
}));
vi.mock('../../../../src/server/spa/client/react/repos/CloneRepoDialog', () => ({
    CloneRepoDialog: ({ open }: { open: boolean }) => (open ? <div data-testid="clone-repo-dialog" /> : null),
}));
vi.mock('../../../../src/server/spa/client/react/repos/repositoryService', () => ({
    removeWorkspace: (...args: unknown[]) => mockRemoveWorkspace(...args),
}));
vi.mock('../../../../src/server/spa/client/react/repos/RepoGroupDialog', () => ({
    RepoGroupDialog: ({ open, groupId, groupBaseUrl }: { open: boolean; groupId?: string | null; groupBaseUrl?: string }) => (
        open ? <div data-testid="repo-group-dialog" data-group-id={groupId ?? ''} data-group-base-url={groupBaseUrl ?? ''} /> : null
    ),
}));
vi.mock('../../../../src/server/spa/client/react/repos/repoGroupService', () => ({
    deleteRepoGroup: (...args: unknown[]) => mockDeleteRepoGroup(...args),
}));

import { resolveRepoCopyPath, WorkspaceIdentityChip } from '../../../../src/server/spa/client/react/features/remote-shell/WorkspaceIdentityChip';

const SHORTCUTS = 'https://github.com/acme/shortcuts.git';
const FORGE = 'https://github.com/acme/forge.git';

const repo = (id: string, name: string, remoteUrl: string) => ({
    workspace: { id, name, color: '#0078d4', remoteUrl, rootPath: `/r/${id}` },
    gitInfo: { isGitRepo: true, branch: 'main', dirty: false, remoteUrl },
});

const remoteRepo = (id: string, name: string, remoteUrl: string, connection: string) => ({
    workspace: {
        id, name, color: '#0078d4', remoteUrl, rootPath: `/remote/${id}`,
        remote: { baseUrl: 'http://127.0.0.1:4000', serverId: 'srv-1', serverLabel: 'devbox', connection, queue: 'idle' },
    },
    gitInfo: { isGitRepo: true, branch: 'main', dirty: false, remoteUrl },
});

beforeEach(() => {
    cleanup();
    mockSelectClone.mockReset();
    mockFetchRepos.mockClear();
    mockRemoveWorkspace.mockReset().mockResolvedValue(undefined);
    mockDeleteRepoGroup.mockReset().mockResolvedValue(undefined);
    mockQueueState = { repoQueueMap: {} };
    mockUnseen = {};
    mockWorkspaces = [];
    mockSelectedRepoId = null;
    mockRemoteGroupWorkspaces = [];
});

function openPicker(repos: any[], selected: any) {
    render(<WorkspaceIdentityChip repo={selected} repos={repos as any} />);
    fireEvent.click(screen.getByTestId('remote-chip'));
}

function rowMenuFor(name: string): HTMLElement | undefined {
    return screen.queryAllByTestId('remote-dropdown-row-menu')
        .find(btn => btn.getAttribute('aria-label')?.includes(name));
}

function removeItem(): HTMLElement | undefined {
    return screen.queryAllByRole('menuitem').find(el => el.textContent?.includes('Remove from CoC'));
}

describe('WorkspaceIdentityChip row menu (AC-01)', () => {
    it('offers a row menu with Remove from CoC on a single-clone group row', () => {
        const repos = [repo('a', 'shortcuts', SHORTCUTS), repo('f', 'forge', FORGE)];
        openPicker(repos, repos[0]);

        const menuBtn = rowMenuFor('forge')!;
        expect(menuBtn).toBeTruthy();
        fireEvent.click(menuBtn);
        expect(removeItem()).toBeTruthy();
    });

    it('does not offer a row menu on a multi-clone group row', () => {
        // Two clones of the same remote collapse into one group row; removing the
        // whole group in one action is never offered.
        const repos = [repo('a', 'shortcuts', SHORTCUTS), repo('b', 'shortcuts-2', SHORTCUTS)];
        openPicker(repos, repos[0]);

        expect(screen.getAllByTestId('remote-dropdown-item')).toHaveLength(1);
        expect(screen.queryAllByTestId('remote-dropdown-row-menu')).toHaveLength(0);
    });

    it('confirms then removes the clone, refetches and toasts', async () => {
        const repos = [repo('a', 'shortcuts', SHORTCUTS), repo('f', 'forge', FORGE)];
        openPicker(repos, repos[0]);

        fireEvent.click(rowMenuFor('forge')!);
        fireEvent.click(removeItem()!);

        const dialog = screen.getByTestId('dialog-overlay');
        expect(dialog.textContent).toContain('Remove from CoC?');
        expect(dialog.textContent).toContain('forge');

        fireEvent.click(screen.getByTestId('clone-remove-confirm-btn'));
        await waitFor(() => expect(mockRemoveWorkspace).toHaveBeenCalledWith('f'));
        await waitFor(() => expect(mockFetchRepos).toHaveBeenCalled());
        await waitFor(() => expect(screen.getByText('Removed forge')).toBeTruthy());
        expect(screen.queryByTestId('clone-remove-confirm-btn')).toBeNull();
    });

    it('keeps the row and toasts on failure', async () => {
        mockRemoveWorkspace.mockRejectedValue(new Error('boom'));
        const repos = [repo('a', 'shortcuts', SHORTCUTS), repo('f', 'forge', FORGE)];
        openPicker(repos, repos[0]);

        fireEvent.click(rowMenuFor('forge')!);
        fireEvent.click(removeItem()!);
        fireEvent.click(screen.getByTestId('clone-remove-confirm-btn'));

        await waitFor(() => expect(screen.getByText('Failed to remove forge')).toBeTruthy());
        expect(screen.getByTestId('clone-remove-confirm-btn')).toBeTruthy();
    });

    it('leaves selection alone when the removed row is not the selected one', async () => {
        const repos = [repo('a', 'shortcuts', SHORTCUTS), repo('f', 'forge', FORGE)];
        openPicker(repos, repos[0]);

        fireEvent.click(rowMenuFor('forge')!);
        fireEvent.click(removeItem()!);
        fireEvent.click(screen.getByTestId('clone-remove-confirm-btn'));

        await waitFor(() => expect(mockRemoveWorkspace).toHaveBeenCalledWith('f'));
        expect(mockSelectClone).not.toHaveBeenCalled();
    });

    it('disables Remove when the owning remote server is offline', () => {
        const repos = [repo('a', 'shortcuts', SHORTCUTS), remoteRepo('r', 'forge', FORGE, 'offline')];
        openPicker(repos, repos[0]);

        fireEvent.click(rowMenuFor('forge')!);
        const item = removeItem()!;
        expect(item.hasAttribute('disabled')).toBe(true);
        expect(item.closest('[title]')?.getAttribute('title')).toBe('Cannot remove - devbox is offline');
    });

    it('enables Remove for an online remote repo', () => {
        const repos = [repo('a', 'shortcuts', SHORTCUTS), remoteRepo('r', 'forge', FORGE, 'online')];
        openPicker(repos, repos[0]);

        fireEvent.click(rowMenuFor('forge')!);
        expect(removeItem()!.hasAttribute('disabled')).toBe(false);
    });

    it('keeps the dropdown open while the row menu is used', () => {
        const repos = [repo('a', 'shortcuts', SHORTCUTS), repo('f', 'forge', FORGE)];
        openPicker(repos, repos[0]);

        fireEvent.mouseDown(rowMenuFor('forge')!);
        fireEvent.click(rowMenuFor('forge')!);
        fireEvent.mouseDown(removeItem()!);
        expect(screen.getByTestId('remote-dropdown')).toBeTruthy();
    });
});

describe('WorkspaceIdentityChip row menu — Copy path (AC-01/AC-02)', () => {
    function copyItem(): HTMLElement | undefined {
        return screen.queryAllByRole('menuitem').find(el => el.textContent?.includes('Copy path'));
    }

    function mockClipboard() {
        const writeText = vi.fn().mockResolvedValue(undefined);
        Object.defineProperty(navigator, 'clipboard', {
            value: { writeText },
            configurable: true,
        });
        return writeText;
    }

    it('offers Copy path alongside Remove from CoC', () => {
        const repos = [repo('a', 'shortcuts', SHORTCUTS), repo('f', 'forge', FORGE)];
        openPicker(repos, repos[0]);

        fireEvent.click(rowMenuFor('forge')!);
        expect(copyItem()).toBeTruthy();
        expect(removeItem()).toBeTruthy();
    });

    it('copies the server-resolved copyPath and toasts', async () => {
        const writeText = mockClipboard();
        const repos = [repo('a', 'shortcuts', SHORTCUTS), repo('f', 'forge', FORGE)];
        // The server hands the SPA a host-reachable path — inside WSL that is the
        // Windows UNC form, which the client copies verbatim (AC-02).
        (repos[1].workspace as any).copyPath = '\\\\wsl.localhost\\Ubuntu\\r\\f';
        openPicker(repos, repos[0]);

        fireEvent.click(rowMenuFor('forge')!);
        fireEvent.click(copyItem()!);

        await waitFor(() => expect(writeText).toHaveBeenCalledWith('\\\\wsl.localhost\\Ubuntu\\r\\f'));
        await waitFor(() => expect(screen.getByText('Path copied to clipboard')).toBeTruthy());
    });

    it('falls back to the raw workspace path when the server sent no copyPath', async () => {
        const writeText = mockClipboard();
        const repos = [repo('a', 'shortcuts', SHORTCUTS), repo('f', 'forge', FORGE)];
        openPicker(repos, repos[0]);

        fireEvent.click(rowMenuFor('forge')!);
        fireEvent.click(copyItem()!);

        await waitFor(() => expect(writeText).toHaveBeenCalledWith('/r/f'));
    });

    it('toasts an error when the clipboard write rejects', async () => {
        const writeText = vi.fn().mockRejectedValue(new Error('denied'));
        Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
        const repos = [repo('a', 'shortcuts', SHORTCUTS), repo('f', 'forge', FORGE)];
        openPicker(repos, repos[0]);

        fireEvent.click(rowMenuFor('forge')!);
        fireEvent.click(copyItem()!);

        await waitFor(() => expect(screen.getByText('Could not copy path')).toBeTruthy());
    });

    it('disables Copy path when the workspace has no resolvable path', () => {
        const repos = [repo('a', 'shortcuts', SHORTCUTS), repo('f', 'forge', FORGE)];
        delete (repos[1].workspace as any).rootPath;
        openPicker(repos, repos[0]);

        fireEvent.click(rowMenuFor('forge')!);
        const item = copyItem()!;
        expect(item.hasAttribute('disabled')).toBe(true);
        expect(item.closest('[title]')?.getAttribute('title')).toContain('no local path');
    });
});

describe('resolveRepoCopyPath', () => {
    it('prefers copyPath, then path, then rootPath', () => {
        expect(resolveRepoCopyPath({ workspace: { copyPath: '\\\\unc', path: '/p', rootPath: '/r' } } as any)).toBe('\\\\unc');
        expect(resolveRepoCopyPath({ workspace: { path: '/p', rootPath: '/r' } } as any)).toBe('/p');
        expect(resolveRepoCopyPath({ workspace: { rootPath: '/r' } } as any)).toBe('/r');
    });

    it('returns null when nothing usable is present', () => {
        expect(resolveRepoCopyPath({ workspace: {} } as any)).toBeNull();
        expect(resolveRepoCopyPath({ workspace: { rootPath: '   ' } } as any)).toBeNull();
        expect(resolveRepoCopyPath({ workspace: { rootPath: 42 } } as any)).toBeNull();
        expect(resolveRepoCopyPath({} as any)).toBeNull();
    });
});

describe('WorkspaceIdentityChip group row — WSL pill (AC-03)', () => {
    const wslRepo = (id: string, name: string, remoteUrl: string, distro: string | null = 'Ubuntu') => ({
        workspace: {
            id, name, color: '#0078d4', remoteUrl,
            rootPath: `//wsl.localhost/Ubuntu/home/u/${id}`,
            wsl: { distro },
        },
        gitInfo: { isGitRepo: true, branch: 'main', dirty: false, remoteUrl },
    });

    function groupRowFor(name: string): HTMLElement | undefined {
        return screen.queryAllByTestId('remote-dropdown-item')
            .find(row => row.textContent?.includes(name));
    }

    it('shows the pill when every clone in the group is WSL-hosted', () => {
        const repos = [wslRepo('a', 'shortcuts', SHORTCUTS), wslRepo('b', 'shortcuts-2', SHORTCUTS)];
        openPicker(repos, repos[0]);

        const badge = groupRowFor('shortcuts')!.querySelector('[data-testid="wsl-badge"]')!;
        expect(badge).toBeTruthy();
        expect(badge.textContent).toBe('WSL');
        expect(badge.getAttribute('aria-label')).toBe('Hosted in WSL (Ubuntu)');
    });

    it('shows no pill on a mixed group', () => {
        const repos = [wslRepo('a', 'shortcuts', SHORTCUTS), repo('b', 'shortcuts-2', SHORTCUTS)];
        openPicker(repos, repos[0]);

        expect(screen.getAllByTestId('remote-dropdown-item')).toHaveLength(1);
        expect(screen.queryAllByTestId('wsl-badge')).toHaveLength(0);
    });

    it('shows no pill when no clone is WSL-hosted', () => {
        const repos = [repo('a', 'shortcuts', SHORTCUTS), repo('f', 'forge', FORGE)];
        openPicker(repos, repos[0]);

        expect(screen.queryAllByTestId('wsl-badge')).toHaveLength(0);
    });

    it('keeps the clone-count badge alongside the pill on an all-WSL group', () => {
        const repos = [wslRepo('a', 'shortcuts', SHORTCUTS), wslRepo('b', 'shortcuts-2', SHORTCUTS)];
        openPicker(repos, repos[0]);

        const row = groupRowFor('shortcuts')!;
        expect(row.querySelector('[data-testid="wsl-badge"]')).toBeTruthy();
        expect(row.textContent).toContain('2');
    });
});

describe('WorkspaceIdentityChip group row — remote-server marker', () => {
    const aggregatedRepo = (id: string, name: string, remoteUrl: string, serverLabel = 'devbox') => ({
        workspace: {
            id, name, color: '#0078d4', remoteUrl, rootPath: `/remote/${id}`,
            baseUrl: 'http://127.0.0.1:4000',
            remote: { serverId: 'srv-1', serverLabel, connection: 'online', queue: 'idle' },
        },
        gitInfo: { isGitRepo: true, branch: 'main', dirty: false, remoteUrl },
    });

    function groupRowFor(name: string): HTMLElement | undefined {
        return screen.queryAllByTestId('remote-dropdown-item')
            .find(row => row.textContent?.includes(name));
    }

    it('marks a group that has one remote clone among local ones', () => {
        const repos = [repo('a', 'shortcuts', SHORTCUTS), aggregatedRepo('b', 'shortcuts-2', SHORTCUTS)];
        openPicker(repos, repos[0]);

        const badge = groupRowFor('shortcuts')!.querySelector('[data-testid="remote-server-badge"]')!;
        expect(badge).toBeTruthy();
        expect(badge.getAttribute('aria-label')).toBe('Includes a repo from remote server devbox');
    });

    it('marks a remote-only group', () => {
        const repos = [aggregatedRepo('a', 'shortcuts', SHORTCUTS)];
        openPicker(repos, repos[0]);

        expect(screen.getAllByTestId('remote-server-badge')).toHaveLength(1);
    });

    it('shows no marker on a local-only group', () => {
        const repos = [repo('a', 'shortcuts', SHORTCUTS), repo('f', 'forge', FORGE)];
        openPicker(repos, repos[0]);

        expect(screen.queryAllByTestId('remote-server-badge')).toHaveLength(0);
    });

    it('marks only the group that owns the remote clone', () => {
        const repos = [repo('a', 'shortcuts', SHORTCUTS), aggregatedRepo('f', 'forge', FORGE)];
        openPicker(repos, repos[0]);

        expect(groupRowFor('shortcuts')!.querySelector('[data-testid="remote-server-badge"]')).toBeNull();
        expect(groupRowFor('forge')!.querySelector('[data-testid="remote-server-badge"]')).toBeTruthy();
    });

    it('lists every distinct server behind a group in the marker label', () => {
        const repos = [
            aggregatedRepo('a', 'shortcuts', SHORTCUTS, 'zeta'),
            aggregatedRepo('b', 'shortcuts-2', SHORTCUTS, 'alpha'),
        ];
        openPicker(repos, repos[0]);

        const badge = groupRowFor('shortcuts')!.querySelector('[data-testid="remote-server-badge"]')!;
        expect(badge.getAttribute('aria-label')).toBe('Includes a repo from remote server alpha, zeta');
    });

    it('keeps the clone-count badge alongside the marker', () => {
        const repos = [repo('a', 'shortcuts', SHORTCUTS), aggregatedRepo('b', 'shortcuts-2', SHORTCUTS)];
        openPicker(repos, repos[0]);

        const row = groupRowFor('shortcuts')!;
        expect(row.querySelector('[data-testid="remote-server-badge"]')).toBeTruthy();
        expect(row.textContent).toContain('2');
    });
});

describe('WorkspaceIdentityChip repo groups (repo-group AC-01/AC-04)', () => {
    const groupWs = (id: string, name: string) => ({ id, name, rootPath: `/data/repos/${id}`, virtual: true });

    /** A repo group contributed by a remote CoC server (AC-02/AC-04). */
    const remoteGroupWs = (id: string, name: string, offline = false) => ({
        id,
        name,
        rootPath: `/home/dev/.coc/repos/${id}`,
        virtual: true,
        baseUrl: 'http://127.0.0.1:4000',
        remote: {
            baseUrl: 'http://127.0.0.1:4000',
            serverId: 'srv-1',
            serverLabel: 'devbox',
            offline,
            connection: offline ? 'offline' : 'online',
            queue: 'idle',
        },
    });

    function groupRowMenuFor(name: string): HTMLElement | undefined {
        return screen.queryAllByTestId('repo-group-row-menu')
            .find(btn => btn.getAttribute('aria-label')?.includes(name));
    }

    function menuItem(label: string): HTMLElement | undefined {
        return screen.queryAllByRole('menuitem').find(el => el.textContent?.includes(label));
    }

    it('renders a Repo groups section with a distinct icon for group workspaces only', () => {
        // Groups come from the FULL AppContext workspace list (they are virtual,
        // so ReposContext filters them out of `repos`); plain and other virtual
        // workspaces never render as group rows.
        mockWorkspaces = [
            groupWs('group-platform', 'Platform'),
            { id: 'a', name: 'shortcuts', rootPath: '/r/a' },
            { id: 'my_work', name: 'My Work', virtual: true },
        ];
        openPicker([repo('a', 'shortcuts', SHORTCUTS)], undefined);

        const rows = screen.getAllByTestId('repo-group-item');
        expect(rows).toHaveLength(1);
        expect(rows[0].textContent).toContain('Platform');
        expect(rows[0].getAttribute('data-remote-key')).toBe('group-platform');
        expect(screen.getByTestId('remote-dropdown').textContent).toContain('Repo groups');
        expect(rows[0].parentElement!.querySelector('[data-testid="repo-group-icon"]')).toBeTruthy();
    });

    it('renders no Repo groups section when no group workspaces exist', () => {
        mockWorkspaces = [{ id: 'a', name: 'shortcuts', rootPath: '/r/a' }];
        openPicker([repo('a', 'shortcuts', SHORTCUTS)], undefined);

        expect(screen.queryAllByTestId('repo-group-item')).toHaveLength(0);
        expect(screen.getByTestId('remote-dropdown').textContent).not.toContain('Repo groups');
    });

    it('filters group rows by the search query', () => {
        mockWorkspaces = [groupWs('group-platform', 'Platform'), groupWs('group-tools', 'Tools')];
        openPicker([repo('a', 'shortcuts', SHORTCUTS)], undefined);

        fireEvent.change(screen.getByTestId('remote-search-input'), { target: { value: 'plat' } });
        const rows = screen.getAllByTestId('repo-group-item');
        expect(rows).toHaveLength(1);
        expect(rows[0].textContent).toContain('Platform');
    });

    it('selects the group workspace on row click and closes the picker (AC-02)', () => {
        mockWorkspaces = [groupWs('group-platform', 'Platform')];
        openPicker([repo('a', 'shortcuts', SHORTCUTS)], undefined);

        fireEvent.click(screen.getByTestId('repo-group-item'));
        expect(mockSelectClone).toHaveBeenCalledWith('group-platform');
        expect(screen.queryByTestId('remote-dropdown')).toBeNull();
    });

    it('marks the selected group row active', () => {
        mockWorkspaces = [groupWs('group-platform', 'Platform'), groupWs('group-tools', 'Tools')];
        mockSelectedRepoId = 'group-platform';
        openPicker([repo('a', 'shortcuts', SHORTCUTS)], undefined);

        const rows = screen.getAllByTestId('repo-group-item');
        expect(rows.find(r => r.getAttribute('data-remote-key') === 'group-platform')!.getAttribute('data-active')).toBe('true');
        expect(rows.find(r => r.getAttribute('data-remote-key') === 'group-tools')!.getAttribute('data-active')).toBe('false');
    });

    it('opens the create dialog from the "New repo group…" footer action', () => {
        openPicker([repo('a', 'shortcuts', SHORTCUTS)], undefined);

        fireEvent.click(screen.getByTestId('remote-new-repo-group-option'));
        const dialog = screen.getByTestId('repo-group-dialog');
        expect(dialog.getAttribute('data-group-id')).toBe('');
        expect(screen.queryByTestId('remote-dropdown')).toBeNull();
    });

    it('opens the edit dialog for the group from its row menu', () => {
        mockWorkspaces = [groupWs('group-platform', 'Platform')];
        openPicker([repo('a', 'shortcuts', SHORTCUTS)], undefined);

        fireEvent.click(groupRowMenuFor('Platform')!);
        fireEvent.click(menuItem('Edit group')!);
        expect(screen.getByTestId('repo-group-dialog').getAttribute('data-group-id')).toBe('group-platform');
    });

    it('deletes the group after confirmation, refetches and toasts (AC-04)', async () => {
        mockWorkspaces = [groupWs('group-platform', 'Platform')];
        openPicker([repo('a', 'shortcuts', SHORTCUTS)], undefined);

        fireEvent.click(groupRowMenuFor('Platform')!);
        fireEvent.click(menuItem('Delete group')!);

        const dialog = screen.getByTestId('dialog-overlay');
        expect(dialog.textContent).toContain('Delete repo group?');
        expect(dialog.textContent).toContain('Platform');
        expect(dialog.textContent).toContain('stays on disk');
        expect(mockDeleteRepoGroup).not.toHaveBeenCalled();

        fireEvent.click(screen.getByTestId('repo-group-delete-confirm-btn'));
        await waitFor(() => expect(mockDeleteRepoGroup).toHaveBeenCalledWith('group-platform', undefined));
        await waitFor(() => expect(mockFetchRepos).toHaveBeenCalled());
        await waitFor(() => expect(screen.getByText('Deleted group Platform')).toBeTruthy());
        expect(screen.queryByTestId('repo-group-delete-confirm-btn')).toBeNull();
    });

    it('keeps the group and toasts when deletion fails', async () => {
        mockDeleteRepoGroup.mockRejectedValue(new Error('boom'));
        mockWorkspaces = [groupWs('group-platform', 'Platform')];
        openPicker([repo('a', 'shortcuts', SHORTCUTS)], undefined);

        fireEvent.click(groupRowMenuFor('Platform')!);
        fireEvent.click(menuItem('Delete group')!);
        fireEvent.click(screen.getByTestId('repo-group-delete-confirm-btn'));

        await waitFor(() => expect(screen.getByText('Failed to delete group Platform')).toBeTruthy());
        expect(screen.getByTestId('repo-group-delete-confirm-btn')).toBeTruthy();
    });

    // ── Remote-server groups (AC-02 / AC-04) ──────────────────────────────

    it('lists a remote server\'s groups alongside local ones, badged with the server', () => {
        mockWorkspaces = [groupWs('group-platform', 'Platform')];
        mockRemoteGroupWorkspaces = [remoteGroupWs('group-devbox-svc', 'Devbox Services')];
        openPicker([repo('a', 'shortcuts', SHORTCUTS)], undefined);

        const names = screen.queryAllByTestId('repo-group-item').map(el => el.textContent);
        expect(names.some(t => t?.includes('Platform'))).toBe(true);
        const remoteRow = screen.queryAllByTestId('repo-group-item')
            .find(el => el.textContent?.includes('Devbox Services'));
        expect(remoteRow).toBeTruthy();
        // The server name is on the row, and only the remote row carries the badge.
        expect(remoteRow!.textContent).toContain('devbox');
        expect(screen.queryAllByTestId('repo-group-server-badge')).toHaveLength(1);
    });

    it('selects a remote group by its own workspace id (clone-registry routing)', () => {
        mockRemoteGroupWorkspaces = [remoteGroupWs('group-devbox-svc', 'Devbox Services')];
        openPicker([repo('a', 'shortcuts', SHORTCUTS)], undefined);

        const remoteRow = screen.queryAllByTestId('repo-group-item')
            .find(el => el.textContent?.includes('Devbox Services'))!;
        fireEvent.click(remoteRow);
        expect(mockSelectClone).toHaveBeenCalledWith('group-devbox-svc');
    });

    it('proxies edit and delete of a remote group to its server base URL', async () => {
        mockRemoteGroupWorkspaces = [remoteGroupWs('group-devbox-svc', 'Devbox Services')];
        openPicker([repo('a', 'shortcuts', SHORTCUTS)], undefined);

        fireEvent.click(groupRowMenuFor('Devbox Services')!);
        fireEvent.click(menuItem('Edit group')!);
        const dialog = screen.getByTestId('repo-group-dialog');
        expect(dialog.getAttribute('data-group-id')).toBe('group-devbox-svc');
        expect(dialog.getAttribute('data-group-base-url')).toBe('http://127.0.0.1:4000');

        // Reopen the picker (the edit action closed it) and delete instead.
        cleanup();
        openPicker([repo('a', 'shortcuts', SHORTCUTS)], undefined);
        fireEvent.click(groupRowMenuFor('Devbox Services')!);
        fireEvent.click(menuItem('Delete group')!);
        fireEvent.click(screen.getByTestId('repo-group-delete-confirm-btn'));
        await waitFor(() => expect(mockDeleteRepoGroup)
            .toHaveBeenCalledWith('group-devbox-svc', 'http://127.0.0.1:4000'));
    });

    it('renders an offline server\'s groups greyed and read-only (AC-04)', () => {
        mockWorkspaces = [groupWs('group-platform', 'Platform')];
        mockRemoteGroupWorkspaces = [remoteGroupWs('group-devbox-svc', 'Devbox Services', true)];
        openPicker([repo('a', 'shortcuts', SHORTCUTS)], undefined);

        const remoteRow = screen.queryAllByTestId('repo-group-item')
            .find(el => el.textContent?.includes('Devbox Services')) as HTMLButtonElement;
        expect(remoteRow).toBeTruthy();
        expect(remoteRow.disabled).toBe(true);
        expect(remoteRow.textContent).toContain('offline');
        // No ⋮ for the offline group; the local one keeps its menu.
        expect(groupRowMenuFor('Devbox Services')).toBeUndefined();
        expect(groupRowMenuFor('Platform')).toBeTruthy();
    });
});

describe('WorkspaceIdentityChip add-repository server pre-selection (AC-02.1 / AC-03.1)', () => {
    const DEV_BOX = 'http://127.0.0.1:4000';

    // A workspace on a remote CoC: same `remote` marker repoGrouping/repoPickerModel read.
    const devBoxRepo = () => ({
        workspace: {
            id: 'r-remote', name: 'shortcuts', color: '#0078d4', remoteUrl: SHORTCUTS,
            rootPath: '/remote/r-remote',
            remote: { serverId: 'dev-box', baseUrl: DEV_BOX, serverLabel: 'Dev Box', connection: 'online', queue: 'idle' },
        },
        gitInfo: { isGitRepo: true, branch: 'main', dirty: false, remoteUrl: SHORTCUTS },
    });

    it('passes the active remote workspace\'s server to Add specific repository', () => {
        const selected = devBoxRepo();
        openPicker([selected], selected);

        fireEvent.click(screen.getByTestId('remote-add-repo-option'));
        const dialog = screen.getByTestId('add-repo-dialog');
        expect(dialog.getAttribute('data-server-id')).toBe('dev-box');
        expect(dialog.getAttribute('data-base-url')).toBe(DEV_BOX);
    });

    it('passes the active remote workspace\'s server to Add workspace folder', () => {
        const selected = devBoxRepo();
        openPicker([selected], selected);

        fireEvent.click(screen.getByTestId('remote-add-folder-option'));
        const dialog = screen.getByTestId('add-folder-dialog');
        expect(dialog.getAttribute('data-server-id')).toBe('dev-box');
        expect(dialog.getAttribute('data-base-url')).toBe(DEV_BOX);
    });

    it('leaves both dialogs on the Local default for a purely local workspace', () => {
        const local = repo('a', 'shortcuts', SHORTCUTS);
        openPicker([local], local);
        fireEvent.click(screen.getByTestId('remote-add-repo-option'));
        const repoDialog = screen.getByTestId('add-repo-dialog');
        expect(repoDialog.getAttribute('data-server-id')).toBeNull();
        expect(repoDialog.getAttribute('data-base-url')).toBeNull();

        cleanup();
        openPicker([local], local);
        fireEvent.click(screen.getByTestId('remote-add-folder-option'));
        const folderDialog = screen.getByTestId('add-folder-dialog');
        expect(folderDialog.getAttribute('data-server-id')).toBeNull();
        expect(folderDialog.getAttribute('data-base-url')).toBeNull();
    });
});
