/**
 * RepoGroupDialog — create/edit repo group dialog (repo-group AC-01).
 *
 * Covers: membership drawn only from the selected server's registered repo
 * workspaces (no free-form path entry), create POSTs the checked workspace ids,
 * edit prefills from GET /api/repo-groups/:id with stale members badged, and
 * server validation errors surfacing inline.
 *
 * Also covers the remote-server extension: the Server dropdown lists Local plus
 * ONLINE remotes only, the member list is scoped to the selected server, saves
 * are routed to that server's base URL, switching servers clears cross-server
 * selections, and the server is fixed while editing.
 *
 * @vitest-environment jsdom
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

const mockCreateRepoGroup = vi.fn();
const mockGetRepoGroup = vi.fn();
const mockUpdateRepoGroup = vi.fn();
const mockListServers = vi.fn();

vi.mock('../../../../src/server/spa/client/react/repos/repoGroupService', () => ({
    createRepoGroup: (...args: unknown[]) => mockCreateRepoGroup(...args),
    getRepoGroup: (...args: unknown[]) => mockGetRepoGroup(...args),
    updateRepoGroup: (...args: unknown[]) => mockUpdateRepoGroup(...args),
    listRepoGroupServerOptions: (...args: unknown[]) => mockListServers(...args),
    LOCAL_REPO_GROUP_SERVER_ID: 'local',
    LOCAL_REPO_GROUP_SERVER: { id: 'local', label: 'Local' },
}));
vi.mock('../../../../src/server/spa/client/react/repos/repositoryService', () => ({
    getRepositoryApiErrorMessage: (err: unknown, fallback: string) =>
        err instanceof Error && err.message ? err.message : fallback,
}));

import { RepoGroupDialog } from '../../../../src/server/spa/client/react/repos/RepoGroupDialog';

const REMOTE_URL = 'http://127.0.0.1:4000';
const SERVER_OPTIONS = [
    { id: 'local', label: 'Local' },
    { id: 'srv-1', label: 'devbox', baseUrl: REMOTE_URL },
];

const localRepo = (id: string, name: string) => ({
    workspace: { id, name, rootPath: `/r/${id}` },
    gitInfo: { isGitRepo: true, branch: 'main', dirty: false },
});

const remoteRepo = (id: string, name: string, serverId = 'srv-1', baseUrl = REMOTE_URL) => ({
    workspace: {
        id, name, rootPath: `/remote/${id}`, baseUrl,
        remote: { serverId, serverLabel: serverId, connection: 'online', baseUrl },
    },
    gitInfo: { isGitRepo: true, branch: 'main', dirty: false },
});


const REPOS = [localRepo('a', 'shortcuts'), localRepo('f', 'forge')];

beforeEach(() => {
    cleanup();
    mockCreateRepoGroup.mockReset().mockResolvedValue({ workspace: { id: 'group-x' }, members: [] });
    mockGetRepoGroup.mockReset();
    mockUpdateRepoGroup.mockReset().mockResolvedValue({ id: 'group-x', name: 'x', members: [] });
    mockListServers.mockReset().mockResolvedValue([{ id: 'local', label: 'Local' }]);
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

        await waitFor(() => expect(mockCreateRepoGroup).toHaveBeenCalledWith({ name: 'Platform', members: ['a', 'f'] }, undefined));
        await waitFor(() => expect(onSaved).toHaveBeenCalled());
        expect(mockUpdateRepoGroup).not.toHaveBeenCalled();
    });

    it('offers only the selected (local) server\'s repos — no remote checkouts, no path entry', () => {
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

        await waitFor(() => expect(mockGetRepoGroup).toHaveBeenCalledWith('group-platform', undefined));
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

        await waitFor(() => expect(mockUpdateRepoGroup).toHaveBeenCalledWith('group-platform', { name: 'Platform', members: ['a', 'f'] }, undefined));
        await waitFor(() => expect(onSaved).toHaveBeenCalled());
        expect(mockCreateRepoGroup).not.toHaveBeenCalled();
    });

    it('shows the load error when the group cannot be fetched', async () => {
        mockGetRepoGroup.mockRejectedValue(new Error('boom'));
        renderDialog({ groupId: 'group-platform' });

        await waitFor(() => expect(screen.getByTestId('repo-group-error').textContent).toContain('boom'));
    });
});

describe('RepoGroupDialog server scope (remote-server repo groups AC-01/AC-04)', () => {
    it('lists Local plus online remote servers only', async () => {
        mockListServers.mockResolvedValue(SERVER_OPTIONS);
        renderDialog();

        const select = screen.getByTestId('repo-group-server-select') as HTMLSelectElement;
        await waitFor(() => expect(select.options).toHaveLength(2));
        expect(Array.from(select.options).map(o => o.value)).toEqual(['local', 'srv-1']);
        expect(Array.from(select.options).map(o => o.textContent)).toEqual(['Local', 'devbox']);
        // An offline server never reaches the dialog: listRepoGroupServerOptions
        // filters by runtime status, so there is nothing to exclude here.
        expect(select.disabled).toBe(false);
        expect(select.value).toBe('local');
    });

    it('scopes the member list to the selected server and creates against its base URL', async () => {
        mockListServers.mockResolvedValue(SERVER_OPTIONS);
        const { onSaved } = renderDialog({
            repos: [...REPOS, remoteRepo('r1', 'remote-forge'), remoteRepo('r2', 'remote-api')] as any,
        });

        // Local scope: only local workspaces.
        await waitFor(() => expect(screen.getByTestId('repo-group-server-select')).toBeTruthy());
        expect(screen.getAllByTestId(/^repo-group-member-check-/).map(el => el.getAttribute('data-testid')))
            .toEqual(['repo-group-member-check-a', 'repo-group-member-check-f']);

        fireEvent.change(screen.getByTestId('repo-group-server-select'), { target: { value: 'srv-1' } });

        // Remote scope: only that server's workspaces, keyed by the remote's own ids.
        expect(screen.getAllByTestId(/^repo-group-member-check-/).map(el => el.getAttribute('data-testid')))
            .toEqual(['repo-group-member-check-r1', 'repo-group-member-check-r2']);

        fireEvent.change(screen.getByTestId('repo-group-name-input'), { target: { value: 'Remote platform' } });
        fireEvent.click(screen.getByTestId('repo-group-member-check-r1'));
        fireEvent.click(screen.getByTestId('repo-group-save-btn'));

        await waitFor(() => expect(mockCreateRepoGroup)
            .toHaveBeenCalledWith({ name: 'Remote platform', members: ['r1'] }, REMOTE_URL));
        await waitFor(() => expect(onSaved).toHaveBeenCalled());
    });

    it('clears selections made on the previous server when the server changes', async () => {
        mockListServers.mockResolvedValue(SERVER_OPTIONS);
        renderDialog({ repos: [...REPOS, remoteRepo('r1', 'remote-forge')] as any });

        await waitFor(() => expect(screen.getByTestId('repo-group-server-select')).toBeTruthy());
        fireEvent.change(screen.getByTestId('repo-group-name-input'), { target: { value: 'Mixed' } });
        fireEvent.click(screen.getByTestId('repo-group-member-check-a'));

        fireEvent.change(screen.getByTestId('repo-group-server-select'), { target: { value: 'srv-1' } });
        expect((screen.getByTestId('repo-group-member-check-r1') as HTMLInputElement).checked).toBe(false);
        fireEvent.click(screen.getByTestId('repo-group-save-btn'));

        // The local pick is gone — the group can only ever hold one server's ids.
        await waitFor(() => expect(mockCreateRepoGroup)
            .toHaveBeenCalledWith({ name: 'Mixed', members: [] }, REMOTE_URL));
    });

    it('pins an existing remote group to its server and routes load + save there', async () => {
        mockListServers.mockResolvedValue(SERVER_OPTIONS);
        mockGetRepoGroup.mockResolvedValue({
            id: 'group-remote', name: 'Remote platform',
            members: [{ workspaceId: 'r1', stale: false, name: 'remote-forge', rootPath: '/remote/r1' }],
        });
        renderDialog({
            groupId: 'group-remote',
            groupBaseUrl: REMOTE_URL,
            repos: [...REPOS, remoteRepo('r1', 'remote-forge')] as any,
        });

        await waitFor(() => expect(mockGetRepoGroup).toHaveBeenCalledWith('group-remote', REMOTE_URL));
        const select = screen.getByTestId('repo-group-server-select') as HTMLSelectElement;
        await waitFor(() => expect(select.value).toBe('srv-1'));
        expect(select.disabled).toBe(true);
        expect((screen.getByTestId('repo-group-member-check-r1') as HTMLInputElement).checked).toBe(true);
        expect(screen.queryByTestId('repo-group-member-check-a')).toBeNull();

        fireEvent.click(screen.getByTestId('repo-group-save-btn'));
        await waitFor(() => expect(mockUpdateRepoGroup)
            .toHaveBeenCalledWith('group-remote', { name: 'Remote platform', members: ['r1'] }, REMOTE_URL));
    });

    it('explains when the chosen server has no repo-group support (404)', async () => {
        mockListServers.mockResolvedValue(SERVER_OPTIONS);
        const notFound = Object.assign(new Error('Not Found'), { status: 404 });
        mockCreateRepoGroup.mockRejectedValue(notFound);
        renderDialog();

        await waitFor(() => expect(screen.getByTestId('repo-group-server-select')).toBeTruthy());
        fireEvent.change(screen.getByTestId('repo-group-server-select'), { target: { value: 'srv-1' } });
        fireEvent.change(screen.getByTestId('repo-group-name-input'), { target: { value: 'Nope' } });
        fireEvent.click(screen.getByTestId('repo-group-save-btn'));

        await waitFor(() => expect(screen.getByTestId('repo-group-error').textContent)
            .toContain("doesn't support repo groups"));
    });

    it('falls back to Local when the server registry is unavailable', async () => {
        mockListServers.mockResolvedValue([{ id: 'local', label: 'Local' }]);
        renderDialog();

        const select = screen.getByTestId('repo-group-server-select') as HTMLSelectElement;
        await waitFor(() => expect(Array.from(select.options).map(o => o.value)).toEqual(['local']));
    });
});
