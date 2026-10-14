/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { SentinelTodoItem, SentinelTodoLedgerResponse } from '@plusplusoneplusplus/coc-client';

const { api, client, references, events } = vi.hoisted(() => {
    const api = { get: vi.fn(), create: vi.fn(), update: vi.fn(), getTags: vi.fn(), connect: vi.fn(),
        createTag: vi.fn(), updateTag: vi.fn(), deleteTag: vi.fn(), suggestTags: vi.fn() };
    return { api, client: { sentinelTodos: api, events: { connect: api.connect } }, references: [] as unknown[], events: { refresh: () => {} } };
});
vi.mock('../../../src/server/spa/client/react/repos/cloneRouting', () => ({
    useCocClient: (reference: unknown) => { references.push(reference); return client; },
}));
vi.mock('../../../src/server/spa/client/react/repos/cloneRegistry', async importOriginal => ({
    ...(await importOriginal<object>()),
    getCocClientForWorkspace: (reference: unknown) => { references.push(reference); return client; },
}));
vi.mock('../../../src/server/spa/client/react/features/repo-detail/unified-right-panel/SentinelTodoScrubber', () => ({
    SentinelTodoScrubber: ({ toolbar, children }: { toolbar: React.ReactNode; children: React.ReactNode }) => <>{toolbar}{children}</>,
}));
vi.mock('../../../src/server/spa/client/react/features/repo-detail/unified-right-panel/SentinelTodoScrubFinding', () => ({
    AcceptAllScrubProposals: () => null, SentinelTodoScrubFinding: () => null,
}));
vi.mock('../../../src/server/spa/client/react/features/repo-detail/unified-right-panel/SentinelTodoTriggers', () => ({ SentinelTodoTriggers: () => null }));
vi.mock('../../../src/server/spa/client/react/features/repo-detail/unified-right-panel/SentinelTodoDependencies', () => ({ SentinelTodoDependencies: () => null }));
vi.mock('../../../src/server/spa/client/react/features/repo-detail/unified-right-panel/SentinelTodoPrOutcomes', () => ({ SentinelTodoPrOutcomes: () => null }));

import { UnifiedTodoTab } from '../../../src/server/spa/client/react/features/repo-detail/unified-right-panel/UnifiedTodoTab';
import { clearSentinelTodoExcursion } from '../../../src/server/spa/client/react/features/repo-detail/unified-right-panel/sentinelTodoExcursion';
import { applyRuntimeConfigPatch } from '../../../src/server/spa/client/react/utils/config';
import { registerCloneBaseUrls, resetCloneRegistryForTests } from '../../../src/server/spa/client/react/repos/cloneRegistry';
import { isSentinelTodoChangeFor, sentinelTodoTabInput, shouldAutoOpenSentinelTodoTab } from '../../../src/server/spa/client/react/features/repo-detail/unified-right-panel/sentinelTodoPanelModel';
import { closeTab, EMPTY_UNIFIED_PANEL, openTab, visibleTabs } from '../../../src/server/spa/client/react/features/repo-detail/unified-right-panel/unifiedPanelTabsModel';

const owner = { ownerWorkspaceId: 'ws-owner', processId: 'queue_parent', ownerRoutingRef: null };
let snapshot: SentinelTodoLedgerResponse;
function item(id = 'item-one', extra: Partial<SentinelTodoItem> = {}): SentinelTodoItem {
    return { id, title: id, type: 'normal', priority: 'regular', status: 'todo', notes: 'Original notes',
        completionCondition: 'Review complete', revision: 1, tagRevision: 0, archived: false, jobs: [],
        createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z', createdBy: 'user', updatedBy: 'user', ...extra };
}
function library() {
    return { revision: 3, tags: [
        { id: 'tag-ui', name: 'Interface', color: 'blue' as const, description: 'Controls and layout' },
        { id: 'tag-docs', name: 'Docs', color: 'violet' as const },
    ] };
}
function selectItem(id = 'item-one') {
    fireEvent.click(within(screen.getByTestId(`sentinel-todo-row-${id}`)).getByRole('button', { name: new RegExp(id) }));
    return screen.getByTestId(`sentinel-todo-detail-${id}`);
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
    Object.values(api).forEach(mock => mock.mockReset());
    api.connect.mockImplementation(({ onMessage }: { onMessage: (message: unknown) => void }) => {
        events.refresh = () => onMessage({ type: 'sentinel-todos-changed', workspaceId: owner.ownerWorkspaceId,
            processId: owner.processId, ledgerRevision: snapshot.revision, tagOnly: true });
        return { close: vi.fn() };
    });
    applyRuntimeConfigPatch({ sentinelTodoTagsEnabled: true, sessionContextAttachmentsEnabled: false });
    snapshot = { revision: 1, items: [item('item-one', { tagIds: ['tag-ui'], tagOrigin: 'suggested', tagMatch: { state: 'matched' } })], tagLibrary: library() };
    api.get.mockImplementation(async () => snapshot);
    api.update.mockImplementation(async (_ws, _parent, id, patch) => {
        const tagOnly = 'tagIds' in patch;
        snapshot = { ...snapshot, revision: snapshot.revision + (tagOnly ? 0 : 1), items: snapshot.items.map(current => current.id === id
            ? { ...current, ...patch, revision: current.revision + (tagOnly ? 0 : 1),
                ...(tagOnly ? { tagOrigin: 'manual', tagRevision: (current.tagRevision ?? 0) + 1 } : {}) } : current) };
        return { ledgerRevision: snapshot.revision, item: snapshot.items.find(current => current.id === id) };
    });
    api.createTag.mockImplementation(async (_ws, _parent, patch) => {
        snapshot = { ...snapshot, tagLibrary: { revision: snapshot.tagLibrary!.revision + 1,
            tags: [...snapshot.tagLibrary!.tags, { id: 'tag-new', name: patch.name, color: patch.color, description: patch.description }] } };
        return snapshot.tagLibrary;
    });
    api.updateTag.mockImplementation(async (_ws, _parent, id, patch) => {
        snapshot = { ...snapshot, tagLibrary: { revision: snapshot.tagLibrary!.revision + 1,
            tags: snapshot.tagLibrary!.tags.map(tag => tag.id === id ? { ...tag, ...patch } : tag) } };
        return snapshot.tagLibrary;
    });
    api.deleteTag.mockImplementation(async (_ws, _parent, id) => {
        snapshot = { ...snapshot, tagLibrary: { revision: snapshot.tagLibrary!.revision + 1,
            tags: snapshot.tagLibrary!.tags.filter(tag => tag.id !== id) },
        items: snapshot.items.map(current => ({ ...current, tagIds: current.tagIds?.filter(tagId => tagId !== id) })) };
        return snapshot.tagLibrary;
    });
    api.suggestTags.mockImplementation(async () => {
        snapshot = { ...snapshot, items: snapshot.items.map(current => ({ ...current, tagRevision: (current.tagRevision ?? 0) + 1,
            tagIds: ['tag-docs'], tagOrigin: 'suggested', tagMatch: { state: 'matched' } })) };
        return { ledgerRevision: snapshot.revision, item: snapshot.items[0] };
    });
});
afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    applyRuntimeConfigPatch({ sentinelTodoTagsEnabled: false });
    resetCloneRegistryForTests();
});

describe('Sentinel to-do tags', () => {
    it('refreshes tag-only events but never autoopens a closed tab at ledger revision one', () => {
        const input = sentinelTodoTabInput(owner, 'parent-chat');
        const opened = openTab(EMPTY_UNIFIED_PANEL, input);
        const closed = closeTab(opened, visibleTabs(opened, 'parent-chat')[0].id);
        const first = { type: 'sentinel-todos-changed', workspaceId: owner.ownerWorkspaceId,
            processId: owner.processId, ledgerRevision: 1 };
        expect(shouldAutoOpenSentinelTodoTab(EMPTY_UNIFIED_PANEL, 'parent-chat', input, first)).toBe(true);
        const tags = { ...first, tagOnly: true };
        expect(isSentinelTodoChangeFor(tags, owner)).toBe(true);
        expect(shouldAutoOpenSentinelTodoTab(EMPTY_UNIFIED_PANEL, 'parent-chat', input, tags)).toBe(false);
        expect(shouldAutoOpenSentinelTodoTab(closed, 'parent-chat', input, tags)).toBe(false);
    });

    it('hides tags and makes no tag calls with the flag disabled, even if tags arrive in a snapshot', async () => {
        applyRuntimeConfigPatch({ sentinelTodoTagsEnabled: false });
        render(<UnifiedTodoTab owner={owner} />);
        await screen.findByTestId('sentinel-todo-row-item-one');
        selectItem();
        expect(screen.queryByLabelText('Tag')).toBeNull();
        expect(screen.queryByText('Interface')).toBeNull();
        expect(screen.queryByRole('button', { name: 'Edit tags' })).toBeNull();
        expect(screen.queryByRole('button', { name: 'Manage tags' })).toBeNull();
        for (const method of ['getTags', 'createTag', 'updateTag', 'deleteTag', 'suggestTags'] as const) expect(api[method]).not.toHaveBeenCalled();
        expect(api.update).not.toHaveBeenCalled();
    });

    it('uses named restrained chips separate from status and filters the full ledger, including older Done and manual items', async () => {
        snapshot.items = Array.from({ length: 65 }, (_, index) => item(`older-${index}`, { status: 'done',
            updatedAt: new Date(Date.UTC(2026, 0, 1, 0, index)).toISOString(),
            tagIds: index === 0 ? ['tag-ui'] : ['tag-docs'] }));
        snapshot.items.push(item('manual-one', { type: 'manual', tagIds: ['tag-ui'], tagOrigin: 'manual' }), item('untagged'),
            item('archived-one', { archived: true, tagIds: ['tag-ui'] }));
        render(<UnifiedTodoTab owner={owner} />);
        await screen.findByTestId('sentinel-todo-row-untagged');
        expect(api.get).toHaveBeenCalledWith(owner.ownerWorkspaceId, owner.processId, { full: true });
        expect(screen.queryByTestId('sentinel-todo-row-older-0')).toBeNull();
        fireEvent.change(screen.getByLabelText('Tag'), { target: { value: 'tag-ui' } });
        fireEvent.click(screen.getByRole('button', { name: 'Done (1)', exact: true }));
        const older = screen.getByTestId('sentinel-todo-row-older-0');
        expect(within(older).getByText('Interface').getAttribute('data-color')).toBe('blue');
        expect(within(older).getByTestId('sentinel-todo-status-done')).toBeTruthy();
        expect(screen.getByTestId('sentinel-todo-row-manual-one')).toBeTruthy();
        fireEvent.click(screen.getByRole('button', { name: 'Archived (1)', exact: true }));
        expect(screen.getByTestId('sentinel-todo-row-archived-one')).toBeTruthy();
        expect(screen.queryByTestId('sentinel-todo-row-older-64')).toBeNull();
        expect(screen.queryByTestId('sentinel-todo-show-older')).toBeNull();
        fireEvent.change(screen.getByLabelText('Tag'), { target: { value: 'untagged' } });
        expect(screen.getByTestId('sentinel-todo-row-untagged')).toBeTruthy();
        expect(screen.queryByTestId('sentinel-todo-row-manual-one')).toBeNull();
    });

    it('adds, renames and explicitly confirms deletion with library revisions, keeping item authority unchanged', async () => {
        render(<UnifiedTodoTab owner={owner} />);
        await screen.findByTestId('sentinel-todo-row-item-one');
        fireEvent.click(screen.getByRole('button', { name: 'Manage tags' }));
        const dialog = screen.getByRole('dialog', { name: 'Manage tags' });
        fireEvent.click(within(dialog).getByRole('button', { name: 'Add tag' }));
        fireEvent.change(screen.getByLabelText('Tag name'), { target: { value: 'Reliability' } });
        fireEvent.change(screen.getByLabelText('Tag color'), { target: { value: 'teal' } });
        fireEvent.change(screen.getByLabelText('Matching description (optional)'), { target: { value: 'Recovery paths' } });
        fireEvent.click(screen.getByRole('button', { name: 'Save tag' }));
        await screen.findByRole('button', { name: 'Edit tag Reliability' });
        expect(api.createTag).toHaveBeenCalledWith('ws-owner', 'queue_parent',
            { expectedRevision: 3, name: 'Reliability', color: 'teal', description: 'Recovery paths' });
        fireEvent.click(screen.getByRole('button', { name: 'Edit tag Reliability' }));
        fireEvent.change(screen.getByLabelText('Tag name'), { target: { value: 'Resilience' } });
        fireEvent.click(screen.getByRole('button', { name: 'Save tag' }));
        await screen.findByRole('button', { name: 'Delete tag Resilience' });
        expect(api.updateTag).toHaveBeenCalledWith('ws-owner', 'queue_parent', 'tag-new',
            { expectedRevision: 4, name: 'Resilience', color: 'teal', description: 'Recovery paths' });
        fireEvent.click(screen.getByRole('button', { name: 'Delete tag Interface' }));
        expect(api.deleteTag).not.toHaveBeenCalled();
        expect(screen.getByText(/removes it from every item/)).toBeTruthy();
        fireEvent.click(screen.getByRole('button', { name: 'Cancel deletion' }));
        expect(api.deleteTag).not.toHaveBeenCalled();
        fireEvent.click(screen.getByRole('button', { name: 'Delete tag Interface' }));
        fireEvent.click(screen.getByRole('button', { name: 'Confirm delete' }));
        await waitFor(() => expect(screen.queryByRole('button', { name: 'Delete tag Interface' })).toBeNull());
        expect(api.deleteTag).toHaveBeenCalledWith('ws-owner', 'queue_parent', 'tag-ui', { expectedRevision: 5, confirmed: true });
        expect(api.get.mock.calls.length).toBe(4);
        expect(api.update).not.toHaveBeenCalled();
        expect(snapshot.items[0].status).toBe('todo');
        expect(snapshot.items[0].type).toBe('normal');
    });

    it('makes picker selection explicit and saves an empty manual clear without changing a manual item to normal', async () => {
        snapshot.items[0].type = 'manual';
        render(<UnifiedTodoTab owner={owner} />);
        await screen.findByTestId('sentinel-todo-row-item-one');
        const detail = selectItem();
        fireEvent.click(within(detail).getByRole('button', { name: 'Edit tags' }));
        const form = screen.getByRole('form', { name: 'Edit item tags' });
        fireEvent.click(within(form).getByRole('checkbox', { name: 'Docs' }));
        expect(api.update).not.toHaveBeenCalled();
        fireEvent.click(screen.getByRole('button', { name: 'Save tags' }));
        await waitFor(() => expect(api.update).toHaveBeenCalledTimes(1));
        expect(api.update.mock.calls[0]).toEqual(['ws-owner', 'queue_parent', 'item-one',
            { expectedRevision: 1, expectedTagRevision: 0, tagIds: ['tag-ui', 'tag-docs'] }]);
        await waitFor(() => expect(screen.queryByRole('form', { name: 'Edit item tags' })).toBeNull());
        fireEvent.click(screen.getByRole('button', { name: 'Edit tags' }));
        fireEvent.click(screen.getByRole('button', { name: 'Clear tags' }));
        fireEvent.click(screen.getByRole('button', { name: 'Save tags' }));
        await waitFor(() => expect(api.update).toHaveBeenCalledTimes(2));
        expect(api.update.mock.calls[1][3]).toEqual({ expectedRevision: 1, expectedTagRevision: 1, tagIds: [] });
        await screen.findByText('Manual tags');
        expect(snapshot.items[0].type).toBe('manual');
        expect(snapshot.items[0].status).toBe('todo');
        expect(snapshot.items[0].revision).toBe(1);
        expect(snapshot.revision).toBe(1);
        expect(snapshot.items[0].tagRevision).toBe(2);
        fireEvent.click(within(detail).getByRole('button', { name: 'Edit', exact: true }));
        fireEvent.change(within(detail).getByLabelText('Notes (optional)'), { target: { value: 'Updated text' } });
        fireEvent.click(within(detail).getByRole('button', { name: 'Save', exact: true }));
        await waitFor(() => expect(api.update).toHaveBeenCalledTimes(3));
        expect(api.update.mock.calls[2][3]).not.toHaveProperty('tagIds');
        expect(snapshot.items[0].tagIds).toEqual([]);
    });

    it('defaults to one suggestion and only replaces a manual clear after explicit confirmation; multiple is opt-in', async () => {
        snapshot.items[0] = item('item-one', { tagIds: [], tagOrigin: 'manual' });
        render(<UnifiedTodoTab owner={owner} />);
        await screen.findByTestId('sentinel-todo-row-item-one');
        selectItem();
        expect((screen.getByRole('checkbox', { name: 'Match multiple tags' }) as HTMLInputElement).checked).toBe(false);
        fireEvent.click(screen.getByRole('button', { name: 'Re-suggest tags' }));
        expect(api.suggestTags).not.toHaveBeenCalled();
        fireEvent.click(screen.getByRole('button', { name: 'Keep manual tags' }));
        expect(api.suggestTags).not.toHaveBeenCalled();
        fireEvent.click(screen.getByRole('button', { name: 'Re-suggest tags' }));
        fireEvent.click(screen.getByRole('button', { name: 'Confirm re-suggest' }));
        await waitFor(() => expect(api.suggestTags).toHaveBeenCalledWith('ws-owner', 'queue_parent', 'item-one',
            { expectedRevision: 1, expectedTagRevision: 0, multiple: false, confirmed: true }));
        await screen.findByText('Suggested tags');
        fireEvent.click(screen.getByRole('checkbox', { name: 'Match multiple tags' }));
        fireEvent.click(screen.getByRole('button', { name: 'Re-suggest tags' }));
        await waitFor(() => expect(api.suggestTags).toHaveBeenCalledTimes(2));
        expect(api.suggestTags.mock.calls[1][3]).toEqual({ expectedRevision: 1, expectedTagRevision: 1, multiple: true });
    });

    it.each([
        ['failed', 'Tag suggestion failed'], ['unavailable', 'Tag suggestions unavailable'], ['no_match', 'No matching tag'],
    ] as const)('honestly renders %s without changing item status', async (state, label) => {
        snapshot.items[0] = item('item-one', { tagIds: [], tagMatch: { state, message: 'Matching detail' } });
        render(<UnifiedTodoTab owner={owner} />);
        await screen.findByTestId('sentinel-todo-row-item-one');
        const detail = selectItem();
        expect(within(detail).getByRole('status').textContent).toBe(`${label}: Matching detail`);
        expect(within(detail).getByTestId('sentinel-todo-status-todo')).toBeTruthy();
        expect(api.update).not.toHaveBeenCalled();
    });

    it('preserves item text and tag drafts after tag-save failure and retries the selection explicitly', async () => {
        api.update.mockRejectedValueOnce(new Error('Connection unavailable'));
        render(<UnifiedTodoTab owner={owner} />);
        await screen.findByTestId('sentinel-todo-row-item-one');
        const detail = selectItem();
        fireEvent.click(within(detail).getByRole('button', { name: 'Edit', exact: true }));
        fireEvent.change(within(detail).getByLabelText('Title'), { target: { value: 'Unsaved item title' } });
        fireEvent.click(within(detail).getByRole('button', { name: 'Edit tags' }));
        fireEvent.click(screen.getByRole('button', { name: 'Clear tags' }));
        fireEvent.click(screen.getByRole('button', { name: 'Save tags' }));
        await screen.findByRole('alert');
        expect((within(detail).getByLabelText('Title') as HTMLInputElement).value).toBe('Unsaved item title');
        expect((screen.getByRole('checkbox', { name: 'Interface' }) as HTMLInputElement).checked).toBe(false);
        fireEvent.click(screen.getByRole('button', { name: 'Save tags' }));
        await waitFor(() => expect(screen.queryByRole('form', { name: 'Edit item tags' })).toBeNull());
        expect((within(detail).getByLabelText('Title') as HTMLInputElement).value).toBe('Unsaved item title');
        expect(api.update.mock.calls.map(call => call[3])).toEqual([
            { expectedRevision: 1, expectedTagRevision: 0, tagIds: [] }, { expectedRevision: 1, expectedTagRevision: 0, tagIds: [] },
        ]);
        fireEvent.click(within(detail).getByRole('button', { name: 'Save', exact: true }));
        await waitFor(() => expect(api.update).toHaveBeenCalledTimes(3));
        expect(api.update.mock.calls[2][3].expectedRevision).toBe(1);
        expect(api.update.mock.calls[2][3].title).toBe('Unsaved item title');
    });

    it('keeps library drafts after conflict and refreshes the full ledger before an explicit retry', async () => {
        api.createTag.mockImplementationOnce(async () => {
            snapshot = { ...snapshot, tagLibrary: { ...snapshot.tagLibrary!, revision: 7 } };
            throw Object.assign(new Error('Conflict'), { status: 409 });
        });
        render(<UnifiedTodoTab owner={owner} />);
        await screen.findByTestId('sentinel-todo-row-item-one');
        fireEvent.click(screen.getByRole('button', { name: 'Manage tags' }));
        fireEvent.click(screen.getByRole('button', { name: 'Add tag' }));
        fireEvent.change(screen.getByLabelText('Tag name'), { target: { value: 'Resilience' } });
        fireEvent.click(screen.getByRole('button', { name: 'Save tag' }));
        await screen.findByRole('alert');
        expect((screen.getByLabelText('Tag name') as HTMLInputElement).value).toBe('Resilience');
        expect(api.createTag).toHaveBeenCalledTimes(1);
        fireEvent.click(screen.getByRole('button', { name: 'Use current library revision' }));
        fireEvent.click(screen.getByRole('button', { name: 'Save tag' }));
        await screen.findByRole('button', { name: 'Edit tag Resilience' });
        expect(api.createTag.mock.calls[1][2].expectedRevision).toBe(7);
    });

    it('keeps the library revision captured when editing rather than silently overwriting a concurrent rename', async () => {
        render(<UnifiedTodoTab owner={owner} />);
        await screen.findByTestId('sentinel-todo-row-item-one');
        fireEvent.click(screen.getByRole('button', { name: 'Manage tags' }));
        fireEvent.click(screen.getByRole('button', { name: 'Edit tag Interface' }));
        fireEvent.change(screen.getByLabelText('Tag name'), { target: { value: 'My rename' } });
        snapshot = { ...snapshot, tagLibrary: { ...snapshot.tagLibrary!, revision: 9,
            tags: snapshot.tagLibrary!.tags.map(tag => tag.id === 'tag-ui' ? { ...tag, name: 'Concurrent rename' } : tag) } };
        act(() => events.refresh());
        await screen.findByRole('button', { name: 'Edit tag Concurrent rename' });
        expect((screen.getByLabelText('Tag name') as HTMLInputElement).value).toBe('My rename');
        fireEvent.click(screen.getByRole('button', { name: 'Save tag' }));
        await waitFor(() => expect(api.updateTag).toHaveBeenCalledTimes(1));
        expect(api.updateTag.mock.calls[0][3].expectedRevision).toBe(3);
    });

    it('shows deleted draft selections and requires explicit removal rather than hiding invalid tag IDs', async () => {
        render(<UnifiedTodoTab owner={owner} />);
        await screen.findByTestId('sentinel-todo-row-item-one');
        selectItem();
        fireEvent.click(screen.getByRole('button', { name: 'Edit tags' }));
        fireEvent.click(screen.getByRole('checkbox', { name: 'Docs' }));
        snapshot = { ...snapshot, tagLibrary: { revision: 4,
            tags: snapshot.tagLibrary!.tags.filter(tag => tag.id !== 'tag-docs') } };
        act(() => events.refresh());
        await screen.findByText(/A selected tag was deleted/);
        expect((screen.getByRole('button', { name: 'Save tags' }) as HTMLButtonElement).disabled).toBe(true);
        expect(api.update).not.toHaveBeenCalled();
        fireEvent.click(screen.getByRole('button', { name: 'Remove deleted selections' }));
        fireEvent.click(screen.getByRole('button', { name: 'Save tags' }));
        await waitFor(() => expect(api.update).toHaveBeenCalledTimes(1));
        expect(api.update.mock.calls[0][3].tagIds).toEqual(['tag-ui']);
    });

    it('refreshes chips and filter names from full-ledger notifications', async () => {
        render(<UnifiedTodoTab owner={owner} />);
        await screen.findByTestId('sentinel-todo-row-item-one');
        snapshot = { ...snapshot, tagLibrary: { revision: 4, tags: [{ id: 'tag-ui', name: 'UI', color: 'teal' }] } };
        act(() => events.refresh());
        await screen.findByRole('option', { name: 'UI' });
        expect(within(screen.getByTestId('sentinel-todo-row-item-one')).getByText('UI')).toBeTruthy();
        expect(api.get).toHaveBeenLastCalledWith('ws-owner', 'queue_parent', { full: true });
    });

    it('refreshes repeated same-revision tag invalidations in visited details without losing content drafts', async () => {
        snapshot.items.push(item('item-two'));
        render(<UnifiedTodoTab owner={owner} />);
        await screen.findByTestId('sentinel-todo-row-item-one');
        const detail = selectItem();
        fireEvent.click(within(detail).getByRole('button', { name: 'Edit', exact: true }));
        fireEvent.change(within(detail).getByLabelText('Title'), { target: { value: 'Unsaved content' } });
        selectItem('item-two');
        snapshot = { ...snapshot, items: snapshot.items.map(current => current.id === 'item-one'
            ? { ...current, tagRevision: 1, tagIds: ['tag-docs'], tagOrigin: 'manual' } : current) };
        act(() => events.refresh());
        await waitFor(() => expect(within(detail).getByText('Docs')).toBeTruthy());
        snapshot = { ...snapshot, tagLibrary: { revision: 4, tags: [{ id: 'tag-docs', name: 'Documentation', color: 'teal' }] } };
        act(() => events.refresh());
        await waitFor(() => expect(within(detail).getByText('Documentation')).toBeTruthy());
        selectItem();
        expect(within(detail).getByText('Manual tags')).toBeTruthy();
        expect((within(detail).getByLabelText('Title') as HTMLInputElement).value).toBe('Unsaved content');
        expect(snapshot.items[0].revision).toBe(1);
        expect(snapshot.revision).toBe(1);
        expect(api.get).toHaveBeenCalledTimes(3);
        expect(api.update).not.toHaveBeenCalled();
    });

    it('drops a late owner-routed tag mutation when the same workspace moves to another server', async () => {
        registerCloneBaseUrls([{ cloneKey: 'remote:server-a:ws-owner', workspaceId: 'ws-owner', baseUrl: 'http://server-a.test' },
            { cloneKey: 'remote:server-b:ws-owner', workspaceId: 'ws-owner', baseUrl: 'http://server-b.test' }]);
        const pending = deferred<object>();
        api.suggestTags.mockReturnValueOnce(pending.promise);
        const view = render(<UnifiedTodoTab owner={{ ...owner, ownerRoutingRef: 'remote:server-a:ws-owner' }} />);
        await screen.findByTestId('sentinel-todo-row-item-one');
        selectItem();
        fireEvent.click(screen.getByRole('button', { name: 'Re-suggest tags' }));
        await waitFor(() => expect(api.suggestTags).toHaveBeenCalledTimes(1));
        snapshot = { revision: 9, tagLibrary: { revision: 2, tags: [] }, items: [item('new-owner-item')] };
        view.rerender(<UnifiedTodoTab owner={{ ...owner, ownerRoutingRef: 'remote:server-b:ws-owner' }} />);
        await screen.findByTestId('sentinel-todo-row-new-owner-item');
        const reads = api.get.mock.calls.length;
        await act(async () => { pending.resolve({}); });
        expect(api.get).toHaveBeenCalledTimes(reads);
        expect(screen.queryByText('Interface')).toBeNull();
        expect(references).toContain('remote:server-a:ws-owner');
        expect(references).toContain('remote:server-b:ws-owner');
    });

    it('reports absent server capability without tag calls and supports a narrow panel with native keyboard controls', async () => {
        vi.mocked(Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientWidth')!.get!).mockReturnValue(320);
        const view = render(<UnifiedTodoTab owner={owner} />);
        await screen.findByTestId('sentinel-todo-row-item-one');
        expect(screen.getByTestId('sentinel-todo-tab').getAttribute('data-layout')).toBe('single');
        const user = userEvent.setup();
        screen.getByLabelText('Tag').focus();
        await user.keyboard('u');
        await user.tab();
        expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Manage tags' }));
        await user.keyboard('{Enter}');
        expect(screen.getByRole('dialog', { name: 'Manage tags' })).toBeTruthy();
        await user.keyboard('{Escape}');
        expect(screen.queryByRole('dialog', { name: 'Manage tags' })).toBeNull();
        expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Manage tags' }));
        snapshot = { ...snapshot, tagLibrary: undefined };
        act(() => events.refresh());
        await screen.findByText('Tags unavailable for this ledger.');
        expect((screen.getByRole('button', { name: 'Manage tags' }) as HTMLButtonElement).disabled).toBe(true);
        expect(api.getTags).not.toHaveBeenCalled();
        view.unmount();
    });

    it('keeps tag selections and text on item-revision conflicts until the user explicitly rebases tags', async () => {
        api.update.mockImplementationOnce(async () => {
            snapshot = { ...snapshot, items: [{ ...snapshot.items[0], revision: 5 }] };
            throw Object.assign(new Error('Conflict'), { status: 409 });
        });
        render(<UnifiedTodoTab owner={owner} />);
        await screen.findByTestId('sentinel-todo-row-item-one');
        const detail = selectItem();
        fireEvent.click(within(detail).getByRole('button', { name: 'Edit', exact: true }));
        fireEvent.change(within(detail).getByLabelText('Notes'), { target: { value: 'Unsaved notes' } });
        fireEvent.click(screen.getByRole('button', { name: 'Edit tags' }));
        fireEvent.click(screen.getByRole('button', { name: 'Clear tags' }));
        fireEvent.click(screen.getByRole('button', { name: 'Save tags' }));
        await screen.findByRole('button', { name: 'Use current revision for tags' });
        expect(api.update).toHaveBeenCalledTimes(1);
        expect((screen.getByRole('checkbox', { name: 'Interface' }) as HTMLInputElement).checked).toBe(false);
        expect((within(detail).getByLabelText('Notes') as HTMLInputElement).value).toBe('Unsaved notes');
        fireEvent.click(screen.getByRole('button', { name: 'Use current revision for tags' }));
        fireEvent.click(screen.getByRole('button', { name: 'Save tags' }));
        await waitFor(() => expect(api.update).toHaveBeenCalledTimes(2));
        expect(api.update.mock.calls[1][3]).toEqual({ expectedRevision: 5, expectedTagRevision: 0, tagIds: [] });
    });

    it('does not silently retarget a delete confirmation after another library update', async () => {
        render(<UnifiedTodoTab owner={owner} />);
        await screen.findByTestId('sentinel-todo-row-item-one');
        fireEvent.click(screen.getByRole('button', { name: 'Manage tags' }));
        fireEvent.click(screen.getByRole('button', { name: 'Delete tag Interface' }));
        snapshot = { ...snapshot, tagLibrary: { revision: 8, tags: [{ id: 'tag-ui', name: 'Renamed', color: 'blue' }] } };
        act(() => events.refresh());
        await screen.findByRole('button', { name: 'Delete tag Renamed' });
        expect((screen.getByRole('button', { name: 'Confirm delete' }) as HTMLButtonElement).disabled).toBe(true);
        expect(api.deleteTag).not.toHaveBeenCalled();
        fireEvent.click(screen.getByRole('button', { name: 'Cancel deletion' }));
        fireEvent.click(screen.getByRole('button', { name: 'Delete tag Renamed' }));
        fireEvent.click(screen.getByRole('button', { name: 'Confirm delete' }));
        await waitFor(() => expect(api.deleteTag).toHaveBeenCalledWith('ws-owner', 'queue_parent', 'tag-ui',
            { expectedRevision: 8, confirmed: true }));
    });

    it('detects tag-only conflicts independently of the authoritative item revision', async () => {
        api.update.mockImplementationOnce(async () => {
            snapshot = { ...snapshot, items: [{ ...snapshot.items[0], tagRevision: 6, tagIds: ['tag-docs'] }] };
            throw Object.assign(new Error('Tag conflict'), { status: 409 });
        });
        render(<UnifiedTodoTab owner={owner} />);
        await screen.findByTestId('sentinel-todo-row-item-one');
        selectItem();
        fireEvent.click(screen.getByRole('button', { name: 'Edit tags' }));
        fireEvent.click(screen.getByRole('button', { name: 'Clear tags' }));
        fireEvent.click(screen.getByRole('button', { name: 'Save tags' }));
        await screen.findByRole('button', { name: 'Use current revision for tags' });
        expect(api.update).toHaveBeenCalledTimes(1);
        expect(snapshot.items[0].revision).toBe(1);
        fireEvent.click(screen.getByRole('button', { name: 'Use current revision for tags' }));
        fireEvent.click(screen.getByRole('button', { name: 'Save tags' }));
        await waitFor(() => expect(api.update).toHaveBeenCalledTimes(2));
        expect(api.update.mock.calls[1][3]).toEqual({ expectedRevision: 1, expectedTagRevision: 6, tagIds: [] });
    });

    it('requires a fresh manual-override confirmation when only tags change', async () => {
        snapshot.items[0].tagOrigin = 'manual';
        render(<UnifiedTodoTab owner={owner} />);
        await screen.findByTestId('sentinel-todo-row-item-one');
        selectItem();
        fireEvent.click(screen.getByRole('button', { name: 'Re-suggest tags' }));
        snapshot = { ...snapshot, items: [{ ...snapshot.items[0], tagRevision: 7, tagIds: ['tag-docs'] }] };
        act(() => events.refresh());
        await screen.findByText(/Keep manual tags and request a new suggestion/);
        expect((screen.getByRole('button', { name: 'Confirm re-suggest' }) as HTMLButtonElement).disabled).toBe(true);
        expect(api.suggestTags).not.toHaveBeenCalled();
        fireEvent.click(screen.getByRole('button', { name: 'Keep manual tags' }));
        fireEvent.click(screen.getByRole('button', { name: 'Re-suggest tags' }));
        fireEvent.click(screen.getByRole('button', { name: 'Confirm re-suggest' }));
        await waitFor(() => expect(api.suggestTags).toHaveBeenCalledWith('ws-owner', 'queue_parent', 'item-one',
            { expectedRevision: 1, expectedTagRevision: 7, multiple: false, confirmed: true }));
    });

    it('retains manual tags and text when re-suggest fails and makes no subsequent calls after flag deactivation', async () => {
        snapshot.items[0].tagOrigin = 'manual';
        api.suggestTags.mockRejectedValueOnce(new Error('Classifier unavailable'));
        render(<UnifiedTodoTab owner={owner} />);
        await screen.findByTestId('sentinel-todo-row-item-one');
        const detail = selectItem();
        fireEvent.click(within(detail).getByRole('button', { name: 'Edit', exact: true }));
        fireEvent.change(within(detail).getByLabelText('Title'), { target: { value: 'Retained title' } });
        fireEvent.click(screen.getByRole('button', { name: 'Re-suggest tags' }));
        fireEvent.click(screen.getByRole('button', { name: 'Confirm re-suggest' }));
        await screen.findByRole('alert');
        expect(within(detail).getByText('Manual tags')).toBeTruthy();
        expect(within(detail).getByText('Interface')).toBeTruthy();
        expect((within(detail).getByLabelText('Title') as HTMLInputElement).value).toBe('Retained title');
        act(() => applyRuntimeConfigPatch({ sentinelTodoTagsEnabled: false }));
        expect(screen.queryByRole('button', { name: 'Manage tags' })).toBeNull();
        expect(screen.queryByRole('button', { name: 'Re-suggest tags' })).toBeNull();
        expect(api.suggestTags).toHaveBeenCalledTimes(1);
        expect((within(detail).getByLabelText('Title') as HTMLInputElement).value).toBe('Retained title');
    });

    it('only opts new item matching into multiple mode when enabled and selected', async () => {
        api.create.mockResolvedValue({});
        render(<UnifiedTodoTab owner={owner} />);
        await screen.findByTestId('sentinel-todo-row-item-one');
        fireEvent.click(screen.getByTestId('sentinel-todo-add'));
        const first = screen.getByTestId('sentinel-todo-add-form');
        fireEvent.change(within(first).getByLabelText('Title'), { target: { value: 'First item' } });
        fireEvent.click(within(first).getByRole('button', { name: 'Add', exact: true }));
        await waitFor(() => expect(api.create).toHaveBeenCalledTimes(1));
        expect(api.create.mock.calls[0][2]).not.toHaveProperty('matchMultiple');
        await waitFor(() => expect(screen.queryByTestId('sentinel-todo-add-form')).toBeNull());
        fireEvent.click(screen.getByRole('checkbox', { name: 'Match multiple tags' }));
        fireEvent.click(screen.getByTestId('sentinel-todo-add'));
        const second = screen.getByTestId('sentinel-todo-add-form');
        fireEvent.change(within(second).getByLabelText('Title'), { target: { value: 'Second item' } });
        fireEvent.click(within(second).getByRole('button', { name: 'Add', exact: true }));
        await waitFor(() => expect(api.create).toHaveBeenCalledTimes(2));
        expect(api.create.mock.calls[1][2].matchMultiple).toBe(true);
        const detail = selectItem();
        fireEvent.click(within(detail).getByRole('button', { name: 'Edit', exact: true }));
        fireEvent.change(within(detail).getByLabelText('Notes'), { target: { value: 'Revised text for matching' } });
        fireEvent.click(within(detail).getByRole('button', { name: 'Save', exact: true }));
        await waitFor(() => expect(api.update).toHaveBeenCalledTimes(1));
        expect(api.update.mock.calls[0][3].matchMultiple).toBe(true);
    });
});
