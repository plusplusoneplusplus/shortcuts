import { useCallback, useEffect, useId, useRef, useState, useSyncExternalStore } from 'react';
import type { CocClient, SentinelTodoItem, Trigger } from '@plusplusoneplusplus/coc-client';
import { useCocClient } from '../../../repos/cloneRouting';
import { resolveCloneRoute } from '../../../repos/cloneRegistry';
import { Button } from '../../../ui/Button';
import { Dialog } from '../../../ui/Dialog';
import { DASHBOARD_CONFIG_UPDATED_EVENT, isTriggersEnabled } from '../../../utils/config';
import { formatRelativeTime } from '../../../utils/format';
import { sentinelTodoOwnerKey, type SentinelTodoOwner } from './sentinelTodoPanelModel';
import { SentinelTodoTriggerEditor } from './SentinelTodoTriggerEditor';
import { eligibleTriggerItems, isTerminalTrigger, triggerError } from './sentinelTodoTriggerModel';
import './sentinelTodoTriggers.css';

function subscribeConfig(listener: () => void) {
    window.addEventListener(DASHBOARD_CONFIG_UPDATED_EVENT, listener);
    return () => window.removeEventListener(DASHBOARD_CONFIG_UPDATED_EVENT, listener);
}

export function SentinelTodoTriggers(props: { owner: SentinelTodoOwner; items: readonly SentinelTodoItem[]; onItemLink: (itemId: string) => void }) {
    const enabled = useSyncExternalStore(subscribeConfig, isTriggersEnabled, isTriggersEnabled);
    const ref = props.owner.ownerRoutingRef === null ? undefined : props.owner.ownerRoutingRef ?? props.owner.ownerWorkspaceId;
    const client = useCocClient(ref);
    const route = resolveCloneRoute(ref);
    if (!enabled) return null;
    if (route.kind === 'unresolved-remote') return <p role="status">Triggers unavailable: owning server is not connected.</p>;
    return <TriggerSection key={`${sentinelTodoOwnerKey(props.owner)}:${route.kind === 'remote' ? route.baseUrl : 'local'}`} {...props} client={client} />;
}

function TriggerSection({ owner, items, client, onItemLink }: {
    owner: SentinelTodoOwner; items: readonly SentinelTodoItem[]; client: CocClient; onItemLink: (itemId: string) => void;
}) {
    const id = useId();
    const [rules, setRules] = useState<Trigger[]>([]);
    const [error, setError] = useState<string | null>(null);
    const [loadError, setLoadError] = useState<string | null>(null);
    const [conflict, setConflict] = useState(false);
    const [open, setOpen] = useState(true);
    const [editor, setEditor] = useState<Trigger | 'new' | null>(null);
    const [runNow, setRunNow] = useState<Trigger | null>(null);
    const [busy, setBusy] = useState(false);
    const busyRef = useRef(false);
    const sequence = useRef(0);
    const mounted = useRef(true);
    const retry = useRef<(() => Promise<void>) | null>(null);
    const load = useCallback(async () => {
        const seq = ++sequence.current;
        try {
            const result = await client.triggers.listSentinelTodo(owner.ownerWorkspaceId, owner.processId);
            if (mounted.current && seq === sequence.current) { setRules(result); setLoadError(null); }
        } catch (failure) {
            if (mounted.current && seq === sequence.current) setLoadError(triggerError(failure).message);
        }
    }, [client, owner.ownerWorkspaceId, owner.processId]);
    useEffect(() => {
        mounted.current = true;
        setRules([]);
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
        && !rule.binding?.delegatedPr)
        .sort((a, b) => Number(isTerminalTrigger(a)) - Number(isTerminalTrigger(b)) || b.createdAt.localeCompare(a.createdAt));
    const add = <Button size="sm" variant="secondary" disabled={busy || eligibleTriggerItems(items).length === 0} onClick={() => setEditor('new')}>+ Add trigger</Button>;
    return <div className="sentinel-trigger-root">
        {(loadError || error) && <div role="alert" className="sentinel-trigger-error">{loadError || error}{' '}
            <Button size="sm" variant="secondary" disabled={busy} onClick={conflict ? refresh : () => { if (retry.current) void retry.current(); else refresh(); }}>{conflict ? 'Refresh rules' : 'Retry'}</Button>
        </div>}
        {sorted.length > 0 ? <section aria-labelledby={`${id}-heading`} className="sentinel-trigger-section" data-testid="sentinel-todo-triggers">
            <div className="sentinel-trigger-heading">
                <h3><button id={`${id}-heading`} type="button" aria-expanded={open} aria-controls={`${id}-body`} onClick={() => setOpen(value => !value)}>
                    <span aria-hidden="true">{open ? '▾' : '▸'}</span> Triggers ({sorted.length})
                </button></h3>{add}
            </div>
            {open && <ul id={`${id}-body`} className="sentinel-trigger-list">
                {sorted.map(rule => {
                    if (rule.event.monitor !== 'pr-merged' || !rule.binding) return null;
                    const terminal = isTerminalTrigger(rule);
                    const item = items.find(candidate => candidate.id === rule.binding!.itemId);
                    const label = rule.outcome === 'fired' ? 'Fired' : rule.outcome === 'closed-unmerged' ? 'Closed, not merged'
                        : rule.outcome === 'skipped' ? 'Skipped' : rule.outcome === 'error' ? 'Error' : rule.status === 'paused' ? 'Paused' : 'Waiting';
                    const icon = { Waiting: '⏳', Paused: '⏸', Fired: '⚡', 'Closed, not merged': '⊘', Skipped: '↷', Error: '⚠' }[label];
                    const deliveryError = rule.outcome === 'fired' && rule.delivery?.state === 'pending' ? rule.outcomeReason : undefined;
                    return <li key={rule.id} className="sentinel-trigger-row" data-testid={`sentinel-trigger-${rule.id}`}>
                        <div className="sentinel-trigger-summary">
                            <span className={`sentinel-trigger-badge sentinel-trigger-${label === 'Closed, not merged' ? 'closed' : label.toLowerCase()}`}
                                title={rule.delivery ? `Message ${rule.delivery.state === 'pending' ? 'delivery pending' : 'delivered'}` : rule.outcomeReason}>
                                <span aria-hidden="true">{icon}</span> {label}
                            </span>
                            {rule.event.lastError && <span className="sentinel-trigger-badge sentinel-trigger-error" title={`${rule.event.lastError.message} · Last retry ${rule.lastTickAt ?? rule.event.lastError.at} · Next retry ${rule.nextTickAt ?? 'scheduled with backoff'}`}>⚠ Error · retrying</span>}
                            {deliveryError && <span className="sentinel-trigger-badge sentinel-trigger-error"
                                title={`${deliveryError} · Last retry ${rule.lastTickAt ?? rule.delivery!.firedAt} · Next retry ${rule.nextTickAt ?? 'startup reconciliation or retry with backoff'}`}>⚠ Error · delivery retrying</span>}
                            <a href={rule.event.pr.url} target="_blank" rel="noopener noreferrer" title={rule.event.lastSeenTitle}>PR {rule.event.pr.repoPath}#{rule.event.pr.number}</a>
                            <a href={`#sentinel-todo-item-${encodeURIComponent(rule.binding.itemId)}`} onClick={event => { event.preventDefault(); onItemLink(rule.binding!.itemId); }}>→ {item?.title ?? 'Item unavailable'}</a>
                            {!terminal ? <details className="sentinel-trigger-menu"><summary aria-label={`Actions for PR #${rule.event.pr.number}`}>⋯</summary>
                                <Button size="sm" variant="secondary" disabled={busy} onClick={() => { void mutate(() => rule.status === 'paused'
                                    ? client.triggers.resumeSentinelTodo(owner.ownerWorkspaceId, owner.processId, rule.id, rule.revision)
                                    : client.triggers.pauseSentinelTodo(owner.ownerWorkspaceId, owner.processId, rule.id, rule.revision)); }}>{rule.status === 'paused' ? 'Resume' : 'Pause'}</Button>
                                <Button size="sm" variant="secondary" disabled={busy} onClick={() => setRunNow(rule)}>Run now</Button>
                                <Button size="sm" variant="secondary" disabled={busy} onClick={() => setEditor(rule)}>Edit</Button>
                                <Button size="sm" variant="secondary" disabled={busy} onClick={() => { void mutate(() => client.triggers.removeSentinelTodo(owner.ownerWorkspaceId, owner.processId, rule.id, rule.revision)); }}>Remove</Button>
                            </details> : <Button size="sm" variant="secondary" disabled={busy} onClick={() => { void mutate(() => client.triggers.removeSentinelTodo(owner.ownerWorkspaceId, owner.processId, rule.id, rule.revision)); }}>Clear</Button>}
                        </div>
                        {rule.binding.instruction && <p className="sentinel-trigger-instruction" title={rule.binding.instruction}>{rule.binding.instruction}</p>}
                        <div className="sentinel-trigger-muted">Armed by {rule.binding.armedBy === 'sentinel' ? 'Sentinel' : 'You'} · <time dateTime={rule.binding.armedAt} title={new Date(rule.binding.armedAt).toLocaleString()}>{formatRelativeTime(rule.binding.armedAt)}</time>
                            {rule.delivery && <> · <time dateTime={rule.delivery.firedAt}>{formatRelativeTime(rule.delivery.firedAt)}</time> · {rule.delivery.state === 'pending' ? 'Delivery pending' : 'Message delivered'}</>}
                        </div>
                        {rule.outcomeReason && <p className={rule.outcome === 'error' || deliveryError ? 'sentinel-trigger-error' : 'sentinel-trigger-muted'}>{rule.outcomeReason}</p>}
                    </li>;
                })}
            </ul>}
        </section> : <div className="sentinel-trigger-entry">{add}</div>}
        {editor && <SentinelTodoTriggerEditor client={client} owner={owner} items={items} trigger={editor === 'new' ? undefined : editor} onClose={() => setEditor(null)}
            onSaved={() => { setEditor(null); void load(); }} onConflict={() => { void load(); }} />}
        {runNow && <Dialog open title="Run trigger now" onClose={() => { if (!busy) setRunNow(null); }}>
            <p>Post the start message to the Sentinel now? This uses up the rule.</p>
            <div className="sentinel-trigger-actions">
                <Button size="sm" variant="secondary" disabled={busy} onClick={() => setRunNow(null)}>Cancel</Button>
                <Button size="sm" disabled={busy || conflict} onClick={() => { void mutate(() => client.triggers.runSentinelTodoNow(owner.ownerWorkspaceId, owner.processId, runNow.id, runNow.revision)); }}>Confirm run now</Button>
            </div>
            {error && <p role="alert">{error} <Button size="sm" variant="secondary" disabled={busy} onClick={() => {
                if (conflict) { refresh(); setRunNow(null); } else if (retry.current) void retry.current();
            }}>{conflict ? 'Refresh rules' : 'Retry run now'}</Button></p>}
        </Dialog>}
    </div>;
}
