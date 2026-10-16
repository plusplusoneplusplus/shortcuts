/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { SentinelTodoExternalReference, SentinelTodoItem, SentinelTodoLedgerResponse } from '@plusplusoneplusplus/coc-client';

const { api, client, routes, panelBrowser } = vi.hoisted(() => {
    const api = { get: vi.fn(), create: vi.fn(), update: vi.fn(), connect: vi.fn() };
    return { api, client: { sentinelTodos: api, events: { connect: api.connect } },
        routes: [] as unknown[], panelBrowser: vi.fn() };
});
vi.mock('../../../src/server/spa/client/react/repos/cloneRouting', () => ({
    useCocClient: (reference: unknown) => { routes.push(reference); return client; },
}));
vi.mock('../../../src/server/spa/client/react/repos/cloneRegistry', async importOriginal => ({
    ...(await importOriginal<object>()),
    getCocClientForWorkspace: (reference: unknown) => { routes.push(reference); return client; },
}));
vi.mock('../../../src/server/spa/client/react/shared/file-path/browser-bridge', () => ({
    requestPanelBrowserTab: panelBrowser,
}));
vi.mock('../../../src/server/spa/client/react/features/repo-detail/unified-right-panel/SentinelTodoScrubber', () => ({
    SentinelTodoScrubber: ({ toolbar, children }: { toolbar: React.ReactNode; children: React.ReactNode }) => <>{toolbar}{children}</>,
}));
vi.mock('../../../src/server/spa/client/react/features/repo-detail/unified-right-panel/SentinelTodoScrubFinding', async importOriginal => ({
    ...(await importOriginal<object>()),
    AcceptAllScrubProposals: () => null, SentinelTodoScrubFinding: () => null,
}));
vi.mock('../../../src/server/spa/client/react/features/repo-detail/unified-right-panel/SentinelTodoTriggers', () => ({ SentinelTodoTriggers: () => null }));
vi.mock('../../../src/server/spa/client/react/features/repo-detail/unified-right-panel/SentinelTodoDependencies', () => ({ SentinelTodoDependencies: () => null }));
vi.mock('../../../src/server/spa/client/react/features/repo-detail/unified-right-panel/SentinelTodoPrOutcomes', () => ({ SentinelTodoPrOutcomes: () => null }));

import { UnifiedTodoTab } from '../../../src/server/spa/client/react/features/repo-detail/unified-right-panel/UnifiedTodoTab';
import { SentinelTodoExternalReferences } from '../../../src/server/spa/client/react/features/repo-detail/unified-right-panel/SentinelTodoExternalReferences';
import { clearSentinelTodoExcursion } from '../../../src/server/spa/client/react/features/repo-detail/unified-right-panel/sentinelTodoExcursion';
import { applyRuntimeConfigPatch } from '../../../src/server/spa/client/react/utils/config';
import { registerCloneBaseUrls, resetCloneRegistryForTests } from '../../../src/server/spa/client/react/repos/cloneRegistry';

const owner = { ownerWorkspaceId: 'ws-owner', processId: 'queue_parent', ownerRoutingRef: null };
const conversation = { processId: 'queue_ref', workspaceId: 'ws-other', openLink: '#repos/ws-other/chats/queue_ref',
    title: 'Related conversation', attachedAt: '2026-01-01T00:00:00Z', attachedBy: 'user' as const };
const links: SentinelTodoExternalReference[] = [
    { kind: 'pr', url: 'https://github.com/example/project/pull/42', title: 'Review change' },
    { kind: 'email', url: 'mailto:team@example.test', title: 'Discussion' },
    { kind: 'email', url: 'https://mail.example.test/thread/123' },
    { kind: 'link', url: 'https://docs.example.test/spec', title: 'Design' },
];
function item(extra: Partial<SentinelTodoItem> = {}): SentinelTodoItem {
    return { id: 'item-one', title: 'First task', type: 'normal', priority: 'regular', status: 'todo',
        completionCondition: 'Review complete', notes: '', revision: 1, archived: false, jobs: [],
        createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z', createdBy: 'user', updatedBy: 'user',
        references: [conversation, ...links], ...extra };
}
let snapshot: SentinelTodoLedgerResponse;
function select(id = 'item-one') {
    fireEvent.click(screen.getByTestId(`sentinel-todo-row-${id}`).querySelector('[data-todo-select]')!);
    return screen.getByTestId(`sentinel-todo-detail-${id}`);
}
function edit() {
    const detail = select();
    fireEvent.click(within(detail).getByRole('button', { name: 'Edit', exact: true }));
    return within(detail);
}
beforeEach(() => {
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(800);
    clearSentinelTodoExcursion();
    resetCloneRegistryForTests();
    routes.length = 0;
    Object.values(api).forEach(mock => mock.mockReset());
    panelBrowser.mockReset().mockReturnValue(false);
    api.connect.mockReturnValue({ close: vi.fn() });
    applyRuntimeConfigPatch({ sentinelTodoExternalReferencesEnabled: true, sentinelTodoTagsEnabled: false, sessionContextAttachmentsEnabled: false });
    snapshot = { revision: 1, items: [item()] };
    api.get.mockImplementation(async () => snapshot);
    api.update.mockImplementation(async (_ws, _parent, id, patch) => {
        snapshot = { revision: snapshot.revision + 1, items: snapshot.items.map(current => current.id === id
            ? { ...current, revision: current.revision + 1, ...(patch.title ? { title: patch.title } : {}),
                ...(patch.externalReferences ? { references: [
                    ...current.references!.filter(reference => !reference.kind || reference.kind === 'conversation'),
                    ...patch.externalReferences,
                ] } : {}) } : current) };
        return { ledgerRevision: snapshot.revision, item: snapshot.items.find(current => current.id === id) };
    });
});
afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    resetCloneRegistryForTests();
    applyRuntimeConfigPatch({ sentinelTodoExternalReferencesEnabled: false });
});

describe('Sentinel typed external references', () => {
    it('gates external display and editor live without hiding legacy conversations or sending untouched references', async () => {
        applyRuntimeConfigPatch({ sentinelTodoExternalReferencesEnabled: false });
        render(<UnifiedTodoTab owner={owner} />);
        await screen.findByTestId('sentinel-todo-row-item-one');
        const detail = edit();
        expect(screen.queryByText('External references')).toBeNull();
        expect(screen.queryByRole('link', { name: /Design/ })).toBeNull();
        expect(detail.getByRole('link', { name: 'Related conversation' }).getAttribute('href')).toBe(conversation.openLink);
        fireEvent.click(detail.getByRole('button', { name: 'Save', exact: true }));
        await waitFor(() => expect(api.update).toHaveBeenCalledTimes(1));
        expect(api.update.mock.calls[0][3]).not.toHaveProperty('externalReferences');
        act(() => applyRuntimeConfigPatch({ sentinelTodoExternalReferencesEnabled: true }));
        expect(within(screen.getByTestId('sentinel-todo-row-item-one')).getByRole('link', { name: 'Link Design' })).toBeTruthy();
    });

    it.each(['todo', 'in_progress', 'needs_attention', 'done', 'archived', 'manual'] as const)('shows safe type-aware native anchors for %s cards', async status => {
        snapshot.items = [item(status === 'archived' ? { archived: true } : status === 'manual' ? { type: 'manual' } : { status })];
        render(<UnifiedTodoTab owner={owner} />);
        await screen.findByTestId('sentinel-todo-tab');
        if (status === 'done' || status === 'archived') {
            await screen.findByRole('button', { name: `${status === 'done' ? 'Done' : 'Archived'} (1)`, exact: true });
            fireEvent.click(screen.getByRole('button', { name: `${status === 'done' ? 'Done' : 'Archived'} (1)`, exact: true }));
        }
        const row = await screen.findByTestId('sentinel-todo-row-item-one');
        const anchors = within(row).getAllByRole('link');
        expect(anchors).toHaveLength(4);
        const pr = within(row).getByRole('link', { name: 'PR GitHub · example/project #42' });
        expect(pr.getAttribute('href')).toBe(links[0].url);
        expect(pr.getAttribute('title')).toContain(links[0].url);
        expect(pr.getAttribute('rel')).toBe('noopener noreferrer');
        expect(pr.getAttribute('target')).toBe('_blank');
        fireEvent.click(pr, { ctrlKey: true });
        expect(panelBrowser).not.toHaveBeenCalled();
        expect(row.querySelector('[data-todo-select]')?.getAttribute('aria-pressed')).toBe('false');
    });

    it('rejects executable and relative URLs, isolates click/key events and preserves desktop and modified behavior', async () => {
        const onClick = vi.fn(), onKeyDown = vi.fn(), onKeyUp = vi.fn();
        const user = userEvent.setup();
        render(<div onClick={onClick} onKeyDown={onKeyDown} onKeyUp={onKeyUp}>
            <SentinelTodoExternalReferences item={item({ references: [...links,
                { kind: 'link', url: 'javascript:alert(1)' }, { kind: 'email', url: 'data:text/html,unsafe' },
                { kind: 'link', url: '/relative' }, { kind: 'link', url: 'mailto:team@example.test' }] })} />
        </div>);
        expect(screen.getAllByRole('link')).toHaveLength(4);
        const anchor = screen.getByRole('link', { name: 'Link Design' });
        anchor.focus();
        panelBrowser.mockReturnValue(true);
        await user.keyboard('{Enter}');
        expect(panelBrowser).toHaveBeenCalledWith(links[3].url);
        expect(onClick).not.toHaveBeenCalled();
        expect(onKeyDown).not.toHaveBeenCalled();
        expect(onKeyUp).not.toHaveBeenCalled();
        panelBrowser.mockClear();
        expect(fireEvent.click(anchor, { metaKey: true })).toBe(true);
        expect(fireEvent.click(screen.getByRole('link', { name: 'Email Discussion' }))).toBe(true);
        expect(panelBrowser).not.toHaveBeenCalled();
    });

    it('renders no empty reference placeholder', () => {
        const { container } = render(<SentinelTodoExternalReferences item={item({ references: [conversation] })} />);
        expect(container.innerHTML).toBe('');
    });

    it.each([
        ['https://dev.azure.com/example/project/_git/repo/pullrequest/17', 'Azure DevOps · example/project/repo #17'],
        ['https://example.visualstudio.com/project/_git/repo/pullrequest/18', 'Azure DevOps · example/project/repo #18'],
    ])('uses the shared provider parser on the card for %s', async (url, label) => {
        snapshot.items = [item({ references: [{ kind: 'pr', url, title: 'Review' }] })];
        render(<UnifiedTodoTab owner={owner} />);
        const row = await screen.findByTestId('sentinel-todo-row-item-one');
        const anchor = within(row).getByRole('link', { name: `PR ${label}` });
        expect(anchor.getAttribute('href')).toBe(url);
        expect(anchor.getAttribute('title')).toContain(url);
        const detail = select();
        expect(within(detail).getByRole('link', { name: `PR ${label}` }).getAttribute('href')).toBe(url);
    });

    it('omits unchanged external references after a reverted edit and preserves them when saving another field', async () => {
        render(<UnifiedTodoTab owner={owner} />);
        await screen.findByTestId('sentinel-todo-row-item-one');
        const detail = edit();
        fireEvent.change(detail.getByLabelText('Reference 1 URL'), { target: { value: 'https://github.com/example/project/pull/99' } });
        fireEvent.change(detail.getByLabelText('Reference 1 URL'), { target: { value: links[0].url } });
        fireEvent.change(detail.getByLabelText('Title'), { target: { value: 'Updated task' } });
        fireEvent.click(detail.getByRole('button', { name: 'Save', exact: true }));
        await waitFor(() => expect(api.update).toHaveBeenCalledTimes(1));
        expect(api.update.mock.calls[0][3]).not.toHaveProperty('externalReferences');
        expect(api.update.mock.calls[0][3].title).toBe('Updated task');
        await waitFor(() => expect(detail.queryByRole('button', { name: 'Save', exact: true })).toBeNull());
        expect(detail.getAllByRole('link')).toHaveLength(5);
    });

    it('edits, adds multiple types, removes and explicitly clears only external references in the existing save', async () => {
        render(<UnifiedTodoTab owner={owner} />);
        await screen.findByTestId('sentinel-todo-row-item-one');
        const detail = edit();
        fireEvent.change(detail.getByLabelText('Reference 1 URL'), { target: { value: 'https://github.com/example/project/pull/43' } });
        fireEvent.change(detail.getByLabelText('Reference 1 title (optional)'), { target: { value: 'New title' } });
        fireEvent.click(detail.getByRole('button', { name: 'Remove reference 3' }));
        for (const kind of ['pr', 'email', 'link']) {
            fireEvent.click(detail.getByRole('button', { name: 'Add reference' }));
            const index = detail.getAllByLabelText(/Reference \d+ URL/).length;
            fireEvent.change(detail.getByLabelText(`Reference ${index} type`), { target: { value: kind } });
            fireEvent.change(detail.getByLabelText(`Reference ${index} URL`), { target: { value: kind === 'email' ? 'mailto:other@example.test' : 'https://example.test/path' } });
        }
        fireEvent.click(detail.getByRole('button', { name: 'Save', exact: true }));
        await waitFor(() => expect(api.update).toHaveBeenCalledTimes(1));
        const patch = api.update.mock.calls[0][3];
        expect(patch.expectedRevision).toBe(1);
        expect(patch.externalReferences).toHaveLength(6);
        expect(patch.externalReferences[0]).toEqual({ kind: 'pr', url: 'https://github.com/example/project/pull/43', title: 'New title' });
        expect(patch).not.toHaveProperty('references');
        expect(patch).not.toHaveProperty('title');
        expect(patch).not.toHaveProperty('notes');
        expect(patch).not.toHaveProperty('completionCondition');
        expect(patch).not.toHaveProperty('priority');
        expect(Object.keys(patch).sort()).toEqual(['expectedRevision', 'externalReferences']);
        await waitFor(() => expect(detail.queryByRole('button', { name: 'Save', exact: true })).toBeNull());
        expect(detail.getByRole('link', { name: 'Related conversation' })).toBeTruthy();
        fireEvent.click(detail.getByRole('button', { name: 'Edit', exact: true }));
        while (detail.queryByRole('button', { name: 'Remove reference 1' })) fireEvent.click(detail.getByRole('button', { name: 'Remove reference 1' }));
        fireEvent.click(detail.getByRole('button', { name: 'Save', exact: true }));
        await waitFor(() => expect(api.update).toHaveBeenCalledTimes(2));
        expect(api.update.mock.calls[1][3].externalReferences).toEqual([]);
        expect(api.update.mock.calls[1][3]).not.toHaveProperty('title');
        await waitFor(() => expect(detail.queryByRole('button', { name: 'Save', exact: true })).toBeNull());
        expect(detail.getByRole('link', { name: 'Related conversation' })).toBeTruthy();
    });

    it('retains drafts through selection, remount, validation failures and CAS conflicts on a remote owner', async () => {
        registerCloneBaseUrls([{ cloneKey: 'remote:remote-server:ws-owner', workspaceId: 'ws-owner', baseUrl: 'https://remote.example.test' }]);
        const remote = { ...owner, ownerRoutingRef: 'remote:remote-server:ws-owner' };
        snapshot.items.push(item({ id: 'item-two', title: 'Second task' }));
        const mounted = render(<UnifiedTodoTab owner={remote} />);
        await screen.findByTestId('sentinel-todo-row-item-one');
        let detail = edit();
        fireEvent.change(detail.getByLabelText('Reference 1 URL'), { target: { value: 'https://github.com/example/project/pull/99' } });
        select('item-two');
        select();
        expect((detail.getByLabelText('Reference 1 URL') as HTMLInputElement).value).toContain('/99');
        mounted.unmount();
        render(<UnifiedTodoTab owner={remote} />);
        await screen.findByTestId('sentinel-todo-detail-item-one');
        detail = within(screen.getByTestId('sentinel-todo-detail-item-one'));
        expect((detail.getByLabelText('Reference 1 URL') as HTMLInputElement).value).toContain('/99');
        api.update.mockRejectedValueOnce(new Error('Invalid reference URL'));
        fireEvent.click(detail.getByRole('button', { name: 'Save', exact: true }));
        await detail.findByRole('alert');
        expect((detail.getByLabelText('Reference 1 URL') as HTMLInputElement).value).toContain('/99');
        const current = item({ revision: 4, title: 'Server revised task', notes: 'Server revised notes' });
        snapshot.items[0] = current;
        api.update.mockRejectedValueOnce(Object.assign(new Error('Changed'), { status: 409, body: { code: 'conflict', current } }));
        fireEvent.click(detail.getByRole('button', { name: 'Save', exact: true }));
        await waitFor(() => expect(detail.getByRole('alert').textContent).toContain('changed'));
        fireEvent.click(detail.getByRole('button', { name: 'Save', exact: true }));
        await waitFor(() => expect(api.update).toHaveBeenCalledTimes(3));
        expect(api.update.mock.calls[2].slice(0, 3)).toEqual(['ws-owner', 'queue_parent', 'item-one']);
        expect(api.update.mock.calls[2][3]).toMatchObject({ expectedRevision: 4, externalReferences: [{ ...links[0], url: 'https://github.com/example/project/pull/99' }, ...links.slice(1)] });
        expect(api.update.mock.calls[2][3]).not.toHaveProperty('title');
        expect(api.update.mock.calls[2][3]).not.toHaveProperty('notes');
        expect(routes.every(route => route === remote.ownerRoutingRef)).toBe(true);
    });

    it('bounds external reference field lengths and disables adding at the 20-reference limit', async () => {
        snapshot.items = [item({ references: Array.from({ length: 19 }, (_, index) =>
            ({ kind: 'link' as const, url: `https://example.test/${index}` })) })];
        render(<UnifiedTodoTab owner={owner} />);
        await screen.findByTestId('sentinel-todo-row-item-one');
        const detail = edit();
        expect(detail.getByLabelText('Reference 1 URL').getAttribute('maxlength')).toBe('2000');
        expect(detail.getByLabelText('Reference 1 title (optional)').getAttribute('maxlength')).toBe('200');
        const add = detail.getByRole('button', { name: 'Add reference' }) as HTMLButtonElement;
        expect(add.disabled).toBe(false);
        fireEvent.click(add);
        expect(detail.getAllByLabelText(/Reference \d+ URL/)).toHaveLength(20);
        expect(add.disabled).toBe(true);
        fireEvent.click(add);
        expect(detail.getAllByLabelText(/Reference \d+ URL/)).toHaveLength(20);
        fireEvent.click(detail.getByRole('button', { name: 'Remove reference 20' }));
        expect(add.disabled).toBe(false);
    });

    it('supports creation and keeps hidden drafts out of writes while the live gate is off', async () => {
        render(<UnifiedTodoTab owner={owner} />);
        await screen.findByTestId('sentinel-todo-row-item-one');
        fireEvent.click(screen.getByRole('button', { name: 'Add item', exact: true }));
        const form = within(screen.getByTestId('sentinel-todo-add-form'));
        fireEvent.change(form.getByLabelText('Title'), { target: { value: 'New task' } });
        fireEvent.click(form.getByRole('button', { name: 'Add reference' }));
        fireEvent.change(form.getByLabelText('Reference 1 URL'), { target: { value: 'https://example.test/new' } });
        api.create.mockRejectedValueOnce(new Error('Save failed')).mockResolvedValueOnce({});
        fireEvent.click(form.getByRole('button', { name: 'Add', exact: true }));
        await form.findByRole('alert');
        expect(api.create.mock.calls[0][2].externalReferences).toEqual([{ kind: 'link', url: 'https://example.test/new' }]);
        act(() => applyRuntimeConfigPatch({ sentinelTodoExternalReferencesEnabled: false }));
        fireEvent.click(form.getByRole('button', { name: 'Add', exact: true }));
        await waitFor(() => expect(api.create).toHaveBeenCalledTimes(2));
        expect(api.create.mock.calls[1][2]).not.toHaveProperty('externalReferences');
        expect(api.create.mock.calls[1][2].idempotencyKey).toBe(api.create.mock.calls[0][2].idempotencyKey);
    });
});
