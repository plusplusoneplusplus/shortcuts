import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueueProvider } from '../../../src/server/spa/client/react/contexts/QueueContext';
import { PendingTaskInfoPanel } from '../../../src/server/spa/client/react/queue/PendingTaskInfoPanel';
import { QueuedTaskProvider } from '../../../src/server/spa/client/react/queue/QueuedTaskProvider';
import { registerCloneBaseUrls, setActiveCloneForRouting } from '../../../src/server/spa/client/react/repos/cloneRegistry';
import { WorkspaceOwnerContext } from '../../../src/server/spa/client/react/repos/workspaceOwnerContext';
import { resetSpaCocClientForTests } from '../../../src/server/spa/client/react/api/cocClient';

const task = { id: 'job', repoId: 'owner', type: 'chat', status: 'queued',
    payload: { kind: 'chat', mode: 'ask', prompt: 'Task', context: { autoProviderRouting: { requested: true } } },
    config: { afterEffortTier: 'medium' } };
let fetchMock: ReturnType<typeof vi.fn>;
function response(data: unknown, status = 200) {
    return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
}
beforeEach(() => {
    registerCloneBaseUrls([]);
    setActiveCloneForRouting(null);
    resetSpaCocClientForTests();
    fetchMock = vi.fn(async (_url: string, init?: RequestInit) => response(init?.method === 'PATCH'
        ? { task: { ...task, provider: 'codex', payload: { ...task.payload, provider: 'codex', context: {} }, config: { model: 'new-model' } } }
        : { providers: ['auto', 'copilot', 'codex'] }));
    vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); registerCloneBaseUrls([]); setActiveCloneForRouting(null); });

async function open() {
    fireEvent.click(screen.getByRole('button', { name: 'Change queued job provider' }));
    return screen.findByRole('combobox', { name: 'Queued job provider' });
}
function renderPanel(overrides = {}) {
    return render(<QueueProvider><PendingTaskInfoPanel task={task} workspaceId="owner" onCancel={vi.fn()} onMoveToTop={vi.fn()} {...overrides} /></QueueProvider>);
}

describe('queued provider editing', () => {
    it('opens choices from the badge, saves selection, and refreshes badge and model', async () => {
        renderPanel();
        expect(screen.getByTestId('provider-badge').textContent).toContain('Auto (pending)');
        const select = await open();
        expect(screen.getByRole('option', { name: 'Auto' })).toBeTruthy();
        expect(screen.queryByRole('option', { name: 'Claude' })).toBeNull();
        fireEvent.change(select, { target: { value: 'codex' } });
        await waitFor(() => expect(screen.getByTestId('provider-badge').textContent).toBe('Codex'));
        expect(screen.getByText('new-model')).toBeTruthy();
        expect(fetchMock).toHaveBeenCalledWith('/api/queue/job/provider?workspace=owner', expect.objectContaining({ method: 'PATCH', body: JSON.stringify({ provider: 'codex' }) }));
    });
    it('can select Auto from a concrete provider', async () => {
        const updated = vi.fn();
        render(<QueuedTaskProvider task={task} workspaceId="owner" provider="codex" onUpdated={updated} />);
        fireEvent.change(await open(), { target: { value: 'auto' } });
        await waitFor(() => expect(updated).toHaveBeenCalled());
        expect(fetchMock).toHaveBeenLastCalledWith('/api/queue/job/provider?workspace=owner', expect.objectContaining({ body: JSON.stringify({ provider: 'auto' }) }));
    });
    it('allows jobs with implicit defaults to choose a provider', async () => {
        renderPanel({ task: { ...task, payload: { kind: 'chat', prompt: 'Task' } } });
        expect(await open()).toBeTruthy();
    });
    it('routes reads and writes to the exact remote clone when workspace IDs collide', async () => {
        registerCloneBaseUrls([
            { workspaceId: 'owner', serverId: 'remote-a', baseUrl: 'https://a.example' },
            { workspaceId: 'owner', serverId: 'remote-b', baseUrl: 'https://b.example' },
        ]);
        setActiveCloneForRouting('remote:remote-b:owner');
        renderPanel({ sourceSelectionId: 'remote:remote-a:owner' });
        fireEvent.change(await open(), { target: { value: 'codex' } });
        await waitFor(() => expect(screen.getByTestId('provider-badge').textContent).toBe('Codex'));
        expect(fetchMock.mock.calls.every(([url]) => url.startsWith('https://a.example/'))).toBe(true);
        const calls = fetchMock.mock.calls.filter(([url]) => url.includes('/provider'));
        expect(calls).toHaveLength(2);
        expect(calls.every(([url]) => url === 'https://a.example/api/queue/job/provider?workspace=owner')).toBe(true);
    });
    it('keeps explicit local ownership despite an active remote with the same workspace ID', async () => {
        registerCloneBaseUrls([{ workspaceId: 'owner', serverId: 'remote-a', baseUrl: 'https://a.example' }]);
        setActiveCloneForRouting('remote:remote-a:owner');
        renderPanel({ sourceSelectionId: 'owner' });
        await open();
        expect(fetchMock).toHaveBeenLastCalledWith('/api/queue/job/provider?workspace=owner', expect.anything());
    });
    it('uses the scoped owner ahead of a conflicting source or active clone', async () => {
        const { unmount } = render(<WorkspaceOwnerContext.Provider value={{ workspaceId: 'owner', selectionId: 'owner' }}>
            <QueuedTaskProvider task={task} workspaceId="owner" sourceBaseUrl="https://wrong.example" provider="codex" onUpdated={vi.fn()} />
        </WorkspaceOwnerContext.Provider>);
        await open();
        expect(fetchMock).toHaveBeenLastCalledWith('/api/queue/job/provider?workspace=owner', expect.anything());
        unmount();
        render(<WorkspaceOwnerContext.Provider value={{ workspaceId: 'owner', selectionId: 'remote:a:owner', baseUrl: 'https://owner.example' }}>
            <QueuedTaskProvider task={task} workspaceId="owner" sourceSelectionId="owner" provider="codex" onUpdated={vi.fn()} />
        </WorkspaceOwnerContext.Provider>);
        await open();
        expect(fetchMock).toHaveBeenLastCalledWith('https://owner.example/api/queue/job/provider?workspace=owner', expect.anything());
    });
    it('fails an unresolved remote owner without a local request', async () => {
        const updated = vi.fn();
        render(<QueuedTaskProvider task={task} workspaceId="owner" sourceSelectionId="remote:missing:owner" provider="auto-pending" onUpdated={updated} />);
        fireEvent.click(screen.getByRole('button'));
        expect(await screen.findByRole('alert')).toBeTruthy();
        expect(fetchMock).not.toHaveBeenCalled();
    });
    it('shows a start-race rejection without changing the displayed provider', async () => {
        renderPanel();
        const select = await open();
        fetchMock.mockResolvedValueOnce(response({ error: 'Task is no longer queued' }, 409));
        fireEvent.change(select, { target: { value: 'codex' } });
        expect((await screen.findByRole('alert')).textContent).toBe('Task is no longer queued');
        expect(screen.getByTestId('provider-badge').textContent).toContain('Auto (pending)');
    });
    it('does not show an editor for running jobs or follow-ups', () => {
        const { unmount } = renderPanel({ task: { ...task, status: 'running', provider: 'codex' } });
        expect(screen.queryByRole('button', { name: 'Change queued job provider' })).toBeNull();
        unmount();
        renderPanel({ task: { ...task, payload: { ...task.payload, processId: 'existing' }, provider: 'codex' } });
        expect(screen.queryByRole('button', { name: 'Change queued job provider' })).toBeNull();
    });
    it('discards late writes after the owner changes', async () => {
        let complete!: (response: Response) => void;
        const updated = vi.fn();
        const props = { task, workspaceId: 'owner', sourceSelectionId: 'owner', provider: 'auto-pending' as const, onUpdated: updated };
        const { rerender } = render(<QueuedTaskProvider {...props} />);
        const select = await open();
        fetchMock.mockImplementationOnce(() => new Promise<Response>(resolve => { complete = resolve; }));
        fireEvent.change(select, { target: { value: 'codex' } });
        rerender(<QueuedTaskProvider {...props} task={{ ...task, id: 'next' }} />);
        await act(async () => { complete(response({ task: { ...task, provider: 'codex' } })); });
        expect(screen.queryByRole('status')).toBeNull();
        expect(updated).not.toHaveBeenCalled();
    });
});
