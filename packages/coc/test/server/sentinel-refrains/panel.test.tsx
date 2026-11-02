/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { SentinelRefrain, SentinelRefrainGateTest, SentinelRefrainInput, SentinelRefrainRun } from '@plusplusoneplusplus/coc-client';

const mock = vi.hoisted(() => ({
    list: vi.fn(), create: vi.fn(), update: vi.fn(), delete: vi.fn(), start: vi.fn(), cancel: vi.fn(), testGate: vi.fn(), resumeGate: vi.fn(),
    connect: vi.fn(), request: vi.fn(), scrubGet: vi.fn(), scrubStart: vi.fn(), scrubUpdate: vi.fn(),
    width: 800, refs: [] as unknown[], route: { kind: 'local' } as { kind: string; baseUrl?: string },
    tierReads: [] as unknown[][], tiersLoading: false,
    tiers: {} as Record<string, Record<string, { model: string; reasoningEffort: string; source: 'config' | 'default' }>>,
}));
vi.mock('../../../src/server/spa/client/react/features/chat/hooks/useContainerWidth', () => ({ useContainerWidth: () => ({ width: mock.width }) }));
vi.mock('../../../src/server/spa/client/react/repos/cloneRouting', () => ({
    useCocClient: (ref: unknown) => { mock.refs.push(ref); return client; },
    useCloneBaseUrl: () => mock.route.baseUrl,
}));
vi.mock('../../../src/server/spa/client/react/repos/cloneRegistry', () => ({ resolveCloneRoute: () => mock.route }));
vi.mock('../../../src/server/spa/client/react/hooks/useProviderModels', () => ({
    useProviderModels: () => ({ models: [{ id: 'test-model', enabled: true, name: 'Test model' }], loading: false, error: null, reload: vi.fn() }),
}));
vi.mock('../../../src/server/spa/client/react/hooks/useProviderEffortTiers', async importOriginal => ({
    ...await importOriginal<typeof import('../../../src/server/spa/client/react/hooks/useProviderEffortTiers')>(),
    useProviderEffortTiers: (provider: string, baseUrl?: string, owner?: unknown) => {
        mock.tierReads.push([provider, baseUrl, owner]);
        return { tiers: mock.tiers[provider] ?? {}, loading: mock.tiersLoading, error: null, reload: vi.fn() };
    },
}));
const client = {
    sentinelTodos: { jobs: mock, scrubber: { get: mock.scrubGet, start: mock.scrubStart, updateConfig: mock.scrubUpdate, getRun: vi.fn().mockResolvedValue({ findings: [] }) } },
    events: { connect: mock.connect }, request: mock.request,
};
import { useCallback, useMemo, useRef, useState, type ReactNode } from 'react';
import { RefrainHistoryHostContext, SentinelRefrains } from '../../../src/server/spa/client/react/features/repo-detail/unified-right-panel/SentinelRefrains';
import { applyRuntimeConfigPatch } from '../../../src/server/spa/client/react/utils/config';

const owner = { ownerWorkspaceId: 'ws-a', processId: 'queue_sentinel' };
const follow = vi.fn();
const job = (patch: Partial<SentinelRefrain> = {}): SentinelRefrain => ({
    id: 'j1', name: 'Daily review', instructions: 'Review the snapshot.', provider: 'copilot', model: 'test-model',
    mode: 'ask', enabled: true, autoCompactThreshold: 100_000, gateConsecutiveFailures: 0, gatePaused: false, revision: 2,
    processId: 'queue_job', runs: [], ...patch,
});
const run = (patch: Partial<SentinelRefrainRun> = {}): SentinelRefrainRun => ({
    id: 'r1', runNumber: 1, trigger: 'manual', status: 'running', createdAt: '2026-10-18T12:00:00Z', ...patch,
});
function deferred<T>() {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>(done => { resolve = done; });
    return { promise, resolve };
}
function view(ownerOverride = owner) {
    return render(<SentinelRefrains owner={ownerOverride} items={[]} onFollowLink={follow} />);
}
async function openActions() {
    for (const summary of await screen.findAllByLabelText(/^More actions for/)) {
        if (!(summary.parentElement as HTMLDetailsElement).open) fireEvent.click(summary);
    }
}
beforeEach(() => {
    vi.clearAllMocks();
    mock.list.mockReset().mockResolvedValue({ jobs: [] });
    for (const action of [mock.create, mock.update, mock.delete, mock.start, mock.cancel, mock.testGate, mock.resumeGate]) action.mockReset().mockResolvedValue({});
    mock.connect.mockReturnValue({ close: vi.fn() });
    mock.request.mockReset().mockResolvedValue({ features: { sentinelEnabled: true, sentinelTodoJobsEnabled: true, sentinelTodoScrubberEnabled: false } });
    mock.scrubGet.mockReset().mockResolvedValue({ config: { enabled: true, paused: false, consecutiveFailures: 0, cron: '0 9 * * *', revision: 2 }, runs: [] });
    mock.scrubStart.mockReset().mockResolvedValue({ runId: 'scrub-1' });
    mock.scrubUpdate.mockReset().mockResolvedValue({});
    mock.route = { kind: 'local' };
    mock.width = 800;
    mock.refs.length = 0;
    mock.tierReads.length = 0;
    mock.tiersLoading = false;
    mock.tiers = {
        copilot: { low: { model: 'cp-low', reasoningEffort: 'low', source: 'config' }, medium: { model: 'cp-med', reasoningEffort: '', source: 'default' },
            high: { model: 'cp-high', reasoningEffort: 'high', source: 'config' } },
        codex: { medium: { model: 'cx-med', reasoningEffort: 'medium', source: 'default' } },
    };
    applyRuntimeConfigPatch({ sentinelEnabled: true, sentinelTodoJobsEnabled: true, sentinelTodoScrubberEnabled: false, effortLevelsEnabled: false });
});
afterEach(() => {
    cleanup();
    applyRuntimeConfigPatch({ sentinelEnabled: false, sentinelTodoJobsEnabled: false, sentinelTodoScrubberEnabled: false });
});
async function fillNew() {
    fireEvent.click(await screen.findByRole('button', { name: 'New refrain' }));
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Daily audit' } });
    fireEvent.change(screen.getByLabelText('Instructions'), { target: { value: 'Review pending work.' } });
    fireEvent.change(screen.getByLabelText('Model'), { target: { value: 'test-model' } });
}

describe('Sentinel Refrains', () => {
    it('keeps secondary actions and history collapsed and exposes the complete error', async () => {
        const error = 'Unsupported reasoning effort. ' + 'long-diagnostic/'.repeat(40) + '\nEnd of diagnostic';
        mock.list.mockResolvedValue({ jobs: [job({ enabled: false, runs: [run({ status: 'failed', error })] })] });
        view();
        await screen.findByText('Paused');
        expect(screen.getByRole('button', { name: 'Run now' })).toBeVisible();
        expect(screen.getByRole('button', { name: 'Resume', exact: true })).toBeVisible();
        expect(screen.getByRole('button', { name: 'Edit' })).not.toBeVisible();
        const summary = screen.getByLabelText('More actions for Daily review');
        fireEvent.click(summary);
        expect(screen.getByRole('button', { name: 'Edit' })).toBeVisible();
        expect(screen.getByText('History (1)').parentElement).not.toHaveAttribute('open');
        fireEvent.keyDown(screen.getByRole('button', { name: 'Edit' }), { key: 'Escape' });
        expect(summary).toHaveFocus();
        expect(screen.getByRole('button', { name: 'Edit' })).not.toBeVisible();
        const full = screen.getByLabelText('Full error');
        expect(full).not.toBeVisible();
        fireEvent.click(screen.getByLabelText('Last run #1: failed. Show full error'));
        expect(full).toBeVisible();
        expect(full.textContent).toBe(error);
        expect(full).toHaveAttribute('tabindex', '0');
        expect(mock.start).not.toHaveBeenCalled();
        expect(mock.update).not.toHaveBeenCalled();
    });
    it.each([
        { refrains: true, coda: true }, { refrains: true, coda: false },
        { refrains: false, coda: true }, { refrains: false, coda: false },
    ])('explains available automation without changing sections or running anything ($refrains/$coda)', async ({ refrains, coda }) => {
        applyRuntimeConfigPatch({ sentinelTodoJobsEnabled: refrains, sentinelTodoScrubberEnabled: coda });
        view();
        if (refrains) await screen.findByText(/No refrains yet/);
        if (coda) await screen.findByRole('button', { name: 'Run now' });
        expect(!!screen.queryByRole('button', { name: 'About Refrains' })).toBe(refrains);
        expect(!!screen.queryByRole('button', { name: 'About Coda' })).toBe(coda);
        if (refrains) {
            const toggle = screen.getByRole('button', { name: /Refrains \(0\/10\)/ });
            const info = screen.getByRole('button', { name: 'About Refrains' });
            expect(toggle.contains(info)).toBe(false);
            expect(screen.queryByText(/Results stay in each refrain/)).toBeNull();
            expect(screen.queryByText(/missed runs are not caught up/)).toBeNull();
            fireEvent.click(info);
            const dialog = screen.getByRole('dialog', { name: 'About Refrains' });
            expect(dialog.textContent).toContain('An optional gate decides whether a run should start');
            expect(dialog.textContent).toContain("Results stay in each refrain's job chat and are not sent to this Sentinel");
            expect(dialog.textContent).not.toContain('Results return to this Sentinel');
            expect(toggle.getAttribute('aria-expanded')).toBe('true');
            fireEvent.keyDown(dialog, { key: 'Escape' });
        }
        if (coda) {
            fireEvent.click(screen.getByRole('button', { name: 'About Coda' }));
            const dialog = screen.getByRole('dialog', { name: 'About Coda' });
            expect(dialog.textContent).toContain('Done results may apply automatically');
            expect(dialog.textContent).toContain('manual and Deferred items need your approval');
            expect(dialog.textContent).toContain('does not carry out the tasks');
            if (refrains) expect(screen.getByTestId('sentinel-refrains-built-in')).toBeTruthy();
            else expect(screen.queryByRole('region', { name: 'Refrains' })).toBeNull();
        }
        for (const mutation of [mock.create, mock.start, mock.update, mock.delete, mock.cancel, mock.testGate, mock.resumeGate,
            mock.scrubStart, mock.scrubUpdate]) expect(mutation).not.toHaveBeenCalled();
    });

    it.each(['workspace', 'process', 'server'] as const)('drops open help when the exact remote %s owner changes', async change => {
        mock.route = { kind: 'remote', baseUrl: 'https://owner.test' };
        const own = { ...owner, ownerRoutingRef: 'remote:server-a:ws-a' };
        const mounted = view(own);
        fireEvent.click(await screen.findByRole('button', { name: 'About Refrains' }));
        expect(screen.getByRole('dialog', { name: 'About Refrains' })).toBeTruthy();
        const next = change === 'workspace' ? { ...own, ownerWorkspaceId: 'ws-other', ownerRoutingRef: 'remote:server-a:ws-other' }
            : change === 'process' ? { ...own, processId: 'queue_other' } : { ...own, ownerRoutingRef: 'remote:server-b:ws-a' };
        mounted.rerender(<SentinelRefrains owner={next} items={[]} onFollowLink={follow} />);
        await screen.findByRole('button', { name: 'About Refrains' });
        expect(screen.queryByRole('dialog')).toBeNull();
        expect(mock.refs).toContain(next.ownerRoutingRef);
        expect(mock.create).not.toHaveBeenCalled();
        expect(mock.start).not.toHaveBeenCalled();
    });

    it('keeps the existing Scrubber strip and makes no jobs reads with the flag off', async () => {
        applyRuntimeConfigPatch({ sentinelTodoJobsEnabled: false, sentinelTodoScrubberEnabled: true });
        view();
        await screen.findByRole('button', { name: 'Run now' });
        expect(screen.queryByRole('region', { name: 'Refrains' })).toBeNull();
        expect(mock.list).not.toHaveBeenCalled();
    });
    it('requires Sentinel mode even with the jobs flag on', () => {
        applyRuntimeConfigPatch({ sentinelEnabled: false });
        view();
        expect(mock.list).not.toHaveBeenCalled();
        expect(screen.queryByRole('region', { name: 'Refrains' })).toBeNull();
    });
    it('refreshes manual gate skips and shows gate conflicts as returned', async () => {
        const gated = job({ cron: '0 * * * *', gateScript: 'return [];' });
        mock.list.mockResolvedValue({ jobs: [gated] });
        view();
        const button = await screen.findByRole('button', { name: 'Run now' });
        mock.start.mockResolvedValueOnce(run({ status: 'skipped', skipReason: 'gate-empty' }));
        mock.list.mockResolvedValue({ jobs: [{ ...gated, runs: [run({ status: 'skipped', skipReason: 'gate-empty' })] }] });
        fireEvent.click(button);
        await screen.findByText('Last run #1: skipped: gate result empty');
        await waitFor(() => expect(button).not.toBeDisabled());
        mock.start.mockRejectedValueOnce(Object.assign(new Error('Refrain gate is paused; resume the gate before Run now'), { status: 409 }));
        fireEvent.click(button);
        expect(await screen.findByRole('alert')).toHaveTextContent('Refrain gate is paused; resume the gate before Run now');
    });

    it('renders loading and empty states, and collapses the section', async () => {
        const pending = deferred<{ jobs: SentinelRefrain[] }>();
        mock.list.mockReturnValue(pending.promise);
        view();
        expect(screen.getByText('Loading refrains…')).toBeInTheDocument();
        await act(async () => pending.resolve({ jobs: [] }));
        expect(screen.getByText(/No refrains yet/)).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: /Refrains \(0\/10\)/ }));
        expect(screen.getByRole('button', { name: /Refrains \(0\/10\)/ })).toHaveAttribute('aria-expanded', 'false');
        expect(screen.getByText(/No refrains yet/)).not.toBeVisible();
    });
    it('waits for the owning ledger before mounting job controls or subscriptions', async () => {
        const page = render(<SentinelRefrains owner={owner} ready={false} items={[]} onFollowLink={follow} />);
        expect(mock.list).not.toHaveBeenCalled();
        expect(mock.connect).not.toHaveBeenCalled();
        page.rerender(<SentinelRefrains owner={owner} ready items={[]} onFollowLink={follow} />);
        await screen.findByText(/No refrains yet/);
        expect(mock.list).toHaveBeenCalledTimes(1);
    });
    it('shows the Scrubber as the pinned first built-in row using its unchanged endpoints', async () => {
        applyRuntimeConfigPatch({ sentinelTodoScrubberEnabled: true });
        mock.list.mockResolvedValue({ jobs: [job()] });
        view();
        await screen.findByRole('article', { name: 'Daily review' });
        const section = screen.getByRole('region', { name: 'Refrains' });
        const builtIn = screen.getByTestId('sentinel-refrains-built-in');
        expect(within(builtIn).getByText('Coda · built-in')).toBeInTheDocument();
        expect(within(builtIn).queryByRole('button', { name: 'Delete' })).toBeNull();
        expect(within(builtIn).queryByRole('button', { name: 'Edit' })).toBeNull();
        expect(section.querySelector('section')).toBe(screen.getByTestId('sentinel-coda-strip'));
        fireEvent.click(within(builtIn).getByRole('button', { name: 'Run now' }));
        await waitFor(() => expect(mock.scrubStart).toHaveBeenCalledWith('ws-a', 'queue_sentinel', {}));
        fireEvent.click(within(builtIn).getByRole('button', { name: 'Pause' }));
        await waitFor(() => expect(mock.scrubUpdate).toHaveBeenCalledWith('ws-a', 'queue_sentinel', {
            enabled: false, cron: '0 9 * * *', expectedRevision: 2,
        }));
    });
    it('omits the built-in row with only the jobs flag enabled', async () => {
        view();
        await screen.findByText(/No refrains yet/);
        expect(screen.queryByTestId('sentinel-refrains-built-in')).toBeNull();
        expect(mock.scrubGet).not.toHaveBeenCalled();
    });
    it('creates an Ask manual job with its default threshold through the owner client', async () => {
        view();
        await fillNew();
        expect(screen.getByLabelText('Mode')).toHaveValue('ask');
        expect(within(screen.getByLabelText('Effort')).queryByRole('option', { name: 'max', exact: true })).toBeNull();
        const threshold = screen.getByRole('textbox', { name: 'Auto-compact threshold (K tokens)' });
        expect(threshold).toHaveValue('100');
        expect(threshold).toHaveAttribute('inputmode', 'decimal');
        expect(threshold).toHaveAccessibleDescription('1K = 1,000 tokens; up to 3 decimals.');
        expect(within(threshold.parentElement!).getByText('K')).toBeVisible();
        fireEvent.click(screen.getByRole('button', { name: 'Create refrain' }));
        await waitFor(() => expect(mock.create).toHaveBeenCalledWith('ws-a', 'queue_sentinel', {
            name: 'Daily audit', instructions: 'Review pending work.', provider: 'copilot', model: 'test-model',
            effort: '', effortTier: '', mode: 'ask', cron: '', enabled: true, autoCompactThreshold: 100_000, gateScript: '',
        }));
        await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    });
    describe.each(['create', 'edit'] as const)('%s K-token thresholds', action => {
        async function open() {
            if (action === 'edit') mock.list.mockResolvedValue({ jobs: [job()] });
            view();
            if (action === 'create') await fillNew();
            else {
                await openActions();
                fireEvent.click(await screen.findByRole('button', { name: 'Edit' }));
            }
            return screen.getByRole('textbox', { name: 'Auto-compact threshold (K tokens)' });
        }
        const saveLabel = action === 'create' ? 'Create refrain' : 'Save refrain';

        it.each([
            ['125', 125_000], ['100.001', 100_001], ['1.001', 1_001],
            ['0.001', 1], ['9007199254740.991', Number.MAX_SAFE_INTEGER],
        ])('saves %sK as %i absolute tokens and reloads the exact draft', async (draft, tokens) => {
            const threshold = await open();
            const persist = async (input: SentinelRefrainInput) => {
                const saved = job({ ...input, autoCompactThreshold: input.autoCompactThreshold, revision: 3 });
                mock.list.mockResolvedValue({ jobs: [saved] });
                return saved;
            };
            if (action === 'create') mock.create.mockImplementation((_workspace, _process, input) => persist(input));
            else mock.update.mockImplementation((_workspace, _process, _id, input) => persist(input));
            fireEvent.change(threshold, { target: { value: draft } });
            expect(threshold).toHaveAttribute('aria-invalid', 'false');
            fireEvent.click(screen.getByRole('button', { name: saveLabel }));
            if (action === 'create') {
                await waitFor(() => expect(mock.create).toHaveBeenCalledWith('ws-a', 'queue_sentinel',
                    expect.objectContaining({ autoCompactThreshold: tokens, cron: '' })));
            } else {
                await waitFor(() => expect(mock.update).toHaveBeenCalledWith('ws-a', 'queue_sentinel', 'j1',
                    expect.objectContaining({ autoCompactThreshold: tokens, expectedRevision: 2, cron: '' })));
            }
            await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
            await openActions();
            fireEvent.click(await screen.findByRole('button', { name: 'Edit' }));
            expect(screen.getByLabelText('Auto-compact threshold (K tokens)')).toHaveValue(draft);
            expect(mock.start).not.toHaveBeenCalled();
        });

        it.each(['', '0', '-1', 'NaN', 'Infinity', 'abc', '0.0001', '100.0001', '1e3', '9007199254740.992'])(
            'rejects invalid K draft "%s" visibly without saving or rounding', async draft => {
                const threshold = await open();
                fireEvent.change(threshold, { target: { value: draft } });
                expect(threshold).toHaveValue(draft);
                expect(threshold).toHaveAttribute('aria-invalid', 'true');
                expect(threshold).toHaveAccessibleDescription('Enter a positive K value, up to 3 decimals, within the safe integer token range.');
                expect(screen.getByRole('alert')).toHaveTextContent('Enter a positive K value');
                expect(screen.getByRole('button', { name: saveLabel })).toBeDisabled();
                fireEvent.submit(screen.getByRole('form', { name: action === 'create' ? 'New refrain' : 'Edit refrain' }));
                expect(mock.create).not.toHaveBeenCalled();
                expect(mock.update).not.toHaveBeenCalled();
            },
        );

        it('discards a cancelled threshold draft without saving', async () => {
            const threshold = await open();
            fireEvent.change(threshold, { target: { value: '123.456' } });
            fireEvent.click(screen.getByRole('button', { name: 'Cancel', exact: true }));
            expect(screen.queryByRole('dialog')).toBeNull();
            expect(mock.create).not.toHaveBeenCalled();
            expect(mock.update).not.toHaveBeenCalled();
            fireEvent.click(screen.getByRole('button', { name: action === 'create' ? 'New refrain' : 'Edit', exact: true }));
            expect(screen.getByLabelText('Auto-compact threshold (K tokens)')).toHaveValue('100');
        });
    });
    it.each([
        [100_000, '100'], [100_001, '100.001'], [100_010, '100.01'], [100_100, '100.1'],
        [100_999, '100.999'], [1_001, '1.001'], [1, '0.001'], [Number.MAX_SAFE_INTEGER, '9007199254740.991'],
    ])('preserves an unchanged stored threshold of %i tokens as %sK on edit', async (tokens, draft) => {
        mock.list.mockResolvedValue({ jobs: [job({ autoCompactThreshold: tokens })] });
        view();
        await openActions();
        fireEvent.click(await screen.findByRole('button', { name: 'Edit' }));
        expect(screen.getByLabelText('Auto-compact threshold (K tokens)')).toHaveValue(draft);
        fireEvent.click(screen.getByRole('button', { name: 'Save refrain' }));
        await waitFor(() => expect(mock.update).toHaveBeenCalledWith('ws-a', 'queue_sentinel', 'j1',
            expect.objectContaining({ autoCompactThreshold: tokens, expectedRevision: 2 })));
        await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    });
    it('validates hourly cron and positive thresholds and warns before Autopilot', async () => {
        view();
        await fillNew();
        fireEvent.change(screen.getByLabelText('Mode'), { target: { value: 'autopilot' } });
        expect(screen.getByText(/Autopilot can change files/)).toBeInTheDocument();
        const cron = screen.getByLabelText(/Cron \(optional/);
        fireEvent.change(cron, { target: { value: '*/15 * * * *' } });
        expect(screen.getByRole('button', { name: 'Create refrain' })).toBeDisabled();
        expect(screen.getByText(/schedule must run at most once an hour/)).toBeInTheDocument();
        fireEvent.change(screen.getByLabelText('Schedule preset'), { target: { value: '0 * * * *' } });
        expect(cron).toHaveValue('0 * * * *');
        fireEvent.change(screen.getByLabelText('Auto-compact threshold (K tokens)'), { target: { value: '0' } });
        expect(screen.getByRole('button', { name: 'Create refrain' })).toBeDisabled();
        fireEvent.change(screen.getByLabelText('Auto-compact threshold (K tokens)'), { target: { value: '2' } });
        fireEvent.click(screen.getByRole('button', { name: 'Create refrain' }));
        await waitFor(() => expect(mock.create).toHaveBeenCalledWith('ws-a', 'queue_sentinel', expect.objectContaining({
            mode: 'autopilot', cron: '0 * * * *', autoCompactThreshold: 2000,
        })));
    });
    it('preserves failed edit drafts and their revision, and clears an optional schedule explicitly', async () => {
        mock.list.mockResolvedValue({ jobs: [job({ cron: '0 9 * * *' })] });
        mock.update.mockRejectedValue(Object.assign(new Error('conflict'), { status: 409 }));
        view();
        await openActions();
        fireEvent.click(await screen.findByRole('button', { name: 'Edit' }));
        fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Edited audit' } });
        fireEvent.change(screen.getByLabelText('Auto-compact threshold (K tokens)'), { target: { value: '100.001' } });
        fireEvent.change(screen.getByLabelText('Schedule preset'), { target: { value: 'manual' } });
        fireEvent.click(screen.getByRole('button', { name: 'Save refrain' }));
        await waitFor(() => expect(mock.update).toHaveBeenCalledWith('ws-a', 'queue_sentinel', 'j1', expect.objectContaining({
            name: 'Edited audit', expectedRevision: 2, cron: '', autoCompactThreshold: 100_001,
        })));
        await screen.findAllByText(/Refrain changed/);
        expect(screen.getByLabelText('Name')).toHaveValue('Edited audit');
        expect(screen.getByLabelText('Auto-compact threshold (K tokens)')).toHaveValue('100.001');
        expect(screen.getByRole('dialog')).toBeInTheDocument();
    });
    it('limits user jobs to 10 without counting the built-in Scrubber', async () => {
        mock.list.mockResolvedValue({ jobs: Array.from({ length: 10 }, (_, i) => job({ id: `j${i}`, name: `Job ${i}` })) });
        view();
        await screen.findByText(/10-refrain limit reached/);
        expect(screen.getByRole('button', { name: 'New refrain' })).toBeDisabled();
    });
    it('serializes Run now clicks and exposes Cancel for an active run', async () => {
        const pending = deferred<SentinelRefrainRun>();
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
        await openActions();
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
        await openActions();
        await waitFor(() => expect(screen.getByRole('button', { name: 'Delete' })).not.toBeDisabled());
        fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
        expect(mock.delete).not.toHaveBeenCalled();
        fireEvent.click(screen.getByRole('button', { name: 'Delete refrain' }));
        await waitFor(() => expect(mock.delete).toHaveBeenCalledWith('ws-a', 'queue_sentinel', 'j1', { expectedRevision: 2 }));
        expect(mock.start).not.toHaveBeenCalled();
    });
    it('holds admission until the post-mutation reload settles', async () => {
        mock.list.mockResolvedValue({ jobs: [job()] });
        view();
        const button = await screen.findByRole('button', { name: 'Run now' });
        const refresh = deferred<{ jobs: SentinelRefrain[] }>();
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
        await screen.findByText(/Could not load refrains: Offline/);
        expect(screen.getByRole('button', { name: 'New refrain' })).toBeDisabled();
        mock.list.mockResolvedValue({ jobs: [] });
        fireEvent.click(screen.getByRole('button', { name: 'Refresh refrains' }));
        await screen.findByText(/No refrains yet/);
        expect(screen.getByRole('button', { name: 'New refrain' })).not.toBeDisabled();
    });
    it('keeps compact history and owner-qualified job-turn links in the selected detail pane', async () => {
        mock.route = { kind: 'remote', baseUrl: 'https://example.invalid' };
        mock.list.mockResolvedValue({ jobs: [job({ mode: 'autopilot', runs: [
            run({ status: 'completed', startedAt: '2026-10-18T12:00:01Z', finishedAt: '2026-10-18T12:00:02Z', durationMs: 1000,
                jobTurnHref: '#repos/ws-a/chats/queue_job?turn=2' }),
            run({ id: 'r2', runNumber: 2, status: 'skipped', trigger: 'schedule', skipReason: 'overlap' }),
        ] })] });
        render(<SentinelRefrains owner={{ ...owner, ownerRoutingRef: 'remote:server:ws-a' }} items={[]} onFollowLink={follow} />);
        fireEvent.click(await screen.findByText('History (2)'));
        expect(screen.getByLabelText('Select run #2: skipped: overlap (schedule)')).toBeVisible();
        expect(screen.queryByText('Finished')).toBeNull();
        fireEvent.click(screen.getByLabelText('Select run #1: completed (manual)'));
        const detail = screen.getByRole('region', { name: 'Run details for Daily review' });
        expect(within(detail).getByText('Finished')).toBeVisible();
        expect(within(detail).getByText('1.0s')).toBeVisible();
        const link = within(detail).getByRole('link', { name: 'Job turn' });
        expect(link).toHaveAttribute('href', '#repos/remote%3Aserver%3Aws-a/chats/queue_job?turn=2');
        fireEvent.click(link);
        expect(follow).toHaveBeenCalledWith(expect.anything(), 'sentinel-job:queue_job:?turn=2');
        expect(screen.queryByRole('link', { name: 'Sentinel follow-up' })).not.toBeInTheDocument();
    });
    it('shows exact metadata and selectable errors for one stable selection beside newest-first rows', async () => {
        const diagnostic = 'Full diagnostic ' + 'long-unbroken-error/'.repeat(60) + '\nLast diagnostic line';
        const createdAt = '2026-10-28T08:47:01.123Z';
        const startedAt = '2026-10-28T08:47:02.456Z';
        const finishedAt = '2026-10-28T08:48:53.789Z';
        mock.list.mockResolvedValue({ jobs: [job({ provider: 'copilot', effortTier: 'medium', cron: '0 14 * * *', nextRunAt: '2026-10-29T14:00:00Z', runs: [
            run({ id: 'r3', runNumber: 3, status: 'failed', error: diagnostic, createdAt, startedAt, finishedAt, durationMs: 112100, jobTurnHref: '#repos/ws-a/chats/queue_job?turn=3&entry=run' }),
            run({ id: 'r1', runNumber: 1, status: 'cancelled' }),
            run({ id: 'r2', runNumber: 2, status: 'skipped', skipReason: 'gate-unavailable', createdAt }),
        ] })] });
        render(<SentinelRefrains owner={{ ...owner, ownerRoutingRef: 'remote:server:group-a' }} items={[]} onFollowLink={follow} />);
        const history = await screen.findByText('History (3)');
        fireEvent.click(history);
        await waitFor(() => expect(screen.queryByLabelText('Last run #3: failed. Show full error')).toBeNull());
        const list = screen.getByRole('list', { name: 'Run history for Daily review' });
        expect(within(list).getAllByRole('listitem').map(row => row.getAttribute('aria-label'))).toEqual(['Run #3', 'Run #2', 'Run #1']);
        expect(within(list).getByLabelText(`Finished: ${new Date(finishedAt).toLocaleString()}`)).toBeVisible();
        expect(within(list).getByLabelText('Duration: 112.1s')).toBeVisible();
        expect(screen.queryByText(createdAt)).toBeNull();
        const failed = within(list).getByLabelText('Select run #3: failed (manual)');
        fireEvent.click(failed);
        const detail = screen.getByRole('region', { name: 'Run details for Daily review' });
        for (const timestamp of [createdAt, startedAt, finishedAt]) expect(within(detail).getByText(timestamp)).toBeVisible();
        const error = within(detail).getByRole('region', { name: 'Error for run #3' });
        expect(error.textContent).toBe(diagnostic);
        expect(error).toHaveAttribute('tabindex', '0');
        const link = within(detail).getByRole('link', { name: 'Job turn' });
        expect(link).toHaveAttribute('href', '#repos/remote%3Aserver%3Agroup-a/chats/queue_job?turn=3&entry=run');
        fireEvent.click(link);
        expect(follow).toHaveBeenCalledWith(expect.anything(), 'sentinel-job:queue_job:?turn=3&entry=run');
        fireEvent.keyDown(error, { key: 'Escape' });
        await waitFor(() => expect(failed).toHaveFocus());
        expect(screen.queryByRole('region', { name: 'Error for run #3' })).toBeNull();
        const skipped = within(list).getByLabelText('Select run #2: skipped: gate unavailable (tool scripting off) (manual)');
        fireEvent.click(skipped);
        expect(within(detail).getByText('Skipped: gate unavailable (tool scripting off)')).toBeVisible();
        expect(history.parentElement).toHaveAttribute('open');
        expect(screen.getByText(/copilot \/ medium effort tier/)).toHaveTextContent('Next');
        fireEvent.click(history);
        await screen.findByLabelText('Last run #3: failed. Show full error');
        for (const mutation of [mock.start, mock.cancel, mock.update, mock.delete, mock.testGate, mock.resumeGate]) expect(mutation).not.toHaveBeenCalled();
    });
    it.each(['queued', 'running', 'completed', 'failed', 'cancelled', 'interrupted', 'skipped'] as const)(
        'keeps %s explicit in history with a created timestamp for unstarted runs', async status => {
            const createdAt = '2026-10-28T08:00:00Z';
            mock.list.mockResolvedValue({ jobs: [job({ runs: [run({ status, createdAt })] })] });
            view();
            fireEvent.click(await screen.findByText('History (1)'));
            const list = screen.getByRole('list', { name: 'Run history for Daily review' });
            expect(within(list).getByText(status, { exact: true })).toBeVisible();
            expect(within(list).getByLabelText(`Created: ${new Date(createdAt).toLocaleString()}`)).toBeVisible();
            fireEvent.click(within(list).getByLabelText(`Select run #1: ${status} (manual)`));
            const detail = screen.getByRole('region', { name: 'Run details for Daily review' });
            expect(within(detail).getByText(createdAt)).toBeVisible();
            expect(within(detail).queryByRole('link', { name: 'Job turn' })).toBeNull();
            expect(within(detail).queryByText('Started')).toBeNull();
            expect(within(detail).queryByText('Duration')).toBeNull();
        },
    );
    it('keeps active status visible alongside history and an empty history accessible without More', async () => {
        mock.list.mockResolvedValue({ jobs: [job({ activeRun: run({ status: 'queued' }) })] });
        view();
        const history = await screen.findByText('History (0)');
        expect(history).toBeVisible();
        expect(screen.getByRole('button', { name: 'Edit' })).not.toBeVisible();
        fireEvent.click(history);
        expect(screen.getByText('No runs yet.')).toBeVisible();
        expect(screen.getByText('Run #1 queued')).toBeVisible();
        expect(screen.getByRole('button', { name: 'Run now' })).toBeDisabled();
        expect(screen.getByRole('button', { name: 'Cancel', exact: true })).toBeVisible();
    });
    it('uses To-do arrow/Home/End focus navigation without selecting until activation', async () => {
        mock.list.mockResolvedValue({ jobs: [job({ runs: [run({ id: 'r2', runNumber: 2 }), run()] })] });
        view();
        fireEvent.click(await screen.findByText('History (2)'));
        const buttons = within(screen.getByRole('list', { name: 'Run history for Daily review' })).getAllByRole('button');
        buttons[0].focus();
        fireEvent.keyDown(buttons[0], { key: 'ArrowDown' });
        expect(buttons[1]).toHaveFocus();
        fireEvent.keyDown(buttons[1], { key: 'Home' });
        expect(buttons[0]).toHaveFocus();
        fireEvent.keyDown(buttons[0], { key: 'End' });
        expect(buttons[1]).toHaveFocus();
        fireEvent.keyDown(buttons[1], { key: 'ArrowUp' });
        expect(buttons[0]).toHaveFocus();
        for (const button of buttons) expect(button).toHaveAttribute('aria-pressed', 'false');
        fireEvent.click(buttons[0]);
        expect(buttons[0]).toHaveAttribute('aria-pressed', 'true');
    });
    it('uses narrow Back navigation with focus restoration and preserves selection across resizing', async () => {
        mock.width = 280;
        mock.list.mockResolvedValue({ jobs: [job({ runs: [run()] })] });
        const page = view();
        fireEvent.click(await screen.findByText('History (1)'));
        const list = screen.getByRole('list', { name: 'Run history for Daily review' });
        const button = within(list).getByRole('button');
        button.focus();
        fireEvent.click(button);
        const detail = screen.getByRole('region', { name: 'Run details for Daily review' });
        expect(list).not.toBeVisible();
        expect(within(detail).getByRole('heading')).toHaveFocus();
        fireEvent.click(within(detail).getByRole('button', { name: 'Back to runs' }));
        await waitFor(() => expect(button).toHaveFocus());
        expect(list).toBeVisible();
        expect(button).toHaveAttribute('aria-pressed', 'true');
        expect(detail).not.toBeVisible();
        fireEvent.click(button);
        mock.width = 800;
        page.rerender(<SentinelRefrains owner={owner} items={[]} onFollowLink={follow} />);
        expect(list).toBeVisible();
        expect(detail).toBeVisible();
        expect(within(detail).getByRole('button', { name: 'Back to runs', hidden: true })).not.toBeVisible();
        button.focus();
        mock.width = 280;
        page.rerender(<SentinelRefrains owner={owner} items={[]} onFollowLink={follow} />);
        expect(within(detail).getByRole('heading')).toHaveFocus();
        fireEvent.click(within(detail).getByRole('button', { name: 'Close run details' }));
        await waitFor(() => expect(button).toHaveFocus());
        expect(list).toBeVisible();
        expect(button).toHaveAttribute('aria-pressed', 'false');
    });
    it('retains the selected ID and refreshes its details when newer runs arrive, without selecting a pruned run', async () => {
        const first = run({ id: 'r1', status: 'failed', error: 'First error' });
        mock.list.mockResolvedValue({ jobs: [job({ runs: [first] })] });
        view();
        fireEvent.click(await screen.findByText('History (1)'));
        fireEvent.click(screen.getByLabelText('Select run #1: failed (manual)'));
        const options = mock.connect.mock.calls[0][0];
        const newer = run({ id: 'r2', runNumber: 2, status: 'completed' });
        mock.list.mockResolvedValue({ jobs: [job({ runs: [newer, { ...first, error: 'Updated error' }] })] });
        await act(async () => options.onMessage({ type: 'sentinel-jobs-changed', workspaceId: 'ws-a', processId: 'queue_sentinel' }));
        await screen.findByLabelText('Select run #2: completed (manual)');
        expect(screen.getByLabelText('Select run #1: failed (manual)')).toHaveAttribute('aria-pressed', 'true');
        expect(screen.getByRole('region', { name: 'Error for run #1' })).toHaveTextContent('Updated error');
        mock.list.mockResolvedValue({ jobs: [job({ runs: [newer] })] });
        await act(async () => options.onMessage({ type: 'sentinel-jobs-changed', workspaceId: 'ws-a', processId: 'queue_sentinel' }));
        await screen.findByText('This run is no longer in retained history. Select another run.');
        expect(screen.getByLabelText('Select run #2: completed (manual)')).toHaveAttribute('aria-pressed', 'false');
        expect(screen.queryByRole('region', { name: 'Error for run #1' })).toBeNull();
    });
    it.each(['workspace', 'process', 'server'] as const)('resets run selection when the %s owner changes', async change => {
        mock.route = { kind: 'remote', baseUrl: 'https://owner.test' };
        mock.list.mockResolvedValue({ jobs: [job({ runs: [run({ status: 'failed', error: 'Owner error' })] })] });
        const own = { ...owner, ownerRoutingRef: 'remote:server-a:ws-a' };
        const page = view(own);
        fireEvent.click(await screen.findByText('History (1)'));
        fireEvent.click(screen.getByLabelText('Select run #1: failed (manual)'));
        const next = change === 'workspace' ? { ...own, ownerWorkspaceId: 'ws-b', ownerRoutingRef: 'remote:server-a:ws-b' }
            : change === 'process' ? { ...own, processId: 'queue_other' } : { ...own, ownerRoutingRef: 'remote:server-b:ws-a' };
        page.rerender(<SentinelRefrains owner={next} items={[]} onFollowLink={follow} />);
        const history = await screen.findByText('History (1)');
        expect(history.parentElement).not.toHaveAttribute('open');
        fireEvent.click(history);
        expect(screen.getByLabelText('Select run #1: failed (manual)')).toHaveAttribute('aria-pressed', 'false');
        expect(screen.getByText('Select a run to view its details.')).toBeVisible();
        expect(screen.queryByRole('region', { name: 'Error for run #1' })).toBeNull();
    });
    it('uses owning-server feature policy even when local jobs are off', async () => {
        applyRuntimeConfigPatch({ sentinelEnabled: false, sentinelTodoJobsEnabled: false });
        mock.route = { kind: 'remote', baseUrl: 'https://example.invalid' };
        render(<SentinelRefrains owner={{ ...owner, ownerRoutingRef: 'remote:server:group-a' }} items={[]} onFollowLink={follow} />);
        await screen.findByText(/No refrains yet/);
        expect(mock.request).toHaveBeenCalledWith('/config/runtime', expect.objectContaining({ signal: expect.any(AbortSignal) }));
        expect(mock.refs).toContain('remote:server:group-a');
        expect(mock.list).toHaveBeenCalledWith('ws-a', 'queue_sentinel', expect.objectContaining({ signal: expect.any(AbortSignal) }));
    });
    it('keeps remote Jobs disabled even when local Jobs are enabled', async () => {
        mock.route = { kind: 'remote', baseUrl: 'https://example.invalid' };
        mock.request.mockResolvedValue({ features: { sentinelEnabled: true, sentinelTodoJobsEnabled: false, sentinelTodoScrubberEnabled: true } });
        view();
        await screen.findByRole('button', { name: 'Run now' });
        expect(screen.queryByRole('region', { name: 'Refrains' })).toBeNull();
        expect(mock.list).not.toHaveBeenCalled();
    });
    it('discards a late mutation result after switching to another Sentinel', async () => {
        mock.list.mockResolvedValue({ jobs: [job()] });
        const page = view();
        const start = deferred<SentinelRefrainRun>();
        mock.start.mockReturnValue(start.promise);
        fireEvent.click(await screen.findByRole('button', { name: 'Run now' }));
        mock.list.mockResolvedValue({ jobs: [] });
        page.rerender(<SentinelRefrains owner={{ ...owner, processId: 'queue_other' }} items={[]} onFollowLink={follow} />);
        await screen.findByText(/No refrains yet/);
        await act(async () => start.resolve(run()));
        expect(screen.queryByText('Daily review')).toBeNull();
        expect(mock.list).toHaveBeenCalledTimes(2);
        expect(mock.list.mock.calls[1].slice(0, 2)).toEqual(['ws-a', 'queue_other']);
    });
    it('does not fall back to local jobs on remote policy failure or unresolved ownership', async () => {
        mock.route = { kind: 'remote', baseUrl: 'https://example.invalid' };
        mock.request.mockRejectedValue(new Error('No connection'));
        const page = view();
        await screen.findByText(/Refrains unavailable: No connection/);
        expect(mock.list).not.toHaveBeenCalled();
        mock.route = { kind: 'unresolved-remote' };
        page.rerender(<SentinelRefrains owner={owner} items={[]} onFollowLink={follow} />);
        expect(screen.getByText(/owning server is not connected/)).toBeInTheDocument();
        expect(mock.list).not.toHaveBeenCalled();
    });
    it('filters owner events and unsubscribes/ignores late reads when the live flag is disabled', async () => {
        view();
        await screen.findByText(/No refrains yet/);
        const options = mock.connect.mock.calls[0][0];
        await act(async () => options.onMessage({ type: 'sentinel-jobs-changed', workspaceId: 'other', processId: owner.processId }));
        expect(mock.list).toHaveBeenCalledTimes(1);
        const pending = deferred<{ jobs: SentinelRefrain[] }>();
        mock.list.mockReturnValue(pending.promise);
        act(() => options.onMessage({ type: 'sentinel-jobs-changed', workspaceId: owner.ownerWorkspaceId, processId: owner.processId }));
        const close = mock.connect.mock.results[0].value.close;
        act(() => applyRuntimeConfigPatch({ sentinelTodoJobsEnabled: false }));
        expect(close).toHaveBeenCalledOnce();
        await act(async () => pending.resolve({ jobs: [job()] }));
        expect(screen.queryByText('Daily review')).toBeNull();
    });
    describe('gate scripts', () => {
        const gated = (patch: Partial<SentinelRefrain> = {}) => job({ cron: '0 * * * *', gateScript: 'return state;', ...patch });

        it('requires a cron for a gate script and saves the script with the schedule', async () => {
            view();
            await fillNew();
            const gate = screen.getByLabelText('Gate script (optional)');
            expect(screen.getByText(/Return a non-empty JSON value to start a run/)).toBeInTheDocument();
            fireEvent.change(gate, { target: { value: 'return { items: [1] };' } });
            expect(screen.getByRole('alert')).toHaveTextContent('A gate script needs a cron schedule.');
            expect(gate).toHaveAttribute('aria-invalid', 'true');
            expect(screen.getByRole('button', { name: 'Create refrain' })).toBeDisabled();
            fireEvent.change(screen.getByLabelText('Schedule preset'), { target: { value: '0 * * * *' } });
            expect(screen.queryByText('A gate script needs a cron schedule.')).toBeNull();
            fireEvent.click(screen.getByRole('button', { name: 'Create refrain' }));
            await waitFor(() => expect(mock.create).toHaveBeenCalledWith('ws-a', 'queue_sentinel', expect.objectContaining({
                cron: '0 * * * *', gateScript: 'return { items: [1] };',
            })));
        });
        it('ignores a blank gate when validating a manual job', async () => {
            view();
            await fillNew();
            fireEvent.change(screen.getByLabelText('Gate script (optional)'), { target: { value: '  \n ' } });
            expect(screen.queryByText('A gate script needs a cron schedule.')).toBeNull();
            fireEvent.click(screen.getByRole('button', { name: 'Create refrain' }));
            await waitFor(() => expect(mock.create).toHaveBeenCalledWith('ws-a', 'queue_sentinel', expect.objectContaining({ cron: '', gateScript: '' })));
        });
        it('resends an unchanged script as stored and clears a removed one', async () => {
            const script = 'return state;\n';
            mock.list.mockResolvedValue({ jobs: [gated({ gateScript: script })] });
            view();
            await openActions();
            fireEvent.click(await screen.findByRole('button', { name: 'Edit' }));
            expect(screen.getByLabelText('Gate script (optional)')).toHaveValue(script);
            fireEvent.click(screen.getByRole('button', { name: 'Save refrain' }));
            await waitFor(() => expect(mock.update).toHaveBeenCalledWith('ws-a', 'queue_sentinel', 'j1', expect.objectContaining({ gateScript: script })));
            await openActions();
            fireEvent.click(await screen.findByRole('button', { name: 'Edit' }));
            fireEvent.change(screen.getByLabelText('Gate script (optional)'), { target: { value: '' } });
            fireEvent.change(screen.getByLabelText('Schedule preset'), { target: { value: 'manual' } });
            fireEvent.click(screen.getByRole('button', { name: 'Save refrain' }));
            await waitFor(() => expect(mock.update).toHaveBeenLastCalledWith('ws-a', 'queue_sentinel', 'j1', expect.objectContaining({ gateScript: '', cron: '' })));
        });
        it('shows an active gate with its last result and no gate controls for ungated jobs', async () => {
            mock.list.mockResolvedValue({ jobs: [gated({ gateLastResult: '{"items":[1]}' }), job({ id: 'j2', name: 'Plain' })] });
            view();
            const card = await screen.findByRole('article', { name: 'Daily review' });
            expect(within(card).getByText('Gate active')).toBeInTheDocument();
            expect(within(card).getByText('{"items":[1]}')).toBeInTheDocument();
            expect(within(card).queryByRole('button', { name: 'Resume gate' })).toBeNull();
            const plain = screen.getByRole('article', { name: 'Plain' });
            expect(within(plain).queryByTestId('sentinel-refrain-gate')).toBeNull();
            expect(within(plain).queryByRole('button', { name: 'Test gate' })).toBeNull();
        });
        it('truncates a long last result preview and keeps the full JSON as its title', async () => {
            const long = JSON.stringify({ items: Array.from({ length: 80 }, (_, i) => i) });
            mock.list.mockResolvedValue({ jobs: [gated({ gateLastResult: long })] });
            view();
            const line = await screen.findByText(/Last gate result/);
            expect(line).toHaveAttribute('title', long);
            expect(line.textContent).toContain('…');
            expect(line.textContent!.length).toBeLessThan(long.length);
        });
        it('tests the gate inline without starting a run or reloading jobs', async () => {
            mock.list.mockResolvedValue({ jobs: [gated()] });
            const pending = deferred<SentinelRefrainGateTest>();
            mock.testGate.mockReturnValue(pending.promise);
            view();
            fireEvent.click(await screen.findByRole('button', { name: 'Test gate' }));
            expect(mock.testGate).toHaveBeenCalledExactlyOnceWith('ws-a', 'queue_sentinel', 'j1', { signal: expect.any(AbortSignal) });
            expect(screen.getByRole('button', { name: 'Testing gate...' })).toBeDisabled();
            expect(screen.getByRole('button', { name: 'Run now' })).not.toBeDisabled();
            await act(async () => pending.resolve({ ok: true, result: '{"items":[1]}', empty: false }));
            const status = screen.getByText(/a tick would start a run/).closest('[role="status"]') as HTMLElement;
            expect(within(status).getByText('{"items":[1]}')).toBeInTheDocument();
            expect(mock.start).not.toHaveBeenCalled();
            expect(mock.update).not.toHaveBeenCalled();
            expect(mock.list).toHaveBeenCalledTimes(1);
            mock.testGate.mockResolvedValue({ ok: true, result: '[]', empty: true });
            fireEvent.click(screen.getByRole('button', { name: 'Test gate' }));
            await screen.findByText(/a tick would skip/);
            expect(screen.queryByText(/a tick would start a run/)).toBeNull();
        });
        it('shows gate failures and rejected tests inline', async () => {
            mock.list.mockResolvedValue({ jobs: [gated()] });
            mock.testGate.mockResolvedValue({ ok: false, error: 'Gate script exceeded its 60-second deadline' });
            view();
            fireEvent.click(await screen.findByRole('button', { name: 'Test gate' }));
            expect(await screen.findByRole('alert')).toHaveTextContent('Gate test failed: Gate script exceeded its 60-second deadline');
            mock.testGate.mockRejectedValue(Object.assign(new Error('Gate scripts need tool scripting (features.toolScripting)'), { status: 409 }));
            fireEvent.click(screen.getByRole('button', { name: 'Test gate' }));
            await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Gate test failed: Gate scripts need tool scripting'));
            expect(screen.queryByText(/Refrain changed/)).toBeNull();
        });
        it('shows a paused gate with its last error, still tests it, and resumes it', async () => {
            mock.list.mockResolvedValue({ jobs: [gated({ gatePaused: true, gateConsecutiveFailures: 5,
                gateLastError: { message: 'boom', at: '2026-10-18T12:00:00Z' } })] });
            mock.testGate.mockResolvedValue({ ok: true, result: 'null', empty: true });
            view();
            const card = await screen.findByRole('article', { name: 'Daily review' });
            expect(within(card).getByText(/Gate paused after 5 failures in a row/)).toBeInTheDocument();
            expect(within(card).getByText(/Last gate error/)).toHaveTextContent('boom');
            fireEvent.click(within(card).getByRole('button', { name: 'Test gate' }));
            await screen.findByText(/a tick would skip/);
            expect(mock.resumeGate).not.toHaveBeenCalled();
            mock.list.mockResolvedValue({ jobs: [gated({ gateLastError: { message: 'boom', at: '2026-10-18T12:00:00Z' } })] });
            fireEvent.click(within(card).getByRole('button', { name: 'Resume gate' }));
            await waitFor(() => expect(mock.resumeGate).toHaveBeenCalledExactlyOnceWith('ws-a', 'queue_sentinel', 'j1'));
            await screen.findByText('Gate active');
            expect(screen.queryByRole('button', { name: 'Resume gate' })).toBeNull();
            expect(mock.update).not.toHaveBeenCalled();
        });
        it('shows the failure streak on an active gate', async () => {
            mock.list.mockResolvedValue({ jobs: [gated({ gateConsecutiveFailures: 2, gateLastError: { message: 'bad JSON', at: '2026-10-18T12:00:00Z' } })] });
            view();
            expect(await screen.findByText('Gate active · 2 failed in a row')).toBeInTheDocument();
            expect(screen.getByText(/Last gate error/)).toHaveTextContent('bad JSON');
        });
        it('discards a running test when the script changes or the panel unmounts', async () => {
            mock.list.mockResolvedValue({ jobs: [gated()] });
            const first = deferred<SentinelRefrainGateTest>();
            mock.testGate.mockReturnValue(first.promise);
            const page = view();
            fireEvent.click(await screen.findByRole('button', { name: 'Test gate' }));
            const signal = mock.testGate.mock.calls[0][3].signal as AbortSignal;
            const options = mock.connect.mock.calls[0][0];
            mock.list.mockResolvedValue({ jobs: [gated({ gateScript: 'return null;', revision: 3 })] });
            await act(async () => options.onMessage({ type: 'sentinel-jobs-changed', workspaceId: 'ws-a', processId: 'queue_sentinel' }));
            await waitFor(() => expect(signal.aborted).toBe(true));
            expect(screen.getByRole('button', { name: 'Test gate' })).not.toBeDisabled();
            await act(async () => first.resolve({ ok: true, result: '{"stale":true}', empty: false }));
            expect(screen.queryByText('{"stale":true}')).toBeNull();
            const second = deferred<SentinelRefrainGateTest>();
            mock.testGate.mockReturnValue(second.promise);
            fireEvent.click(screen.getByRole('button', { name: 'Test gate' }));
            const secondSignal = mock.testGate.mock.calls[1][3].signal as AbortSignal;
            page.unmount();
            expect(secondSignal.aborted).toBe(true);
        });
        it('labels gate skips apart from overlap skips in history and the last run', async () => {
            mock.list.mockResolvedValue({ jobs: [gated({ runs: [
                run({ id: 'r3', runNumber: 3, status: 'skipped', trigger: 'schedule', skipReason: 'gate-unavailable' }),
                run({ id: 'r2', runNumber: 2, status: 'skipped', trigger: 'schedule', skipReason: 'gate-empty' }),
                run({ id: 'r1', runNumber: 1, status: 'skipped', trigger: 'schedule', skipReason: 'overlap' }),
            ] })] });
            view();
            expect(await screen.findByText('Last run #3: skipped: gate unavailable (tool scripting off)')).toBeInTheDocument();
            await openActions();
            fireEvent.click(screen.getByText('History (3)'));
            expect(screen.getByLabelText('Select run #2: skipped: gate result empty (schedule)')).toBeVisible();
            expect(screen.getByLabelText('Select run #1: skipped: overlap (schedule)')).toBeVisible();
            expect(screen.getByLabelText('Select run #3: skipped: gate unavailable (tool scripting off) (schedule)')).toBeVisible();
        });
    });
    describe('effort tiers', () => {
        async function openNew() {
            fireEvent.click(await screen.findByRole('button', { name: 'New refrain' }));
            fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Daily audit' } });
            fireEvent.change(screen.getByLabelText('Instructions'), { target: { value: 'Review pending work.' } });
        }
        const pickTier = (label: string) => {
            fireEvent.click(screen.getByTestId('effort-tier-trigger-btn'));
            fireEvent.click(screen.getByRole('option', { name: new RegExp(`^${label}`) }));
        };

        it('replaces Model and Effort with the shared tier selector and saves only the tier', async () => {
            applyRuntimeConfigPatch({ effortLevelsEnabled: true });
            view();
            await openNew();
            expect(screen.queryByLabelText('Model')).toBeNull();
            expect(screen.queryByLabelText('Effort')).toBeNull();
            expect(screen.getByTestId('effort-tier-trigger-btn')).toHaveAccessibleName('Effort tier: Medium');
            pickTier('High');
            fireEvent.click(screen.getByRole('button', { name: 'Create refrain' }));
            await waitFor(() => expect(mock.create).toHaveBeenCalledTimes(1));
            const input = mock.create.mock.calls[0][2];
            expect(input).toMatchObject({ provider: 'copilot', effortTier: 'high' });
            expect(input).not.toHaveProperty('model');
            expect(input).not.toHaveProperty('effort');
        });
        it.each([undefined, 'https://owner.test'])('opens tier settings for the owning server (%s) without saving', async baseUrl => {
            const previousHash = window.location.hash;
            try {
                applyRuntimeConfigPatch({ effortLevelsEnabled: true });
                if (baseUrl) {
                    mock.route = { kind: 'remote', baseUrl };
                    mock.request.mockResolvedValue({ features: { sentinelEnabled: true, sentinelTodoJobsEnabled: true, effortLevelsEnabled: true } });
                }
                view(baseUrl ? { ...owner, ownerRoutingRef: 'remote:server:ws-a' } : owner);
                await openNew();
                fireEvent.change(screen.getByLabelText('Provider'), { target: { value: 'codex' } });
                fireEvent.click(screen.getByTestId('effort-tier-trigger-btn'));
                fireEvent.click(screen.getByRole('button', { name: 'Configure tiers…' }));
                const [route, query] = window.location.hash.split('?');
                expect(route).toBe('#admin/agents');
                const params = new URLSearchParams(query);
                expect(params.get('section')).toBe('effort-tiers');
                expect(params.get('provider')).toBe('codex');
                expect(params.get('owner')).toBe(baseUrl ?? null);
                expect(screen.getByLabelText('Name')).toHaveValue('Daily audit');
                expect(screen.getByLabelText('Instructions')).toHaveValue('Review pending work.');
                expect(mock.create).not.toHaveBeenCalled();
                expect(mock.update).not.toHaveBeenCalled();
            } finally {
                window.location.hash = previousHash;
            }
        });
        it('waits for owner tiers before saving', async () => {
            applyRuntimeConfigPatch({ effortLevelsEnabled: true });
            mock.tiersLoading = true;
            view();
            await openNew();
            expect(screen.queryByLabelText('Model')).toBeNull();
            expect(screen.getByRole('button', { name: 'Create refrain' })).toBeDisabled();
        });
        it('resolves tiers for a changed provider and resets the selection', async () => {
            applyRuntimeConfigPatch({ effortLevelsEnabled: true });
            view();
            await openNew();
            pickTier('High');
            fireEvent.change(screen.getByLabelText('Provider'), { target: { value: 'codex' } });
            expect(mock.tierReads.at(-1)?.[0]).toBe('codex');
            expect(screen.getByTestId('effort-tier-trigger-btn')).toHaveAccessibleName('Effort tier: Medium');
            fireEvent.click(screen.getByRole('button', { name: 'Create refrain' }));
            await waitFor(() => expect(mock.create).toHaveBeenCalledWith('ws-a', 'queue_sentinel',
                expect.objectContaining({ provider: 'codex', effortTier: 'medium' })));
        });
        it('falls back to Model and Effort when the provider has no tiers', async () => {
            applyRuntimeConfigPatch({ effortLevelsEnabled: true });
            mock.tiers = {};
            view();
            await fillNew();
            expect(screen.queryByTestId('effort-tier-trigger-btn')).toBeNull();
            fireEvent.click(screen.getByRole('button', { name: 'Create refrain' }));
            await waitFor(() => expect(mock.create).toHaveBeenCalledWith('ws-a', 'queue_sentinel',
                expect.objectContaining({ model: 'test-model', effort: '', effortTier: '' })));
        });
        it('edits a stored tier and maps a legacy model job to its matching tier', async () => {
            applyRuntimeConfigPatch({ effortLevelsEnabled: true });
            mock.list.mockResolvedValue({ jobs: [job({ id: 'j1', name: 'Tiered', model: undefined, effortTier: 'low' }),
                job({ id: 'j2', name: 'Legacy', model: 'cp-high', effort: 'high' })] });
            view();
            await openActions();
            fireEvent.click(within(await screen.findByRole('article', { name: 'Tiered' })).getByRole('button', { name: 'Edit' }));
            expect(screen.getByTestId('effort-tier-trigger-btn')).toHaveAccessibleName('Effort tier: Low');
            fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
            await openActions();
            fireEvent.click(within(screen.getByRole('article', { name: 'Legacy' })).getByRole('button', { name: 'Edit' }));
            expect(screen.getByTestId('effort-tier-trigger-btn')).toHaveAccessibleName('Effort tier: High');
            fireEvent.click(screen.getByRole('button', { name: 'Save refrain' }));
            await waitFor(() => expect(mock.update).toHaveBeenCalledTimes(1));
            const input = mock.update.mock.calls[0][3];
            expect(input).toMatchObject({ effortTier: 'high', expectedRevision: 2 });
            expect(input).not.toHaveProperty('model');
        });
        it('keeps explicit Model and Effort and clears a stored tier when tiers are disabled', async () => {
            mock.list.mockResolvedValue({ jobs: [job({ model: undefined, effortTier: 'high' })] });
            view();
            await openActions();
            fireEvent.click(await screen.findByRole('button', { name: 'Edit' }));
            expect(screen.queryByTestId('effort-tier-trigger-btn')).toBeNull();
            expect(screen.getByRole('button', { name: 'Save refrain' })).toBeDisabled();
            fireEvent.change(screen.getByLabelText('Model'), { target: { value: 'test-model' } });
            fireEvent.change(screen.getByLabelText('Effort'), { target: { value: 'low' } });
            fireEvent.click(screen.getByRole('button', { name: 'Save refrain' }));
            await waitFor(() => expect(mock.update).toHaveBeenCalledWith('ws-a', 'queue_sentinel', 'j1',
                expect.objectContaining({ model: 'test-model', effort: 'low', effortTier: '' })));
        });
        it('uses the remote owner flag and tier source, not the page flag', async () => {
            applyRuntimeConfigPatch({ effortLevelsEnabled: false });
            mock.route = { kind: 'remote', baseUrl: 'https://example.invalid' };
            mock.request.mockResolvedValue({ features: { sentinelEnabled: true, sentinelTodoJobsEnabled: true, effortLevelsEnabled: true } });
            render(<SentinelRefrains owner={{ ...owner, ownerRoutingRef: 'remote:server:ws-a' }} items={[]} onFollowLink={follow} />);
            await openNew();
            expect(screen.getByTestId('effort-tier-trigger-btn')).toBeInTheDocument();
            expect(mock.tierReads.at(-1)).toEqual(['copilot', 'https://example.invalid', client]);
        });
        it('keeps Model and Effort for a remote owner with tiers off while the page flag is on', async () => {
            applyRuntimeConfigPatch({ effortLevelsEnabled: true });
            mock.route = { kind: 'remote', baseUrl: 'https://example.invalid' };
            mock.request.mockResolvedValue({ features: { sentinelEnabled: true, sentinelTodoJobsEnabled: true, effortLevelsEnabled: false } });
            render(<SentinelRefrains owner={{ ...owner, ownerRoutingRef: 'remote:server:ws-a' }} items={[]} onFollowLink={follow} />);
            await openNew();
            expect(screen.queryByTestId('effort-tier-trigger-btn')).toBeNull();
            expect(screen.getByLabelText('Model')).toBeInTheDocument();
        });
        it('shows the stored tier on the job row', async () => {
            mock.list.mockResolvedValue({ jobs: [job({ model: undefined, effortTier: 'high' })] });
            view();
            expect(await screen.findByText(/copilot \/ high effort tier/)).toBeInTheDocument();
        });
    });
});

describe('Refrains section collapse under the dashboard stylesheet', () => {
    let style: HTMLStyleElement;
    beforeEach(() => {
        // Tailwind 3 preflight followed by an equal-specificity display utility, in dashboard stylesheet order.
        style = document.createElement('style');
        style.textContent = '[hidden]:where(:not([hidden="until-found"])) { display: none; }\n.flex { display: flex; }';
        document.head.append(style);
        mock.list.mockResolvedValue({ jobs: [job()] });
    });
    afterEach(() => style.remove());
    const toggle = () => screen.getByRole('button', { name: /Refrains \(1\/10\)/ });
    // jest-dom's toBeVisible treats every [hidden] element as invisible, so read the cascaded display instead.
    const rendered = (element: Element) => {
        for (let node: Element | null = element; node; node = node.parentElement) if (getComputedStyle(node).display === 'none') return false;
        return true;
    };

    it('hides and shows the contents by pointer, Enter and Space, with the chevron and aria-expanded matching', async () => {
        const user = userEvent.setup();
        view();
        const row = await screen.findByTestId('sentinel-refrain-j1');
        const info = screen.getByRole('button', { name: 'About Refrains' });
        expect(toggle()).toHaveAttribute('aria-expanded', 'true');
        expect(toggle()).toHaveTextContent('\u25be Refrains (1/10)');
        expect(rendered(row)).toBe(true);

        await user.click(toggle());
        expect(toggle()).toHaveAttribute('aria-expanded', 'false');
        expect(toggle()).toHaveTextContent('\u25b8 Refrains (1/10)');
        expect(rendered(row)).toBe(false);

        await user.keyboard('{Enter}');
        expect(toggle()).toHaveFocus();
        expect(toggle()).toHaveAttribute('aria-expanded', 'true');
        expect(rendered(row)).toBe(true);
        await user.keyboard(' ');
        expect(toggle()).toHaveAttribute('aria-expanded', 'false');
        expect(rendered(row)).toBe(false);
        expect(screen.getByTestId('sentinel-refrain-j1')).toBe(row); // collapsed contents stay mounted

        // Adjacent heading controls stay outside the toggle, visible and inert to it.
        expect(toggle().contains(info)).toBe(false);
        expect(toggle().querySelector('button, a, input, select, textarea')).toBeNull();
        expect(rendered(screen.getByRole('button', { name: 'New refrain' }))).toBe(true);
        await user.click(info);
        expect(toggle()).toHaveAttribute('aria-expanded', 'false');
        await user.keyboard('{Escape}');
        await user.click(screen.getByRole('button', { name: 'New refrain' }));
        expect(toggle()).toHaveAttribute('aria-expanded', 'false');
    });

    it('stays collapsed across owner reloads and parent rerenders, and does not leak to another owner', async () => {
        const page = view();
        await screen.findByTestId('sentinel-refrain-j1');
        fireEvent.click(toggle());
        mock.list.mockResolvedValue({ jobs: [job({ name: 'Renamed' })] });
        const options = mock.connect.mock.calls[0][0];
        await act(async () => options.onMessage({ type: 'sentinel-jobs-changed', workspaceId: owner.ownerWorkspaceId, processId: owner.processId }));
        await waitFor(() => expect(screen.getByTestId('sentinel-refrain-j1')).toHaveAttribute('aria-label', 'Renamed'));
        page.rerender(<SentinelRefrains owner={{ ...owner }} items={[]} onFollowLink={follow} />);
        expect(toggle()).toHaveAttribute('aria-expanded', 'false');
        expect(rendered(screen.getByTestId('sentinel-refrain-j1'))).toBe(false);

        page.rerender(<SentinelRefrains owner={{ ownerWorkspaceId: 'ws-b', processId: 'queue_other' }} items={[]} onFollowLink={follow} />);
        await waitFor(() => expect(mock.list).toHaveBeenLastCalledWith('ws-b', 'queue_other', expect.anything()));
        await waitFor(() => expect(rendered(screen.getByTestId('sentinel-refrain-j1'))).toBe(true));
        expect(toggle()).toHaveAttribute('aria-expanded', 'true');
    });
});

/** Mirrors UnifiedTodoTab's shared detail column: one active key, a portal target and narrow detail state. */
function DetailHost({ wide = true, calls, children }: { wide?: boolean; calls: string[][]; children: ReactNode }) {
    const [target, setTarget] = useState<HTMLDivElement | null>(null);
    const [activeJobId, setActiveJobId] = useState<string | null>(null);
    const [detailOpen, setDetailOpen] = useState(false);
    const activeRef = useRef(activeJobId);
    activeRef.current = activeJobId;
    // Stable like UnifiedTodoTab's callbacks: unmount cleanups key on `leave`.
    const select = useCallback((jobId: string) => { calls.push(['select', jobId]); setActiveJobId(jobId); setDetailOpen(true); }, [calls]);
    const leave = useCallback((jobId: string, clear: boolean) => {
        if (activeRef.current !== jobId) return;
        calls.push(['leave', jobId, String(clear)]);
        if (clear) setActiveJobId(null);
        setDetailOpen(false);
    }, [calls]);
    const value = useMemo(() => ({ target, wide, activeJobId, detailOpen, select, leave }), [target, wide, activeJobId, detailOpen, select, leave]);
    return <RefrainHistoryHostContext.Provider value={value}>
        <div data-testid="host-list" hidden={!wide && detailOpen && activeJobId !== null}>{children}</div>
        <div ref={setTarget} data-testid="host-target" hidden={activeJobId === null || (!wide && !detailOpen)} />
    </RefrainHistoryHostContext.Provider>;
}

describe('Refrain card details', () => {
    const noMutations = () => {
        for (const mutation of [mock.create, mock.start, mock.update, mock.delete, mock.cancel, mock.testGate, mock.resumeGate,
            mock.scrubStart, mock.scrubUpdate]) expect(mutation).not.toHaveBeenCalled();
    };
    it('shows definition, schedule and status for a never-run refrain from the title', async () => {
        mock.list.mockResolvedValue({ jobs: [job({ cron: '0 14 * * *', nextRunAt: '2026-11-02T14:00:00Z', mode: 'autopilot', effortTier: 'medium' })] });
        view();
        const title = await screen.findByRole('button', { name: 'Show details for Daily review' });
        const card = screen.getByRole('article', { name: 'Daily review' });
        expect(title).toHaveAttribute('aria-pressed', 'false');
        expect(card).toHaveAttribute('data-selected', 'false');
        expect(title.querySelector('button, a, input, select, textarea, summary')).toBeNull();
        fireEvent.click(title);
        const detail = screen.getByRole('region', { name: 'Refrain details for Daily review' });
        expect(title).toHaveAttribute('aria-pressed', 'true');
        expect(card).toHaveAttribute('data-selected', 'true');
        expect(title).toHaveAttribute('aria-controls', detail.id);
        expect(within(detail).getByRole('heading', { name: 'Daily review' })).toBeVisible();
        expect(within(detail).getByText('Enabled · Autopilot')).toBeVisible();
        expect(within(detail).getByText('0 14 * * *')).toBeVisible();
        expect(within(detail).getByText('Next run')).toBeVisible();
        expect(within(detail).getByText(/copilot \/ medium effort tier/)).toBeVisible();
        expect(within(detail).getByRole('region', { name: 'Instructions for Daily review' })).toHaveTextContent('Review the snapshot.');
        expect(within(detail).getByRole('heading', { name: 'No runs yet' })).toBeVisible();
        expect(within(detail).getByRole('link', { name: 'Open chat' })).toHaveAttribute('href', '#repos/ws-a/chats/queue_job');
        expect(screen.getByText('History (0)').parentElement).toHaveAttribute('open');
        noMutations();
    });
    it.each([
        { state: 'queued', patch: { activeRun: run({ id: 'r8', runNumber: 8, status: 'queued' }) }, heading: 'Current run #8: queued' },
        { state: 'running', patch: { activeRun: run({ id: 'r8', runNumber: 8, status: 'running', startedAt: '2026-11-01T14:00:01Z' }),
            runs: [run({ id: 'r8', runNumber: 8 }), run({ id: 'r7', runNumber: 7, status: 'completed' })] }, heading: 'Current run #8: running' },
        { state: 'completed', patch: { latestRun: run({ id: 'r7', runNumber: 7, status: 'completed', durationMs: 2000 }),
            runs: [run({ id: 'r7', runNumber: 7, status: 'completed', durationMs: 2000 })] }, heading: 'Latest run #7: completed' },
        { state: 'failed', patch: { runs: [run({ id: 'r2', runNumber: 2, status: 'failed', error: 'Boom' }), run({ status: 'completed' })] },
            heading: 'Latest run #2: failed' },
    ] as const)('shows the current or latest run for a $state refrain', async ({ patch, heading, state }) => {
        mock.list.mockResolvedValue({ jobs: [job(patch as Partial<SentinelRefrain>)] });
        view();
        fireEvent.click(await screen.findByRole('button', { name: 'Show details for Daily review' }));
        const detail = screen.getByRole('region', { name: 'Refrain details for Daily review' });
        expect(within(detail).getByRole('heading', { name: heading })).toBeVisible();
        if (state === 'running') expect(within(detail).getByText('2026-11-01T14:00:01Z')).toBeVisible();
        if (state === 'completed') expect(within(detail).getByText('2.0s')).toBeVisible();
        if (state === 'failed') expect(within(detail).getByRole('region', { name: 'Error for run #2' })).toHaveTextContent('Boom');
        noMutations();
    });
    it('follows live run updates while the refrain stays selected', async () => {
        mock.list.mockResolvedValue({ jobs: [job({ activeRun: run({ id: 'r8', runNumber: 8 }), runs: [run({ id: 'r8', runNumber: 8 })] })] });
        view();
        fireEvent.click(await screen.findByRole('button', { name: 'Show details for Daily review' }));
        await screen.findByRole('heading', { name: 'Current run #8: running' });
        const finished = run({ id: 'r8', runNumber: 8, status: 'completed', finishedAt: '2026-11-01T14:05:00Z' });
        mock.list.mockResolvedValue({ jobs: [job({ latestRun: finished, runs: [finished] })] });
        const options = mock.connect.mock.calls[0][0];
        await act(async () => options.onMessage({ type: 'sentinel-jobs-changed', workspaceId: 'ws-a', processId: 'queue_sentinel' }));
        await screen.findByRole('heading', { name: 'Latest run #8: completed' });
        expect(screen.getByRole('button', { name: 'Show details for Daily review' })).toHaveAttribute('aria-pressed', 'true');
        expect(screen.getByText('2026-11-01T14:05:00Z')).toBeVisible();
    });
    it('selects from blank card space but not from controls, disclosures or text selection', async () => {
        mock.list.mockResolvedValue({ jobs: [job({ runs: [run({ status: 'completed' })] })] });
        view();
        const card = await screen.findByRole('article', { name: 'Daily review' });
        fireEvent.click(screen.getByLabelText('More actions for Daily review'));
        fireEvent.click(screen.getByText('History (1)'));
        fireEvent.click(screen.getByRole('button', { name: 'Pause' }));
        await waitFor(() => expect(mock.update).toHaveBeenCalledTimes(1));
        fireEvent.click(screen.getByLabelText('Select run #1: completed (manual)'));
        expect(card).toHaveAttribute('data-selected', 'false');
        expect(screen.getByRole('region', { name: 'Run details for Daily review' })).toBeVisible();
        // A click inside the run details (same React tree) keeps the exact run selection.
        fireEvent.click(screen.getByRole('heading', { name: 'Run #1: completed' }));
        expect(screen.getByLabelText('Select run #1: completed (manual)')).toHaveAttribute('aria-pressed', 'true');
        const selection = vi.spyOn(window, 'getSelection').mockReturnValue({ toString: () => 'copilot' } as Selection);
        fireEvent.click(screen.getByText(/copilot \/ test-model/));
        expect(card).toHaveAttribute('data-selected', 'false');
        selection.mockRestore();
        fireEvent.click(screen.getByText(/copilot \/ test-model/));
        expect(card).toHaveAttribute('data-selected', 'true');
        expect(screen.getByLabelText('Select run #1: completed (manual)')).toHaveAttribute('aria-pressed', 'false');
        expect(mock.start).not.toHaveBeenCalled();
    });
    it('opens with Enter and Space, switches to exact history runs, and keeps the overview when history collapses', async () => {
        const user = userEvent.setup();
        mock.list.mockResolvedValue({ jobs: [job({ runs: [run({ id: 'r2', runNumber: 2, status: 'failed' }), run({ status: 'completed' })] })] });
        view();
        const title = await screen.findByRole('button', { name: 'Show details for Daily review' });
        title.focus();
        await user.keyboard('{Enter}');
        expect(title).toHaveAttribute('aria-pressed', 'true');
        fireEvent.click(screen.getByLabelText('Select run #1: completed (manual)'));
        expect(title).toHaveAttribute('aria-pressed', 'false');
        expect(screen.getByRole('heading', { name: 'Run #1: completed' })).toBeVisible();
        title.focus();
        await user.keyboard(' ');
        expect(title).toHaveAttribute('aria-pressed', 'true');
        expect(screen.getByLabelText('Select run #1: completed (manual)')).toHaveAttribute('aria-pressed', 'false');
        const history = screen.getByText('History (2)');
        fireEvent.click(history);
        await waitFor(() => expect(history.parentElement).not.toHaveAttribute('open'));
        expect(title).toHaveAttribute('aria-pressed', 'true');
        fireEvent.keyDown(screen.getByRole('heading', { name: 'Daily review' }), { key: 'Escape' });
        await waitFor(() => expect(title).toHaveFocus());
        expect(title).toHaveAttribute('aria-pressed', 'false');
        expect(mock.start).not.toHaveBeenCalled();
    });
    it('renders into the hosted detail column and ignores clicks bubbling back through the portal', async () => {
        const calls: string[][] = [];
        mock.list.mockResolvedValue({ jobs: [job(), job({ id: 'j2', name: 'Weekly sweep', processId: 'queue_job2' })] });
        render(<DetailHost calls={calls}><SentinelRefrains owner={{ ...owner, ownerRoutingRef: 'remote:server:ws-a' }} items={[]} onFollowLink={follow} /></DetailHost>);
        fireEvent.click(await screen.findByRole('button', { name: 'Show details for Daily review' }));
        const target = screen.getByTestId('host-target');
        const detail = within(target).getByRole('region', { name: 'Refrain details for Daily review' });
        // Hosted details never need the history disclosure.
        expect(within(screen.getByRole('article', { name: 'Daily review' })).getByText('History (0)').parentElement).not.toHaveAttribute('open');
        fireEvent.click(within(detail).getByText('Schedule'));
        fireEvent.click(within(detail).getByRole('heading', { name: 'Daily review' }));
        expect(calls).toEqual([['select', 'j1']]);
        const link = within(detail).getByRole('link', { name: 'Open chat' });
        expect(link).toHaveAttribute('href', '#repos/remote%3Aserver%3Aws-a/chats/queue_job');
        fireEvent.click(link);
        expect(follow).toHaveBeenCalledWith(expect.anything(), 'sentinel-job:queue_job:');
        expect(calls).toEqual([['select', 'j1']]);
        fireEvent.click(screen.getByRole('button', { name: 'Show details for Weekly sweep' }));
        expect(within(target).getByRole('region', { name: 'Refrain details for Weekly sweep' })).toBeVisible();
        expect(within(target).queryByRole('region', { name: 'Refrain details for Daily review' })).toBeNull();
        expect(screen.getByRole('button', { name: 'Show details for Daily review' })).toHaveAttribute('aria-pressed', 'false');
        noMutations();
    });
    it('uses narrow hosted Back navigation with focus on the heading and back on the title', async () => {
        const calls: string[][] = [];
        mock.list.mockResolvedValue({ jobs: [job()] });
        render(<DetailHost wide={false} calls={calls}><SentinelRefrains owner={owner} items={[]} onFollowLink={follow} /></DetailHost>);
        const title = await screen.findByRole('button', { name: 'Show details for Daily review' });
        title.focus();
        fireEvent.click(title);
        const target = screen.getByTestId('host-target');
        expect(screen.getByTestId('host-list')).not.toBeVisible();
        expect(within(target).getByRole('heading', { name: 'Daily review' })).toHaveFocus();
        fireEvent.click(within(target).getByRole('button', { name: 'Back to list' }));
        expect(calls).toEqual([['select', 'j1'], ['leave', 'j1', 'false']]);
        await waitFor(() => expect(title).toHaveFocus());
        expect(title).toHaveAttribute('aria-pressed', 'true');
        expect(target).not.toBeVisible();
    });
    it('shows the built-in Coda row details in the same hosted column', async () => {
        const calls: string[][] = [];
        applyRuntimeConfigPatch({ sentinelTodoScrubberEnabled: true });
        mock.list.mockResolvedValue({ jobs: [job()] });
        render(<DetailHost calls={calls}><SentinelRefrains owner={owner} items={[]} onFollowLink={follow} /></DetailHost>);
        const coda = await screen.findByRole('button', { name: 'Show details for Coda' });
        await screen.findByText(/Every day at 09:00|0 9 \* \* \*/);
        fireEvent.click(coda);
        const target = screen.getByTestId('host-target');
        const detail = within(target).getByRole('region', { name: 'Details for Coda · built-in' });
        expect(within(detail).getByText('No Coda runs yet. Use Run now to start the first review.')).toBeVisible();
        fireEvent.click(screen.getByRole('button', { name: 'Show details for Daily review' }));
        expect(within(target).queryByRole('region', { name: 'Details for Coda · built-in' })).toBeNull();
        expect(coda).toHaveAttribute('aria-pressed', 'false');
        expect(calls).toEqual([['select', 'coda'], ['select', 'j1']]);
        noMutations();
    });
});
