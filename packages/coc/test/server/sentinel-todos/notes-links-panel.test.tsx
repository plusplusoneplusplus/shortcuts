/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { SentinelTodoItem, SentinelTodoLedgerResponse } from '@plusplusoneplusplus/coc-client';

const { api, client, panelBrowser } = vi.hoisted(() => {
    const api = { get: vi.fn(), create: vi.fn(), update: vi.fn(), connect: vi.fn() };
    return { api, client: { sentinelTodos: api, events: { connect: api.connect } }, panelBrowser: vi.fn() };
});
vi.mock('../../../src/server/spa/client/react/repos/cloneRouting', () => ({ useCocClient: () => client }));
vi.mock('../../../src/server/spa/client/react/repos/cloneRegistry', async importOriginal => ({
    ...(await importOriginal<object>()),
    getCocClientForWorkspace: () => client,
}));
vi.mock('../../../src/server/spa/client/react/shared/file-path/browser-bridge', () => ({
    requestPanelBrowserTab: panelBrowser,
}));
vi.mock('../../../src/server/spa/client/react/features/repo-detail/unified-right-panel/SentinelTodoScrubber', () => ({
    SentinelTodoScrubber: ({ toolbar, children }: { toolbar: React.ReactNode; children: React.ReactNode | ((scrubber: React.ReactNode) => React.ReactNode) }) =>
        <>{toolbar}{typeof children === 'function' ? children(null) : children}</>,
}));
vi.mock('../../../src/server/spa/client/react/features/repo-detail/unified-right-panel/SentinelTodoScrubFinding', async importOriginal => ({
    ...(await importOriginal<object>()),
    AcceptAllScrubProposals: () => null, SentinelTodoScrubFinding: () => null,
}));
vi.mock('../../../src/server/spa/client/react/features/repo-detail/unified-right-panel/SentinelTodoTriggers', () => ({ SentinelTodoTriggers: () => null }));
vi.mock('../../../src/server/spa/client/react/features/repo-detail/unified-right-panel/SentinelTodoDependencies', () => ({ SentinelTodoDependencies: () => null }));
vi.mock('../../../src/server/spa/client/react/features/repo-detail/unified-right-panel/SentinelTodoPrOutcomes', () => ({ SentinelTodoPrOutcomes: () => null }));

import { UnifiedTodoTab } from '../../../src/server/spa/client/react/features/repo-detail/unified-right-panel/UnifiedTodoTab';
import { sentinelTodoNotesHtml } from '../../../src/server/spa/client/react/features/repo-detail/unified-right-panel/SentinelTodoNotes';
import { clearSentinelTodoExcursion, getSentinelTodoExcursion } from '../../../src/server/spa/client/react/features/repo-detail/unified-right-panel/sentinelTodoExcursion';
import { applyRuntimeConfigPatch } from '../../../src/server/spa/client/react/utils/config';
import { buildRemoteCloneKey } from '../../../src/server/spa/client/react/repos/cloneIdentity';

const owner = { ownerWorkspaceId: 'ws-owner', processId: 'queue_parent', ownerRoutingRef: null };
const remoteOwner = { ...owner, ownerRoutingRef: buildRemoteCloneKey('srv-b', 'ws-owner') };
function item(notes: string): SentinelTodoItem {
    return { id: 'item-one', title: 'First task', type: 'normal', priority: 'regular', status: 'todo',
        completionCondition: 'Review complete', notes, revision: 1, archived: false, jobs: [],
        createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z', createdBy: 'user', updatedBy: 'user' };
}
let snapshot: SentinelTodoLedgerResponse;
async function openDetail(notes: string, props: Partial<Parameters<typeof UnifiedTodoTab>[0]> = {}, parentClick = () => {}) {
    snapshot = { revision: 1, items: [item(notes)] };
    render(<div onClick={parentClick}><UnifiedTodoTab owner={owner} {...props} /></div>);
    fireEvent.click((await screen.findByTestId('sentinel-todo-row-item-one')).querySelector('[data-todo-select]')!);
    const detail = screen.getByTestId('sentinel-todo-detail-item-one');
    return { detail, notes: within(detail).getByTestId('sentinel-todo-notes-item-one') };
}
beforeEach(() => {
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(800);
    clearSentinelTodoExcursion();
    Object.values(api).forEach(mock => mock.mockReset());
    panelBrowser.mockReset().mockReturnValue(false);
    api.connect.mockReturnValue({ close: vi.fn() });
    applyRuntimeConfigPatch({ sentinelTodoExternalReferencesEnabled: false, sentinelTodoTagsEnabled: false, sessionContextAttachmentsEnabled: false });
    api.get.mockImplementation(async () => snapshot);
    api.update.mockImplementation(async (_ws, _parent, id, patch) => {
        snapshot = { revision: snapshot.revision + 1, items: snapshot.items.map(current => current.id === id
            ? { ...current, revision: current.revision + 1, ...(patch.notes !== undefined ? { notes: patch.notes } : {}) } : current) };
        return { ledgerRevision: snapshot.revision, item: snapshot.items.find(current => current.id === id) };
    });
});
afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    window.location.hash = '';
});

describe('Sentinel To-do notes Markdown links', () => {
    it('renders [label](url) as a new-tab link inside the raw text layout', async () => {
        const { notes } = await openDetail('See [the spec](https://docs.example.test/spec) first.\nThen *ship* `it`.');
        const link = within(notes).getByRole('link', { name: 'the spec' });
        expect(link.getAttribute('href')).toBe('https://docs.example.test/spec');
        expect(link.getAttribute('target')).toBe('_blank');
        expect(link.getAttribute('rel')).toBe('noopener noreferrer');
        expect(notes.className).toContain('whitespace-pre-wrap');
        expect(notes.textContent).toBe('See the spec first.\nThen ship it.');
    });

    it('keeps plain notes exactly as written with no links', async () => {
        const text = 'Tried forcing LF.\nDid not help <on> cached & runners.\n';
        const { notes } = await openDetail(text);
        expect(within(notes).queryByRole('link')).toBeNull();
        expect(notes.textContent).toBe(text);
    });

    it('opens http links in the panel browser without selecting, toggling or editing the item', async () => {
        panelBrowser.mockReturnValue(true);
        const parentClick = vi.fn();
        const { detail, notes } = await openDetail('[spec](https://docs.example.test/spec)', {}, parentClick);
        parentClick.mockClear();
        const event = new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 });
        within(notes).getByRole('link', { name: 'spec' }).dispatchEvent(event);
        expect(panelBrowser).toHaveBeenCalledWith('https://docs.example.test/spec');
        expect(event.defaultPrevented).toBe(true);
        expect(parentClick).not.toHaveBeenCalled();
        expect(within(detail).queryByTestId('sentinel-todo-edit-form-item-one')).toBeNull();
        expect(within(detail).getByRole('button', { name: 'Edit', exact: true })).toBeTruthy();
    });

    it('leaves modified clicks to the browser', async () => {
        panelBrowser.mockReturnValue(true);
        const { notes } = await openDetail('[spec](https://docs.example.test/spec)');
        const event = new MouseEvent('click', { bubbles: true, cancelable: true, button: 0, ctrlKey: true });
        within(notes).getByRole('link', { name: 'spec' }).dispatchEvent(event);
        expect(panelBrowser).not.toHaveBeenCalled();
    });

    it('follows in-app chat links with a way back', async () => {
        const { notes } = await openDetail('Ask in [that chat](#repos/ws-other/chats/queue_ref).',
            { scopeWorkspaceId: 'ws-owner', chatId: 'queue_parent' });
        const link = within(notes).getByRole('link', { name: 'that chat' });
        expect(link.getAttribute('data-todo-link')).toBe('item-one|note:0');
        fireEvent.click(link);
        await waitFor(() => expect(window.location.hash).toBe('#repos/ws-other/chats/queue_ref'));
        expect(getSentinelTodoExcursion()?.origin).toMatchObject({ chatId: 'queue_parent', linkKey: 'item-one|note:0' });
    });

    it('blocks unsafe schemes and raw HTML', async () => {
        const { notes } = await openDetail('[x](javascript:alert(1)) [d](data:text/html,hi) <img src=x onerror="alert(1)"><script>alert(2)</script>');
        expect(notes.querySelector('img, script')).toBeNull();
        expect([...notes.querySelectorAll('a')].map(a => a.getAttribute('href'))).toEqual(['#', '#']);
        expect(notes.textContent).toContain('<img src=x onerror="alert(1)">');
        const event = new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 });
        within(notes).getByRole('link', { name: 'x' }).dispatchEvent(event);
        expect(event.defaultPrevented).toBe(true);
    });

    it('round-trips the raw Markdown through Edit', async () => {
        const raw = 'See [the spec](https://docs.example.test/spec).';
        const { detail } = await openDetail(raw);
        fireEvent.click(within(detail).getByRole('button', { name: 'Edit', exact: true }));
        const textarea = within(detail).getByLabelText('Notes') as HTMLTextAreaElement;
        expect(textarea.value).toBe(raw);
        fireEvent.change(textarea, { target: { value: `${raw}\nAlso [PR](https://github.com/o/r/pull/1)` } });
        fireEvent.click(within(detail).getByRole('button', { name: 'Save', exact: true }));
        await waitFor(() => expect(api.update).toHaveBeenCalledTimes(1));
        expect(api.update.mock.calls[0][3]).toMatchObject({ notes: `${raw}\nAlso [PR](https://github.com/o/r/pull/1)` });
        const notes = await within(detail).findByTestId('sentinel-todo-notes-item-one');
        await waitFor(() => expect(within(notes).getByRole('link', { name: 'PR' })).toBeTruthy());
    });
});

describe('sentinelTodoNotesHtml owner routing', () => {
    it('leaves local-owner repo links unchanged', () => {
        expect(sentinelTodoNotesHtml('[c](#repos/ws-other/chats/p1)', owner, 'i1'))
            .toContain('href="#repos/ws-other/chats/p1"');
    });

    it('qualifies bare repo links with the remote owner server only', () => {
        const qualified = `#repos/${encodeURIComponent(buildRemoteCloneKey('srv-b', 'ws-other'))}/chats/p1`;
        expect(sentinelTodoNotesHtml('[c](#repos/ws-other/chats/p1)', remoteOwner, 'i1')).toContain(`href="${qualified}"`);
        expect(sentinelTodoNotesHtml(`[c](${qualified})`, remoteOwner, 'i1')).toContain(`href="${qualified}"`);
        const other = `#repos/${encodeURIComponent(buildRemoteCloneKey('srv-c', 'ws-x'))}/chats/p2`;
        expect(sentinelTodoNotesHtml(`[c](${other})`, remoteOwner, 'i1')).toContain(`href="${other}"`);
        expect(sentinelTodoNotesHtml('[c](#chat-references/srv-c/ws-x/p3)', remoteOwner, 'i1'))
            .toContain('href="#chat-references/srv-c/ws-x/p3"');
        expect(sentinelTodoNotesHtml('[c](https://example.test/a)', remoteOwner, 'i1')).toContain('href="https://example.test/a"');
    });

    it('escapes the item id in link keys', () => {
        expect(sentinelTodoNotesHtml('[c](https://example.test)', owner, 'a"b<c'))
            .toContain('data-todo-link="a&quot;b&lt;c|note:0"');
    });
});
