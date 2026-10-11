/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { SentinelScrubberResponse, SentinelScrubRun, SentinelScrubFindingRecord, SentinelScrubRunDetail, SentinelTodoItem } from '@plusplusoneplusplus/coc-client';

const mock = vi.hoisted(() => ({ getRun: vi.fn(), accept: vi.fn(), dismiss: vi.fn(), undo: vi.fn(), get: vi.fn(), start: vi.fn(), cancel: vi.fn(), updateConfig: vi.fn(), connect: vi.fn(), route: { kind: 'local' } as { kind: string; baseUrl?: string }, refs: [] as unknown[] }));
vi.mock('../../../src/server/spa/client/react/repos/cloneRouting', () => ({ useCocClient: (ref: unknown) => { mock.refs.push(ref); return client; } }));
vi.mock('../../../src/server/spa/client/react/repos/cloneRegistry', () => ({ resolveCloneRoute: () => mock.route }));
const client = { sentinelTodos: { scrubber: mock }, events: { connect: mock.connect } };
import { SentinelTodoScrubber } from '../../../src/server/spa/client/react/features/repo-detail/unified-right-panel/SentinelTodoScrubber';
import { AcceptAllScrubProposals, SentinelTodoScrubFinding } from '../../../src/server/spa/client/react/features/repo-detail/unified-right-panel/SentinelTodoScrubFinding';
import { applyRuntimeConfigPatch } from '../../../src/server/spa/client/react/utils/config';

const owner = { ownerWorkspaceId: 'ws-a', processId: 'queue_parent' };
const follow = vi.fn();
function response(patch: Partial<SentinelScrubberResponse> = {}): SentinelScrubberResponse {
    return { config: { enabled: false, cron: '0 9 * * *', paused: false, consecutiveFailures: 0, revision: 4 }, runs: [], ...patch };
}
function item(id: string, patch: Partial<SentinelTodoItem> = {}): SentinelTodoItem {
    return { id, title: `Item ${id}`, status: 'todo', archived: false, revision: 1, type: 'normal', priority: 'regular', completionCondition: '', notes: '', jobs: [],
        createdBy: 'user', updatedBy: 'user', createdAt: '2026-10-11T00:00:00Z', updatedAt: '2026-10-11T00:00:00Z', ...patch };
}
function active(status: 'queued' | 'running' = 'running'): SentinelScrubRun {
    return { id: 'run-1', status, trigger: 'manual', createdAt: new Date().toISOString(), childProcessId: 'queue_child', snapshot: [{ itemId: 'a', revision: 1 }], deferredItemIds: [], awaitingReviewItemIds: [] };
}
function deferred<T>() {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>(r => { resolve = r; });
    return { promise, resolve };
}
beforeEach(() => {
    vi.clearAllMocks();
    mock.get.mockReset().mockResolvedValue(response());
    mock.getRun.mockReset().mockResolvedValue({ findings: [] });
    for (const action of [mock.accept, mock.dismiss, mock.undo]) action.mockReset().mockResolvedValue({});
    mock.start.mockReset().mockResolvedValue({ runId: 'run-1' });
    mock.cancel.mockReset().mockResolvedValue(active());
    mock.updateConfig.mockReset().mockResolvedValue(response().config);
    mock.connect.mockReturnValue({ close: vi.fn() });
    mock.route = { kind: 'local' };
    mock.refs.length = 0;
    applyRuntimeConfigPatch({ sentinelTodoLedgerEnabled: true, sentinelTodoScrubberEnabled: true });
});
afterEach(() => { cleanup(); applyRuntimeConfigPatch({ sentinelTodoScrubberEnabled: false }); });

describe('To-do Scrubber strip', () => {
    it.each(['sentinelTodoLedgerEnabled', 'sentinelTodoScrubberEnabled'])('requires live %s and stops subscriptions when disabled', async flag => {
        applyRuntimeConfigPatch({ [flag]: false });
        render(<SentinelTodoScrubber owner={owner} items={[]} onFollowLink={follow} />);
        expect(screen.queryByRole('region', { name: 'To-do Scrubber' })).toBeNull();
        expect(mock.get).not.toHaveBeenCalled();
        act(() => applyRuntimeConfigPatch({ [flag]: true }));
        await screen.findByText('Manual only');
        const connection = mock.connect.mock.results[0].value;
        act(() => applyRuntimeConfigPatch({ [flag]: false }));
        expect(connection.close).toHaveBeenCalledOnce();
    });

    it('starts all-open once and disables admission while a run is active', async () => {
        const request = deferred<{ runId: string }>();
        mock.start.mockReturnValue(request.promise);
        render(<SentinelTodoScrubber owner={owner} items={[item('a')]} onFollowLink={follow} />);
        await screen.findByText('Manual only');
        fireEvent.click(screen.getByRole('button', { name: 'Scrub now' }));
        fireEvent.click(screen.getByRole('button', { name: 'Scrub now' }));
        expect(mock.start).toHaveBeenCalledExactlyOnceWith('ws-a', 'queue_parent', {});
        mock.get.mockResolvedValue(response({ activeRun: active() }));
        await act(async () => request.resolve({ runId: 'run-1' }));
        await screen.findByText(/Scrubbing 1 items/);
        expect(screen.getByRole('button', { name: 'Scrub now' })).toBeDisabled();
        fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
        await waitFor(() => expect(mock.cancel).toHaveBeenCalledWith('ws-a', 'queue_parent', 'run-1'));
        const link = screen.getByRole('link', { name: 'Open chat' });
        expect(link).toHaveAttribute('href', '#repos/ws-a/chats/queue_child');
        fireEvent.click(link);
        expect(follow).toHaveBeenCalledWith(expect.anything(), 'scrubber:queue_child');
    });

    it('selects only open normal/manual items and drops items closed since selection', async () => {
        const props = { owner, onFollowLink: follow };
        const view = render(<SentinelTodoScrubber {...props} items={[item('a'), item('m', { type: 'manual' }), item('d', { status: 'done' }), item('x', { archived: true })]} />);
        await screen.findByText('Manual only');
        fireEvent.click(screen.getByRole('button', { name: 'Select items' }));
        expect(screen.queryByLabelText('Item d')).toBeNull();
        expect(screen.queryByLabelText('Item x')).toBeNull();
        fireEvent.click(screen.getByLabelText('Item a'));
        fireEvent.click(screen.getByLabelText('Item m · Manual'));
        view.rerender(<SentinelTodoScrubber {...props} items={[item('a', { status: 'done' }), item('m', { type: 'manual' })]} />);
        fireEvent.click(screen.getByRole('button', { name: 'Scrub selected (1)' }));
        await waitFor(() => expect(mock.start).toHaveBeenCalledWith('ws-a', 'queue_parent', { itemIds: ['m'] }));
    });

    it('shows queued state, uses owner server events, and ignores other owners', async () => {
        mock.get.mockResolvedValue(response({ activeRun: active('queued') }));
        render(<SentinelTodoScrubber owner={{ ...owner, ownerRoutingRef: 'remote:srv:group-a' }} items={[]} onFollowLink={follow} />);
        await screen.findByText(/Queued/);
        expect(mock.refs).toContain('remote:srv:group-a');
        expect(screen.getByRole('link', { name: 'Open chat' })).toHaveAttribute('href', '#repos/remote%3Asrv%3Agroup-a/chats/queue_child');
        const options = mock.connect.mock.calls[0][0];
        expect(options.workspaceId).toBe('ws-a');
        act(() => {
            options.onMessage({ type: 'sentinel-scrubber-changed', workspaceId: 'ws-b', processId: owner.processId });
            options.onMessage({ type: 'sentinel-scrubber-changed', workspaceId: 'ws-a', processId: 'other' });
            options.onMessage({ type: 'sentinel-todos-changed', workspaceId: 'ws-a', processId: owner.processId });
        });
        expect(mock.get).toHaveBeenCalledTimes(1);
        await act(async () => options.onMessage({ type: 'sentinel-scrubber-changed', workspaceId: 'ws-a', processId: owner.processId }));
        expect(mock.get).toHaveBeenCalledTimes(2);
    });

    it('renders failure retry, summary counts and review/deferred exclusions', async () => {
        mock.get.mockResolvedValue(response({ runs: [{ id: 'r', status: 'timed_out', trigger: 'manual', createdAt: new Date().toISOString(), error: 'Budget exceeded', itemCount: 1,
            deferredCount: 2, awaitingReviewCount: 1, counts: { done: 2, proposals: 1, unverified: 1 } }] }));
        render(<SentinelTodoScrubber owner={owner} items={[]} onFollowLink={follow} />);
        await screen.findByText(/Last run failed: Budget exceeded/);
        expect(screen.getByText('2 deferred to next run')).toBeInTheDocument();
        expect(screen.getByText('1 awaiting Sentinel review')).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
        await waitFor(() => expect(mock.start).toHaveBeenCalledWith('ws-a', 'queue_parent', {}));
    });

    it('shows completed finding counts and links to its child chat', async () => {
        mock.get.mockResolvedValue(response({ runs: [{ id: 'r', status: 'completed', trigger: 'schedule', createdAt: new Date().toISOString(), childProcessId: 'queue_done', itemCount: 4,
            deferredCount: 0, awaitingReviewCount: 0, counts: { done: 2, proposals: 1, unverified: 1 } }] }));
        render(<SentinelTodoScrubber owner={owner} items={[]} onFollowLink={follow} />);
        await screen.findByText(/2 done · 1 proposal · 1 unverified/);
        expect(screen.getByRole('link', { name: 'Open chat' })).toHaveAttribute('href', '#repos/ws-a/chats/queue_done');
    });

    it('opens and closes bounded history outside the pinned strip without extra reads until details are selected', async () => {
        setupFindings();
        render(<SentinelTodoScrubber owner={owner} items={[item('a')]} onFollowLink={follow} />);
        const toggle = await screen.findByRole('button', { name: 'History (1)' });
        await waitFor(() => expect(mock.getRun).toHaveBeenCalledOnce());
        fireEvent.click(toggle);
        const history = screen.getByRole('region', { name: 'Scrubber run history' });
        expect(screen.getByTestId('sentinel-scrubber-strip').contains(history)).toBe(false);
        expect(mock.getRun).toHaveBeenCalledOnce();
        fireEvent.click(screen.getByRole('button', { name: 'Hide history (1)' }));
        expect(screen.queryByRole('region', { name: 'Scrubber run history' })).toBeNull();
    });

    it('shows schedule description/next time and resumes a failure pause with expected revision', async () => {
        const config = { ...response().config, enabled: true, paused: true, consecutiveFailures: 3, nextRunAt: '2026-10-12T09:00:00Z' };
        mock.get.mockResolvedValue(response({ config }));
        render(<SentinelTodoScrubber owner={owner} items={[]} onFollowLink={follow} />);
        await screen.findByText(/Schedule paused after 3 failures/);
        expect(screen.getByText('Every day at 09:00')).toBeInTheDocument();
        expect(screen.queryByTitle(new Date(config.nextRunAt).toLocaleString())).toBeNull();
        mock.get.mockResolvedValue(response({ config: { ...config, paused: false, consecutiveFailures: 0 } }));
        fireEvent.click(screen.getByRole('button', { name: 'Resume' }));
        await waitFor(() => expect(mock.updateConfig).toHaveBeenCalledWith('ws-a', 'queue_parent', { enabled: true, cron: config.cron, expectedRevision: 4 }));
        await waitFor(() => expect(screen.getByTitle(new Date(config.nextRunAt).toLocaleString())).toBeInTheDocument());
    });

    it('validates cron live, offers presets and saves an owner-bound revision snapshot', async () => {
        render(<SentinelTodoScrubber owner={owner} items={[]} onFollowLink={follow} />);
        await screen.findByText('Manual only');
        fireEvent.click(screen.getByRole('button', { name: 'Schedule ▾' }));
        fireEvent.click(screen.getByLabelText('Enable schedule'));
        const cron = screen.getByLabelText('Custom cron (5 fields; at least 1h apart)');
        fireEvent.change(cron, { target: { value: '*/30 * * * *' } });
        expect(screen.getByRole('button', { name: 'Save schedule' })).toBeDisabled();
        expect(screen.getByRole('alert')).toHaveTextContent('at most once an hour');
        fireEvent.change(cron, { target: { value: '*/0 * * * *' } });
        expect(screen.getByRole('alert')).toHaveTextContent('step must be positive');
        fireEvent.change(screen.getByLabelText('Preset'), { target: { value: '0 */6 * * *' } });
        expect(screen.getByRole('status')).toHaveTextContent('Every 6 hours');
        fireEvent.click(screen.getByRole('button', { name: 'Save schedule' }));
        await waitFor(() => expect(mock.updateConfig).toHaveBeenCalledWith('ws-a', 'queue_parent', { enabled: true, cron: '0 */6 * * *', expectedRevision: 4 }));
        expect(screen.queryByRole('form', { name: 'Scrubber schedule' })).toBeNull();
    });

    it('retains the schedule draft revision through remote invalidation and reloads conflicts without retrying writes', async () => {
        render(<SentinelTodoScrubber owner={owner} items={[]} onFollowLink={follow} />);
        await screen.findByText('Manual only');
        fireEvent.click(screen.getByRole('button', { name: 'Schedule ▾' }));
        mock.get.mockResolvedValue(response({ config: { ...response().config, revision: 5 } }));
        await act(async () => mock.connect.mock.calls[0][0].onMessage({ type: 'sentinel-scrubber-changed', workspaceId: 'ws-a', processId: owner.processId }));
        mock.updateConfig.mockRejectedValue(Object.assign(new Error('stale'), { status: 409 }));
        fireEvent.click(screen.getByRole('button', { name: 'Save schedule' }));
        await screen.findByText('Scrubber changed. Refresh and try again.');
        expect(mock.updateConfig).toHaveBeenCalledExactlyOnceWith('ws-a', 'queue_parent', { enabled: false, cron: '0 9 * * *', expectedRevision: 4 });
        expect(screen.queryByRole('form', { name: 'Scrubber schedule' })).toBeNull();
    });

    it('keeps failed drafts for an explicit retry and refreshes read failures', async () => {
        mock.get.mockRejectedValueOnce(new Error('offline'));
        render(<SentinelTodoScrubber owner={owner} items={[]} onFollowLink={follow} />);
        await screen.findByText('offline');
        expect(screen.getByRole('button', { name: 'Scrub now' })).toBeDisabled();
        fireEvent.click(screen.getByRole('button', { name: 'Refresh scrubber' }));
        await screen.findByText('Manual only');
        fireEvent.click(screen.getByRole('button', { name: 'Schedule ▾' }));
        mock.updateConfig.mockRejectedValueOnce(new Error('Save failed'));
        fireEvent.click(screen.getByRole('button', { name: 'Save schedule' }));
        await screen.findByText('Save failed');
        expect(screen.getByLabelText('Custom cron (5 fields; at least 1h apart)')).toHaveValue('0 9 * * *');
        expect(mock.updateConfig).toHaveBeenCalledTimes(1);
    });

    it('discards delayed reads and writes after owner/endpoint changes', async () => {
        const oldRead = deferred<SentinelScrubberResponse>();
        mock.get.mockReturnValueOnce(oldRead.promise);
        const view = render(<SentinelTodoScrubber owner={owner} items={[]} onFollowLink={follow} />);
        view.rerender(<SentinelTodoScrubber owner={{ ...owner, processId: 'other' }} items={[]} onFollowLink={follow} />);
        await screen.findByText('Manual only');
        await act(async () => oldRead.resolve(response({ activeRun: active() })));
        expect(screen.queryByText(/Scrubbing/)).toBeNull();
        const oldWrite = deferred<{ runId: string }>();
        mock.start.mockReturnValueOnce(oldWrite.promise);
        fireEvent.click(screen.getByRole('button', { name: 'Scrub now' }));
        mock.route = { kind: 'remote', baseUrl: 'https://new.example' };
        view.rerender(<SentinelTodoScrubber owner={{ ...owner, processId: 'other' }} items={[]} onFollowLink={follow} />);
        await screen.findByText('Manual only');
        const reads = mock.get.mock.calls.length;
        await act(async () => oldWrite.resolve({ runId: 'stale' }));
        expect(mock.get).toHaveBeenCalledTimes(reads);
        expect(mock.connect.mock.results[0].value.close).toHaveBeenCalled();
    });

    it('never contacts a local server for an unresolved remote owner', () => {
        mock.route = { kind: 'unresolved-remote' };
        render(<SentinelTodoScrubber owner={{ ...owner, ownerRoutingRef: 'remote:srv:ws-a' }} items={[]} onFollowLink={follow} />);
        expect(screen.getByRole('status')).toHaveTextContent('owning server is not connected');
        expect(mock.get).not.toHaveBeenCalled();
        expect(mock.connect).not.toHaveBeenCalled();
    });
});

function finding(state: SentinelScrubFindingRecord['state'] = 'proposed', patch: Partial<SentinelScrubFindingRecord> = {}): SentinelScrubFindingRecord {
    return { runId: 'result', itemId: 'a', state, itemRevision: 1, fingerprint: 'evidence', audit: [],
        finding: { itemId: 'a', verdict: 'done', confidence: 'high', autoApply: false, summary: 'Work landed', rationale: 'Completion condition met',
            evidence: [{ kind: 'pr', ref: 'https://example.com/pr/915', state: 'merged', checkedAt: '2026-10-11T01:00:00Z' }] }, ...patch };
}
function results(records: SentinelScrubFindingRecord[], runId = 'result') {
    const run = { ...active(), id: runId, status: 'completed' as const };
    return { summary: { ...run, itemCount: records.length, deferredCount: 0, awaitingReviewCount: 0, counts: { done: 0, proposals: 1, unverified: 0 } },
        detail: { ...run, findings: records } };
}
function setupFindings(record = finding()) {
    const result = results([record]);
    mock.get.mockResolvedValue(response({ runs: [result.summary] }));
    mock.getRun.mockResolvedValue(result.detail);
}
function rows(current = item('a'), onLedgerChange = vi.fn().mockResolvedValue(undefined), own = owner) {
    return <SentinelTodoScrubber owner={own} items={[current]} onFollowLink={follow} onLedgerChange={onLedgerChange}>
        <SentinelTodoScrubFinding item={current} />
    </SentinelTodoScrubber>;
}

describe('Scrubber row findings', () => {
    it('shows proposal evidence and accepts the snapshot revision on its owning server, then refreshes ledger', async () => {
        setupFindings(finding('proposed', { demotedBecause: 'manual' }));
        const refresh = vi.fn().mockResolvedValue(undefined);
        const own = { ...owner, ownerWorkspaceId: 'group', ownerRoutingRef: 'remote:srv:group' };
        mock.route = { kind: 'remote', baseUrl: 'https://remote.example' };
        render(rows(item('a', { type: 'manual' }), refresh, own));
        await screen.findByText('◇ Proposal: Done (high)');
        expect(mock.getRun).toHaveBeenCalledWith('group', 'queue_parent', 'result');
        expect(mock.refs).toContain('remote:srv:group');
        expect(screen.getByText('Manual item: proposal only')).toBeInTheDocument();
        fireEvent.click(screen.getByText('Evidence'));
        expect(screen.getByText('Confidence: high · Completion condition met')).toBeInTheDocument();
        expect(screen.getByRole('link', { name: 'https://example.com/pr/915' })).toHaveAttribute('rel', 'noopener noreferrer');
        expect(screen.getByText(/merged · checked/)).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: 'Accept' }));
        await waitFor(() => expect(refresh).toHaveBeenCalledOnce());
        expect(mock.accept).toHaveBeenCalledExactlyOnceWith('group', 'queue_parent', 'result', 'a', { expectedItemRevision: 1 });
    });

    describe('Accept all scrubber proposals', () => {
        function batch(records: SentinelScrubFindingRecord[], current = records.map(record => item(record.itemId))) {
            const result = results(records);
            mock.get.mockResolvedValue(response({ runs: [result.summary] }));
            mock.getRun.mockResolvedValue(result.detail);
            return current;
        }
        function panel(current: SentinelTodoItem[], refresh = vi.fn().mockResolvedValue(undefined), own = owner) {
            return <SentinelTodoScrubber owner={own} items={current} onFollowLink={follow} onLedgerChange={refresh}
                toolbar={<div role="toolbar" aria-label="To-do actions"><AcceptAllScrubProposals /></div>}>
                {current.map(value => <SentinelTodoScrubFinding key={value.id} item={value} />)}
            </SentinelTodoScrubber>;
        }
        const proposal = (id: string, revision = 1) => finding('proposed', { itemId: id, itemRevision: revision,
            finding: { ...finding().finding, itemId: id } });

        it('offers both entry points with one busy guard and accepts only latest owner proposals at snapshot revisions', async () => {
            const records = [proposal('a', 4), proposal('m', 7), finding('dismissed', { itemId: 'd' }),
                finding('unverified', { itemId: 'u' }), proposal('removed')];
            const current = batch(records, [item('a', { revision: 4 }), item('m', { revision: 7, type: 'manual' }), item('d'), item('u')]);
            const pending = deferred<unknown>();
            mock.accept.mockReturnValueOnce(pending.promise);
            const refresh = vi.fn().mockResolvedValue(undefined);
            mock.route = { kind: 'remote', baseUrl: 'https://remote.example' };
            render(panel(current, refresh, { ...owner, ownerWorkspaceId: 'group', ownerRoutingRef: 'remote:srv:group' }));
            const buttons = await screen.findAllByRole('button', { name: 'Accept all proposals' });
            expect(buttons).toHaveLength(2);
            fireEvent.click(buttons[1]);
            fireEvent.click(buttons[0]);
            fireEvent.click(screen.getAllByRole('button', { name: 'Accept' })[0]);
            expect(buttons.every(button => button.hasAttribute('disabled'))).toBe(true);
            expect(mock.accept).toHaveBeenCalledExactlyOnceWith('group', 'queue_parent', 'result', 'a', { expectedItemRevision: 4 });
            mock.getRun.mockResolvedValue(results(records.map(record => record.state === 'proposed' ? { ...record, state: 'accepted' } : record)).detail);
            await act(async () => pending.resolve({}));
            await screen.findByText('Accepted 2 proposals.');
            expect(mock.accept.mock.calls).toEqual([
                ['group', 'queue_parent', 'result', 'a', { expectedItemRevision: 4 }],
                ['group', 'queue_parent', 'result', 'm', { expectedItemRevision: 7 }],
            ]);
            expect(refresh).toHaveBeenCalledOnce();
            await waitFor(() => expect(screen.queryByRole('button', { name: 'Accept all proposals' })).toBeNull());
        });

        it('skips known stale proposals, reports raced conflicts and continues without revision retries', async () => {
            const current = batch([proposal('known'), proposal('race', 3), proposal('ok', 5)],
                [item('known', { revision: 2 }), item('race', { revision: 3 }), item('ok', { revision: 5 })]);
            mock.accept.mockRejectedValueOnce(Object.assign(new Error('stale'), { status: 409 }));
            render(panel(current));
            const buttons = await screen.findAllByRole('button', { name: 'Accept all proposals' });
            fireEvent.click(buttons[0]);
            await screen.findByText('Accepted 1 proposal. 2 items changed since this proposal. Run a fresh scrub.');
            expect(mock.accept.mock.calls).toEqual([
                ['ws-a', 'queue_parent', 'result', 'race', { expectedItemRevision: 3 }],
                ['ws-a', 'queue_parent', 'result', 'ok', { expectedItemRevision: 5 }],
            ]);
            expect(screen.getAllByText('Item changed since this proposal. Run a fresh scrub.')).toHaveLength(1);
        });

        it('reports a fully stale batch without submitting any writes', async () => {
            const current = batch([proposal('a')], [item('a', { revision: 2 })]);
            render(panel(current));
            fireEvent.click((await screen.findAllByRole('button', { name: 'Accept all proposals' }))[0]);
            await screen.findByText('Accepted 0 proposals. 1 item changed since this proposal. Run a fresh scrub.');
            expect(mock.accept).not.toHaveBeenCalled();
        });

        it('stops on a non-conflict failure and refreshes successes without silently claiming the rest were accepted', async () => {
            const current = batch([proposal('a'), proposal('b'), proposal('c')]);
            mock.accept.mockResolvedValueOnce({}).mockRejectedValueOnce(new Error('Server offline'));
            const refresh = vi.fn().mockResolvedValue(undefined);
            render(panel(current, refresh));
            fireEvent.click((await screen.findAllByRole('button', { name: 'Accept all proposals' }))[0]);
            await screen.findByText('Accepted 1 proposal. 1 acceptance failed; 1 not attempted.');
            expect(screen.getByRole('alert')).toHaveTextContent('Server offline');
            expect(mock.accept).toHaveBeenCalledTimes(2);
            await waitFor(() => expect(refresh).toHaveBeenCalledOnce());
        });

        it('surfaces refresh errors without losing the accepted count', async () => {
            const current = batch([proposal('a')]);
            const refresh = vi.fn().mockRejectedValue(new Error('Ledger refresh failed'));
            render(panel(current, refresh));
            fireEvent.click((await screen.findAllByRole('button', { name: 'Accept all proposals' }))[0]);
            await screen.findByText('Ledger refresh failed');
            expect(screen.getByText('Accepted 1 proposal.')).toBeInTheDocument();
            expect(mock.accept).toHaveBeenCalledOnce();
        });

        it.each(['owner', 'endpoint', 'flag'] as const)('stops the remaining batch when %s changes during a write', async change => {
            const current = batch([proposal('a'), proposal('b')]);
            const pending = deferred<unknown>();
            mock.accept.mockReturnValueOnce(pending.promise);
            const refresh = vi.fn().mockResolvedValue(undefined);
            const view = render(panel(current, refresh));
            fireEvent.click((await screen.findAllByRole('button', { name: 'Accept all proposals' }))[0]);
            if (change === 'owner') view.rerender(panel(current, refresh, { ...owner, processId: 'other' }));
            if (change === 'endpoint') {
                mock.route = { kind: 'remote', baseUrl: 'https://other.example' };
                view.rerender(panel(current, refresh));
            }
            if (change === 'flag') act(() => applyRuntimeConfigPatch({ sentinelTodoScrubberEnabled: false }));
            await act(async () => pending.resolve({}));
            expect(mock.accept).toHaveBeenCalledOnce();
            expect(refresh).not.toHaveBeenCalled();
            expect(screen.queryByText('Accepted 1 proposal.')).toBeNull();
        });

        it('uses newest hidden findings to exclude older proposals from bulk acceptance', async () => {
            const newest = results([finding('suppressed')], 'new');
            const older = results([proposal('a')], 'old');
            mock.get.mockResolvedValue(response({ runs: [newest.summary, older.summary] }));
            mock.getRun.mockImplementation((_ws, _pid, runId) => Promise.resolve(runId === 'new' ? newest.detail : older.detail));
            render(panel([item('a')]));
            await waitFor(() => expect(mock.getRun).toHaveBeenCalledTimes(2));
            expect(screen.queryByRole('button', { name: 'Accept all proposals' })).toBeNull();
        });
    });

    it('dismisses without duplicate admission and hides the sticky result after refresh', async () => {
        setupFindings();
        const pending = deferred<unknown>();
        mock.dismiss.mockReturnValue(pending.promise);
        render(rows());
        await screen.findByText('◇ Proposal: Done (high)');
        fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
        fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
        mock.getRun.mockResolvedValue(results([finding('dismissed')]).detail);
        await act(async () => pending.resolve({}));
        await waitFor(() => expect(screen.queryByText(/Proposal: Done/)).toBeNull());
        expect(mock.dismiss).toHaveBeenCalledExactlyOnceWith('ws-a', 'queue_parent', 'result', 'a', { expectedItemRevision: 1 });
    });

    it('uses the applied revision for Undo and hides attribution after newer user edits', async () => {
        setupFindings(finding('applied', { audit: [{ action: 'applied', actor: 'scrubber', at: '2026-10-11T01:00:00Z',
            before: { status: 'in_progress', archived: false, revision: 1 }, after: { status: 'done', archived: false, revision: 2 } }] }));
        const view = render(rows(item('a', { revision: 2, status: 'done' })));
        await screen.findByText('✓ Done by scrubber');
        fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
        await waitFor(() => expect(mock.undo).toHaveBeenCalledExactlyOnceWith('ws-a', 'queue_parent', 'result', 'a', { expectedItemRevision: 2 }));
        view.rerender(rows(item('a', { revision: 3, status: 'in_progress' })));
        expect(screen.queryByText('✓ Done by scrubber')).toBeNull();
    });

    it('blocks known stale proposals and reloads raced conflicts without retrying against a newer revision', async () => {
        setupFindings();
        const view = render(rows(item('a', { revision: 2 })));
        await screen.findByText('Item changed since this proposal. Run a fresh scrub.');
        expect(screen.getByRole('button', { name: 'Accept' })).toBeDisabled();
        expect(screen.getByRole('button', { name: 'Dismiss' })).toBeEnabled();
        view.rerender(rows());
        mock.accept.mockRejectedValue(Object.assign(new Error('stale'), { status: 409 }));
        fireEvent.click(screen.getByRole('button', { name: 'Accept' }));
        await screen.findByRole('alert');
        expect(screen.getByRole('alert')).toHaveTextContent('Item changed since this proposal. Run a fresh scrub.');
        expect(mock.accept).toHaveBeenCalledTimes(1);
    });

    it('shows unverified reasons without actions and treats unsafe evidence refs as text', async () => {
        const record = finding('unverified');
        record.finding = { ...record.finding, verdict: 'unverified', unverifiedReason: 'Remote server offline',
            evidence: [{ kind: 'other', ref: 'javascript:alert(1)', state: 'other', checkedAt: '2026-10-11T01:00:00Z' }] };
        setupFindings(record);
        render(rows());
        await screen.findByText('? Unverified');
        expect(screen.getByText('· Remote server offline')).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Accept' })).toBeNull();
        expect(screen.queryByRole('link', { name: 'javascript:alert(1)' })).toBeNull();
    });

    it('keeps run controls available when findings fail to load and disables stale finding actions', async () => {
        setupFindings();
        render(rows());
        await screen.findByText('◇ Proposal: Done (high)');
        mock.get.mockResolvedValue(response({ activeRun: active(), runs: [results([finding()]).summary] }));
        mock.getRun.mockRejectedValueOnce(new Error('offline'));
        await act(async () => mock.connect.mock.calls[0][0].onMessage({ type: 'sentinel-scrubber-changed', workspaceId: 'ws-a', processId: owner.processId }));
        await screen.findByText(/Could not load findings: offline/);
        expect(screen.getByRole('button', { name: 'Accept' })).toBeDisabled();
        expect(screen.getByRole('button', { name: 'Accept all proposals' })).toBeDisabled();
        expect(screen.getByRole('button', { name: 'Cancel' })).toBeEnabled();
        fireEvent.click(screen.getByRole('button', { name: 'Refresh findings' }));
        await waitFor(() => expect(screen.getByRole('button', { name: 'Accept' })).toBeEnabled());
    });

    it('lets the newest suppressed finding hide older applied badges', async () => {
        const newest = results([finding('suppressed')], 'new');
        const old = results([finding('applied', { audit: [{ action: 'applied', actor: 'scrubber', at: '2026-10-11T01:00:00Z', after: { status: 'done', archived: false, revision: 1 } }] })], 'old');
        mock.get.mockResolvedValue(response({ runs: [newest.summary, old.summary] }));
        mock.getRun.mockImplementation((_ws, _pid, runId) => Promise.resolve(runId === 'new' ? newest.detail : old.detail));
        render(rows());
        await screen.findByText('Manual only');
        expect(screen.queryByText('✓ Done by scrubber')).toBeNull();
    });

    it('discards delayed finding reads and mutations when owner changes', async () => {
        setupFindings();
        const pending = deferred<SentinelScrubRunDetail>();
        mock.getRun.mockReturnValueOnce(pending.promise);
        const view = render(rows());
        await waitFor(() => expect(mock.getRun).toHaveBeenCalledOnce());
        mock.get.mockResolvedValue(response());
        view.rerender(rows(item('a'), undefined, { ...owner, processId: 'other' }));
        await screen.findByText('Manual only');
        await act(async () => pending.resolve(results([finding()]).detail));
        expect(screen.queryByText(/Proposal: Done/)).toBeNull();
        setupFindings();
        view.rerender(rows());
        await screen.findByText('◇ Proposal: Done (high)');
        const write = deferred<unknown>();
        mock.accept.mockReturnValueOnce(write.promise);
        const refresh = vi.fn().mockResolvedValue(undefined);
        view.rerender(rows(item('a'), refresh));
        fireEvent.click(screen.getByRole('button', { name: 'Accept' }));
        mock.get.mockResolvedValue(response());
        view.rerender(rows(item('a'), refresh, { ...owner, processId: 'other' }));
        await act(async () => write.resolve({}));
        expect(refresh).not.toHaveBeenCalled();
    });
});
