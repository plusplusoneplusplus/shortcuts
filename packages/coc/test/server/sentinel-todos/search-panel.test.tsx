/**
 * UnifiedTodoTab search against a fake owning-server client: the search icon
 * and scoped Ctrl/Cmd+F, live filtering across the whole ledger (Done,
 * Archived, items past the recent page), safe highlights and excerpts, empty/
 * loading/error states, Escape restoring the previous view, read-only result
 * selection, bounded rendering, and owner isolation with stale responses.
 *
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, configure, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { SentinelTodoItem, SentinelTodoLedgerResponse } from '@plusplusoneplusplus/coc-client';

vi.mock('../../../src/server/spa/client/react/contexts/AppContext', () => ({ useAppOptional: () => null }));
vi.mock('../../../src/server/spa/client/react/contexts/ReposContext', () => ({
    useReposOptional: () => ({ repos: [], remoteGroupWorkspaces: [] }),
}));

configure({ asyncUtilTimeout: 5000 });

const get = vi.fn();
const update = vi.fn();
const create = vi.fn();
const connect = vi.fn();
const scrubGet = vi.fn();
const fakeClient = {
    sentinelTodos: {
        scrubber: { get: (...args: unknown[]) => scrubGet(...args), getRun: vi.fn(), accept: vi.fn() },
        get: (...args: unknown[]) => get(...args),
        create: (...args: unknown[]) => create(...args),
        update: (...args: unknown[]) => update(...args),
        evaluateDependencies: vi.fn(),
        listPrOutcomes: vi.fn(),
    },
    triggers: { listSentinelTodo: async () => [] },
    events: { connect: (...args: unknown[]) => connect(...args) },
};
vi.mock('../../../src/server/spa/client/react/repos/cloneRouting', () => ({ useCocClient: () => fakeClient }));
vi.mock('../../../src/server/spa/client/react/repos/cloneRegistry', async importOriginal => ({
    ...(await importOriginal<object>()),
    getCocClientForWorkspace: () => fakeClient,
}));

import { UnifiedTodoTab } from '../../../src/server/spa/client/react/features/repo-detail/unified-right-panel/UnifiedTodoTab';
import { clearSentinelTodoExcursion, recallSentinelTodoView } from '../../../src/server/spa/client/react/features/repo-detail/unified-right-panel/sentinelTodoExcursion';
import { applyRuntimeConfigPatch } from '../../../src/server/spa/client/react/utils/config';
import { resetCloneRegistryForTests } from '../../../src/server/spa/client/react/repos/cloneRegistry';

const OWNER = { ownerWorkspaceId: 'ws-1', processId: 'queue_sentinel' };

let seq = 0;
function item(overrides: Partial<SentinelTodoItem> = {}): SentinelTodoItem {
    seq += 1;
    const stamp = new Date(Date.UTC(2026, 9, 9, 0, 0, seq)).toISOString();
    return {
        id: `item-${seq}`, title: `Item ${seq}`, completionCondition: '', notes: '', status: 'todo', archived: false,
        revision: 1, createdAt: stamp, updatedAt: stamp, createdBy: 'sentinel', updatedBy: 'sentinel', jobs: [],
        type: 'normal', priority: 'regular', ...overrides,
    };
}

function ledger(items: SentinelTodoItem[], revision = items.length): SentinelTodoLedgerResponse {
    return { revision, items };
}

function deferred<T>() {
    let resolve!: (value: T) => void;
    let reject!: (error: Error) => void;
    const promise = new Promise<T>((r, j) => { resolve = r; reject = j; });
    return { promise, resolve, reject };
}

function pressFind(target: Element, modifier: 'ctrlKey' | 'metaKey' = 'ctrlKey'): boolean {
    const event = new KeyboardEvent('keydown', { key: 'f', [modifier]: true, bubbles: true, cancelable: true });
    act(() => { target.dispatchEvent(event); });
    return event.defaultPrevented;
}

const input = () => screen.getByTestId('sentinel-todo-search-input') as HTMLInputElement;
const type = (value: string) => fireEvent.change(input(), { target: { value } });
const rowIds = () => [...document.querySelectorAll<HTMLElement>('[data-testid^="sentinel-todo-row-"]')]
    .map(row => row.dataset.testid!.replace('sentinel-todo-row-', ''));
const openSearch = () => fireEvent.click(screen.getByRole('button', { name: 'Search to-do items' }));

beforeEach(() => {
    seq = 0;
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(800);
    // jsdom reports every element hidden; the find shortcut ignores hidden panels.
    vi.spyOn(HTMLElement.prototype, 'offsetParent', 'get').mockImplementation(function (this: HTMLElement) { return this.parentElement; });
    applyRuntimeConfigPatch({ sentinelTodoScrubberEnabled: false, sentinelTodoDependenciesEnabled: false, sentinelPrOutcomeWakeEnabled: false });
    resetCloneRegistryForTests();
    get.mockReset();
    update.mockReset();
    create.mockReset();
    scrubGet.mockReset();
    connect.mockReset().mockReturnValue({ close: vi.fn() });
    clearSentinelTodoExcursion();
});

afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
});

describe('UnifiedTodoTab search', () => {
    it('filters the whole ledger live, in list order, including Done, Archived and items past the recent page', async () => {
        const doneHistory = Array.from({ length: 60 }, (_, index) => item({ id: `done-${index}`, status: 'done', title: `Shipped ${index}` }));
        const oldArchived = item({ id: 'old', archived: true, title: 'Legacy', notes: 'The NEEDLE is here', updatedAt: '2020-01-01T00:00:00.000Z' });
        const active = item({ id: 'active', title: 'Find the needle' });
        const done = item({ id: 'done', status: 'done', title: 'Done thing', completionCondition: 'needle found' });
        const manual = item({ id: 'manual', type: 'manual', title: 'Manual needle' });
        get.mockResolvedValue(ledger([oldArchived, ...doneHistory, active, done, manual]));
        render(<UnifiedTodoTab owner={OWNER} />);
        await screen.findByTestId('sentinel-todo-row-active');
        expect(screen.queryByTestId('sentinel-todo-row-old')).toBeNull();

        openSearch();
        expect(document.activeElement).toBe(input());
        expect(screen.getByTestId('sentinel-todo-search-status').textContent).toBe('Searches all 64 items');
        type('needle');
        expect(rowIds()).toEqual(['active', 'manual', 'done', 'old']);
        expect(screen.getByTestId('sentinel-todo-search-status').textContent).toBe('4 matches');
        expect(within(screen.getByTestId('sentinel-todo-search-group-archived')).getByText('Archived (1)')).toBeTruthy();
        expect(screen.queryByTestId('sentinel-todo-show-older')).toBeNull();

        type('needle legacy');
        expect(rowIds()).toEqual(['old']);
        type('needle  found ');
        expect(rowIds()).toEqual(['done']);
        expect(screen.getByTestId('sentinel-todo-search-status').textContent).toBe('1 match');
        expect(update).not.toHaveBeenCalled();
        expect(create).not.toHaveBeenCalled();
    });

    it('highlights matches as plain text and excerpts the collapsed field that matched', async () => {
        get.mockResolvedValue(ledger([
            item({ id: 'html', title: '<img src=x onerror="alert(1)"> Deploy', notes: 'first line\nwatch the <b>deploy</b> gate' }),
            item({ id: 'cond', title: 'Other', completionCondition: 'Deploy finished' }),
        ]));
        const { container } = render(<UnifiedTodoTab owner={OWNER} />);
        await screen.findByTestId('sentinel-todo-row-html');
        openSearch();
        type('DEPLOY <b>');
        const row = screen.getByTestId('sentinel-todo-row-html');
        expect(container.querySelector('img, b')).toBeNull();
        // Title, then the excerpt, where adjacent `<b>` and `deploy` matches merge into one mark.
        expect([...row.querySelectorAll('mark')].map(mark => mark.textContent)).toEqual(['Deploy', '<b>deploy']);
        expect(within(row).getByRole('button', { pressed: false }).textContent).toContain('<img src=x onerror="alert(1)"> Deploy');
        const excerpt = screen.getByTestId('sentinel-todo-search-excerpt-html');
        expect(excerpt.textContent).toBe('Notes: first line watch the <b>deploy</b> gate');
        expect([...excerpt.querySelectorAll('mark')].map(mark => mark.textContent)).toEqual(['<b>deploy']);
        type('deploy');
        expect(screen.getByTestId('sentinel-todo-search-excerpt-cond').textContent).toBe('Done when: Deploy finished');
        expect(screen.getByTestId('sentinel-todo-row-cond').querySelector('mark')?.textContent).toBe('Deploy');
        type('other');
        expect(screen.queryByTestId('sentinel-todo-search-excerpt-cond')).toBeNull();
    });

    it('shows no-match, blank-query, loading and load-error states without reporting zero matches for failures', async () => {
        const read = deferred<SentinelTodoLedgerResponse>();
        get.mockReturnValueOnce(read.promise);
        const view = render(<UnifiedTodoTab owner={OWNER} />);
        openSearch();
        expect(screen.getByTestId('sentinel-todo-search-status').textContent).toBe('Loading to-do items…');
        await act(async () => read.resolve(ledger([item({ id: 'a', title: 'Alpha' })])));
        type('zeta');
        expect(screen.getByTestId('sentinel-todo-search-empty').textContent).toBe('No to-do items match “zeta”.');
        expect(screen.getByTestId('sentinel-todo-search-status').textContent).toBe('0 matches');
        type('   ');
        expect(screen.getByTestId('sentinel-todo-row-a')).toBeTruthy();
        expect(screen.queryByTestId('sentinel-todo-search-results')).toBeNull();
        view.unmount();

        get.mockRejectedValueOnce(new Error('server offline'));
        render(<UnifiedTodoTab owner={OWNER} />);
        openSearch();
        await screen.findByTestId('sentinel-todo-load-error');
        type('alpha');
        expect(screen.getByTestId('sentinel-todo-search-status').textContent).toBe('Search is unavailable until the list loads.');
        expect(screen.queryByTestId('sentinel-todo-search-empty')).toBeNull();
    });

    it('opens with Ctrl/Cmd+F only while focus is inside the panel, never from other surfaces or nested editors', async () => {
        get.mockResolvedValue(ledger([item({ id: 'a', title: 'Alpha' })]));
        const outside = document.createElement('button');
        const otherScope = document.createElement('div');
        otherScope.setAttribute('data-find-scope', '');
        const otherInput = document.createElement('input');
        otherScope.append(otherInput);
        document.body.append(outside, otherScope);
        render(<UnifiedTodoTab owner={OWNER} />);
        const row = await screen.findByTestId('sentinel-todo-row-a');

        expect(pressFind(outside)).toBe(false);
        expect(pressFind(document.body)).toBe(false);
        expect(pressFind(otherInput)).toBe(false);
        expect(screen.queryByTestId('sentinel-todo-search')).toBeNull();

        // A nested editor inside the panel keeps native find.
        fireEvent.click(screen.getByRole('button', { name: 'Add item' }));
        expect(pressFind(screen.getByLabelText('Title'))).toBe(false);
        expect(screen.queryByTestId('sentinel-todo-search')).toBeNull();
        fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

        const select = row.querySelector<HTMLButtonElement>('[data-todo-select]')!;
        select.focus();
        expect(pressFind(select, 'metaKey')).toBe(true);
        expect(document.activeElement).toBe(input());
        type('alp');
        // Again from the search box keeps the query and selects it for replacement.
        input().setSelectionRange(3, 3);
        expect(pressFind(input())).toBe(true);
        expect(input().value).toBe('alp');
        expect([input().selectionStart, input().selectionEnd]).toEqual([0, 3]);
        outside.remove();
        otherScope.remove();
    });

    it('is inert while its panel is hidden', async () => {
        get.mockResolvedValue(ledger([item({ id: 'a' })]));
        vi.mocked(Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetParent')!.get!).mockReturnValue(null);
        render(<UnifiedTodoTab owner={OWNER} />);
        const select = (await screen.findByTestId('sentinel-todo-row-a')).querySelector<HTMLButtonElement>('[data-todo-select]')!;
        select.focus();
        expect(pressFind(select)).toBe(false);
        expect(screen.queryByTestId('sentinel-todo-search')).toBeNull();
    });

    it('moves from the box into results by keyboard and Escape on a result closes search', async () => {
        get.mockResolvedValue(ledger([item({ id: 'a', title: 'Alpha one' }), item({ id: 'b', title: 'Alpha two' }), item({ id: 'c', title: 'Beta' })]));
        render(<UnifiedTodoTab owner={OWNER} />);
        await screen.findByTestId('sentinel-todo-row-a');
        openSearch();
        type('alpha');
        fireEvent.keyDown(input(), { key: 'ArrowDown' });
        const first = screen.getByTestId('sentinel-todo-row-a').querySelector<HTMLButtonElement>('[data-todo-select]')!;
        expect(document.activeElement).toBe(first);
        fireEvent.keyDown(first, { key: 'ArrowDown' });
        expect(document.activeElement).toBe(screen.getByTestId('sentinel-todo-row-b').querySelector('[data-todo-select]'));
        fireEvent.keyDown(document.activeElement!, { key: 'Escape' });
        expect(screen.queryByTestId('sentinel-todo-search')).toBeNull();
        expect(rowIds()).toEqual(['a', 'b', 'c']);
        expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Search to-do items' }));
    });

    it('reveals a collapsed Archived result without writes, then Escape restores the prior view, scroll and focus', async () => {
        const archived = item({ id: 'arch', archived: true, status: 'done', title: 'Old', notes: 'secret detail only here' });
        const done = item({ id: 'done', status: 'done', title: 'Finished' });
        const active = item({ id: 'active', title: 'Current' });
        get.mockResolvedValue(ledger([archived, done, active]));
        const view = render(<UnifiedTodoTab owner={OWNER} />);
        await screen.findByTestId('sentinel-todo-row-active');
        fireEvent.click(screen.getByRole('button', { name: 'Done (1)' }));
        const activeSelect = screen.getByTestId('sentinel-todo-row-active').querySelector<HTMLButtonElement>('[data-todo-select]')!;
        fireEvent.click(activeSelect);
        const list = screen.getByTestId('sentinel-todo-list');
        list.scrollTop = 80;
        fireEvent.scroll(list);
        activeSelect.focus();
        expect(pressFind(activeSelect)).toBe(true);

        type('secret detail');
        expect(rowIds()).toEqual(['arch']);
        expect(list.scrollTop).toBe(0);
        fireEvent.click(screen.getByTestId('sentinel-todo-row-arch').querySelector('[data-todo-select]')!);
        const detail = screen.getByTestId('sentinel-todo-detail-arch');
        expect(detail.hidden).toBe(false);
        expect(within(detail).getByRole('heading', { level: 2 }).textContent).toContain('Old');
        expect(within(detail).getByTestId('sentinel-todo-status-done')).toBeTruthy();
        expect(within(detail).getByRole('button', { name: 'Restore' })).toBeTruthy();
        expect(update).not.toHaveBeenCalled();

        fireEvent.keyDown(input(), { key: 'Escape' });
        expect(screen.queryByTestId('sentinel-todo-search')).toBeNull();
        expect(screen.getByRole('button', { name: 'Done (1)' }).getAttribute('aria-expanded')).toBe('true');
        expect(screen.getByRole('button', { name: 'Archived (1)' }).getAttribute('aria-expanded')).toBe('false');
        expect(screen.queryByTestId('sentinel-todo-row-arch')).toBeNull();
        expect(screen.getByTestId('sentinel-todo-detail-active').hidden).toBe(false);
        expect(screen.queryByTestId('sentinel-todo-detail-arch')).toBeNull();
        expect(list.scrollTop).toBe(80);
        expect(document.activeElement).toBe(screen.getByTestId('sentinel-todo-row-active').querySelector('[data-todo-select]'));
        expect(update).not.toHaveBeenCalled();
        expect(get).toHaveBeenCalledTimes(1);

        view.unmount();
        expect(recallSentinelTodoView(OWNER)).toMatchObject({
            selectedId: 'active', detailOpen: true, scrollTop: 80, expandedIds: ['active'],
            sections: { done: true, archived: false, manual: true, manualDone: false, manualArchived: false },
        });
    });

    it('brings a narrow pane back from details to results when a query is typed, and Escape returns to details', async () => {
        vi.mocked(Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientWidth')!.get!).mockReturnValue(320);
        get.mockResolvedValue(ledger([item({ id: 'a', title: 'Alpha' }), item({ id: 'b', title: 'Beta needle' })]));
        render(<UnifiedTodoTab owner={OWNER} />);
        fireEvent.click((await screen.findByTestId('sentinel-todo-row-a')).querySelector('[data-todo-select]')!);
        const list = screen.getByTestId('sentinel-todo-list');
        expect(list.hidden).toBe(true);
        openSearch();
        type('needle');
        expect(list.hidden).toBe(false);
        expect(rowIds()).toEqual(['b']);
        fireEvent.click(screen.getByTestId('sentinel-todo-row-b').querySelector('[data-todo-select]')!);
        expect(list.hidden).toBe(true);
        expect(screen.getByTestId('sentinel-todo-detail-b').hidden).toBe(false);
        fireEvent.keyDown(input(), { key: 'Escape' });
        expect(list.hidden).toBe(true);
        expect(screen.getByTestId('sentinel-todo-detail-a').hidden).toBe(false);
        expect(update).not.toHaveBeenCalled();
    });

    it('never remembers an open search or its selection when the tab unmounts mid-search', async () => {
        get.mockResolvedValue(ledger([item({ id: 'arch', archived: true, title: 'Archived needle' }), item({ id: 'a', title: 'Active' })]));
        const view = render(<UnifiedTodoTab owner={OWNER} />);
        await screen.findByTestId('sentinel-todo-row-a');
        openSearch();
        type('needle');
        fireEvent.click(screen.getByTestId('sentinel-todo-row-arch').querySelector('[data-todo-select]')!);
        view.unmount();
        expect(recallSentinelTodoView(OWNER)).toMatchObject({
            selectedId: null, detailOpen: false, expandedIds: [],
            sections: { done: false, archived: false },
        });
        render(<UnifiedTodoTab owner={OWNER} />);
        await screen.findByTestId('sentinel-todo-row-a');
        expect(screen.queryByTestId('sentinel-todo-search')).toBeNull();
        expect(screen.getByRole('button', { name: 'Archived (1)' }).getAttribute('aria-expanded')).toBe('false');
        expect(update).not.toHaveBeenCalled();
    });

    it('Clear keeps search open with the normal list; Close restores the tag-free prior view', async () => {
        get.mockResolvedValue(ledger([item({ id: 'a', title: 'Alpha' }), item({ id: 'b', title: 'Beta' })]));
        render(<UnifiedTodoTab owner={OWNER} />);
        await screen.findByTestId('sentinel-todo-row-a');
        openSearch();
        type('beta');
        expect(rowIds()).toEqual(['b']);
        fireEvent.click(screen.getByTestId('sentinel-todo-search-clear'));
        expect(input().value).toBe('');
        expect(document.activeElement).toBe(input());
        expect(rowIds()).toEqual(['a', 'b']);
        fireEvent.click(screen.getByRole('button', { name: 'Close search' }));
        expect(screen.queryByTestId('sentinel-todo-search')).toBeNull();
        openSearch();
        expect(input().value).toBe('');
    });

    it('renders matches in bounded pages and states the full count', async () => {
        get.mockResolvedValue(ledger(Array.from({ length: 150 }, (_, index) => item({ id: `m${index}`, title: `Match ${index}` }))));
        render(<UnifiedTodoTab owner={OWNER} />);
        await screen.findByTestId('sentinel-todo-row-m0');
        openSearch();
        type('match');
        expect(screen.getByTestId('sentinel-todo-search-status').textContent).toBe('150 matches');
        expect(rowIds()).toHaveLength(100);
        expect(within(screen.getByTestId('sentinel-todo-search-group-active')).getByText('To do (150)')).toBeTruthy();
        fireEvent.click(screen.getByRole('button', { name: 'Show more matches (50)' }));
        expect(rowIds()).toHaveLength(150);
        expect(screen.queryByTestId('sentinel-todo-search-more')).toBeNull();
    });

    it('updates results live from ledger refreshes', async () => {
        let current = ledger([item({ id: 'a', title: 'Alpha' })], 1);
        get.mockImplementation(async () => current);
        render(<UnifiedTodoTab owner={OWNER} />);
        await screen.findByTestId('sentinel-todo-row-a');
        openSearch();
        type('gamma');
        expect(rowIds()).toEqual([]);
        current = ledger([item({ id: 'a', title: 'Alpha' }), item({ id: 'g', title: 'Gamma' })], 2);
        fireEvent.click(screen.getByRole('button', { name: 'Refresh to-do list' }));
        await screen.findByTestId('sentinel-todo-row-g');
        expect(input().value).toBe('gamma');
        expect(screen.getByTestId('sentinel-todo-search-status').textContent).toBe('1 match');
    });

    it('resets search for a new owner and never shows the previous owner\'s late response', async () => {
        const slow = deferred<SentinelTodoLedgerResponse>();
        get.mockResolvedValueOnce(ledger([item({ id: 'mine', title: 'Shared needle A' })]));
        const view = render(<UnifiedTodoTab owner={OWNER} />);
        await screen.findByTestId('sentinel-todo-row-mine');
        openSearch();
        type('needle');
        // A refresh for the first owner is still in flight when the owner changes.
        get.mockReturnValueOnce(slow.promise);
        fireEvent.click(screen.getByRole('button', { name: 'Refresh to-do list' }));
        get.mockResolvedValue(ledger([item({ id: 'theirs', title: 'Other owner item' })]));
        const other = { ownerWorkspaceId: 'ws-2', processId: 'queue_two' };
        view.rerender(<UnifiedTodoTab owner={other} />);
        await screen.findByTestId('sentinel-todo-row-theirs');
        expect(screen.queryByTestId('sentinel-todo-search')).toBeNull();
        openSearch();
        type('needle');
        await act(async () => slow.resolve(ledger([item({ id: 'stale', title: 'Stale needle' })])));
        expect(screen.queryByTestId('sentinel-todo-row-stale')).toBeNull();
        expect(screen.queryByTestId('sentinel-todo-row-mine')).toBeNull();
        expect(screen.getByTestId('sentinel-todo-search-empty')).toBeTruthy();
        expect(get).toHaveBeenLastCalledWith('ws-2', 'queue_two', { full: true });
        await waitFor(() => expect(recallSentinelTodoView(other).selectedId ?? null).toBeNull());
    });
});
