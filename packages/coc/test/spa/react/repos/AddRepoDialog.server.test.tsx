/**
 * AddRepoDialog — the "Server" dropdown (remote add-repo AC-02/AC-04/AC-05).
 *
 * Covers: the option list (Local + online remotes, Local-only when the registry
 * is unreachable), pre-selection from the launching remote context, clearing the
 * path and re-rooting the browser on server change, routing browse/register to
 * the selected server, remote failures naming the server while the dialog keeps
 * the user's input, and the container-agent path staying intact for Local.
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';

const repositoryServiceMocks = vi.hoisted(() => ({
    browseWorkspaceFolders: vi.fn(),
    registerWorkspace: vi.fn(),
    updateWorkspace: vi.fn(),
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

const configMocks = vi.hoisted(() => ({
    isContainerMode: vi.fn(() => false),
    setCurrentAgentId: vi.fn(),
    getCurrentAgentId: vi.fn(() => null as string | null),
}));
vi.mock('../../../../src/server/spa/client/react/utils/config', async importOriginal => ({
    ...(await importOriginal<Record<string, unknown>>()),
    ...configMocks,
}));

const containerAgents = vi.hoisted(() => ({ agents: [] as Array<{ id: string; name: string; address: string }> }));
vi.mock('../../../../src/server/spa/client/react/contexts/ContainerAgentContext', () => ({
    useContainerAgents: () => ({
        agents: containerAgents.agents,
        loading: false,
        refresh: async () => {},
    }),
}));

import { AddRepoDialog } from '../../../../src/server/spa/client/react/repos/AddRepoDialog';

const REMOTE_URL = 'http://remote.test:4000';
const REMOTE_OPTIONS = [
    { id: 'local', label: 'Local' },
    { id: 'srv-dev', label: 'Dev Box', baseUrl: REMOTE_URL },
];

function renderDialog(props: Record<string, unknown> = {}) {
    return render(
        <AddRepoDialog open onClose={() => {}} repos={[]} onSuccess={() => {}} {...props} />,
    );
}

function serverSelect(): HTMLSelectElement {
    return screen.getByTestId('add-repo-server-select') as HTMLSelectElement;
}

function pathInput(): HTMLInputElement {
    return screen.getByTestId('repo-path') as HTMLInputElement;
}

beforeEach(() => {
    vi.clearAllMocks();
    containerAgents.agents = [];
    configMocks.isContainerMode.mockReturnValue(false);
    configMocks.getCurrentAgentId.mockReturnValue(null);
    listServerOptions.mockResolvedValue(REMOTE_OPTIONS);
    repositoryServiceMocks.registerWorkspace.mockResolvedValue({});
    repositoryServiceMocks.browseWorkspaceFolders.mockResolvedValue({ path: '~', parent: null, entries: [] });
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

    it('is not rendered in edit mode', () => {
        const repos = [{
            workspace: { id: 'ws-1', name: 'R', rootPath: '/r', color: '#0078d4' },
            gitInfo: { branch: 'main', dirty: false, isGitRepo: true },
        }] as never;
        renderDialog({ editId: 'ws-1', repos });

        expect(screen.queryByTestId('add-repo-server-select')).toBeNull();
    });
});

describe('routing to the selected server', () => {
    it('browses and registers on the pre-selected remote', async () => {
        renderDialog({ serverId: 'srv-dev', baseUrl: REMOTE_URL });
        await waitFor(() => expect(serverSelect().value).toBe('srv-dev'));

        fireEvent.click(screen.getByTestId('browse-btn'));
        await waitFor(() => expect(repositoryServiceMocks.browseWorkspaceFolders)
            .toHaveBeenCalledWith('~', REMOTE_URL));

        fireEvent.change(pathInput(), { target: { value: '/srv/code/api' } });
        await act(async () => { fireEvent.click(screen.getByText('Add Repo')); });

        expect(repositoryServiceMocks.registerWorkspace).toHaveBeenCalledTimes(1);
        const [body, baseUrl] = repositoryServiceMocks.registerWorkspace.mock.calls[0];
        expect(body.rootPath).toBe('/srv/code/api');
        // Ids stay server-authoritative — the remote computes them.
        expect(body.id).toBeUndefined();
        expect(baseUrl).toBe(REMOTE_URL);
    });

    it('keeps the page-origin client when Local is selected', async () => {
        renderDialog();
        await waitFor(() => expect(serverSelect().options.length).toBe(2));

        fireEvent.change(pathInput(), { target: { value: '/home/me/repo' } });
        await act(async () => { fireEvent.click(screen.getByText('Add Repo')); });

        expect(repositoryServiceMocks.registerWorkspace.mock.calls[0][1]).toBeUndefined();
    });

    it('re-roots the open browser and retargets the path when the server changes', async () => {
        renderDialog();
        await waitFor(() => expect(serverSelect().options.length).toBe(2));

        fireEvent.change(pathInput(), { target: { value: '/home/me/repo' } });
        fireEvent.click(screen.getByTestId('browse-btn'));
        await waitFor(() => expect(repositoryServiceMocks.browseWorkspaceFolders)
            .toHaveBeenNthCalledWith(1, '/home/me/repo', undefined));

        fireEvent.change(serverSelect(), { target: { value: 'srv-dev' } });

        await waitFor(() => expect(repositoryServiceMocks.browseWorkspaceFolders)
            .toHaveBeenNthCalledWith(2, '~', REMOTE_URL));
        // The old server's path is dropped; Path then tracks the new server's root.
        await waitFor(() => expect(pathInput().value).toBe('~'));
    });
});

describe('remote failures', () => {
    it('names the server on a browse failure and keeps the dialog open', async () => {
        repositoryServiceMocks.browseWorkspaceFolders.mockRejectedValue(new Error('ECONNREFUSED'));

        renderDialog({ serverId: 'srv-dev', baseUrl: REMOTE_URL });
        await waitFor(() => expect(serverSelect().value).toBe('srv-dev'));

        fireEvent.change(pathInput(), { target: { value: '/srv/code' } });
        fireEvent.click(screen.getByTestId('browse-btn'));

        await screen.findByText('Unable to browse this path on Dev Box');
        // Input survives the failure; nothing falls back to Local.
        expect(pathInput().value).toBe('/srv/code');
        expect(screen.getByTestId('path-browser')).toBeTruthy();
    });

    it('names the server on a register failure and does not retry locally', async () => {
        repositoryServiceMocks.registerWorkspace.mockRejectedValue(new Error('Path not found'));

        renderDialog({ serverId: 'srv-dev', baseUrl: REMOTE_URL });
        await waitFor(() => expect(serverSelect().value).toBe('srv-dev'));

        fireEvent.change(pathInput(), { target: { value: '/srv/code/api' } });
        await act(async () => { fireEvent.click(screen.getByText('Add Repo')); });

        expect(screen.getByTestId('repo-validation').textContent).toBe('Path not found on Dev Box');
        expect(repositoryServiceMocks.registerWorkspace).toHaveBeenCalledTimes(1);
        expect(pathInput().value).toBe('/srv/code/api');
    });

    it('keeps the local browse message unchanged', async () => {
        repositoryServiceMocks.browseWorkspaceFolders.mockRejectedValue(new Error('boom'));

        renderDialog();
        await waitFor(() => expect(serverSelect().options.length).toBe(2));
        fireEvent.click(screen.getByTestId('browse-btn'));

        await screen.findByText('Unable to browse this path');
    });
});

describe('container-agent mode', () => {
    beforeEach(() => {
        configMocks.isContainerMode.mockReturnValue(true);
        configMocks.getCurrentAgentId.mockReturnValue('previous-agent');
        containerAgents.agents = [{ id: 'agent-1', name: 'Agent One', address: 'https://agent-1.test' }];
    });

    it('saves and restores the agent id around a Local browse', async () => {
        renderDialog();
        await waitFor(() => expect(serverSelect().options.length).toBe(2));

        fireEvent.click(screen.getByTestId('browse-btn'));
        await waitFor(() => expect(repositoryServiceMocks.browseWorkspaceFolders).toHaveBeenCalled());

        expect(configMocks.setCurrentAgentId.mock.calls).toEqual([['agent-1'], ['previous-agent']]);
        expect(repositoryServiceMocks.browseWorkspaceFolders).toHaveBeenCalledWith('~', undefined);
    });

    it('bypasses the agent branch and hides the agent picker when a remote is selected', async () => {
        renderDialog({ serverId: 'srv-dev', baseUrl: REMOTE_URL });
        await waitFor(() => expect(serverSelect().value).toBe('srv-dev'));

        fireEvent.click(screen.getByTestId('browse-btn'));
        await waitFor(() => expect(repositoryServiceMocks.browseWorkspaceFolders)
            .toHaveBeenCalledWith('~', REMOTE_URL));

        // Never switched to the agent — only the no-op restore of the saved id.
        expect(configMocks.setCurrentAgentId).not.toHaveBeenCalledWith('agent-1');
        expect(screen.queryByText('Agent')).toBeNull();
    });
});
