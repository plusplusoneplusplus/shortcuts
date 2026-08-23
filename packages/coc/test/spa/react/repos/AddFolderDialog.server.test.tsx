/**
 * AddFolderDialog — the "Server" dropdown (remote add-folder AC-03/AC-04/AC-05).
 *
 * Covers: the option list (Local + online remotes, Local-only when the registry
 * is unreachable), pre-selection from the launching remote context, the dropdown
 * locking once the flow leaves the 'pick' phase, routing browse/scan/register to
 * the selected server, remote failures naming the server, the add-loop stopping
 * at the first failure while reporting added vs not-added, and the container
 * agent path staying intact for Local.
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';

const repositoryServiceMocks = vi.hoisted(() => ({
    browseWorkspaceFolders: vi.fn(),
    discoverWorkspaces: vi.fn(),
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

import { AddFolderDialog } from '../../../../src/server/spa/client/react/repos/AddFolderDialog';

const REMOTE_URL = 'http://remote.test:4000';
const REMOTE_OPTIONS = [
    { id: 'local', label: 'Local' },
    { id: 'srv-dev', label: 'Dev Box', baseUrl: REMOTE_URL },
];
const DISCOVERED = [
    { path: '/srv/code/api', name: 'api' },
    { path: '/srv/code/web', name: 'web' },
    { path: '/srv/code/cli', name: 'cli' },
];

function renderDialog(props: Record<string, unknown> = {}) {
    return render(<AddFolderDialog open onClose={() => {}} onAdded={() => {}} {...props} />);
}

function serverSelect(): HTMLSelectElement {
    return screen.getByTestId('add-folder-server-select') as HTMLSelectElement;
}

/** Drive the dialog from a loaded browser through Scan to the checklist. */
async function scan() {
    await waitFor(() => expect(repositoryServiceMocks.browseWorkspaceFolders).toHaveBeenCalled());
    await act(async () => { fireEvent.click(screen.getByTestId('scan-folder-btn')); });
}

beforeEach(() => {
    vi.clearAllMocks();
    containerAgents.agents = [];
    configMocks.isContainerMode.mockReturnValue(false);
    configMocks.getCurrentAgentId.mockReturnValue(null);
    listServerOptions.mockResolvedValue(REMOTE_OPTIONS);
    repositoryServiceMocks.browseWorkspaceFolders.mockResolvedValue({ path: '/srv/code', parent: '/srv', entries: [] });
    repositoryServiceMocks.discoverWorkspaces.mockResolvedValue({ repos: DISCOVERED });
    repositoryServiceMocks.registerWorkspace.mockResolvedValue({});
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

    it('locks the dropdown once the flow leaves the pick phase', async () => {
        renderDialog();
        await waitFor(() => expect(serverSelect().options.length).toBe(2));
        expect(serverSelect().disabled).toBe(false);

        await scan();

        expect(await screen.findByTestId('repo-checklist')).toBeTruthy();
        expect(serverSelect().disabled).toBe(true);
    });

    it('drops the scanned path and results when the server changes', async () => {
        renderDialog();
        await waitFor(() => expect(repositoryServiceMocks.browseWorkspaceFolders)
            .toHaveBeenNthCalledWith(1, '~', undefined));

        fireEvent.change(serverSelect(), { target: { value: 'srv-dev' } });

        await waitFor(() => expect(repositoryServiceMocks.browseWorkspaceFolders)
            .toHaveBeenNthCalledWith(2, '~', REMOTE_URL));
    });
});

describe('routing to the selected server', () => {
    it('browses, scans, and registers every repo on the pre-selected remote', async () => {
        renderDialog({ serverId: 'srv-dev', baseUrl: REMOTE_URL });
        await waitFor(() => expect(serverSelect().value).toBe('srv-dev'));

        await waitFor(() => expect(repositoryServiceMocks.browseWorkspaceFolders)
            .toHaveBeenCalledWith('~', REMOTE_URL));

        await scan();
        expect(repositoryServiceMocks.discoverWorkspaces).toHaveBeenCalledWith('/srv/code', REMOTE_URL);

        await act(async () => { fireEvent.click(screen.getByTestId('add-selected-btn')); });

        expect(repositoryServiceMocks.registerWorkspace).toHaveBeenCalledTimes(3);
        for (const [body, baseUrl] of repositoryServiceMocks.registerWorkspace.mock.calls) {
            expect(baseUrl).toBe(REMOTE_URL);
            // Ids stay server-authoritative — the remote computes them.
            expect(body.id).toBeUndefined();
        }
        expect(repositoryServiceMocks.registerWorkspace.mock.calls.map(c => c[0].rootPath))
            .toEqual(['/srv/code/api', '/srv/code/web', '/srv/code/cli']);
    });

    it('keeps the page-origin client when Local is selected', async () => {
        renderDialog();
        await waitFor(() => expect(serverSelect().options.length).toBe(2));

        await scan();
        expect(repositoryServiceMocks.discoverWorkspaces).toHaveBeenCalledWith('/srv/code', undefined);

        await act(async () => { fireEvent.click(screen.getByTestId('add-selected-btn')); });

        for (const call of repositoryServiceMocks.registerWorkspace.mock.calls) {
            expect(call[1]).toBeUndefined();
        }
    });
});

describe('remote failures', () => {
    it('names the server on a browse failure', async () => {
        renderDialog();
        await waitFor(() => expect(serverSelect().options.length).toBe(2));

        repositoryServiceMocks.browseWorkspaceFolders.mockRejectedValue(new Error('ECONNREFUSED'));
        fireEvent.change(serverSelect(), { target: { value: 'srv-dev' } });

        await screen.findByText('Unable to browse this path on Dev Box');
        // No fallback to Local: exactly one attempt, against the remote.
        expect(repositoryServiceMocks.browseWorkspaceFolders).toHaveBeenLastCalledWith('~', REMOTE_URL);
        expect(serverSelect().value).toBe('srv-dev');
    });

    it('names a pre-selected server by id until the option list resolves', async () => {
        repositoryServiceMocks.browseWorkspaceFolders.mockRejectedValue(new Error('ECONNREFUSED'));

        renderDialog({ serverId: 'srv-dev', baseUrl: REMOTE_URL });

        // The very first browse fires before /api/servers answers, so the only
        // name available is the id — still unmistakably not Local.
        await screen.findByText('Unable to browse this path on srv-dev');
        expect(repositoryServiceMocks.browseWorkspaceFolders).toHaveBeenCalledWith('~', REMOTE_URL);
    });

    it('names the server on a scan failure and keeps the dialog on the pick phase', async () => {
        repositoryServiceMocks.discoverWorkspaces.mockRejectedValue(new Error('EACCES'));

        renderDialog({ serverId: 'srv-dev', baseUrl: REMOTE_URL });
        await waitFor(() => expect(serverSelect().value).toBe('srv-dev'));
        await scan();

        expect(screen.getByTestId('scan-error').textContent).toBe('EACCES on Dev Box');
        // Still on 'pick' — nothing fell back to Local and the browser is intact.
        expect(screen.getByTestId('folder-browser')).toBeTruthy();
        expect(serverSelect().value).toBe('srv-dev');
    });

    it('keeps the local scan message unchanged', async () => {
        repositoryServiceMocks.discoverWorkspaces.mockRejectedValue(new Error('EACCES'));

        renderDialog();
        await waitFor(() => expect(serverSelect().options.length).toBe(2));
        await scan();

        expect(screen.getByTestId('scan-error').textContent).toBe('EACCES');
    });

    it('stops the add-loop at the first failure and reports added vs not added', async () => {
        repositoryServiceMocks.registerWorkspace
            .mockResolvedValueOnce({})
            .mockRejectedValueOnce(new Error('Already registered'));

        renderDialog({ serverId: 'srv-dev', baseUrl: REMOTE_URL });
        await waitFor(() => expect(serverSelect().value).toBe('srv-dev'));
        await scan();

        await act(async () => { fireEvent.click(screen.getByTestId('add-selected-btn')); });

        // 'cli' is never attempted.
        expect(repositoryServiceMocks.registerWorkspace).toHaveBeenCalledTimes(2);
        // The success is kept, not rolled back.
        expect(screen.getByTestId('added-list').textContent).toBe('Added: api');
        expect(screen.getByTestId('not-added-list').textContent).toBe('Not added (2): web, cli');
        expect(screen.getByText('web: Already registered on Dev Box')).toBeTruthy();
    });
});

describe('container-agent mode', () => {
    beforeEach(() => {
        configMocks.isContainerMode.mockReturnValue(true);
        containerAgents.agents = [{ id: 'agent-1', name: 'Agent One', address: 'https://agent-1.test' }];
    });

    it('switches to the selected agent on the Local path', async () => {
        renderDialog();
        await waitFor(() => expect(serverSelect().options.length).toBe(2));
        await scan();
        await act(async () => { fireEvent.click(screen.getByTestId('add-selected-btn')); });

        expect(configMocks.setCurrentAgentId).toHaveBeenCalledWith('agent-1');
        expect(repositoryServiceMocks.discoverWorkspaces).toHaveBeenCalledWith('/srv/code', undefined);
    });

    it('bypasses the agent branch and hides the agent picker when a remote is selected', async () => {
        renderDialog({ serverId: 'srv-dev', baseUrl: REMOTE_URL });
        await waitFor(() => expect(serverSelect().value).toBe('srv-dev'));
        await scan();
        await act(async () => { fireEvent.click(screen.getByTestId('add-selected-btn')); });

        expect(configMocks.setCurrentAgentId).not.toHaveBeenCalled();
        expect(screen.queryByText('Agent')).toBeNull();
    });
});
