/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { SentinelTodoCategorySet, SentinelTodoItem } from '@plusplusoneplusplus/coc-client';

const { api, client, references, sockets } = vi.hoisted(() => {
    const api = { get: vi.fn(), create: vi.fn(), update: vi.fn(), connect: vi.fn(), getCategories: vi.fn(), createCategory: vi.fn(), updateCategory: vi.fn(),
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
    SentinelRefrains: ({ toolbar, children }: { toolbar: React.ReactNode; children: (scrubber: React.ReactNode) => React.ReactNode }) => <>{toolbar}{children(null)}</>,
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
    applyRuntimeConfigPatch({ sentinelTodoCategoriesEnabled: true,
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

function todo(id: string, patch: Partial<SentinelTodoItem> = {}): SentinelTodoItem {
    return { id, title: id, completionCondition: '', notes: '', status: 'todo', archived: false,
        revision: 1, createdAt: '2026-10-09T00:00:00.000Z', updatedAt: '2026-10-09T00:00:00.000Z',
        createdBy: 'sentinel', updatedBy: 'sentinel', jobs: [], type: 'normal', priority: 'regular', ...patch };
}
const group = (id: string) => screen.getByTestId(`sentinel-todo-category-${id}`);
const rowIds = (element: HTMLElement) => [...element.querySelectorAll('[data-todo-select]')].map(row => row.getAttribute('data-todo-select'));

describe('category grouped view', () => {
    it.each([320, 900])('uses workspace order, status order and active normal counts at %ipx', async width => {
        vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(width);
        sets['ws-owner'].categories.push({ id: 'empty', name: 'Empty' });
        api.get.mockResolvedValue({ revision: 1, items: [
            todo('docs-open', { categoryId: 'docs' }), todo('ui-open', { categoryId: 'ui' }),
            todo('ui-attention', { categoryId: 'ui', status: 'needs_attention', statusReason: 'Review' }),
            todo('ui-progress', { categoryId: 'ui', status: 'in_progress' }),
            todo('unknown', { categoryId: 'deleted' }), todo('none'),
            todo('manual', { categoryId: 'ui', type: 'manual', status: 'needs_attention' }),
            todo('done', { categoryId: 'ui', status: 'done' }), todo('archived', { categoryId: 'ui', archived: true }),
        ] });
        render(<UnifiedTodoTab owner={owner} />);
        await waitFor(() => expect(rowIds(group('ui'))).toHaveLength(3));
        const groups = screen.getByTestId('sentinel-todo-category-groups');
        expect([...groups.children].map(node => node.getAttribute('data-testid'))).toEqual([
            'sentinel-todo-category-ui', 'sentinel-todo-category-docs', 'sentinel-todo-category-empty', 'sentinel-todo-category-uncategorized',
        ]);
        expect(rowIds(group('ui'))).toEqual(['ui-attention', 'ui-progress', 'ui-open']);
        expect(within(group('ui')).getByRole('button', { name: /Interface \(3\).*1 needs attention/ })).toBeTruthy();
        expect(within(group('empty')).getByRole('button', { name: /Empty \(0\).*0 need attention/ })).toBeTruthy();
        expect(within(group('empty')).getByText('No active items.')).toBeTruthy();
        expect(rowIds(group('uncategorized'))).toEqual(['unknown', 'none']);
        expect(screen.getByTestId('sentinel-todo-category-label-manual').textContent).toBe('Interface');
        fireEvent.click(within(screen.getByTestId('sentinel-todo-done-section')).getByRole('button'));
        fireEvent.click(within(screen.getByTestId('sentinel-todo-archived-section')).getByRole('button'));
        expect(screen.getByTestId('sentinel-todo-category-label-done').textContent).toBe('Interface');
        expect(screen.getByTestId('sentinel-todo-category-label-archived').textContent).toBe('Interface');
        expect(rowIds(screen.getByTestId('sentinel-todo-manual-section'))).toEqual(['manual']);
        expect(rowIds(screen.getByTestId('sentinel-todo-done-section'))).toEqual(['done']);
        expect(rowIds(screen.getByTestId('sentinel-todo-archived-section'))).toEqual(['archived']);
    });

    it('reloads projected item assignments when categories are enabled live', async () => {
        applyRuntimeConfigPatch({ sentinelTodoCategoriesEnabled: false });
        api.get.mockResolvedValueOnce({ revision: 1, items: [todo('work')] })
            .mockResolvedValue({ revision: 1, items: [todo('work', { categoryId: 'ui' })] });
        render(<UnifiedTodoTab owner={owner} />);
        await screen.findByTestId('sentinel-todo-row-work');
        act(() => applyRuntimeConfigPatch({ sentinelTodoCategoriesEnabled: true }));
        await waitFor(() => expect(rowIds(group('ui'))).toEqual(['work']));
        expect(api.get).toHaveBeenCalledTimes(2);
    });

    it('keeps empty categories visible, hides empty Uncategorized and handles an empty set', async () => {
        render(<UnifiedTodoTab owner={owner} />);
        await screen.findByTestId('sentinel-todo-category-ui');
        expect(screen.queryByTestId('sentinel-todo-category-uncategorized')).toBeNull();
        expect(within(group('ui')).getByText('No active items.')).toBeTruthy();
        sets['ws-owner'] = { revision: 4, categories: [] };
        act(() => emit());
        await screen.findByText('No categories yet. Add a category to group your items.');
        expect(screen.queryByTestId('sentinel-todo-category-ui')).toBeNull();
    });

    it('preserves collapse on refresh and clears selection when its category collapses', async () => {
        api.get.mockResolvedValue({ revision: 1, items: [todo('work', { categoryId: 'ui' })] });
        render(<UnifiedTodoTab owner={owner} />);
        await screen.findByTestId('sentinel-todo-row-work');
        const toggle = () => within(group('ui')).getByRole('button', { name: /Interface \(1\)/ });
        fireEvent.click(toggle());
        expect(toggle().getAttribute('aria-expanded')).toBe('false');
        sets['ws-owner'] = { revision: 4, categories: [...sets['ws-owner'].categories].reverse() };
        act(() => emit());
        await waitFor(() => expect(screen.getByTestId('sentinel-todo-category-groups').firstElementChild).toBe(group('docs')));
        expect(toggle().getAttribute('aria-expanded')).toBe('false');
        fireEvent.click(toggle());
        fireEvent.click(screen.getByTestId('sentinel-todo-row-work').querySelector('[data-todo-select]')!);
        expect(screen.getByTestId('sentinel-todo-row-work').querySelector('[data-todo-select]')?.getAttribute('aria-pressed')).toBe('true');
        fireEvent.click(toggle());
        fireEvent.click(toggle());
        expect(screen.getByTestId('sentinel-todo-row-work').querySelector('[data-todo-select]')?.getAttribute('aria-pressed')).toBe('false');
    });

    it('reveals a selected item moved into a collapsed category and leaves search ungrouped', async () => {
        api.get.mockResolvedValue({ revision: 1, items: [todo('work', { categoryId: 'ui' })] });
        render(<UnifiedTodoTab owner={owner} />);
        await screen.findByTestId('sentinel-todo-row-work');
        fireEvent.click(within(group('docs')).getByRole('button', { name: /Docs/ }));
        fireEvent.click(screen.getByTestId('sentinel-todo-row-work').querySelector('[data-todo-select]')!);
        api.get.mockResolvedValue({ revision: 2, items: [todo('work', { categoryId: 'docs', revision: 2 })] });
        act(() => sockets.forEach(socket => socket.onMessage({ type: 'sentinel-todos-changed',
            workspaceId: owner.ownerWorkspaceId, processId: owner.processId, ledgerRevision: 2 })));
        await waitFor(() => expect(rowIds(group('docs'))).toEqual(['work']));
        expect(within(group('docs')).getByRole('button', { name: /Docs/ }).getAttribute('aria-expanded')).toBe('true');
        fireEvent.click(screen.getByRole('button', { name: 'Search to-do items' }));
        fireEvent.change(screen.getByTestId('sentinel-todo-search-input'), { target: { value: 'work' } });
        expect(screen.queryByTestId('sentinel-todo-category-groups')).toBeNull();
        expect(screen.getByTestId('sentinel-todo-category-label-work').textContent).toBe('Docs');
    });

    it('uses the plain active list with the flag off and refreshes names and missing assignments live', async () => {
        api.get.mockResolvedValue({ revision: 1, items: [todo('work', { categoryId: 'ui' })] });
        render(<UnifiedTodoTab owner={owner} />);
        await waitFor(() => expect(rowIds(group('ui'))).toEqual(['work']));
        sets['ws-owner'] = { revision: 4, categories: [{ id: 'ui', name: 'Renamed' }] };
        act(() => emit());
        await screen.findByRole('button', { name: /Renamed \(1\)/ });
        sets['ws-owner'] = { revision: 5, categories: [] };
        act(() => emit());
        await waitFor(() => expect(rowIds(group('uncategorized'))).toEqual(['work']));
        act(() => applyRuntimeConfigPatch({ sentinelTodoCategoriesEnabled: false }));
        expect(screen.queryByTestId('sentinel-todo-category-groups')).toBeNull();
        expect(screen.getByTestId('sentinel-todo-row-work')).toBeTruthy();
    });
});

describe('moving items between categories', () => {
    let items: SentinelTodoItem[];
    let revision: number;
    beforeEach(() => {
        items = [todo('work', { categoryId: 'ui' })];
        revision = 1;
        api.get.mockImplementation(async () => ({ revision, items }));
        api.update.mockImplementation(async (_ws, _chat, id, { expectedRevision, categoryId, ...patch }) => {
            const current = items.find(item => item.id === id)!;
            if (expectedRevision !== current.revision) throw { status: 409, body: { current } };
            const next = { ...current, ...patch, revision: current.revision + 1 } as SentinelTodoItem;
            if (categoryId === null) delete next.categoryId; else if (categoryId !== undefined) next.categoryId = categoryId;
            items = items.map(item => item.id === id ? next : item);
            revision += 1;
            return { item: next, ledgerRevision: revision };
        });
        api.create.mockImplementation(async () => {
            revision += 1;
            return { item: todo('created'), ledgerRevision: revision };
        });
    });
    const transfer = () => {
        const values = new Map<string, string>();
        return { types: [] as string[], effectAllowed: 'none', dropEffect: 'none',
            setData: vi.fn(function (this: { types: string[] }, key: string, value: string) {
                values.set(key, value);
                if (!this.types.includes(key)) this.types.push(key);
            }),
            getData: (key: string) => values.get(key) ?? '',
        };
    };
    const selectWork = () => fireEvent.click(screen.getByTestId('sentinel-todo-row-work').querySelector('[data-todo-select]')!);

    it('moves from the card menu with the keyboard, including to Uncategorized', async () => {
        render(<UnifiedTodoTab owner={owner} />);
        await waitFor(() => expect(rowIds(group('ui'))).toEqual(['work']));
        const user = userEvent.setup();
        const trigger = within(screen.getByTestId('sentinel-todo-row-work')).getByRole('button', { name: 'More actions' });
        trigger.focus();
        await user.keyboard('{Enter}');
        expect(screen.getByRole('menuitemradio', { name: 'Interface', checked: true })).toBeTruthy();
        screen.getByRole('menuitemradio', { name: 'Docs' }).focus();
        await user.keyboard('{Enter}');
        await waitFor(() => expect(rowIds(group('docs'))).toEqual(['work']));
        expect(api.update).toHaveBeenCalledWith('ws-owner', 'chat-a', 'work', { expectedRevision: 1, categoryId: 'docs' });
        fireEvent.click(within(screen.getByTestId('sentinel-todo-row-work')).getByRole('button', { name: 'More actions' }));
        fireEvent.click(screen.getByRole('menuitemradio', { name: 'Uncategorized' }));
        await waitFor(() => expect(rowIds(group('uncategorized'))).toEqual(['work']));
        expect(api.update).toHaveBeenLastCalledWith('ws-owner', 'chat-a', 'work', { expectedRevision: 2, categoryId: null });
    });

    it('moves by dropping the grip on another category and reports a stale drop', async () => {
        render(<UnifiedTodoTab owner={owner} />);
        await waitFor(() => expect(rowIds(group('ui'))).toEqual(['work']));
        let dataTransfer = transfer();
        fireEvent.dragStart(screen.getByTestId('sentinel-todo-move-grip-work'), { dataTransfer });
        expect(dataTransfer.effectAllowed).toBe('copyMove');
        expect(fireEvent.dragOver(group('ui'), { dataTransfer })).toBe(true);
        expect(fireEvent.dragOver(group('docs'), { dataTransfer })).toBe(false);
        expect(dataTransfer.dropEffect).toBe('move');
        fireEvent.drop(group('docs'), { dataTransfer });
        await waitFor(() => expect(rowIds(group('docs'))).toEqual(['work']));
        expect(api.update).toHaveBeenCalledWith('ws-owner', 'chat-a', 'work', { expectedRevision: 1, categoryId: 'docs' });

        dataTransfer = transfer();
        fireEvent.dragStart(screen.getByTestId('sentinel-todo-move-grip-work'), { dataTransfer });
        items = items.map(item => ({ ...item, revision: item.revision + 1 }));
        fireEvent.drop(group('ui'), { dataTransfer });
        expect(await screen.findByTestId('sentinel-todo-move-error')).toBeTruthy();
        expect(screen.getByTestId('sentinel-todo-move-error').textContent).toMatch(/Could not move work: .*Drag again to retry/);
        expect(rowIds(group('docs'))).toEqual(['work']);
        // A forged payload without this mount's drag ticket is ignored.
        const forged = transfer();
        forged.setData('application/x-coc-sentinel-todo-category', 'work');
        expect(fireEvent.dragOver(group('ui'), { dataTransfer: forged })).toBe(true);
        expect(api.update).toHaveBeenCalledTimes(2);
    });

    it('keeps reopening a Done item by dropping it on the grouped list', async () => {
        items = [todo('work', { categoryId: 'ui' }), todo('finished', { categoryId: 'docs', status: 'done' })];
        render(<UnifiedTodoTab owner={owner} />);
        fireEvent.click(within(await screen.findByTestId('sentinel-todo-done-section')).getByRole('button', { name: 'Done (1)' }));
        expect(screen.queryByTestId('sentinel-todo-move-grip-finished')).toBeNull();
        const dataTransfer = transfer();
        fireEvent.dragStart(within(screen.getByTestId('sentinel-todo-row-finished')).getByRole('button', { name: 'Reopen finished as To do' }), { dataTransfer });
        fireEvent.drop(group('ui'), { dataTransfer });
        await waitFor(() => expect(rowIds(group('docs'))).toEqual(['finished']));
        expect(api.update).toHaveBeenCalledWith('ws-owner', 'chat-a', 'finished', { expectedRevision: 1, status: 'todo', statusReason: null });
    });

    it('chooses a category in the add form, defaulting to automatic', async () => {
        render(<UnifiedTodoTab owner={owner} />);
        await screen.findByTestId('sentinel-todo-row-work');
        for (const [choice, expected] of [[undefined, undefined], ['docs', 'docs'], ['', null]] as const) {
            fireEvent.click(screen.getByTestId('sentinel-todo-add'));
            const select = screen.getByLabelText('Category') as HTMLSelectElement;
            expect([...select.options].map(option => option.textContent)).toEqual(['Pick automatically', 'Interface', 'Docs', 'Uncategorized']);
            if (choice !== undefined) fireEvent.change(select, { target: { value: choice } });
            fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'New' } });
            fireEvent.click(screen.getByRole('button', { name: 'Add' }));
            await waitFor(() => expect(screen.queryByTestId('sentinel-todo-add-form')).toBeNull());
            const request = api.create.mock.lastCall![2];
            if (expected === undefined) expect(request).not.toHaveProperty('categoryId');
            else expect(request.categoryId).toBe(expected);
        }
    });

    it('moves from the edit form and keeps the draft across a conflict', async () => {
        render(<UnifiedTodoTab owner={owner} />);
        await screen.findByTestId('sentinel-todo-row-work');
        selectWork();
        const detail = screen.getByTestId('sentinel-todo-detail-work');
        fireEvent.click(within(detail).getByRole('button', { name: 'Edit' }));
        const form = screen.getByTestId('sentinel-todo-edit-form-work');
        const select = within(form).getByLabelText('Category') as HTMLSelectElement;
        expect(select.value).toBe('ui');
        fireEvent.change(select, { target: { value: 'docs' } });
        items = items.map(item => ({ ...item, revision: 2, notes: 'changed elsewhere' }));
        revision = 2;
        fireEvent.click(within(form).getByRole('button', { name: 'Save' }));
        await within(detail).findByTestId('sentinel-todo-row-error-work');
        expect((within(screen.getByTestId('sentinel-todo-edit-form-work')).getByLabelText('Category') as HTMLSelectElement).value).toBe('docs');
        fireEvent.click(within(screen.getByTestId('sentinel-todo-edit-form-work')).getByRole('button', { name: 'Save' }));
        await waitFor(() => expect(rowIds(group('docs'))).toEqual(['work']));
        expect(api.update).toHaveBeenLastCalledWith('ws-owner', 'chat-a', 'work', { expectedRevision: 2, categoryId: 'docs' });
        expect(screen.queryByTestId('sentinel-todo-edit-form-work')).toBeNull();
    });

    it('moves from the detail pane select and hides it for archived items or with the flag off', async () => {
        items = [todo('work', { categoryId: 'deleted' }), todo('old', { categoryId: 'ui', archived: true })];
        render(<UnifiedTodoTab owner={owner} />);
        await screen.findByTestId('sentinel-todo-row-work');
        selectWork();
        const detail = screen.getByTestId('sentinel-todo-detail-work');
        const select = within(detail).getByLabelText('Category') as HTMLSelectElement;
        expect(select.value).toBe('');
        fireEvent.change(select, { target: { value: 'ui' } });
        await waitFor(() => expect(rowIds(group('ui'))).toEqual(['work']));
        expect(api.update).toHaveBeenCalledWith('ws-owner', 'chat-a', 'work', { expectedRevision: 1, categoryId: 'ui' });
        fireEvent.click(within(screen.getByTestId('sentinel-todo-archived-section')).getByRole('button'));
        fireEvent.click(screen.getByTestId('sentinel-todo-row-old').querySelector('[data-todo-select]')!);
        expect(within(screen.getByTestId('sentinel-todo-detail-old')).queryByLabelText('Category')).toBeNull();
        act(() => applyRuntimeConfigPatch({ sentinelTodoCategoriesEnabled: false }));
        selectWork();
        expect(within(screen.getByTestId('sentinel-todo-detail-work')).queryByLabelText('Category')).toBeNull();
        expect(screen.queryByTestId('sentinel-todo-move-grip-work')).toBeNull();
    });
});
