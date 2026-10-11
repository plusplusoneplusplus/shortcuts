import { useEffect, useId, useRef, useState } from 'react';
import type { CocClient, PrTriggerPreview, SentinelTodoItem, SentinelTodoTriggerInput, Trigger, WorkspaceInfo } from '@plusplusoneplusplus/coc-client';
import { Dialog } from '../../../ui/Dialog';
import { Button } from '../../../ui/Button';
import { resolveCanonicalOriginId } from '../../../repos/originScope';
import { type SentinelTodoOwner } from './sentinelTodoPanelModel';
import { eligibleTriggerItems, triggerError } from './sentinelTodoTriggerModel';

export function SentinelTodoTriggerEditor({ client, owner, items, trigger, onClose, onSaved, onConflict }: {
    client: CocClient; owner: SentinelTodoOwner; items: readonly SentinelTodoItem[]; trigger?: Trigger;
    onClose: () => void; onSaved: () => void; onConflict: () => void;
}) {
    const id = useId();
    const eligible = eligibleTriggerItems(items);
    const [itemId, setItemId] = useState(trigger?.binding?.itemId ?? eligible[0]?.id ?? '');
    const [prUrl, setPrUrl] = useState(trigger?.event.monitor === 'pr-merged' ? trigger.event.pr.url : '');
    const [instruction, setInstruction] = useState(trigger?.binding?.instruction ?? '');
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
        if (!prUrl.trim()) return;
        const timer = setTimeout(() => {
            void client.triggers.previewSentinelTodo(owner.ownerWorkspaceId, owner.processId, { prUrl: prUrl.trim() })
                .then(result => { if (current) setPreview(result); })
                .catch(failure => { if (current) setPreviewError(triggerError(failure).message); });
        }, 300);
        return () => { current = false; clearTimeout(timer); };
    }, [client, owner.ownerWorkspaceId, owner.processId, prUrl, previewRetry]);

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
        if (savingRef.current || conflict || !preview || !eligible.some(item => item.id === itemId)) return;
        if (runNow ? !unchanged || preview.snapshot.status !== 'merged' : preview.snapshot.status !== 'open' && preview.snapshot.status !== 'draft') return;
        savingRef.current = true;
        setSaving(true);
        setError(null);
        const input: SentinelTodoTriggerInput = { itemId, prUrl: prUrl.trim(), instruction, ...picked };
        try {
            if (trigger && runNow) {
                await client.triggers.runSentinelTodoNow(owner.ownerWorkspaceId, owner.processId, trigger.id, trigger.revision);
            } else if (trigger) {
                await client.triggers.editSentinelTodo(owner.ownerWorkspaceId, owner.processId, trigger.id, { ...input, expectedRevision: trigger.revision });
            } else {
                await client.triggers.createSentinelTodo(owner.ownerWorkspaceId, owner.processId, { ...input, idempotencyKey, ...(runNow ? { runNow: true, confirmed: true as const } : {}) });
            }
            onSaved();
        } catch (failure) {
            const detail = triggerError(failure);
            setError(detail.message);
            if (detail.conflict) { setConflict(true); onConflict(); }
        } finally {
            savingRef.current = false;
            setSaving(false);
            setConfirmRun(false);
        }
    };
    const status = preview?.snapshot.status;
    const canSave = !!preview && (status === 'open' || status === 'draft') && eligible.some(item => item.id === itemId) && !conflict;
    const unchanged = !trigger || itemId === trigger.binding?.itemId && instruction === (trigger.binding.instruction ?? '')
        && trigger.event.monitor === 'pr-merged' && prUrl.trim() === trigger.event.pr.url;

    return <Dialog open onClose={() => { if (!saving) onClose(); }} title={trigger ? 'Edit trigger' : 'Add trigger'}>
        <form className="sentinel-trigger-editor" onSubmit={event => { event.preventDefault(); if (canSave) void save(); }}>
            <p className="sentinel-trigger-muted">When this PR merges, post a start message to this Sentinel. Never expires; the Sentinel chooses how to launch the job.</p>
            <label htmlFor={`${id}-item`}>To-do item</label>
            <select id={`${id}-item`} value={itemId} onChange={event => { setItemId(event.target.value); setConfirmRun(false); }}>
                <option value="">Select an item</option>
                {eligible.map(item => <option key={item.id} value={item.id}>{item.title}</option>)}
            </select>
            {!eligible.length && <p role="status">Add a normal, active to-do item first.</p>}
            <label htmlFor={`${id}-url`}>PR URL</label>
            <input id={`${id}-url`} type="url" required value={prUrl} onChange={event => { setPrUrl(event.target.value); setPicked(null); setConfirmRun(false); }} />
            <Button size="sm" variant="secondary" onClick={() => setWorkspaces([])}>Pick a local PR</Button>
            {workspaces !== null && <div className="sentinel-trigger-picker">
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
            {preview && <div className="sentinel-trigger-preview" role="status"><strong>{preview.snapshot.title}</strong> · {status}
                {status === 'merged' && <p>Already merged. {unchanged ? 'Use Run now to post the start message immediately.' : 'Run now uses the saved rule. Restore its fields or choose an open PR to save your edits.'}</p>}
                {status === 'closed' && <p>Closed, not merged. This PR cannot arm a trigger.</p>}
            </div>}
            <label htmlFor={`${id}-instruction`}>When it fires (optional)</label>
            <textarea id={`${id}-instruction`} rows={3} value={instruction} onChange={event => { setInstruction(event.target.value); setConfirmRun(false); }} />
            {error && <p role="alert">{error} {conflict
                ? <Button size="sm" variant="secondary" onClick={() => { onConflict(); onClose(); }}>Refresh rules</Button>
                : <Button size="sm" variant="secondary" onClick={() => { if (status === 'merged') setConfirmRun(true); else void save(); }}>Retry save</Button>}</p>}
            {confirmRun && <div role="alert" className="sentinel-trigger-preview">
                <p>Post the start message to the Sentinel now? This uses up the rule.</p>
                <Button size="sm" variant="secondary" onClick={() => setConfirmRun(false)}>Cancel run now</Button>
                <Button size="sm" disabled={saving} onClick={() => { void save(true); }}>Confirm run now</Button>
            </div>}
            <div className="sentinel-trigger-actions">
                <Button size="sm" variant="secondary" disabled={saving} onClick={onClose}>Cancel</Button>
                {status === 'merged' && <Button size="sm" disabled={conflict || saving || !unchanged || !eligible.some(item => item.id === itemId)} onClick={() => setConfirmRun(true)}>Run now</Button>}
                <Button size="sm" type="submit" disabled={!canSave || saving} loading={saving}>Save and arm</Button>
            </div>
        </form>
    </Dialog>;
}
