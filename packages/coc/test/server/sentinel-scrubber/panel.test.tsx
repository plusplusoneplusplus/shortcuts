/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { SentinelScrubberResponse, SentinelScrubRun, SentinelTodoItem } from '@plusplusoneplusplus/coc-client';

const mock = vi.hoisted(() => ({ get: vi.fn(), start: vi.fn(), cancel: vi.fn(), updateConfig: vi.fn(), connect: vi.fn(), route: { kind: 'local' } as { kind: string; baseUrl?: string }, refs: [] as unknown[] }));
vi.mock('../../../src/server/spa/client/react/repos/cloneRouting', () => ({ useCocClient: (ref: unknown) => { mock.refs.push(ref); return client; } }));
vi.mock('../../../src/server/spa/client/react/repos/cloneRegistry', () => ({ resolveCloneRoute: () => mock.route }));
const client = { sentinelTodos: { scrubber: mock }, events: { connect: mock.connect } };
import { SentinelTodoScrubber } from '../../../src/server/spa/client/react/features/repo-detail/unified-right-panel/SentinelTodoScrubber';
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
