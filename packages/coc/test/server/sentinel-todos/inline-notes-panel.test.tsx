/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { SentinelTodoItem, SentinelTodoLedgerResponse } from '@plusplusoneplusplus/coc-client';

const { api, client, panelBrowser, clientRefs } = vi.hoisted(() => {
    const api = { get: vi.fn(), create: vi.fn(), update: vi.fn(), connect: vi.fn() };
    return { api, client: { sentinelTodos: api, events: { connect: api.connect } }, panelBrowser: vi.fn(), clientRefs: [] as unknown[] };
});
vi.mock('../../../src/server/spa/client/react/repos/cloneRouting', () => ({
    useCocClient: (ref: unknown) => { clientRefs.push(ref); return client; },
}));
vi.mock('../../../src/server/spa/client/react/repos/cloneRegistry', async importOriginal => ({
    ...(await importOriginal<object>()),
    getCocClientForWorkspace: () => client,
}));
vi.mock('../../../src/server/spa/client/react/shared/file-path/browser-bridge', () => ({
    requestPanelBrowserTab: panelBrowser,
}));
vi.mock('../../../src/server/spa/client/react/features/repo-detail/unified-right-panel/SentinelCoda', () => ({
    SentinelCoda: ({ toolbar, children }: { toolbar: React.ReactNode; children: React.ReactNode | ((scrubber: React.ReactNode) => React.ReactNode) }) =>
        <>{toolbar}{typeof children === 'function' ? children(null) : children}</>,
}));
vi.mock('../../../src/server/spa/client/react/features/repo-detail/unified-right-panel/SentinelCodaFinding', async importOriginal => ({
    ...(await importOriginal<object>()),
    AcceptAllCodaProposals: () => null, SentinelCodaFinding: () => null,
}));
vi.mock('../../../src/server/spa/client/react/features/repo-detail/unified-right-panel/SentinelOvertures', () => ({ SentinelOvertures: () => null }));
vi.mock('../../../src/server/spa/client/react/features/repo-detail/unified-right-panel/SentinelTodoDependencies', () => ({ SentinelTodoDependencies: () => null }));
vi.mock('../../../src/server/spa/client/react/features/repo-detail/unified-right-panel/SentinelTodoPrOutcomes', () => ({ SentinelTodoPrOutcomes: () => null }));

import { UnifiedTodoTab } from '../../../src/server/spa/client/react/features/repo-detail/unified-right-panel/UnifiedTodoTab';
import { clearSentinelTodoExcursion } from '../../../src/server/spa/client/react/features/repo-detail/unified-right-panel/sentinelTodoExcursion';
import { applyRuntimeConfigPatch } from '../../../src/server/spa/client/react/utils/config';
import { buildRemoteCloneKey } from '../../../src/server/spa/client/react/repos/cloneIdentity';
import { registerCloneBaseUrls, resetCloneRegistryForTests } from '../../../src/server/spa/client/react/repos/cloneRegistry';

let ownerSeq = 0;
/** A fresh owner per test: remembered drafts are owner-scoped in-memory view state. */
function makeOwner(routing: string | null = null) {
    const processId = `queue_parent_${++ownerSeq}`;
    return { ownerWorkspaceId: 'ws-owner', processId, ownerRoutingRef: routing };
}
function item(id: string, notes: string, extra: Partial<SentinelTodoItem> = {}): SentinelTodoItem {
    return { id, title: `Task ${id}`, type: 'normal', priority: 'regular', status: 'todo',
        completionCondition: 'Review complete', notes, revision: 1, archived: false, jobs: [],
        createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z', createdBy: 'user', updatedBy: 'user', ...extra };
}
let snapshot: SentinelTodoLedgerResponse;
function edit(id: string, change: Partial<SentinelTodoItem>) {
    snapshot = { revision: snapshot.revision + 1, items: snapshot.items.map(current => current.id === id
        ? { ...current, ...change, revision: current.revision + 1 } : current) };
}
async function select(id: string) {
    fireEvent.click((await screen.findByTestId(`sentinel-todo-row-${id}`)).querySelector('[data-todo-select]')!);
    return screen.getByTestId(`sentinel-todo-detail-${id}`);
}
async function openDetail(items: SentinelTodoItem[], owner = makeOwner()) {
    snapshot = { revision: 1, items };
    const view = render(<UnifiedTodoTab owner={owner} />);
    const detail = await select(items[0].id);
    return { detail, owner, view };
}
const editor = (detail: HTMLElement) => within(detail).getByLabelText('Notes') as HTMLTextAreaElement;
const conflictError = () => Object.assign(new Error('conflict'), { status: 409, code: 'conflict' });

beforeEach(() => {
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(800);
    clearSentinelTodoExcursion();
    clientRefs.length = 0;
    Object.values(api).forEach(mock => mock.mockReset());
    panelBrowser.mockReset().mockReturnValue(false);
    api.connect.mockReturnValue({ close: vi.fn() });
    applyRuntimeConfigPatch({ sentinelTodoInlineNotesEnabled: true, sentinelTodoExternalReferencesEnabled: false, sessionContextAttachmentsEnabled: false });
    api.get.mockImplementation(async () => snapshot);
    api.update.mockImplementation(async (_ws, _parent, id, patch) => {
        const current = snapshot.items.find(candidate => candidate.id === id)!;
        if (patch.expectedRevision !== current.revision) throw conflictError();
        edit(id, patch.notes !== undefined ? { notes: patch.notes } : {});
        return { ledgerRevision: snapshot.revision, item: snapshot.items.find(candidate => candidate.id === id) };
    });
});
afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    resetCloneRegistryForTests();
    applyRuntimeConfigPatch({ sentinelTodoInlineNotesEnabled: false });
    window.location.hash = '';
});

describe('Sentinel To-do inline Notes editing', () => {
    it('is hidden while the feature flag is off', async () => {
        applyRuntimeConfigPatch({ sentinelTodoInlineNotesEnabled: false });
        const { detail } = await openDetail([item('a', 'Some notes'), item('b', '')]);
        expect(within(detail).queryByRole('button', { name: 'Edit notes' })).toBeNull();
        fireEvent.click(within(detail).getByTestId('sentinel-todo-notes-a'));
        expect(within(detail).queryByLabelText('Notes')).toBeNull();
        const empty = await select('b');
        expect(within(empty).queryByRole('button', { name: 'Add notes' })).toBeNull();
    });

    it('opens the editor from a click on the note text with the current text and saves only notes with Ctrl+Enter', async () => {
        const { detail, owner } = await openDetail([item('a', 'Line one\nLine two')]);
        fireEvent.click(within(detail).getByTestId('sentinel-todo-notes-a'));
        const textarea = editor(detail);
        expect(textarea.value).toBe('Line one\nLine two');
        expect(document.activeElement).toBe(textarea);
        expect(textarea.rows).toBeGreaterThanOrEqual(6);
        expect(within(detail).queryByRole('button', { name: 'Organize notes' })).toBeNull();

        fireEvent.change(textarea, { target: { value: 'Line one\nLine two\nLine three' } });
        fireEvent.keyDown(textarea, { key: 'Enter' });
        fireEvent.blur(textarea);
        expect(api.update).not.toHaveBeenCalled();

        fireEvent.keyDown(textarea, { key: 'Enter', ctrlKey: true });
        await waitFor(() => expect(api.update).toHaveBeenCalledTimes(1));
        expect(api.update.mock.calls[0]).toEqual([owner.ownerWorkspaceId, owner.processId, 'a',
            { expectedRevision: 1, notes: 'Line one\nLine two\nLine three' }]);
        await waitFor(() => expect(within(detail).queryByLabelText('Notes')).toBeNull());
        expect(within(detail).getByTestId('sentinel-todo-notes-a').textContent).toBe('Line one\nLine two\nLine three');
        expect(within(detail).getByRole('status').textContent).toBe('Notes saved.');
        expect(document.activeElement).toBe(within(detail).getByRole('button', { name: 'Edit notes' }));
        expect(within(detail).getByRole('button', { name: 'Organize notes' })).toBeTruthy();
    });

    it('saves with Cmd+Enter and the Save button, and closes without a request when unchanged', async () => {
        const { detail } = await openDetail([item('a', 'Keep')]);
        fireEvent.click(within(detail).getByRole('button', { name: 'Edit notes' }));
        fireEvent.keyDown(editor(detail), { key: 'Enter', metaKey: true });
        await waitFor(() => expect(within(detail).queryByLabelText('Notes')).toBeNull());
        expect(api.update).not.toHaveBeenCalled();

        fireEvent.click(within(detail).getByRole('button', { name: 'Edit notes' }));
        fireEvent.change(editor(detail), { target: { value: 'Changed' } });
        fireEvent.click(within(detail).getByRole('button', { name: 'Save' }));
        await waitFor(() => expect(api.update).toHaveBeenCalledTimes(1));
        expect(api.update.mock.calls[0][3]).toEqual({ expectedRevision: 1, notes: 'Changed' });
    });

    it('cancels with the Cancel button or Escape, asking before Escape discards changes', async () => {
        const confirm = vi.spyOn(window, 'confirm');
        const { detail } = await openDetail([item('a', 'Original')]);
        fireEvent.click(within(detail).getByRole('button', { name: 'Edit notes' }));
        fireEvent.keyDown(editor(detail), { key: 'Escape' });
        expect(confirm).not.toHaveBeenCalled();
        expect(within(detail).queryByLabelText('Notes')).toBeNull();

        fireEvent.click(within(detail).getByRole('button', { name: 'Edit notes' }));
        fireEvent.change(editor(detail), { target: { value: 'Draft' } });
        confirm.mockReturnValueOnce(false);
        fireEvent.keyDown(editor(detail), { key: 'Escape' });
        expect(confirm).toHaveBeenCalledTimes(1);
        expect(editor(detail).value).toBe('Draft');
        confirm.mockReturnValueOnce(true);
        fireEvent.keyDown(editor(detail), { key: 'Escape' });
        expect(within(detail).queryByLabelText('Notes')).toBeNull();

        fireEvent.click(within(detail).getByRole('button', { name: 'Edit notes' }));
        expect(editor(detail).value).toBe('Original');
        fireEvent.change(editor(detail), { target: { value: 'Draft 2' } });
        fireEvent.click(within(detail).getByRole('button', { name: 'Cancel' }));
        expect(within(detail).queryByLabelText('Notes')).toBeNull();
        expect(within(detail).getByTestId('sentinel-todo-notes-a').textContent).toBe('Original');
        expect(api.update).not.toHaveBeenCalled();
    });

    it('follows links and keeps selected text without entering edit mode', async () => {
        panelBrowser.mockReturnValue(true);
        const { detail } = await openDetail([item('a', 'See [spec](https://docs.example.test/spec) and [chat](#repos/ws-o/chats/q1).')]);
        const notes = within(detail).getByTestId('sentinel-todo-notes-a');
        fireEvent.click(within(notes).getByRole('link', { name: 'spec' }));
        expect(panelBrowser).toHaveBeenCalledWith('https://docs.example.test/spec');
        fireEvent.click(within(notes).getByRole('link', { name: 'chat' }));
        await waitFor(() => expect(window.location.hash).toBe('#repos/ws-o/chats/q1'));
        expect(within(detail).queryByLabelText('Notes')).toBeNull();

        const range = document.createRange();
        range.selectNodeContents(notes);
        document.getSelection()!.removeAllRanges();
        document.getSelection()!.addRange(range);
        fireEvent.click(notes);
        expect(within(detail).queryByLabelText('Notes')).toBeNull();
        document.getSelection()!.removeAllRanges();
        fireEvent.click(notes);
        expect(editor(detail).value).toContain('[spec](https://docs.example.test/spec)');
    });

    it('adds notes to an empty manual item', async () => {
        const { detail } = await openDetail([item('m', '', { type: 'manual' })]);
        fireEvent.click(within(detail).getByRole('button', { name: 'Add notes' }));
        expect(editor(detail).value).toBe('');
        fireEvent.change(editor(detail), { target: { value: 'First note' } });
        fireEvent.keyDown(editor(detail), { key: 'Enter', ctrlKey: true });
        await waitFor(() => expect(api.update).toHaveBeenCalledTimes(1));
        expect(api.update.mock.calls[0][3]).toEqual({ expectedRevision: 1, notes: 'First note' });
        expect(await within(detail).findByTestId('sentinel-todo-notes-m')).toBeTruthy();
    });

    it('offers no editing on archived items', async () => {
        snapshot = { revision: 1, items: [item('x', 'Old notes', { archived: true }), item('y', '', { archived: true })] };
        render(<UnifiedTodoTab owner={makeOwner()} />);
        fireEvent.click(await screen.findByRole('button', { name: /^Archived/ }));
        const detail = await select('x');
        expect(within(detail).queryByRole('button', { name: 'Edit notes' })).toBeNull();
        expect(within(detail).queryByTestId('sentinel-todo-notes-editable')).toBeNull();
        fireEvent.click(within(detail).getByTestId('sentinel-todo-notes-x'));
        expect(within(detail).queryByLabelText('Notes')).toBeNull();
        const empty = await select('y');
        expect(within(empty).queryByRole('button', { name: 'Add notes' })).toBeNull();
    });

    it('keeps the draft and shows an inline error when a save fails, then retries', async () => {
        const { detail } = await openDetail([item('a', 'Before')]);
        fireEvent.click(within(detail).getByRole('button', { name: 'Edit notes' }));
        fireEvent.change(editor(detail), { target: { value: 'After' } });
        api.update.mockRejectedValueOnce(Object.assign(new Error('disk full'), { status: 500 }));
        fireEvent.click(within(detail).getByRole('button', { name: 'Save' }));
        expect((await within(detail).findByTestId('sentinel-todo-notes-error-a')).textContent).toContain('disk full');
        expect(within(detail).queryByTestId('sentinel-todo-row-error-a')).toBeNull();
        expect(editor(detail).value).toBe('After');
        fireEvent.click(within(detail).getByRole('button', { name: 'Save' }));
        await waitFor(() => expect(within(detail).queryByLabelText('Notes')).toBeNull());
        expect(api.update.mock.calls[1][3]).toEqual({ expectedRevision: 1, notes: 'After' });
    });

    it('surfaces a notes conflict without overwriting and saves only after the user keeps the draft', async () => {
        const { detail } = await openDetail([item('a', 'Shared')]);
        fireEvent.click(within(detail).getByRole('button', { name: 'Edit notes' }));
        fireEvent.change(editor(detail), { target: { value: 'Mine' } });
        edit('a', { notes: 'Theirs' });
        fireEvent.click(within(detail).getByRole('button', { name: 'Save' }));
        const conflict = await within(detail).findByTestId('sentinel-todo-notes-conflict-a');
        expect(within(conflict).getByTestId('sentinel-todo-notes-latest-a').textContent).toBe('Theirs');
        expect(editor(detail).value).toBe('Mine');
        expect(within(detail).getByRole('button', { name: 'Save' })).toHaveProperty('disabled', true);
        expect(api.update).toHaveBeenCalledTimes(1);
        expect(snapshot.items[0].notes).toBe('Theirs');

        fireEvent.click(within(conflict).getByRole('button', { name: 'Keep my draft' }));
        expect(within(detail).queryByTestId('sentinel-todo-notes-conflict-a')).toBeNull();
        fireEvent.click(within(detail).getByRole('button', { name: 'Save' }));
        await waitFor(() => expect(api.update).toHaveBeenCalledTimes(2));
        expect(api.update.mock.calls[1][3]).toEqual({ expectedRevision: 2, notes: 'Mine' });
    });

    it('shows a background notes change while editing and can replace the draft with the latest', async () => {
        const { detail } = await openDetail([item('a', 'Shared')]);
        fireEvent.click(within(detail).getByRole('button', { name: 'Edit notes' }));
        fireEvent.change(editor(detail), { target: { value: 'Mine' } });
        edit('a', { notes: 'Organized' });
        fireEvent.click(screen.getByRole('button', { name: 'Refresh to-do list' }));
        const conflict = await within(detail).findByTestId('sentinel-todo-notes-conflict-a');
        expect(editor(detail).value).toBe('Mine');
        fireEvent.click(within(conflict).getByRole('button', { name: 'Use latest' }));
        expect(editor(detail).value).toBe('Organized');
        expect(api.update).not.toHaveBeenCalled();
    });

    it('saves over a background change to other fields without touching them', async () => {
        const { detail } = await openDetail([item('a', 'Shared')]);
        fireEvent.click(within(detail).getByRole('button', { name: 'Edit notes' }));
        fireEvent.change(editor(detail), { target: { value: 'Mine' } });
        edit('a', { status: 'in_progress' });
        fireEvent.click(screen.getByRole('button', { name: 'Refresh to-do list' }));
        await waitFor(() => expect(api.get).toHaveBeenCalledTimes(2));
        await act(async () => {});
        expect(within(detail).queryByTestId('sentinel-todo-notes-conflict-a')).toBeNull();
        fireEvent.click(within(detail).getByRole('button', { name: 'Save' }));
        await waitFor(() => expect(api.update).toHaveBeenCalledTimes(1));
        expect(api.update.mock.calls[0][3]).toEqual({ expectedRevision: 2, notes: 'Mine' });
        await waitFor(() => expect(snapshot.items[0]).toMatchObject({ status: 'in_progress', notes: 'Mine' }));
    });

    it('blocks saving when the item is archived mid-edit and keeps the draft', async () => {
        const { detail } = await openDetail([item('a', 'Shared')]);
        fireEvent.click(within(detail).getByRole('button', { name: 'Edit notes' }));
        fireEvent.change(editor(detail), { target: { value: 'Mine' } });
        edit('a', { archived: true });
        fireEvent.click(screen.getByRole('button', { name: 'Refresh to-do list' }));
        await waitFor(() => expect(within(detail).getByRole('button', { name: 'Save' })).toHaveProperty('disabled', true));
        expect(within(detail).getByRole('alert').textContent).toContain('archived');
        expect(editor(detail).value).toBe('Mine');
        fireEvent.keyDown(editor(detail), { key: 'Enter', ctrlKey: true });
        expect(api.update).not.toHaveBeenCalled();
    });

    it('keeps each draft on its own item across selection changes and remounts', async () => {
        const owner = makeOwner();
        const { detail: first, view } = await openDetail([item('a', 'Alpha'), item('b', 'Beta')], owner);
        fireEvent.click(within(first).getByRole('button', { name: 'Edit notes' }));
        fireEvent.change(editor(first), { target: { value: 'Alpha draft' } });

        const second = await select('b');
        expect(within(second).queryByLabelText('Notes')).toBeNull();
        expect(within(second).getByRole('button', { name: 'Edit notes' })).toHaveProperty('disabled', false);

        view.unmount();
        render(<UnifiedTodoTab owner={owner} />);
        const restored = await select('a');
        expect(editor(restored).value).toBe('Alpha draft');
        fireEvent.keyDown(editor(restored), { key: 'Enter', ctrlKey: true });
        await waitFor(() => expect(api.update).toHaveBeenCalledTimes(1));
        expect(api.update.mock.calls[0].slice(0, 4)).toEqual([owner.ownerWorkspaceId, owner.processId, 'a',
            { expectedRevision: 1, notes: 'Alpha draft' }]);
        expect(snapshot.items.find(candidate => candidate.id === 'b')!.notes).toBe('Beta');
    });

    it('routes saves through the remote ledger owner', async () => {
        registerCloneBaseUrls([{ workspaceId: 'ws-owner', serverId: 'srv-b', baseUrl: 'https://owner.example' }]);
        const remote = makeOwner(buildRemoteCloneKey('srv-b', 'ws-owner'));
        const { detail } = await openDetail([item('a', 'Remote notes')], remote);
        expect(clientRefs).toContain(remote.ownerRoutingRef);
        fireEvent.click(within(detail).getByRole('button', { name: 'Edit notes' }));
        fireEvent.change(editor(detail), { target: { value: 'Remote edit' } });
        fireEvent.keyDown(editor(detail), { key: 'Enter', ctrlKey: true });
        await waitFor(() => expect(api.update).toHaveBeenCalledTimes(1));
        expect(api.update.mock.calls[0]).toEqual(['ws-owner', remote.processId, 'a', { expectedRevision: 1, notes: 'Remote edit' }]);
    });
});
