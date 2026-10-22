import { useCallback, useEffect, useId, useRef, useState } from 'react';
import type { CocClient, SentinelTodoItem, Trigger } from '@plusplusoneplusplus/coc-client';
import { zonedTriggerTime } from '@plusplusoneplusplus/coc-client';
import { useCocClient } from '../../../repos/cloneRouting';
import { resolveCloneRoute } from '../../../repos/cloneRegistry';
import { Button } from '../../../ui/Button';
import { Dialog } from '../../../ui/Dialog';
import { formatRelativeTime } from '../../../utils/format';
import { sentinelTodoOwnerKey, type SentinelTodoOwner } from './sentinelTodoPanelModel';
import { SentinelTodoTriggerEditor } from './SentinelTodoTriggerEditor';
import { eligibleTriggerItems, isTerminalTrigger, triggerError } from './sentinelTodoTriggerModel';
import './sentinelTodoTriggers.css';

export function SentinelTodoTriggers(props: { owner: SentinelTodoOwner; items: readonly SentinelTodoItem[]; onItemLink: (itemId: string) => void }) {
    const ref = props.owner.ownerRoutingRef === null ? undefined : props.owner.ownerRoutingRef ?? props.owner.ownerWorkspaceId;
    const client = useCocClient(ref);
    const route = resolveCloneRoute(ref);
    if (route.kind === 'unresolved-remote') return <p role="status">Overtures unavailable: owning server is not connected.</p>;
    return <TriggerSection key={`${sentinelTodoOwnerKey(props.owner)}:${route.kind === 'remote' ? route.baseUrl : 'local'}`} {...props} client={client} />;
}

function TriggerSection({ owner, items, client, onItemLink }: {
    owner: SentinelTodoOwner; items: readonly SentinelTodoItem[]; client: CocClient; onItemLink: (itemId: string) => void;
}) {
    const id = useId();
    const [rules, setRules] = useState<Trigger[]>([]);
    const [error, setError] = useState<string | null>(null);
    const [loadError, setLoadError] = useState<string | null>(null);
    const [capabilityError, setCapabilityError] = useState<string | null>(null);
    const [loading, setLoading] = useState(true);
    const [conflict, setConflict] = useState(false);
    const [open, setOpen] = useState(true);
    const [editor, setEditor] = useState<Trigger | 'new' | null>(null);
    const [runNow, setRunNow] = useState<Trigger | null>(null);
    const [resume, setResume] = useState<Trigger | null>(null);
    const [dateTimeEnabled, setDateTimeEnabled] = useState(false);
    const [busy, setBusy] = useState(false);
    const busyRef = useRef(false);
    const sequence = useRef(0);
    const mounted = useRef(true);
    const retry = useRef<(() => Promise<void>) | null>(null);
    const load = useCallback(async () => {
        const seq = ++sequence.current;
        try {
            const [result, capabilities] = await Promise.all([
                client.triggers.listSentinelTodo(owner.ownerWorkspaceId, owner.processId),
                client.triggers.sentinelTodoCapabilities(owner.ownerWorkspaceId, owner.processId).then(
                    result => ({ dateTime: result.dateTime, error: null }),
                    failure => ({ dateTime: false, error: triggerError(failure).message })),
            ]);
            if (mounted.current && seq === sequence.current) {
                setRules(result); setDateTimeEnabled(capabilities.dateTime === true);
                setCapabilityError(capabilities.error); setLoadError(null);
                if (!capabilities.dateTime) {
                    setRunNow(current => current?.event.type === 'date-time' ? null : current);
                    setResume(null);
                }
            }
        } catch (failure) {
            if (mounted.current && seq === sequence.current) {
                setLoadError(triggerError(failure).message); setDateTimeEnabled(false);
                setRunNow(null);
            }
        } finally {
            if (mounted.current && seq === sequence.current) setLoading(false);
        }
    }, [client, owner.ownerWorkspaceId, owner.processId]);
    useEffect(() => {
        mounted.current = true;
        setRules([]);
        setDateTimeEnabled(false);
        setLoading(true);
        setEditor(null);
        setError(null);
        setLoadError(null);
        void load();
        const connection = client.events.connect({ workspaceId: owner.ownerWorkspaceId, onMessage: message => {
            const event = message as { type?: string; workspaceId?: string; processId?: string };
            if (event.workspaceId && event.workspaceId !== owner.ownerWorkspaceId) return;
            if (event.processId && event.processId !== owner.processId) return;
            if (event.type?.startsWith('trigger') || event.type === 'sentinel-todos-changed') void load();
        } });
        const timer = setInterval(() => { if (document.visibilityState !== 'hidden') void load(); }, 30_000);
        return () => { mounted.current = false; sequence.current++; connection.close(); clearInterval(timer); };
    }, [client, load, owner.ownerWorkspaceId, owner.processId]);
    const refresh = () => { setError(null); setLoadError(null); setConflict(false); retry.current = null; void load(); };
    const mutate = async (action: () => Promise<unknown>) => {
        if (busyRef.current) return;
        busyRef.current = true;
        setBusy(true);
        setError(null);
        setConflict(false);
        retry.current = () => mutate(action);
        try {
            await action();
            if (!mounted.current) return;
            retry.current = null;
            setRunNow(null);
            setResume(null);
            await load();
        } catch (failure) {
            if (!mounted.current) return;
            const detail = triggerError(failure);
            setError(detail.message);
            setConflict(detail.conflict);
            if (detail.conflict) { retry.current = null; await load(); }
        } finally {
            busyRef.current = false;
            if (mounted.current) setBusy(false);
        }
    };
    const sorted = rules.filter(rule => rule.workspaceId === owner.ownerWorkspaceId && rule.processId === owner.processId
        && rule.binding?.kind === 'sentinel-todo' && !rule.binding.delegatedPr
        && (rule.event.monitor === 'pr-merged' || rule.event.type === 'date-time' && dateTimeEnabled))
        .sort((a, b) => Number(isTerminalTrigger(a)) - Number(isTerminalTrigger(b)) || b.createdAt.localeCompare(a.createdAt));
    const add = <Button size="sm" variant="secondary" disabled={busy || eligibleTriggerItems(items).length === 0} onClick={() => setEditor('new')}>+ Add overture</Button>;
    return <div className="sentinel-trigger-root">
        {loading && <p role="status" className="sentinel-trigger-muted">Loading overtures…</p>}
        {capabilityError && <p role="alert">Overture capabilities unavailable: {capabilityError}{' '}
            <Button size="sm" variant="secondary" onClick={refresh}>Retry overture availability</Button></p>}
        {(loadError || error) && <div role="alert" className="sentinel-trigger-error">{loadError || error}{' '}
            <Button size="sm" variant="secondary" disabled={busy} onClick={conflict ? refresh : () => { if (retry.current) void retry.current(); else refresh(); }}>{conflict ? 'Refresh overtures' : 'Retry'}</Button>
        </div>}
        {sorted.length > 0 ? <section aria-labelledby={`${id}-heading`} className="sentinel-trigger-section" data-testid="sentinel-todo-triggers">
            <div className="sentinel-trigger-heading">
                <h3><button id={`${id}-heading`} type="button" aria-expanded={open} aria-controls={`${id}-body`} onClick={() => setOpen(value => !value)}>
                    <span aria-hidden="true">{open ? '▾' : '▸'}</span> Overtures ({sorted.length})
                </button></h3>{add}
            </div>
            {open && <ul id={`${id}-body`} className="sentinel-trigger-list">
                {sorted.map(rule => {
                    if ((rule.event.monitor !== 'pr-merged' && rule.event.type !== 'date-time') || !rule.binding) return null;
                    const terminal = isTerminalTrigger(rule);
                    const item = items.find(candidate => candidate.id === rule.binding!.itemId);
                    const label = rule.outcome === 'fired' ? 'Fired' : rule.outcome === 'closed-unmerged' ? 'Closed, not merged'
                        : rule.outcome === 'skipped' ? 'Skipped' : rule.outcome === 'error' ? 'Error' : rule.status === 'paused' ? 'Paused' : 'Waiting';
                    const icon = { Waiting: '⏳', Paused: '⏸', Fired: '⚡', 'Closed, not merged': '⊘', Skipped: '↷', Error: '⚠' }[label];
                    const deliveryError = rule.outcome === 'fired' && rule.delivery?.state === 'pending' ? rule.outcomeReason : undefined;
                    return <li key={rule.id} className="sentinel-trigger-row" data-testid={`sentinel-trigger-${rule.id}`}>
                        <div className="sentinel-trigger-summary">
                            <span className={`sentinel-trigger-badge sentinel-trigger-${label === 'Closed, not merged' ? 'closed' : label.toLowerCase()}`}
                                title={rule.delivery ? `Message ${rule.delivery.state === 'pending' ? 'delivery pending' : rule.delivery.state}` : rule.outcomeReason}>
                                <span aria-hidden="true">{icon}</span> {label}
                            </span>
                            {rule.event.monitor === 'pr-merged' && rule.event.lastError && <span className="sentinel-trigger-badge sentinel-trigger-error" title={`${rule.event.lastError.message} · Last retry ${rule.lastTickAt ?? rule.event.lastError.at} · Next retry ${rule.nextTickAt ?? 'scheduled with backoff'}`}>⚠ Error · retrying</span>}
                            {deliveryError && <span className="sentinel-trigger-badge sentinel-trigger-error"
                                title={`${deliveryError} · Last retry ${rule.lastTickAt ?? rule.delivery!.firedAt} · Next retry ${rule.nextTickAt ?? 'startup reconciliation or retry with backoff'}`}>⚠ Error · delivery retrying</span>}
                            {rule.event.type === 'date-time'
                                ? <time dateTime={rule.event.firesAt} title={`UTC: ${rule.event.firesAt}`}>{zonedTriggerTime(rule.event.firesAt, rule.event.timeZone)} ({rule.event.timeZone})</time>
                                : <a href={rule.event.pr.url} target="_blank" rel="noopener noreferrer" title={rule.event.lastSeenTitle}>PR {rule.event.pr.repoPath}#{rule.event.pr.number}</a>}
                            <a href={`#sentinel-todo-item-${encodeURIComponent(rule.binding.itemId)}`} onClick={event => { event.preventDefault(); onItemLink(rule.binding!.itemId); }}>→ {item?.title ?? 'Item unavailable'}</a>
                            {!terminal ? <details className="sentinel-trigger-menu"><summary aria-label={rule.event.type === 'date-time' ? 'Actions for date/time overture' : `Actions for PR #${rule.event.pr.number}`}>⋯</summary>
                                <Button size="sm" variant="secondary" disabled={busy} onClick={() => {
                                    if (rule.status === 'paused' && rule.event.type === 'date-time' && Date.parse(rule.event.firesAt) <= Date.now()) {
                                        setResume(rule); return;
                                    }
                                    void mutate(() => rule.status === 'paused'
                                    ? client.triggers.resumeSentinelTodo(owner.ownerWorkspaceId, owner.processId, rule.id, rule.revision)
                                    : client.triggers.pauseSentinelTodo(owner.ownerWorkspaceId, owner.processId, rule.id, rule.revision)); }}>{rule.status === 'paused' ? 'Resume' : 'Pause'}</Button>
                                <Button size="sm" variant="secondary" disabled={busy} onClick={() => setRunNow(rule)}>Run now</Button>
                                <Button size="sm" variant="secondary" disabled={busy} onClick={() => setEditor(rule)}>Edit</Button>
                                <Button size="sm" variant="secondary" disabled={busy} onClick={() => { void mutate(() => client.triggers.removeSentinelTodo(owner.ownerWorkspaceId, owner.processId, rule.id, rule.revision)); }}>Remove</Button>
                            </details> : <Button size="sm" variant="secondary" disabled={busy} onClick={() => { void mutate(() => client.triggers.removeSentinelTodo(owner.ownerWorkspaceId, owner.processId, rule.id, rule.revision)); }}>Clear</Button>}
                        </div>
                        {rule.binding.instruction && <p className="sentinel-trigger-instruction" title={rule.binding.instruction}>{rule.binding.instruction}</p>}
                        <div className="sentinel-trigger-muted">Armed by {rule.binding.armedBy === 'sentinel' ? 'Sentinel' : 'You'} · <time dateTime={rule.binding.armedAt} title={new Date(rule.binding.armedAt).toLocaleString()}>{formatRelativeTime(rule.binding.armedAt)}</time>
                            {rule.delivery && <> · <time dateTime={rule.delivery.firedAt}>{formatRelativeTime(rule.delivery.firedAt)}</time> · {rule.delivery.state === 'pending' ? 'Delivery pending' : rule.delivery.state === 'failed' ? 'Delivery failed' : 'Message delivered'}</>}
                        </div>
                        {rule.outcomeReason && <p className={rule.outcome === 'error' || deliveryError ? 'sentinel-trigger-error' : 'sentinel-trigger-muted'}>{rule.outcomeReason}</p>}
                    </li>;
                })}
            </ul>}
        </section> : <div className="sentinel-trigger-entry">{add}</div>}
        {editor && <SentinelTodoTriggerEditor client={client} owner={owner} items={items} dateTimeEnabled={dateTimeEnabled} trigger={editor === 'new' ? undefined : editor} onClose={() => setEditor(null)}
            onSaved={() => { setEditor(null); void load(); }} onConflict={() => { void load(); }} />}
        {runNow && <Dialog open trapFocus disableClose={busy} title="Run overture now" onClose={() => { if (!busy) setRunNow(null); }}>
            <p>Post the start message to the Sentinel now? This uses up the overture.</p>
            <div className="sentinel-trigger-actions">
                <Button size="sm" variant="secondary" disabled={busy} onClick={() => setRunNow(null)}>Cancel</Button>
                <Button size="sm" disabled={busy || conflict} onClick={() => { void mutate(() => client.triggers.runSentinelTodoNow(owner.ownerWorkspaceId, owner.processId, runNow.id, runNow.revision)); }}>Confirm run now</Button>
            </div>
            {error && <p role="alert">{error} <Button size="sm" variant="secondary" disabled={busy} onClick={() => {
                if (conflict) { refresh(); setRunNow(null); } else if (retry.current) void retry.current();
            }}>{conflict ? 'Refresh overtures' : 'Retry run now'}</Button></p>}
        </Dialog>}
        {resume && <Dialog open trapFocus disableClose={busy} title="Resume overdue overture" onClose={() => { if (!busy) setResume(null); }}>
            <p>This overdue overture will wake Sentinel immediately. It grants no new authorization.</p>
            <div className="sentinel-trigger-actions">
                <Button size="sm" variant="secondary" disabled={busy} onClick={() => setResume(null)}>Cancel</Button>
                <Button size="sm" disabled={busy || conflict} onClick={() => { void mutate(() =>
                    client.triggers.resumeSentinelTodo(owner.ownerWorkspaceId, owner.processId, resume.id, resume.revision, true)); }}>Confirm resume</Button>
            </div>
            {error && <p role="alert">{error}</p>}
        </Dialog>}
    </div>;
}
