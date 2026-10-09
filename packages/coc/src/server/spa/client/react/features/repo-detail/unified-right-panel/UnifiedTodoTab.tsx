/**
 * UnifiedTodoTab — a Sentinel chat's to-do ledger in the unified right panel.
 *
 * A compact list over the owning server's ledger (`client.sentinelTodos`),
 * refreshed by that server's `sentinel-todos-changed` events. Every write
 * carries the item revision it was based on; a conflict reloads the current
 * ledger and keeps whatever the user typed. Nothing here starts, retries, or
 * cancels a job — job links only navigate.
 */

import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react';
import type {
    SentinelTodoItem,
    SentinelTodoLedgerResponse,
    SentinelTodoPriority,
    SentinelTodoStatus,
    UpdateSentinelTodoRequest,
} from '@plusplusoneplusplus/coc-client';
import { useCocClient } from '../../../repos/cloneRouting';
import { Button } from '../../../ui/Button';
import { Spinner } from '../../../ui/Spinner';
import { cn } from '../../../ui/cn';
import { formatRelativeTime } from '../../../utils/format';
import { useSentinelTodoEvents } from './sentinelTodoChats';
import {
    SENTINEL_TODO_PRIORITIES,
    SENTINEL_TODO_PRIORITY_LABELS,
    SENTINEL_TODO_STATUS_LABELS,
    SENTINEL_TODO_STATUSES,
    sentinelTodoJobStateLabel,
    sentinelTodoPriority,
    sentinelTodoReviewLabel,
    sentinelTodoSaveError,
    sentinelTodoSections,
    sentinelTodoStatusReason,
    type SentinelTodoOwner,
} from './sentinelTodoPanelModel';

export interface UnifiedTodoTabProps {
    owner: SentinelTodoOwner;
    onErrorChange?: (hasError: boolean) => void;
}

type Draft = { title: string; completionCondition: string; notes: string; priority: SentinelTodoPriority };
const EMPTY_DRAFT: Draft = { title: '', completionCondition: '', notes: '', priority: 'regular' };

const STATUS_STYLES: Readonly<Record<SentinelTodoStatus, { dot: string; badge: string; mark: string }>> = {
    todo: { dot: 'border border-current', badge: 'bg-[#848484]/15 text-[#616161] dark:text-[#bbbbbb]', mark: '○' },
    in_progress: { dot: 'bg-current', badge: 'bg-[#0078d4]/15 text-[#0078d4] dark:text-[#3794ff]', mark: '◐' },
    needs_attention: { dot: 'bg-current', badge: 'bg-[#e8912d]/15 text-[#b5650f] dark:text-[#cca700]', mark: '!' },
    done: { dot: 'bg-current', badge: 'bg-[#16825d]/15 text-[#16825d] dark:text-[#89d185]', mark: '✓' },
};

const INPUT = 'w-full rounded border border-[#e0e0e0] bg-white px-2 py-1 text-xs text-[#1e1e1e] focus:outline-none focus:ring-1 focus:ring-[#0078d4] dark:border-[#3c3c3c] dark:bg-[#1e1e1e] dark:text-[#cccccc]';
const MUTED = 'text-[#616161] dark:text-[#9d9d9d]';

function newIdempotencyKey(): string {
    return globalThis.crypto?.randomUUID?.() ?? `todo-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

/** Visible High label beside the status badge, so the red band is never the only signal. */
function HighPriorityBadge({ itemId }: { itemId: string }) {
    return (
        <span className="inline-flex shrink-0 items-center rounded bg-[#f14c4c]/15 px-1.5 py-0.5 text-[11px] font-medium text-[#c72e2e] dark:text-[#f48771]"
            data-testid={`sentinel-todo-priority-high-${itemId}`}>
            <span aria-hidden="true">High</span>
            <span className="sr-only">High priority</span>
        </span>
    );
}

function StatusBadge({ status }: { status: SentinelTodoStatus }) {
    const style = STATUS_STYLES[status];
    return (
        <span className={cn('inline-flex shrink-0 items-center gap-1 rounded px-1.5 py-0.5 text-[11px] font-medium', style.badge)}
            data-testid={`sentinel-todo-status-${status}`}>
            <span aria-hidden="true">{style.mark}</span>
            {SENTINEL_TODO_STATUS_LABELS[status]}
        </span>
    );
}

/** Ledger timestamp: relative text, exact local date/time on hover and for screen readers. */
function TodoTime({ label, iso, testId }: { label: string; iso: string; testId: string }) {
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return null;
    const exact = date.toLocaleString();
    return (
        <span className="whitespace-nowrap" data-testid={testId}>
            {label}{' '}
            <time dateTime={iso} title={exact}>
                <span aria-hidden="true">{formatRelativeTime(iso)}</span>
                <span className="sr-only">{exact}</span>
            </time>
        </span>
    );
}

function Notice({ tone, children, onRetry, testId }: { tone: 'error' | 'info'; children: ReactNode; onRetry?: () => void; testId: string }) {
    return (
        <div role={tone === 'error' ? 'alert' : 'status'} data-testid={testId}
            className={cn('flex items-start gap-2 rounded px-2 py-1.5 text-xs',
                tone === 'error' ? 'bg-[#f14c4c]/10 text-[#c72e2e] dark:text-[#f48771]' : 'bg-[#0078d4]/10 text-[#0b5ea8] dark:text-[#75beff]')}>
            <span className="min-w-0 flex-1">{children}</span>
            {onRetry && <Button size="sm" variant="secondary" onClick={onRetry}>Retry</Button>}
        </div>
    );
}

function DraftFields({ draft, onChange, idPrefix }: { draft: Draft; onChange: (draft: Draft) => void; idPrefix: string }) {
    return (
        <>
            <label className="block text-[11px] font-medium" htmlFor={`${idPrefix}-title`}>Title</label>
            <input id={`${idPrefix}-title`} className={INPUT} value={draft.title} maxLength={200}
                onChange={event => onChange({ ...draft, title: event.target.value })} />
            <label className="block text-[11px] font-medium" htmlFor={`${idPrefix}-condition`}>Done when</label>
            <input id={`${idPrefix}-condition`} className={INPUT} value={draft.completionCondition} maxLength={1000}
                onChange={event => onChange({ ...draft, completionCondition: event.target.value })} />
            <label className="block text-[11px] font-medium" htmlFor={`${idPrefix}-notes`}>Notes</label>
            <textarea id={`${idPrefix}-notes`} className={cn(INPUT, 'min-h-[48px]')} value={draft.notes} maxLength={8000}
                onChange={event => onChange({ ...draft, notes: event.target.value })} />
            <label className="block text-[11px] font-medium" htmlFor={`${idPrefix}-priority`}>Priority</label>
            <select id={`${idPrefix}-priority`} className={cn(INPUT, 'w-auto self-start')} value={draft.priority}
                onChange={event => onChange({ ...draft, priority: event.target.value as SentinelTodoPriority })}>
                {SENTINEL_TODO_PRIORITIES.map(priority => (
                    <option key={priority} value={priority}>{SENTINEL_TODO_PRIORITY_LABELS[priority]}</option>
                ))}
            </select>
        </>
    );
}

export function UnifiedTodoTab({ owner, onErrorChange }: UnifiedTodoTabProps) {
    const client = useCocClient(owner.ownerRoutingRef === null ? undefined : owner.ownerRoutingRef ?? owner.ownerWorkspaceId);
    const [ledger, setLedger] = useState<SentinelTodoLedgerResponse | null>(null);
    const [loadError, setLoadError] = useState<string | null>(null);
    const [adding, setAdding] = useState(false);
    const [addDraft, setAddDraft] = useState<Draft>(EMPTY_DRAFT);
    const [addError, setAddError] = useState<string | null>(null);
    const [saving, setSaving] = useState(false);
    const addKeyRef = useRef<string | null>(null);
    const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());
    const [showDone, setShowDone] = useState(false);
    const [showArchived, setShowArchived] = useState(false);

    // A response that lands after the tab's owner changed — or after a newer
    // load started — is discarded rather than painted over the current ledger.
    const loadSeq = useRef(0);
    const ownerKey = `${owner.ownerRoutingRef ?? ''}\n${owner.ownerWorkspaceId}\n${owner.processId}`;
    const load = useCallback(async () => {
        const seq = ++loadSeq.current;
        try {
            const next = await client.sentinelTodos.get(owner.ownerWorkspaceId, owner.processId);
            if (seq !== loadSeq.current) return;
            setLedger(next);
            setLoadError(null);
        } catch (error) {
            if (seq !== loadSeq.current) return;
            setLoadError(error instanceof Error && error.message ? error.message : 'Could not load the to-do list.');
        }
        // `ownerKey` covers the owner fields read above.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [client, ownerKey]);

    useEffect(() => {
        setLedger(null);
        setLoadError(null);
        void load();
        return () => { loadSeq.current += 1; };
    }, [load]);
    useSentinelTodoEvents(owner, () => { void load(); });

    useEffect(() => { onErrorChange?.(loadError !== null); }, [loadError, onErrorChange]);

    const sections = useMemo(() => sentinelTodoSections(ledger?.items ?? []), [ledger]);

    const submitAdd = useCallback(async (event?: FormEvent) => {
        event?.preventDefault();
        if (!addDraft.title.trim() || saving) return;
        // One key per draft: a retry after a lost response returns the first item.
        addKeyRef.current ??= newIdempotencyKey();
        setSaving(true);
        setAddError(null);
        try {
            await client.sentinelTodos.create(owner.ownerWorkspaceId, owner.processId, {
                title: addDraft.title.trim(),
                completionCondition: addDraft.completionCondition.trim(),
                notes: addDraft.notes,
                priority: addDraft.priority,
                idempotencyKey: addKeyRef.current,
            });
            addKeyRef.current = null;
            setAddDraft(EMPTY_DRAFT);
            setAdding(false);
            await load();
        } catch (error) {
            setAddError(sentinelTodoSaveError(error).message);
        } finally {
            setSaving(false);
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [addDraft, saving, client, ownerKey, load]);

    /** Apply a patch; resolves to an error message, or null on success. */
    const saveItem = useCallback(async (
        item: SentinelTodoItem,
        patch: Omit<UpdateSentinelTodoRequest, 'expectedRevision'>,
        expectedRevision = item.revision,
    ): Promise<{ message: string; conflict: boolean; current?: SentinelTodoItem } | null> => {
        try {
            await client.sentinelTodos.update(owner.ownerWorkspaceId, owner.processId, item.id, { expectedRevision, ...patch });
            await load();
            return null;
        } catch (error) {
            const failure = sentinelTodoSaveError(error);
            if (failure.conflict) await load();
            const current = (error as { body?: { current?: SentinelTodoItem } }).body?.current;
            return { ...failure, ...(current ? { current } : {}) };
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [client, ownerKey, load]);

    const toggle = useCallback((id: string) => {
        setExpanded(prev => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id); else next.add(id);
            return next;
        });
    }, []);

    const renderList = (items: readonly SentinelTodoItem[]) => (
        <ul className="flex flex-col gap-1" role="list">
            {items.map(item => (
                <TodoRow key={item.id} item={item} expanded={expanded.has(item.id)}
                    onToggle={() => toggle(item.id)} onSave={saveItem} />
            ))}
        </ul>
    );

    const addForm = adding ? (
        <form className="flex flex-col gap-1 rounded border border-[#e0e0e0] p-2 dark:border-[#3c3c3c]"
            onSubmit={event => { void submitAdd(event); }} data-testid="sentinel-todo-add-form">
            <DraftFields draft={addDraft} onChange={setAddDraft} idPrefix="sentinel-todo-add" />
            {addError && <Notice tone="error" testId="sentinel-todo-add-error" onRetry={() => { void submitAdd(); }}>{addError}</Notice>}
            <div className="flex justify-end gap-1 pt-1">
                <Button size="sm" variant="secondary" onClick={() => { setAdding(false); setAddError(null); }}>Cancel</Button>
                <Button size="sm" type="submit" disabled={!addDraft.title.trim()} loading={saving}>Add</Button>
            </div>
        </form>
    ) : null;

    return (
        <div className="flex h-full flex-col gap-2 overflow-auto p-2 text-xs text-[#1e1e1e] dark:text-[#cccccc]" data-testid="sentinel-todo-tab">
            <div className="flex items-center justify-between gap-2">
                <span className="font-semibold">To-do</span>
                {!adding && ledger && ledger.items.length > 0 && (
                    <Button size="sm" variant="secondary" onClick={() => setAdding(true)} data-testid="sentinel-todo-add">Add item</Button>
                )}
            </div>
            {loadError && (
                <Notice tone="error" testId="sentinel-todo-load-error" onRetry={() => { void load(); }}>
                    Could not load the to-do list: {loadError}
                </Notice>
            )}
            {addForm}
            {ledger === null ? (
                !loadError && (
                    <div className={cn('flex items-center gap-2 p-2', MUTED)} role="status" data-testid="sentinel-todo-loading">
                        <Spinner size="sm" /> Loading to-do items…
                    </div>
                )
            ) : ledger.items.length === 0 ? (
                !adding && (
                    <div className={cn('flex flex-col items-start gap-2 p-2', MUTED)} data-testid="sentinel-todo-empty">
                        <span>Nothing is tracked yet. Sentinel records concrete work requests, agreed next actions,
                            and the jobs it delegates for them here; you can add items too.</span>
                        <Button size="sm" onClick={() => setAdding(true)}>Add item</Button>
                    </div>
                )
            ) : (
                <>
                    {sections.active.length > 0
                        ? renderList(sections.active)
                        : <span className={MUTED} data-testid="sentinel-todo-no-active">No active items.</span>}
                    {sections.done.length > 0 && (
                        <Section label="Done" count={sections.done.length} open={showDone} onToggle={() => setShowDone(v => !v)} testId="sentinel-todo-done-section">
                            {renderList(sections.done)}
                        </Section>
                    )}
                    {sections.archived.length > 0 && (
                        <Section label="Archived" count={sections.archived.length} open={showArchived} onToggle={() => setShowArchived(v => !v)} testId="sentinel-todo-archived-section">
                            {renderList(sections.archived)}
                        </Section>
                    )}
                </>
            )}
        </div>
    );
}

function Section({ label, count, open, onToggle, testId, children }: {
    label: string; count: number; open: boolean; onToggle: () => void; testId: string; children: ReactNode;
}) {
    return (
        <div data-testid={testId}>
            <button type="button" aria-expanded={open} onClick={onToggle}
                className="flex w-full items-center gap-1 rounded px-1 py-0.5 text-left font-medium hover:bg-black/[0.04] focus:outline-none focus-visible:ring-1 focus-visible:ring-[#0078d4] dark:hover:bg-white/[0.04]">
                <span aria-hidden="true">{open ? '▾' : '▸'}</span>
                {label} ({count})
            </button>
            {open && <div className="pt-1">{children}</div>}
        </div>
    );
}

type SaveItem = (
    item: SentinelTodoItem,
    patch: Omit<UpdateSentinelTodoRequest, 'expectedRevision'>,
    expectedRevision?: number,
) => Promise<{ message: string; conflict: boolean; current?: SentinelTodoItem } | null>;

function TodoRow({ item, expanded, onToggle, onSave }: {
    item: SentinelTodoItem; expanded: boolean; onToggle: () => void; onSave: SaveItem;
}) {
    const [editing, setEditing] = useState<(Draft & { baseRevision: number }) | null>(null);
    const [statusDraft, setStatusDraft] = useState<{ status: SentinelTodoStatus; reason: string } | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [busy, setBusy] = useState(false);
    const lastAction = useRef<(() => Promise<void>) | null>(null);

    const run = async (action: () => Promise<{ message: string; conflict: boolean; current?: SentinelTodoItem } | null>,
        onDone: () => void, onConflict?: (current?: SentinelTodoItem) => void) => {
        const attempt = async () => {
            setBusy(true);
            setError(null);
            const failure = await action();
            setBusy(false);
            if (!failure) { onDone(); return; }
            setError(failure.message);
            if (failure.conflict) onConflict?.(failure.current);
        };
        lastAction.current = attempt;
        await attempt();
    };

    const saveEdit = (event: FormEvent) => {
        event.preventDefault();
        if (!editing || !editing.title.trim()) return;
        const draft = editing;
        void run(() => onSave(item, {
            title: draft.title.trim(),
            completionCondition: draft.completionCondition.trim(),
            notes: draft.notes,
            priority: draft.priority,
        }, draft.baseRevision), () => setEditing(null),
        // Keep the typed text; the next save is knowingly based on the newer revision.
        current => setEditing(prev => prev && { ...prev, baseRevision: current?.revision ?? prev.baseRevision }));
    };

    const applyStatus = (status: SentinelTodoStatus, reason: string, confirmed = false) => {
        const rule = sentinelTodoStatusReason(status);
        if (rule && !confirmed && !reason.trim()) {
            setStatusDraft({ status, reason });
            return;
        }
        if (rule === 'required' && !reason.trim()) return;
        void run(() => onSave(item, {
            status,
            statusReason: reason.trim() ? reason.trim() : null,
            ...(status === 'done' && reason.trim() ? { outcome: reason.trim() } : {}),
        }), () => setStatusDraft(null));
    };

    const titleId = `sentinel-todo-${item.id}-title`;
    const high = sentinelTodoPriority(item) === 'high';
    // Every row reserves the band's gutter, so changing priority never shifts content.
    return (
        <li className="relative rounded border border-[#e0e0e0] pl-1 dark:border-[#3c3c3c]" data-testid={`sentinel-todo-row-${item.id}`}
            data-priority={high ? 'high' : 'regular'}>
            {high && (
                <span aria-hidden="true" data-testid={`sentinel-todo-priority-band-${item.id}`}
                    className="pointer-events-none absolute inset-y-0 left-0 w-1 rounded-l-[3px] bg-[#e51400] dark:bg-[#f14c4c]" />
            )}
            <button type="button" aria-expanded={expanded} aria-controls={`sentinel-todo-${item.id}-details`} onClick={onToggle}
                className="flex w-full items-start gap-2 px-2 py-1.5 text-left hover:bg-black/[0.04] focus:outline-none focus-visible:ring-1 focus-visible:ring-[#0078d4] dark:hover:bg-white/[0.04]">
                <StatusBadge status={item.status} />
                {high && <HighPriorityBadge itemId={item.id} />}
                <span id={titleId} className={cn('min-w-0 flex-1 break-words', item.archived && 'line-through opacity-70')}>{item.title}</span>
                {item.targetRepo && (
                    <span className={cn('shrink-0 truncate', MUTED)} title={item.targetRepo.workspaceId}>
                        {item.targetRepo.label ?? item.targetRepo.workspaceId}
                    </span>
                )}
            </button>
            <div className={cn('flex flex-wrap gap-x-2 gap-y-0.5 px-2 pb-1.5 text-[11px]', MUTED)} data-testid={`sentinel-todo-times-${item.id}`}>
                <TodoTime label="Created" iso={item.createdAt} testId={`sentinel-todo-created-${item.id}`} />
                <TodoTime label="Updated" iso={item.updatedAt} testId={`sentinel-todo-updated-${item.id}`} />
            </div>
            {item.jobs.length > 0 && (
                <ul className="flex flex-col gap-0.5 px-2 pb-1.5" aria-label={`Jobs for ${item.title}`}>
                    {item.jobs.map(job => {
                        const review = sentinelTodoReviewLabel(job);
                        const external = /^https?:\/\//i.test(job.openLink);
                        return (
                            <li key={`${job.serverId ?? ''}:${job.processId}`} className="flex flex-wrap items-center gap-1">
                                <a href={job.openLink} className="text-[#0078d4] hover:underline focus:outline-none focus-visible:ring-1 focus-visible:ring-[#0078d4] dark:text-[#3794ff]"
                                    {...(external ? { target: '_blank', rel: 'noopener noreferrer' } : {})}>
                                    {job.title ?? job.processId}
                                </a>
                                {job.workspaceId && <span className={MUTED}>· {job.serverId ? `${job.workspaceId} @ ${job.serverId}` : job.workspaceId}</span>}
                                <span className={MUTED}>· {sentinelTodoJobStateLabel(job)}</span>
                                {review && <span className={MUTED}>· {review}</span>}
                            </li>
                        );
                    })}
                </ul>
            )}
            {expanded && (
                <div id={`sentinel-todo-${item.id}-details`} className="flex flex-col gap-1.5 border-t border-[#e0e0e0] px-2 py-1.5 dark:border-[#3c3c3c]">
                    {error && (
                        <Notice tone="error" testId={`sentinel-todo-row-error-${item.id}`}
                            onRetry={lastAction.current ? () => { void lastAction.current?.(); } : undefined}>{error}</Notice>
                    )}
                    {editing ? (
                        <form className="flex flex-col gap-1" onSubmit={saveEdit} data-testid={`sentinel-todo-edit-form-${item.id}`}>
                            <DraftFields draft={editing} onChange={draft => setEditing({ ...editing, ...draft })} idPrefix={`sentinel-todo-edit-${item.id}`} />
                            <div className="flex justify-end gap-1 pt-1">
                                <Button size="sm" variant="secondary" onClick={() => { setEditing(null); setError(null); }}>Cancel</Button>
                                <Button size="sm" type="submit" disabled={!editing.title.trim()} loading={busy}>Save</Button>
                            </div>
                        </form>
                    ) : (
                        <dl className="grid grid-cols-[auto_1fr] gap-x-2 gap-y-1">
                            <dt className={MUTED}>Done when</dt>
                            <dd className="whitespace-pre-wrap break-words">{item.completionCondition || <span className={MUTED}>Not set</span>}</dd>
                            {item.notes && <><dt className={MUTED}>Notes</dt><dd className="whitespace-pre-wrap break-words">{item.notes}</dd></>}
                            {item.statusReason && <><dt className={MUTED}>Reason</dt><dd className="whitespace-pre-wrap break-words">{item.statusReason}</dd></>}
                            {item.outcome && (
                                <><dt className={MUTED}>Outcome</dt>
                                    <dd className="whitespace-pre-wrap break-words" data-testid={`sentinel-todo-outcome-${item.id}`}>
                                        {item.outcome.summary} <span className={MUTED}>({item.outcome.recordedBy === 'user' ? 'you' : item.outcome.recordedBy})</span>
                                    </dd></>
                            )}
                        </dl>
                    )}
                    {statusDraft && (
                        <form className="flex flex-col gap-1" data-testid={`sentinel-todo-reason-form-${item.id}`}
                            onSubmit={event => { event.preventDefault(); applyStatus(statusDraft.status, statusDraft.reason, true); }}>
                            <label className="text-[11px] font-medium" htmlFor={`sentinel-todo-${item.id}-reason`}>
                                Reason for {SENTINEL_TODO_STATUS_LABELS[statusDraft.status]}
                                {sentinelTodoStatusReason(statusDraft.status) === 'optional' && <span className={MUTED}> (optional)</span>}
                            </label>
                            <input id={`sentinel-todo-${item.id}-reason`} className={INPUT} value={statusDraft.reason} maxLength={2000} autoFocus
                                onChange={event => setStatusDraft({ ...statusDraft, reason: event.target.value })} />
                            <div className="flex justify-end gap-1">
                                <Button size="sm" variant="secondary" onClick={() => setStatusDraft(null)}>Cancel</Button>
                                <Button size="sm" type="submit" disabled={sentinelTodoStatusReason(statusDraft.status) === 'required' && !statusDraft.reason.trim()} loading={busy}>Set status</Button>
                            </div>
                        </form>
                    )}
                    {!editing && !statusDraft && (
                        <div className="flex flex-wrap items-center gap-1">
                            {!item.archived && (
                                <>
                                    <label className="sr-only" htmlFor={`sentinel-todo-${item.id}-status`}>Status</label>
                                    <select id={`sentinel-todo-${item.id}-status`} className={cn(INPUT, 'w-auto')} value={item.status} disabled={busy}
                                        onChange={event => applyStatus(event.target.value as SentinelTodoStatus, '')}>
                                        {SENTINEL_TODO_STATUSES.map(status => (
                                            <option key={status} value={status}>{SENTINEL_TODO_STATUS_LABELS[status]}</option>
                                        ))}
                                    </select>
                                    <Button size="sm" variant="secondary" disabled={busy} onClick={() => setEditing({
                                        title: item.title, completionCondition: item.completionCondition, notes: item.notes,
                                        priority: sentinelTodoPriority(item), baseRevision: item.revision,
                                    })}>Edit</Button>
                                    {item.status === 'done' && (
                                        <Button size="sm" variant="secondary" disabled={busy} onClick={() => applyStatus('todo', '')}>Reopen</Button>
                                    )}
                                </>
                            )}
                            <Button size="sm" variant="secondary" disabled={busy}
                                onClick={() => { void run(() => onSave(item, { archived: !item.archived }), () => {}); }}>
                                {item.archived ? 'Restore' : 'Archive'}
                            </Button>
                        </div>
                    )}
                </div>
            )}
        </li>
    );
}
