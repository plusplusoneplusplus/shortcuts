/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { SentinelScheduledJob, SentinelScheduledJobRun } from '@plusplusoneplusplus/coc-client';

const mock = vi.hoisted(() => ({
    list: vi.fn(), create: vi.fn(), update: vi.fn(), delete: vi.fn(), start: vi.fn(), cancel: vi.fn(),
    connect: vi.fn(), request: vi.fn(), scrubGet: vi.fn(), scrubStart: vi.fn(), scrubUpdate: vi.fn(),
    refs: [] as unknown[], route: { kind: 'local' } as { kind: string; baseUrl?: string },
}));
vi.mock('../../../src/server/spa/client/react/repos/cloneRouting', () => ({ useCocClient: (ref: unknown) => { mock.refs.push(ref); return client; } }));
vi.mock('../../../src/server/spa/client/react/repos/cloneRegistry', () => ({ resolveCloneRoute: () => mock.route }));
vi.mock('../../../src/server/spa/client/react/hooks/useProviderModels', () => ({
    useProviderModels: () => ({ models: [{ id: 'test-model', enabled: true, name: 'Test model' }], loading: false, error: null, reload: vi.fn() }),
}));
const client = {
    sentinelTodos: { jobs: mock, scrubber: { get: mock.scrubGet, start: mock.scrubStart, updateConfig: mock.scrubUpdate, getRun: vi.fn().mockResolvedValue({ findings: [] }) } },
    events: { connect: mock.connect }, request: mock.request,
};
import { SentinelTodoJobs } from '../../../src/server/spa/client/react/features/repo-detail/unified-right-panel/SentinelTodoJobs';
import { applyRuntimeConfigPatch } from '../../../src/server/spa/client/react/utils/config';

const owner = { ownerWorkspaceId: 'ws-a', processId: 'queue_sentinel' };
const follow = vi.fn();
const job = (patch: Partial<SentinelScheduledJob> = {}): SentinelScheduledJob => ({
    id: 'j1', name: 'Daily review', instructions: 'Review the snapshot.', provider: 'copilot', model: 'test-model',
    mode: 'ask', enabled: true, autoCompactThreshold: 100_000, revision: 2, processId: 'queue_job', runs: [], ...patch,
});
const run = (patch: Partial<SentinelScheduledJobRun> = {}): SentinelScheduledJobRun => ({
    id: 'r1', runNumber: 1, trigger: 'manual', status: 'running', createdAt: '2026-10-18T12:00:00Z', ...patch,
});
function deferred<T>() {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>(done => { resolve = done; });
    return { promise, resolve };
}
function view(ownerOverride = owner) {
    return render(<SentinelTodoJobs owner={ownerOverride} items={[]} onFollowLink={follow} />);
}
beforeEach(() => {
    vi.clearAllMocks();
    mock.list.mockReset().mockResolvedValue({ jobs: [] });
    for (const action of [mock.create, mock.update, mock.delete, mock.start, mock.cancel]) action.mockReset().mockResolvedValue({});
    mock.connect.mockReturnValue({ close: vi.fn() });
    mock.request.mockReset().mockResolvedValue({ features: { sentinelEnabled: true, sentinelTodoJobsEnabled: true, sentinelTodoScrubberEnabled: false } });
    mock.scrubGet.mockReset().mockResolvedValue({ config: { enabled: true, paused: false, consecutiveFailures: 0, cron: '0 9 * * *', revision: 2 }, runs: [] });
    mock.scrubStart.mockReset().mockResolvedValue({ runId: 'scrub-1' });
    mock.scrubUpdate.mockReset().mockResolvedValue({});
    mock.route = { kind: 'local' };
    mock.refs.length = 0;
    applyRuntimeConfigPatch({ sentinelEnabled: true, sentinelTodoJobsEnabled: true, sentinelTodoScrubberEnabled: false });
});
afterEach(() => {
    cleanup();
    applyRuntimeConfigPatch({ sentinelEnabled: false, sentinelTodoJobsEnabled: false, sentinelTodoScrubberEnabled: false });
});
async function fillNew() {
    fireEvent.click(await screen.findByRole('button', { name: 'New job' }));
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Daily audit' } });
    fireEvent.change(screen.getByLabelText('Instructions'), { target: { value: 'Review pending work.' } });
    fireEvent.change(screen.getByLabelText('Model'), { target: { value: 'test-model' } });
}

describe('Sentinel To-do Jobs', () => {
    it('keeps the existing Scrubber strip and makes no jobs reads with the flag off', async () => {
        applyRuntimeConfigPatch({ sentinelTodoJobsEnabled: false, sentinelTodoScrubberEnabled: true });
        view();
        await screen.findByRole('button', { name: 'Scrub now' });
        expect(screen.queryByRole('region', { name: 'Jobs' })).toBeNull();
        expect(mock.list).not.toHaveBeenCalled();
    });
    it('requires Sentinel mode even with the jobs flag on', () => {
        applyRuntimeConfigPatch({ sentinelEnabled: false });
        view();
        expect(mock.list).not.toHaveBeenCalled();
        expect(screen.queryByRole('region', { name: 'Jobs' })).toBeNull();
    });
    it('renders loading and empty states, and collapses the section', async () => {
        const pending = deferred<{ jobs: SentinelScheduledJob[] }>();
        mock.list.mockReturnValue(pending.promise);
        view();
        expect(screen.getByText('Loading jobs...')).toBeInTheDocument();
        await act(async () => pending.resolve({ jobs: [] }));
        expect(screen.getByText(/No user jobs yet/)).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: /Jobs \(0\/10\)/ }));
        expect(screen.getByRole('button', { name: /Jobs \(0\/10\)/ })).toHaveAttribute('aria-expanded', 'false');
        expect(screen.getByText(/No user jobs yet/)).not.toBeVisible();
    });
    it('shows the Scrubber as the pinned first built-in row using its unchanged endpoints', async () => {
        applyRuntimeConfigPatch({ sentinelTodoScrubberEnabled: true });
        mock.list.mockResolvedValue({ jobs: [job()] });
        view();
        await screen.findByRole('article', { name: 'Daily review' });
        const section = screen.getByRole('region', { name: 'Jobs' });
        const builtIn = screen.getByTestId('sentinel-jobs-built-in');
        expect(within(builtIn).getByText('To-do Scrubber · built-in')).toBeInTheDocument();
        expect(within(builtIn).queryByRole('button', { name: 'Delete' })).toBeNull();
        expect(within(builtIn).queryByRole('button', { name: 'Edit' })).toBeNull();
        expect(section.querySelector('section')).toBe(screen.getByTestId('sentinel-scrubber-strip'));
        fireEvent.click(within(builtIn).getByRole('button', { name: 'Run now' }));
        await waitFor(() => expect(mock.scrubStart).toHaveBeenCalledWith('ws-a', 'queue_sentinel', {}));
        fireEvent.click(within(builtIn).getByRole('button', { name: 'Pause' }));
        await waitFor(() => expect(mock.scrubUpdate).toHaveBeenCalledWith('ws-a', 'queue_sentinel', {
            enabled: false, cron: '0 9 * * *', expectedRevision: 2,
        }));
    });
    it('omits the built-in row with only the jobs flag enabled', async () => {
        view();
        await screen.findByText(/No user jobs yet/);
        expect(screen.queryByTestId('sentinel-jobs-built-in')).toBeNull();
        expect(mock.scrubGet).not.toHaveBeenCalled();
    });
    it('creates an Ask manual job with its default threshold through the owner client', async () => {
        view();
        await fillNew();
        expect(screen.getByLabelText('Mode')).toHaveValue('ask');
        expect(screen.getByLabelText('Auto-compact threshold (tokens)')).toHaveValue(100_000);
        fireEvent.click(screen.getByRole('button', { name: 'Create job' }));
        await waitFor(() => expect(mock.create).toHaveBeenCalledWith('ws-a', 'queue_sentinel', {
            name: 'Daily audit', instructions: 'Review pending work.', provider: 'copilot', model: 'test-model',
            effort: '', mode: 'ask', cron: '', enabled: true, autoCompactThreshold: 100_000,
        }));
        await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    });
    it('validates hourly cron and positive thresholds and warns before Autopilot', async () => {
        view();
        await fillNew();
        fireEvent.change(screen.getByLabelText('Mode'), { target: { value: 'autopilot' } });
        expect(screen.getByText(/Autopilot can change files/)).toBeInTheDocument();
        const cron = screen.getByLabelText(/Cron \(optional/);
        fireEvent.change(cron, { target: { value: '*/15 * * * *' } });
        expect(screen.getByRole('button', { name: 'Create job' })).toBeDisabled();
        expect(screen.getByText(/schedule must run at most once an hour/)).toBeInTheDocument();
        fireEvent.change(screen.getByLabelText('Schedule preset'), { target: { value: '0 * * * *' } });
        expect(cron).toHaveValue('0 * * * *');
        fireEvent.change(screen.getByLabelText('Auto-compact threshold (tokens)'), { target: { value: '0' } });
        expect(screen.getByRole('button', { name: 'Create job' })).toBeDisabled();
        fireEvent.change(screen.getByLabelText('Auto-compact threshold (tokens)'), { target: { value: '2000' } });
        fireEvent.click(screen.getByRole('button', { name: 'Create job' }));
        await waitFor(() => expect(mock.create).toHaveBeenCalledWith('ws-a', 'queue_sentinel', expect.objectContaining({
            mode: 'autopilot', cron: '0 * * * *', autoCompactThreshold: 2000,
        })));
    });
    it('preserves failed edit drafts and their revision, and clears an optional schedule explicitly', async () => {
        mock.list.mockResolvedValue({ jobs: [job({ cron: '0 9 * * *' })] });
        mock.update.mockRejectedValue(Object.assign(new Error('conflict'), { status: 409 }));
        view();
        fireEvent.click(await screen.findByRole('button', { name: 'Edit' }));
        fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Edited audit' } });
        fireEvent.change(screen.getByLabelText('Schedule preset'), { target: { value: 'manual' } });
        fireEvent.click(screen.getByRole('button', { name: 'Save job' }));
        await waitFor(() => expect(mock.update).toHaveBeenCalledWith('ws-a', 'queue_sentinel', 'j1', expect.objectContaining({
            name: 'Edited audit', expectedRevision: 2, cron: '',
        })));
        await screen.findAllByText(/Job changed/);
        expect(screen.getByLabelText('Name')).toHaveValue('Edited audit');
        expect(screen.getByRole('dialog')).toBeInTheDocument();
    });
    it('limits user jobs to 10 without counting the built-in Scrubber', async () => {
        mock.list.mockResolvedValue({ jobs: Array.from({ length: 10 }, (_, i) => job({ id: `j${i}`, name: `Job ${i}` })) });
        view();
        await screen.findByText(/10-job limit reached/);
        expect(screen.getByRole('button', { name: 'New job' })).toBeDisabled();
    });
    it('serializes Run now clicks and exposes Cancel for an active run', async () => {
        const pending = deferred<SentinelScheduledJobRun>();
        mock.start.mockReturnValue(pending.promise);
        mock.list.mockResolvedValue({ jobs: [job()] });
        view();
        const button = await screen.findByRole('button', { name: 'Run now' });
        fireEvent.click(button); fireEvent.click(button);
        expect(mock.start).toHaveBeenCalledExactlyOnceWith('ws-a', 'queue_sentinel', 'j1');
        mock.list.mockResolvedValue({ jobs: [job({ activeRun: run(), runs: [run()] })] });
        await act(async () => pending.resolve(run()));
        await screen.findByText('Run #1 running');
        expect(screen.getByRole('button', { name: 'Run now' })).toBeDisabled();
        expect(screen.getByRole('button', { name: 'Edit' })).toBeDisabled();
        expect(screen.getByRole('button', { name: 'Delete' })).toBeDisabled();
        fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
        await waitFor(() => expect(mock.cancel).toHaveBeenCalledWith('ws-a', 'queue_sentinel', 'j1', 'r1'));
    });
    it('pauses/resumes a job without starting it and deletes only after confirmation', async () => {
        mock.list.mockResolvedValue({ jobs: [job()] });
        view();
        fireEvent.click(await screen.findByRole('button', { name: 'Pause' }));
        await waitFor(() => expect(mock.update).toHaveBeenCalledWith('ws-a', 'queue_sentinel', 'j1', { enabled: false, expectedRevision: 2 }));
        await waitFor(() => expect(screen.getByRole('button', { name: 'Delete' })).not.toBeDisabled());
        fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
        expect(mock.delete).not.toHaveBeenCalled();
        fireEvent.click(screen.getByRole('button', { name: 'Delete job' }));
        await waitFor(() => expect(mock.delete).toHaveBeenCalledWith('ws-a', 'queue_sentinel', 'j1', { expectedRevision: 2 }));
        expect(mock.start).not.toHaveBeenCalled();
    });
    it('holds admission until the post-mutation reload settles', async () => {
        mock.list.mockResolvedValue({ jobs: [job()] });
        view();
        const button = await screen.findByRole('button', { name: 'Run now' });
        const refresh = deferred<{ jobs: SentinelScheduledJob[] }>();
        mock.list.mockReturnValue(refresh.promise);
        fireEvent.click(button);
        await waitFor(() => expect(mock.list).toHaveBeenCalledTimes(2));
        expect(button).toBeDisabled();
        fireEvent.click(button);
        expect(mock.start).toHaveBeenCalledTimes(1);
        await act(async () => refresh.resolve({ jobs: [job({ activeRun: run() })] }));
        expect(button).toBeDisabled();
        expect(screen.getByRole('button', { name: 'Cancel' })).not.toBeDisabled();
    });
    it('shows load errors with explicit retry and restores controls after success', async () => {
        mock.list.mockRejectedValue(new Error('Offline'));
        view();
        await screen.findByText(/Could not load jobs: Offline/);
        expect(screen.getByRole('button', { name: 'New job' })).toBeDisabled();
        mock.list.mockResolvedValue({ jobs: [] });
        fireEvent.click(screen.getByRole('button', { name: 'Refresh jobs' }));
        await screen.findByText(/No user jobs yet/);
        expect(screen.getByRole('button', { name: 'New job' })).not.toBeDisabled();
    });
    it('renders bounded history with timings, failure/overlap and owner-qualified turn links', async () => {
        mock.route = { kind: 'remote', baseUrl: 'https://example.invalid' };
        mock.list.mockResolvedValue({ jobs: [job({ mode: 'autopilot', runs: [
            run({ status: 'completed', startedAt: '2026-10-18T12:00:01Z', finishedAt: '2026-10-18T12:00:02Z', durationMs: 1000,
                jobTurnHref: '#repos/ws-a/chats/queue_job?turn=2', sentinelFollowUpHref: '#repos/ws-a/chats/queue_sentinel?turn=4' }),
            run({ id: 'r2', runNumber: 2, status: 'skipped', trigger: 'schedule', skipReason: 'overlap' }),
        ] })] });
        render(<SentinelTodoJobs owner={{ ...owner, ownerRoutingRef: 'remote:server:ws-a' }} items={[]} onFollowLink={follow} />);
        await screen.findByText('Autopilot');
        fireEvent.click(screen.getByText('History (2)'));
        expect(screen.getByText('#2 · schedule · skipped: overlap')).toBeInTheDocument();
        expect(screen.getByText('Duration: 1.0s')).toBeInTheDocument();
        const link = screen.getByRole('link', { name: 'Job turn' });
        expect(link).toHaveAttribute('href', '#repos/remote%3Aserver%3Aws-a/chats/queue_job?turn=2');
        fireEvent.click(link);
        expect(follow).toHaveBeenCalledWith(expect.anything(), 'sentinel-job:queue_job:?turn=2');
        expect(screen.getByRole('link', { name: 'Sentinel follow-up' })).toHaveAttribute('href', '#repos/remote%3Aserver%3Aws-a/chats/queue_sentinel?turn=4');
    });
    it('uses owning-server feature policy even when local jobs are off', async () => {
        applyRuntimeConfigPatch({ sentinelEnabled: false, sentinelTodoJobsEnabled: false });
        mock.route = { kind: 'remote', baseUrl: 'https://example.invalid' };
        render(<SentinelTodoJobs owner={{ ...owner, ownerRoutingRef: 'remote:server:group-a' }} items={[]} onFollowLink={follow} />);
        await screen.findByText(/No user jobs yet/);
        expect(mock.request).toHaveBeenCalledWith('/config/runtime', expect.objectContaining({ signal: expect.any(AbortSignal) }));
        expect(mock.refs).toContain('remote:server:group-a');
        expect(mock.list).toHaveBeenCalledWith('ws-a', 'queue_sentinel', expect.objectContaining({ signal: expect.any(AbortSignal) }));
    });
    it('does not fall back to local jobs on remote policy failure or unresolved ownership', async () => {
        mock.route = { kind: 'remote', baseUrl: 'https://example.invalid' };
        mock.request.mockRejectedValue(new Error('No connection'));
        const page = view();
        await screen.findByText(/Jobs unavailable: No connection/);
        expect(mock.list).not.toHaveBeenCalled();
        mock.route = { kind: 'unresolved-remote' };
        page.rerender(<SentinelTodoJobs owner={owner} items={[]} onFollowLink={follow} />);
        expect(screen.getByText(/owning server is not connected/)).toBeInTheDocument();
        expect(mock.list).not.toHaveBeenCalled();
    });
    it('filters owner events and unsubscribes/ignores late reads when the live flag is disabled', async () => {
        view();
        await screen.findByText(/No user jobs yet/);
        const options = mock.connect.mock.calls[0][0];
        await act(async () => options.onMessage({ type: 'sentinel-jobs-changed', workspaceId: 'other', processId: owner.processId }));
        expect(mock.list).toHaveBeenCalledTimes(1);
        const pending = deferred<{ jobs: SentinelScheduledJob[] }>();
        mock.list.mockReturnValue(pending.promise);
        act(() => options.onMessage({ type: 'sentinel-jobs-changed', workspaceId: owner.ownerWorkspaceId, processId: owner.processId }));
        const close = mock.connect.mock.results[0].value.close;
        act(() => applyRuntimeConfigPatch({ sentinelTodoJobsEnabled: false }));
        expect(close).toHaveBeenCalledOnce();
        await act(async () => pending.resolve({ jobs: [job()] }));
        expect(screen.queryByText('Daily review')).toBeNull();
    });
});
