/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { CocClient, SentinelPrOutcomesResponse, SentinelTodoItem } from '@plusplusoneplusplus/coc-client';

const mocks = vi.hoisted(() => ({
    get: vi.fn(), check: vi.fn(), pause: vi.fn(), resume: vi.fn(), connect: vi.fn(), route: vi.fn(), refs: [] as unknown[],
}));
const client = {
    sentinelTodos: { listPrOutcomes: mocks.get, checkPrOutcomes: mocks.check, pausePrOutcomes: mocks.pause, resumePrOutcomes: mocks.resume },
    events: { connect: mocks.connect },
};
vi.mock('../../../src/server/spa/client/react/repos/cloneRouting', () => ({
    useCocClient: (ref: unknown) => { mocks.refs.push(ref); return client; },
}));
vi.mock('../../../src/server/spa/client/react/repos/cloneRegistry', () => ({ resolveCloneRoute: mocks.route }));

import { SentinelTodoPrOutcomes } from '../../../src/server/spa/client/react/features/repo-detail/unified-right-panel/SentinelTodoPrOutcomes';
import { applyRuntimeConfigPatch } from '../../../src/server/spa/client/react/utils/config';

type Snapshot = SentinelPrOutcomesResponse;
const owner = { ownerWorkspaceId: 'ws-owner', ownerRoutingRef: 'remote:server:ws-owner', processId: 'queue_sentinel' };
const iso = '2026-10-10T00:00:00.000Z';
function item(overrides: Partial<SentinelTodoItem> = {}): SentinelTodoItem {
    return { id: 'item-1', title: 'Follow-up work', completionCondition: 'Tests pass', notes: '', status: 'todo', type: 'normal',
        archived: false, revision: 1, createdAt: iso, updatedAt: iso, createdBy: 'sentinel', updatedBy: 'sentinel',
        priority: 'regular', jobs: [], ...overrides };
}
function snapshot(overrides: Partial<Snapshot> = {}): Snapshot {
    return { revision: 3, paused: false, outcomes: [{
        id: 'watch-1',
        jobId: 'job-1', receiptId: 'receipt-1',
        pr: { provider: 'github', host: 'github.com', repoPath: 'example/repo', number: 7, url: 'https://github.com/example/repo/pull/7' },
        status: 'watching', delivery: 'pending',
    }], ...overrides };
}
function mount(selected = item(), selectedOwner = owner) {
    return render(<SentinelTodoPrOutcomes owner={selectedOwner} item={selected} ledgerRevision={1} />);
}
function deferred<T>() {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>(done => { resolve = done; });
    return { promise, resolve };
}
beforeEach(() => {
    vi.clearAllMocks();
    mocks.refs.length = 0;
    mocks.get.mockReset().mockResolvedValue(snapshot());
    mocks.check.mockReset().mockResolvedValue(snapshot({ revision: 4 }));
    mocks.pause.mockReset().mockResolvedValue(snapshot({ revision: 4, paused: true }));
    mocks.resume.mockReset().mockResolvedValue(snapshot({ revision: 5, paused: false }));
    mocks.connect.mockReset().mockReturnValue({ close: vi.fn() });
    mocks.route.mockReturnValue({ kind: 'remote', baseUrl: 'https://server.example.test' });
    applyRuntimeConfigPatch({ sentinelPrOutcomeWakeEnabled: true });
});
afterEach(() => { cleanup(); applyRuntimeConfigPatch({ sentinelPrOutcomeWakeEnabled: false }); });

describe('compact Sentinel PR outcome evidence', () => {
    it('defaults off, makes no requests and responds to config changes', async () => {
        applyRuntimeConfigPatch({ sentinelPrOutcomeWakeEnabled: false });
        mount();
        expect(screen.queryByRole('button', { name: 'Check outcome' })).toBeNull();
        expect(mocks.get).not.toHaveBeenCalled();
        expect(mocks.connect).not.toHaveBeenCalled();
        act(() => applyRuntimeConfigPatch({ sentinelPrOutcomeWakeEnabled: true }));
        await screen.findByRole('link', { name: 'PR example/repo#7' });
        const signal = mocks.get.mock.calls[0][3].signal;
        act(() => applyRuntimeConfigPatch({ sentinelPrOutcomeWakeEnabled: false }));
        expect(signal.aborted).toBe(true);
        expect(mocks.connect.mock.results[0].value.close).toHaveBeenCalledOnce();
        expect(screen.queryByRole('button', { name: 'Check outcome' })).toBeNull();
    });
    it('does not fall back locally for unresolved remote owners or register Manual watches', () => {
        mocks.route.mockReturnValue({ kind: 'unresolved-remote' });
        const view = mount();
        expect(screen.getByRole('status').textContent).toContain('not connected');
        expect(mocks.get).not.toHaveBeenCalled();
        expect(mocks.connect).not.toHaveBeenCalled();
        mocks.route.mockReturnValue({ kind: 'local' });
        view.rerender(<SentinelTodoPrOutcomes owner={owner} item={item({ type: 'manual' })} ledgerRevision={1} />);
        expect(screen.queryByRole('button', { name: 'Check outcome' })).toBeNull();
        expect(mocks.get).not.toHaveBeenCalled();
    });
    it('uses a supplied owner client for reads and scoped invalidations', async () => {
        const get = vi.fn().mockResolvedValue(snapshot());
        const connect = vi.fn().mockReturnValue({ close: vi.fn() });
        const supplied = { ...client, sentinelTodos: { ...client.sentinelTodos, listPrOutcomes: get }, events: { connect } };
        render(<SentinelTodoPrOutcomes owner={owner} item={item()} ledgerRevision={1} client={supplied as unknown as CocClient} />);
        await screen.findByRole('link');
        expect(mocks.get).not.toHaveBeenCalled();
        expect(mocks.connect).not.toHaveBeenCalled();
        expect(get).toHaveBeenCalledWith(owner.ownerWorkspaceId, owner.processId, 'item-1', expect.any(Object));
        expect(connect).toHaveBeenCalledWith(expect.objectContaining({ workspaceId: owner.ownerWorkspaceId }));
    });
    it('replaces owner transports during a mutation without keeping aborted busy state', async () => {
        const pending = deferred<Snapshot>();
        mocks.pause.mockReturnValueOnce(pending.promise);
        const view = mount();
        await screen.findByRole('link');
        fireEvent.click(screen.getByRole('button', { name: 'Pause notifications' }));
        const signal = mocks.pause.mock.calls[0][4].signal;
        const get = vi.fn().mockResolvedValue(snapshot({ revision: 10 }));
        const replacement = { ...client, sentinelTodos: { ...client.sentinelTodos, listPrOutcomes: get } };
        view.rerender(<SentinelTodoPrOutcomes owner={owner} item={item()} ledgerRevision={1} client={replacement as unknown as CocClient} />);
        await waitFor(() => expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Pause notifications' }).disabled).toBe(false));
        expect(signal.aborted).toBe(true);
        expect(get).toHaveBeenCalledOnce();
        await act(async () => pending.resolve(snapshot({ paused: true, revision: 20 })));
        expect(screen.queryByRole('button', { name: 'Resume notifications' })).toBeNull();
    });
    it('renders each exact PR outcome and independent delivery state including failures', async () => {
        const outcomes = ['merged', 'closed', 'watching'] as const;
        const deliveries = ['none', 'pending', 'delivered', 'skipped', 'error'] as const;
        mocks.get.mockResolvedValue(snapshot({ outcomes: deliveries.map((state, index) => ({
            ...snapshot().outcomes[0], id: `watch-${index}`, pr: { ...snapshot().outcomes[0].pr, number: index + 1,
                url: `https://github.com/example/repo/pull/${index + 1}` },
            status: outcomes[index % outcomes.length], delivery: state,
            ...(state === 'error' ? { error: 'Delivery failed; retry available on server' } : {}),
        })) }));
        mount();
        const evidence = await screen.findByRole('list', { name: 'Exact PR evidence' });
        const rows = within(evidence).getAllByRole('listitem');
        expect(rows).toHaveLength(deliveries.length);
        rows.forEach((row, index) => {
            expect(within(row).getByRole('link').getAttribute('href')).toBe(`https://github.com/example/repo/pull/${index + 1}`);
            expect(row.textContent).toContain(outcomes[index % outcomes.length]);
            expect(row.textContent).toContain(deliveries[index] === 'delivered' ? 'Review queued'
                : deliveries[index] === 'error' ? 'Review failed' : deliveries[index]);
        });
        expect(screen.getByRole('alert').textContent).toContain('Delivery failed');
        expect(screen.queryByRole('button', { name: /run|repair|deploy|new job/i })).toBeNull();
    });
    it('Checks authoritatively without resuming paused notifications, uses latest owner revision', async () => {
        mocks.get.mockResolvedValue(snapshot({ paused: true, revision: 8 }));
        mocks.check.mockResolvedValue(snapshot({ paused: true, revision: 8 }));
        mount();
        await screen.findByRole('button', { name: 'Resume notifications' });
        await waitFor(() => expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Check outcome' }).disabled).toBe(false));
        expect(mocks.refs).toContain(owner.ownerRoutingRef);
        fireEvent.click(screen.getByRole('button', { name: 'Check outcome' }));
        await waitFor(() => expect(mocks.check).toHaveBeenCalledWith(owner.ownerWorkspaceId, owner.processId, 'item-1',
            { expectedRevision: 8 }, expect.objectContaining({ signal: expect.any(AbortSignal) })));
        expect(mocks.pause).not.toHaveBeenCalled();
        expect(mocks.resume).not.toHaveBeenCalled();
        await screen.findByText('Notifications paused');
        expect(screen.getByText('Notification: pending')).toBeTruthy();
    });
    it('pauses/resumes one item with current revisions, serializes duplicate clicks', async () => {
        mocks.get.mockResolvedValueOnce(snapshot()).mockResolvedValueOnce(snapshot({ revision: 4, paused: true }))
            .mockResolvedValue(snapshot({ revision: 5, paused: false }));
        const pending = deferred<Snapshot>();
        mocks.pause.mockReturnValueOnce(pending.promise);
        mount();
        await screen.findByRole('link');
        fireEvent.click(screen.getByRole('button', { name: 'Pause notifications' }));
        fireEvent.click(screen.getByRole('button', { name: 'Pause notifications' }));
        expect(mocks.pause).toHaveBeenCalledOnce();
        expect(mocks.pause).toHaveBeenLastCalledWith(owner.ownerWorkspaceId, owner.processId, 'item-1',
            { expectedRevision: 3 }, expect.objectContaining({ signal: expect.any(AbortSignal) }));
        await act(async () => pending.resolve(snapshot({ revision: 4, paused: true })));
        await waitFor(() => expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Resume notifications' }).disabled).toBe(false));
        fireEvent.click(screen.getByRole('button', { name: 'Resume notifications' }));
        await waitFor(() => expect(mocks.resume).toHaveBeenLastCalledWith(owner.ownerWorkspaceId, owner.processId, 'item-1',
            { expectedRevision: 4 }, expect.objectContaining({ signal: expect.any(AbortSignal) })));
        await screen.findByRole('button', { name: 'Pause notifications' });
    });
    it('preserves evidence and mutation failures during event refresh, reloads conflicts without retrying', async () => {
        mocks.pause.mockRejectedValue({ status: 409, message: 'Revision conflict' });
        mount();
        await screen.findByRole('link');
        mocks.get.mockResolvedValue(snapshot({ revision: 12 }));
        fireEvent.click(screen.getByRole('button', { name: 'Pause notifications' }));
        await screen.findByRole('alert');
        const { onMessage } = mocks.connect.mock.calls[0][0];
        act(() => onMessage({ type: 'sentinel-todos-changed', workspaceId: owner.ownerWorkspaceId, processId: owner.processId }));
        await waitFor(() => expect(mocks.get).toHaveBeenCalledTimes(3));
        expect(screen.getByRole('alert')).toBeTruthy();
        expect(screen.getByRole('link')).toBeTruthy();
        expect(mocks.pause).toHaveBeenCalledOnce();
        await waitFor(() => expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Pause notifications' }).disabled).toBe(false));
        fireEvent.click(screen.getByRole('button', { name: 'Pause notifications' }));
        await waitFor(() => expect(mocks.pause.mock.calls[1][3].expectedRevision).toBe(12));
    });
    it('retains old evidence when refresh fails and offers an explicit read retry', async () => {
        mount();
        await screen.findByRole('link');
        mocks.get.mockRejectedValueOnce(new Error('Provider offline'));
        const { onMessage } = mocks.connect.mock.calls[0][0];
        act(() => onMessage({ type: 'trigger-updated', workspaceId: owner.ownerWorkspaceId, processId: owner.processId }));
        await screen.findByRole('alert');
        expect(screen.getByRole('link')).toBeTruthy();
        expect(screen.getByText(/Provider offline/)).toBeTruthy();
        fireEvent.click(screen.getByRole('button', { name: 'Refresh PR evidence' }));
        await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
    });
    it('shows initial read failures without offering unchecked mutations', async () => {
        mocks.get.mockRejectedValueOnce(new Error('Native monitoring unavailable'));
        mount();
        await screen.findByRole('alert');
        expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Check outcome' }).disabled).toBe(true);
        expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Pause notifications' }).disabled).toBe(true);
        fireEvent.click(screen.getByRole('button', { name: 'Refresh PR evidence' }));
        await screen.findByRole('link');
        expect(screen.queryByRole('alert')).toBeNull();
        expect(mocks.check).not.toHaveBeenCalled();
        expect(mocks.pause).not.toHaveBeenCalled();
    });
    it('does not overwrite newer outcome revisions with a stale authoritative read', async () => {
        mount();
        await screen.findByRole('link');
        mocks.get.mockResolvedValueOnce(snapshot({ paused: true, revision: 1 }));
        const { onMessage } = mocks.connect.mock.calls[0][0];
        act(() => onMessage({ type: 'sentinel-todos-changed', workspaceId: owner.ownerWorkspaceId, processId: owner.processId }));
        await screen.findByRole('alert');
        expect(screen.getByRole('button', { name: 'Pause notifications' })).toBeTruthy();
        expect(screen.queryByRole('button', { name: 'Resume notifications' })).toBeNull();
    });
    it('uses only exact owner events and aborts/discards superseded reads', async () => {
        mount();
        await screen.findByRole('link');
        const { onMessage } = mocks.connect.mock.calls[0][0];
        act(() => {
            onMessage({ type: 'trigger-updated', workspaceId: 'other', processId: owner.processId });
            onMessage({ type: 'trigger-updated', workspaceId: owner.ownerWorkspaceId, processId: 'other' });
            onMessage({ type: 'trigger-updated' });
        });
        expect(mocks.get).toHaveBeenCalledOnce();
        const old = deferred<Snapshot>();
        mocks.get.mockReturnValueOnce(old.promise).mockResolvedValueOnce(snapshot({ paused: true, revision: 20 }));
        act(() => onMessage({ type: 'trigger-updated', workspaceId: owner.ownerWorkspaceId, processId: owner.processId }));
        const signal = mocks.get.mock.calls[1][3].signal;
        act(() => onMessage({ type: 'sentinel-todos-changed', workspaceId: owner.ownerWorkspaceId, processId: owner.processId }));
        await screen.findByRole('button', { name: 'Resume notifications' });
        expect(signal.aborted).toBe(true);
        await act(async () => old.resolve(snapshot({ paused: false, revision: 2 })));
        expect(screen.getByRole('button', { name: 'Resume notifications' })).toBeTruthy();
    });
    it.each(['item', 'owner', 'unmount'] as const)('cancels and discards late mutations after %s changes', async change => {
        const pending = deferred<Snapshot>();
        mocks.pause.mockReturnValueOnce(pending.promise);
        const view = mount();
        await screen.findByRole('link');
        fireEvent.click(screen.getByRole('button', { name: 'Pause notifications' }));
        const signal = mocks.pause.mock.calls[0][4].signal;
        if (change === 'unmount') view.unmount();
        else view.rerender(<SentinelTodoPrOutcomes owner={change === 'owner' ? { ...owner, processId: 'new-process' } : owner}
            item={item(change === 'item' ? { id: 'new-item' } : {})} ledgerRevision={2} />);
        expect(signal.aborted).toBe(true);
        await act(async () => pending.resolve(snapshot({ paused: true, revision: 99 })));
        if (change !== 'unmount') {
            await screen.findByRole('button', { name: 'Pause notifications' });
            expect(screen.queryByRole('button', { name: 'Resume notifications' })).toBeNull();
        }
    });
    it('discards late initial reads when selecting a new item', async () => {
        const pending = deferred<Snapshot>();
        mocks.get.mockReturnValueOnce(pending.promise);
        const view = mount();
        const signal = mocks.get.mock.calls[0][3].signal;
        view.rerender(<SentinelTodoPrOutcomes owner={owner} item={item({ id: 'new-item' })} ledgerRevision={1} />);
        await screen.findByRole('link');
        expect(signal.aborted).toBe(true);
        await act(async () => pending.resolve(snapshot({ paused: true, revision: 99 })));
        expect(screen.queryByRole('button', { name: 'Resume notifications' })).toBeNull();
    });
    it.each([{ status: 'done' as const }, { archived: true }])('retains evidence for completed/archived items (%j)', async overrides => {
        mount(item(overrides));
        await screen.findByRole('link');
        expect(mocks.get).toHaveBeenCalledWith(owner.ownerWorkspaceId, owner.processId, 'item-1', expect.any(Object));
    });
});
