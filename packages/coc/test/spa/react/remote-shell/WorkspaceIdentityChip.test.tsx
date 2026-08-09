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
let mockQueueState: any = { repoQueueMap: {} };
let mockUnseen: Record<string, number> = {};

vi.mock('../../../../src/server/spa/client/react/api/cocClient', () => ({
    getSpaCocClient: () => ({
        preferences: {
            getGlobal: vi.fn().mockResolvedValue({ recentRemotes: [] }),
            patchGlobal: vi.fn().mockResolvedValue({}),
        },
    }),
}));
vi.mock('../../../../src/server/spa/client/react/contexts/QueueContext', () => ({
    useQueue: () => ({ state: mockQueueState, dispatch: vi.fn() }),
}));
vi.mock('../../../../src/server/spa/client/react/contexts/ReposContext', () => ({
    useRepos: () => ({ repos: [], unseenCounts: mockUnseen, fetchRepos: mockFetchRepos }),
}));
vi.mock('../../../../src/server/spa/client/react/features/remote-shell/useShellNavigation', () => ({
    useShellNavigation: () => ({ selectClone: mockSelectClone, switchSubTab: vi.fn() }),
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
vi.mock('../../../../src/server/spa/client/react/repos/repositoryService', () => ({
    removeWorkspace: (...args: unknown[]) => mockRemoveWorkspace(...args),
}));

import { WorkspaceIdentityChip } from '../../../../src/server/spa/client/react/features/remote-shell/WorkspaceIdentityChip';

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
    mockQueueState = { repoQueueMap: {} };
    mockUnseen = {};
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
