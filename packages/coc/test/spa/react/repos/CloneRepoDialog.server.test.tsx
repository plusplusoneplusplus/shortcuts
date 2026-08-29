/**
 * CloneRepoDialog — the "Server" dropdown (clone onto a remote host).
 *
 * Covers: the option list (Local + online remotes, Local-only when the registry
 * is unreachable), pre-selection from the launching remote context, clearing the
 * parent folder and re-rooting the browser on server change, routing
 * browse/clone/register to the selected server, remote failures naming the
 * server while the dialog keeps the user's input, and the local-only
 * dispatch-and-navigate on success.
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import type { ReactNode } from 'react';

const repositoryServiceMocks = vi.hoisted(() => ({
    browseWorkspaceFolders: vi.fn(),
    cloneRepository: vi.fn(),
    registerWorkspace: vi.fn(),
    getRepositoryApiErrorMessage: vi.fn((error: unknown, fallback: string, networkFallback?: string) => {
        if (error instanceof Error && error.message) return error.message;
        return networkFallback ?? fallback;
    }),
}));
vi.mock('../../../../src/server/spa/client/react/repos/repositoryService', () => repositoryServiceMocks);

const listServerOptions = vi.hoisted(() => vi.fn());
vi.mock('../../../../src/server/spa/client/react/repos/repoGroupService', () => ({
    LOCAL_REPO_GROUP_SERVER_ID: 'local',
    LOCAL_REPO_GROUP_SERVER: { id: 'local', label: 'Local' },
    listRepoGroupServerOptions: listServerOptions,
}));

import { AppProvider } from '../../../../src/server/spa/client/react/contexts/AppContext';
import { QueueProvider } from '../../../../src/server/spa/client/react/contexts/QueueContext';
import { CloneRepoDialog } from '../../../../src/server/spa/client/react/repos/CloneRepoDialog';

const REMOTE_URL = 'http://remote.test:4000';
const REMOTE_OPTIONS = [
    { id: 'local', label: 'Local' },
    { id: 'srv-dev', label: 'Dev Box', baseUrl: REMOTE_URL },
];

function Wrap({ children }: { children: ReactNode }) {
    return <AppProvider><QueueProvider>{children}</QueueProvider></AppProvider>;
}

function renderDialog(props: Record<string, unknown> = {}) {
    return render(
        <Wrap>
            <CloneRepoDialog open onClose={() => {}} onSuccess={() => {}} {...props} />
        </Wrap>,
    );
}

function serverSelect(): HTMLSelectElement {
    return screen.getByTestId('clone-repo-server-select') as HTMLSelectElement;
}

function urlInput(): HTMLInputElement {
    return screen.getByTestId('clone-repo-url') as HTMLInputElement;
}

beforeEach(() => {
    vi.clearAllMocks();
    location.hash = '';
    listServerOptions.mockResolvedValue(REMOTE_OPTIONS);
    repositoryServiceMocks.browseWorkspaceFolders.mockResolvedValue({
        path: '/projects',
        parent: null,
        entries: [],
    });
    repositoryServiceMocks.cloneRepository.mockResolvedValue({ clonedPath: '/projects/repo' });
    repositoryServiceMocks.registerWorkspace.mockResolvedValue({
        id: 'ws-cloned',
        name: 'repo',
        rootPath: '/projects/repo',
    });
    repositoryServiceMocks.getRepositoryApiErrorMessage.mockImplementation(
        (error: unknown, fallback: string, networkFallback?: string) =>
            (error instanceof Error && error.message) ? error.message : (networkFallback ?? fallback),
    );
});

describe('server dropdown', () => {
    it('lists Local plus the online remotes and defaults to Local', async () => {
        renderDialog();

        await waitFor(() => expect(serverSelect().options.length).toBe(2));
        expect(Array.from(serverSelect().options).map(o => o.textContent)).toEqual(['Local', 'Dev Box']);
        expect(serverSelect().value).toBe('local');
    });

    it('falls back to Local-only when the server registry is unreachable', async () => {
        listServerOptions.mockRejectedValue(new Error('offline'));

        renderDialog();

        await act(async () => {});
        expect(Array.from(serverSelect().options).map(o => o.textContent)).toEqual(['Local']);
    });

    it('pre-selects the server the dialog was launched from', async () => {
        renderDialog({ serverId: 'srv-dev', baseUrl: REMOTE_URL });

        await waitFor(() => expect(serverSelect().value).toBe('srv-dev'));
    });

    it('offers a pre-selected server that is missing from the fetched list', async () => {
        listServerOptions.mockResolvedValue([{ id: 'local', label: 'Local' }]);

        renderDialog({ serverId: 'srv-gone', baseUrl: REMOTE_URL });

        await waitFor(() => expect(serverSelect().value).toBe('srv-gone'));
        expect(Array.from(serverSelect().options).map(o => o.value)).toEqual(['local', 'srv-gone']);
    });
});

describe('routing to the selected server', () => {
    it('browses the remote home directory when launched from a remote', async () => {
        renderDialog({ serverId: 'srv-dev', baseUrl: REMOTE_URL });

        await waitFor(() => expect(repositoryServiceMocks.browseWorkspaceFolders)
            .toHaveBeenCalledWith('~', REMOTE_URL));
    });

    it('clones and registers on the selected remote', async () => {
        renderDialog({ serverId: 'srv-dev', baseUrl: REMOTE_URL });
        await screen.findByText('/projects');

        fireEvent.change(urlInput(), { target: { value: 'https://github.com/org/repo.git' } });
        await act(async () => { fireEvent.click(screen.getByTestId('clone-repo-submit')); });

        expect(repositoryServiceMocks.cloneRepository).toHaveBeenCalledWith({
            url: 'https://github.com/org/repo.git',
            parentDir: '/projects',
            dirName: 'repo',
        }, REMOTE_URL);
        expect(repositoryServiceMocks.registerWorkspace).toHaveBeenCalledWith({
            name: 'repo',
            rootPath: '/projects/repo',
        }, REMOTE_URL);
    });

    it('passes undefined for Local so the page-origin client is used', async () => {
        renderDialog();
        await waitFor(() => expect(serverSelect().options.length).toBe(2));
        await screen.findByText('/projects');

        expect(repositoryServiceMocks.browseWorkspaceFolders).toHaveBeenCalledWith('~', undefined);

        fireEvent.change(urlInput(), { target: { value: 'https://github.com/org/repo.git' } });
        await act(async () => { fireEvent.click(screen.getByTestId('clone-repo-submit')); });

        expect(repositoryServiceMocks.cloneRepository.mock.calls[0][1]).toBeUndefined();
        expect(repositoryServiceMocks.registerWorkspace.mock.calls[0][1]).toBeUndefined();
    });

    it('clears the parent folder and re-roots the browser when the server changes', async () => {
        repositoryServiceMocks.browseWorkspaceFolders
            .mockResolvedValueOnce({ path: '/home/me', parent: null, entries: [] })
            .mockResolvedValueOnce({ path: '/srv/home', parent: null, entries: [] });

        renderDialog();
        await waitFor(() => expect(serverSelect().options.length).toBe(2));
        await waitFor(() => expect(screen.getByTestId('clone-parent-dir')).toHaveValue('/home/me'));

        fireEvent.change(serverSelect(), { target: { value: 'srv-dev' } });

        await waitFor(() => expect(repositoryServiceMocks.browseWorkspaceFolders)
            .toHaveBeenNthCalledWith(2, '~', REMOTE_URL));
        await waitFor(() => expect(screen.getByTestId('clone-parent-dir')).toHaveValue('/srv/home'));
    });
});

describe('remote failures', () => {
    it('names the server on a clone failure and keeps the inputs intact', async () => {
        repositoryServiceMocks.cloneRepository.mockRejectedValue(new Error('Authentication failed'));

        renderDialog({ serverId: 'srv-dev', baseUrl: REMOTE_URL });
        await screen.findByText('/projects');

        fireEvent.change(urlInput(), { target: { value: 'https://github.com/org/repo.git' } });
        fireEvent.change(screen.getByTestId('clone-folder-name'), { target: { value: 'my-repo' } });
        await act(async () => { fireEvent.click(screen.getByTestId('clone-repo-submit')); });

        expect(screen.getByTestId('clone-repo-error').textContent).toBe('Authentication failed on Dev Box');
        expect(urlInput().value).toBe('https://github.com/org/repo.git');
        expect(screen.getByTestId('clone-folder-name')).toHaveValue('my-repo');
        expect(repositoryServiceMocks.registerWorkspace).not.toHaveBeenCalled();
    });

    it('names the server on a browse failure', async () => {
        renderDialog();
        await waitFor(() => expect(serverSelect().options.length).toBe(2));

        repositoryServiceMocks.browseWorkspaceFolders.mockRejectedValue(new Error('ECONNREFUSED'));
        fireEvent.change(serverSelect(), { target: { value: 'srv-dev' } });

        await screen.findByText('ECONNREFUSED on Dev Box');
    });

    it('keeps the local clone message unchanged', async () => {
        repositoryServiceMocks.cloneRepository.mockRejectedValue(new Error('fatal: repository not found'));

        renderDialog();
        await screen.findByText('/projects');

        fireEvent.change(urlInput(), { target: { value: 'https://github.com/org/repo.git' } });
        await act(async () => { fireEvent.click(screen.getByTestId('clone-repo-submit')); });

        expect(screen.getByTestId('clone-repo-error').textContent).toBe('fatal: repository not found');
    });
});

describe('post-clone navigation', () => {
    it('navigates into the freshly cloned workspace for a Local target', async () => {
        const onSuccess = vi.fn();
        renderDialog({ onSuccess });
        await waitFor(() => expect(serverSelect().options.length).toBe(2));
        await screen.findByText('/projects');

        fireEvent.change(urlInput(), { target: { value: 'https://github.com/org/repo.git' } });
        await act(async () => { fireEvent.click(screen.getByTestId('clone-repo-submit')); });

        expect(location.hash).toBe('#repos/ws-cloned/chats');
        expect(onSuccess).toHaveBeenCalledTimes(1);
    });

    it('does not navigate for a remote target — the id is only routable after aggregation', async () => {
        const onSuccess = vi.fn();
        renderDialog({ serverId: 'srv-dev', baseUrl: REMOTE_URL, onSuccess });
        await screen.findByText('/projects');

        fireEvent.change(urlInput(), { target: { value: 'https://github.com/org/repo.git' } });
        await act(async () => { fireEvent.click(screen.getByTestId('clone-repo-submit')); });

        expect(location.hash).toBe('');
        expect(onSuccess).toHaveBeenCalledTimes(1);
    });
});
