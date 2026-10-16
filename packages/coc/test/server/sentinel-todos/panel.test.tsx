/**
 * UnifiedTodoTab — the Sentinel To-do tab against a fake owning-server client:
 * loading vs. empty, add/edit/status/archive with revisions, retained input on
 * save failures and conflicts, live refresh from ledger events, late
 * responses after an owner change, job links, and restoration of
 * persistent To-do tabs.
 *
 * @vitest-environment jsdom
 */
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, configure, fireEvent, render, renderHook, screen, waitFor, within } from '@testing-library/react';
import type { SentinelTodoItem, SentinelTodoLedgerResponse } from '@plusplusoneplusplus/coc-client';
import type { SentinelTodoOwnerWorkspace } from '../../../src/server/spa/client/react/features/repo-detail/unified-right-panel/sentinelTodoJobOwner';

const { ownerWorkspaces } = vi.hoisted(() => ({ ownerWorkspaces: [] as SentinelTodoOwnerWorkspace[] }));
vi.mock('../../../src/server/spa/client/react/contexts/AppContext', () => ({ useAppOptional: () => null }));
vi.mock('../../../src/server/spa/client/react/contexts/ReposContext', () => ({
    useReposOptional: () => ({ repos: ownerWorkspaces.map(workspace => ({ workspace })), remoteGroupWorkspaces: [] }),
}));

// The first cold render of the tab and scrubber can exceed the 1s default on slow CI runners.
configure({ asyncUtilTimeout: 5000 });

const get = vi.fn();
const create = vi.fn();
const update = vi.fn();
const dependencyEvaluate = vi.fn();
const prOutcomesGet = vi.fn();
const connect = vi.fn();
const scrubGet = vi.fn();
const scrubGetRun = vi.fn();
const scrubAccept = vi.fn();
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
        scrubber: { get: (...args: unknown[]) => scrubGet(...args), getRun: (...args: unknown[]) => scrubGetRun(...args), accept: (...args: unknown[]) => scrubAccept(...args) },
        get: (...args: unknown[]) => get(...args),
        create: (...args: unknown[]) => create(...args),
        update: (...args: unknown[]) => update(...args),
        evaluateDependencies: (...args: unknown[]) => dependencyEvaluate(...args),
        listPrOutcomes: (...args: unknown[]) => prOutcomesGet(...args),
    },
    triggers: { listSentinelTodo: async () => [] },
    events: { connect: (...args: unknown[]) => connect(...args) },
};

import { UnifiedTodoTab } from '../../../src/server/spa/client/react/features/repo-detail/unified-right-panel/UnifiedTodoTab';
import { ScrubberFindingsContext } from '../../../src/server/spa/client/react/features/repo-detail/unified-right-panel/SentinelTodoScrubFinding';
import { useUnifiedPanelTabs } from '../../../src/server/spa/client/react/features/repo-detail/unified-right-panel/useUnifiedPanelTabs';
import { clearUnifiedPanelState, readUnifiedPanelState, writeUnifiedPanelState } from '../../../src/server/spa/client/react/features/repo-detail/unified-right-panel/unifiedPanelStore';
import { openTab, EMPTY_UNIFIED_PANEL } from '../../../src/server/spa/client/react/features/repo-detail/unified-right-panel/unifiedPanelTabsModel';
import { sentinelTodoTabInput } from '../../../src/server/spa/client/react/features/repo-detail/unified-right-panel/sentinelTodoPanelModel';
import {
    clearSentinelTodoChats,
    publishSentinelTodoChat,
    useSentinelTodoChat,
    withdrawSentinelTodoChat,
} from '../../../src/server/spa/client/react/features/repo-detail/unified-right-panel/sentinelTodoChats';
import { clearSentinelTodoExcursion, recallSentinelTodoView, returnFromSentinelTodoExcursion } from '../../../src/server/spa/client/react/features/repo-detail/unified-right-panel/sentinelTodoExcursion';
import { applyRuntimeConfigPatch } from '../../../src/server/spa/client/react/utils/config';
import { POINTER_CONTEXT_DRAG_MIME } from '../../../src/server/spa/client/react/features/chat/sessionContextDrag';
import { resetActiveChatAttach, subscribeActiveChatAttach } from '../../../src/server/spa/client/react/features/chat/activeChatAttach';
import { registerCloneBaseUrls, resetCloneRegistryForTests } from '../../../src/server/spa/client/react/repos/cloneRegistry';

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

function assertIconOnlyStatus(badge: HTMLElement, label: string, mark: string) {
    expect(badge.getAttribute('title')).toBe(label);
    expect(within(badge).getByText(label).className).toBe('sr-only');
    expect(badge.querySelector('[aria-hidden="true"]')?.textContent).toBe(mark);
    expect([...badge.childNodes].filter(node => node.nodeType === Node.TEXT_NODE)
        .map(node => node.textContent?.trim()).join('')).toBe('');
    expect(badge.classList.contains('px-1')).toBe(true);
    expect(badge.classList.contains('justify-center')).toBe(true);
}

function deferred<T>() {
    let resolve!: (value: T) => void;
    let reject!: (error: Error) => void;
    const promise = new Promise<T>((r, j) => { resolve = r; reject = j; });
    return { promise, resolve, reject };
}

/** Presses one of an expanded row's compact status choices. */
function chooseStatus(container: HTMLElement, label: string) {
    const group = within(container).getByRole('group', { name: 'Status' });
    fireEvent.click(within(group).getByRole('button', { name: label }));
}

function conflict(current: SentinelTodoItem) {
    return Object.assign(new Error('Item changed'), { status: 409, code: 'conflict', body: { code: 'conflict', current } });
}

beforeEach(() => {
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(800);
    applyRuntimeConfigPatch({ sentinelTodoScrubberEnabled: false, sentinelTodoDependenciesEnabled: false, sentinelPrOutcomeWakeEnabled: false, triggersEnabled: false });
    resetCloneRegistryForTests();
    dependencyEvaluate.mockReset();
    prOutcomesGet.mockReset();
    scrubGet.mockReset();
    scrubGetRun.mockReset();
    scrubAccept.mockReset();
    get.mockReset();
    create.mockReset();
    update.mockReset();
    connect.mockReset().mockReturnValue({ close: vi.fn() });
    clientRefs.length = 0;
    ownerWorkspaces.length = 0;
    // Remembered views are per owner, and every case here shares OWNER.
    clearSentinelTodoExcursion();
    resetActiveChatAttach();
});

afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    applyRuntimeConfigPatch({ sentinelTodoScrubberEnabled: false, sentinelTodoDependenciesEnabled: false, sentinelPrOutcomeWakeEnabled: false, triggersEnabled: false });
});

describe('UnifiedTodoTab', () => {
    it('blocks Close for pending scrubber mutations but not unavailable finding actions', async () => {
        get.mockResolvedValue(ledger([item()]));
        const findings = { findings: new Map(), busy: true, proposalCount: 0, act: vi.fn(), acceptAll: vi.fn() };
        const view = render(<ScrubberFindingsContext.Provider value={{ ...findings, mutationPending: true }}>
            <UnifiedTodoTab owner={OWNER} />
        </ScrubberFindingsContext.Provider>);
        const row = await screen.findByTestId('sentinel-todo-row-i1');
        fireEvent.click(within(row).getByRole('button'));
        const close = screen.getByRole('button', { name: 'Close To-do details' }) as HTMLButtonElement;
        expect(close.disabled).toBe(true);
        view.rerender(<ScrubberFindingsContext.Provider value={{ ...findings, mutationPending: false }}>
            <UnifiedTodoTab owner={OWNER} />
        </ScrubberFindingsContext.Provider>);
        expect(close.disabled).toBe(false);
        fireEvent.click(close);
        expect(screen.getByTestId('sentinel-todo-detail-i1').hidden).toBe(true);
    });

    it.each([800, 320])('closes details by keyboard at %ipx, preserves list state, stays deselected on refresh/remount and reopens normally', async width => {
        vi.mocked(Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientWidth')!.get!).mockReturnValue(width);
        get.mockResolvedValue(ledger([item(), item({ id: 'i2', title: 'Second item' })]));
        const view = render(<UnifiedTodoTab owner={OWNER} />);
        await screen.findByTestId('sentinel-todo-row-i1');
        const list = screen.getByTestId('sentinel-todo-list');
        list.scrollTop = 80;
        fireEvent.scroll(list);
        const rowButton = within(screen.getByTestId('sentinel-todo-row-i1')).getByRole('button');
        fireEvent.click(rowButton);
        const close = screen.getByRole('button', { name: 'Close To-do details' });
        expect(close.title).toBe('Close To-do details');
        close.focus();
        await userEvent.setup().keyboard('{Enter}');
        await waitFor(() => expect(document.activeElement).toBe(rowButton));
        expect(rowButton.getAttribute('aria-pressed')).toBe('false');
        expect(screen.getByTestId('sentinel-todo-detail-i1').hidden).toBe(true);
        expect(list.hidden).toBe(false);
        expect(list.scrollTop).toBe(80);
        view.rerender(<UnifiedTodoTab owner={OWNER} />);
        fireEvent.click(screen.getByRole('button', { name: 'Refresh to-do list' }));
        await waitFor(() => expect(screen.getByTestId('sentinel-todo-refresh').getAttribute('aria-busy')).toBe('false'));
        expect(screen.queryByRole('button', { name: 'Close To-do details' })).toBeNull();
        view.unmount();
        render(<UnifiedTodoTab owner={OWNER} />);
        await screen.findByTestId('sentinel-todo-row-i1');
        expect(screen.queryByRole('button', { name: 'Close To-do details' })).toBeNull();
        fireEvent.click(within(screen.getByTestId('sentinel-todo-row-i1')).getByRole('button'));
        expect(screen.getByRole('button', { name: 'Close To-do details' })).toBeTruthy();
        expect(screen.getByTestId('sentinel-todo-detail-i1').hidden).toBe(false);
    });

    it('retains a status-reason draft through Close and blocks Close until pending item saves and refresh finish', async () => {
        get.mockResolvedValue(ledger([item()]));
        render(<UnifiedTodoTab owner={OWNER} />);
        const row = await screen.findByTestId('sentinel-todo-row-i1');
        fireEvent.click(within(row).getByRole('button'));
        const detail = screen.getByTestId('sentinel-todo-detail-i1');
        chooseStatus(detail, 'Needs attention');
        fireEvent.change(screen.getByLabelText('Reason for Needs attention'), { target: { value: 'Waiting for review' } });
        fireEvent.click(screen.getByRole('button', { name: 'Close To-do details' }));
        fireEvent.click(within(row).getByRole('button'));
        expect((screen.getByLabelText('Reason for Needs attention') as HTMLInputElement).value).toBe('Waiting for review');
        const pending = deferred<object>();
        const refresh = deferred<SentinelTodoLedgerResponse>();
        update.mockReturnValueOnce(pending.promise);
        get.mockReturnValueOnce(refresh.promise);
        fireEvent.click(screen.getByRole('button', { name: 'Set status' }));
        const close = screen.getByRole('button', { name: 'Close To-do details' }) as HTMLButtonElement;
        expect(close.disabled).toBe(true);
        fireEvent.click(close);
        expect(detail.hidden).toBe(false);
        await act(async () => pending.resolve({}));
        expect(close.disabled).toBe(true);
        await act(async () => refresh.resolve(ledger([item({ status: 'needs_attention', revision: 2 })], 2)));
        expect(close.disabled).toBe(false);
        fireEvent.click(close);
        expect(detail.hidden).toBe(true);
    });

    describe('save refresh coordination', () => {
        const changed = (ledgerRevision: number) => act(() => connect.mock.calls[0][0].onMessage({ type: 'sentinel-todos-changed',
            workspaceId: OWNER.ownerWorkspaceId, processId: OWNER.processId, ledgerRevision, itemId: 'i1' }));
        async function startDoneSave() {
            const row = await screen.findByTestId('sentinel-todo-row-i1');
            fireEvent.click(within(row).getByRole('button'));
            chooseStatus(document.body, 'Done');
            fireEvent.click(screen.getByRole('button', { name: 'Set status' }));
            return screen.getByRole('button', { name: 'Close To-do details' }) as HTMLButtonElement;
        }
        const saved = ledger([item({ status: 'done', revision: 5 })], 5);

        it('reuses the committed change event\'s read instead of fetching the ledger again', async () => {
            get.mockResolvedValueOnce(ledger([item({ revision: 4 })], 4));
            render(<UnifiedTodoTab owner={OWNER} />);
            const patch = deferred<object>();
            const eventRead = deferred<SentinelTodoLedgerResponse>();
            update.mockReturnValueOnce(patch.promise);
            get.mockReturnValueOnce(eventRead.promise);
            const close = await startDoneSave();
            changed(5);
            await act(async () => patch.resolve({ item: item(), ledgerRevision: 5 }));
            expect(close.disabled).toBe(true);
            await act(async () => eventRead.resolve(saved));
            expect(close.disabled).toBe(false);
            expect(get).toHaveBeenCalledTimes(2);
            expect(screen.getByTestId('sentinel-todo-row-i1').querySelector('[data-testid="sentinel-todo-status-done"]')).toBeTruthy();
        });

        it('never accepts an older in-flight read as the saved state', async () => {
            get.mockResolvedValueOnce(ledger([item({ revision: 4 })], 4));
            render(<UnifiedTodoTab owner={OWNER} />);
            await screen.findByTestId('sentinel-todo-row-i1');
            const stale = deferred<SentinelTodoLedgerResponse>();
            const fresh = deferred<SentinelTodoLedgerResponse>();
            get.mockReturnValueOnce(stale.promise).mockReturnValueOnce(fresh.promise);
            fireEvent.click(screen.getByRole('button', { name: 'Refresh to-do list' }));
            update.mockResolvedValueOnce({ item: item(), ledgerRevision: 5 });
            const close = await startDoneSave();
            await act(async () => stale.resolve(ledger([item({ revision: 4 })], 4)));
            expect(close.disabled).toBe(true);
            expect(get).toHaveBeenCalledTimes(3);
            await act(async () => fresh.resolve(saved));
            expect(close.disabled).toBe(false);
        });

        it('fetches once itself when no change event arrives', async () => {
            get.mockResolvedValueOnce(ledger([item({ revision: 4 })], 4)).mockResolvedValueOnce(saved);
            update.mockResolvedValueOnce({ item: item(), ledgerRevision: 5 });
            render(<UnifiedTodoTab owner={OWNER} />);
            const close = await startDoneSave();
            await waitFor(() => expect(close.disabled).toBe(false));
            expect(get).toHaveBeenCalledTimes(2);
        });
    });

    it('shows older active work plus recent Done with Refresh and older access', async () => {
        const items = Array.from({ length: 105 }, (_, index) => item({
            id: `item-${index}`, title: `Item ${index}`,
            status: index === 0 ? 'in_progress' : index === 80 ? 'needs_attention' : 'done',
            createdAt: new Date(Date.UTC(2026, 0, 1, 0, 0, index)).toISOString(),
            updatedAt: new Date(Date.UTC(2026, 0, 1, 0, 0, index)).toISOString(),
            ...(index === 0 ? { jobs: [{
                processId: 'queue_intermediate', workspaceId: 'ws-1', kind: 'local' as const,
                openLink: '#repos/ws-1/chats/intermediate', linkedAt: '2026-01-01T00:00:00Z',
                execution: { state: 'completed' as const, review: { state: 'delivered' as const, assessment: 'reviewed' as const } },
            }] } : {}),
        }));
        get.mockResolvedValue(ledger(items));
        render(<UnifiedTodoTab owner={OWNER} />);
        const progress = await screen.findByTestId('sentinel-todo-row-item-0');
        expect(within(progress).getByTestId('sentinel-todo-status-in_progress')).toBeTruthy();
        fireEvent.click(within(screen.getByTestId('sentinel-todo-done-section')).getByRole('button', { name: 'Done (48)' }));
        expect(screen.getByTestId('sentinel-todo-row-item-104')).toBeTruthy();
        expect(get).toHaveBeenCalledWith(OWNER.ownerWorkspaceId, OWNER.processId, { full: true });
        const rows = () => [...screen.getByTestId('sentinel-todo-tab').querySelectorAll('[data-testid^="sentinel-todo-row-"]')];
        expect(rows()).toHaveLength(50);
        expect(rows()[0].getAttribute('data-testid')).toBe('sentinel-todo-row-item-80');
        expect(screen.queryByTestId('sentinel-todo-row-item-1')).toBeNull();
        fireEvent.click(screen.getByRole('button', { name: 'Refresh to-do list' }));
        await waitFor(() => expect(screen.getByTestId('sentinel-todo-refresh').getAttribute('aria-busy')).toBe('false'));
        expect(rows()).toHaveLength(50);
        expect(rows()[0].getAttribute('data-testid')).toBe('sentinel-todo-row-item-80');
        fireEvent.click(screen.getByTestId('sentinel-todo-show-older'));
        expect(rows()).toHaveLength(100);
        expect(screen.queryByTestId('sentinel-todo-row-item-1')).toBeNull();
        fireEvent.click(screen.getByRole('button', { name: 'Refresh to-do list' }));
        await waitFor(() => expect(screen.getByTestId('sentinel-todo-refresh').getAttribute('aria-busy')).toBe('false'));
        expect(rows()).toHaveLength(100);
        fireEvent.click(screen.getByTestId('sentinel-todo-show-older'));
        expect(rows()).toHaveLength(105);
        expect(screen.getByTestId('sentinel-todo-row-item-0')).toBeTruthy();
        expect(screen.queryByTestId('sentinel-todo-show-older')).toBeNull();
        expect(get).toHaveBeenCalledTimes(3);
        expect(items).toHaveLength(105);
    });

    it('keeps every normal and manual active item above 50 before revealing Done', async () => {
        const active = Array.from({ length: 55 }, (_, index) => item({
            id: `active-${index}`, title: `Active ${index}`, type: index === 0 ? 'manual' : 'normal',
        }));
        get.mockResolvedValue(ledger([...active, item({ id: 'done', status: 'done' })]));
        render(<UnifiedTodoTab owner={OWNER} />);
        await screen.findByTestId('sentinel-todo-row-active-0');
        expect(screen.getByTestId('sentinel-todo-tab').querySelectorAll('[data-testid^="sentinel-todo-row-"]')).toHaveLength(55);
        expect(screen.getByTestId('sentinel-todo-show-older').textContent).toContain('(1)');
        expect(screen.queryByTestId('sentinel-todo-done-section')).toBeNull();
        fireEvent.click(screen.getByRole('button', { name: 'Refresh to-do list' }));
        await waitFor(() => expect(screen.getByTestId('sentinel-todo-refresh').getAttribute('aria-busy')).toBe('false'));
        expect(screen.queryByTestId('sentinel-todo-done-section')).toBeNull();
        fireEvent.click(screen.getByTestId('sentinel-todo-show-older'));
        fireEvent.click(within(screen.getByTestId('sentinel-todo-done-section')).getByRole('button', { name: 'Done (1)' }));
        expect(screen.getByTestId('sentinel-todo-row-done')).toBeTruthy();
        expect(screen.queryByTestId('sentinel-todo-show-older')).toBeNull();
        expect(create).not.toHaveBeenCalled();
        expect(update).not.toHaveBeenCalled();
    });

    it.each([true, false])('consolidates compact job metadata and preserves distinct titles (identical=%s)', async identical => {
        const title = 'Fix login';
        const jobTitle = identical ? title : 'Verify SSO in the child repo';
        const tracked = item({ title, targetRepo: { workspaceId: 'ws-child', label: 'Child repo' }, jobs: [{
            processId: 'child', workspaceId: 'ws-child', kind: 'local', title: jobTitle, mode: 'autopilot',
            openLink: '#repos/ws-child/chats/child', linkedAt: item().createdAt,
            execution: { state: 'running' },
        }] });
        ownerWorkspaces.push({ id: 'ws-child', name: 'Child repo' });
        get.mockResolvedValue(ledger([tracked]));
        render(<UnifiedTodoTab owner={OWNER} scopeWorkspaceId="ws-1" />);
        const row = await screen.findByTestId('sentinel-todo-row-i1');
        const selection = within(row).getByRole('button', { pressed: false, name: /Fix login/ });
        expect(selection.getAttribute('title')).toBe(title);
        expect(within(row).getAllByText(title, { exact: true })).toHaveLength(1);
        const link = within(row).getByRole('link', { name: identical ? `Open job: ${title}` : jobTitle });
        expect(link.textContent).toBe(identical ? 'Open job' : jobTitle);
        expect(link.getAttribute('href')).toBe(tracked.jobs[0].openLink);
        const meta = within(row).getByTestId('sentinel-todo-meta-i1');
        expect(meta.contains(link)).toBe(true);
        expect(meta.className).toContain('flex-wrap');
        expect(meta.textContent).toContain('Updated');
        expect(meta.textContent).toContain('Autopilot');
        expect(meta.textContent).toContain('Running');
        expect(within(row).queryByRole('button', { name: 'Edit' })).toBeNull();
        fireEvent.click(selection);
        const detail = screen.getByTestId('sentinel-todo-detail-i1');
        expect(within(detail).getByRole('link', { name: jobTitle }).textContent).toBe(jobTitle);
        expect(within(detail).getByText(tracked.completionCondition)).toBeTruthy();
        expect(within(detail).getByRole('button', { name: 'Edit' })).toBeTruthy();
        expect(create).not.toHaveBeenCalled();
        expect(update).not.toHaveBeenCalled();
    });

    it('left-aligns full job history with bounded wrapping rows without changing compact metadata or job semantics', async () => {
        const tracked = item({ title: 'Fixture tracked work', jobs: [
            { processId: 'earlier', workspaceId: 'ws-child', kind: 'local', title: 'Fixture earlier job',
                openLink: '#repos/ws-child/chats/earlier', linkedAt: item().createdAt,
                execution: { state: 'cancelled', review: { state: 'delivered', assessment: 'not_required' } } },
            { processId: 'latest', workspaceId: 'ws-child', kind: 'local', title: 'Fixture latest job', mode: 'autopilot',
                openLink: '#repos/ws-child/chats/latest', linkedAt: item().createdAt,
                execution: { state: 'running' } },
        ] });
        ownerWorkspaces.push({ id: 'ws-child', name: 'Fixture child repo' });
        get.mockResolvedValue(ledger([tracked]));
        render(<UnifiedTodoTab owner={OWNER} scopeWorkspaceId="ws-1" />);
        const row = await screen.findByTestId('sentinel-todo-row-i1');
        const compact = within(row).getByRole('list', { name: `Jobs for ${tracked.title}` });
        expect(compact.classList.contains('items-center')).toBe(true);
        expect(within(compact).getAllByRole('link')).toHaveLength(1);
        expect(within(compact).getByText('+1 earlier job')).toBeTruthy();
        fireEvent.click(row.querySelector('[data-todo-select]')!);
        const detail = screen.getByTestId('sentinel-todo-detail-i1');
        const jobs = within(detail).getByRole('list', { name: `Jobs for ${tracked.title}` });
        expect(jobs.classList.contains('items-center')).toBe(false);
        expect(jobs.classList.contains('items-stretch')).toBe(true);
        expect(jobs.classList.contains('px-2')).toBe(true);
        const links = within(jobs).getAllByRole('link');
        expect(links.map(link => link.getAttribute('href'))).toEqual(tracked.jobs.map(job => job.openLink));
        for (const link of links) {
            const jobRow = link.closest('li')!;
            for (const style of ['min-w-0', 'max-w-full', 'flex-wrap', 'text-left', '[overflow-wrap:anywhere]']) {
                expect(jobRow.classList.contains(style)).toBe(true);
            }
            expect(within(jobRow).getByTestId('sentinel-todo-job-owner').textContent).toBe('Fixture child repo');
            expect(link.getAttribute('aria-description')).toBe('Focus to preview; ArrowDown enters preview actions.');
            expect(within(jobRow).queryByRole('button', { name: /^Preview job:/ })).toBeNull();
        }
        expect(within(jobs).getByTestId('sentinel-todo-job-mode').textContent).toBe('Autopilot');
        expect(jobs.textContent).toContain('Job cancelled');
        expect(jobs.textContent).toContain('Notice delivered');
        expect(jobs.textContent).toContain('Running');
        expect(detail.classList.contains('select-text')).toBe(true);
        act(() => links[0].focus());
        const preview = await screen.findByRole('dialog', { name: 'Fixture earlier job' });
        fireEvent.keyDown(links[0], { key: 'ArrowDown' });
        expect(within(preview).getByRole('button', { name: 'Close job preview' })).toHaveFocus();
        fireEvent.keyDown(document, { key: 'Escape' });
        expect(screen.queryByRole('dialog', { name: 'Fixture earlier job' })).toBeNull();
        expect(links[0]).toHaveFocus();
        expect(create).not.toHaveBeenCalled();
        expect(update).not.toHaveBeenCalled();
    });

    it('keeps hidden older prerequisites in the full dependency chain and reveals their rows on lookup', async () => {
        applyRuntimeConfigPatch({ sentinelTodoDependenciesEnabled: true });
        const source = item({ id: 'source', title: 'Older source', status: 'done', updatedAt: '2025-01-01T00:00:00Z' });
        const filler = Array.from({ length: 50 }, (_, index) => item({ id: `filler-${index}`, title: `Filler ${index}` }));
        const dependent = item({ id: 'dependent', title: 'Dependent',
            dependsOn: [{ itemId: source.id, condition: { kind: 'done' } }] });
        get.mockResolvedValue(ledger([source, ...filler, dependent]));
        dependencyEvaluate.mockResolvedValue({
            itemId: dependent.id, itemRevision: 1, ledgerRevision: 52, state: 'waiting',
            evaluatedAt: '2026-01-01T00:00:00Z',
            edges: [{ dependency: dependent.dependsOn![0], satisfied: false, blocker: 'Explicit Done required' }],
        });
        render(<UnifiedTodoTab owner={OWNER} />);
        let row = await screen.findByTestId('sentinel-todo-row-dependent');
        expect(screen.queryByTestId('sentinel-todo-row-source')).toBeNull();
        fireEvent.click(within(row).getByRole('button', { name: /Dependent/ }));
        row = screen.getByTestId(row.dataset.testid!.replace('sentinel-todo-row-', 'sentinel-todo-detail-'));
        await within(row).findByText('Waiting');
        const chain = within(row).getByRole('list', { name: 'Dependency chain' });
        fireEvent.click(within(chain).getByRole('button', { name: 'Older source' }));
        await waitFor(() => expect(screen.getByTestId('sentinel-todo-row-source').querySelector('button[aria-pressed]')?.getAttribute('aria-pressed')).toBe('true'));
    });

    it.each(['normal', 'manual'] as const)('does not claim an older %s section is empty and reveals it on demand', async type => {
        const older = item({ id: 'older', title: 'Older item', type, status: 'done', updatedAt: '2025-01-01T00:00:00Z' });
        const recentType = type === 'normal' ? 'manual' : 'normal';
        const recent = Array.from({ length: 50 }, (_, index) => item({
            id: `recent-${index}`, title: `Recent ${index}`, type: recentType,
        }));
        get.mockResolvedValue(ledger([older, ...recent]));
        render(<UnifiedTodoTab owner={OWNER} />);
        await screen.findByTestId('sentinel-todo-row-recent-49');
        expect(screen.queryByTestId('sentinel-todo-row-older')).toBeNull();
        expect(screen.getByText(new RegExp(`No ${type} items in this recent view`))).toBeTruthy();
        fireEvent.click(screen.getByTestId('sentinel-todo-show-older'));
        fireEvent.click(within(screen.getByTestId(`sentinel-todo-${type === 'manual' ? 'manual-' : ''}done-section`)).getByRole('button', { name: 'Done (1)' }));
        expect(screen.getByTestId('sentinel-todo-row-older')).toBeTruthy();
    });

    it('mounts gated dependency chips and opens prerequisite details in the same owner ledger', async () => {
        applyRuntimeConfigPatch({ sentinelTodoDependenciesEnabled: true });
        const source = item({ id: 'source', title: 'Source' });
        const dependent = item({ id: 'dependent', title: 'Dependent',
            dependsOn: [{ itemId: source.id, condition: { kind: 'done' } }] });
        get.mockResolvedValue(ledger([source, dependent], 2));
        dependencyEvaluate.mockResolvedValue({
            itemId: dependent.id, itemRevision: 1, ledgerRevision: 2, state: 'waiting',
            evaluatedAt: '2026-01-01T00:00:00Z',
            edges: [{ dependency: dependent.dependsOn![0], satisfied: false, blocker: 'Explicit Done required' }],
        });
        render(<UnifiedTodoTab owner={OWNER} />);
        let row = await screen.findByTestId('sentinel-todo-row-dependent');
        fireEvent.click(within(row).getByRole('button', { name: /Dependent/ }));
        row = screen.getByTestId(row.dataset.testid!.replace('sentinel-todo-row-', 'sentinel-todo-detail-'));
        await within(row).findByText('Waiting');
        const chain = within(row).getByRole('list', { name: 'Dependency chain' });
        fireEvent.click(within(chain).getByRole('button', { name: 'Source' }));
        await waitFor(() => expect(screen.getByTestId('sentinel-todo-row-source').querySelector('button[aria-pressed]')?.getAttribute('aria-pressed')).toBe('true'));
        expect(dependencyEvaluate).toHaveBeenCalledWith(OWNER.ownerWorkspaceId, OWNER.processId, dependent.id, { signal: expect.any(AbortSignal) });
    });
    it.each(['row', 'strip', 'toolbar'])('renders collapsed findings and archives accepted Obsolete through %s', async entryPoint => {
        applyRuntimeConfigPatch({ sentinelTodoScrubberEnabled: true });
        get.mockResolvedValue(ledger([item()]));
        scrubGet.mockResolvedValue({ config: { enabled: false, cron: '0 9 * * *', paused: false, consecutiveFailures: 0, revision: 0 },
            runs: [{ id: 'r1', status: 'completed', trigger: 'manual', createdAt: '2026-10-11T00:00:00Z', counts: { done: 0, proposals: 1, unverified: 0 }, itemCount: 1, deferredCount: 0, awaitingReviewCount: 0 }] });
        const finding = { runId: 'r1', itemId: 'i1', itemRevision: 1, state: 'proposed', fingerprint: 'f1', audit: [],
            finding: { itemId: 'i1', verdict: 'obsolete', confidence: 'high', summary: 'Superseded', rationale: 'Replacement landed', autoApply: false,
                evidence: [{ kind: 'pr', ref: '#902', state: 'merged', checkedAt: '2026-10-11T01:00:00Z' }] } };
        scrubGetRun.mockResolvedValue({ findings: [finding] });
        scrubAccept.mockImplementation(async () => {
            get.mockResolvedValue(ledger([item({ status: 'done', archived: true, revision: 2, outcome: { summary: 'Obsolete: Superseded', recordedAt: '2026-10-11T01:00:00Z', recordedBy: 'user' } })], 2));
            scrubGetRun.mockResolvedValue({ findings: [{ ...finding, state: 'accepted' }] });
            return {};
        });
        render(<UnifiedTodoTab owner={OWNER} />);
        await screen.findByText('◇ Proposal: Obsolete (high)');
        expect(screen.queryByTestId('sentinel-todo-i1-details')).toBeNull();
        const row = screen.getByTestId('sentinel-todo-row-i1');
        if (entryPoint === 'row') fireEvent.click(within(row).getByRole('button', { name: 'Accept' }));
        else fireEvent.click(within(entryPoint === 'strip' ? screen.getByTestId('sentinel-scrubber-strip')
            : screen.getByRole('toolbar', { name: 'To-do actions' })).getByRole('button', { name: 'Accept all proposals' }));
        await waitFor(() => expect(screen.queryByText('◇ Proposal: Obsolete (high)')).toBeNull());
        expect(scrubAccept).toHaveBeenCalledExactlyOnceWith('ws-1', 'queue_sentinel', 'r1', 'i1', { expectedItemRevision: 1 });
        expect(get).toHaveBeenCalledTimes(2);
        fireEvent.click(within(screen.getByTestId('sentinel-todo-archived-section')).getByRole('button', { name: 'Archived (1)' }));
        await screen.findByTestId('sentinel-todo-row-i1');
    });

    it('mounts the enabled scrubber once in the list column below triggers only after the ledger loads', async () => {
        applyRuntimeConfigPatch({ sentinelTodoScrubberEnabled: true, triggersEnabled: true });
        const read = deferred<SentinelTodoLedgerResponse>();
        get.mockReturnValue(read.promise);
        scrubGet.mockResolvedValue({ config: { enabled: false, cron: '0 9 * * *', paused: false, consecutiveFailures: 0, revision: 0 }, runs: [] });
        render(<UnifiedTodoTab owner={OWNER} />);
        expect(screen.queryByTestId('sentinel-scrubber-strip')).toBeNull();
        expect(scrubGet).not.toHaveBeenCalled();
        await act(async () => read.resolve(ledger([item()])));
        await screen.findByText('Manual only');
        expect(scrubGet).toHaveBeenCalledWith(OWNER.ownerWorkspaceId, OWNER.processId);
        expect(screen.getAllByTestId('sentinel-scrubber-strip')).toHaveLength(1);
        const strip = screen.getByTestId('sentinel-scrubber-strip');
        const list = screen.getByTestId('sentinel-todo-list');
        const addTrigger = await within(list).findByRole('button', { name: '+ Add trigger' });
        const follows = (a: Node, b: Node) => !!(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
        expect(list.contains(strip)).toBe(true);
        expect(screen.getByTestId('sentinel-todo-details').contains(strip)).toBe(false);
        expect(follows(screen.getByTestId('sentinel-todo-row-i1'), strip)).toBe(true);
        expect(follows(addTrigger, strip)).toBe(true);
        expect(follows(screen.getByRole('toolbar', { name: 'To-do actions' }), list)).toBe(true);
        expect(strip.className).not.toMatch(/\bsticky\b/);
        for (const name of ['Scrub now', 'Schedule ▾', 'History (0)', 'Select items']) within(strip).getByRole('button', { name });
        fireEvent.click(within(strip).getByRole('button', { name: 'Select items' }));
        expect(list.contains(within(strip).getByRole('group', { name: 'Select open items' }))).toBe(true);
        fireEvent.click(within(strip).getByRole('button', { name: 'Schedule ▾' }));
        const schedule = within(list).getByRole('form', { name: 'Scrubber schedule' });
        expect(schedule.className).not.toMatch(/\babsolute\b/);
        fireEvent.click(within(strip).getByRole('button', { name: 'History (0)' }));
        const history = within(list).getByRole('region', { name: 'Scrubber run history' });
        expect(follows(strip, history)).toBe(true);
        fireEvent.click(screen.getByRole('button', { name: /Fix login/ }));
        expect(screen.getAllByTestId('sentinel-scrubber-strip')).toHaveLength(1);
        expect(scrubGet).toHaveBeenCalledOnce();
    });

    it('resolves latest and earlier job owners independently of targetRepo and preserves links', async () => {
        ownerWorkspaces.push(
            { id: 'ws-1', name: 'shortcuts' },
            { id: 'ws-child', name: 'shortcuts-2' },
            { id: 'ws-child', name: 'remote-checkout', remote: { serverId: 'server-a', serverLabel: 'Build machine' } },
            { id: 'ws-child', name: 'other-checkout', remote: { serverId: 'server-b', serverLabel: 'Test machine' } },
        );
        const jobs: SentinelTodoItem['jobs'] = [
            { processId: 'current', workspaceId: 'ws-1', kind: 'local', title: 'Current job', mode: 'ask',
                openLink: '#repos/ws-1/chats/current', linkedAt: '2026-10-11', execution: { state: 'completed' } },
            { processId: 'remote-a', workspaceId: 'ws-child', kind: 'remote', serverId: 'server-a', title: 'First remote job', mode: 'autopilot',
                openLink: 'https://owner-a.example/#repos/ws-child/chats/remote-a', linkedAt: '2026-10-11', execution: { state: 'unavailable' } },
            { processId: 'remote-b', workspaceId: 'ws-child', kind: 'remote', serverId: 'server-b', title: 'Other remote job', mode: 'ask',
                openLink: 'https://owner-b.example/#repos/ws-child/chats/remote-b', linkedAt: '2026-10-11', execution: { state: 'unavailable' } },
            { processId: 'latest', workspaceId: 'ws-child', kind: 'ralph', sessionId: 'session', title: 'Latest local job',
                openLink: '#repos/ws-child/activity/ralph/session', linkedAt: '2026-10-11', execution: { state: 'running' } },
        ];
        get.mockResolvedValue(ledger([item({ jobs, targetRepo: { workspaceId: 'ws-child', serverId: 'server-b', label: 'Wrong target label' } })]));
        render(<UnifiedTodoTab owner={OWNER} scopeWorkspaceId="ws-1" />);
        let row = await screen.findByTestId('sentinel-todo-row-i1');
        expect(within(row).getByTestId('sentinel-todo-job-owner').textContent).toBe('shortcuts-2');
        expect(within(row).getByTestId('sentinel-todo-job-mode').textContent).toBe('Ralph');
        expect(within(row).getByTestId('sentinel-todo-earlier-jobs-i1').textContent).toBe('+3 earlier jobs');
        fireEvent.click(within(row).getByRole('button', { name: /Fix login/ }));
        row = screen.getByTestId(row.dataset.testid!.replace('sentinel-todo-row-', 'sentinel-todo-detail-'));
        for (const [title, label, mode] of [
            ['Current job', null, 'Ask'],
            ['First remote job', 'Build machine / remote-checkout', 'Autopilot'],
            ['Other remote job', 'Test machine / other-checkout', 'Ask'],
            ['Latest local job', 'shortcuts-2', 'Ralph'],
        ] as const) {
            const link = within(row).getByRole('link', { name: title, exact: true });
            const jobRow = within(link.closest('li')!);
            expect(jobRow.queryByTestId('sentinel-todo-job-owner')?.textContent ?? null).toBe(label);
            expect(jobRow.getByTestId('sentinel-todo-job-mode').textContent).toBe(mode);
            expect(link.getAttribute('href')).toBe(jobs.find(job => job.title === title)!.openLink);
        }
        expect(row.textContent).not.toContain('ws-child @');
        expect(get).toHaveBeenCalledTimes(1);
        expect(connect).toHaveBeenCalledTimes(1);
        expect(create).not.toHaveBeenCalled(); expect(update).not.toHaveBeenCalled();
    });
    it.each(['normal', 'manual'] as const)('copy-drags and attaches a %s row without ledger writes or execution', async type => {
        applyRuntimeConfigPatch({ sessionContextAttachmentsEnabled: true });
        get.mockResolvedValue(ledger([item({ type })]));
        render(<UnifiedTodoTab owner={OWNER} />);
        await screen.findByText('Fix login');
        const setData = vi.fn();
        const dataTransfer = { setData, effectAllowed: 'none' };
        fireEvent.dragStart(screen.getByTestId('sentinel-todo-row-i1'), { dataTransfer });
        expect(dataTransfer.effectAllowed).toBe('copy');
        const payload = JSON.parse(setData.mock.calls.find(call => call[0] === POINTER_CONTEXT_DRAG_MIME)![1]);
        expect(payload).toMatchObject({
            kind: 'coc.sentinel-todo-context', sourceWorkspaceId: 'ws-1',
            sourceProcessId: 'queue_sentinel', todoItemId: 'i1', title: 'Fix login', sourceRoutingRef: null,
        });
        expect(payload).not.toHaveProperty('notes');
        expect(payload).not.toHaveProperty('jobs');
        const receive = vi.fn();
        subscribeActiveChatAttach('ws-1', receive);
        fireEvent.click(screen.getByRole('button', { name: 'More actions' }));
        fireEvent.click(screen.getByRole('menuitem', { name: 'Attach' }));
        expect(receive).toHaveBeenCalledWith(payload);
        expect(create).not.toHaveBeenCalled();
        expect(update).not.toHaveBeenCalled();
    });

    it.each(['normal', 'manual'] as const)('isolates the %s card menu and supports keyboard dismissal and attachment', async type => {
        const user = userEvent.setup();
        applyRuntimeConfigPatch({ sessionContextAttachmentsEnabled: true });
        get.mockResolvedValue(ledger([item({ type })]));
        const bubbled = vi.fn();
        render(<div onPointerDown={bubbled} onMouseDown={bubbled} onClick={bubbled}
            onKeyDown={bubbled} onKeyUp={bubbled} onDragStart={bubbled}>
            <UnifiedTodoTab owner={OWNER} />
        </div>);
        const row = await screen.findByTestId('sentinel-todo-row-i1');
        const trigger = within(row).getByRole('button', { name: 'More actions' });
        const selection = within(row).getByRole('button', { pressed: false });
        const receive = vi.fn();
        subscribeActiveChatAttach('ws-1', receive);
        expect(within(row).queryByRole('button', { name: /Attach/ })).toBeNull();
        expect(screen.queryByRole('menu')).toBeNull();
        trigger.focus();
        await user.keyboard('{ArrowDown}');
        expect(screen.getAllByRole('menuitem')).toHaveLength(1);
        expect(document.activeElement).toBe(screen.getByRole('menuitem', { name: 'Attach' }));
        await user.keyboard('{End}{Home}{ArrowUp}{Escape}');
        expect(screen.queryByRole('menu')).toBeNull();
        expect(document.activeElement).toBe(trigger);
        await user.keyboard('{ArrowUp}{Tab}');
        expect(screen.queryByRole('menu')).toBeNull();
        expect(document.activeElement).toBe(trigger);
        await user.click(trigger);
        expect(fireEvent.dragStart(trigger, { dataTransfer: { setData: vi.fn() } })).toBe(false);
        await user.click(screen.getByRole('menuitem', { name: 'Attach' }));
        expect(receive).toHaveBeenCalledTimes(1);
        expect(document.activeElement).toBe(trigger);
        expect(selection.getAttribute('aria-pressed')).toBe('false');
        expect(bubbled).not.toHaveBeenCalled();
        await user.keyboard('{Enter}');
        await user.keyboard(' ');
        expect(receive).toHaveBeenCalledTimes(2);
        expect(screen.queryByRole('menu')).toBeNull();
        expect(document.activeElement).toBe(trigger);
        await user.click(trigger);
        fireEvent.mouseDown(document.body);
        expect(screen.queryByRole('menu')).toBeNull();
        expect(update).not.toHaveBeenCalled();
        expect(create).not.toHaveBeenCalled();
    });

    it('keeps the card popup inside the viewport near its lower right corner', async () => {
        applyRuntimeConfigPatch({ sessionContextAttachmentsEnabled: true });
        get.mockResolvedValue(ledger([item()]));
        render(<UnifiedTodoTab owner={OWNER} />);
        const row = await screen.findByTestId('sentinel-todo-row-i1');
        const trigger = within(row).getByRole('button', { name: 'More actions' });
        const measure = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function () {
            return this.getAttribute('role') === 'menu'
                ? { width: 248, height: 40 } as DOMRect
                : { right: window.innerWidth - 2, top: window.innerHeight - 26, bottom: window.innerHeight - 2 } as DOMRect;
        });
        try {
            fireEvent.click(trigger);
            const menu = screen.getByRole('menu');
            expect(parseFloat(menu.style.left)).toBeGreaterThanOrEqual(8);
            expect(parseFloat(menu.style.left) + 248).toBeLessThanOrEqual(window.innerWidth - 8);
            expect(parseFloat(menu.style.top) + 40).toBeLessThanOrEqual(window.innerHeight - 8);
        } finally {
            measure.mockRestore();
        }
    });

    it('hides card actions and disables dragging when context attachments are disabled', async () => {
        applyRuntimeConfigPatch({ sessionContextAttachmentsEnabled: false });
        get.mockResolvedValue(ledger([item(), item({ id: 'manual', type: 'manual' })]));
        render(<UnifiedTodoTab owner={OWNER} />);
        for (const id of ['i1', 'manual']) {
            const row = await screen.findByTestId(`sentinel-todo-row-${id}`);
            expect(row.draggable).toBe(false);
            expect(within(row).queryByRole('button', { name: 'More actions' })).toBeNull();
        }
        expect(screen.queryByRole('menu')).toBeNull();
    });

    it('routes menu attachments only to the concrete owning clone', async () => {
        applyRuntimeConfigPatch({ sessionContextAttachmentsEnabled: true });
        registerCloneBaseUrls([{ workspaceId: 'ws-1', serverId: 'srv-2', baseUrl: 'https://owner.example' }]);
        const owner = { ...OWNER, ownerRoutingRef: 'remote:srv-2:ws-1' };
        get.mockResolvedValue(ledger([item()]));
        render(<UnifiedTodoTab owner={owner} />);
        const row = await screen.findByTestId('sentinel-todo-row-i1');
        const local = vi.fn();
        const remote = vi.fn();
        subscribeActiveChatAttach('ws-1', local);
        subscribeActiveChatAttach(owner.ownerRoutingRef, remote);
        fireEvent.click(within(row).getByRole('button', { name: 'More actions' }));
        fireEvent.click(screen.getByRole('menuitem', { name: 'Attach' }));
        expect(remote).toHaveBeenCalledWith(expect.objectContaining({
            sourceWorkspaceId: 'ws-1', sourceProcessId: OWNER.processId,
            sourceRoutingRef: owner.ownerRoutingRef, todoItemId: 'i1',
        }));
        expect(local).not.toHaveBeenCalled();
        expect(update).not.toHaveBeenCalled();
        expect(create).not.toHaveBeenCalled();
    });

    it('shows collapsed-row feedback when the owning Sentinel composer is unavailable', async () => {
        applyRuntimeConfigPatch({ sessionContextAttachmentsEnabled: true });
        get.mockResolvedValue(ledger([item()]));
        render(<UnifiedTodoTab owner={OWNER} />);
        await screen.findByText('Fix login');
        fireEvent.click(screen.getByRole('button', { name: 'More actions' }));
        fireEvent.click(screen.getByRole('menuitem', { name: 'Attach' }));
        expect(screen.getByTestId('sentinel-todo-attach-error-i1').textContent).toContain('Open the owning Sentinel');
        expect(update).not.toHaveBeenCalled();
    });

    it.each([
        { state: 'queued', label: 'Queued' },
        { state: 'running', label: 'Running' },
        { state: 'unknown', label: 'Status unknown' },
        { state: 'completed', label: 'Completed' },
        { state: 'failed', label: 'Job failed' },
        { state: 'cancelled', label: 'Job cancelled' },
        { state: 'capped', label: 'Job capped' },
        { state: 'unavailable', label: 'Status unavailable' },
    ] as const)('keeps an accessible $state execution pill separate from Ralph, review and To-do status after reload', async ({ state, label }) => {
        const remote = state === 'unavailable';
        const linked = item({ status: 'in_progress', jobs: [{
            processId: 'queue_child', workspaceId: 'ws-child', kind: remote ? 'remote' : 'ralph',
            sessionId: 'session-1', ...(remote ? { serverId: 'srv-2' } : {}),
            title: 'Exclusive writer', openLink: remote ? 'https://example.test/#/process/queue_child' : '#/process/queue_child',
            linkedAt: item().createdAt,
            execution: state === 'completed'
                ? { state, review: { state: 'delivered', assessment: 'pending' } } : { state },
        }] });
        get.mockResolvedValue(ledger([linked]));
        const { unmount } = render(<div style={{ width: 220 }}><UnifiedTodoTab owner={OWNER} /></div>);
        async function assertJob() {
            const card = await screen.findByTestId('sentinel-todo-row-i1');
            const badge = within(card).getByText('Ralph', { exact: true });
            expect(badge.getAttribute('title')).toBe('Ralph session');
            expect(badge.getAttribute('aria-hidden')).toBeNull();
            expect(badge.className).toContain('shrink-0');
            const jobs = within(card).getByRole('list', { name: 'Jobs for Fix login' });
            expect(jobs.textContent).toContain(label);
            const execution = within(jobs).getByTestId('sentinel-todo-job-execution');
            expect(execution.textContent).toBe(label);
            expect(execution.getAttribute('aria-label')).toBe(`Job execution: ${label}`);
            expect(execution.getAttribute('title')).toBe(label);
            expect(execution.getAttribute('data-status')).toBe(state);
            expect(execution.className).toContain('rounded-full');
            expect(execution.className).toContain('shrink-0');
            expect(execution.className).toContain('whitespace-nowrap');
            expect(execution.querySelector('[aria-hidden="true"]')).toBeTruthy();
            expect(jobs.className).toContain('flex-wrap');
            expect(badge.closest('li')?.className).toContain('flex-wrap');
            const link = within(jobs).getByRole('link', { name: 'Exclusive writer' });
            expect(link.getAttribute('href')).toBe(linked.jobs[0].openLink);
            expect(link.getAttribute('target')).toBe(remote ? '_blank' : null);
            expect(within(card).getByTestId(`sentinel-todo-status-${state === 'completed' ? 'in_review' : 'in_progress'}`)).toBeTruthy();
            if (state === 'completed') {
                expect(execution.className).toContain('text-[#16825d]');
                expect(execution.querySelector('[aria-hidden="true"]')?.className).toContain('bg-[#16825d]');
                expect(jobs.textContent).toContain('Review pending (result delivered)');
            }
        }
        await assertJob();
        const row = screen.getByTestId('sentinel-todo-row-i1');
        fireEvent.click(within(row).getByRole('button', { pressed: false, name: /Fix login/ }));
        const detail = screen.getByTestId('sentinel-todo-detail-i1');
        const detailExecution = within(detail).getByTestId('sentinel-todo-job-execution');
        expect(detailExecution.textContent).toBe(label);
        expect(detailExecution.getAttribute('aria-label')).toBe(`Job execution: ${label}`);
        expect(detailExecution.getAttribute('data-status')).toBe(state);
        expect(detailExecution.closest('li')?.className).toContain('flex-wrap');
        if (state === 'completed') {
            expect(detailExecution.textContent).not.toContain('Review');
            expect(within(detail).getByText('· Review pending (result delivered)')).toBeTruthy();
        }
        unmount();
        render(<UnifiedTodoTab owner={OWNER} />);
        await assertJob();
        expect(create).not.toHaveBeenCalled();
        expect(update).not.toHaveBeenCalled();
    });

    it('shows each job’s own compact mode in collapsed and expanded rows and refreshes follow-up changes', async () => {
        const jobs: SentinelTodoItem['jobs'] = [
            { processId: 'queue_design', workspaceId: 'ws-child', kind: 'local', title: 'Design', mode: 'ask',
                openLink: '#/process/queue_design', linkedAt: item().createdAt, execution: { state: 'completed' } },
            { processId: 'queue_build', workspaceId: 'ws-child', kind: 'local', title: 'Build', mode: 'autopilot',
                openLink: '#/process/queue_build', linkedAt: item().createdAt, execution: { state: 'queued' } },
        ];
        get.mockResolvedValue(ledger([item({ jobs })]));
        render(<div style={{ width: 180 }}><UnifiedTodoTab owner={OWNER} /></div>);
        let row = await screen.findByTestId('sentinel-todo-row-i1');
        expect(within(row).getByTestId('sentinel-todo-job-mode').textContent).toBe('Autopilot');
        expect(within(row).queryByText('Ask', { exact: true })).toBeNull();
        expect(within(row).queryByRole('button', { name: /^Preview job:/ })).toBeNull();
        expect(within(row).queryByText('ⓘ')).toBeNull();
        expect(within(row).getByRole('link', { name: 'Build' }).getAttribute('href')).toBe('#/process/queue_build');
        expect(within(row).getByTestId('sentinel-todo-job-owner')).toBeTruthy();
        fireEvent.click(within(row).getByRole('button', { pressed: false, name: /Fix login/ }));
        row = screen.getByTestId(row.dataset.testid!.replace('sentinel-todo-row-', 'sentinel-todo-detail-'));
        const designRow = within(row).getByRole('link', { name: 'Design' }).closest('li')!;
        const buildRow = within(row).getByRole('link', { name: 'Build' }).closest('li')!;
        expect(within(row).queryByRole('button', { name: /^Preview job:/ })).toBeNull();
        expect(within(row).queryByText('ⓘ')).toBeNull();
        expect(within(designRow).getByRole('link', { name: 'Design' }).getAttribute('href')).toBe('#/process/queue_design');
        expect(within(buildRow).getByRole('link', { name: 'Build' }).getAttribute('href')).toBe('#/process/queue_build');
        expect(within(designRow).getByTestId('sentinel-todo-job-owner')).toBeTruthy();
        expect(within(buildRow).getByTestId('sentinel-todo-job-owner')).toBeTruthy();
        expect(within(designRow).getByTestId('sentinel-todo-job-mode').textContent).toBe('Ask');
        expect(within(buildRow).getByTestId('sentinel-todo-job-mode').textContent).toBe('Autopilot');
        expect(within(buildRow).getByTestId('sentinel-todo-job-mode').getAttribute('tabindex')).toBeNull();
        expect(buildRow.className).toContain('flex-wrap');
        expect(within(buildRow).getByRole('link').parentElement?.className).toContain('flex-wrap');
        get.mockResolvedValue(ledger([item({ jobs: [{ ...jobs[0], mode: 'autopilot' }, jobs[1]] })]));
        act(() => connect.mock.calls[0][0].onMessage({ type: 'sentinel-todos-changed',
            workspaceId: OWNER.ownerWorkspaceId, processId: OWNER.processId, ledgerRevision: 1, itemId: 'i1' }));
        await waitFor(() => expect(within(designRow).getByTestId('sentinel-todo-job-mode').textContent).toBe('Autopilot'));
        expect(create).not.toHaveBeenCalled(); expect(update).not.toHaveBeenCalled();
    });

    it('uses persisted Ralph kind even without session lookup and never guesses from ordinary titles or IDs', async () => {
        get.mockResolvedValue(ledger([item({ jobs: [
            { processId: 'queue_child', workspaceId: 'ws-child', kind: 'ralph', title: 'Writer',
                openLink: '#/process/queue_child', linkedAt: item().createdAt, execution: { state: 'running' } },
            { processId: 'queue_ralph-looking', workspaceId: 'ws-child', kind: 'local', title: 'Ralph ordinary ask',
                openLink: '#/process/queue_ralph-looking', linkedAt: item().createdAt, execution: { state: 'queued' } },
            { processId: 'queue_auto', workspaceId: 'ws-child', kind: 'remote', serverId: 'srv-2', title: 'Ralph ordinary autopilot',
                openLink: '#/process/queue_auto', linkedAt: item().createdAt, execution: { state: 'unavailable' } },
        ] })]));
        render(<UnifiedTodoTab owner={OWNER} />);
        // List cards show only the latest job; details list every attempt.
        let row = await screen.findByTestId('sentinel-todo-row-i1');
        expect(within(row).getByTestId('sentinel-todo-earlier-jobs-i1').textContent).toBe('+2 earlier jobs');
        expect(within(row).queryByRole('link', { name: 'Writer' })).toBeNull();
        fireEvent.click(within(row).getByRole('button', { pressed: false, name: /Fix login/ }));
        row = screen.getByTestId(row.dataset.testid!.replace('sentinel-todo-row-', 'sentinel-todo-detail-'));
        expect(within(row).queryByTestId('sentinel-todo-earlier-jobs-i1')).toBeNull();
        await screen.findByText('Ralph', { exact: true });
        expect(screen.getAllByText('Ralph', { exact: true })).toHaveLength(1);
        for (const title of ['Ralph ordinary ask', 'Ralph ordinary autopilot']) {
            expect(within(within(row).getByRole('link', { name: title }).closest('li')!).queryByText('Ralph', { exact: true })).toBeNull();
        }
    });

    it('renders an accessible derived In review badge and refreshes assessment from the exact remote owner', async () => {
        registerCloneBaseUrls([{ workspaceId: 'ws-1', serverId: 'srv-2', baseUrl: 'https://owner.example' }]);
        const pending = item({
            status: 'in_progress', revision: 4, jobs: [{
                processId: 'queue_child', workspaceId: 'ws-child', kind: 'local',
                openLink: '#repos/ws-child/chats/queue_child', linkedAt: item().createdAt,
                execution: { state: 'completed', review: { state: 'delivered', assessment: 'pending' } },
            }],
        });
        const owner = { ...OWNER, ownerRoutingRef: 'remote:srv-2:ws-1' };
        get.mockResolvedValue(ledger([pending], 4));
        render(<UnifiedTodoTab owner={owner} />);
        const badge = await screen.findByTestId('sentinel-todo-status-in_review');
        assertIconOnlyStatus(badge, 'In review', '◇');
        expect(badge.textContent).toContain('In review');
        expect(badge.querySelector('[aria-hidden="true"]')?.textContent).toBe('◇');
        expect(clientRefs).toContain(owner.ownerRoutingRef);
        let row = screen.getByTestId('sentinel-todo-row-i1');
        expect(row.textContent).toContain('Review pending (result delivered)');
        fireEvent.click(within(row).getByRole('button', { pressed: false, name: /Fix login/ }));
        row = screen.getByTestId(row.dataset.testid!.replace('sentinel-todo-row-', 'sentinel-todo-detail-'));
        const detailBadge = within(row).getByTestId('sentinel-todo-status-in_review');
        assertIconOnlyStatus(detailBadge, 'In review', '◇');
        expect(detailBadge.className).toBe(badge.className);
        // Derived phases are not stored statuses or new user execution actions.
        const status = within(row).getByRole('group', { name: 'Status' });
        expect(within(status).getByRole('button', { pressed: true }).textContent).toContain('In progress');
        expect(status.textContent).not.toContain('In review');
        expect(within(row).getByTestId('sentinel-todo-derived-i1').textContent).toMatch(/Shown as In review.*Saved status: In progress\./s);
        expect(within(row).getByRole('button', { name: 'Edit' })).toBeTruthy();
        const { onMessage } = connect.mock.calls[0][0];
        act(() => onMessage({ type: 'sentinel-todos-changed', workspaceId: 'ws-2', processId: OWNER.processId, ledgerRevision: 5 }));
        expect(get).toHaveBeenCalledTimes(1);
        get.mockResolvedValue(ledger([item({ ...pending, status: 'todo', revision: 5,
            jobs: [{ ...pending.jobs[0], execution: { state: 'completed', review: { state: 'delivered', assessment: 'reviewed' } } }],
        })], 5));
        act(() => onMessage({ type: 'sentinel-todos-changed', workspaceId: OWNER.ownerWorkspaceId, processId: OWNER.processId, ledgerRevision: 5 }));
        await within(row).findByTestId('sentinel-todo-status-todo');
        expect(screen.queryByTestId('sentinel-todo-status-in_review')).toBeNull();
        expect(row.textContent).toContain('Reviewed');
        expect(update).not.toHaveBeenCalled();
    });

    it('discards old-server review evidence after changing only the clone route', async () => {
        registerCloneBaseUrls([
            { workspaceId: 'ws-1', serverId: 'srv-1', baseUrl: 'https://first.example' },
            { workspaceId: 'ws-1', serverId: 'srv-2', baseUrl: 'https://second.example' },
        ]);
        const slow = deferred<SentinelTodoLedgerResponse>();
        get.mockReturnValueOnce(slow.promise).mockResolvedValue(ledger([item({ status: 'todo' })]));
        const { rerender } = render(<UnifiedTodoTab owner={{ ...OWNER, ownerRoutingRef: 'remote:srv-1:ws-1' }} />);
        rerender(<UnifiedTodoTab owner={{ ...OWNER, ownerRoutingRef: 'remote:srv-2:ws-1' }} />);
        await screen.findByTestId('sentinel-todo-status-todo');
        await act(async () => slow.resolve(ledger([item({ status: 'in_progress', jobs: [{
            processId: 'queue_child', workspaceId: 'ws-child', kind: 'local', openLink: '#', linkedAt: item().createdAt,
            execution: { state: 'completed', review: { state: 'delivered', assessment: 'pending' } },
        }] })])));
        expect(screen.queryByTestId('sentinel-todo-status-in_review')).toBeNull();
        expect(screen.getByTestId('sentinel-todo-status-todo')).toBeTruthy();
    });

    it('shows loading, never the empty state, until the ledger arrives', async () => {
        const pending = deferred<SentinelTodoLedgerResponse>();
        get.mockReturnValue(pending.promise);
        render(<UnifiedTodoTab owner={OWNER} />);
        expect(screen.getByTestId('sentinel-todo-loading')).toBeTruthy();
        expect(screen.queryByTestId('sentinel-todo-empty')).toBeNull();
        await act(async () => pending.resolve(ledger([])));
        expect(screen.getByTestId('sentinel-todo-empty').textContent).toMatch(/Nothing is tracked yet/);
        expect(get).toHaveBeenCalledWith('ws-1', 'queue_sentinel', { full: true });
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
            // List cards show only Updated, in a muted meta row that wraps in narrow panes.
            const updated = await screen.findByTestId('sentinel-todo-updated-i1');
            const meta = screen.getByTestId('sentinel-todo-meta-i1');
            expect(meta.contains(updated)).toBe(true);
            expect(meta.className).toContain('flex-wrap');
            expect(meta.className).toContain('dark:text-[#9d9d9d]');
            expect(screen.queryByTestId('sentinel-todo-created-i1')).toBeNull();
            fireEvent.click(within(screen.getByTestId('sentinel-todo-row-i1')).getByRole('button', { pressed: false }));
            const created = screen.getByTestId('sentinel-todo-created-i1');
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
            expect(screen.getByTestId('sentinel-todo-times-i1').contains(created)).toBe(true);
        } finally {
            vi.useRealTimers();
        }
    });

    it('omits a timestamp the ledger reports as unparseable', async () => {
        get.mockResolvedValue(ledger([item({ updatedAt: 'not-a-date' })]));
        render(<UnifiedTodoTab owner={OWNER} />);
        fireEvent.click(within(await screen.findByTestId('sentinel-todo-row-i1')).getByRole('button', { pressed: false }));
        expect(screen.getByTestId('sentinel-todo-created-i1')).toBeTruthy();
        expect(screen.queryByTestId('sentinel-todo-updated-i1')).toBeNull();
    });

    it('selects an item to show the completion condition, notes, and outcome', async () => {
        get.mockResolvedValue(ledger([item({
            status: 'done', outcome: { summary: 'Verified login test', recordedAt: '2026-10-09T00:00:00.000Z', recordedBy: 'sentinel' },
        })]));
        render(<UnifiedTodoTab owner={OWNER} />);
        fireEvent.click(await screen.findByRole('button', { name: 'Done (1)' }));
        const toggle = within(screen.getByTestId('sentinel-todo-row-i1')).getByRole('button', { pressed: false });
        fireEvent.click(toggle);
        expect(toggle.getAttribute('aria-pressed')).toBe('true');
        expect(screen.getByText('Login test passes')).toBeTruthy();
        expect(screen.getByText('Check SSO too')).toBeTruthy();
        expect(screen.getByTestId('sentinel-todo-outcome-i1').textContent).toContain('Verified login test');
    });

    it('edits with the base revision and keeps the draft on a conflict', async () => {
        const current = item({ title: 'Fix login (renamed)', revision: 3 });
        get.mockResolvedValueOnce(ledger([item({ revision: 2 })])).mockResolvedValue(ledger([current]));
        update.mockRejectedValueOnce(conflict(current)).mockResolvedValue({ item: current, ledgerRevision: 5 });
        render(<UnifiedTodoTab owner={OWNER} />);
        fireEvent.click(await screen.findByRole('button', { pressed: false }));
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
        fireEvent.click(await screen.findByRole('button', { pressed: false }));
        fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
        expect((screen.getByLabelText('Priority') as HTMLSelectElement).value).toBe('regular');
        fireEvent.change(screen.getByLabelText('Priority'), { target: { value: 'high' } });
        fireEvent.click(screen.getByRole('button', { name: 'Save' }));
        await within(screen.getByTestId('sentinel-todo-detail-i1')).findByTestId('sentinel-todo-priority-high-i1');
        const patch = update.mock.calls[0][3];
        expect(patch).toMatchObject({ expectedRevision: 1, priority: 'high', title: 'Fix login' });
        expect(patch).not.toHaveProperty('status');
        expect(patch).not.toHaveProperty('statusReason');
        expect(patch).not.toHaveProperty('outcome');
        expect(within(screen.getByTestId('sentinel-todo-detail-i1')).getByTestId('sentinel-todo-status-needs_attention')).toBeTruthy();
    });

    it('marks High rows with a red leading band and a High label, in list and detail, and Regular rows with neither', async () => {
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
        expect(within(high).getByRole('button', { pressed: false }).textContent).toContain('High priority');
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

        fireEvent.click(within(high).getByRole('button', { pressed: false }));
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
        const toggle = within(row).getByRole('button', { pressed: false });
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
        fireEvent.click(await screen.findByRole('button', { pressed: false }));
        chooseStatus(document.body, 'Done');
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
        fireEvent.click(await screen.findByRole('button', { pressed: false }));
        chooseStatus(document.body, 'Done');
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
        fireEvent.click(await screen.findByRole('button', { pressed: false }));
        chooseStatus(document.body, 'Needs attention');
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
        fireEvent.click(within(screen.getByTestId('sentinel-todo-row-i1')).getByRole('button', { pressed: false }));
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

    it('manually reloads without writes, retains rows while loading and blocks duplicate admission', async () => {
        const initial = deferred<SentinelTodoLedgerResponse>();
        const pending = deferred<SentinelTodoLedgerResponse>();
        get.mockReturnValueOnce(initial.promise);
        render(<UnifiedTodoTab owner={OWNER} />);
        const refresh = screen.getByRole('button', { name: 'Refresh to-do list' });
        expect(refresh.getAttribute('title')).toBe('Refresh to-do list');
        expect(refresh.getAttribute('aria-busy')).toBe('true');
        expect((refresh as HTMLButtonElement).disabled).toBe(true);
        fireEvent.click(refresh);
        expect(get).toHaveBeenCalledTimes(1);
        await act(async () => initial.resolve(ledger([item()])));
        expect(refresh.nextElementSibling).toBe(screen.getByTestId('sentinel-todo-add'));
        expect((refresh as HTMLButtonElement).disabled).toBe(false);
        // Re-enter before React paints disabled to exercise synchronous admission.
        get.mockImplementationOnce(() => { fireEvent.click(refresh); return pending.promise; });
        fireEvent.click(refresh);
        fireEvent.click(refresh);
        expect(get).toHaveBeenCalledTimes(2);
        expect(get).toHaveBeenLastCalledWith('ws-1', 'queue_sentinel', { full: true });
        expect(refresh.getAttribute('aria-busy')).toBe('true');
        expect(refresh.querySelector('svg')?.classList.contains('motion-safe:animate-spin')).toBe(true);
        expect(screen.getByTestId('sentinel-todo-row-i1')).toBeTruthy();
        await act(async () => pending.resolve(ledger([item({ title: 'Fresh title', revision: 2 }), item({ id: 'i2', title: 'New item' })], 3)));
        expect(screen.getByText('Fresh title')).toBeTruthy();
        expect(screen.getByTestId('sentinel-todo-row-i2')).toBeTruthy();
        expect(refresh.getAttribute('aria-busy')).toBe('false');
        expect((refresh as HTMLButtonElement).disabled).toBe(false);
        expect(create).not.toHaveBeenCalled();
        expect(update).not.toHaveBeenCalled();
        expect(scrubGet).not.toHaveBeenCalled();
        expect(scrubAccept).not.toHaveBeenCalled();
    });

    it('keeps refresh busy across overlapping event reads and ignores the superseded manual response', async () => {
        const manual = deferred<SentinelTodoLedgerResponse>();
        const event = deferred<SentinelTodoLedgerResponse>();
        get.mockResolvedValueOnce(ledger([item()])).mockReturnValueOnce(manual.promise).mockReturnValueOnce(event.promise);
        render(<UnifiedTodoTab owner={OWNER} />);
        await screen.findByTestId('sentinel-todo-row-i1');
        const refresh = screen.getByRole('button', { name: 'Refresh to-do list' });
        fireEvent.click(refresh);
        const { onMessage } = connect.mock.calls[0][0];
        act(() => onMessage({ type: 'sentinel-todos-changed', workspaceId: 'ws-1', processId: OWNER.processId, ledgerRevision: 3 }));
        await act(async () => event.resolve(ledger([item({ title: 'Newest' })], 3)));
        expect(screen.getByText('Newest')).toBeTruthy();
        expect(refresh.getAttribute('aria-busy')).toBe('true');
        fireEvent.click(refresh);
        expect(get).toHaveBeenCalledTimes(3);
        await act(async () => manual.resolve(ledger([item({ title: 'Stale manual read' })], 2)));
        expect(screen.queryByText('Stale manual read')).toBeNull();
        expect(refresh.getAttribute('aria-busy')).toBe('false');
    });

    it('surfaces manual read failures without clearing the ledger and permits retry', async () => {
        const pending = deferred<SentinelTodoLedgerResponse>();
        const onErrorChange = vi.fn();
        get.mockResolvedValueOnce(ledger([item()])).mockReturnValueOnce(pending.promise).mockResolvedValue(ledger([item({ title: 'Recovered' })]));
        render(<UnifiedTodoTab owner={OWNER} onErrorChange={onErrorChange} />);
        await screen.findByTestId('sentinel-todo-row-i1');
        const refresh = screen.getByRole('button', { name: 'Refresh to-do list' });
        fireEvent.click(refresh);
        await act(async () => pending.reject(new Error('Read unavailable')));
        expect(screen.getByTestId('sentinel-todo-load-error').textContent).toContain('Read unavailable');
        expect(onErrorChange).toHaveBeenLastCalledWith(true);
        expect(screen.getByTestId('sentinel-todo-row-i1')).toBeTruthy();
        expect(screen.queryByTestId('sentinel-todo-empty')).toBeNull();
        expect((refresh as HTMLButtonElement).disabled).toBe(false);
        fireEvent.click(refresh);
        await screen.findByText('Recovered');
        expect(screen.queryByTestId('sentinel-todo-load-error')).toBeNull();
        expect(onErrorChange).toHaveBeenLastCalledWith(false);
        expect(refresh.getAttribute('aria-busy')).toBe('false');
    });

    it.each(['workspace', 'process', 'server'] as const)('isolates pending refresh success, failure and loading after a %s switch', async scope => {
        registerCloneBaseUrls([
            { workspaceId: 'ws-1', serverId: 'a', baseUrl: 'https://a.example' },
            { workspaceId: 'ws-1', serverId: 'b', baseUrl: 'https://b.example' },
        ]);
        const oldOwner = { ...OWNER, ownerRoutingRef: 'remote:a:ws-1' };
        const nextOwner = scope === 'workspace' ? { ...OWNER, ownerWorkspaceId: 'ws-2' }
            : scope === 'process' ? { ...oldOwner, processId: 'other-chat' }
            : { ...oldOwner, ownerRoutingRef: 'remote:b:ws-1' };
        const oldRefresh = deferred<SentinelTodoLedgerResponse>();
        const newRefresh = deferred<SentinelTodoLedgerResponse>();
        get.mockResolvedValueOnce(ledger([item()])).mockReturnValueOnce(oldRefresh.promise)
            .mockResolvedValueOnce(ledger([item({ title: 'New owner' })])).mockReturnValueOnce(newRefresh.promise);
        const mounted = render(<UnifiedTodoTab owner={oldOwner} />);
        await screen.findByTestId('sentinel-todo-row-i1');
        fireEvent.click(screen.getByRole('button', { name: 'Refresh to-do list' }));
        mounted.rerender(<UnifiedTodoTab owner={nextOwner} />);
        await screen.findByText('New owner');
        const refresh = screen.getByRole('button', { name: 'Refresh to-do list' });
        expect((refresh as HTMLButtonElement).disabled).toBe(false);
        fireEvent.click(refresh);
        expect(get).toHaveBeenLastCalledWith(nextOwner.ownerWorkspaceId, nextOwner.processId, { full: true });
        expect(clientRefs).toContain(nextOwner.ownerRoutingRef ?? nextOwner.ownerWorkspaceId);
        await act(async () => {
            if (scope === 'process') oldRefresh.reject(new Error('Old owner failure'));
            else oldRefresh.resolve(ledger([item({ title: 'Old owner stale' })]));
        });
        expect(refresh.getAttribute('aria-busy')).toBe('true');
        expect(screen.queryByText('Old owner stale')).toBeNull();
        expect(screen.queryByTestId('sentinel-todo-load-error')).toBeNull();
        await act(async () => newRefresh.resolve(ledger([item({ title: 'Current owner' })])));
        expect(screen.getByText('Current owner')).toBeTruthy();
        expect(refresh.getAttribute('aria-busy')).toBe('false');
    });

    it('retains detail edits, both add drafts and section filters on manual refresh', async () => {
        get.mockResolvedValueOnce(ledger([item(), item({ id: 'done', status: 'done' })]))
            .mockResolvedValue(ledger([item({ title: 'Server edit', revision: 2 }), item({ id: 'done', status: 'done' })], 3));
        render(<UnifiedTodoTab owner={OWNER} />);
        let row = await screen.findByTestId('sentinel-todo-row-i1');
        fireEvent.click(within(row).getByRole('button', { pressed: false }));
        row = screen.getByTestId(row.dataset.testid!.replace('sentinel-todo-row-', 'sentinel-todo-detail-'));
        fireEvent.click(within(row).getByRole('button', { name: 'Edit' }));
        const edit = within(row).getByLabelText('Title');
        fireEvent.change(edit, { target: { value: 'Unsaved edit' } });
        fireEvent.click(screen.getByTestId('sentinel-todo-add'));
        const add = within(screen.getByTestId('sentinel-todo-add-form')).getByLabelText('Title');
        fireEvent.change(add, { target: { value: 'Normal draft' } });
        fireEvent.click(screen.getByRole('button', { name: 'Add manual item' }));
        const manual = within(screen.getByTestId('sentinel-todo-manual-add-form')).getByLabelText('Title');
        fireEvent.change(manual, { target: { value: 'Manual draft' } });
        fireEvent.click(screen.getByRole('button', { name: /Done \(1\)/ }));
        fireEvent.click(screen.getByRole('button', { name: 'Refresh to-do list' }));
        await waitFor(() => expect(screen.getByTestId('sentinel-todo-refresh').getAttribute('aria-busy')).toBe('false'));
        expect(within(row).getByLabelText('Title')).toBe(edit);
        expect((edit as HTMLInputElement).value).toBe('Unsaved edit');
        expect((add as HTMLInputElement).value).toBe('Normal draft');
        expect((manual as HTMLInputElement).value).toBe('Manual draft');
        expect(screen.getByTestId('sentinel-todo-row-done')).toBeTruthy();
        expect(screen.getByRole('button', { name: /Done \(1\)/ }).getAttribute('aria-expanded')).toBe('true');
        expect(create).not.toHaveBeenCalled();
        expect(update).not.toHaveBeenCalled();
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
        expect(get).toHaveBeenLastCalledWith('ws-2', 'queue_two', { full: true });
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
        let row = await screen.findByTestId('sentinel-todo-row-i1');
        expect(within(row).getByTestId('sentinel-todo-status-in_progress')).toBeTruthy();
        fireEvent.click(within(row).getByRole('button', { pressed: false, name: /Fix login/ }));
        row = screen.getByTestId(row.dataset.testid!.replace('sentinel-todo-row-', 'sentinel-todo-detail-'));
        expect(row.textContent).toContain('Completed');
        expect(row.textContent).toContain('Review delivered');
        expect(row.textContent).toContain('Status unavailable');
        const remote = within(row).getByRole('link', { name: 'Remote fix' });
        expect(remote.getAttribute('href')).toBe('https://remote.example/#repos/ws-c/chats/p-r');
        expect(remote.getAttribute('target')).toBe('_blank');
        expect(within(row).getByRole('link', { name: 'Patch API' }).getAttribute('target')).toBeNull();
    });

    it('shows referenced conversations as compact links in details, apart from jobs and status', async () => {
        get.mockResolvedValue(ledger([item({
            jobs: [],
            references: [{
                processId: 'queue_design', workspaceId: 'ws-other', openLink: '#repos/ws-other/chats/queue_design',
                title: 'Browser control design interview with a long title', attachedAt: '2026-10-09T00:00:00.000Z', attachedBy: 'user',
            }, {
                processId: 'queue_untitled', workspaceId: 'ws-1', openLink: '#repos/ws-1/chats/queue_untitled',
                attachedAt: '2026-10-09T00:00:00.000Z', attachedBy: 'sentinel',
            }],
        })]));
        render(<div style={{ width: 220 }}><UnifiedTodoTab owner={OWNER} /></div>);
        let row = await screen.findByTestId('sentinel-todo-row-i1');
        expect(within(row).getByRole('button', { pressed: false })).toBeTruthy();
        expect(within(row).getByTestId('sentinel-todo-status-todo')).toBeTruthy();
        expect(within(row).queryByRole('list', { name: 'Jobs for Fix login' })).toBeNull();
        fireEvent.click(within(row).getByRole('button', { pressed: false }));
        row = screen.getByTestId('sentinel-todo-detail-i1');
        const refs = within(row).getByRole('list', { name: 'Referenced conversations for Fix login' });
        const link = within(refs).getByRole('link', { name: /Browser control design/ });
        expect(link.getAttribute('href')).toBe('#repos/ws-other/chats/queue_design');
        expect(link.getAttribute('target')).toBeNull();
        expect(link.getAttribute('title')).toBe('Browser control design interview with a long title');
        expect(link.className).toMatch(/truncate/);
        expect(link.className).toMatch(/min-w-0/);
        expect(within(refs).getByRole('link', { name: 'queue_untitled' }).getAttribute('href')).toBe('#repos/ws-1/chats/queue_untitled');
        expect(refs.textContent).not.toMatch(/Queued|Running|Status|Review|Job /);
    });

    it('renders items from servers without references unchanged', async () => {
        const legacy = item();
        delete (legacy as Partial<SentinelTodoItem>).references;
        get.mockResolvedValue(ledger([legacy]));
        render(<UnifiedTodoTab owner={OWNER} />);
        const row = await screen.findByTestId('sentinel-todo-row-i1');
        expect(within(row).queryByRole('list', { name: /Referenced conversations/ })).toBeNull();
    });

    describe('compact rows', () => {
        it('puts the repo and Updated time on a meta line below the title', async () => {
            get.mockResolvedValue(ledger([item({ targetRepo: { workspaceId: 'ws-web', label: 'web-app' } })]));
            render(<UnifiedTodoTab owner={OWNER} />);
            const row = await screen.findByTestId('sentinel-todo-row-i1');
            const toggle = within(row).getByRole('button', { pressed: false });
            const meta = within(row).getByTestId('sentinel-todo-meta-i1');
            expect(toggle.contains(meta)).toBe(false);
            expect(toggle.textContent).not.toContain('web-app');
            const repo = within(meta).getByTestId('sentinel-todo-repo-i1');
            expect(repo.textContent).toBe('web-app');
            expect(repo.getAttribute('title')).toBe('ws-web');
            expect(within(meta).getByTestId('sentinel-todo-updated-i1')).toBeTruthy();
        });

        it('previews a Needs attention reason in the list and shows it once in details', async () => {
            get.mockResolvedValue(ledger([
                item({ id: 'attn', status: 'needs_attention', statusReason: 'Blocked on staging credentials' }),
                item({ id: 'done', status: 'done', statusReason: 'Shipped it' }),
            ]));
            render(<UnifiedTodoTab owner={OWNER} />);
            let row = await screen.findByTestId('sentinel-todo-row-attn');
            const preview = within(row).getByTestId('sentinel-todo-reason-preview-attn');
            expect(preview.textContent).toBe('Blocked on staging credentials');
            expect(preview.getAttribute('title')).toBe('Blocked on staging credentials');
            expect(preview.className).toContain('truncate');
            fireEvent.click(within(row).getByRole('button', { pressed: false }));
            row = screen.getByTestId(row.dataset.testid!.replace('sentinel-todo-row-', 'sentinel-todo-detail-'));
            expect(within(row).queryByTestId('sentinel-todo-reason-preview-attn')).toBeNull();
            expect(within(row).getAllByText('Blocked on staging credentials')).toHaveLength(1);
            // Only Needs attention previews a reason on the collapsed row.
            fireEvent.click(screen.getByRole('button', { name: 'Done (1)' }));
            expect(screen.queryByTestId('sentinel-todo-reason-preview-done')).toBeNull();
        });

        it('counts active items and items needing attention in the header, including derived ones', async () => {
            get.mockResolvedValue(ledger([
                item({ id: 'a', status: 'needs_attention', statusReason: 'Blocked' }),
                item({ id: 'b', status: 'in_progress', jobs: [{
                    processId: 'queue_child', workspaceId: 'ws-child', kind: 'local', openLink: '#', linkedAt: item().createdAt,
                    execution: { state: 'completed', review: { state: 'failed', assessment: 'pending' } },
                }] }),
                item({ id: 'c' }),
                item({ id: 'd', status: 'done' }),
                item({ id: 'm', type: 'manual', status: 'needs_attention', statusReason: 'Vendor silent' }),
            ]));
            render(<UnifiedTodoTab owner={OWNER} />);
            expect((await screen.findByTestId('sentinel-todo-active-count')).textContent).toBe('3 active');
            expect(screen.getByTestId('sentinel-todo-attention-count').textContent).toBe('2 need attention');
        });

        it('omits the attention count when nothing needs attention', async () => {
            get.mockResolvedValue(ledger([item({ id: 'a', status: 'needs_attention', statusReason: 'x' }), item({ id: 'b' })]));
            const { unmount } = render(<UnifiedTodoTab owner={OWNER} />);
            expect((await screen.findByTestId('sentinel-todo-attention-count')).textContent).toBe('1 needs attention');
            unmount();
            get.mockResolvedValue(ledger([item()]));
            render(<UnifiedTodoTab owner={OWNER} />);
            await screen.findByTestId('sentinel-todo-row-i1');
            expect(screen.queryByTestId('sentinel-todo-attention-count')).toBeNull();
        });

        it.each([
            { kind: 'multiline', notes: 'Tried forcing LF.\nDid not help on cached runners.\nNext: compare bytes.\n', collapsible: true },
            { kind: 'long single-line', notes: 'Compare bytes without losing any note content. '.repeat(8), collapsible: true },
            { kind: 'short', notes: 'Check SSO too', collapsible: false },
        ])('shows full $kind notes initially in details without changing compact cards', async ({ notes, collapsible }) => {
            get.mockResolvedValue(ledger([item({ notes })]));
            render(<UnifiedTodoTab owner={OWNER} />);
            const row = await screen.findByTestId('sentinel-todo-row-i1');
            const assertCompact = () => {
                expect(row.textContent).not.toContain(notes);
                expect(within(row).queryByText('Notes')).toBeNull();
                expect(within(row).queryByTestId('sentinel-todo-notes-toggle-i1')).toBeNull();
            };
            assertCompact();
            fireEvent.click(within(row).getByRole('button', { pressed: false }));
            const detail = screen.getByTestId('sentinel-todo-detail-i1');
            const text = within(detail).getByText(notes, { normalizer: value => value });
            expect(text.textContent).toBe(notes);
            expect(text.classList.contains('whitespace-pre-wrap')).toBe(true);
            expect(text.classList.contains('break-words')).toBe(true);
            expect(within(detail).getByText('Login test passes')).toBeTruthy();
            const toggle = within(detail).queryByTestId('sentinel-todo-notes-toggle-i1');
            if (collapsible) {
                expect(toggle?.textContent).toBe('Hide notes');
                expect(toggle?.getAttribute('aria-expanded')).toBe('true');
                expect(toggle?.getAttribute('aria-controls')).toBe(text.id);
                fireEvent.click(toggle!);
                expect(toggle?.getAttribute('aria-expanded')).toBe('false');
                expect(toggle?.textContent).toMatch(/^Show notes \(\d+ lines\)$/);
                expect(document.getElementById(text.id)).toBeNull();
                expect(within(detail).getByText('Login test passes')).toBeTruthy();
                fireEvent.click(toggle!);
                expect(toggle?.getAttribute('aria-expanded')).toBe('true');
                expect(toggle?.textContent).toBe('Hide notes');
                expect(document.getElementById(text.id)?.textContent).toBe(notes);
            } else {
                expect(toggle).toBeNull();
            }
            assertCompact();
            expect(create).not.toHaveBeenCalled();
            expect(update).not.toHaveBeenCalled();
        });

        it.each(['normal', 'manual'] as const)('omits empty notes and their controls for $type items', async type => {
            get.mockResolvedValue(ledger([item({ notes: '', type })]));
            render(<UnifiedTodoTab owner={OWNER} />);
            const row = await screen.findByTestId('sentinel-todo-row-i1');
            fireEvent.click(within(row).getByRole('button', { pressed: false }));
            const detail = screen.getByTestId('sentinel-todo-detail-i1');
            expect(within(detail).queryByText('Notes')).toBeNull();
            expect(within(detail).queryByTestId('sentinel-todo-notes-toggle-i1')).toBeNull();
            expect(within(detail).getByText('Login test passes')).toBeTruthy();
            expect(within(row).queryByText('Notes')).toBeNull();
            expect(create).not.toHaveBeenCalled();
            expect(update).not.toHaveBeenCalled();
        });

        it('ignores pressing the current status and offers no In review choice', async () => {
            get.mockResolvedValue(ledger([item({ status: 'in_progress' })]));
            render(<UnifiedTodoTab owner={OWNER} />);
            let row = await screen.findByTestId('sentinel-todo-row-i1');
            fireEvent.click(within(row).getByRole('button', { pressed: false }));
            row = screen.getByTestId(row.dataset.testid!.replace('sentinel-todo-row-', 'sentinel-todo-detail-'));
            const group = within(row).getByRole('group', { name: 'Status' });
            expect(within(group).queryByRole('button', { name: 'In review' })).toBeNull();
            fireEvent.click(within(group).getByRole('button', { name: 'In progress', pressed: true }));
            expect(update).not.toHaveBeenCalled();
            expect(within(row).queryByTestId('sentinel-todo-derived-i1')).toBeNull();
        });

        it('offers Reopen instead of status choices on Done rows, and only Restore on archived rows', async () => {
            get.mockResolvedValue(ledger([item({ id: 'd', status: 'done' }), item({ id: 'a', archived: true })]));
            render(<UnifiedTodoTab owner={OWNER} />);
            fireEvent.click(await screen.findByRole('button', { name: 'Done (1)' }));
            let done = screen.getByTestId('sentinel-todo-row-d');
            fireEvent.click(within(done).getByRole('button', { pressed: false }));
            done = screen.getByTestId(done.dataset.testid!.replace('sentinel-todo-row-', 'sentinel-todo-detail-'));
            expect(within(done).queryByRole('group', { name: 'Status' })).toBeNull();
            expect(within(done).getAllByRole('button').map(b => b.textContent)).toEqual(expect.arrayContaining(['Edit', 'Reopen', 'Archive']));
            fireEvent.click(screen.getByRole('button', { name: 'Archived (1)' }));
            let archived = screen.getByTestId('sentinel-todo-row-a');
            fireEvent.click(within(archived).getByRole('button', { pressed: false }));
            archived = screen.getByTestId(archived.dataset.testid!.replace('sentinel-todo-row-', 'sentinel-todo-detail-'));
            expect(within(archived).queryByRole('group', { name: 'Status' })).toBeNull();
            expect(within(archived).queryByRole('button', { name: 'Edit' })).toBeNull();
            expect(within(archived).getByRole('button', { name: 'Restore' })).toBeTruthy();
        });
    });
});

describe('UnifiedTodoTab split layout', () => {
    let panelWidth: number;
    let observers: Set<ResizeObserverCallback>;
    beforeEach(() => {
        panelWidth = 800;
        observers = new Set();
        vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockImplementation(() => panelWidth);
        vi.stubGlobal('ResizeObserver', class {
            constructor(private callback: ResizeObserverCallback) { observers.add(callback); }
            observe() {}
            disconnect() { observers.delete(this.callback); }
        });
        applyRuntimeConfigPatch({ sessionContextAttachmentsEnabled: false });
    });
    afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });
    async function resize(width: number) {
        panelWidth = width;
        act(() => { observers.forEach(callback => callback([], {} as ResizeObserver)); });
        await waitFor(() => expect(screen.getByTestId('sentinel-todo-tab').dataset.layout).toBe(width >= 660 ? 'split' : 'single'));
    }
    function select(id = 'i1') {
        fireEvent.click(screen.getByTestId(`sentinel-todo-row-${id}`).querySelector('[data-todo-select]')!);
    }
    function detail(id = 'i1') { return screen.getByTestId(`sentinel-todo-detail-${id}`); }

    it.each((['normal', 'manual'] as const).flatMap(type => [
        { type, status: 'todo', label: 'To do', mark: '○', color: 'text-[#616161]' },
        { type, status: 'in_progress', label: 'In progress', mark: '◐', color: 'text-[#0078d4]' },
        { type, status: 'needs_attention', label: 'Needs attention', mark: '!', color: 'text-[#b5650f]' },
        { type, status: 'done', label: 'Done', mark: '✓', color: 'text-[#16825d]' },
    ] as const))('shows icon-only $status on $type cards and detail headers with accessible names and tooltips', async ({ type, status, label, mark, color }) => {
        get.mockResolvedValue(ledger([item({ type, status })]));
        render(<UnifiedTodoTab owner={OWNER} />);
        if (status === 'done') {
            const section = await screen.findByTestId(type === 'manual'
                ? 'sentinel-todo-manual-done-section' : 'sentinel-todo-done-section');
            fireEvent.click(within(section).getByRole('button', { name: 'Done (1)' }));
        }
        const row = await screen.findByTestId('sentinel-todo-row-i1');
        const badge = within(row).getByTestId(`sentinel-todo-status-${status}`);
        assertIconOnlyStatus(badge, label, mark);
        expect(badge.classList.contains(color)).toBe(true);
        expect(within(row).getByRole('button', { name: new RegExp(`${label}.*Fix login`) })).toBeTruthy();
        select();
        const heading = within(detail()).getByRole('heading', { name: new RegExp(`Fix login.*${label}`) });
        const detailBadge = within(heading).getByTestId(`sentinel-todo-status-${status}`);
        assertIconOnlyStatus(detailBadge, label, mark);
        expect(detailBadge.className).toBe(badge.className);
        if (status !== 'done') {
            const controls = within(detail()).getByRole('group', { name: 'Status' });
            for (const name of ['To do', 'In progress', 'Needs attention', 'Done']) {
                const control = within(controls).getByRole('button', { name });
                expect(control.textContent).toContain(name);
                expect(control.querySelector('.sr-only')).toBeNull();
            }
        } else {
            expect(within(detail()).getByRole('button', { name: 'Reopen' })).toBeTruthy();
        }
        expect(update).not.toHaveBeenCalled();
        expect(create).not.toHaveBeenCalled();
    });

    it('hosts PR outcome evidence only in the selected normal detail, never hidden editors or list rows', async () => {
        applyRuntimeConfigPatch({ sentinelPrOutcomeWakeEnabled: true });
        prOutcomesGet.mockResolvedValue({ revision: 1, paused: false, outcomes: [] });
        get.mockResolvedValue(ledger([item(), item({ id: 'i2', title: 'Second item' }), item({ id: 'manual', type: 'manual' })]));
        render(<UnifiedTodoTab owner={OWNER} />);
        await screen.findByTestId('sentinel-todo-row-i1');
        expect(prOutcomesGet).not.toHaveBeenCalled();
        select();
        await within(detail()).findByRole('button', { name: 'Check outcome' });
        expect(within(screen.getByTestId('sentinel-todo-row-i1')).queryByRole('button', { name: 'Check outcome' })).toBeNull();
        select('i2');
        await within(detail('i2')).findByRole('button', { name: 'Check outcome' });
        expect(within(detail()).queryByRole('button', { name: 'Check outcome', hidden: true })).toBeNull();
        select('manual');
        expect(screen.queryByRole('button', { name: 'Check outcome' })).toBeNull();
        expect(prOutcomesGet.mock.calls.map(call => call[2])).toEqual(['i1', 'i2']);
    });

    it.each([
        { width: 360, type: 'normal' as const }, { width: 800, type: 'normal' as const },
        { width: 360, type: 'manual' as const }, { width: 800, type: 'manual' as const },
    ])('reveals the selected last-active $type item after Done in a $width px panel', async ({ width, type }) => {
        panelWidth = width;
        const active = item({ type, status: 'in_progress', revision: 4 });
        const outcome = { summary: 'User verified', recordedAt: active.updatedAt, recordedBy: 'user' as const };
        const completed = { ...active, status: 'done' as const, statusReason: outcome.summary, outcome, revision: 5, updatedBy: 'user' as const };
        get.mockResolvedValueOnce(ledger([active], 4)).mockResolvedValue(ledger([completed], 5));
        update.mockResolvedValue({ item: completed, ledgerRevision: 5 });
        render(<UnifiedTodoTab owner={OWNER} />);
        await screen.findByTestId('sentinel-todo-row-i1');
        select();
        chooseStatus(detail(), 'Done');
        fireEvent.change(within(detail()).getByLabelText('Reason for Done (optional)'), { target: { value: outcome.summary } });
        fireEvent.click(within(detail()).getByRole('button', { name: 'Set status' }));
        await within(detail()).findByRole('button', { name: 'Reopen' });
        const section = screen.getByTestId(`sentinel-todo-${type === 'manual' ? 'manual-' : ''}done-section`);
        expect(within(section).getByRole('button', { name: 'Done (1)', hidden: true }).getAttribute('aria-expanded')).toBe('true');
        expect(detail().hidden).toBe(false);
        expect(within(detail()).getByTestId('sentinel-todo-outcome-i1').textContent).toBe(`${outcome.summary} (you)`);
        if (width < 660) {
            fireEvent.click(screen.getByRole('button', { name: 'Back to list' }));
            await waitFor(() => expect(document.activeElement).toBe(screen.getByTestId('sentinel-todo-row-i1').querySelector('[data-todo-select]')));
        }
        expect(within(section).getByRole('button', { pressed: true, name: /Fix login/ })).toBeTruthy();
        expect(screen.getByTestId(type === 'manual' ? 'sentinel-todo-manual-empty' : 'sentinel-todo-no-active')).toBeTruthy();
        expect(update).toHaveBeenCalledExactlyOnceWith('ws-1', 'queue_sentinel', 'i1', {
            expectedRevision: 4, status: 'done', statusReason: outcome.summary, outcome: outcome.summary,
        });
    });

    it.each(['normal', 'manual'] as const)('keeps live $type selection visible through Done, archive, restore and reopen without writes', async type => {
        let current = item({ type });
        get.mockImplementation(async () => ledger([current], current.revision));
        render(<UnifiedTodoTab owner={OWNER} />);
        await screen.findByTestId('sentinel-todo-row-i1');
        select();
        const { onMessage } = connect.mock.calls[0][0] as { onMessage: (message: unknown) => void };
        for (const patch of [{ status: 'done' as const }, { archived: true }, { archived: false }, { status: 'todo' as const }]) {
            current = { ...current, ...patch, revision: current.revision + 1 };
            act(() => onMessage({ type: 'sentinel-todos-changed', workspaceId: OWNER.ownerWorkspaceId,
                processId: OWNER.processId, ledgerRevision: current.revision }));
            await waitFor(() => {
                const row = screen.getByTestId('sentinel-todo-row-i1');
                expect(row.closest('[data-testid$="-section"]')?.getAttribute('data-testid')).toBe(
                    current.archived ? `sentinel-todo-${type === 'manual' ? 'manual-' : ''}archived-section`
                        : current.status === 'done' ? `sentinel-todo-${type === 'manual' ? 'manual-' : ''}done-section`
                            : type === 'manual' ? 'sentinel-todo-manual-section' : undefined,
                );
                expect(within(row).getByRole('button', { pressed: true })).toBeTruthy();
            });
            expect(detail().hidden).toBe(false);
        }
        expect(update).not.toHaveBeenCalled();
    });

    it.each([
        { type: 'normal' as const, status: 'done' as const, archived: false, section: 'done' },
        { type: 'normal' as const, status: 'todo' as const, archived: true, section: 'archived' },
        { type: 'manual' as const, status: 'done' as const, archived: false, section: 'manual-done' },
        { type: 'manual' as const, status: 'todo' as const, archived: true, section: 'manual-archived' },
        { type: 'manual' as const, status: 'todo' as const, archived: false, section: 'manual' },
        { type: 'manual' as const, status: 'done' as const, archived: false, section: 'manual' },
    ])('clears selection when its $section section is collapsed and keeps it closed on refresh ($status)', async ({ type, status, archived, section }) => {
        const tracked = item({ type, status, archived });
        get.mockResolvedValue(ledger([tracked]));
        render(<UnifiedTodoTab owner={OWNER} />);
        await screen.findByTestId('sentinel-todo-manual-section');
        if (status === 'done' || archived) {
            fireEvent.click(within(screen.getByTestId(`sentinel-todo-${type === 'manual' ? 'manual-' : ''}${archived ? 'archived' : 'done'}-section`))
                .getByRole('button', { expanded: false }));
        }
        select();
        if (!archived) {
            fireEvent.click(within(detail()).getByRole('button', { name: 'Edit' }));
            fireEvent.change(within(detail()).getByLabelText('Title'), { target: { value: 'Retained draft' } });
        }
        const toggle = within(screen.getByTestId(`sentinel-todo-${section}-section`)).getByRole('button', {
            name: section === 'manual' ? /Manual tracking/ : /^(Done|Archived) \(/, expanded: true,
        });
        fireEvent.click(toggle);
        expect(screen.getByText('Select an item to view its details.')).toBeTruthy();
        expect(detail().hidden).toBe(true);
        expect(screen.queryByTestId('sentinel-todo-row-i1')).toBeNull();
        const { onMessage } = connect.mock.calls[0][0] as { onMessage: (message: unknown) => void };
        act(() => onMessage({ type: 'sentinel-todos-changed', workspaceId: OWNER.ownerWorkspaceId,
            processId: OWNER.processId, ledgerRevision: 2 }));
        await waitFor(() => expect(get).toHaveBeenCalledTimes(2));
        fireEvent.click(screen.getByRole('button', { name: 'Refresh to-do list' }));
        await waitFor(() => expect(get).toHaveBeenCalledTimes(3));
        expect(toggle.getAttribute('aria-expanded')).toBe('false');
        expect(screen.queryByTestId('sentinel-todo-row-i1')).toBeNull();
        fireEvent.click(toggle);
        expect(within(screen.getByTestId('sentinel-todo-row-i1')).getByRole('button', { pressed: false })).toBeTruthy();
        select();
        if (!archived) expect((within(detail()).getByLabelText('Title') as HTMLInputElement).value).toBe('Retained draft');
        expect(update).not.toHaveBeenCalled();
    });

    it.each([
        { width: 360, kind: 'edit' }, { width: 800, kind: 'edit' },
        { width: 360, kind: 'status' }, { width: 800, kind: 'status' },
    ])('retains selection and the same $kind draft DOM when refreshing a $width px panel', async ({ width, kind }) => {
        panelWidth = width;
        get.mockResolvedValueOnce(ledger([item()])).mockResolvedValue(ledger([item({ title: 'Fresh item', revision: 2 })], 2));
        render(<UnifiedTodoTab owner={OWNER} />);
        await screen.findByTestId('sentinel-todo-row-i1');
        select();
        if (kind === 'edit') fireEvent.click(within(detail()).getByRole('button', { name: 'Edit' }));
        else chooseStatus(detail(), 'Needs attention');
        const label = kind === 'edit' ? 'Title' : 'Reason for Needs attention';
        const draft = within(detail()).getByLabelText(label);
        fireEvent.change(draft, { target: { value: 'Keep unsaved draft' } });
        const refresh = screen.getByRole('button', { name: 'Refresh to-do list' });
        fireEvent.click(refresh);
        await waitFor(() => expect(refresh.getAttribute('aria-busy')).toBe('false'));
        expect(within(detail()).getByLabelText(label)).toBe(draft);
        expect((draft as HTMLInputElement).value).toBe('Keep unsaved draft');
        expect(screen.getByRole('region', { name: /Fresh item/ })).toBeTruthy();
        if (width < 660) fireEvent.click(screen.getByRole('button', { name: 'Back to list' }));
        expect(screen.getByRole('button', { pressed: true, name: /Fresh item/ })).toBeTruthy();
        expect(update).not.toHaveBeenCalled();
    });

    it.each(['normal', 'manual'] as const)('reveals restored $type selection completed while its workspace/chat was away, including older history', async type => {
        let tracked = item({ type });
        const history = Array.from({ length: 55 }, (_, index) => item({ id: `history-${index}`, status: 'done',
            updatedAt: '2026-10-12T00:00:00.000Z' }));
        get.mockImplementation(async (workspaceId: string, processId: string) => ledger(
            workspaceId === OWNER.ownerWorkspaceId && processId === OWNER.processId
                ? [tracked, ...history] : [item({ title: 'Other owner' })],
        ));
        const mounted = render(<UnifiedTodoTab owner={OWNER} chatId={OWNER.processId} />);
        await screen.findByTestId('sentinel-todo-row-i1');
        select();
        mounted.rerender(<UnifiedTodoTab owner={{ ...OWNER, processId: 'other-chat' }} chatId="other-chat" />);
        await screen.findByRole('button', { name: /Other owner/ });
        expect(screen.getByText('Select an item to view its details.')).toBeTruthy();
        mounted.rerender(<UnifiedTodoTab owner={{ ...OWNER, ownerWorkspaceId: 'other-workspace' }} />);
        await screen.findByRole('button', { name: /Other owner/ });
        tracked = { ...tracked, status: 'done', revision: 2 };
        mounted.rerender(<UnifiedTodoTab owner={OWNER} chatId={OWNER.processId} />);
        const row = await screen.findByTestId('sentinel-todo-row-i1');
        expect(within(row).getByRole('button', { pressed: true })).toBeTruthy();
        expect(row.closest('[data-testid$="-section"]')?.getAttribute('data-testid')).toBe(
            `sentinel-todo-${type === 'manual' ? 'manual-' : ''}done-section`,
        );
        expect(within(detail()).getByRole('button', { name: 'Reopen' })).toBeTruthy();
        expect(update).not.toHaveBeenCalled();
    });

    it('keeps an unrelated collapsed section closed through item edits and active status changes', async () => {
        let tracked = item();
        get.mockImplementation(async () => ledger([tracked, item({ id: 'done', status: 'done' })]));
        render(<UnifiedTodoTab owner={OWNER} />);
        await screen.findByTestId('sentinel-todo-row-i1');
        select();
        const toggle = within(screen.getByTestId('sentinel-todo-done-section')).getByRole('button', { expanded: false });
        for (const patch of [{ title: 'New title' }, { status: 'in_progress' as const }, { status: 'needs_attention' as const }]) {
            tracked = { ...tracked, ...patch };
            fireEvent.click(screen.getByRole('button', { name: 'Refresh to-do list' }));
            await waitFor(() => expect(screen.getByTestId('sentinel-todo-refresh').getAttribute('aria-busy')).toBe('false'));
            expect(toggle.getAttribute('aria-expanded')).toBe('false');
            expect(within(screen.getByTestId('sentinel-todo-row-i1')).getByRole('button', { pressed: true })).toBeTruthy();
        }
        expect(update).not.toHaveBeenCalled();
    });

    it.each([
        { width: 360, reopened: false }, { width: 800, reopened: false },
        { width: 360, reopened: true }, { width: 800, reopened: true },
    ])('retains explicit notes visibility across selection, refresh and remount ($width px, reopened=$reopened)', async ({ width, reopened }) => {
        panelWidth = width;
        let tracked = item({ notes: 'First line.\nSecond line.\nThird line.' });
        const untouched = item({ id: 'i2', title: 'Untouched', notes: 'Other first.\nOther second.\nOther third.' });
        get.mockImplementation(async () => ledger([tracked, untouched], tracked.revision));
        const mounted = render(<UnifiedTodoTab owner={OWNER} />);
        await screen.findByTestId('sentinel-todo-row-i1');
        select();
        const toggle = within(detail()).getByRole('button', { name: 'Hide notes' });
        fireEvent.click(toggle);
        if (reopened) fireEvent.click(toggle);
        const assertNotes = () => {
            expect(within(detail()).getByTestId('sentinel-todo-notes-toggle-i1').getAttribute('aria-expanded')).toBe(String(reopened));
            expect(within(detail()).queryByText(tracked.notes, { normalizer: value => value }) !== null).toBe(reopened);
        };
        mounted.rerender(<UnifiedTodoTab owner={{ ...OWNER }} />);
        assertNotes();
        if (width < 660) fireEvent.click(screen.getByRole('button', { name: 'Back to list' }));
        select('i2');
        expect(within(detail('i2')).getByRole('button', { name: 'Hide notes' }).getAttribute('aria-expanded')).toBe('true');
        expect(within(detail('i2')).getByText(untouched.notes, { normalizer: value => value })).toBeTruthy();
        if (width < 660) fireEvent.click(screen.getByRole('button', { name: 'Back to list' }));
        select();
        assertNotes();
        tracked = { ...tracked, notes: `${tracked.notes}\nRefreshed content.`, revision: 2 };
        fireEvent.click(screen.getByRole('button', { name: 'Refresh to-do list' }));
        await waitFor(() => expect(screen.getByTestId('sentinel-todo-refresh').getAttribute('aria-busy')).toBe('false'));
        assertNotes();
        const { onMessage } = connect.mock.calls[0][0] as { onMessage: (message: unknown) => void };
        await act(async () => onMessage({ type: 'sentinel-todos-changed', workspaceId: OWNER.ownerWorkspaceId,
            processId: OWNER.processId, ledgerRevision: 3 }));
        await waitFor(() => expect(get).toHaveBeenCalledTimes(3));
        assertNotes();
        mounted.unmount();
        render(<UnifiedTodoTab owner={OWNER} />);
        await screen.findByTestId('sentinel-todo-detail-i1');
        assertNotes();
        expect(create).not.toHaveBeenCalled();
        expect(update).not.toHaveBeenCalled();
    });

    it.each([
        { ...OWNER, processId: 'other-chat' },
        { ...OWNER, ownerWorkspaceId: 'other-workspace' },
        { ...OWNER, ownerRoutingRef: 'remote:other-server:ws-1' },
    ])('isolates remembered notes visibility by ledger owner (%j)', async otherOwner => {
        registerCloneBaseUrls([{ workspaceId: 'ws-1', serverId: 'other-server', baseUrl: 'https://owner.example' }]);
        get.mockResolvedValue(ledger([item({ notes: 'First line.\nSecond line.\nThird line.' })]));
        const mounted = render(<UnifiedTodoTab owner={OWNER} />);
        await screen.findByTestId('sentinel-todo-row-i1');
        select();
        fireEvent.click(within(detail()).getByRole('button', { name: 'Hide notes' }));
        mounted.rerender(<UnifiedTodoTab owner={otherOwner} />);
        await screen.findByTestId('sentinel-todo-row-i1');
        select();
        expect(within(detail()).getByRole('button', { name: 'Hide notes' }).getAttribute('aria-expanded')).toBe('true');
        mounted.rerender(<UnifiedTodoTab owner={OWNER} />);
        await screen.findByTestId('sentinel-todo-detail-i1');
        expect(within(detail()).getByRole('button', { name: 'Show notes (3 lines)' }).getAttribute('aria-expanded')).toBe('false');
        expect(create).not.toHaveBeenCalled();
        expect(update).not.toHaveBeenCalled();
    });

    it('always renders list/detail panes without a layout preference', async () => {
        get.mockResolvedValue(ledger([item()]));
        render(<UnifiedTodoTab owner={OWNER} />);
        await screen.findByTestId('sentinel-todo-row-i1');
        expect(screen.getByTestId('sentinel-todo-tab').dataset.layout).toBe('split');
        expect(screen.getByTestId('sentinel-todo-list')).toBeTruthy();
        expect(screen.getByTestId('sentinel-todo-details')).toBeTruthy();
        expect(screen.queryByRole('button', { expanded: false, name: /Fix login/ })).toBeNull();
        select();
        expect(within(detail()).getByRole('button', { name: 'Edit' })).toBeTruthy();
        expect(update).not.toHaveBeenCalled();
    });

    it('measures the panel rather than viewport and keeps the same draft DOM across the 660px boundary and Back', async () => {
        get.mockResolvedValue(ledger([item(), item({ id: 'i2', title: 'Second' })]));
        render(<UnifiedTodoTab owner={OWNER} />);
        await screen.findByTestId('sentinel-todo-row-i1');
        expect(screen.getByText('Select an item to view its details.')).toBeTruthy();
        select();
        expect(screen.getByRole('region', { name: /Fix login/ })).toBe(screen.getByTestId('sentinel-todo-details'));
        fireEvent.click(within(detail()).getByRole('button', { name: 'Edit' }));
        const notes = within(detail()).getByLabelText('Notes');
        fireEvent.change(notes, { target: { value: 'Keep draft on resize' } });
        await resize(659);
        expect(screen.queryByRole('button', { name: /Second/ })).toBeNull();
        expect(within(detail()).getByLabelText('Notes')).toBe(notes);
        fireEvent.click(screen.getByRole('button', { name: 'Back to list' }));
        await waitFor(() => expect(document.activeElement).toBe(screen.getByTestId('sentinel-todo-row-i1').querySelector('[data-todo-select]')));
        expect(screen.queryByRole('heading', { name: /Fix login/ })).toBeNull();
        expect(screen.getByRole('button', { pressed: true, name: /Fix login/ })).toBeTruthy();
        select();
        await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('heading', { name: /Fix login/ })));
        await resize(660);
        expect(within(detail()).getByLabelText('Notes')).toBe(notes);
        expect((notes as HTMLTextAreaElement).value).toBe('Keep draft on resize');
        expect(screen.getByRole('button', { name: /Second/ })).toBeTruthy();
        expect(screen.queryByRole('button', { name: 'Back to list' })).toBeNull();
    });

    it('keeps independent item drafts and conflicts, and saves the captured title, notes, condition and priority revision', async () => {
        get.mockResolvedValue(ledger([item(), item({ id: 'i2', title: 'Second' })]));
        render(<UnifiedTodoTab owner={OWNER} />);
        await screen.findByTestId('sentinel-todo-row-i1');
        select();
        fireEvent.click(within(detail()).getByRole('button', { name: 'Edit' }));
        fireEvent.change(within(detail()).getByLabelText('Title'), { target: { value: 'Draft one' } });
        fireEvent.change(within(detail()).getByLabelText('Notes'), { target: { value: 'Personal draft' } });
        fireEvent.change(within(detail()).getByLabelText('Done when'), { target: { value: 'Finish review' } });
        fireEvent.change(within(detail()).getByLabelText('Priority'), { target: { value: 'high' } });
        select('i2');
        fireEvent.click(within(detail('i2')).getByRole('button', { name: 'Edit' }));
        fireEvent.change(within(detail('i2')).getByLabelText('Title'), { target: { value: 'Draft two' } });
        select();
        const fresh = item({ title: 'Server edit', revision: 3 });
        get.mockResolvedValue(ledger([fresh, item({ id: 'i2', title: 'Second' })], 3));
        update.mockRejectedValueOnce(conflict(fresh)).mockResolvedValue({});
        fireEvent.click(within(detail()).getByRole('button', { name: 'Save' }));
        await within(detail()).findByRole('alert');
        expect((within(detail()).getByLabelText('Title') as HTMLInputElement).value).toBe('Draft one');
        select('i2');
        expect((within(detail('i2')).getByLabelText('Title') as HTMLInputElement).value).toBe('Draft two');
        select();
        fireEvent.click(within(detail()).getByRole('button', { name: 'Save' }));
        await waitFor(() => expect(update).toHaveBeenLastCalledWith('ws-1', 'queue_sentinel', 'i1', {
            expectedRevision: 3, title: 'Draft one', notes: 'Personal draft', completionCondition: 'Finish review', priority: 'high',
        }));
    });

    it('keeps a pending status reason when selecting another item', async () => {
        get.mockResolvedValue(ledger([item(), item({ id: 'i2', title: 'Second' })]));
        update.mockResolvedValue({});
        render(<UnifiedTodoTab owner={OWNER} />);
        await screen.findByTestId('sentinel-todo-row-i1');
        select();
        chooseStatus(detail(), 'Needs attention');
        fireEvent.change(within(detail()).getByLabelText('Reason for Needs attention'), { target: { value: 'Waiting for review' } });
        select('i2');
        select();
        fireEvent.click(within(detail()).getByRole('button', { name: 'Set status' }));
        await waitFor(() => expect(update).toHaveBeenCalledWith('ws-1', 'queue_sentinel', 'i1', {
            expectedRevision: 1, status: 'needs_attention', statusReason: 'Waiting for review',
        }));
    });

    it('returns narrow details to the scrollable list for Add without losing the selected draft', async () => {
        panelWidth = 360;
        get.mockResolvedValue(ledger([item()]));
        render(<UnifiedTodoTab owner={OWNER} />);
        await screen.findByTestId('sentinel-todo-row-i1');
        select();
        fireEvent.click(within(detail()).getByRole('button', { name: 'Edit' }));
        fireEvent.change(within(detail()).getByLabelText('Title'), { target: { value: 'Keep this draft' } });
        fireEvent.click(screen.getByRole('button', { name: 'Add item' }));
        expect(screen.getByRole('form', { name: 'Add item' })).toBeTruthy();
        expect(screen.queryByRole('heading', { name: /Fix login/ })).toBeNull();
        fireEvent.click(within(screen.getByRole('form', { name: 'Add item' })).getByRole('button', { name: 'Cancel' }));
        select();
        expect((within(detail()).getByLabelText('Title') as HTMLInputElement).value).toBe('Keep this draft');
    });

    it('keeps scrubber chat excursions independent of item selection and preserves findings/actions', async () => {
        applyRuntimeConfigPatch({ sentinelTodoScrubberEnabled: true });
        get.mockResolvedValue(ledger([item()]));
        scrubGet.mockResolvedValue({ config: { enabled: false, cron: '0 9 * * *', paused: false, consecutiveFailures: 0, revision: 0 },
            runs: [{ id: 'r1', childProcessId: 'scrub-chat', status: 'completed', trigger: 'manual', createdAt: '2026-10-11T00:00:00Z',
                counts: { done: 0, proposals: 1, unverified: 0 }, itemCount: 1, deferredCount: 0, awaitingReviewCount: 0 }] });
        scrubGetRun.mockResolvedValue({ findings: [{ runId: 'r1', itemId: 'i1', itemRevision: 1, state: 'proposed', fingerprint: 'f1', audit: [],
            finding: { itemId: 'i1', verdict: 'obsolete', confidence: 'high', summary: 'Superseded', rationale: 'Replacement landed', autoApply: false,
                evidence: [{ kind: 'pr', ref: '#902', state: 'merged', checkedAt: '2026-10-11T01:00:00Z' }] } }] });
        render(<UnifiedTodoTab owner={OWNER} scopeWorkspaceId="ws-1" chatId={OWNER.processId} />);
        await screen.findByText('◇ Proposal: Obsolete (high)');
        select();
        fireEvent.click(within(screen.getByTestId('sentinel-scrubber-strip')).getByRole('link', { name: 'Open chat' }));
        expect(screen.getByRole('heading', { name: /Fix login/ })).toBeTruthy();
        expect(screen.getByRole('button', { pressed: true, name: /Fix login/ })).toBeTruthy();
        fireEvent.click(within(detail()).getByRole('button', { name: 'Accept' }));
        await waitFor(() => expect(scrubAccept).toHaveBeenCalledWith('ws-1', 'queue_sentinel', 'r1', 'i1', { expectedItemRevision: 1 }));
        expect(update).not.toHaveBeenCalled();
    });

    it.each(['normal', 'manual'] as const)('retains compact %s context drag and Attach without writes', async type => {
        applyRuntimeConfigPatch({ sessionContextAttachmentsEnabled: true });
        get.mockResolvedValue(ledger([item({ type })]));
        render(<UnifiedTodoTab owner={OWNER} />);
        const row = await screen.findByTestId('sentinel-todo-row-i1');
        const setData = vi.fn();
        fireEvent.dragStart(row, { dataTransfer: { setData, effectAllowed: 'none' } });
        const payload = JSON.parse(setData.mock.calls.find(call => call[0] === POINTER_CONTEXT_DRAG_MIME)![1]);
        const receive = vi.fn();
        subscribeActiveChatAttach('ws-1', receive);
        fireEvent.click(within(row).getByRole('button', { name: 'More actions' }));
        fireEvent.click(screen.getByRole('menuitem', { name: 'Attach' }));
        expect(receive).toHaveBeenCalledWith(payload);
        expect(payload).toMatchObject({ todoItemId: 'i1', sourceProcessId: OWNER.processId, sourceRoutingRef: null });
        expect(payload).not.toHaveProperty('notes');
        expect(update).not.toHaveBeenCalled();
        expect(create).not.toHaveBeenCalled();
    });

    it('keeps dependency authoring mounted when selection changes and retains separate readiness semantics', async () => {
        applyRuntimeConfigPatch({ sentinelTodoDependenciesEnabled: true });
        get.mockResolvedValue(ledger([item(), item({ id: 'i2', title: 'Second' })]));
        render(<UnifiedTodoTab owner={OWNER} />);
        await screen.findByTestId('sentinel-todo-row-i1');
        select();
        fireEvent.click(within(detail()).getByRole('button', { name: 'Edit dependencies' }));
        const editor = within(detail()).getByRole('button', { name: 'Save dependencies' }).closest('section');
        select('i2');
        select();
        expect(within(detail()).getByRole('button', { name: 'Save dependencies' }).closest('section')).toBe(editor);
        expect(within(detail()).getByRole('group', { name: 'Status' })).toBeTruthy();
        expect(update).not.toHaveBeenCalled();
    });

    it('keeps normal/manual, Done and Archived separate and mounts archived editors only on selection', async () => {
        get.mockResolvedValue(ledger([
            item(), item({ id: 'm', title: 'Reminder', type: 'manual' }),
            item({ id: 'd', status: 'done' }), item({ id: 'a', archived: true }),
            item({ id: 'md', type: 'manual', status: 'done' }), item({ id: 'ma', type: 'manual', archived: true }),
        ]));
        render(<UnifiedTodoTab owner={OWNER} />);
        await screen.findByTestId('sentinel-todo-row-i1');
        expect(screen.queryByTestId('sentinel-todo-row-a')).toBeNull();
        expect(screen.queryByTestId('sentinel-todo-detail-a')).toBeNull();
        expect(screen.getByTestId('sentinel-todo-manual-done-section')).toBeTruthy();
        expect(screen.getByTestId('sentinel-todo-manual-archived-section')).toBeTruthy();
        select('m');
        expect(within(detail('m')).getByText('Tracked only · never run')).toBeTruthy();
        expect(within(detail('m')).queryByRole('button', { name: /Launch|Retry job|Cancel job/ })).toBeNull();
        fireEvent.click(within(screen.getByTestId('sentinel-todo-archived-section')).getByRole('button'));
        select('a');
        expect(within(detail('a')).getByRole('button', { name: 'Restore' })).toBeTruthy();
        expect(within(detail('a')).queryByRole('button', { name: 'Edit' })).toBeNull();
        expect(within(screen.getByTestId('sentinel-todo-done-section')).getByRole('button').getAttribute('aria-expanded')).toBe('false');
    });

    it('uses native pressed buttons: arrows move focus only, and explicit activation selects', async () => {
        get.mockResolvedValue(ledger([item(), item({ id: 'i2', title: 'Second' })]));
        render(<UnifiedTodoTab owner={OWNER} />);
        await screen.findByTestId('sentinel-todo-row-i1');
        const first = screen.getByTestId('sentinel-todo-row-i1').querySelector<HTMLButtonElement>('[data-todo-select]')!;
        const second = screen.getByTestId('sentinel-todo-row-i2').querySelector<HTMLButtonElement>('[data-todo-select]')!;
        first.focus();
        fireEvent.keyDown(first, { key: 'ArrowDown' });
        expect(document.activeElement).toBe(second);
        expect(second.getAttribute('aria-pressed')).toBe('false');
        fireEvent.click(second);
        expect(second.getAttribute('aria-pressed')).toBe('true');
        expect(screen.getByRole('heading', { name: /Second/ })).toBeTruthy();
        fireEvent.keyDown(second, { key: 'Home' });
        expect(document.activeElement).toBe(first);
        expect(second.getAttribute('aria-pressed')).toBe('true');
    });

    it('restores owner-qualified excursion selection, scroll, containing sections and link focus', async () => {
        const tracked = item({ status: 'done', references: [{ processId: 'ref', workspaceId: 'ws-1', title: 'Reference',
            openLink: '#repos/ws-1/chats/ref', attachedAt: item().createdAt, attachedBy: 'user' }] });
        get.mockResolvedValue(ledger([tracked]));
        const first = render(<UnifiedTodoTab owner={OWNER} scopeWorkspaceId="ws-1" chatId={OWNER.processId} />);
        fireEvent.click(await screen.findByRole('button', { name: 'Done (1)' }));
        select();
        const scroller = screen.getByTestId('sentinel-todo-list');
        scroller.scrollTop = 120;
        fireEvent.scroll(scroller);
        fireEvent.click(within(detail()).getByRole('link', { name: 'Reference' }));
        first.unmount();
        returnFromSentinelTodoExcursion();
        render(<UnifiedTodoTab owner={OWNER} scopeWorkspaceId="ws-1" chatId={OWNER.processId} />);
        await screen.findByRole('heading', { name: /Fix login/ });
        expect(recallSentinelTodoView(OWNER).selectedId).toBe('i1');
        expect(screen.getByTestId('sentinel-todo-list').scrollTop).toBe(120);
        expect(document.activeElement).toBe(within(detail()).getByRole('link', { name: 'Reference' }));
    });

    it('does not show old owner selection or late reads/writes on the new ledger', async () => {
        const pending = deferred<unknown>();
        get.mockResolvedValue(ledger([item()]));
        update.mockReturnValue(pending.promise);
        const mounted = render(<UnifiedTodoTab owner={OWNER} />);
        await screen.findByTestId('sentinel-todo-row-i1');
        select();
        fireEvent.click(within(detail()).getByRole('button', { name: 'Edit' }));
        fireEvent.change(within(detail()).getByLabelText('Title'), { target: { value: 'Old owner draft' } });
        fireEvent.click(within(detail()).getByRole('button', { name: 'Save' }));
        const oldRead = deferred<SentinelTodoLedgerResponse>();
        get.mockReturnValueOnce(oldRead.promise).mockResolvedValue(ledger([item({ title: 'New owner' })]));
        mounted.rerender(<UnifiedTodoTab owner={{ ...OWNER, processId: 'other-chat' }} />);
        mounted.rerender(<UnifiedTodoTab owner={{ ...OWNER, ownerWorkspaceId: 'other-repo', processId: 'other-chat' }} />);
        await screen.findByRole('button', { name: /New owner/ });
        expect(screen.getByText('Select an item to view its details.')).toBeTruthy();
        const readCount = get.mock.calls.length;
        await act(async () => { pending.resolve({}); oldRead.resolve(ledger([item({ title: 'Late old owner' })])); });
        expect(get).toHaveBeenCalledTimes(readCount);
        expect(screen.queryByText('Late old owner')).toBeNull();
        select();
        expect(within(detail()).queryByLabelText('Title')).toBeNull();
    });

    it('labels simultaneous owner panes by their own heading even when item ids match', async () => {
        get.mockImplementation(async (workspaceId: string) => ledger([item({ title: workspaceId })]));
        const first = render(<UnifiedTodoTab owner={{ ...OWNER, ownerWorkspaceId: 'first-owner' }} />);
        const second = render(<UnifiedTodoTab owner={{ ...OWNER, ownerWorkspaceId: 'second-owner' }} />);
        const firstRow = await within(first.container).findByTestId('sentinel-todo-row-i1');
        const secondRow = await within(second.container).findByTestId('sentinel-todo-row-i1');
        fireEvent.click(firstRow.querySelector('[data-todo-select]')!);
        fireEvent.click(secondRow.querySelector('[data-todo-select]')!);
        expect(within(first.container).getByRole('region', { name: /first-owner/ })).toBeTruthy();
        expect(within(second.container).getByRole('region', { name: /second-owner/ })).toBeTruthy();
        fireEvent.click(within(first.container).getByRole('button', { name: 'Edit' }));
        fireEvent.click(within(second.container).getByRole('button', { name: 'Edit' }));
        const firstTitle = within(first.container).getByLabelText('Title') as HTMLInputElement;
        const secondTitle = within(second.container).getByLabelText('Title') as HTMLInputElement;
        expect(firstTitle.value).toBe('first-owner');
        expect(secondTitle.value).toBe('second-owner');
        expect(firstTitle.id).not.toBe(secondTitle.id);
    });

    it('shows explicit loading/error/empty states and never reads an unresolved owner locally', async () => {
        const read = deferred<SentinelTodoLedgerResponse>();
        get.mockReturnValue(read.promise);
        const mounted = render(<UnifiedTodoTab owner={OWNER} />);
        expect(screen.getByTestId('sentinel-todo-loading')).toBeTruthy();
        await act(async () => read.resolve(ledger([])));
        expect(screen.getByTestId('sentinel-todo-empty')).toBeTruthy();
        mounted.rerender(<UnifiedTodoTab owner={{ ...OWNER, ownerRoutingRef: 'remote:offline:ws-1' }} />);
        await screen.findByRole('alert');
        expect(screen.getByText('Details unavailable until the list loads.')).toBeTruthy();
        expect(get).toHaveBeenCalledTimes(1);
    });
});

describe('UnifiedTodoTab Manual tracking', () => {
    const manualItem = (overrides: Partial<SentinelTodoItem> = {}) => item({
        id: 'm1', title: 'Call the vendor', completionCondition: '', notes: '', type: 'manual', createdBy: 'user', ...overrides,
    });
    const manualSection = () => screen.getByTestId('sentinel-todo-manual-section');

    it('keeps an expanded, empty Manual tracking section after normal tracking', async () => {
        get.mockResolvedValue(ledger([]));
        render(<UnifiedTodoTab owner={OWNER} />);
        const empty = await screen.findByTestId('sentinel-todo-empty');
        const section = manualSection();
        expect(empty.compareDocumentPosition(section) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
        const toggle = within(section).getByRole('button', { name: 'Manual tracking (0 active)' });
        expect(toggle.getAttribute('aria-expanded')).toBe('true');
        expect(document.getElementById(toggle.getAttribute('aria-controls')!)).toBeTruthy();
        expect(screen.getByRole('region', { name: 'Manual tracking (0 active)' })).toBe(section);
        expect(within(section).getByTestId('sentinel-todo-manual-empty').textContent).toBe('No manual items yet.');
        expect(within(section).getByRole('button', { name: 'Add manual item' })).toBeTruthy();
        // The header says these items are tracked only and never executed.
        const tag = within(section).getByTestId('sentinel-todo-manual-tracked-only');
        expect(tag.textContent).toBe('Tracked only · never run');
        expect(toggle.contains(tag)).toBe(false);
    });

    it('renders active normal items, then Manual tracking, then normal Done and Archived', async () => {
        const follows = (a: HTMLElement, b: HTMLElement) => !!(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
        get.mockResolvedValue(ledger([
            item({ id: 'n-todo' }),
            item({ id: 'n-done', status: 'done' }),
            item({ id: 'n-arch', archived: true }),
            manualItem({ id: 'm-todo' }),
            manualItem({ id: 'm-done', status: 'done' }),
        ]));
        render(<UnifiedTodoTab owner={OWNER} />);
        const active = await screen.findByTestId('sentinel-todo-row-n-todo');
        const section = manualSection();
        const done = screen.getByTestId('sentinel-todo-done-section');
        const archived = screen.getByTestId('sentinel-todo-archived-section');
        expect(follows(active, section)).toBe(true);
        expect(follows(section, done)).toBe(true);
        expect(follows(done, archived)).toBe(true);
        expect(section.contains(done)).toBe(false);
        // The manual section keeps its own nested Done group.
        expect(within(section).getByTestId('sentinel-todo-manual-done-section')).toBeTruthy();
    });

    it('keeps an empty Manual tracking section above normal Done', async () => {
        get.mockResolvedValue(ledger([item({ id: 'n-done', status: 'done' })]));
        render(<UnifiedTodoTab owner={OWNER} />);
        const noActive = await screen.findByTestId('sentinel-todo-no-active');
        const section = manualSection();
        expect(within(section).getByTestId('sentinel-todo-manual-empty').textContent).toBe('No manual items yet.');
        expect(noActive.compareDocumentPosition(section) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
        expect(section.compareDocumentPosition(screen.getByTestId('sentinel-todo-done-section')) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    });

    it('waits for the ledger before showing Manual tracking, and never shows it as empty on a load error', async () => {
        const pending = deferred<SentinelTodoLedgerResponse>();
        get.mockReturnValueOnce(pending.promise);
        const { unmount } = render(<UnifiedTodoTab owner={OWNER} />);
        expect(screen.getByTestId('sentinel-todo-loading').textContent).toMatch(/Loading to-do items/);
        expect(screen.queryByTestId('sentinel-todo-manual-section')).toBeNull();
        unmount();
        get.mockReset().mockRejectedValueOnce(new Error('Network down')).mockResolvedValue(ledger([manualItem()]));
        render(<UnifiedTodoTab owner={OWNER} />);
        const alert = await screen.findByTestId('sentinel-todo-load-error');
        expect(screen.queryByTestId('sentinel-todo-manual-empty')).toBeNull();
        fireEvent.click(within(alert).getByRole('button', { name: 'Retry' }));
        await screen.findByTestId('sentinel-todo-row-m1');
        expect(screen.queryByTestId('sentinel-todo-load-error')).toBeNull();
    });

    it('adds a title-only manual item from its own form, separate from Add item', async () => {
        get.mockResolvedValueOnce(ledger([])).mockResolvedValue(ledger([manualItem()]));
        create.mockResolvedValue({ item: manualItem(), ledgerRevision: 1, created: true });
        render(<UnifiedTodoTab owner={OWNER} />);
        await screen.findByTestId('sentinel-todo-empty');
        fireEvent.click(within(manualSection()).getByRole('button', { name: 'Add manual item' }));
        const form = screen.getByRole('form', { name: 'Add manual item' });
        expect(screen.queryByTestId('sentinel-todo-add-form')).toBeNull();
        expect(within(form).getByLabelText('Done when (optional)')).toBeTruthy();
        expect(within(form).getByLabelText('Notes (optional)')).toBeTruthy();
        const title = within(form).getByLabelText('Title') as HTMLInputElement;
        expect(title.required).toBe(true);
        const add = within(form).getByRole('button', { name: 'Add' }) as HTMLButtonElement;
        expect(add.disabled).toBe(true);
        fireEvent.change(title, { target: { value: '  Call the vendor ' } });
        fireEvent.click(add);
        await within(manualSection()).findByTestId('sentinel-todo-row-m1');
        expect(create).toHaveBeenCalledWith('ws-1', 'queue_sentinel', {
            title: 'Call the vendor', completionCondition: '', notes: '', priority: 'regular', type: 'manual',
            idempotencyKey: expect.any(String),
        });
        expect(screen.queryByRole('form', { name: 'Add manual item' })).toBeNull();
        expect(within(manualSection()).getByRole('button', { name: 'Manual tracking (1 active)' })).toBeTruthy();
        // Normal tracking is untouched: its empty state and Add item remain.
        expect(screen.getByTestId('sentinel-todo-empty')).toBeTruthy();
    });

    it('creates normal items without a type from Add item', async () => {
        get.mockResolvedValueOnce(ledger([])).mockResolvedValue(ledger([item()]));
        create.mockResolvedValue({ item: item(), ledgerRevision: 1, created: true });
        render(<UnifiedTodoTab owner={OWNER} />);
        fireEvent.click(await screen.findByRole('button', { name: 'Add item' }));
        expect(screen.getByLabelText('Done when')).toBeTruthy();
        fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Fix login' } });
        fireEvent.click(screen.getByRole('button', { name: 'Add' }));
        await screen.findByTestId('sentinel-todo-row-i1');
        expect(create.mock.calls[0][2]).not.toHaveProperty('type');
        expect(within(manualSection()).getByTestId('sentinel-todo-manual-empty').textContent).toBe('No manual items yet.');
    });

    it('keeps a failed manual draft and retries it with the same idempotency key', async () => {
        get.mockResolvedValueOnce(ledger([])).mockResolvedValue(ledger([manualItem()]));
        create.mockRejectedValueOnce(new Error('disk full')).mockResolvedValue({ item: manualItem(), ledgerRevision: 1, created: true });
        render(<UnifiedTodoTab owner={OWNER} />);
        await screen.findByTestId('sentinel-todo-empty');
        fireEvent.click(screen.getByRole('button', { name: 'Add manual item' }));
        const form = screen.getByRole('form', { name: 'Add manual item' });
        fireEvent.change(within(form).getByLabelText('Title'), { target: { value: 'Call the vendor' } });
        fireEvent.change(within(form).getByLabelText('Notes (optional)'), { target: { value: 'Ask about pricing' } });
        fireEvent.click(within(form).getByRole('button', { name: 'Add' }));
        const alert = await screen.findByTestId('sentinel-todo-manual-add-error');
        expect(form.contains(alert)).toBe(true);
        expect(alert.textContent).toMatch(/Could not save: disk full/);
        expect((within(form).getByLabelText('Title') as HTMLInputElement).value).toBe('Call the vendor');
        expect((within(form).getByLabelText('Notes (optional)') as HTMLTextAreaElement).value).toBe('Ask about pricing');
        fireEvent.click(within(alert).getByRole('button', { name: 'Retry' }));
        await screen.findByTestId('sentinel-todo-row-m1');
        expect(create).toHaveBeenCalledTimes(2);
        expect(create.mock.calls[1][2]).toMatchObject({ type: 'manual', notes: 'Ask about pricing' });
        expect(create.mock.calls[1][2].idempotencyKey).toBe(create.mock.calls[0][2].idempotencyKey);
    });

    it('groups manual items apart from normal ones, status first and oldest first, with collapsed Done and Archived', async () => {
        get.mockResolvedValue(ledger([
            item({ id: 'n-todo', title: 'Normal todo' }),
            item({ id: 'n-done', title: 'Normal done', status: 'done' }),
            manualItem({ id: 'm-todo-new', title: 'Newer todo', createdAt: '2026-10-09T05:00:00.000Z' }),
            manualItem({ id: 'm-todo-old', title: 'Older todo', priority: 'high', createdAt: '2026-10-09T01:00:00.000Z' }),
            manualItem({ id: 'm-progress', status: 'in_progress', createdAt: '2026-10-09T06:00:00.000Z' }),
            manualItem({ id: 'm-attn', status: 'needs_attention', statusReason: 'Vendor silent', createdAt: '2026-10-09T07:00:00.000Z' }),
            manualItem({ id: 'm-done', status: 'done' }),
            manualItem({ id: 'm-arch', archived: true }),
        ]));
        render(<UnifiedTodoTab owner={OWNER} />);
        await screen.findByTestId('sentinel-todo-row-n-todo');
        const section = manualSection();
        const rowIds = (root: HTMLElement) => within(root).queryAllByTestId(/^sentinel-todo-row-(?!error)/).map(r => r.getAttribute('data-testid'));
        expect(rowIds(section)).toEqual([
            'sentinel-todo-row-m-attn', 'sentinel-todo-row-m-progress', 'sentinel-todo-row-m-todo-old', 'sentinel-todo-row-m-todo-new',
        ]);
        // High is a visible label, not a scheduling signal.
        expect(within(section).getByTestId('sentinel-todo-priority-high-m-todo-old').textContent).toContain('High');
        expect(within(section).getByTestId('sentinel-todo-row-m-attn').textContent).toContain('Needs attention');
        expect(within(section).getByRole('button', { name: 'Manual tracking (4 active)' })).toBeTruthy();
        // Normal sections hold only normal items.
        expect(screen.getByTestId('sentinel-todo-done-section').textContent).toContain('Done (1)');
        expect(screen.queryByTestId('sentinel-todo-archived-section')).toBeNull();
        const done = within(section).getByTestId('sentinel-todo-manual-done-section');
        const archived = within(section).getByTestId('sentinel-todo-manual-archived-section');
        const doneToggle = within(done).getByRole('button', { name: 'Done (1)' });
        const archivedToggle = within(archived).getByRole('button', { name: 'Archived (1)' });
        expect(doneToggle.getAttribute('aria-expanded')).toBe('false');
        expect(archivedToggle.getAttribute('aria-expanded')).toBe('false');
        expect(screen.queryByTestId('sentinel-todo-row-m-done')).toBeNull();
        fireEvent.click(doneToggle);
        expect(within(done).getByTestId('sentinel-todo-row-m-done')).toBeTruthy();
        expect(screen.queryByTestId('sentinel-todo-row-n-done')).toBeNull();
        fireEvent.click(archivedToggle);
        expect(within(archived).getByTestId('sentinel-todo-row-m-arch')).toBeTruthy();
    });

    it('collapses and expands Manual tracking, and Add manual item reopens it', async () => {
        get.mockResolvedValue(ledger([manualItem()]));
        render(<UnifiedTodoTab owner={OWNER} />);
        await screen.findByTestId('sentinel-todo-row-m1');
        const toggle = within(manualSection()).getByRole('button', { name: 'Manual tracking (1 active)' });
        expect(toggle.tagName).toBe('BUTTON');
        fireEvent.click(toggle);
        expect(toggle.getAttribute('aria-expanded')).toBe('false');
        expect(screen.queryByTestId('sentinel-todo-row-m1')).toBeNull();
        fireEvent.click(screen.getByRole('button', { name: 'Add manual item' }));
        expect(toggle.getAttribute('aria-expanded')).toBe('true');
        expect(screen.getByRole('form', { name: 'Add manual item' })).toBeTruthy();
        expect(screen.getByTestId('sentinel-todo-row-m1')).toBeTruthy();
    });

    it('shows No active manual items when every manual item is Done or Archived', async () => {
        get.mockResolvedValue(ledger([manualItem({ status: 'done' })]));
        render(<UnifiedTodoTab owner={OWNER} />);
        const empty = await within(await screen.findByTestId('sentinel-todo-manual-section')).findByTestId('sentinel-todo-manual-empty');
        expect(empty.textContent).toBe('No active manual items.');
        expect(within(manualSection()).getByRole('button', { name: 'Manual tracking (0 active)' })).toBeTruthy();
    });

    it('edits a manual item in details with optional fields and priority, keeping the draft on a conflict', async () => {
        const current = manualItem({ title: 'Call the vendor today', revision: 3 });
        get.mockResolvedValueOnce(ledger([manualItem({ revision: 2 })])).mockResolvedValue(ledger([current]));
        update.mockRejectedValueOnce(conflict(current)).mockResolvedValue({ item: current, ledgerRevision: 5 });
        render(<UnifiedTodoTab owner={OWNER} />);
        let row = await screen.findByTestId('sentinel-todo-row-m1');
        fireEvent.click(within(row).getByRole('button', { pressed: false }));
        row = screen.getByTestId('sentinel-todo-detail-m1');
        expect(within(row).getByText('Not set')).toBeTruthy();
        fireEvent.click(within(row).getByRole('button', { name: 'Edit' }));
        fireEvent.change(within(row).getByLabelText('Title'), { target: { value: 'Call the vendor back' } });
        fireEvent.change(within(row).getByLabelText('Notes (optional)'), { target: { value: 'Ask about renewal' } });
        fireEvent.change(within(row).getByLabelText('Done when (optional)'), { target: { value: 'Quote received' } });
        fireEvent.change(within(row).getByLabelText('Priority'), { target: { value: 'high' } });
        fireEvent.click(within(row).getByRole('button', { name: 'Save' }));
        const error = await screen.findByTestId('sentinel-todo-row-error-m1');
        expect(error.textContent).toMatch(/changed since you opened it/);
        expect(update.mock.calls[0][3]).toEqual({
            expectedRevision: 2, title: 'Call the vendor back', notes: 'Ask about renewal', completionCondition: 'Quote received', priority: 'high',
        });
        expect(update.mock.calls[0][3]).not.toHaveProperty('type');
        await waitFor(() => expect(get).toHaveBeenCalledTimes(2));
        // The latest accepted item is shown while the edit is retained.
        const latest = screen.getByTestId('sentinel-todo-detail-m1');
        expect(latest.textContent).toContain('Call the vendor today');
        expect((within(latest).getByLabelText('Title') as HTMLInputElement).value).toBe('Call the vendor back');
        fireEvent.click(within(latest).getByRole('button', { name: 'Save' }));
        await waitFor(() => expect(update).toHaveBeenCalledTimes(2));
        expect(update.mock.calls[1][3]).toMatchObject({ expectedRevision: 3, title: 'Call the vendor back', priority: 'high' });
    });

    it('moves a manual item through all four statuses, reopens it, archives and restores it', async () => {
        get.mockResolvedValue(ledger([manualItem({ revision: 2 })]));
        update.mockResolvedValue({ item: manualItem(), ledgerRevision: 3 });
        render(<UnifiedTodoTab owner={OWNER} />);
        let row = await screen.findByTestId('sentinel-todo-row-m1');
        fireEvent.click(within(row).getByRole('button', { pressed: false }));
        row = screen.getByTestId('sentinel-todo-detail-m1');
        const status = within(row).getByRole('group', { name: 'Status' });
        expect(within(status).getAllByRole('button').map(b => b.textContent?.replace(/^\W+/, ''))).toEqual(['To do', 'In progress', 'Needs attention', 'Done']);
        expect(within(status).getByRole('button', { pressed: true }).textContent).toContain('To do');
        chooseStatus(row, 'In progress');
        await waitFor(() => expect(update).toHaveBeenLastCalledWith('ws-1', 'queue_sentinel', 'm1', { expectedRevision: 2, status: 'in_progress', statusReason: null }));
        chooseStatus(row, 'Needs attention');
        fireEvent.change(within(row).getByLabelText('Reason for Needs attention'), { target: { value: 'Vendor silent' } });
        fireEvent.click(within(row).getByRole('button', { name: 'Set status' }));
        await waitFor(() => expect(update).toHaveBeenLastCalledWith('ws-1', 'queue_sentinel', 'm1', { expectedRevision: 2, status: 'needs_attention', statusReason: 'Vendor silent' }));
        chooseStatus(row, 'Done');
        fireEvent.change(within(row).getByLabelText('Reason for Done (optional)'), { target: { value: 'Quote received' } });
        fireEvent.click(within(row).getByRole('button', { name: 'Set status' }));
        await waitFor(() => expect(update).toHaveBeenLastCalledWith('ws-1', 'queue_sentinel', 'm1', {
            expectedRevision: 2, status: 'done', statusReason: 'Quote received', outcome: 'Quote received',
        }));
        cleanup();

        // A Done manual item reopens to the active list and archives/restores through user writes.
        get.mockReset().mockResolvedValueOnce(ledger([manualItem({ status: 'done', revision: 4 })]))
            .mockResolvedValueOnce(ledger([manualItem({ status: 'todo', revision: 5 })]))
            .mockResolvedValueOnce(ledger([manualItem({ status: 'todo', archived: true, revision: 6 })]))
            .mockResolvedValue(ledger([manualItem({ status: 'todo', revision: 7 })]));
        render(<UnifiedTodoTab owner={OWNER} />);
        const done = await screen.findByTestId('sentinel-todo-manual-done-section');
        expect(within(done).getByRole('button', { name: 'Done (1)' }).getAttribute('aria-expanded')).toBe('true');
        // The remount restores the item selected from the owner's remembered view.
        expect(within(screen.getByTestId('sentinel-todo-row-m1')).getByRole('button', { pressed: true })).toBeTruthy();
        fireEvent.click(screen.getByRole('button', { name: 'Reopen' }));
        await waitFor(() => expect(update).toHaveBeenLastCalledWith('ws-1', 'queue_sentinel', 'm1', { expectedRevision: 4, status: 'todo', statusReason: null }));
        await waitFor(() => expect(screen.queryByTestId('sentinel-todo-manual-done-section')).toBeNull());
        expect(within(manualSection()).getByRole('button', { name: 'Manual tracking (1 active)' })).toBeTruthy();
        fireEvent.click(within(screen.getByTestId('sentinel-todo-detail-m1')).getByRole('button', { name: 'Archive' }));
        await waitFor(() => expect(update).toHaveBeenLastCalledWith('ws-1', 'queue_sentinel', 'm1', { expectedRevision: 5, archived: true }));
        const archived = await screen.findByTestId('sentinel-todo-manual-archived-section');
        expect(within(manualSection()).getByRole('button', { name: 'Manual tracking (0 active)' })).toBeTruthy();
        expect(within(archived).getByRole('button', { name: 'Archived (1)' }).getAttribute('aria-expanded')).toBe('true');
        const archivedRow = screen.getByTestId('sentinel-todo-detail-m1');
        // The detail stays selected across groups because selection is keyed by item id.
        fireEvent.click(within(archivedRow).getByRole('button', { name: 'Restore' }));
        await waitFor(() => expect(update).toHaveBeenLastCalledWith('ws-1', 'queue_sentinel', 'm1', { expectedRevision: 6, archived: false }));
        await within(manualSection()).findByRole('button', { name: 'Manual tracking (1 active)' });
        expect(create).not.toHaveBeenCalled();
    });

    it('keeps a failed manual status save visible with Retry', async () => {
        get.mockResolvedValue(ledger([manualItem({ revision: 2 })]));
        update.mockRejectedValueOnce(new Error('disk full')).mockResolvedValue({ item: manualItem(), ledgerRevision: 3 });
        render(<UnifiedTodoTab owner={OWNER} />);
        let row = await screen.findByTestId('sentinel-todo-row-m1');
        fireEvent.click(within(row).getByRole('button', { pressed: false }));
        row = screen.getByTestId('sentinel-todo-detail-m1');
        chooseStatus(row, 'In progress');
        const alert = await within(row).findByTestId('sentinel-todo-row-error-m1');
        expect(alert.textContent).toMatch(/Could not save: disk full/);
        fireEvent.click(within(alert).getByRole('button', { name: 'Retry' }));
        await waitFor(() => expect(update).toHaveBeenCalledTimes(2));
        expect(update.mock.calls[1][3]).toEqual(update.mock.calls[0][3]);
    });

    it('wraps manual rows and stacks form fields in a narrow pane', async () => {
        get.mockResolvedValue(ledger([manualItem({ priority: 'high', title: 'A very long manual title that must wrap inside a narrow panel' })]));
        render(<div style={{ width: 220 }}><UnifiedTodoTab owner={OWNER} /></div>);
        const row = await screen.findByTestId('sentinel-todo-row-m1');
        expect(within(row).getByText(/A very long manual title/).className).toMatch(/break-words/);
        fireEvent.click(screen.getByRole('button', { name: 'Add manual item' }));
        const form = screen.getByRole('form', { name: 'Add manual item' });
        expect(form.className).toMatch(/flex-col/);
        const header = screen.getByRole('button', { name: /Manual tracking/ }).closest('h3')!.parentElement!;
        expect(header.className).toMatch(/flex-wrap/);
    });
});

describe('Sentinel chat registry and persistent tabs', () => {
    afterEach(() => {
        clearSentinelTodoChats();
        clearUnifiedPanelState();
    });

    it.each([undefined, true, false])('ignores retired ledger value %s without removing stored workspace tabs', value => {
        applyRuntimeConfigPatch({ sentinelTodoLedgerEnabled: value });
        for (const workspaceId of ['ws-1', 'ws-2']) {
            const owner = { ...OWNER, ownerWorkspaceId: workspaceId };
            writeUnifiedPanelState(workspaceId, openTab(EMPTY_UNIFIED_PANEL, sentinelTodoTabInput(owner, 'chat-1')));
        }
        const saved = ['ws-1', 'ws-2'].map(readUnifiedPanelState);
        const { result } = renderHook(() => ({
            first: useUnifiedPanelTabs('ws-1', 'chat-1'),
            second: useUnifiedPanelTabs('ws-2', 'chat-1'),
        }));
        expect(result.current.first.tabs.map(tab => tab.kind)).toEqual(['todo']);
        expect(result.current.second.tabs.map(tab => tab.kind)).toEqual(['todo']);
        act(() => applyRuntimeConfigPatch({ sentinelTodoLedgerEnabled: false }));
        expect(result.current.first.tabs.map(tab => tab.kind)).toEqual(['todo']);
        expect(result.current.second.tabs.map(tab => tab.kind)).toEqual(['todo']);
        expect(['ws-1', 'ws-2'].map(readUnifiedPanelState)).toEqual(saved);
        act(() => applyRuntimeConfigPatch({ sentinelTodoLedgerEnabled: true }));
        expect(result.current.first.tabs.map(tab => tab.kind)).toEqual(['todo']);
        expect(result.current.second.tabs.map(tab => tab.kind)).toEqual(['todo']);
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

    it('restores stored To-do tabs without runtime feature configuration', () => {
        act(() => writeUnifiedPanelState('ws-1', openTab(EMPTY_UNIFIED_PANEL, sentinelTodoTabInput(OWNER, 'chat-1'))));
        const { result } = renderHook(() => useUnifiedPanelTabs('ws-1', 'chat-1'));
        expect(result.current.tabs.map(tab => tab.kind)).toEqual(['todo']);
        expect(result.current.active?.resourceId).toBe(OWNER.processId);
    });
});
