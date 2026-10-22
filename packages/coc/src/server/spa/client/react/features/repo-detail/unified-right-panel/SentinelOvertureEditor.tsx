import { useEffect, useId, useRef, useState } from 'react';
import type { CocClient, PrTriggerPreview, SentinelTodoItem, SentinelTodoTriggerInput, Trigger, WorkspaceInfo } from '@plusplusoneplusplus/coc-client';
import { dateTimeCandidates, triggerLocalTime, zonedTriggerTime } from '@plusplusoneplusplus/coc-client';
import { Dialog } from '../../../ui/Dialog';
import { Button } from '../../../ui/Button';
import { resolveCanonicalOriginId } from '../../../repos/originScope';
import { type SentinelTodoOwner } from './sentinelTodoPanelModel';
import { eligibleTriggerItems, triggerError } from './sentinelOvertureModel';

export function SentinelOvertureEditor({ client, owner, items, trigger, onClose, onSaved, onConflict, dateTimeEnabled = false }: {
    client: CocClient; owner: SentinelTodoOwner; items: readonly SentinelTodoItem[]; trigger?: Trigger;
    onClose: () => void; onSaved: () => void; onConflict: () => void;
    dateTimeEnabled?: boolean;
}) {
    const id = useId();
    const eligible = eligibleTriggerItems(items);
    const [itemId, setItemId] = useState(trigger?.binding?.itemId ?? eligible[0]?.id ?? '');
    const [prUrl, setPrUrl] = useState(trigger?.event.monitor === 'pr-merged' ? trigger.event.pr.url : '');
    const [instruction, setInstruction] = useState(trigger?.binding?.instruction ?? '');
    const dateEvent = trigger?.event.type === 'date-time' ? trigger.event : undefined;
    const [kind, setKind] = useState<'pr' | 'date-time'>(dateEvent ? 'date-time' : 'pr');
    useEffect(() => {
        if (!dateTimeEnabled && kind === 'date-time') onClose();
    }, [dateTimeEnabled, kind, onClose]);
    const [timeZone, setTimeZone] = useState(dateEvent?.timeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone);
    const initialLocal = dateEvent ? triggerLocalTime(dateEvent.firesAt, dateEvent.timeZone) : '';
    const [date, setDate] = useState(initialLocal.slice(0, 10));
    const [time, setTime] = useState(initialLocal.slice(11));
    const [choice, setChoice] = useState(dateEvent?.firesAt ?? '');
    const localTime = `${date}T${time}`;
    let candidates: string[] = [];
    let dateError: string | null = null;
    if (kind === 'date-time') {
        try {
            candidates = dateTimeCandidates(localTime, timeZone);
            if (!candidates.length) dateError = 'This local time does not exist (DST gap). Choose another time.';
        } catch (failure) { dateError = failure instanceof Error ? failure.message : String(failure); }
    }
    const firesAt = candidates.length === 1 ? candidates[0] : candidates.includes(choice) ? choice : '';
    if (kind === 'date-time' && !dateError) {
        if (!firesAt) dateError = 'This time occurs twice. Choose an explicit offset.';
        else if (Date.parse(firesAt) <= Date.now()) dateError = 'Choose a future date/time.';
    }
    const live = useRef(true);
    useEffect(() => {
        live.current = true;
        return () => { live.current = false; };
    }, [client, owner.ownerWorkspaceId, owner.processId]);
    const [picked, setPicked] = useState<{ workspaceId: string; originId: string } | null>(() => {
        const pr = trigger?.event.monitor === 'pr-merged' ? trigger.event.pr : null;
        return pr?.workspaceId && pr.originId ? { workspaceId: pr.workspaceId, originId: pr.originId } : null;
    });
    const [preview, setPreview] = useState<PrTriggerPreview | null>(null);
    const [previewError, setPreviewError] = useState<string | null>(null);
    const [previewRetry, setPreviewRetry] = useState(0);
    const [error, setError] = useState<string | null>(null);
    const [conflict, setConflict] = useState(false);
    const [saving, setSaving] = useState(false);
    const savingRef = useRef(false);
    const [idempotencyKey] = useState(() => globalThis.crypto?.randomUUID?.()
        ?? `trigger-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    const [confirmRun, setConfirmRun] = useState(false);
    const [workspaces, setWorkspaces] = useState<WorkspaceInfo[] | null>(null);
    const [pickerError, setPickerError] = useState<string | null>(null);
    const [prs, setPrs] = useState<{ url: string; title: string }[]>([]);
    const [pickerScope, setPickerScope] = useState<{ workspaceId: string; originId: string } | null>(null);
    const [pickerLoading, setPickerLoading] = useState(false);
    const [pickerRetry, setPickerRetry] = useState(0);
    const pickerOpen = workspaces !== null;

    useEffect(() => {
        let current = true;
        setPreview(null);
        setPreviewError(null);
        if (kind !== 'pr' || !prUrl.trim()) return;
        const timer = setTimeout(() => {
            void client.triggers.previewSentinelTodo(owner.ownerWorkspaceId, owner.processId, { prUrl: prUrl.trim() })
                .then(result => { if (current) setPreview(result); })
                .catch(failure => { if (current) setPreviewError(triggerError(failure).message); });
        }, 300);
        return () => { current = false; clearTimeout(timer); };
    }, [client, owner.ownerWorkspaceId, owner.processId, prUrl, previewRetry, kind]);

    // The picker lists clones on the Sentinel's own server, never the page-origin server.
    useEffect(() => {
        if (!pickerOpen) return;
        let current = true;
        setPickerError(null);
        setPickerLoading(true);
        void client.workspaces.list().then(result => {
            if (current) setWorkspaces(result.workspaces.filter(workspace => !workspace.virtual));
        }).catch(failure => {
            if (current) setPickerError(triggerError(failure).message);
        }).finally(() => { if (current) setPickerLoading(false); });
        return () => { current = false; };
    }, [client, pickerOpen, pickerRetry]);

    useEffect(() => {
        if (!pickerScope) return;
        let current = true;
        setPrs([]);
        setPickerError(null);
        setPickerLoading(true);
        void client.pullRequests.listForOrigin(pickerScope.originId, { workspaceId: pickerScope.workspaceId, status: 'open', scope: 'all', top: 100 })
            .then(result => {
                if (!current) return;
                setPrs(result.pullRequests.flatMap(pr => {
                    const url = typeof pr.webUrl === 'string' ? pr.webUrl : typeof pr.url === 'string' ? pr.url : '';
                    return /^https?:\/\//i.test(url) ? [{ url, title: String(pr.title ?? `PR #${pr.number}`) }] : [];
                }));
            }).catch(failure => { if (current) setPickerError(triggerError(failure).message); })
            .finally(() => { if (current) setPickerLoading(false); });
        return () => { current = false; };
    }, [client, pickerScope]);

    const save = async (runNow = false) => {
        if (savingRef.current || conflict || !eligible.some(item => item.id === itemId)) return;
        if (kind === 'date-time') {
            if (!dateTimeEnabled || dateError || !firesAt || runNow) return;
        } else {
            if (!preview) return;
            if (runNow ? !unchanged || preview.snapshot.status !== 'merged' : preview.snapshot.status !== 'open' && preview.snapshot.status !== 'draft') return;
        }
        savingRef.current = true;
        setSaving(true);
        setError(null);
        const input: SentinelTodoTriggerInput = kind === 'date-time'
            ? { itemId, instruction, event: { type: 'date-time', firesAt, timeZone, localTime } }
            : { itemId, prUrl: prUrl.trim(), instruction, ...picked };
        try {
            if (trigger && runNow) {
                await client.triggers.runSentinelTodoNow(owner.ownerWorkspaceId, owner.processId, trigger.id, trigger.revision);
            } else if (trigger) {
                await client.triggers.editSentinelTodo(owner.ownerWorkspaceId, owner.processId, trigger.id, { ...input, expectedRevision: trigger.revision });
            } else {
                await client.triggers.createSentinelTodo(owner.ownerWorkspaceId, owner.processId, { ...input, idempotencyKey, ...(runNow ? { runNow: true, confirmed: true as const } : {}) });
            }
            if (live.current) onSaved();
        } catch (failure) {
            if (!live.current) return;
            const detail = triggerError(failure);
            setError(detail.message);
            if (detail.conflict) { setConflict(true); onConflict(); }
        } finally {
            savingRef.current = false;
            if (live.current) { setSaving(false); setConfirmRun(false); }
        }
    };
    const status = preview?.snapshot.status;
    const canSave = (kind === 'date-time' ? dateTimeEnabled && !!firesAt && !dateError : !!preview && (status === 'open' || status === 'draft'))
        && eligible.some(item => item.id === itemId) && !conflict;
    const unchanged = !trigger || itemId === trigger.binding?.itemId && instruction === (trigger.binding.instruction ?? '')
        && trigger.event.monitor === 'pr-merged' && prUrl.trim() === trigger.event.pr.url;

    return <Dialog open trapFocus disableClose={saving} onClose={() => { if (!saving) onClose(); }} title={trigger ? 'Edit overture' : 'Add overture'}>
        <form className="sentinel-overture-editor" onSubmit={event => { event.preventDefault(); if (canSave) void save(); }}>
            <p className="sentinel-overture-muted">{kind === 'date-time'
                ? 'Wake this Sentinel once at the saved time. This grants no new authorization and never marks the item Done.'
                : 'When this PR merges, post a start message to this Sentinel. Never expires; the Sentinel chooses how to launch the job.'}</p>
            {dateTimeEnabled && <><label htmlFor={`${id}-kind`}>Overture type</label>
                <select id={`${id}-kind`} value={kind} onChange={event => { setKind(event.target.value === 'date-time' ? 'date-time' : 'pr'); setConfirmRun(false); }}>
                    <option value="pr">PR merged</option><option value="date-time">Date/time</option>
                </select></>}
            <label htmlFor={`${id}-item`}>To-do item</label>
            <select id={`${id}-item`} value={itemId} onChange={event => { setItemId(event.target.value); setConfirmRun(false); }}>
                <option value="">Select an item</option>
                {eligible.map(item => <option key={item.id} value={item.id}>{item.title}</option>)}
            </select>
            {!eligible.length && <p role="status">Add a normal, active to-do item first.</p>}
            {kind === 'date-time' ? <>
                <label htmlFor={`${id}-date`}>Date</label>
                <input id={`${id}-date`} type="date" required value={date} onChange={event => { setDate(event.target.value); setChoice(''); }} />
                <label htmlFor={`${id}-time`}>Time</label>
                <input id={`${id}-time`} type="time" required value={time} onChange={event => { setTime(event.target.value); setChoice(''); }} />
                <label htmlFor={`${id}-zone`}>IANA timezone</label>
                <input id={`${id}-zone`} required value={timeZone} onChange={event => { setTimeZone(event.target.value); setChoice(''); }} />
                {candidates.length > 1 && <><label htmlFor={`${id}-offset`}>DST offset</label>
                    <select id={`${id}-offset`} value={choice} onChange={event => setChoice(event.target.value)}>
                        <option value="">Choose an offset</option>
                        {candidates.map(instant => <option key={instant} value={instant}>
                            {new Intl.DateTimeFormat('en', { timeZone, timeZoneName: 'longOffset', hour: '2-digit', minute: '2-digit' }).format(new Date(instant))} - {instant} UTC
                        </option>)}
                    </select></>}
                {dateError && <p role="alert">{dateError}</p>}
                {firesAt && <div role="status" className="sentinel-overture-preview">
                    {zonedTriggerTime(firesAt, timeZone)} ({timeZone})<br />UTC: {firesAt}
                </div>}
            </> : <><label htmlFor={`${id}-url`}>PR URL</label>
            <input id={`${id}-url`} type="url" required value={prUrl} onChange={event => { setPrUrl(event.target.value); setPicked(null); setConfirmRun(false); }} />
            <Button size="sm" variant="secondary" onClick={() => setWorkspaces([])}>Pick a local PR</Button>
            {workspaces !== null && <div className="sentinel-overture-picker">
                <label htmlFor={`${id}-workspace`}>Local workspace on owning server</label>
                <select id={`${id}-workspace`} value={pickerScope?.workspaceId ?? ''} onChange={event => {
                    const workspace = workspaces.find(candidate => candidate.id === event.target.value);
                    setPickerScope(workspace ? { workspaceId: workspace.id, originId: resolveCanonicalOriginId({ workspaceId: workspace.id, remoteUrl: workspace.remoteUrl }) } : null);
                }}>
                    <option value="">Select a workspace</option>
                    {workspaces.map(workspace => <option key={workspace.id} value={workspace.id}>{workspace.name}</option>)}
                </select>
                {pickerLoading && <p role="status">Loading local PRs…</p>}
                {pickerError && <p role="alert">{pickerError} <Button size="sm" variant="secondary" onClick={() => { if (pickerScope) setPickerScope({ ...pickerScope }); else setPickerRetry(value => value + 1); }}>Retry</Button></p>}
                {prs.map(pr => <Button key={pr.url} size="sm" variant="secondary" onClick={() => { setPrUrl(pr.url); setPicked(pickerScope); }}>{pr.title}</Button>)}
                {pickerScope && !pickerLoading && !pickerError && !prs.length && <p>No open PRs found.</p>}
            </div>}
            {prUrl.trim() && !preview && !previewError && <p role="status">Checking PR…</p>}
            {previewError && <p role="alert">{previewError} <Button size="sm" variant="secondary" onClick={() => setPreviewRetry(value => value + 1)}>Retry preview</Button></p>}
            {preview && <div className="sentinel-overture-preview" role="status"><strong>{preview.snapshot.title}</strong> · {status}
                {status === 'merged' && <p>Already merged. {unchanged ? 'Use Run now to post the start message immediately.' : 'Run now uses the saved overture. Restore its fields or choose an open PR to save your edits.'}</p>}
                {status === 'closed' && <p>Closed, not merged. This PR cannot arm an overture.</p>}
            </div>}</>}
            <label htmlFor={`${id}-instruction`}>When it fires (optional)</label>
            <textarea id={`${id}-instruction`} rows={3} value={instruction} onChange={event => { setInstruction(event.target.value); setConfirmRun(false); }} />
            {error && <p role="alert">{error} {conflict
                ? <Button size="sm" variant="secondary" onClick={() => { onConflict(); onClose(); }}>Refresh overtures</Button>
                : <Button size="sm" variant="secondary" onClick={() => { if (status === 'merged') setConfirmRun(true); else void save(); }}>Retry save</Button>}</p>}
            {confirmRun && <div role="alert" className="sentinel-overture-preview">
                <p>Post the start message to the Sentinel now? This uses up the overture.</p>
                <Button size="sm" variant="secondary" onClick={() => setConfirmRun(false)}>Cancel run now</Button>
                <Button size="sm" disabled={saving} onClick={() => { void save(true); }}>Confirm run now</Button>
            </div>}
            <div className="sentinel-overture-actions">
                <Button size="sm" variant="secondary" disabled={saving} onClick={onClose}>Cancel</Button>
                {status === 'merged' && <Button size="sm" disabled={conflict || saving || !unchanged || !eligible.some(item => item.id === itemId)} onClick={() => setConfirmRun(true)}>Run now</Button>}
                <Button size="sm" type="submit" disabled={!canSave || saving} loading={saving}>Save and arm</Button>
            </div>
        </form>
    </Dialog>;
}
