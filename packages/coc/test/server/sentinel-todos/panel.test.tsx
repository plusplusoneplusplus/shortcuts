/**
 * UnifiedTodoTab — the Sentinel To-do tab against a fake owning-server client:
 * loading vs. empty, add/edit/status/archive with revisions, retained input on
 * save failures and conflicts, live refresh from ledger events, late
 * responses after an owner change, job links, and the flag-off hiding of
 * stored To-do tabs.
 *
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, renderHook, screen, waitFor, within } from '@testing-library/react';
import type { SentinelTodoItem, SentinelTodoLedgerResponse } from '@plusplusoneplusplus/coc-client';

const get = vi.fn();
const create = vi.fn();
const update = vi.fn();
const connect = vi.fn();
const clientRefs: unknown[] = [];

vi.mock('../../../src/server/spa/client/react/repos/cloneRouting', () => ({
    useCocClient: (ref: unknown) => {
        clientRefs.push(ref);
        return fakeClient;
    },
}));
vi.mock('../../../src/server/spa/client/react/repos/cloneRegistry', async importOriginal => ({
    ...(await importOriginal<object>()),
    getCocClientForWorkspace: (ref: unknown) => {
        clientRefs.push(ref);
        return fakeClient;
    },
}));
const fakeClient = {
    sentinelTodos: {
        get: (...args: unknown[]) => get(...args),
        create: (...args: unknown[]) => create(...args),
        update: (...args: unknown[]) => update(...args),
    },
    events: { connect: (...args: unknown[]) => connect(...args) },
};

import { UnifiedTodoTab } from '../../../src/server/spa/client/react/features/repo-detail/unified-right-panel/UnifiedTodoTab';
import { useUnifiedPanelTabs } from '../../../src/server/spa/client/react/features/repo-detail/unified-right-panel/useUnifiedPanelTabs';
import { clearUnifiedPanelState, writeUnifiedPanelState } from '../../../src/server/spa/client/react/features/repo-detail/unified-right-panel/unifiedPanelStore';
import { openTab, EMPTY_UNIFIED_PANEL } from '../../../src/server/spa/client/react/features/repo-detail/unified-right-panel/unifiedPanelTabsModel';
import { sentinelTodoTabInput } from '../../../src/server/spa/client/react/features/repo-detail/unified-right-panel/sentinelTodoPanelModel';
import {
    clearSentinelTodoChats,
    publishSentinelTodoChat,
    useSentinelTodoChat,
    withdrawSentinelTodoChat,
} from '../../../src/server/spa/client/react/features/repo-detail/unified-right-panel/sentinelTodoChats';
import { applyRuntimeConfigPatch } from '../../../src/server/spa/client/react/utils/config';

const OWNER = { ownerWorkspaceId: 'ws-1', processId: 'queue_sentinel' };

function item(overrides: Partial<SentinelTodoItem> = {}): SentinelTodoItem {
    return {
        id: 'i1', title: 'Fix login', completionCondition: 'Login test passes', notes: 'Check SSO too', status: 'todo',
        archived: false, revision: 1, createdAt: '2026-10-09T00:00:00.000Z', updatedAt: '2026-10-09T00:00:00.000Z',
        createdBy: 'sentinel', updatedBy: 'sentinel', jobs: [], type: 'normal', priority: 'regular', ...overrides,
    };
}

function ledger(items: SentinelTodoItem[], revision = items.length): SentinelTodoLedgerResponse {
    return { revision, items };
}

function deferred<T>() {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>(r => { resolve = r; });
    return { promise, resolve };
}

function conflict(current: SentinelTodoItem) {
    return Object.assign(new Error('Item changed'), { status: 409, code: 'conflict', body: { code: 'conflict', current } });
}

beforeEach(() => {
    get.mockReset();
    create.mockReset();
    update.mockReset();
    connect.mockReset().mockReturnValue({ close: vi.fn() });
    clientRefs.length = 0;
});

afterEach(() => {
    cleanup();
});

describe('UnifiedTodoTab', () => {
    it('shows loading, never the empty state, until the ledger arrives', async () => {
        const pending = deferred<SentinelTodoLedgerResponse>();
        get.mockReturnValue(pending.promise);
        render(<UnifiedTodoTab owner={OWNER} />);
        expect(screen.getByTestId('sentinel-todo-loading')).toBeTruthy();
        expect(screen.queryByTestId('sentinel-todo-empty')).toBeNull();
        await act(async () => pending.resolve(ledger([])));
        expect(screen.getByTestId('sentinel-todo-empty').textContent).toMatch(/Nothing is tracked yet/);
        expect(get).toHaveBeenCalledWith('ws-1', 'queue_sentinel');
        expect(clientRefs).toContain('ws-1');
    });

    it('adds an item from the empty state with an idempotency key', async () => {
        get.mockResolvedValueOnce(ledger([])).mockResolvedValue(ledger([item({ createdBy: 'user' })]));
        create.mockResolvedValue({ item: item(), ledgerRevision: 1, created: true });
        render(<UnifiedTodoTab owner={OWNER} />);
        fireEvent.click(await screen.findByRole('button', { name: 'Add item' }));
        fireEvent.change(screen.getByLabelText('Title'), { target: { value: '  Fix login ' } });
        fireEvent.change(screen.getByLabelText('Done when'), { target: { value: 'Login test passes' } });
        fireEvent.click(screen.getByRole('button', { name: 'Add' }));
        await screen.findByTestId('sentinel-todo-row-i1');
        expect(create).toHaveBeenCalledWith('ws-1', 'queue_sentinel', expect.objectContaining({
            title: 'Fix login', completionCondition: 'Login test passes', idempotencyKey: expect.any(String),
        }));
    });

    it('keeps typed text on a save failure and retries with the same idempotency key', async () => {
        get.mockResolvedValueOnce(ledger([])).mockResolvedValue(ledger([item()]));
        create.mockRejectedValueOnce(new Error('disk full')).mockResolvedValue({ item: item(), ledgerRevision: 1, created: true });
        render(<UnifiedTodoTab owner={OWNER} />);
        fireEvent.click(await screen.findByRole('button', { name: 'Add item' }));
        fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Fix login' } });
        fireEvent.click(screen.getByRole('button', { name: 'Add' }));
        const alert = await screen.findByTestId('sentinel-todo-add-error');
        expect(alert.textContent).toMatch(/Could not save: disk full/);
        expect((screen.getByLabelText('Title') as HTMLInputElement).value).toBe('Fix login');
        fireEvent.click(within(alert).getByRole('button', { name: 'Retry' }));
        await screen.findByTestId('sentinel-todo-row-i1');
        expect(create).toHaveBeenCalledTimes(2);
        expect(create.mock.calls[1][2].idempotencyKey).toBe(create.mock.calls[0][2].idempotencyKey);
    });

    it('orders active items first and collapses Done and Archived', async () => {
        get.mockResolvedValue(ledger([
            item({ id: 'done', title: 'Shipped', status: 'done' }),
            item({ id: 'arch', title: 'Old idea', archived: true }),
            item({ id: 'todo', title: 'Write docs', status: 'todo' }),
            item({ id: 'attn', title: 'Flaky CI', status: 'needs_attention', statusReason: 'Job failed' }),
        ]));
        render(<UnifiedTodoTab owner={OWNER} />);
        await screen.findByTestId('sentinel-todo-row-attn');
        const rows = screen.getAllByTestId(/^sentinel-todo-row-(?!error)/).map(row => row.getAttribute('data-testid'));
        expect(rows).toEqual(['sentinel-todo-row-attn', 'sentinel-todo-row-todo']);
        expect(screen.getByTestId('sentinel-todo-status-needs_attention').textContent).toContain('Needs attention');
        const doneToggle = within(screen.getByTestId('sentinel-todo-done-section')).getByRole('button', { name: 'Done (1)' });
        expect(doneToggle.getAttribute('aria-expanded')).toBe('false');
        fireEvent.click(doneToggle);
        expect(screen.getByTestId('sentinel-todo-row-done')).toBeTruthy();
        expect(screen.queryByTestId('sentinel-todo-row-arch')).toBeNull();
        fireEvent.click(within(screen.getByTestId('sentinel-todo-archived-section')).getByRole('button', { name: 'Archived (1)' }));
        expect(screen.getByTestId('sentinel-todo-row-arch')).toBeTruthy();
    });

    it('shows labeled Created and Updated ledger times with exact local date/time', async () => {
        vi.useFakeTimers({ toFake: ['Date'] });
        vi.setSystemTime(new Date('2026-10-09T12:00:00.000Z'));
        try {
            const createdAt = '2026-10-09T09:00:00.000Z';
            const updatedAt = '2026-10-09T11:55:00.000Z';
            get.mockResolvedValue(ledger([item({ createdAt, updatedAt })]));
            render(<UnifiedTodoTab owner={OWNER} />);
            const created = await screen.findByTestId('sentinel-todo-created-i1');
            const updated = screen.getByTestId('sentinel-todo-updated-i1');
            for (const [el, label, iso, relative] of [[created, 'Created', createdAt, '3h ago'], [updated, 'Updated', updatedAt, '5m ago']] as const) {
                const exact = new Date(iso).toLocaleString();
                const time = el.querySelector('time')!;
                expect(el.textContent).toMatch(new RegExp(`^${label} `));
                expect(time.getAttribute('dateTime')).toBe(iso);
                expect(time.getAttribute('title')).toBe(exact);
                expect(within(time).getByText(relative).getAttribute('aria-hidden')).toBe('true');
                expect(within(time).getByText(exact).className).toContain('sr-only');
                expect(el.className).toContain('whitespace-nowrap');
            }
            // Collapsed rows still show the times, in a muted row that wraps in narrow panes.
            const row = screen.getByTestId('sentinel-todo-times-i1');
            expect(row.className).toContain('flex-wrap');
            expect(row.className).toContain('dark:text-[#9d9d9d]');
            expect(within(screen.getByTestId('sentinel-todo-row-i1')).getByRole('button', { expanded: false })).toBeTruthy();
        } finally {
            vi.useRealTimers();
        }
    });

    it('omits a timestamp the ledger reports as unparseable', async () => {
        get.mockResolvedValue(ledger([item({ updatedAt: 'not-a-date' })]));
        render(<UnifiedTodoTab owner={OWNER} />);
        expect(await screen.findByTestId('sentinel-todo-created-i1')).toBeTruthy();
        expect(screen.queryByTestId('sentinel-todo-updated-i1')).toBeNull();
    });

    it('expands a row to show the completion condition, notes, and outcome', async () => {
        get.mockResolvedValue(ledger([item({
            status: 'done', outcome: { summary: 'Verified login test', recordedAt: '2026-10-09T00:00:00.000Z', recordedBy: 'sentinel' },
        })]));
        render(<UnifiedTodoTab owner={OWNER} />);
        fireEvent.click(await screen.findByRole('button', { name: 'Done (1)' }));
        const toggle = within(screen.getByTestId('sentinel-todo-row-i1')).getByRole('button', { expanded: false });
        fireEvent.click(toggle);
        expect(toggle.getAttribute('aria-expanded')).toBe('true');
        expect(screen.getByText('Login test passes')).toBeTruthy();
        expect(screen.getByText('Check SSO too')).toBeTruthy();
        expect(screen.getByTestId('sentinel-todo-outcome-i1').textContent).toContain('Verified login test');
    });

    it('edits with the base revision and keeps the draft on a conflict', async () => {
        const current = item({ title: 'Fix login (renamed)', revision: 3 });
        get.mockResolvedValueOnce(ledger([item({ revision: 2 })])).mockResolvedValue(ledger([current]));
        update.mockRejectedValueOnce(conflict(current)).mockResolvedValue({ item: current, ledgerRevision: 5 });
        render(<UnifiedTodoTab owner={OWNER} />);
        fireEvent.click(await screen.findByRole('button', { expanded: false }));
        fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
        fireEvent.change(screen.getByLabelText('Notes'), { target: { value: 'My new notes' } });
        fireEvent.click(screen.getByRole('button', { name: 'Save' }));
        const error = await screen.findByTestId('sentinel-todo-row-error-i1');
        expect(error.textContent).toMatch(/changed since you opened it/);
        expect(update).toHaveBeenLastCalledWith('ws-1', 'queue_sentinel', 'i1', expect.objectContaining({ expectedRevision: 2, notes: 'My new notes' }));
        await waitFor(() => expect(get).toHaveBeenCalledTimes(2));
        expect((screen.getByLabelText('Notes') as HTMLTextAreaElement).value).toBe('My new notes');
        fireEvent.click(screen.getByRole('button', { name: 'Save' }));
        await waitFor(() => expect(update).toHaveBeenCalledTimes(2));
        expect(update.mock.calls[1][3]).toMatchObject({ expectedRevision: 3, notes: 'My new notes' });
    });

    it('adds an item as Regular by default and as High when chosen', async () => {
        get.mockResolvedValue(ledger([item()]));
        create.mockResolvedValue({ item: item(), ledgerRevision: 2, created: true });
        render(<UnifiedTodoTab owner={OWNER} />);
        fireEvent.click(await screen.findByTestId('sentinel-todo-add'));
        const priority = screen.getByLabelText('Priority') as HTMLSelectElement;
        expect(priority.value).toBe('regular');
        expect([...priority.options].map(o => o.textContent)).toEqual(['Regular', 'High']);
        fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Plain' } });
        fireEvent.click(screen.getByRole('button', { name: 'Add' }));
        await waitFor(() => expect(create).toHaveBeenCalledTimes(1));
        expect(create.mock.calls[0][2]).toMatchObject({ title: 'Plain', priority: 'regular' });

        fireEvent.click(await screen.findByTestId('sentinel-todo-add'));
        expect((screen.getByLabelText('Priority') as HTMLSelectElement).value).toBe('regular');
        fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Urgent' } });
        fireEvent.change(screen.getByLabelText('Priority'), { target: { value: 'high' } });
        fireEvent.click(screen.getByRole('button', { name: 'Add' }));
        await waitFor(() => expect(create).toHaveBeenCalledTimes(2));
        expect(create.mock.calls[1][2]).toMatchObject({ title: 'Urgent', priority: 'high' });
    });

    it('changes only priority from the edit form, leaving status and outcome alone', async () => {
        const done = item({ status: 'needs_attention', statusReason: 'Blocked', outcome: { summary: 'Earlier review', recordedAt: '2026-10-09T00:00:00.000Z', recordedBy: 'sentinel' } });
        get.mockResolvedValueOnce(ledger([done])).mockResolvedValue(ledger([{ ...done, priority: 'high', revision: 2 }]));
        update.mockResolvedValue({ item: { ...done, priority: 'high', revision: 2 }, ledgerRevision: 2 });
        render(<UnifiedTodoTab owner={OWNER} />);
        fireEvent.click(await screen.findByRole('button', { expanded: false }));
        fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
        expect((screen.getByLabelText('Priority') as HTMLSelectElement).value).toBe('regular');
        fireEvent.change(screen.getByLabelText('Priority'), { target: { value: 'high' } });
        fireEvent.click(screen.getByRole('button', { name: 'Save' }));
        await screen.findByTestId('sentinel-todo-priority-high-i1');
        const patch = update.mock.calls[0][3];
        expect(patch).toMatchObject({ expectedRevision: 1, priority: 'high', title: 'Fix login' });
        expect(patch).not.toHaveProperty('status');
        expect(patch).not.toHaveProperty('statusReason');
        expect(patch).not.toHaveProperty('outcome');
        expect(screen.getByTestId('sentinel-todo-status-needs_attention')).toBeTruthy();
    });

    it('marks High rows with a red leading band and a High label, collapsed or expanded, and Regular rows with neither', async () => {
        get.mockResolvedValue(ledger([
            item({ id: 'hi', title: 'Urgent', priority: 'high', status: 'in_progress' }),
            item({ id: 'reg', title: 'Plain' }),
            { ...item({ id: 'old', title: 'Legacy' }), priority: undefined } as unknown as SentinelTodoItem,
        ]));
        render(<UnifiedTodoTab owner={OWNER} />);
        const high = await screen.findByTestId('sentinel-todo-row-hi');
        const band = within(high).getByTestId('sentinel-todo-priority-band-hi');
        expect(band.getAttribute('aria-hidden')).toBe('true');
        expect(band.className).toMatch(/absolute/);
        expect(band.className).toMatch(/inset-y-0/);
        expect(band.className).toMatch(/left-0/);
        expect(band.className).toMatch(/bg-\[#e51400\]/);
        expect(band.className).toMatch(/dark:bg-\[#f14c4c\]/);
        const label = within(high).getByTestId('sentinel-todo-priority-high-hi');
        expect(label.textContent).toContain('High');
        expect(label.className).toMatch(/shrink-0/);
        // The accessible name of the row toggle says High priority, so color is not the only signal.
        expect(within(high).getByRole('button', { expanded: false }).textContent).toContain('High priority');
        // Priority is independent of status.
        expect(within(high).getByTestId('sentinel-todo-status-in_progress')).toBeTruthy();

        for (const id of ['reg', 'old']) {
            const row = screen.getByTestId(`sentinel-todo-row-${id}`);
            expect(row.getAttribute('data-priority')).toBe('regular');
            expect(within(row).queryByTestId(`sentinel-todo-priority-band-${id}`)).toBeNull();
            expect(within(row).queryByTestId(`sentinel-todo-priority-high-${id}`)).toBeNull();
            expect(row.textContent).not.toMatch(/High/);
            // Every row reserves the same gutter, so toggling priority never shifts content.
            expect(row.className).toBe(high.className);
        }

        fireEvent.click(within(high).getByRole('button', { expanded: false }));
        expect(within(high).getByTestId('sentinel-todo-priority-band-hi')).toBeTruthy();
        expect(within(high).getByTestId('sentinel-todo-priority-high-hi')).toBeTruthy();
        // The band spans the whole card, including the expanded details.
        expect(band.parentElement).toBe(high);
    });

    it('keeps the High label and title on one wrapping row in a narrow pane', async () => {
        get.mockResolvedValue(ledger([item({
            id: 'hi', priority: 'high', title: 'A very long title that has to wrap inside a narrow right panel column',
            targetRepo: { workspaceId: 'ws-2', label: 'web' },
        })]));
        const { container } = render(<div style={{ width: 220 }}><UnifiedTodoTab owner={OWNER} /></div>);
        const row = await screen.findByTestId('sentinel-todo-row-hi');
        expect(container.contains(row)).toBe(true);
        const toggle = within(row).getByRole('button', { expanded: false });
        const title = within(row).getByText(/A very long title/);
        expect(title.className).toMatch(/min-w-0/);
        expect(title.className).toMatch(/break-words/);
        const [status, priority] = [...toggle.children];
        expect(status.getAttribute('data-testid')).toBe('sentinel-todo-status-todo');
        expect(priority.getAttribute('data-testid')).toBe('sentinel-todo-priority-high-hi');
        expect(row.className).toMatch(/\bpl-1\b/);
    });

    it('records an optional Done reason as the outcome', async () => {
        get.mockResolvedValue(ledger([item({ status: 'in_progress', revision: 4 })]));
        update.mockResolvedValue({ item: item(), ledgerRevision: 6 });
        render(<UnifiedTodoTab owner={OWNER} />);
        fireEvent.click(await screen.findByRole('button', { expanded: false }));
        fireEvent.change(screen.getByLabelText('Status'), { target: { value: 'done' } });
        expect(update).not.toHaveBeenCalled();
        fireEvent.change(screen.getByLabelText('Reason for Done (optional)'), { target: { value: 'Login test green' } });
        fireEvent.click(screen.getByRole('button', { name: 'Set status' }));
        await waitFor(() => expect(update).toHaveBeenCalledWith('ws-1', 'queue_sentinel', 'i1', {
            expectedRevision: 4, status: 'done', statusReason: 'Login test green', outcome: 'Login test green',
        }));
    });

    it.each([['empty', ''], ['whitespace-only', '   ']])('marks Done with an %s reason and records no reason or outcome', async (_label, reason) => {
        get.mockResolvedValue(ledger([item({ status: 'in_progress', revision: 4 })]));
        update.mockResolvedValue({ item: item(), ledgerRevision: 6 });
        render(<UnifiedTodoTab owner={OWNER} />);
        fireEvent.click(await screen.findByRole('button', { expanded: false }));
        fireEvent.change(screen.getByLabelText('Status'), { target: { value: 'done' } });
        expect(update).not.toHaveBeenCalled();
        fireEvent.change(screen.getByLabelText('Reason for Done (optional)'), { target: { value: reason } });
        const submit = screen.getByRole('button', { name: 'Set status' }) as HTMLButtonElement;
        expect(submit.disabled).toBe(false);
        fireEvent.click(submit);
        await waitFor(() => expect(update).toHaveBeenCalledWith('ws-1', 'queue_sentinel', 'i1', {
            expectedRevision: 4, status: 'done', statusReason: null,
        }));
    });

    it('still requires a reason for Needs attention', async () => {
        get.mockResolvedValue(ledger([item({ status: 'in_progress', revision: 4 })]));
        update.mockResolvedValue({ item: item(), ledgerRevision: 6 });
        render(<UnifiedTodoTab owner={OWNER} />);
        fireEvent.click(await screen.findByRole('button', { expanded: false }));
        fireEvent.change(screen.getByLabelText('Status'), { target: { value: 'needs_attention' } });
        const input = screen.getByLabelText('Reason for Needs attention');
        fireEvent.change(input, { target: { value: '  ' } });
        const submit = screen.getByRole('button', { name: 'Set status' }) as HTMLButtonElement;
        expect(submit.disabled).toBe(true);
        fireEvent.submit(screen.getByTestId('sentinel-todo-reason-form-i1'));
        expect(update).not.toHaveBeenCalled();
        fireEvent.change(input, { target: { value: 'Blocked on creds' } });
        fireEvent.click(submit);
        await waitFor(() => expect(update).toHaveBeenCalledWith('ws-1', 'queue_sentinel', 'i1', {
            expectedRevision: 4, status: 'needs_attention', statusReason: 'Blocked on creds',
        }));
    });

    it('archives, restores, and reopens through revisioned writes only', async () => {
        get.mockResolvedValue(ledger([item({ status: 'done', revision: 7 })]));
        update.mockResolvedValue({ item: item(), ledgerRevision: 8 });
        render(<UnifiedTodoTab owner={OWNER} />);
        fireEvent.click(await screen.findByRole('button', { name: 'Done (1)' }));
        fireEvent.click(within(screen.getByTestId('sentinel-todo-row-i1')).getByRole('button', { expanded: false }));
        fireEvent.click(screen.getByRole('button', { name: 'Reopen' }));
        await waitFor(() => expect(update).toHaveBeenLastCalledWith('ws-1', 'queue_sentinel', 'i1', { expectedRevision: 7, status: 'todo', statusReason: null }));
        fireEvent.click(screen.getByRole('button', { name: 'Archive' }));
        await waitFor(() => expect(update).toHaveBeenLastCalledWith('ws-1', 'queue_sentinel', 'i1', { expectedRevision: 7, archived: true }));
        expect(create).not.toHaveBeenCalled();
    });

    it('shows a load failure with retry instead of an empty ledger', async () => {
        get.mockRejectedValueOnce(new Error('Network down')).mockResolvedValue(ledger([]));
        render(<UnifiedTodoTab owner={OWNER} />);
        const alert = await screen.findByTestId('sentinel-todo-load-error');
        expect(alert.textContent).toMatch(/Network down/);
        expect(screen.queryByTestId('sentinel-todo-empty')).toBeNull();
        fireEvent.click(within(alert).getByRole('button', { name: 'Retry' }));
        await screen.findByTestId('sentinel-todo-empty');
    });

    it('refreshes on this ledger\'s change events from the owner workspace', async () => {
        get.mockResolvedValueOnce(ledger([])).mockResolvedValue(ledger([item()]));
        render(<UnifiedTodoTab owner={OWNER} />);
        await screen.findByTestId('sentinel-todo-empty');
        expect(connect).toHaveBeenCalledWith(expect.objectContaining({ workspaceId: 'ws-1' }));
        const { onMessage } = connect.mock.calls[0][0] as { onMessage: (msg: unknown) => void };
        act(() => onMessage({ type: 'sentinel-todos-changed', workspaceId: 'ws-1', processId: 'queue_other', ledgerRevision: 1, itemId: 'x' }));
        expect(get).toHaveBeenCalledTimes(1);
        act(() => onMessage({ type: 'sentinel-todos-changed', workspaceId: 'ws-1', processId: 'queue_sentinel', ledgerRevision: 1, itemId: 'i1' }));
        await screen.findByTestId('sentinel-todo-row-i1');
    });

    it('discards a late response after the owner changes', async () => {
        const slow = deferred<SentinelTodoLedgerResponse>();
        get.mockReturnValueOnce(slow.promise).mockResolvedValue(ledger([item({ id: 'mine', title: 'Second chat item' })]));
        const { rerender } = render(<UnifiedTodoTab owner={OWNER} />);
        rerender(<UnifiedTodoTab owner={{ ownerWorkspaceId: 'ws-2', processId: 'queue_two' }} />);
        await screen.findByTestId('sentinel-todo-row-mine');
        await act(async () => slow.resolve(ledger([item({ id: 'stale', title: 'First chat item' })])));
        expect(screen.queryByTestId('sentinel-todo-row-stale')).toBeNull();
        expect(get).toHaveBeenLastCalledWith('ws-2', 'queue_two');
    });

    it('lists linked jobs with execution apart from status and remote jobs as unavailable', async () => {
        get.mockResolvedValue(ledger([item({
            status: 'in_progress',
            jobs: [
                { processId: 'queue_a', workspaceId: 'ws-b', kind: 'local', openLink: '#repos/ws-b/chats/a', title: 'Patch API', linkedAt: '2026-10-09T00:00:00.000Z', execution: { state: 'completed', review: { state: 'delivered' } } },
                { processId: 'p-r', workspaceId: 'ws-c', serverId: 'srv-2', kind: 'remote', openLink: 'https://remote.example/#repos/ws-c/chats/p-r', title: 'Remote fix', linkedAt: '2026-10-09T00:00:00.000Z', execution: { state: 'unavailable' } },
            ],
        })]));
        render(<UnifiedTodoTab owner={OWNER} />);
        const row = await screen.findByTestId('sentinel-todo-row-i1');
        expect(within(row).getByTestId('sentinel-todo-status-in_progress')).toBeTruthy();
        expect(row.textContent).toContain('Job completed');
        expect(row.textContent).toContain('Review delivered');
        expect(row.textContent).toContain('Status unavailable');
        const remote = within(row).getByRole('link', { name: 'Remote fix' });
        expect(remote.getAttribute('href')).toBe('https://remote.example/#repos/ws-c/chats/p-r');
        expect(remote.getAttribute('target')).toBe('_blank');
        expect(within(row).getByRole('link', { name: 'Patch API' }).getAttribute('target')).toBeNull();
    });
});

describe('Sentinel chat registry and flag gating', () => {
    afterEach(() => {
        clearSentinelTodoChats();
        clearUnifiedPanelState();
        applyRuntimeConfigPatch({ sentinelTodoLedgerEnabled: false });
    });

    it('publishes per panel scope and chat and withdraws on unmount', () => {
        const { result } = renderHook(() => useSentinelTodoChat('ws-1', 'chat-1'));
        expect(result.current).toBeNull();
        act(() => publishSentinelTodoChat('ws-1', 'chat-1', OWNER));
        expect(result.current).toEqual(OWNER);
        act(() => publishSentinelTodoChat('group-1', 'chat-1', { ...OWNER, ownerWorkspaceId: 'group-1' }));
        expect(result.current).toEqual(OWNER);
        act(() => withdrawSentinelTodoChat('ws-1', 'chat-1'));
        expect(result.current).toBeNull();
    });

    it('hides stored To-do tabs while the flag is off and shows them when it turns on', () => {
        act(() => writeUnifiedPanelState('ws-1', openTab(EMPTY_UNIFIED_PANEL, sentinelTodoTabInput(OWNER, 'chat-1'))));
        applyRuntimeConfigPatch({ sentinelTodoLedgerEnabled: false });
        const { result } = renderHook(() => useUnifiedPanelTabs('ws-1', 'chat-1'));
        expect(result.current.tabs).toEqual([]);
        expect(result.current.activeId).toBeNull();
        act(() => applyRuntimeConfigPatch({ sentinelTodoLedgerEnabled: true }));
        expect(result.current.tabs.map(tab => tab.kind)).toEqual(['todo']);
    });
});
