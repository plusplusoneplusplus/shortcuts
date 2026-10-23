/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { CocClient, type SentinelCodaFindingRecord, type SentinelCodaRunDetail, type SentinelCodaRunSummary } from '@plusplusoneplusplus/coc-client';
import { SentinelCodaHistory } from '../../../src/server/spa/client/react/features/repo-detail/unified-right-panel/SentinelCodaHistory';

const owner = { ownerWorkspaceId: 'group', processId: 'chat', ownerRoutingRef: 'remote:srv:group' };
const at = '2026-10-11T09:00:00Z';
function summary(patch: Partial<SentinelCodaRunSummary> = {}): SentinelCodaRunSummary {
    return { id: 'run-1', status: 'completed', trigger: 'manual', createdAt: at, childProcessId: 'queue_child',
        itemCount: 1, deferredCount: 2, awaitingReviewCount: 1, counts: { done: 1, proposals: 0, unverified: 0 }, ...patch };
}
function detail(patch: Partial<SentinelCodaRunDetail> = {}): SentinelCodaRunDetail {
    return { id: 'run-1', status: 'completed', trigger: 'manual', createdAt: at, startedAt: at, finishedAt: at,
        childProcessId: 'queue_child', snapshot: [{ itemId: 'item', revision: 1 }],
        deferredItemIds: ['later'], awaitingReviewItemIds: ['review'], findings: [], ...patch };
}
function record(state: SentinelCodaFindingRecord['state'] = 'undone'): SentinelCodaFindingRecord {
    return { runId: 'run-1', itemId: 'item', state, itemRevision: 1, fingerprint: 'hash',
        finding: { itemId: 'item', verdict: 'done', autoApply: true, confidence: 'high', summary: 'Landed',
            rationale: 'Completion verified', evidence: [{ kind: 'pr', ref: 'https://example.test/pull/1', state: 'merged', checkedAt: at }] },
        audit: [{ action: 'applied', actor: 'scrubber', at, before: { status: 'in_progress', archived: false, revision: 1, outcome: 'Original outcome' },
            after: { status: 'done', archived: false, revision: 2, outcome: 'Landed' } },
        { action: 'undone', actor: 'user', at, before: { status: 'done', archived: false, revision: 2, outcome: 'Landed' },
            after: { status: 'in_progress', archived: false, revision: 3, outcome: 'Original outcome' } }] };
}
function client(value: SentinelCodaRunDetail) {
    const fetch = vi.fn(async (_input: RequestInfo | URL, _options?: RequestInit) => Response.json(value));
    return { fetch, api: new CocClient({ baseUrl: 'https://remote.test', fetch }) };
}
const follow = vi.fn();
afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe('Coda run history', () => {
    it('lists all retained statuses, counts and exclusions without detail I/O or mutation', () => {
        const transport = client(detail());
        const runs = ['completed', 'failed', 'timed_out', 'cancelled', 'interrupted', 'skipped', 'queued', 'running'] as const;
        render(<SentinelCodaHistory client={transport.api} owner={owner} items={[]} onFollowLink={follow}
            runs={runs.map((status, index) => summary({ id: `r${index}`, status,
                ...(status === 'skipped' ? { skipReason: 'overlap' } : {}), ...(status === 'failed' ? { error: 'Model unavailable' } : {}) }))} />);
        expect(screen.getByText('Run history (8)')).toBeInTheDocument();
        expect(screen.getByText('Model unavailable')).toBeInTheDocument();
        expect(screen.getByText(/skipped: overlap/)).toBeInTheDocument();
        expect(screen.getAllByText(/1 done · 0 proposals · 0 unverified/)).toHaveLength(8);
        expect(screen.getAllByRole('button', { name: 'Details and change log' })).toHaveLength(8);
        expect(transport.fetch).not.toHaveBeenCalled();
        fireEvent.click(screen.getAllByRole('link', { name: 'Open chat' })[0]);
        expect(follow).toHaveBeenCalledWith(expect.anything(), 'scrubber:queue_child');
        expect(screen.getAllByRole('link', { name: 'Open chat' })[0]).toHaveAttribute('href', '#repos/remote%3Asrv%3Agroup/chats/queue_child');
    });

    it('shows original run attribution, every audit action, before/after and safe evidence without row actions', async () => {
        const applied = record();
        const accepted = { ...record('accepted'), itemId: 'obsolete', audit: [{
            action: 'accepted' as const, actor: 'user' as const, at,
            before: { status: 'todo' as const, archived: false, revision: 4 },
            after: { status: 'done' as const, archived: true, revision: 5, outcome: 'Obsolete: superseded' },
        }] };
        const dismissed = { ...record('dismissed'), itemId: 'dismissed', audit: [{ action: 'dismissed' as const, actor: 'user' as const, at }] };
        const transport = client(detail({ findings: [applied, accepted, dismissed] }));
        render(<SentinelCodaHistory client={transport.api} owner={owner} runs={[summary()]} items={[]} onFollowLink={follow} />);
        fireEvent.click(screen.getByRole('button', { name: 'Details and change log' }));
        const region = await screen.findByRole('region', { name: 'Coda run detail' });
        await within(region).findByText(/applied by scrubber/);
        expect(within(region).getByText(/undone by user/)).toBeInTheDocument();
        expect(within(region).getByText(/accepted by user/)).toBeInTheDocument();
        expect(within(region).getByText(/dismissed by user/)).toBeInTheDocument();
        expect(within(region).getByText('Before: in progress · not archived · revision 1 · Outcome: Original outcome')).toBeInTheDocument();
        expect(within(region).getByText('After: done · archived · revision 5 · Outcome: Obsolete: superseded')).toBeInTheDocument();
        expect(within(region).getByText('Deferred to next run: later')).toBeInTheDocument();
        expect(within(region).getByText('Awaiting Sentinel review: review')).toBeInTheDocument();
        for (const name of ['Accept', 'Dismiss', 'Undo', 'Accept all proposals']) expect(within(region).queryByRole('button', { name })).toBeNull();
        expect(within(region).getAllByRole('link', { name: 'https://example.test/pull/1' })[0]).toHaveAttribute('rel', 'noopener noreferrer');
        expect(transport.fetch).toHaveBeenCalledExactlyOnceWith('https://remote.test/api/workspaces/group/sentinel-todos/chat/scrubber/runs/run-1',
            expect.objectContaining({ method: 'GET', signal: expect.any(AbortSignal) }));
    });

    it.each(['unchanged', 'unverified'] as const)('retains %s diagnostics and evidence in read-only history', async state => {
        const entry = { ...record(state), audit: [] };
        entry.finding = { ...entry.finding, verdict: state, autoApply: false, summary: 'No actionable assessment',
            ...(state === 'unverified' ? { unverifiedReason: 'Remote server offline' } : {}) };
        entry.finding.evidence.push({ kind: 'other', ref: 'javascript:alert(1)', state: 'other', checkedAt: at });
        const transport = client(detail({ findings: [entry] }));
        render(<SentinelCodaHistory client={transport.api} owner={owner}
            runs={[summary({ counts: { done: 0, proposals: 0, unverified: state === 'unverified' ? 1 : 0 } })]}
            items={[]} onFollowLink={follow} />);
        fireEvent.click(screen.getByRole('button', { name: 'Details and change log' }));
        const region = await screen.findByRole('region', { name: 'Coda run detail' });
        await within(region).findByText(`${state} · ${state} · snapshot revision 1`);
        expect(within(region).getByText('No actionable assessment')).toBeInTheDocument();
        if (state === 'unverified') expect(within(region).getByText('Unverified: Remote server offline')).toBeInTheDocument();
        fireEvent.click(within(region).getByText('Evidence'));
        expect(within(region).getByText('Confidence: high · Completion verified')).toBeInTheDocument();
        expect(within(region).getByRole('link', { name: 'https://example.test/pull/1' })).toBeInTheDocument();
        expect(within(region).getByText(/javascript:alert\(1\)/)).toBeInTheDocument();
        expect(within(region).queryByRole('link', { name: 'javascript:alert(1)' })).toBeNull();
        expect(within(region).getByText('No changes recorded for this finding.')).toBeInTheDocument();
        for (const name of ['Accept', 'Dismiss', 'Undo', 'Accept all proposals']) expect(within(region).queryByRole('button', { name })).toBeNull();
        expect(transport.fetch).toHaveBeenCalledExactlyOnceWith('https://remote.test/api/workspaces/group/sentinel-todos/chat/scrubber/runs/run-1',
            expect.objectContaining({ method: 'GET' }));
    });

    it('explains cancellation and pending findings without claiming changes applied', async () => {
        const pending = { ...record('pending'), audit: [] };
        pending.finding.evidence[0].ref = 'javascript:alert(1)';
        const transport = client(detail({ status: 'cancelled', findings: [pending] }));
        render(<SentinelCodaHistory client={transport.api} owner={owner} runs={[summary({ status: 'cancelled' })]} items={[]} onFollowLink={follow} />);
        fireEvent.click(screen.getByRole('button', { name: 'Details and change log' }));
        await screen.findByText('No findings applied by this run.');
        expect(screen.getByText('No changes recorded for this finding.')).toBeInTheDocument();
        expect(screen.queryByRole('link', { name: 'javascript:alert(1)' })).toBeNull();
    });

    it('keeps detail failures explicit and retries only reads', async () => {
        const transport = client(detail());
        transport.fetch.mockResolvedValueOnce(Response.json({ message: 'offline' }, { status: 503 }));
        render(<SentinelCodaHistory client={transport.api} owner={owner} runs={[summary()]} items={[]} onFollowLink={follow} />);
        fireEvent.click(screen.getByRole('button', { name: 'Details and change log' }));
        await screen.findByRole('alert');
        fireEvent.click(screen.getByRole('button', { name: 'Retry details' }));
        await screen.findByText('No findings recorded.');
        expect(transport.fetch).toHaveBeenCalledTimes(2);
    });

    it('aborts and rejects late detail results when a different run is selected or history closes', async () => {
        const transport = client(detail({ id: 'second' }));
        const getRun = vi.spyOn(transport.api.sentinelTodos.scrubber, 'getRun');
        let resolve!: (response: Response) => void;
        transport.fetch.mockReturnValueOnce(new Promise<Response>(r => { resolve = r; }));
        const view = render(<SentinelCodaHistory client={transport.api} owner={owner}
            runs={[summary(), summary({ id: 'second' })]} items={[]} onFollowLink={follow} />);
        fireEvent.click(screen.getAllByRole('button', { name: 'Details and change log' })[0]);
        await waitFor(() => expect(transport.fetch).toHaveBeenCalledOnce());
        const firstSignal = transport.fetch.mock.calls[0][1]?.signal;
        fireEvent.click(screen.getAllByRole('button', { name: 'Details and change log' })[1]);
        await screen.findByText('No findings recorded.');
        expect(firstSignal?.aborted).toBe(true);
        await act(async () => resolve(Response.json(detail({ findings: [record()] }))));
        expect(screen.queryByText('Landed')).toBeNull();
        const secondSignal = getRun.mock.calls[1][3]?.signal;
        view.unmount();
        expect(secondSignal?.aborted).toBe(true);
    });

    it('refreshes selected details when summaries change and drops pruned runs', async () => {
        const transport = client(detail());
        const props = { client: transport.api, owner, items: [], onFollowLink: follow };
        const view = render(<SentinelCodaHistory {...props} runs={[summary()]} />);
        fireEvent.click(screen.getByRole('button', { name: 'Details and change log' }));
        await screen.findByText('No findings recorded.');
        transport.fetch.mockResolvedValue(Response.json(detail({ findings: [record()] })));
        view.rerender(<SentinelCodaHistory {...props} runs={[summary({ counts: { done: 0, proposals: 0, unverified: 0 } })]} />);
        await screen.findByText(/undone by user/);
        view.rerender(<SentinelCodaHistory {...props} runs={[]} />);
        expect(screen.queryByRole('region', { name: 'Coda run detail' })).toBeNull();
        expect(screen.getByText('No Coda runs yet.')).toBeInTheDocument();
    });
});
