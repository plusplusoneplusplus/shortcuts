/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { SentinelTodoCategorySet } from '@plusplusoneplusplus/coc-client';

const { api, client, references, sockets } = vi.hoisted(() => {
    const api = { get: vi.fn(), connect: vi.fn(), getCategories: vi.fn(), createCategory: vi.fn(), updateCategory: vi.fn(),
        reorderCategories: vi.fn(), getCategoryUsage: vi.fn(), deleteCategory: vi.fn() };
    return { api, client: { sentinelTodos: api, events: { connect: api.connect } }, references: [] as unknown[],
        sockets: [] as { workspaceId: string; onMessage: (message: unknown) => void; close: ReturnType<typeof vi.fn> }[] };
});
vi.mock('../../../src/server/spa/client/react/repos/cloneRouting', () => ({
    useCocClient: (reference: unknown) => { references.push(reference); return client; },
}));
vi.mock('../../../src/server/spa/client/react/repos/cloneRegistry', async importOriginal => ({
    ...(await importOriginal<object>()),
    getCocClientForWorkspace: (reference: unknown) => { references.push(reference); return client; },
}));
vi.mock('../../../src/server/spa/client/react/features/repo-detail/unified-right-panel/SentinelRefrains', () => ({
    SentinelRefrains: ({ toolbar, children }: { toolbar: React.ReactNode; children: React.ReactNode }) => <>{toolbar}{children}</>,
}));
vi.mock('../../../src/server/spa/client/react/features/repo-detail/unified-right-panel/SentinelCodaFinding', async importOriginal => ({
    ...(await importOriginal<object>()), AcceptAllCodaProposals: () => null, SentinelCodaFinding: () => null,
}));
vi.mock('../../../src/server/spa/client/react/features/repo-detail/unified-right-panel/SentinelOvertures', () => ({ SentinelOvertures: () => null }));
vi.mock('../../../src/server/spa/client/react/features/repo-detail/unified-right-panel/SentinelTodoDependencies', () => ({ SentinelTodoDependencies: () => null }));
vi.mock('../../../src/server/spa/client/react/features/repo-detail/unified-right-panel/SentinelTodoPrOutcomes', () => ({ SentinelTodoPrOutcomes: () => null }));

import { UnifiedTodoTab } from '../../../src/server/spa/client/react/features/repo-detail/unified-right-panel/UnifiedTodoTab';
import { clearSentinelTodoExcursion } from '../../../src/server/spa/client/react/features/repo-detail/unified-right-panel/sentinelTodoExcursion';
import { applyRuntimeConfigPatch } from '../../../src/server/spa/client/react/utils/config';
import { registerCloneBaseUrls, resetCloneRegistryForTests } from '../../../src/server/spa/client/react/repos/cloneRegistry';

const owner = { ownerWorkspaceId: 'ws-owner', processId: 'chat-a', ownerRoutingRef: null };
let sets: Record<string, SentinelTodoCategorySet>;
const emit = (workspaceId = owner.ownerWorkspaceId) => {
    sockets.forEach(socket => socket.onMessage({ type: 'sentinel-todo-categories-changed', workspaceId, revision: sets[workspaceId]?.revision }));
};
const listNames = () => within(screen.getByRole('list', { name: 'Workspace categories' })).getAllByRole('listitem').map(row => row.querySelector('span')!.textContent);
async function manage() {
    const button = await screen.findByRole('button', { name: 'Manage categories' });
    await waitFor(() => expect((button as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(button);
    return screen.getByRole('dialog', { name: 'Manage categories' });
}
function deferred<T>() {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>(r => { resolve = r; });
    return { promise, resolve };
}
beforeEach(() => {
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(800);
    clearSentinelTodoExcursion();
    resetCloneRegistryForTests();
    references.length = 0;
    sockets.length = 0;
    Object.values(api).forEach(mock => mock.mockReset());
    applyRuntimeConfigPatch({ sentinelTodoCategoriesEnabled: true, sentinelTodoTagsEnabled: false,
        sentinelTodoExternalReferencesEnabled: false, sessionContextAttachmentsEnabled: false });
    sets = { 'ws-owner': { revision: 3, categories: [{ id: 'ui', name: 'Interface' }, { id: 'docs', name: 'Docs' }] },
        'ws-group': { revision: 0, categories: [] } };
    api.get.mockResolvedValue({ revision: 0, items: [] });
    api.connect.mockImplementation(options => {
        const socket = { ...options, close: vi.fn() };
        sockets.push(socket);
        return socket;
    });
    api.getCategories.mockImplementation(async ws => sets[ws]);
    api.createCategory.mockImplementation(async (ws, _chat, request) => {
        sets[ws] = { revision: sets[ws].revision + 1, categories: [...sets[ws].categories, { id: 'new', name: request.name }] };
        emit(ws);
        return sets[ws];
    });
    api.updateCategory.mockImplementation(async (ws, _chat, id, request) => {
        sets[ws] = { revision: sets[ws].revision + 1, categories: sets[ws].categories.map(category => category.id === id ? { ...category, name: request.name } : category) };
        emit(ws);
        return sets[ws];
    });
    api.reorderCategories.mockImplementation(async (ws, _chat, request) => {
        sets[ws] = { revision: sets[ws].revision + 1, categories: request.categoryIds.map((id: string) => sets[ws].categories.find(category => category.id === id)!) };
        emit(ws);
        return sets[ws];
    });
    api.getCategoryUsage.mockResolvedValue({ itemCount: 7, chatCount: 3 });
    api.deleteCategory.mockImplementation(async (ws, _chat, id) => {
        sets[ws] = { revision: sets[ws].revision + 1, categories: sets[ws].categories.filter(category => category.id !== id) };
        emit(ws);
        return { categorySet: sets[ws], itemCount: 7, chatCount: 3 };
    });
});
afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    applyRuntimeConfigPatch({ sentinelTodoCategoriesEnabled: false });
    resetCloneRegistryForTests();
});

describe('workspace category management', () => {
    it.each([320, 900])('creates, renames and reorders with revisions on the owning remote server at %ipx', async width => {
        vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(width);
        const remote = { ...owner, ownerRoutingRef: 'remote:server-a:ws-owner' };
        registerCloneBaseUrls([{ cloneKey: remote.ownerRoutingRef, workspaceId: owner.ownerWorkspaceId, baseUrl: 'https://server-a.test' }]);
        render(<UnifiedTodoTab owner={remote} scopeWorkspaceId="viewer" />);
        const dialog = await manage();
        const user = userEvent.setup();
        const add = within(dialog).getByRole('button', { name: 'Add category' });
        add.focus();
        await user.keyboard('{Enter}');
        fireEvent.change(screen.getByLabelText('Category name'), { target: { value: '  Fixes  ' } });
        fireEvent.click(screen.getByRole('button', { name: 'Save category' }));
        await waitFor(() => expect(listNames()).toEqual(['Interface', 'Docs', 'Fixes']));
        expect(api.createCategory).toHaveBeenCalledWith('ws-owner', 'chat-a', { expectedRevision: 3, name: 'Fixes' });
        fireEvent.click(screen.getByRole('button', { name: 'Rename Fixes' }));
        fireEvent.change(screen.getByLabelText('Category name'), { target: { value: 'Maintenance' } });
        fireEvent.click(screen.getByRole('button', { name: 'Save category' }));
        await waitFor(() => expect(listNames()).toEqual(['Interface', 'Docs', 'Maintenance']));
        expect(api.updateCategory).toHaveBeenCalledWith('ws-owner', 'chat-a', 'new', { expectedRevision: 4, name: 'Maintenance' });
        fireEvent.click(screen.getByRole('button', { name: 'Move Maintenance up' }));
        await waitFor(() => expect(listNames()).toEqual(['Interface', 'Maintenance', 'Docs']));
        expect(api.reorderCategories).toHaveBeenCalledWith('ws-owner', 'chat-a', { expectedRevision: 5, categoryIds: ['ui', 'new', 'docs'] });
        expect((screen.getByRole('button', { name: 'Move Interface up' }) as HTMLButtonElement).disabled).toBe(true);
        expect((screen.getByRole('button', { name: 'Move Docs down' }) as HTMLButtonElement).disabled).toBe(true);
        expect(references.every(reference => reference === remote.ownerRoutingRef)).toBe(true);
        expect(sockets).toHaveLength(1);
    });

    it('previews workspace-wide item/chat counts and requires confirmation before deletion', async () => {
        render(<UnifiedTodoTab owner={owner} />);
        await manage();
        fireEvent.click(screen.getByRole('button', { name: 'Delete Interface' }));
        await screen.findByRole('group', { name: 'Confirm category deletion' });
        expect(screen.getByText('Delete Interface? 7 items in 3 chats will move to Uncategorized.')).toBeTruthy();
        expect(api.getCategoryUsage).toHaveBeenCalledWith('ws-owner', 'chat-a', 'ui');
        expect(api.deleteCategory).not.toHaveBeenCalled();
        fireEvent.click(screen.getByRole('button', { name: 'Keep category' }));
        expect(api.deleteCategory).not.toHaveBeenCalled();
        fireEvent.click(screen.getByRole('button', { name: 'Delete Interface' }));
        fireEvent.click(await screen.findByRole('button', { name: 'Confirm delete category' }));
        await waitFor(() => expect(listNames()).toEqual(['Docs']));
        expect(api.deleteCategory).toHaveBeenCalledWith('ws-owner', 'chat-a', 'ui', { expectedRevision: 3, confirmed: true });
        await waitFor(() => expect(api.get).toHaveBeenCalledTimes(2));
    });

    it('refreshes other chats in the workspace while a repo group remains independent', async () => {
        const { container } = render(<><UnifiedTodoTab owner={owner} />
            <UnifiedTodoTab owner={{ ...owner, processId: 'chat-b' }} />
            <UnifiedTodoTab owner={{ ...owner, ownerWorkspaceId: 'ws-group', processId: 'group-chat' }} /></>);
        await waitFor(() => expect(api.getCategories).toHaveBeenCalledTimes(3));
        const tabs = container.querySelectorAll('[data-testid="sentinel-todo-tab"]');
        fireEvent.click(within(tabs[0] as HTMLElement).getByRole('button', { name: 'Manage categories' }));
        fireEvent.click(screen.getByRole('button', { name: 'Add category' }));
        fireEvent.change(screen.getByLabelText('Category name'), { target: { value: 'Fixes' } });
        fireEvent.click(screen.getByRole('button', { name: 'Save category' }));
        await waitFor(() => expect(within(tabs[1] as HTMLElement).getByText('3 categories')).toBeTruthy());
        expect(api.getCategories.mock.calls.filter(([ws]) => ws === 'ws-group')).toHaveLength(1);
        expect(within(tabs[2] as HTMLElement).getByText('0 categories')).toBeTruthy();
        fireEvent.click(screen.getByRole('button', { name: 'Close categories' }));
        fireEvent.click(within(tabs[1] as HTMLElement).getByRole('button', { name: 'Manage categories' }));
        expect(listNames()).toEqual(['Interface', 'Docs', 'Fixes']);
        fireEvent.click(screen.getByRole('button', { name: 'Rename Fixes' }));
        fireEvent.change(screen.getByLabelText('Category name'), { target: { value: 'Bugs' } });
        fireEvent.click(screen.getByRole('button', { name: 'Save category' }));
        await waitFor(() => expect(listNames()).toContain('Bugs'));
        fireEvent.click(screen.getByRole('button', { name: 'Delete Bugs' }));
        fireEvent.click(await screen.findByRole('button', { name: 'Confirm delete category' }));
        await waitFor(() => expect(within(tabs[0] as HTMLElement).getByText('2 categories')).toBeTruthy());
        expect(api.getCategories.mock.calls.filter(([ws]) => ws === 'ws-group')).toHaveLength(1);
    });

    it('keeps a rename draft across a revision conflict and requires review before retry', async () => {
        render(<UnifiedTodoTab owner={owner} />);
        await manage();
        fireEvent.click(screen.getByRole('button', { name: 'Rename Docs' }));
        fireEvent.change(screen.getByLabelText('Category name'), { target: { value: 'My draft' } });
        api.updateCategory.mockImplementationOnce(async () => {
            sets['ws-owner'] = { revision: 4, categories: [{ id: 'ui', name: 'Interface' }, { id: 'docs', name: 'Other name' }] };
            throw { status: 409 };
        });
        fireEvent.click(screen.getByRole('button', { name: 'Save category' }));
        await screen.findByText(/Review the refreshed list/);
        await waitFor(() => expect(listNames()).toContain('Other name'));
        expect((screen.getByLabelText('Category name') as HTMLInputElement).value).toBe('My draft');
        expect((screen.getByRole('button', { name: 'Save category' }) as HTMLButtonElement).disabled).toBe(true);
        fireEvent.click(screen.getByRole('button', { name: 'Use current category revision' }));
        fireEvent.click(screen.getByRole('button', { name: 'Save category' }));
        await waitFor(() => expect(listNames()).toContain('My draft'));
        expect(api.updateCategory).toHaveBeenLastCalledWith('ws-owner', 'chat-a', 'docs', { expectedRevision: 4, name: 'My draft' });
    });

    it('retains a rejected create draft and admits one write at a time', async () => {
        render(<UnifiedTodoTab owner={owner} />);
        await manage();
        fireEvent.click(screen.getByRole('button', { name: 'Add category' }));
        fireEvent.change(screen.getByLabelText('Category name'), { target: { value: 'Interface' } });
        api.createCategory.mockRejectedValueOnce(new Error('Category names must be unique.'));
        fireEvent.click(screen.getByRole('button', { name: 'Save category' }));
        await screen.findByText(/Category names must be unique/);
        expect((screen.getByLabelText('Category name') as HTMLInputElement).value).toBe('Interface');
        fireEvent.change(screen.getByLabelText('Category name'), { target: { value: 'Fixes' } });
        const pending = deferred<SentinelTodoCategorySet>();
        api.createCategory.mockReturnValueOnce(pending.promise);
        const form = screen.getByRole('form', { name: 'Add category' });
        fireEvent.submit(form);
        fireEvent.submit(form);
        expect(api.createCategory).toHaveBeenCalledTimes(2);
        await act(async () => pending.resolve({ revision: 4, categories: [...sets['ws-owner'].categories, { id: 'new', name: 'Fixes' }] }));
        expect(listNames()).toContain('Fixes');
    });

    it('leaves deletion unavailable when the usage preview fails', async () => {
        render(<UnifiedTodoTab owner={owner} />);
        await manage();
        api.getCategoryUsage.mockRejectedValueOnce(new Error('Owning server unavailable'));
        fireEvent.click(screen.getByRole('button', { name: 'Delete Interface' }));
        await screen.findByText(/Owning server unavailable/);
        expect(screen.queryByRole('button', { name: 'Confirm delete category' })).toBeNull();
        expect(api.deleteCategory).not.toHaveBeenCalled();
    });

    it('disables stale delete confirmation when another chat changes the category set', async () => {
        render(<UnifiedTodoTab owner={owner} />);
        await manage();
        fireEvent.click(screen.getByRole('button', { name: 'Delete Interface' }));
        await screen.findByRole('group', { name: 'Confirm category deletion' });
        sets['ws-owner'] = { ...sets['ws-owner'], revision: 4 };
        act(() => emit());
        await screen.findByText('Categories changed. Cancel and preview deletion again.');
        expect((screen.getByRole('button', { name: 'Confirm delete category' }) as HTMLButtonElement).disabled).toBe(true);
        expect(api.deleteCategory).not.toHaveBeenCalled();
    });

    it('supports an empty category set and disables adding at the cap', async () => {
        sets['ws-owner'] = { revision: 0, categories: [] };
        render(<UnifiedTodoTab owner={owner} />);
        await manage();
        expect(screen.getByText('No categories yet.')).toBeTruthy();
        sets['ws-owner'] = { revision: 1, categories: Array.from({ length: 12 }, (_, index) => ({ id: String(index), name: `Category ${index}` })) };
        act(() => emit());
        await waitFor(() => expect(listNames()).toHaveLength(12));
        expect((screen.getByRole('button', { name: 'Add category' }) as HTMLButtonElement).disabled).toBe(true);
        fireEvent.click(screen.getByRole('button', { name: 'Rename Category 0' }));
        expect(screen.getByLabelText('Category name').getAttribute('maxlength')).toBe('40');
        fireEvent.change(screen.getByLabelText('Category name'), { target: { value: '   ' } });
        expect((screen.getByRole('button', { name: 'Save category' }) as HTMLButtonElement).disabled).toBe(true);
    });

    it('loads only while enabled and discards pending reads when disabled', async () => {
        applyRuntimeConfigPatch({ sentinelTodoCategoriesEnabled: false });
        render(<UnifiedTodoTab owner={owner} />);
        await waitFor(() => expect(api.get).toHaveBeenCalledOnce());
        expect(api.getCategories).not.toHaveBeenCalled();
        expect(screen.queryByRole('button', { name: 'Manage categories' })).toBeNull();
        const pending = deferred<SentinelTodoCategorySet>();
        api.getCategories.mockReturnValueOnce(pending.promise);
        act(() => applyRuntimeConfigPatch({ sentinelTodoCategoriesEnabled: true }));
        await screen.findByText('Loading categories...');
        act(() => applyRuntimeConfigPatch({ sentinelTodoCategoriesEnabled: false }));
        await act(async () => pending.resolve({ revision: 100, categories: [{ id: 'stale', name: 'Stale' }] }));
        act(() => applyRuntimeConfigPatch({ sentinelTodoCategoriesEnabled: true }));
        await manage();
        expect(listNames()).toEqual(['Interface', 'Docs']);
    });

    it('shows owner load errors and retries without page-origin fallback for unresolved clones', async () => {
        const remote = { ...owner, ownerRoutingRef: 'remote:missing:ws-owner' };
        const view = render(<UnifiedTodoTab owner={remote} />);
        await screen.findByText(/Could not load categories: Owning server is not connected/);
        fireEvent.click(screen.getByRole('button', { name: 'Retry categories' }));
        expect(api.getCategories).not.toHaveBeenCalled();
        expect(api.get).not.toHaveBeenCalled();
        view.unmount();
        api.getCategories.mockRejectedValueOnce(new Error('offline'));
        render(<UnifiedTodoTab owner={owner} />);
        await screen.findByText(/Could not load categories: offline/);
        fireEvent.click(screen.getByRole('button', { name: 'Retry categories' }));
        await manage();
        expect(listNames()).toEqual(['Interface', 'Docs']);
    });

    it('discards older overlapping reads and late owner responses', async () => {
        render(<UnifiedTodoTab owner={owner} />);
        await manage();
        const oldRead = deferred<SentinelTodoCategorySet>();
        api.getCategories.mockReturnValueOnce(oldRead.promise);
        act(() => emit());
        sets['ws-owner'] = { revision: 4, categories: [{ id: 'fresh', name: 'Fresh' }] };
        act(() => emit());
        await waitFor(() => expect(listNames()).toEqual(['Fresh']));
        await act(async () => oldRead.resolve({ revision: 3, categories: [{ id: 'old', name: 'Old' }] }));
        expect(listNames()).toEqual(['Fresh']);
        const late = deferred<SentinelTodoCategorySet>();
        api.updateCategory.mockReturnValueOnce(late.promise);
        fireEvent.click(screen.getByRole('button', { name: 'Rename Fresh' }));
        fireEvent.change(screen.getByLabelText('Category name'), { target: { value: 'Late' } });
        fireEvent.click(screen.getByRole('button', { name: 'Save category' }));
        cleanup();
        render(<UnifiedTodoTab owner={{ ...owner, ownerWorkspaceId: 'ws-group' }} />);
        await act(async () => late.resolve({ revision: 100, categories: [{ id: 'late', name: 'Late' }] }));
        await manage();
        expect(screen.getByText('No categories yet.')).toBeTruthy();
        expect(sockets[0].close).toHaveBeenCalledOnce();
    });
});
