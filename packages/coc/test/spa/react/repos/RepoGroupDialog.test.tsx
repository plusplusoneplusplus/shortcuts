/**
 * RepoGroupDialog — create/edit repo group dialog (repo-group AC-01).
 *
 * Covers: membership drawn only from registered local repo workspaces (no
 * free-form path entry, remote checkouts excluded), create POSTs the checked
 * workspace ids, edit prefills from GET /api/repo-groups/:id with stale
 * members badged, and server validation errors surfacing inline.
 *
 * @vitest-environment jsdom
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

const mockCreateRepoGroup = vi.fn();
const mockGetRepoGroup = vi.fn();
const mockUpdateRepoGroup = vi.fn();

vi.mock('../../../../src/server/spa/client/react/repos/repoGroupService', () => ({
    createRepoGroup: (...args: unknown[]) => mockCreateRepoGroup(...args),
    getRepoGroup: (...args: unknown[]) => mockGetRepoGroup(...args),
    updateRepoGroup: (...args: unknown[]) => mockUpdateRepoGroup(...args),
}));
vi.mock('../../../../src/server/spa/client/react/repos/repositoryService', () => ({
    getRepositoryApiErrorMessage: (err: unknown, fallback: string) =>
        err instanceof Error && err.message ? err.message : fallback,
}));

import { RepoGroupDialog } from '../../../../src/server/spa/client/react/repos/RepoGroupDialog';

const localRepo = (id: string, name: string) => ({
    workspace: { id, name, rootPath: `/r/${id}` },
    gitInfo: { isGitRepo: true, branch: 'main', dirty: false },
});

const remoteRepo = (id: string, name: string) => ({
    workspace: {
        id, name, rootPath: `/remote/${id}`, baseUrl: 'http://127.0.0.1:4000',
        remote: { serverId: 'srv-1', serverLabel: 'devbox', connection: 'online' },
    },
    gitInfo: { isGitRepo: true, branch: 'main', dirty: false },
});

const REPOS = [localRepo('a', 'shortcuts'), localRepo('f', 'forge')];

beforeEach(() => {
    cleanup();
    mockCreateRepoGroup.mockReset().mockResolvedValue({ workspace: { id: 'group-x' }, members: [] });
    mockGetRepoGroup.mockReset();
    mockUpdateRepoGroup.mockReset().mockResolvedValue({ id: 'group-x', name: 'x', members: [] });
});

function renderDialog(props: Partial<Parameters<typeof RepoGroupDialog>[0]> = {}) {
    const onClose = vi.fn();
    const onSaved = vi.fn();
    render(
        <RepoGroupDialog
            open
            groupId={null}
            repos={REPOS as any}
            onClose={onClose}
            onSaved={onSaved}
            {...props}
        />,
    );
    return { onClose, onSaved };
}

describe('RepoGroupDialog create (repo-group AC-01)', () => {
    it('creates a group from the name and the checked registered repos', async () => {
        const { onSaved } = renderDialog();

        fireEvent.change(screen.getByTestId('repo-group-name-input'), { target: { value: '  Platform  ' } });
        fireEvent.click(screen.getByTestId('repo-group-member-check-a'));
        fireEvent.click(screen.getByTestId('repo-group-member-check-f'));
        fireEvent.click(screen.getByTestId('repo-group-save-btn'));

        await waitFor(() => expect(mockCreateRepoGroup).toHaveBeenCalledWith({ name: 'Platform', members: ['a', 'f'] }));
        await waitFor(() => expect(onSaved).toHaveBeenCalled());
        expect(mockUpdateRepoGroup).not.toHaveBeenCalled();
    });

    it('offers only registered local repos — no remote checkouts, no path entry', () => {
        renderDialog({ repos: [...REPOS, remoteRepo('r', 'remote-forge'), localRepo('a', 'shortcuts')] as any });

        // One checkbox per registered local workspace, deduped; the remote
        // checkout (owned by another server's registry) is not offered.
        expect(screen.getByTestId('repo-group-member-check-a')).toBeTruthy();
        expect(screen.getByTestId('repo-group-member-check-f')).toBeTruthy();
        expect(screen.queryByTestId('repo-group-member-check-r')).toBeNull();
        expect(screen.getAllByTestId(/^repo-group-member-check-/)).toHaveLength(2);
        // Membership is checkbox-only: the sole non-checkbox input is the name.
        const inputs = Array.from(document.querySelectorAll('input'));
        expect(inputs.filter(i => i.type !== 'checkbox')).toHaveLength(1);
        expect(inputs.filter(i => i.type !== 'checkbox')[0].getAttribute('data-testid')).toBe('repo-group-name-input');
    });

    it('disables save until a name is entered', () => {
        renderDialog();

        const save = screen.getByTestId('repo-group-save-btn') as HTMLButtonElement;
        expect(save.disabled).toBe(true);
        fireEvent.change(screen.getByTestId('repo-group-name-input'), { target: { value: '   ' } });
        expect((screen.getByTestId('repo-group-save-btn') as HTMLButtonElement).disabled).toBe(true);
        fireEvent.change(screen.getByTestId('repo-group-name-input'), { target: { value: 'Platform' } });
        expect((screen.getByTestId('repo-group-save-btn') as HTMLButtonElement).disabled).toBe(false);
    });

    it('surfaces a server validation error and stays open', async () => {
        mockCreateRepoGroup.mockRejectedValue(new Error('Repo group member "zz" is not a registered workspace'));
        const { onSaved } = renderDialog();

        fireEvent.change(screen.getByTestId('repo-group-name-input'), { target: { value: 'Platform' } });
        fireEvent.click(screen.getByTestId('repo-group-save-btn'));

        await waitFor(() => expect(screen.getByTestId('repo-group-error').textContent)
            .toContain('not a registered workspace'));
        expect(onSaved).not.toHaveBeenCalled();
        expect(screen.getByTestId('repo-group-save-btn')).toBeTruthy();
    });
});

describe('RepoGroupDialog edit (repo-group AC-01/AC-03)', () => {
    const GROUP = {
        id: 'group-platform',
        name: 'Platform',
        members: [
            { workspaceId: 'a', stale: false, name: 'shortcuts', rootPath: '/r/a' },
            { workspaceId: 'f', stale: true, staleReason: 'path-missing', name: 'forge', rootPath: '/r/f' },
            { workspaceId: 'gone', stale: true, staleReason: 'workspace-removed' },
        ],
    };

    it('prefills name and membership, badging stale members', async () => {
        mockGetRepoGroup.mockResolvedValue(GROUP);
        renderDialog({ groupId: 'group-platform' });

        await waitFor(() => expect(mockGetRepoGroup).toHaveBeenCalledWith('group-platform'));
        await waitFor(() => expect((screen.getByTestId('repo-group-name-input') as HTMLInputElement).value).toBe('Platform'));

        expect((screen.getByTestId('repo-group-member-check-a') as HTMLInputElement).checked).toBe(true);
        expect((screen.getByTestId('repo-group-member-check-f') as HTMLInputElement).checked).toBe(true);
        // The deregistered member is not in the repos list but still renders
        // (checked + badged) so the user can drop it.
        expect((screen.getByTestId('repo-group-member-check-gone') as HTMLInputElement).checked).toBe(true);

        const badges = screen.getAllByTestId('repo-group-stale-badge');
        expect(badges.map(b => b.textContent)).toEqual(expect.arrayContaining(['path missing', 'removed']));
        expect(badges).toHaveLength(2);
    });

    it('saves via PATCH with the remaining members after unchecking one', async () => {
        mockGetRepoGroup.mockResolvedValue(GROUP);
        mockUpdateRepoGroup.mockResolvedValue({ id: 'group-platform', name: 'Platform', members: [] });
        const { onSaved } = renderDialog({ groupId: 'group-platform' });

        await waitFor(() => expect((screen.getByTestId('repo-group-name-input') as HTMLInputElement).value).toBe('Platform'));
        fireEvent.click(screen.getByTestId('repo-group-member-check-gone'));
        fireEvent.click(screen.getByTestId('repo-group-save-btn'));

        await waitFor(() => expect(mockUpdateRepoGroup).toHaveBeenCalledWith('group-platform', { name: 'Platform', members: ['a', 'f'] }));
        await waitFor(() => expect(onSaved).toHaveBeenCalled());
        expect(mockCreateRepoGroup).not.toHaveBeenCalled();
    });

    it('shows the load error when the group cannot be fetched', async () => {
        mockGetRepoGroup.mockRejectedValue(new Error('boom'));
        renderDialog({ groupId: 'group-platform' });

        await waitFor(() => expect(screen.getByTestId('repo-group-error').textContent).toContain('boom'));
    });
});
