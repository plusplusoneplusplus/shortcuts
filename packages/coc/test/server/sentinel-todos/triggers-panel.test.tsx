/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { PrTriggerPreview, SentinelTodoItem, Trigger } from '@plusplusoneplusplus/coc-client';

const mocks = vi.hoisted(() => ({
    list: vi.fn(), preview: vi.fn(), create: vi.fn(), edit: vi.fn(), pause: vi.fn(), resume: vi.fn(),
    remove: vi.fn(), runNow: vi.fn(), connect: vi.fn(), workspaceList: vi.fn(), prList: vi.fn(),
    get: vi.fn(), processGet: vi.fn(), groupGet: vi.fn(), route: vi.fn(), refs: [] as unknown[],
}));
const client = {
    triggers: {
        listSentinelTodo: mocks.list, previewSentinelTodo: mocks.preview, createSentinelTodo: mocks.create,
        editSentinelTodo: mocks.edit, pauseSentinelTodo: mocks.pause, resumeSentinelTodo: mocks.resume,
        removeSentinelTodo: mocks.remove, runSentinelTodoNow: mocks.runNow,
    },
    sentinelTodos: { get: mocks.get },
    processes: { get: mocks.processGet },
    taskGroups: { get: mocks.groupGet },
    events: { connect: mocks.connect },
    workspaces: { list: mocks.workspaceList },
    pullRequests: { listForOrigin: mocks.prList },
};
vi.mock('../../../src/server/spa/client/react/repos/cloneRouting', () => ({
    useCocClient: (ref: unknown) => { mocks.refs.push(ref); return client; },
}));
vi.mock('../../../src/server/spa/client/react/repos/cloneRegistry', async importOriginal => ({
    ...await importOriginal<object>(),
    resolveCloneRoute: mocks.route,
    getCocClientForWorkspace: () => client,
}));

import { SentinelTodoTriggers } from '../../../src/server/spa/client/react/features/repo-detail/unified-right-panel/SentinelTodoTriggers';
import { UnifiedTodoTab } from '../../../src/server/spa/client/react/features/repo-detail/unified-right-panel/UnifiedTodoTab';
import { applyRuntimeConfigPatch } from '../../../src/server/spa/client/react/utils/config';
import { resolveCanonicalOriginId } from '../../../src/server/spa/client/react/repos/originScope';
import { triggerError } from '../../../src/server/spa/client/react/features/repo-detail/unified-right-panel/sentinelTodoTriggerModel';
import { clearSentinelTodoExcursion } from '../../../src/server/spa/client/react/features/repo-detail/unified-right-panel/sentinelTodoExcursion';

const owner = { ownerWorkspaceId: 'ws-owner', ownerRoutingRef: 'remote:server:ws-owner', processId: 'queue_sentinel' };
const iso = '2026-10-10T00:00:00.000Z';
function item(overrides: Partial<SentinelTodoItem> = {}): SentinelTodoItem {
    return { id: 'item-1', title: 'Follow-up work', completionCondition: 'Tests pass', notes: '', status: 'todo', type: 'normal',
        archived: false, revision: 1, createdAt: iso, updatedAt: iso, createdBy: 'sentinel', updatedBy: 'sentinel',
        priority: 'regular', jobs: [], ...overrides };
}
function rule(overrides: Partial<Trigger> = {}): Trigger {
    return {
        id: 'rule-1', workspaceId: owner.ownerWorkspaceId, processId: owner.processId, status: 'active', revision: 4,
        event: { type: 'condition-monitor', monitor: 'pr-merged', pr: { provider: 'github', host: 'github.com', repoPath: 'example/repo', number: 7, url: 'https://github.com/example/repo/pull/7' }, consecutiveErrors: 0, pollIntervalMs: 300000 },
        action: { type: 'send-message', processId: owner.processId, prompt: '', mode: 'inherit' },
        binding: { kind: 'sentinel-todo', itemId: 'item-1', instruction: 'Run focused tests', armedBy: 'sentinel', armedAt: iso },
        createdAt: iso, expiresAt: null, lastTickAt: iso, nextTickAt: iso, inFlight: false, ...overrides,
    };
}
function preview(status: PrTriggerPreview['snapshot']['status'] = 'open'): PrTriggerPreview {
    const pr = rule().event;
    if (pr.monitor !== 'pr-merged') throw new Error('fixture');
    return { pr: pr.pr, snapshot: { title: 'Dependency update', status, url: pr.pr.url } };
}
function mount(items = [item()]) {
    const onItemLink = vi.fn();
    return { ...render(<SentinelTodoTriggers owner={owner} items={items} onItemLink={onItemLink} />), onItemLink };
}
async function openEditor() {
    fireEvent.click(await screen.findByRole('button', { name: '+ Add trigger' }));
    fireEvent.change(screen.getByLabelText('PR URL'), { target: { value: preview().pr.url } });
    await screen.findByText('Dependency update');
}
async function actions() {
    await screen.findByText('Waiting');
    fireEvent.click(screen.getByLabelText('Actions for PR #7'));
}
function deferred<T>() {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>(done => { resolve = done; });
    return { promise, resolve };
}
beforeEach(() => {
    clearSentinelTodoExcursion();
    vi.clearAllMocks();
    mocks.refs.length = 0;
    mocks.list.mockReset().mockResolvedValue([]);
    mocks.preview.mockReset().mockResolvedValue(preview());
    mocks.create.mockReset().mockResolvedValue(rule());
    mocks.edit.mockReset().mockResolvedValue(rule());
    mocks.pause.mockReset().mockResolvedValue(rule({ status: 'paused' }));
    mocks.resume.mockReset().mockResolvedValue(rule());
    mocks.remove.mockReset().mockResolvedValue({ deleted: true, trigger: rule() });
    mocks.runNow.mockReset().mockResolvedValue(rule({ outcome: 'fired' }));
    mocks.connect.mockReset().mockReturnValue({ close: vi.fn() });
    mocks.workspaceList.mockReset().mockResolvedValue({ workspaces: [{ id: 'ws-local', name: 'Local repo', rootPath: '.', remoteUrl: 'https://github.com/example/repo.git' }] });
    mocks.prList.mockReset().mockResolvedValue({ pullRequests: [{ title: 'Local PR', number: 7, webUrl: preview().pr.url }], total: 1 });
    mocks.get.mockReset().mockResolvedValue({ items: [item()], revision: 1 });
    mocks.route.mockReturnValue({ kind: 'remote', baseUrl: 'https://server.example.test' });
    applyRuntimeConfigPatch({ triggersEnabled: true, sentinelTodoSplitLayoutEnabled: false });
});
afterEach(() => { cleanup(); vi.useRealTimers(); applyRuntimeConfigPatch({ triggersEnabled: false, sentinelTodoSplitLayoutEnabled: false }); });

describe('Sentinel To-do Triggers', () => {
    it('hides the section with no rules, but retains a first-add entry point', async () => {
        mount();
        await waitFor(() => expect(mocks.list).toHaveBeenCalledWith(owner.ownerWorkspaceId, owner.processId));
        expect(screen.queryByTestId('sentinel-todo-triggers')).toBeNull();
        expect(screen.getByRole('button', { name: '+ Add trigger' })).toBeTruthy();
        expect(mocks.refs).toContain(owner.ownerRoutingRef);
        expect(mocks.create).not.toHaveBeenCalled();
    });
    it('makes no requests with the existing triggers gate off, and reacts to gate changes', async () => {
        applyRuntimeConfigPatch({ triggersEnabled: false });
        mount();
        expect(mocks.list).not.toHaveBeenCalled();
        expect(mocks.connect).not.toHaveBeenCalled();
        expect(screen.queryByText('+ Add trigger')).toBeNull();
        act(() => applyRuntimeConfigPatch({ triggersEnabled: true }));
        await waitFor(() => expect(mocks.list).toHaveBeenCalledOnce());
        act(() => applyRuntimeConfigPatch({ triggersEnabled: false }));
        expect(screen.queryByText('+ Add trigger')).toBeNull();
        expect(mocks.connect.mock.results[0].value.close).toHaveBeenCalled();
    });
    it('does not fall back to local transport for an unresolved remote owner', () => {
        mocks.route.mockReturnValue({ kind: 'unresolved-remote' });
        mount();
        expect(screen.getByText(/owning server is not connected/)).toBeTruthy();
        expect(mocks.list).not.toHaveBeenCalled();
        expect(mocks.connect).not.toHaveBeenCalled();
    });
    it('sorts nonterminal first, uses outlined badges, links identities and items, and collapses', async () => {
        mocks.list.mockResolvedValue([rule({ id: 'terminal', outcome: 'fired', status: 'disarmed' }), rule()]);
        const { onItemLink } = mount();
        const rows = await screen.findAllByTestId(/^sentinel-trigger-/);
        expect(rows.map(row => row.dataset.testid)).toEqual(['sentinel-trigger-rule-1', 'sentinel-trigger-terminal']);
        const first = within(rows[0]);
        expect(first.getByText('Waiting').className).toContain('sentinel-trigger-badge');
        const pr = first.getByRole('link', { name: 'PR example/repo#7' });
        expect(pr.getAttribute('href')).toBe(preview().pr.url);
        expect(pr.getAttribute('rel')).toContain('noopener');
        fireEvent.click(first.getByRole('link', { name: '→ Follow-up work' }));
        expect(onItemLink).toHaveBeenCalledWith('item-1');
        expect(first.getByText('Run focused tests').className).toContain('sentinel-trigger-instruction');
        expect(rows[0].textContent).toContain('Armed by Sentinel');
        fireEvent.click(screen.getByRole('button', { name: /Triggers \(2\)/ }));
        expect(screen.queryByText('Waiting')).toBeNull();
        expect(screen.getByRole('button', { name: /Triggers \(2\)/ }).getAttribute('aria-expanded')).toBe('false');
    });
    it.each([
        ['paused', rule({ status: 'paused' }), 'Paused'],
        ['closed', rule({ outcome: 'closed-unmerged', outcomeReason: 'PR closed without merging' }), 'Closed, not merged'],
        ['skipped', rule({ outcome: 'skipped', outcomeReason: 'Item done or archived' }), 'Skipped'],
        ['error', rule({ outcome: 'error', outcomeReason: 'Sentinel chat not found' }), 'Error'],
    ])('renders %s status with terminal-only Clear and visible reasons', async (_name, trigger, label) => {
        mocks.list.mockResolvedValue([trigger]);
        mount();
        await screen.findByText(label, { exact: true });
        if (trigger.outcome) {
            expect(screen.getByRole('button', { name: 'Clear' })).toBeTruthy();
            expect(screen.queryByLabelText('Actions for PR #7')).toBeNull();
            expect(screen.getByText(trigger.outcomeReason!)).toBeTruthy();
        } else expect(screen.getByLabelText('Actions for PR #7')).toBeTruthy();
    });
    it.each(['pending', 'delivered'] as const)('makes %s delivery visible alongside Fired and time', async state => {
        mocks.list.mockResolvedValue([rule({ outcome: 'fired', delivery: { state, firedAt: iso, deliveryId: 'delivery-1', reason: 'merged' } })]);
        mount();
        const badge = await screen.findByText('Fired');
        expect(badge.title.toLowerCase()).toContain(state === 'pending' ? 'pending' : 'delivered');
        expect(screen.getByText(state === 'pending' ? /Delivery pending/ : /Message delivered/)).toBeTruthy();
    });
    it('shows read errors over Waiting with retry details without terminalizing the row', async () => {
        const base = rule();
        mocks.list.mockResolvedValue([rule({ event: { ...base.event, monitor: 'pr-merged', pr: preview().pr, pollIntervalMs: 300000, consecutiveErrors: 2, lastError: { message: 'Login required', at: iso } } })]);
        mount();
        await screen.findByText('Waiting');
        expect(screen.getByText('⚠ Error · retrying').title).toContain('Login required');
        expect(screen.getByText('⚠ Error · retrying').title).toContain('Next retry');
        expect(screen.queryByRole('button', { name: 'Clear' })).toBeNull();
    });
    it('arms an eligible item with preview and instruction using owner-scoped typed calls', async () => {
        mount([item(), item({ id: 'manual', type: 'manual' }), item({ id: 'done', status: 'done' }), item({ id: 'archived', archived: true })]);
        await openEditor();
        const options = within(screen.getByLabelText('To-do item')).getAllByRole('option');
        expect(options.map(option => option.getAttribute('value'))).toEqual(['', 'item-1']);
        fireEvent.change(screen.getByLabelText('When it fires (optional)'), { target: { value: 'Use the item target repo' } });
        fireEvent.click(screen.getByRole('button', { name: 'Save and arm' }));
        await waitFor(() => expect(mocks.create).toHaveBeenCalledWith(owner.ownerWorkspaceId, owner.processId,
            { itemId: 'item-1', prUrl: preview().pr.url, instruction: 'Use the item target repo', idempotencyKey: expect.any(String) }));
        expect(mocks.preview).toHaveBeenCalledWith(owner.ownerWorkspaceId, owner.processId, { prUrl: preview().pr.url });
    });
    it('keeps add disabled when no eligible item exists', async () => {
        mount([item({ type: 'manual' }), item({ id: 'done', status: 'done' })]);
        expect((await screen.findByRole('button', { name: '+ Add trigger' }) as HTMLButtonElement).disabled).toBe(true);
    });
    it('blocks closed PRs and never calls create', async () => {
        mocks.preview.mockResolvedValue(preview('closed'));
        mount();
        await openEditor();
        expect(screen.getByText(/This PR cannot arm/)).toBeTruthy();
        expect((screen.getByRole('button', { name: 'Save and arm' }) as HTMLButtonElement).disabled).toBe(true);
        expect(screen.queryByRole('button', { name: 'Run now' })).toBeNull();
        expect(mocks.create).not.toHaveBeenCalled();
    });
    it('requires explicit confirmation to create a merged-PR run-now rule', async () => {
        mocks.preview.mockResolvedValue(preview('merged'));
        mount();
        await openEditor();
        fireEvent.click(screen.getByRole('button', { name: 'Run now' }));
        expect(mocks.create).not.toHaveBeenCalled();
        expect(screen.getByText(/This uses up the rule/)).toBeTruthy();
        fireEvent.click(screen.getByRole('button', { name: 'Confirm run now' }));
        await waitFor(() => expect(mocks.create).toHaveBeenCalledWith(owner.ownerWorkspaceId, owner.processId,
            { itemId: 'item-1', prUrl: preview().pr.url, instruction: '', idempotencyKey: expect.any(String), runNow: true, confirmed: true }));
    });
    it('keeps failed preview inline and retries without losing draft input', async () => {
        mocks.preview.mockRejectedValueOnce(new Error('PR login required'));
        mount();
        fireEvent.click(await screen.findByRole('button', { name: '+ Add trigger' }));
        fireEvent.change(screen.getByLabelText('PR URL'), { target: { value: preview().pr.url } });
        await screen.findByText('PR login required', { exact: false });
        fireEvent.click(screen.getByRole('button', { name: 'Retry preview' }));
        await screen.findByText('Dependency update');
        expect((screen.getByLabelText('PR URL') as HTMLInputElement).value).toBe(preview().pr.url);
    });
    it('ignores a stale preview after the PR input changes', async () => {
        const old = deferred<PrTriggerPreview>();
        mocks.preview.mockReturnValueOnce(old.promise).mockResolvedValue(preview('closed'));
        mount();
        fireEvent.click(await screen.findByRole('button', { name: '+ Add trigger' }));
        fireEvent.change(screen.getByLabelText('PR URL'), { target: { value: preview().pr.url } });
        await waitFor(() => expect(mocks.preview).toHaveBeenCalledOnce());
        fireEvent.change(screen.getByLabelText('PR URL'), { target: { value: 'https://github.com/example/repo/pull/8' } });
        await screen.findByText(/This PR cannot arm/);
        await act(async () => old.resolve(preview()));
        expect(screen.getByText(/This PR cannot arm/)).toBeTruthy();
        expect((screen.getByRole('button', { name: 'Save and arm' }) as HTMLButtonElement).disabled).toBe(true);
    });
    it('uses owner-server local workspace/origin PR APIs and attaches picked identity', async () => {
        mount();
        fireEvent.click(await screen.findByRole('button', { name: '+ Add trigger' }));
        fireEvent.click(screen.getByRole('button', { name: 'Pick a local PR' }));
        await screen.findByRole('option', { name: 'Local repo' });
        fireEvent.change(screen.getByLabelText('Local workspace on owning server'), { target: { value: 'ws-local' } });
        fireEvent.click(await screen.findByRole('button', { name: 'Local PR' }));
        await screen.findByText('Dependency update');
        fireEvent.click(screen.getByRole('button', { name: 'Save and arm' }));
        const originId = resolveCanonicalOriginId({ workspaceId: 'ws-local', remoteUrl: 'https://github.com/example/repo.git' });
        expect(mocks.prList).toHaveBeenCalledWith(originId, { workspaceId: 'ws-local', status: 'open', scope: 'all', top: 100 });
        await waitFor(() => expect(mocks.create).toHaveBeenCalledWith(owner.ownerWorkspaceId, owner.processId,
            { itemId: 'item-1', prUrl: preview().pr.url, instruction: '', idempotencyKey: expect.any(String), workspaceId: 'ws-local', originId }));
    });
    it('clears picker identity when URL is manually changed', async () => {
        mount();
        fireEvent.click(await screen.findByRole('button', { name: '+ Add trigger' }));
        fireEvent.click(screen.getByRole('button', { name: 'Pick a local PR' }));
        await screen.findByRole('option', { name: 'Local repo' });
        fireEvent.change(screen.getByLabelText('Local workspace on owning server'), { target: { value: 'ws-local' } });
        fireEvent.click(await screen.findByRole('button', { name: 'Local PR' }));
        await screen.findByText('Dependency update');
        const url = 'https://github.com/example/other/pull/9';
        fireEvent.change(screen.getByLabelText('PR URL'), { target: { value: url } });
        await waitFor(() => expect(mocks.preview).toHaveBeenCalledWith(owner.ownerWorkspaceId, owner.processId, { prUrl: url }));
        await screen.findByText('Dependency update');
        fireEvent.click(screen.getByRole('button', { name: 'Save and arm' }));
        await waitFor(() => expect(mocks.create).toHaveBeenCalledWith(owner.ownerWorkspaceId, owner.processId, { itemId: 'item-1', prUrl: url, instruction: '', idempotencyKey: expect.any(String) }));
    });
    it('pauses and resumes with current revisions, and terminal Clear removes only the rule', async () => {
        mocks.list.mockResolvedValueOnce([rule()]).mockResolvedValueOnce([rule({ status: 'paused', revision: 5 })]).mockResolvedValue([rule({ outcome: 'skipped', revision: 6 })]);
        mount();
        await actions();
        fireEvent.click(screen.getByRole('button', { name: 'Pause' }));
        await screen.findByText('Paused');
        expect(mocks.pause).toHaveBeenCalledWith(owner.ownerWorkspaceId, owner.processId, 'rule-1', 4);
        fireEvent.click(screen.getByRole('button', { name: 'Resume' }));
        await screen.findByText('Skipped');
        expect(mocks.resume).toHaveBeenCalledWith(owner.ownerWorkspaceId, owner.processId, 'rule-1', 5);
        fireEvent.click(screen.getByRole('button', { name: 'Clear' }));
        await waitFor(() => expect(mocks.remove).toHaveBeenCalledWith(owner.ownerWorkspaceId, owner.processId, 'rule-1', 6));
    });
    it('confirms existing rule Run now and consumes it via owner API only', async () => {
        mocks.list.mockResolvedValue([rule()]);
        mount();
        await actions();
        fireEvent.click(screen.getByRole('button', { name: 'Run now' }));
        expect(mocks.runNow).not.toHaveBeenCalled();
        fireEvent.click(screen.getByRole('button', { name: 'Confirm run now' }));
        await waitFor(() => expect(mocks.runNow).toHaveBeenCalledWith(owner.ownerWorkspaceId, owner.processId, 'rule-1', 4));
    });
    it('edits using expectedRevision and surfaces conflicts without silently resubmitting', async () => {
        mocks.list.mockResolvedValue([rule()]);
        mocks.edit.mockRejectedValue(Object.assign(new Error('Rule changed; refresh'), { status: 409 }));
        mount();
        await actions();
        fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
        await screen.findByText('Dependency update');
        fireEvent.change(screen.getByLabelText('When it fires (optional)'), { target: { value: 'Keep my draft' } });
        fireEvent.click(screen.getByRole('button', { name: 'Save and arm' }));
        await screen.findByText(/Rule changed; refresh/);
        expect(mocks.edit).toHaveBeenCalledWith(owner.ownerWorkspaceId, owner.processId, 'rule-1',
            { itemId: 'item-1', prUrl: preview().pr.url, instruction: 'Keep my draft', expectedRevision: 4 });
        expect((screen.getByLabelText('When it fires (optional)') as HTMLTextAreaElement).value).toBe('Keep my draft');
        expect(screen.getByRole('button', { name: 'Refresh rules' })).toBeTruthy();
        expect((screen.getByRole('button', { name: 'Save and arm' }) as HTMLButtonElement).disabled).toBe(true);
    });
    it('offers confirmed Run now in the editor for a merged saved rule without silently discarding edits', async () => {
        mocks.list.mockResolvedValue([rule()]);
        mocks.preview.mockResolvedValue(preview('merged'));
        mount();
        await actions();
        fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
        await screen.findByText('Dependency update');
        const editor = screen.getByRole('button', { name: 'Save and arm' }).closest('form')!;
        fireEvent.change(screen.getByLabelText('When it fires (optional)'), { target: { value: 'Unsaved change' } });
        expect((within(editor).getByRole('button', { name: 'Run now' }) as HTMLButtonElement).disabled).toBe(true);
        fireEvent.change(screen.getByLabelText('When it fires (optional)'), { target: { value: 'Run focused tests' } });
        fireEvent.click(within(editor).getByRole('button', { name: 'Run now' }));
        expect(mocks.runNow).not.toHaveBeenCalled();
        fireEvent.click(screen.getByRole('button', { name: 'Confirm run now' }));
        await waitFor(() => expect(mocks.runNow).toHaveBeenCalledWith(owner.ownerWorkspaceId, owner.processId, 'rule-1', 4));
        expect(mocks.edit).not.toHaveBeenCalled();
    });
    it('surfaces mutation conflicts with refresh and does not retry stale revisions', async () => {
        mocks.list.mockResolvedValue([rule()]);
        mocks.pause.mockRejectedValue(Object.assign(new Error('Revision conflict'), { status: 409 }));
        mount();
        await actions();
        fireEvent.click(screen.getByRole('button', { name: 'Pause' }));
        await screen.findByRole('button', { name: 'Refresh rules' });
        fireEvent.click(screen.getByRole('button', { name: 'Refresh rules' }));
        await waitFor(() => expect(mocks.list.mock.calls.length).toBeGreaterThanOrEqual(3));
        expect(mocks.pause).toHaveBeenCalledOnce();
    });
    it('retries failed actions visibly and retains rows on load failure', async () => {
        mocks.list.mockResolvedValue([rule()]);
        mocks.pause.mockRejectedValueOnce(new Error('Network unavailable'));
        mount();
        await actions();
        fireEvent.click(screen.getByRole('button', { name: 'Pause' }));
        await screen.findByText(/Network unavailable/);
        fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
        await waitFor(() => expect(mocks.pause).toHaveBeenCalledTimes(2));
        expect(screen.queryByText(/Network unavailable/)).toBeNull();
        expect(screen.getByText('Waiting')).toBeTruthy();
    });
    it('allows active Remove without any item bookkeeping or run-now call', async () => {
        mocks.list.mockResolvedValueOnce([rule()]).mockResolvedValue([]);
        mount();
        await actions();
        fireEvent.click(screen.getByRole('button', { name: 'Remove' }));
        await waitFor(() => expect(mocks.remove).toHaveBeenCalledWith(owner.ownerWorkspaceId, owner.processId, 'rule-1', 4));
        await waitFor(() => expect(screen.queryByTestId('sentinel-todo-triggers')).toBeNull());
        expect(mocks.runNow).not.toHaveBeenCalled();
        expect(mocks.create).not.toHaveBeenCalled();
    });
    it('retains input and offers Retry save on transient arm failures', async () => {
        mocks.create.mockRejectedValueOnce(new Error('Server unavailable'));
        mount();
        await openEditor();
        fireEvent.change(screen.getByLabelText('When it fires (optional)'), { target: { value: 'Preserve this instruction' } });
        fireEvent.click(screen.getByRole('button', { name: 'Save and arm' }));
        await screen.findByText('Server unavailable', { exact: false });
        expect((screen.getByLabelText('When it fires (optional)') as HTMLTextAreaElement).value).toBe('Preserve this instruction');
        fireEvent.click(screen.getByRole('button', { name: 'Retry save' }));
        await waitFor(() => expect(mocks.create).toHaveBeenCalledTimes(2));
        expect(mocks.create.mock.calls[1]).toEqual(mocks.create.mock.calls[0]);
        expect(mocks.create.mock.calls[1][2].idempotencyKey).toBeTruthy();
    });
    it('preserves Fired and pending delivery while showing recovery errors in a red retry overlay', async () => {
        mocks.list.mockResolvedValue([rule({ outcome: 'fired', outcomeReason: 'Admission unavailable',
            delivery: { state: 'pending', firedAt: iso, deliveryId: 'delivery-recovery', reason: 'merged' }, nextTickAt: null })]);
        mount();
        await screen.findByText('Fired');
        expect(screen.getByText(/Delivery pending/)).toBeTruthy();
        const overlay = screen.getByText('⚠ Error · delivery retrying');
        expect(overlay.className).toContain('sentinel-trigger-error');
        expect(overlay.title).toContain('Admission unavailable');
        expect(overlay.title).toContain('Last retry');
        expect(overlay.title).toContain('backoff');
        expect(screen.getByText('Admission unavailable').className).toContain('sentinel-trigger-error');
    });
    it('synchronously guards duplicate creates and reuses the same draft key after a lost response', async () => {
        let reject!: (error: Error) => void;
        const pending = new Promise<Trigger>((_resolve, rejectPromise) => { reject = rejectPromise; });
        mocks.create.mockReturnValueOnce(pending);
        mount();
        await openEditor();
        const form = screen.getByRole('button', { name: 'Save and arm' }).closest('form')!;
        act(() => { fireEvent.submit(form); fireEvent.submit(form); });
        expect(mocks.create).toHaveBeenCalledOnce();
        const key = mocks.create.mock.calls[0][2].idempotencyKey;
        expect(key).toBeTruthy();
        await act(async () => reject(new Error('Accepted response lost')));
        fireEvent.click(screen.getByRole('button', { name: 'Retry save' }));
        await waitFor(() => expect(mocks.create).toHaveBeenCalledTimes(2));
        expect(mocks.create.mock.calls[1][2].idempotencyKey).toBe(key);
    });
    it('shows initial API-unavailable errors and visibly retries loading', async () => {
        mocks.list.mockRejectedValueOnce(new Error('Trigger infrastructure unavailable')).mockResolvedValue([rule()]);
        mount();
        await screen.findByText(/Trigger infrastructure unavailable/);
        fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
        await screen.findByText('Waiting');
        expect(screen.queryByText(/Trigger infrastructure unavailable/)).toBeNull();
    });
    it('retries owner-server workspace picker failures inline', async () => {
        mocks.workspaceList.mockRejectedValueOnce(new Error('Workspace list unavailable'));
        mount();
        fireEvent.click(await screen.findByRole('button', { name: '+ Add trigger' }));
        fireEvent.click(screen.getByRole('button', { name: 'Pick a local PR' }));
        await screen.findByText(/Workspace list unavailable/);
        fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
        await screen.findByRole('option', { name: 'Local repo' });
        expect(mocks.workspaceList).toHaveBeenCalledTimes(2);
    });
    it('does not mistake capacity or already-merged 409 validation errors for stale revisions', () => {
        expect(triggerError(Object.assign(new Error('Server-wide active trigger limit reached (50)'), { status: 409 })).conflict).toBe(false);
        expect(triggerError(Object.assign(new Error('PR already merged; use Run now'), { status: 409 })).conflict).toBe(false);
        expect(triggerError(Object.assign(new Error('Rule revision conflict'), { status: 409 })).conflict).toBe(true);
    });
    it('refreshes on owner trigger events only and ignores late owner reads', async () => {
        const old = deferred<Trigger[]>();
        mocks.list.mockReturnValueOnce(old.promise).mockResolvedValue([]);
        const { rerender } = mount();
        await waitFor(() => expect(mocks.connect).toHaveBeenCalledOnce());
        const handler = mocks.connect.mock.calls[0][0].onMessage;
        act(() => handler({ type: 'trigger-fired', workspaceId: 'other', processId: owner.processId }));
        expect(mocks.list).toHaveBeenCalledOnce();
        act(() => handler({ type: 'trigger-fired', workspaceId: owner.ownerWorkspaceId, processId: 'other' }));
        expect(mocks.list).toHaveBeenCalledOnce();
        act(() => handler({ type: 'trigger-fired', workspaceId: owner.ownerWorkspaceId, processId: owner.processId }));
        await waitFor(() => expect(mocks.list).toHaveBeenCalledTimes(2));
        rerender(<SentinelTodoTriggers owner={{ ...owner, processId: 'queue_new' }} items={[item()]} onItemLink={vi.fn()} />);
        await waitFor(() => expect(mocks.list).toHaveBeenCalledWith(owner.ownerWorkspaceId, 'queue_new'));
        await act(async () => old.resolve([rule()]));
        expect(screen.queryByText('Waiting')).toBeNull();
        expect(mocks.connect.mock.results[0].value.close).toHaveBeenCalled();
    });
    it('polls while visible and cleans polling/events on unmount', async () => {
        vi.useFakeTimers();
        const { unmount } = mount();
        await act(async () => {});
        expect(mocks.list).toHaveBeenCalledOnce();
        await act(async () => { vi.advanceTimersByTime(30000); });
        expect(mocks.list).toHaveBeenCalledTimes(2);
        unmount();
        await act(async () => { vi.advanceTimersByTime(60000); });
        expect(mocks.list).toHaveBeenCalledTimes(2);
        expect(mocks.connect.mock.results[0].value.close).toHaveBeenCalled();
    });
    it('drops delayed mutation results when the owner route changes', async () => {
        const delayed = deferred<Trigger>();
        mocks.pause.mockReturnValue(delayed.promise);
        mocks.list.mockResolvedValue([rule()]);
        const { rerender } = mount();
        await actions();
        fireEvent.click(screen.getByRole('button', { name: 'Pause' }));
        mocks.route.mockReturnValue({ kind: 'remote', baseUrl: 'https://replacement.example.test' });
        mocks.list.mockResolvedValue([]);
        rerender(<SentinelTodoTriggers owner={owner} items={[item()]} onItemLink={vi.fn()} />);
        await waitFor(() => expect(mocks.list).toHaveBeenCalledTimes(2));
        await act(async () => delayed.resolve(rule({ status: 'paused' })));
        expect(mocks.list).toHaveBeenCalledTimes(2);
        expect(screen.queryByText('Paused')).toBeNull();
    });
    it('places Triggers below existing cards and item links expand, scroll and highlight', async () => {
        mocks.list.mockResolvedValue([rule()]);
        render(<UnifiedTodoTab owner={owner} />);
        const card = await screen.findByTestId('sentinel-todo-row-item-1');
        const section = await screen.findByTestId('sentinel-todo-triggers');
        expect(card.compareDocumentPosition(section) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
        const scroll = vi.fn();
        card.scrollIntoView = scroll;
        fireEvent.click(screen.getByRole('link', { name: '→ Follow-up work' }));
        await waitFor(() => expect(card.dataset.sentinelTriggerHighlight).toBe('true'));
        expect(scroll).toHaveBeenCalledWith({ behavior: 'smooth', block: 'nearest' });
        expect(screen.getByText('Tests pass')).toBeTruthy();
    });

    it.each([
        ['normal', 'todo', false, []],
        ['normal', 'done', false, ['done']],
        ['normal', 'done', true, ['archived']],
        ['manual', 'todo', false, ['manual']],
        ['manual', 'done', false, ['manual', 'manual-done']],
        ['manual', 'done', true, ['manual', 'manual-archived']],
    ] as const)('split navigation selects only the target and required %s / %s / archived=%s containers', async (type, status, archived, opened) => {
        applyRuntimeConfigPatch({ sentinelTodoSplitLayoutEnabled: true });
        const width = vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(800);
        try {
            mocks.get.mockResolvedValue({ items: [
                item({ type, status, archived }),
                ...(['normal', 'manual'] as const).flatMap(type => [
                    item({ id: `${type}-active`, title: `${type} active`, type }),
                    item({ id: `${type}-done`, title: `${type} done`, type, status: 'done' }),
                    item({ id: `${type}-archived`, title: `${type} archived`, type, archived: true }),
                ]),
            ], revision: 1 });
            mocks.list.mockResolvedValue([rule()]);
            render(<UnifiedTodoTab owner={owner} />);
            const link = await screen.findByRole('link', { name: '→ Follow-up work' });
            fireEvent.click(screen.getByTestId('sentinel-todo-manual-toggle'));
            fireEvent.click(link);
            const target = await screen.findByTestId('sentinel-todo-row-item-1');
            await waitFor(() => expect(target.dataset.sentinelTriggerHighlight).toBe('true'));
            const button = within(target).getByRole('button', { pressed: true });
            expect(document.activeElement).toBe(button);
            expect(screen.getByRole('heading', { name: /Follow-up work/ })).toBeTruthy();
            const requiredSections: readonly string[] = opened;
            for (const section of ['done', 'archived', 'manual', 'manual-done', 'manual-archived']) {
                if (section.startsWith('manual-') && !requiredSections.includes('manual')) continue;
                const toggle = section === 'manual' ? screen.getByTestId('sentinel-todo-manual-toggle')
                    : within(screen.getByTestId(`sentinel-todo-${section}-section`)).getAllByRole('button')[0];
                expect(toggle.getAttribute('aria-expanded')).toBe(String(requiredSections.includes(section)));
            }
            expect(screen.queryByTestId('sentinel-todo-detail-normal-active')).toBeNull();
            expect(mocks.processGet).not.toHaveBeenCalled();
            expect(mocks.runNow).not.toHaveBeenCalled();
        } finally { width.mockRestore(); }
    });

    it.each([
        ['normal', 'todo', false, []],
        ['normal', 'done', false, ['done']],
        ['normal', 'done', true, ['archived']],
        ['manual', 'todo', false, ['manual']],
        ['manual', 'done', false, ['manual', 'manual-done']],
        ['manual', 'done', true, ['manual', 'manual-archived']],
    ] as const)('reveals only the containers for %s / %s / archived=%s, including repeated keyboard activation', async (type, status, archived, opened) => {
        const items = [
            item({ type, status, archived }),
            ...(['normal', 'manual'] as const).flatMap(type => [
                item({ id: `${type}-active`, title: `${type} active`, type }),
                item({ id: `${type}-done`, title: `${type} done`, type, status: 'done' }),
                item({ id: `${type}-archived`, title: `${type} archived`, type, status: 'done', archived: true,
                    ...(type === 'normal' ? { jobs: [{ processId: 'history-job', workspaceId: owner.ownerWorkspaceId, kind: 'local',
                        title: 'Archived history job', linkedAt: iso, openLink: '#repos/ws-owner/chats/history-job', execution: { state: 'completed' } }] } : {}) }),
            ]),
        ];
        mocks.get.mockResolvedValue({ items, revision: 1 });
        mocks.list.mockResolvedValue([rule()]);
        render(<UnifiedTodoTab owner={owner} />);
        const link = await screen.findByRole('link', { name: '→ Follow-up work' });
        const activeRow = screen.getByTestId('sentinel-todo-row-normal-active');
        fireEvent.click(within(activeRow).getByRole('button', { name: /normal active/ }));
        fireEvent.click(screen.getByTestId('sentinel-todo-manual-toggle'));
        const sectionToggle = (section: string) => section === 'manual'
            ? screen.getByTestId('sentinel-todo-manual-toggle')
            : within(screen.getByTestId(`sentinel-todo-${section}-section`)).getAllByRole('button')[0];
        const assertState = () => {
            const requiredSections: readonly string[] = opened;
            for (const section of ['done', 'archived', 'manual', 'manual-done', 'manual-archived']) {
                if (section.startsWith('manual-') && !requiredSections.includes('manual')) continue;
                expect(sectionToggle(section).getAttribute('aria-expanded')).toBe(String(requiredSections.includes(section)));
            }
            expect(within(activeRow).getByRole('button', { name: /normal active/ }).getAttribute('aria-expanded')).toBe('true');
            for (const other of items.filter(candidate => candidate.id !== 'item-1' && candidate.id !== 'normal-active')) {
                const row = screen.queryByTestId(`sentinel-todo-row-${other.id}`);
                if (row) expect(within(row).getByRole('button', { name: new RegExp(other.title) }).getAttribute('aria-expanded')).toBe('false');
            }
        };
        const user = userEvent.setup();
        for (let click = 0; click < 2; click++) {
            link.focus();
            await user.keyboard('{Enter}');
            const target = await screen.findByTestId('sentinel-todo-row-item-1');
            await waitFor(() => expect(target.dataset.sentinelTriggerHighlight).toBe('true'));
            expect(document.activeElement).toBe(within(target).getByRole('button', { name: /Follow-up work/ }));
            expect(within(target).getByRole('button', { name: /Follow-up work/ }).getAttribute('aria-expanded')).toBe('true');
            assertState();
        }
        expect(mocks.get).toHaveBeenCalledTimes(1);
        expect(mocks.processGet).not.toHaveBeenCalled();
        expect(mocks.groupGet).not.toHaveBeenCalled();
        expect(mocks.preview).not.toHaveBeenCalled();
        expect(mocks.runNow).not.toHaveBeenCalled();
    });

    it('preserves independently opened history and manual sections and collapsed rows', async () => {
        mocks.get.mockResolvedValue({ items: [item(), item({ id: 'done', title: 'Done item', status: 'done' }),
            item({ id: 'archived', archived: true }), item({ id: 'manual', type: 'manual', status: 'done' })], revision: 1 });
        mocks.list.mockResolvedValue([rule()]);
        render(<UnifiedTodoTab owner={owner} />);
        const link = await screen.findByRole('link', { name: '→ Follow-up work' });
        const done = within(screen.getByTestId('sentinel-todo-done-section')).getByRole('button');
        const manualDone = within(screen.getByTestId('sentinel-todo-manual-done-section')).getByRole('button');
        fireEvent.click(done);
        fireEvent.click(manualDone);
        fireEvent.click(link);
        await waitFor(() => expect(screen.getByTestId('sentinel-todo-row-item-1').dataset.sentinelTriggerHighlight).toBe('true'));
        expect(done.getAttribute('aria-expanded')).toBe('true');
        expect(manualDone.getAttribute('aria-expanded')).toBe('true');
        expect(within(screen.getByTestId('sentinel-todo-row-done')).getByRole('button', { name: /Done item/ }).getAttribute('aria-expanded')).toBe('false');
        expect(within(screen.getByTestId('sentinel-todo-archived-section')).getByRole('button').getAttribute('aria-expanded')).toBe('false');
    });

    it('keeps missing target feedback and does not reveal another item or load history', async () => {
        mocks.get.mockResolvedValue({ items: [item({ id: 'done', status: 'done' }), item({ id: 'archived', archived: true })], revision: 1 });
        mocks.list.mockResolvedValue([rule()]);
        render(<UnifiedTodoTab owner={owner} />);
        fireEvent.click(await screen.findByRole('link', { name: '→ Item unavailable' }));
        for (const section of ['done', 'archived']) {
            expect(within(screen.getByTestId(`sentinel-todo-${section}-section`)).getByRole('button').getAttribute('aria-expanded')).toBe('false');
        }
        expect(screen.queryByTestId('sentinel-todo-row-item-1')).toBeNull();
        expect(mocks.get).toHaveBeenCalledTimes(1);
    });

    it('rejects foreign rules even when their target id matches this ledger', async () => {
        mocks.list.mockResolvedValue([rule({ workspaceId: 'foreign' }), rule({ id: 'other', processId: 'foreign' })]);
        mount();
        await waitFor(() => expect(mocks.list).toHaveBeenCalledTimes(1));
        expect(screen.queryByRole('link', { name: '→ Follow-up work' })).toBeNull();
    });

    it.each([
        { ...owner, ownerRoutingRef: 'remote:other:ws-owner' },
        { ...owner, ownerWorkspaceId: 'other-workspace' },
        { ...owner, processId: 'queue_other' },
    ])('cancels pending reveal on owner change to $ownerRoutingRef / $ownerWorkspaceId / $processId and ignores late ledger reads', async nextOwner => {
        mocks.list.mockResolvedValue([rule()]);
        const { rerender } = render(<UnifiedTodoTab owner={owner} />);
        const link = await screen.findByRole('link', { name: '→ Follow-up work' });
        const card = screen.getByTestId('sentinel-todo-row-item-1');
        const scroll = vi.fn();
        card.scrollIntoView = scroll;
        const oldRead = deferred<{ items: SentinelTodoItem[]; revision: number }>();
        mocks.get.mockReturnValueOnce(oldRead.promise);
        const handler = mocks.connect.mock.calls[0][0].onMessage;
        act(() => handler({ type: 'sentinel-todos-changed', workspaceId: owner.ownerWorkspaceId, processId: owner.processId, ledgerRevision: 2 }));
        const nextRead = deferred<{ items: SentinelTodoItem[]; revision: number }>();
        mocks.get.mockReturnValue(nextRead.promise);
        mocks.list.mockResolvedValue([]);
        fireEvent.click(link);
        rerender(<UnifiedTodoTab owner={nextOwner} />);
        await act(async () => oldRead.resolve({ items: [item({ title: 'Stale target' })], revision: 2 }));
        await act(async () => nextRead.resolve({ items: [item({ title: 'New owner item' })], revision: 1 }));
        await screen.findByText('New owner item');
        expect(screen.queryByText('Stale target')).toBeNull();
        expect(scroll).not.toHaveBeenCalled();
        expect(screen.getByTestId('sentinel-todo-row-item-1').dataset.sentinelTriggerHighlight).toBeUndefined();
        expect(within(screen.getByTestId('sentinel-todo-row-item-1')).getByRole('button', { name: /New owner item/ }).getAttribute('aria-expanded')).toBe('false');
        expect(screen.getByTestId('sentinel-todo-row-item-1').contains(document.activeElement)).toBe(false);
    });
});
