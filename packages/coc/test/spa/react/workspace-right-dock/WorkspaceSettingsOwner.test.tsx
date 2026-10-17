/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useState } from 'react';
import {
    createWorkspaceSettingsClient, WorkspaceSettingsApiProvider, useWorkspaceSettingsClient, useWorkspaceSettingsRepos,
} from '../../../../src/server/spa/client/react/features/repo-settings/workspaceSettingsClient';
import {
    registerCloneBaseUrls, resetCloneRegistryForTests, setActiveCloneForRouting,
} from '../../../../src/server/spa/client/react/repos/cloneRegistry';
import { useCocClient } from '../../../../src/server/spa/client/react/repos/cloneRouting';
import { TasksSettingsSection } from '../../../../src/server/spa/client/react/features/repo-settings/TasksSettingsSection';
import { createNotesApi } from '../../../../src/server/spa/client/react/features/notes/notesApi';
import { WorkspaceSettingsProvider, WorkspaceSettingsSlot } from '../../../../src/server/spa/client/react/features/repo-settings/WorkspaceSettingsHost';
import { getSpaCocClientErrorMessage } from '../../../../src/server/spa/client/react/api/cocClient';
import { RepoGroupSettingsTab } from '../../../../src/server/spa/client/react/repos/RepoGroupSettingsTab';
import type { RepoData } from '../../../../src/server/spa/client/react/repos/repoGrouping';

const WS = 'ws-shared';
const REMOTE = 'remote:server-a:ws-shared';
const BASE = 'https://server-a.example';
const OTHER = 'https://server-b.example';
const network = vi.fn<typeof fetch>();

beforeEach(() => {
    resetCloneRegistryForTests();
    network.mockReset().mockImplementation(async () => new Response(JSON.stringify({}), { status: 200 }));
    vi.stubGlobal('fetch', network);
    registerCloneBaseUrls([
        { workspaceId: WS, serverId: 'server-a', baseUrl: BASE },
        { workspaceId: WS, serverId: 'server-b', baseUrl: OTHER },
    ]);
});
afterEach(() => {
    cleanup();
    resetCloneRegistryForTests();
    vi.unstubAllGlobals();
});

function Draft() {
    const client = useWorkspaceSettingsClient(WS);
    const hookedClient = useCocClient(WS);
    const [draft, setDraft] = useState('');
    const [error, setError] = useState('');
    return <div>
        <input aria-label="Instruction" value={draft} onChange={e => setDraft(e.target.value)} />
        <button onClick={() => {
            void client.workspaces.updateInstruction(WS, 'base', { content: draft })
                .catch(err => setError(getSpaCocClientErrorMessage(err, 'Save failed')));
        }}>Save instruction</button>
        <span data-testid="same-client">{String(client === hookedClient)}</span>
        {error && <span role="status">{error}</span>}
    </div>;
}

describe('Settings concrete owner', () => {
    it('limits linked-repo choices to the settings server, including same-id clones', () => {
        const repos: RepoData[] = [
            { workspace: { id: WS, name: 'Local' } },
            { workspace: { id: WS, name: 'Owner', remote: { cloneKey: REMOTE }, baseUrl: BASE } },
            { workspace: { id: WS, name: 'Other', remote: { cloneKey: 'remote:server-b:ws-shared' }, baseUrl: OTHER } },
        ];
        function Choices() {
            return <div data-testid="choices">{useWorkspaceSettingsRepos(WS, repos)?.map(repo => repo.workspace.name).join(',')}</div>;
        }
        render(<WorkspaceSettingsApiProvider workspaceId={WS} selectionId={REMOTE}><Choices /></WorkspaceSettingsApiProvider>);
        expect(screen.getByTestId('choices')).toHaveTextContent(/^Owner$/);
    });

    it('routes every settings domain through one pinned owner, independently of the active bare-id alias', async () => {
        const { client } = createWorkspaceSettingsClient(REMOTE);
        setActiveCloneForRouting('remote:server-b:ws-shared');
        const notes = createNotesApi(() => client.notes);
        await client.workspaces.getMcpConfig(WS);
        await client.workspaces.updateInstruction(WS, 'base', { content: 'Draft' });
        await client.skills.getWorkspaceConfig(WS);
        await client.preferences.patchRepo(WS, { defaultModel: 'example-model' });
        await client.preferences.updateTaskSettings(WS, { folderPaths: ['plans'] });
        await client.preferences.getLlmToolsConfig(WS);
        await client.languageServers.get(WS);
        await client.memoryV2.listMemoryScopes();
        await notes.listRoots(WS);
        await notes.enableAutoCommit(WS, 60000);
        await client.sync.getStatus(WS);
        expect(network).toHaveBeenCalledTimes(11);
        expect(network.mock.calls.every(([url]) => String(url).startsWith(`${BASE}/api/`))).toBe(true);
        expect(network.mock.calls.some(([url]) => String(url).includes(encodeURIComponent(REMOTE)))).toBe(false);
    });

    it('pins explicit local settings to page origin even when the same workspace id exists remotely', async () => {
        setActiveCloneForRouting('remote:server-b:ws-shared');
        const { client } = createWorkspaceSettingsClient(WS);
        await client.workspaces.updateInstruction(WS, 'base', { content: 'Local draft' });
        expect(network.mock.calls[0][0]).toBe(`/api/workspaces/${WS}/instructions/base`);
    });

    it('refuses unresolved or replaced remote routes without sending anything locally or to a different endpoint', async () => {
        const { client } = createWorkspaceSettingsClient(REMOTE);
        registerCloneBaseUrls([{ workspaceId: WS, serverId: 'server-b', baseUrl: OTHER }]);
        expect(() => createWorkspaceSettingsClient(REMOTE)).toThrow('unavailable');
        await expect(client.preferences.getRepo(WS)).rejects.toMatchObject({ cause: expect.objectContaining({ message: expect.stringMatching(/connection changed/) }) });
        registerCloneBaseUrls([{ workspaceId: WS, serverId: 'server-a', baseUrl: OTHER }]);
        await expect(client.workspaces.updateInstruction(WS, 'base', { content: 'Pending' })).rejects.toMatchObject({ cause: expect.objectContaining({ message: expect.stringMatching(/connection changed/) }) });
        expect(network).not.toHaveBeenCalled();
    });

    it('keeps pending edits and the shared client when a remote route disappears or its alias changes', async () => {
        render(<WorkspaceSettingsApiProvider workspaceId={WS} selectionId={REMOTE}><Draft /></WorkspaceSettingsApiProvider>);
        expect(screen.getByTestId('same-client')).toHaveTextContent('true');
        const input = screen.getByRole('textbox');
        fireEvent.change(input, { target: { value: 'Unsaved' } });
        act(() => { setActiveCloneForRouting('remote:server-b:ws-shared'); });
        fireEvent.click(screen.getByText('Save instruction'));
        await waitFor(() => expect(network).toHaveBeenCalledOnce());
        expect(network.mock.calls[0][0]).toEqual(expect.stringContaining(BASE));
        network.mockClear();
        act(() => { registerCloneBaseUrls([]); });
        expect(screen.getByRole('alert')).toHaveTextContent('original server');
        expect(screen.getByRole('textbox')).toBe(input);
        expect(input).toHaveValue('Unsaved');
        fireEvent.click(screen.getByText('Save instruction'));
        await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('connection changed'));
        expect(network).not.toHaveBeenCalled();
    });

    it('does not mount a form for an unresolved owner and opens it when that same owner resolves', async () => {
        registerCloneBaseUrls([]);
        render(<WorkspaceSettingsApiProvider workspaceId={WS} selectionId={REMOTE}><Draft /></WorkspaceSettingsApiProvider>);
        expect(screen.getByRole('alert')).toHaveTextContent('unavailable');
        expect(screen.queryByRole('textbox')).toBeNull();
        act(() => { registerCloneBaseUrls([{ workspaceId: WS, serverId: 'server-a', baseUrl: BASE }]); });
        expect(await screen.findByRole('textbox')).toHaveValue('');
        expect(network).not.toHaveBeenCalled();
    });

    it('shares the real folder settings form and its save/error behavior between top and panel on the owning server', async () => {
        network.mockImplementation(async (_url, init) => init?.method === 'PATCH'
            ? new Response(JSON.stringify({ error: 'Folder rejected' }), { status: 400 })
            : new Response(JSON.stringify({ taskRootPath: 'plans', folderPaths: [] }), { status: 200 }));
        const page = (top: boolean) => <WorkspaceSettingsProvider ownerKey={REMOTE} topLevelActive={top}
            renderPage={() => <WorkspaceSettingsApiProvider workspaceId={WS} selectionId={REMOTE}>
                <TasksSettingsSection workspaceId={WS} />
            </WorkspaceSettingsApiProvider>}>
            <WorkspaceSettingsSlot />
            <WorkspaceSettingsSlot panel active={!top} ownerKey={REMOTE} />
        </WorkspaceSettingsProvider>;
        const view = render(page(true));
        await screen.findByTestId('tasks-settings-section');
        const input = screen.getByTestId('new-folder-input');
        fireEvent.change(input, { target: { value: 'extra-plans' } });
        view.rerender(page(false));
        expect(screen.getByTestId('new-folder-input')).toBe(input);
        expect(input).toHaveValue('extra-plans');
        fireEvent.click(screen.getByTestId('add-folder-btn'));
        await screen.findByTestId('tasks-settings-error');
        expect(network.mock.calls.every(([url]) => String(url).startsWith(BASE))).toBe(true);
        const write = network.mock.calls.find(([, init]) => init?.method === 'PATCH');
        expect(write?.[1]?.body).toBe(JSON.stringify({ folderPaths: ['extra-plans'] }));
    });

    it('pins group member saves to the same server as group agent settings', async () => {
        const groupId = 'group-example';
        const selectionId = `remote:server-a:${groupId}`;
        registerCloneBaseUrls([{ workspaceId: groupId, serverId: 'server-a', baseUrl: BASE }]);
        network.mockImplementation(async url => new Response(JSON.stringify(String(url).endsWith(`/repo-groups/${groupId}`)
            ? { id: groupId, name: 'Example', members: [{ workspaceId: 'member-a', name: 'Member', stale: false, readOnly: false }] }
            : {}), { status: 200 }));
        render(<WorkspaceSettingsApiProvider workspaceId={groupId} selectionId={selectionId}>
            <RepoGroupSettingsTab workspaceId={groupId} selectionId={selectionId} baseUrl={BASE} active navigation="local" />
        </WorkspaceSettingsApiProvider>);
        const input = await screen.findByTestId('repo-group-member-description-member-a');
        fireEvent.change(input, { target: { value: 'Pending group description' } });
        fireEvent.blur(input);
        await waitFor(() => expect(network.mock.calls.some(([, init]) => init?.method === 'PATCH')).toBe(true));
        expect(network.mock.calls.every(([url]) => String(url).startsWith(BASE))).toBe(true);
        network.mockClear();
        act(() => { registerCloneBaseUrls([]); });
        fireEvent.change(input, { target: { value: 'Must not go local' } });
        fireEvent.blur(input);
        await screen.findByTestId('repo-group-member-description-error-member-a');
        expect(network).not.toHaveBeenCalled();
    });
});
