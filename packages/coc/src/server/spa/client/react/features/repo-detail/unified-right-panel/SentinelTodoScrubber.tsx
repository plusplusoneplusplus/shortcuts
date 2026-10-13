import { useCallback, useEffect, useId, useMemo, useRef, useState, useSyncExternalStore, type MouseEvent, type ReactNode } from 'react';
import type { CocClient, SentinelScrubberConfig, SentinelScrubberResponse, SentinelScrubFindingRecord, SentinelTodoItem } from '@plusplusoneplusplus/coc-client';
import { useCocClient } from '../../../repos/cloneRouting';
import { resolveCloneRoute } from '../../../repos/cloneRegistry';
import { DASHBOARD_CONFIG_UPDATED_EVENT, isFeatureEnabled } from '../../../utils/config';
import { describeCron } from '../../../utils/cron';
import { formatRelativeTime } from '../../../utils/format';
import { Button } from '../../../ui/Button';
import { Spinner } from '../../../ui/Spinner';
import { SCRUB_CRON_PRESETS, validateScrubCron } from '../../../../../../schedule/scrub-cron';
import { AcceptAllScrubProposals, ScrubberFindingsContext } from './SentinelTodoScrubFinding';
import { ScrubRunChatLink, SentinelTodoScrubHistory } from './SentinelTodoScrubHistory';
import { sentinelTodoOwnerKey, type SentinelTodoOwner } from './sentinelTodoPanelModel';

function subscribeConfig(listener: () => void) {
    window.addEventListener(DASHBOARD_CONFIG_UPDATED_EVENT, listener);
    return () => window.removeEventListener(DASHBOARD_CONFIG_UPDATED_EVENT, listener);
}
function readEnabled() {
    return isFeatureEnabled('sentinelTodoScrubberEnabled');
}

type Props = {
    ready?: boolean;
    children?: ReactNode;
    toolbar?: ReactNode;
    onLedgerChange?: () => Promise<void>;
    owner: SentinelTodoOwner;
    items: readonly SentinelTodoItem[];
    onFollowLink: (event: MouseEvent<HTMLAnchorElement>, key: string) => void;
};

/** The owner and transport form a remount boundary for drafts and late results. */
export function SentinelTodoScrubber(props: Props) {
    const enabled = useSyncExternalStore(subscribeConfig, readEnabled, readEnabled);
    const ref = props.owner.ownerRoutingRef === null ? undefined : props.owner.ownerRoutingRef ?? props.owner.ownerWorkspaceId;
    const client = useCocClient(ref);
    const route = resolveCloneRoute(ref);
    if (!enabled || props.ready === false) return <>{props.toolbar}{props.children}</>;
    if (route.kind === 'unresolved-remote') return <>{props.toolbar}<p role="status">Scrubber unavailable: owning server is not connected.</p>{props.children}</>;
    return <ScrubberStrip key={`${sentinelTodoOwnerKey(props.owner)}:${route.kind === 'remote' ? route.baseUrl : 'local'}`}
        {...props} client={client} />;
}

function ScrubberStrip({ owner, items, onFollowLink, client, children, toolbar, onLedgerChange }: Props & { client: CocClient }) {
    const id = useId();
    const [findings, setFindings] = useState<ReadonlyMap<string, SentinelScrubFindingRecord>>(new Map());
    const [data, setData] = useState<SentinelScrubberResponse | null>(null);
    const [findingsError, setFindingsError] = useState<string | null>(null);
    const [loadError, setLoadError] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [batchResult, setBatchResult] = useState<string | null>(null);
    const [busy, setBusy] = useState(false);
    const [schedule, setSchedule] = useState<SentinelScrubberConfig | null>(null);
    const [selecting, setSelecting] = useState(false);
    const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
    const [historyOpen, setHistoryOpen] = useState(false);
    const busyRef = useRef(false);
    const mounted = useRef(true);
    const sequence = useRef(0);
    const api = client.sentinelTodos.scrubber;
    const load = useCallback(async () => {
        const seq = ++sequence.current;
        let configLoaded = false;
        try {
            const next = await api.get(owner.ownerWorkspaceId, owner.processId);
            if (!mounted.current || seq !== sequence.current) return;
            setData(next);
            setLoadError(null);
            configLoaded = true;
            const details = await Promise.all(next.runs.filter(run => run.status === 'completed')
                .map(run => api.getRun(owner.ownerWorkspaceId, owner.processId, run.id)));
            const records = new Map<string, SentinelScrubFindingRecord>();
            // Summaries are newest first; even suppressed findings supersede older badges.
            for (const detail of details) for (const record of detail.findings) {
                if (!records.has(record.itemId)) records.set(record.itemId, record);
            }
            if (mounted.current && seq === sequence.current) { setFindings(records); setFindingsError(null); }
        } catch (failure) {
            if (mounted.current && seq === sequence.current) {
                const message = failure instanceof Error ? failure.message : 'Could not load scrubber.';
                if (configLoaded) setFindingsError(message); else setLoadError(message);
            }
        }
    }, [api, owner.ownerWorkspaceId, owner.processId]);
    useEffect(() => {
        mounted.current = true;
        void load();
        const connection = client.events.connect({ workspaceId: owner.ownerWorkspaceId, onMessage: message => {
            const event = message as { type?: string; workspaceId?: string; processId?: string };
            if (event.type === 'sentinel-scrubber-changed' && event.workspaceId === owner.ownerWorkspaceId
                && event.processId === owner.processId) void load();
        } });
        const timer = setInterval(() => { if (document.visibilityState !== 'hidden') void load(); }, 30_000);
        return () => { mounted.current = false; sequence.current++; connection.close(); clearInterval(timer); };
    }, [client, load, owner.ownerWorkspaceId, owner.processId]);

    const openItems = useMemo(() => items.filter(item => !item.archived && item.status !== 'done'), [items]);
    const selectedIds = openItems.filter(item => selected.has(item.id)).map(item => item.id);
    const mutate = async (action: () => Promise<unknown>, onSuccess?: () => void) => {
        if (busyRef.current) return;
        busyRef.current = true;
        setBusy(true);
        setError(null);
        setBatchResult(null);
        try {
            await action();
            if (!mounted.current) return;
            onSuccess?.();
            await load();
        } catch (failure) {
            if (!mounted.current) return;
            const conflict = (failure as { status?: number })?.status === 409;
            setError(conflict ? 'Scrubber changed. Refresh and try again.' : failure instanceof Error ? failure.message : 'Scrubber action failed.');
            if (conflict) { setSchedule(null); await load(); }
        } finally {
            busyRef.current = false;
            if (mounted.current) setBusy(false);
        }
    };
    const start = (itemIds?: string[]) => mutate(() => api.start(owner.ownerWorkspaceId, owner.processId, itemIds ? { itemIds } : {}));
    const active = data?.activeRun;
    const last = data?.runs[0];
    const config = data?.config;
    const chatId = active?.childProcessId ?? last?.childProcessId;
    const cronError = useMemo(() => schedule ? validateScrubCron(schedule.cron) : undefined, [schedule?.cron]);
    const saveConfig = (draft: SentinelScrubberConfig) => mutate(() => api.updateConfig(owner.ownerWorkspaceId, owner.processId, {
        enabled: draft.enabled, cron: draft.cron.trim(), expectedRevision: draft.revision,
    }), () => setSchedule(null));

    const findingAction = async (record: SentinelScrubFindingRecord, action: 'accept' | 'dismiss' | 'undo') => {
        if (busyRef.current) return;
        busyRef.current = true;
        sequence.current++;
        setBusy(true);
        setError(null);
        setBatchResult(null);
        try {
            const expectedItemRevision = action === 'undo'
                ? record.audit.find(entry => entry.action === 'applied')!.after!.revision : record.itemRevision;
            await api[action](owner.ownerWorkspaceId, owner.processId, record.runId, record.itemId, { expectedItemRevision });
            if (!mounted.current) return;
            await onLedgerChange?.();
            if (mounted.current) await load();
        } catch (failure) {
            if (!mounted.current) return;
            setError((failure as { status?: number })?.status === 409
                ? 'Item changed since this proposal. Run a fresh scrub.'
                : failure instanceof Error ? failure.message : 'Could not update finding.');
            await onLedgerChange?.();
            if (mounted.current) await load();
        } finally {
            busyRef.current = false;
            if (mounted.current) setBusy(false);
        }
    };
    const proposals = useMemo(() => [...findings.values()].filter(record =>
        record.state === 'proposed' && items.some(item => item.id === record.itemId)), [findings, items]);
    const acceptAll = async () => {
        if (busyRef.current || loadError || findingsError || !proposals.length) return;
        busyRef.current = true;
        sequence.current++;
        setBusy(true);
        setError(null);
        setBatchResult(null);
        let accepted = 0;
        let changed = 0;
        let attempted = 0;
        let failureMessage: string | undefined;
        try {
            // Keep the admitted findings and revisions fixed; conflicts never authorize a retry.
            for (const record of proposals) {
                if (!mounted.current) return;
                attempted++;
                if (items.find(item => item.id === record.itemId)?.revision !== record.itemRevision) {
                    changed++;
                    continue;
                }
                try {
                    await api.accept(owner.ownerWorkspaceId, owner.processId, record.runId, record.itemId, {
                        expectedItemRevision: record.itemRevision,
                    });
                    accepted++;
                } catch (failure) {
                    if ((failure as { status?: number })?.status === 409) changed++;
                    else {
                        failureMessage = failure instanceof Error ? failure.message : 'Could not accept proposal.';
                        break;
                    }
                }
            }
            if (!mounted.current) return;
            setBatchResult(`Accepted ${accepted} proposal${accepted === 1 ? '' : 's'}.`
                + (changed ? ` ${changed} item${changed === 1 ? '' : 's'} changed since this proposal. Run a fresh scrub.` : '')
                + (failureMessage ? ` 1 acceptance failed; ${proposals.length - attempted} not attempted.` : ''));
            if (failureMessage) setError(failureMessage);
            await onLedgerChange?.();
            if (mounted.current) await load();
        } catch (failure) {
            if (mounted.current) setError(failure instanceof Error ? failure.message : 'Could not refresh accepted proposals.');
        } finally {
            busyRef.current = false;
            if (mounted.current) setBusy(false);
        }
    };
    return <ScrubberFindingsContext.Provider value={{ findings, busy: busy || !!loadError || !!findingsError, act: findingAction, proposalCount: proposals.length, acceptAll }}>
        {toolbar}
        <section aria-label="To-do Scrubber" data-testid="sentinel-scrubber-strip"
            className="sticky top-0 z-10 flex flex-col gap-1 rounded border border-[#e0e0e0] bg-white p-2 dark:border-[#3c3c3c] dark:bg-[#1e1e1e]">
            <div className="flex flex-wrap items-center gap-1">
                <strong className="mr-auto">Scrubber</strong>
                <AcceptAllScrubProposals />
                <Button size="sm" disabled={!data || !!active || busy || !!loadError} onClick={() => { void start(); }}>Scrub now</Button>
                <Button size="sm" variant="secondary" disabled={!config || busy || !!loadError} onClick={() => setSchedule(schedule ? null : { ...config! })}>Schedule ▾</Button>
            </div>
            {loadError && <p role="alert">{loadError} <Button size="sm" variant="secondary" onClick={() => { void load(); }}>Refresh scrubber</Button></p>}
            {findingsError && <p role="alert">Could not load findings: {findingsError} <Button size="sm" variant="secondary" onClick={() => { void load(); }}>Refresh findings</Button></p>}
            {!data && !loadError && <div role="status" className="flex items-center gap-1"><Spinner size="sm" /> Loading scrubber…</div>}
            {config && <div className="text-[#616161] dark:text-[#9d9d9d]">
                {config.enabled ? describeCron(config.cron) || config.cron : 'Manual only'}
                {config.enabled && !config.paused && config.nextRunAt && <> · next <time dateTime={config.nextRunAt} title={new Date(config.nextRunAt).toLocaleString()}>{formatRelativeTime(config.nextRunAt)}</time></>}
            </div>}
            {config?.paused && <p role="status" className="text-[#b5650f] dark:text-[#cca700]">Schedule paused after {config.consecutiveFailures} failures · <Button size="sm" variant="secondary" disabled={busy || !!loadError} onClick={() => { void saveConfig(config); }}>Resume</Button></p>}
            {active ? <div role="status" className="flex flex-wrap items-center gap-1">
                <Spinner size="sm" /> {active.status === 'queued' ? 'Queued' : `Scrubbing ${active.snapshot.length} items…`} · {formatRelativeTime(active.startedAt ?? active.createdAt)}
                <Button size="sm" variant="secondary" disabled={busy} onClick={() => { void mutate(() => api.cancel(owner.ownerWorkspaceId, owner.processId, active.id)); }}>Cancel</Button>
            </div> : last && <div className={last.status === 'failed' || last.status === 'timed_out' ? 'text-[#c72e2e] dark:text-[#f48771]' : ''}>
                {last.status === 'failed' || last.status === 'timed_out' ? <>Last run failed: {last.error ?? last.status} <Button size="sm" variant="secondary" disabled={busy || !!loadError} onClick={() => { void start(); }}>Retry</Button></>
                    : <>Last run {formatRelativeTime(last.finishedAt ?? last.createdAt)} · {last.status} · ✓ {last.counts.done} done · {last.counts.proposals} proposal{last.counts.proposals === 1 ? '' : 's'} · {last.counts.unverified} unverified</>}
                {last.deferredCount > 0 && <p>{last.deferredCount} deferred to next run</p>}
                {last.awaitingReviewCount > 0 && <p>{last.awaitingReviewCount} awaiting Sentinel review</p>}
            </div>}
            <ScrubRunChatLink owner={owner} childProcessId={chatId} onFollowLink={onFollowLink} />
            {error && <p role="alert">{error}</p>}
            {batchResult && <p role="status">{batchResult}</p>}
            {data && <div className="flex flex-wrap gap-1">
                <Button size="sm" variant="ghost" aria-expanded={historyOpen} onClick={() => setHistoryOpen(value => !value)}>{historyOpen ? 'Hide history' : 'History'} ({data.runs.length})</Button>
                <Button size="sm" variant="ghost" onClick={() => setSelecting(value => !value)}>{selecting ? 'Hide selection' : 'Select items'}</Button>
                {selecting && <Button size="sm" variant="secondary" disabled={!!active || busy || !selectedIds.length || !!loadError} onClick={() => { void start(selectedIds); }}>Scrub selected ({selectedIds.length})</Button>}
            </div>}
            {selecting && <fieldset className="flex max-h-48 flex-col gap-1 overflow-auto"><legend>Select open items</legend>
                {openItems.map(item => <label key={item.id} className="flex items-start gap-1"><input type="checkbox" checked={selected.has(item.id)} onChange={() => setSelected(previous => {
                    const next = new Set(previous);
                    if (next.has(item.id)) next.delete(item.id); else next.add(item.id);
                    return next;
                })} />{item.title}{item.type === 'manual' && ' · Manual'}</label>)}
                {!openItems.length && <span>No open items.</span>}
            </fieldset>}
            {schedule && <form aria-label="Scrubber schedule" onSubmit={event => { event.preventDefault(); if (!cronError) void saveConfig(schedule); }} className="absolute right-0 top-full z-20 flex w-full flex-col gap-1 rounded border border-[#e0e0e0] bg-white p-2 shadow-lg dark:border-[#3c3c3c] dark:bg-[#1e1e1e]">
                <label><input type="checkbox" checked={schedule.enabled} disabled={busy} onChange={event => setSchedule({ ...schedule, enabled: event.target.checked })} /> Enable schedule</label>
                <label htmlFor={`${id}-preset`}>Preset</label>
                <select id={`${id}-preset`} value={SCRUB_CRON_PRESETS.some(preset => preset.cron === schedule.cron) ? schedule.cron : 'custom'} disabled={busy}
                    onChange={event => { if (event.target.value !== 'custom') setSchedule({ ...schedule, cron: event.target.value }); }}>
                    {SCRUB_CRON_PRESETS.map(preset => <option key={preset.cron} value={preset.cron}>{preset.label}</option>)}<option value="custom">Custom</option>
                </select>
                <label htmlFor={`${id}-cron`}>Custom cron (5 fields; at least 1h apart)</label>
                <input id={`${id}-cron`} value={schedule.cron} disabled={busy} maxLength={200} aria-invalid={!!cronError} aria-describedby={`${id}-preview`}
                    className="rounded border border-[#e0e0e0] bg-transparent px-2 py-1 dark:border-[#3c3c3c]" onChange={event => setSchedule({ ...schedule, cron: event.target.value })} />
                <p id={`${id}-preview`} role={cronError ? 'alert' : 'status'}>{cronError ?? (describeCron(schedule.cron) || schedule.cron)}</p>
                <div className="flex justify-end gap-1"><Button size="sm" variant="secondary" disabled={busy} onClick={() => setSchedule(null)}>Close schedule</Button>
                    <Button size="sm" type="submit" disabled={busy || !!cronError || !!loadError}>Save schedule</Button></div>
            </form>}
        </section>
        {historyOpen && data && <SentinelTodoScrubHistory client={client} owner={owner} runs={data.runs} items={items} onFollowLink={onFollowLink} />}
        {children}
    </ScrubberFindingsContext.Provider>;
}
