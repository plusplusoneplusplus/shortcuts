import { useEffect, useId, useRef, useState } from 'react';
import type {
    SentinelTodoDependency, SentinelTodoDependencyEvaluation, SentinelTodoItem,
} from '@plusplusoneplusplus/coc-client';
import { useCocClient } from '../../../repos/cloneRouting';
import { isFeatureEnabled } from '../../../utils/config';
import { Button } from '../../../ui/Button';
import { sentinelTodoDependencyChain, sentinelTodoOwnerKey, sentinelTodoSaveError, type SentinelTodoOwner } from './sentinelTodoPanelModel';

const INPUT = 'w-full rounded border border-[#e0e0e0] bg-white px-2 py-1 text-xs dark:border-[#3c3c3c] dark:bg-[#1e1e1e]';
const MUTED = 'text-[#616161] dark:text-[#9d9d9d]';

interface Props {
    owner: SentinelTodoOwner;
    item: SentinelTodoItem;
    items: readonly SentinelTodoItem[];
    ledgerRevision: number;
    expanded: boolean;
    onLedgerChange: () => void | Promise<void>;
    onItemLink: (itemId: string) => void;
    onArtifactLink: (reference: string) => void;
}

function conditionLabel(edge: SentinelTodoDependency): string {
    switch (edge.condition.kind) {
        case 'done': return 'Explicit Done';
        case 'pr_merge': return `Verified PR merge (${edge.condition.outputSlot})`;
        case 'accepted_artifact': return `Accepted ${edge.condition.phase} artifact`;
    }
}

function validEdges(edges: readonly SentinelTodoDependency[]): boolean {
    return edges.every(edge => {
        const condition = edge.condition;
        return condition.kind === 'done' || (condition.kind === 'pr_merge' ? !!condition.outputSlot.trim()
            : !!condition.phase.trim() && !!condition.reference.trim() && /^sha256:[0-9a-f]{64}$/.test(condition.version));
    });
}

/** An owner remount discards local drafts and invalidates every pending request. */
export function SentinelTodoDependencies(props: Props) {
    if (!isFeatureEnabled('sentinelTodoDependenciesEnabled')) return null;
    return <DependencyDetails key={`${sentinelTodoOwnerKey(props.owner)}\n${props.item.id}`} {...props} />;
}

function DependencyDetails({ owner, item, items, ledgerRevision, expanded, onLedgerChange, onItemLink, onArtifactLink }: Props) {
    const client = useCocClient(owner.ownerRoutingRef);
    const id = useId();
    const [evaluation, setEvaluation] = useState<SentinelTodoDependencyEvaluation | null>(null);
    const [readError, setReadError] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [conflictRevision, setConflictRevision] = useState<number | null>(null);
    const [busy, setBusy] = useState(false);
    const [editing, setEditing] = useState(false);
    const [baseRevision, setBaseRevision] = useState(item.revision);
    const [draft, setDraft] = useState<SentinelTodoDependency[]>(item.dependsOn ?? []);
    const [prerequisite, setPrerequisite] = useState('');
    const [refresh, setRefresh] = useState(0);
    const [binding, setBinding] = useState<{
        itemId: string; revision: number; outputSlot: string; url: string; reason: string;
    } | null>(null);
    const live = useRef(true);
    const mutationGeneration = useRef(0);
    const readSequence = useRef(0);
    useEffect(() => { live.current = true; return () => {
        live.current = false; readSequence.current += 1; mutationGeneration.current += 1;
    }; }, [client]);
    useEffect(() => {
        if (!editing) {
            setDraft(item.dependsOn ?? []);
            setBaseRevision(item.revision);
        }
    }, [item.revision, item.dependsOn, editing]);
    useEffect(() => {
        const sequence = ++readSequence.current;
        const controller = new AbortController();
        setEvaluation(null);
        setReadError(null);
        if ((item.dependsOn?.length ?? 0) > 0) {
            client.sentinelTodos.evaluateDependencies(owner.ownerWorkspaceId, owner.processId, item.id, { signal: controller.signal })
                .then(value => {
                    if (live.current && sequence === readSequence.current) {
                        if (value.itemId !== item.id || value.itemRevision !== item.revision) {
                            setReadError('Readiness changed while loading. Refresh the ledger.');
                        } else setEvaluation(value);
                    }
                }).catch(failure => {
                    if (!controller.signal.aborted && live.current && sequence === readSequence.current) {
                        setReadError(failure instanceof Error ? failure.message : String(failure));
                    }
                });
        }
        return () => { controller.abort(); readSequence.current += 1; };
    }, [client, owner.ownerWorkspaceId, owner.processId, item.id, item.revision, ledgerRevision, refresh]);

    const selected = new Set(draft.map(edge => edge.itemId));
    const choices = items.filter(source => source.id !== item.id && !source.archived && !selected.has(source.id));
    const isManual = item.type === 'manual';
    const hasDependencies = (item.dependsOn?.length ?? 0) > 0;
    const action = item.dependencyAction;
    const state = evaluation?.state === 'ready'
        ? (isManual || (action?.state === 'authorized' && item.dependencyReadiness?.state !== 'needs_approval') ? 'Ready' : 'Needs approval')
        : 'Waiting';
    const saveFailure = (failure: unknown) => {
        setError(sentinelTodoSaveError(failure).message);
        const current = typeof failure === 'object' && failure !== null && 'body' in failure
            ? (failure as { body?: { current?: SentinelTodoItem } }).body?.current : undefined;
        if (current && current.id === (binding?.itemId ?? item.id)) setConflictRevision(current.revision);
    };
    const saveDependencies = async () => {
        const generation = mutationGeneration.current;
        setBusy(true); setError(null); setConflictRevision(null);
        try {
            await client.sentinelTodos.setDependencies(owner.ownerWorkspaceId, owner.processId, item.id, {
                expectedRevision: baseRevision, dependsOn: draft,
            });
            if (!live.current || generation !== mutationGeneration.current) return;
            setEditing(false);
            await onLedgerChange();
        } catch (failure) {
            if (live.current && generation === mutationGeneration.current) saveFailure(failure);
        } finally { if (live.current && generation === mutationGeneration.current) setBusy(false); }
    };
    const bindOutput = async () => {
        if (!binding) return;
        const generation = mutationGeneration.current;
        setBusy(true); setError(null); setConflictRevision(null);
        try {
            await client.sentinelTodos.bindPrOutput(owner.ownerWorkspaceId, owner.processId, binding.itemId, {
                expectedRevision: binding.revision, outputSlot: binding.outputSlot, prUrl: binding.url.trim(),
                provenance: { kind: 'owner_selection', reason: binding.reason.trim() },
            });
            if (!live.current || generation !== mutationGeneration.current) return;
            setBinding(null); setRefresh(value => value + 1);
            await onLedgerChange();
        } catch (failure) {
            if (live.current && generation === mutationGeneration.current) saveFailure(failure);
        } finally { if (live.current && generation === mutationGeneration.current) setBusy(false); }
    };
    const changeCondition = (index: number, kind: SentinelTodoDependency['condition']['kind']) => {
        setDraft(edges => edges.map((edge, position) => position !== index ? edge : { ...edge, condition:
            kind === 'done' ? { kind } : kind === 'pr_merge' ? { kind, outputSlot: 'implementation' }
                : { kind, phase: 'design', reference: '', version: '' },
        }));
    };
    const updateEdge = (index: number, edge: SentinelTodoDependency) =>
        setDraft(edges => edges.map((current, position) => position === index ? edge : current));
    const updateArtifact = (index: number, field: 'phase' | 'reference' | 'version', value: string) =>
        setDraft(edges => edges.map((edge, position) => position === index && edge.condition.kind === 'accepted_artifact'
            ? { ...edge, condition: { ...edge.condition, [field]: value } } : edge));
    return (
        <section className="flex flex-col gap-1 px-2 text-xs" aria-label={`Dependencies for ${item.title}`} data-testid={`todo-dependencies-${item.id}`}>
            {hasDependencies && <div className="flex flex-wrap items-center gap-1">
                <span className="rounded bg-[#848484]/15 px-1.5 py-0.5" role="status">{evaluation || readError ? state : 'Checking dependencies'}</span>
                {isManual && <span className={MUTED}>Tracking only</span>}
            </div>}
            {expanded && <>
                <div className="flex items-center justify-between gap-1">
                    <strong>Dependencies - ALL required</strong>
                    {!item.archived && !editing && <Button size="sm" variant="ghost" disabled={busy || binding !== null} onClick={() => {
                        setError(null); setConflictRevision(null); setBaseRevision(item.revision);
                        setDraft(item.dependsOn ?? []); setEditing(true);
                    }}>Edit dependencies</Button>}
                </div>
                {!hasDependencies && !editing && <span className={MUTED}>No prerequisites.</span>}
                {hasDependencies && <ol aria-label="Prerequisite evidence" className="flex flex-col gap-1">
                    {(item.dependsOn ?? []).map((edge, index) => {
                        const source = items.find(source => source.id === edge.itemId);
                        const checked = evaluation?.edges[index];
                        const evidenceLink = checked?.evidenceLink;
                        const receipt = source?.evidence?.find(receipt => receipt.kind === 'pr_binding'
                            && edge.condition.kind === 'pr_merge' && receipt.outputSlot === edge.condition.outputSlot);
                        return <li key={edge.itemId} className="rounded border border-[#e0e0e0] p-1.5 dark:border-[#3c3c3c]">
                            <div className="flex flex-wrap items-center gap-1">
                                <span aria-label={checked?.satisfied ? 'Satisfied' : 'Unmet'}>{checked?.satisfied ? 'OK' : 'Pending'}</span>
                                <button type="button" className="text-[#0078d4] underline" disabled={!source} onClick={() => onItemLink(edge.itemId)}>
                                    {source?.title ?? 'Unavailable prerequisite'}
                                </button>
                                <span aria-hidden="true">-&gt;</span><span>{item.title}</span>
                            </div>
                            <div className={MUTED}>{conditionLabel(edge)}</div>
                            {evidenceLink && (edge.condition.kind === 'pr_merge'
                                ? <a href={evidenceLink} target="_blank" rel="noreferrer" className="text-[#0078d4] underline">Evidence</a>
                                : edge.condition.kind === 'accepted_artifact'
                                    ? <button type="button" className="text-[#0078d4] underline" onClick={() => onArtifactLink(evidenceLink)}>Artifact evidence</button>
                                    : null)}
                            {edge.condition.kind === 'pr_merge' && receipt?.kind === 'pr_binding' && <div className={MUTED}>
                                Bound by {receipt.recordedBy}: {receipt.provenance.reason}
                            </div>}
                            {edge.condition.kind === 'accepted_artifact' && <div className="break-all">
                                {edge.condition.reference} - {edge.condition.version}
                            </div>}
                            {checked?.blocker && <div>{checked.blocker}</div>}
                            {edge.condition.kind === 'pr_merge' && !receipt && <span className={MUTED}>URL pending</span>}
                            {edge.condition.kind === 'pr_merge' && source && !source.archived && <Button size="sm" variant="ghost" disabled={busy || editing}
                                onClick={() => { setError(null); setConflictRevision(null); setBinding({
                                    itemId: source.id, revision: source.revision,
                                    outputSlot: edge.condition.kind === 'pr_merge' ? edge.condition.outputSlot : '',
                                    url: receipt?.kind === 'pr_binding' ? receipt.pr.url : '', reason: '',
                                }); }}>{receipt ? 'Rebind PR output' : 'Bind PR output'}</Button>}
                        </li>;
                    })}
                </ol>}
                {hasDependencies && <div className="flex flex-col gap-1">
                    <strong>Chain</strong>
                    <ol aria-label="Dependency chain" className="flex flex-col gap-1 border-l border-[#e0e0e0] pl-2 dark:border-[#3c3c3c]">
                        {sentinelTodoDependencyChain(item.id, items).map(itemId => {
                            const node = items.find(source => source.id === itemId);
                            return <li key={itemId}>
                                <button type="button" disabled={!node} className="text-[#0078d4] underline"
                                    onClick={() => onItemLink(itemId)}>{node?.title ?? 'Unavailable prerequisite'}</button>
                                {(node?.dependsOn?.length ?? 0) > 0 && <span className={MUTED}> Requires: {(node?.dependsOn ?? [])
                                    .map(edge => items.find(source => source.id === edge.itemId)?.title ?? 'Unavailable prerequisite').join(', ')}</span>}
                            </li>;
                        })}
                    </ol>
                </div>}
                {evaluation?.blocker && <div role="note">{evaluation.blocker}</div>}
                {readError && <div role="alert">Evidence unavailable: {readError} <Button size="sm" variant="ghost" onClick={() => setRefresh(value => value + 1)}>Retry evidence read</Button></div>}
                {isManual ? <span className={MUTED}>Tracking only - dependencies never authorize work.</span>
                    : <span className={MUTED}>Readiness is not authorization. Approve actions in the owning conversation.</span>}
                {action && <dl aria-label="Saved action configuration" className="grid grid-cols-[auto_1fr] gap-x-2 gap-y-1 rounded bg-[#848484]/10 p-2">
                    <dt>Mode</dt><dd>{action.mode === 'ask' ? 'Ask' : action.mode === 'ralph' ? 'Ralph' : 'Autopilot'}</dd>
                    <dt>Provider</dt><dd>{action.provider}</dd>
                    <dt>Model</dt><dd className="break-all">{action.model}</dd>
                    <dt>Target workspace</dt><dd className="break-all">{action.targetWorkspaceId}</dd>
                    <dt>Authority</dt><dd>{action.state === 'authorized' ? 'Previously authorized' : action.state === 'revoked' ? 'Revoked'
                        : action.state === 'consumed' ? 'Consumed - fresh approval required to rerun' : 'Blocked - review required'}</dd>
                    <dt>Authorized scope</dt><dd className="whitespace-pre-wrap break-words">{action.scope}</dd>
                </dl>}
                {action?.requiresReview && <div role="alert">Requires review - prerequisite evidence changed after admission. Running work is not cancelled.</div>}
                {(action?.error || item.dependencyReadiness?.error) && <div role="alert">{action?.error ?? item.dependencyReadiness?.error}</div>}
                {editing && <form aria-label="Edit dependencies" className="flex flex-col gap-1" onSubmit={event => { event.preventDefault(); void saveDependencies(); }}>
                    {draft.map((edge, index) => <fieldset key={edge.itemId} className="flex flex-col gap-1 rounded border border-[#e0e0e0] p-2 dark:border-[#3c3c3c]">
                        <legend>{items.find(source => source.id === edge.itemId)?.title ?? 'Unavailable prerequisite'}</legend>
                        <label>Condition<select className={INPUT} value={edge.condition.kind} disabled={busy}
                            onChange={event => {
                                const value = event.target.value;
                                if (value === 'done' || value === 'pr_merge' || value === 'accepted_artifact') changeCondition(index, value);
                            }}>
                            <option value="done">Explicit Done</option><option value="pr_merge">Verified PR merge</option><option value="accepted_artifact">Accepted artifact</option>
                        </select></label>
                        {edge.condition.kind === 'pr_merge' && <label>Future PR output slot<input className={INPUT} value={edge.condition.outputSlot} disabled={busy}
                            onChange={event => updateEdge(index, { ...edge, condition: { kind: 'pr_merge', outputSlot: event.target.value } })} /></label>}
                        {edge.condition.kind === 'accepted_artifact' && <>
                            <label>Artifact phase<input className={INPUT} value={edge.condition.phase} disabled={busy}
                                onChange={event => updateArtifact(index, 'phase', event.target.value)} /></label>
                            <label>Artifact reference<input className={INPUT} value={edge.condition.reference} disabled={busy}
                                onChange={event => updateArtifact(index, 'reference', event.target.value)} /></label>
                            <label>Artifact content version<input className={INPUT} value={edge.condition.version} disabled={busy} placeholder="sha256:..."
                                onChange={event => updateArtifact(index, 'version', event.target.value)} /></label>
                        </>}
                        <Button size="sm" variant="ghost" disabled={busy} onClick={() => setDraft(edges => edges.filter((_, position) => position !== index))}>Remove prerequisite</Button>
                    </fieldset>)}
                    <label htmlFor={`${id}-source`}>Prerequisite</label>
                    <div className="flex items-center gap-1">
                        <select id={`${id}-source`} className={INPUT} value={prerequisite} disabled={busy} onChange={event => setPrerequisite(event.target.value)}>
                            <option value="">Select an item in this ledger</option>
                            {choices.map(source => <option key={source.id} value={source.id}>{source.title}{source.type === 'manual' ? ' (Tracking only)' : ''}</option>)}
                        </select>
                        <Button size="sm" variant="secondary" disabled={busy || !prerequisite || !choices.some(source => source.id === prerequisite)}
                            onClick={() => { setDraft(edges => [...edges, { itemId: prerequisite, condition: { kind: 'done' } }]); setPrerequisite(''); }}>Add prerequisite</Button>
                    </div>
                    <div className="flex justify-end gap-1">
                        <Button size="sm" variant="ghost" disabled={busy} onClick={() => { setEditing(false); setError(null); setConflictRevision(null); }}>Cancel dependency edit</Button>
                        <Button size="sm" type="submit" disabled={busy || !validEdges(draft)}>Save dependencies</Button>
                    </div>
                </form>}
                {binding && <form aria-label="Bind prerequisite PR output" className="flex flex-col gap-1" onSubmit={event => { event.preventDefault(); void bindOutput(); }}>
                    <strong>Bind exact output: {binding.outputSlot}</strong>
                    <label>Produced PR URL<input className={INPUT} value={binding.url} disabled={busy} onChange={event => setBinding({ ...binding, url: event.target.value })} /></label>
                    <label>Output ownership evidence<input className={INPUT} value={binding.reason} disabled={busy} onChange={event => setBinding({ ...binding, reason: event.target.value })} /></label>
                    <span className={MUTED}>Select the exact produced PR. Binding does not prove merge or grant authority.</span>
                    <div className="flex justify-end gap-1">
                        <Button size="sm" variant="ghost" disabled={busy} onClick={() => { setBinding(null); setError(null); setConflictRevision(null); }}>Cancel binding</Button>
                        <Button size="sm" type="submit" disabled={busy || !binding.url.trim() || !binding.reason.trim()}>Save PR binding</Button>
                    </div>
                </form>}
                {error && <div role="alert">{error}</div>}
                {conflictRevision !== null && <Button size="sm" variant="secondary" disabled={busy} onClick={() => {
                    if (binding) setBinding({ ...binding, revision: conflictRevision }); else setBaseRevision(conflictRevision);
                    setConflictRevision(null); setError(null);
                }}>Use current revision and keep draft</Button>}
            </>}
        </section>
    );
}
