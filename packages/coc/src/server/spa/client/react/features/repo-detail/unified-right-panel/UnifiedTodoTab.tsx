/**
 * UnifiedTodoTab — a Sentinel chat's to-do ledger in the unified right panel.
 *
 * A compact list over the owning server's ledger (`client.sentinelTodos`),
 * refreshed by that server's `sentinel-todos-changed` events. Every write
 * carries the item revision it was based on; a conflict reloads the current
 * ledger and keeps whatever the user typed. Nothing here starts, retries, or
 * cancels a job — job links only navigate. Active normal items come first, then
 * the chat's Manual tracking section with its own add form and groups, then the
 * normal Done and Archived sections.
 */

import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type FormEvent, type MouseEvent, type ReactNode } from 'react';
import type {
    SentinelTodoItem,
    SentinelTodoLedgerResponse,
    SentinelTodoPriority,
    SentinelTodoStatus,
    SentinelTodoType,
    UpdateSentinelTodoRequest,
} from '@plusplusoneplusplus/coc-client';
import { useCocClient } from '../../../repos/cloneRouting';
import { Button } from '../../../ui/Button';
import { Spinner } from '../../../ui/Spinner';
import { cn } from '../../../ui/cn';
import { isSessionContextAttachmentsEnabled } from '../../../utils/config';
import { attachSelectionToChat } from '../../chat/activeChatAttach';
import { createSentinelTodoContextPayload } from '../../chat/sentinelTodoContext';
import { writePointerContextDragData } from '../../chat/sessionContextDrag';
import { resolveCloneRoute } from '../../../repos/cloneRegistry';
import { formatRelativeTime } from '../../../utils/format';
import { getSentinelTodoChat, useSentinelTodoEvents } from './sentinelTodoChats';
import { SentinelTodoTriggers } from './SentinelTodoTriggers';
import {
    endSentinelTodoExcursion,
    isPinnedSentinelTodo,
    recallSentinelTodoView,
    rememberSentinelTodoView,
    startSentinelTodoExcursion,
    useSentinelTodoExcursion,
} from './sentinelTodoExcursion';
import {
    SENTINEL_TODO_PRIORITIES,
    SENTINEL_TODO_PRIORITY_LABELS,
    SENTINEL_TODO_STATUS_LABELS,
    SENTINEL_TODO_STATUSES,
    sentinelTodoJobStateLabel,
    sentinelTodoDisplayStatus,
    sentinelTodoFoldNotes,
    sentinelTodoLineCount,
    sentinelTodoOwnerKey,
    sentinelTodoPriority,
    sentinelTodoReviewLabel,
    sentinelTodoSaveError,
    sentinelTodoSections,
    sentinelTodoStatusReason,
    sentinelTodoType,
    type SentinelTodoOwner,
    type SentinelTodoDisplayStatus,
} from './sentinelTodoPanelModel';

export interface UnifiedTodoTabProps {
    owner: SentinelTodoOwner;
    /**
     * The panel scope and chat the tab is filed under (a pinned tab names the
     * visited chat). Without both, links only navigate.
     */
    scopeWorkspaceId?: string;
    chatId?: string | null;
    onErrorChange?: (hasError: boolean) => void;
}

type FollowLink = (event: MouseEvent<HTMLAnchorElement>, linkKey: string) => void;

type Draft = { title: string; completionCondition: string; notes: string; priority: SentinelTodoPriority };
const EMPTY_DRAFT: Draft = { title: '', completionCondition: '', notes: '', priority: 'regular' };

const STATUS_STYLES: Readonly<Record<SentinelTodoDisplayStatus, { dot: string; badge: string; mark: string }>> = {
    todo: { dot: 'border border-current', badge: 'bg-[#848484]/15 text-[#616161] dark:text-[#bbbbbb]', mark: '○' },
    in_progress: { dot: 'bg-current', badge: 'bg-[#0078d4]/15 text-[#0078d4] dark:text-[#3794ff]', mark: '◐' },
    in_review: { dot: 'border border-current', badge: 'bg-[#8764b8]/15 text-[#7150a2] dark:text-[#c5a5ed]', mark: '◇' },
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

function StatusBadge({ status }: { status: SentinelTodoDisplayStatus }) {
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

/** Marks a Manual tracking field the user may leave blank. */
function Optional({ show }: { show: boolean }) {
    return show ? <span className={cn('font-normal', MUTED)}> (optional)</span> : null;
}

function DraftFields({ draft, onChange, idPrefix, manual = false }: {
    draft: Draft; onChange: (draft: Draft) => void; idPrefix: string; manual?: boolean;
}) {
    return (
        <>
            <label className="block text-[11px] font-medium" htmlFor={`${idPrefix}-title`}>Title</label>
            <input id={`${idPrefix}-title`} className={INPUT} value={draft.title} maxLength={200} required
                onChange={event => onChange({ ...draft, title: event.target.value })} />
            <label className="block text-[11px] font-medium" htmlFor={`${idPrefix}-condition`}>Done when<Optional show={manual} /></label>
            <input id={`${idPrefix}-condition`} className={INPUT} value={draft.completionCondition} maxLength={1000}
                onChange={event => onChange({ ...draft, completionCondition: event.target.value })} />
            <label className="block text-[11px] font-medium" htmlFor={`${idPrefix}-notes`}>Notes<Optional show={manual} /></label>
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

type AddItemFormState = ReturnType<typeof useAddItemForm>;

/**
 * One add form's draft. The draft keeps one idempotency key across retries, so
 * a retry after a lost response returns the first item instead of a duplicate,
 * and a failed save keeps the typed text.
 */
function useAddItemForm(onCreate: (draft: Draft, idempotencyKey: string) => Promise<void>) {
    const [adding, setAdding] = useState(false);
    const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT);
    const [error, setError] = useState<string | null>(null);
    const [saving, setSaving] = useState(false);
    const keyRef = useRef<string | null>(null);
    const submit = async (event?: FormEvent) => {
        event?.preventDefault();
        if (!draft.title.trim() || saving) return;
        keyRef.current ??= newIdempotencyKey();
        setSaving(true);
        setError(null);
        try {
            await onCreate(draft, keyRef.current);
            keyRef.current = null;
            setDraft(EMPTY_DRAFT);
            setAdding(false);
        } catch (failure) {
            setError(sentinelTodoSaveError(failure).message);
        } finally {
            setSaving(false);
        }
    };
    return {
        adding, draft, setDraft, error, saving, submit,
        open: () => setAdding(true),
        cancel: () => { setAdding(false); setError(null); },
    };
}

function AddItemForm({ form, testIdPrefix, label, manual = false }: {
    form: AddItemFormState; testIdPrefix: string; label: string; manual?: boolean;
}) {
    return (
        <form className="flex flex-col gap-1 rounded border border-[#e0e0e0] p-2 dark:border-[#3c3c3c]" aria-label={label}
            onSubmit={event => { void form.submit(event); }} data-testid={`${testIdPrefix}-form`}>
            <DraftFields draft={form.draft} onChange={form.setDraft} idPrefix={testIdPrefix} manual={manual} />
            {form.error && <Notice tone="error" testId={`${testIdPrefix}-error`} onRetry={() => { void form.submit(); }}>{form.error}</Notice>}
            <div className="flex flex-wrap justify-end gap-1 pt-1">
                <Button size="sm" variant="secondary" onClick={form.cancel}>Cancel</Button>
                <Button size="sm" type="submit" disabled={!form.draft.title.trim()} loading={form.saving}>Add</Button>
            </div>
        </form>
    );
}

export function UnifiedTodoTab({ owner, scopeWorkspaceId, chatId = null, onErrorChange }: UnifiedTodoTabProps) {
    const client = useCocClient(owner.ownerRoutingRef === null ? undefined : owner.ownerRoutingRef ?? owner.ownerWorkspaceId);
    const [ledger, setLedger] = useState<SentinelTodoLedgerResponse | null>(null);
    const [loadError, setLoadError] = useState<string | null>(null);
    // The owner's remembered view: the origin tab and its pinned copy share it.
    const [restored] = useState(() => recallSentinelTodoView(owner));
    const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set(restored.expandedIds));
    const [showDone, setShowDone] = useState(false);
    const [showArchived, setShowArchived] = useState(false);
    const [showManual, setShowManual] = useState(true);
    const [showManualDone, setShowManualDone] = useState(false);
    const [showManualArchived, setShowManualArchived] = useState(false);
    const manualId = useId();

    // A response that lands after the tab's owner changed — or after a newer
    // load started — is discarded rather than painted over the current ledger.
    const loadSeq = useRef(0);
    const ownerKey = sentinelTodoOwnerKey(owner);
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

    const sections = useMemo(() => sentinelTodoSections(ledger?.items ?? [], 'normal'), [ledger]);
    const manual = useMemo(() => sentinelTodoSections(ledger?.items ?? [], 'manual'), [ledger]);
    const normalCount = sections.active.length + sections.done.length + sections.archived.length;
    const manualCount = manual.active.length + manual.done.length + manual.archived.length;
    const attentionCount = sections.active.filter(item => sentinelTodoDisplayStatus(item) === 'needs_attention').length;

    const createItem = useCallback(async (type: SentinelTodoType, draft: Draft, idempotencyKey: string) => {
        await client.sentinelTodos.create(owner.ownerWorkspaceId, owner.processId, {
            title: draft.title.trim(),
            completionCondition: draft.completionCondition.trim(),
            notes: draft.notes,
            priority: draft.priority,
            ...(type === 'manual' ? { type } : {}),
            idempotencyKey,
        });
        await load();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [client, ownerKey, load]);
    const addForm = useAddItemForm((draft, key) => createItem('normal', draft, key));
    const manualForm = useAddItemForm((draft, key) => createItem('manual', draft, key));

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

    const scrollRef = useRef<HTMLDivElement>(null);
    const highlightTimer = useRef<ReturnType<typeof setTimeout>>();
    const highlightedRow = useRef<HTMLElement | null>(null);
    useEffect(() => () => { clearTimeout(highlightTimer.current); highlightedRow.current?.removeAttribute('data-sentinel-trigger-highlight'); }, []);
    const followTriggerItem = (itemId: string) => {
        setShowDone(true);
        setShowArchived(true);
        setExpanded(previous => new Set([...previous, itemId]));
        clearTimeout(highlightTimer.current);
        highlightedRow.current?.removeAttribute('data-sentinel-trigger-highlight');
        highlightTimer.current = setTimeout(() => {
            const row = [...(scrollRef.current?.querySelectorAll<HTMLElement>('[data-testid]') ?? [])]
                .find(element => element.dataset.testid === `sentinel-todo-row-${itemId}`);
            if (!row) return;
            highlightedRow.current = row;
            row.scrollIntoView?.({ behavior: 'smooth', block: 'nearest' });
            row.setAttribute('data-sentinel-trigger-highlight', 'true');
            highlightTimer.current = setTimeout(() => row.removeAttribute('data-sentinel-trigger-highlight'), 2500);
        }, 0);
    };
    const scrollTop = useRef(restored.scrollTop ?? 0);
    const expandedRef = useRef(expanded);
    expandedRef.current = expanded;
    useEffect(() => () => {
        rememberSentinelTodoView(owner, { scrollTop: scrollTop.current, expandedIds: [...expandedRef.current] });
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [ownerKey]);
    // Once the list has content: restore its scroll, and focus the link Back returned from.
    const viewRestored = useRef(false);
    useLayoutEffect(() => {
        const root = scrollRef.current;
        if (ledger === null || root === null || viewRestored.current) return;
        viewRestored.current = true;
        root.scrollTop = scrollTop.current;
        const focusLinkKey = recallSentinelTodoView(owner).focusLinkKey;
        if (focusLinkKey === undefined) return;
        rememberSentinelTodoView(owner, { focusLinkKey: undefined });
        [...root.querySelectorAll<HTMLElement>('[data-todo-link]')]
            .find(link => link.dataset.todoLink === focusLinkKey)?.focus({ preventScroll: true });
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [ledger]);

    const excursion = useSentinelTodoExcursion();
    const pinned = isPinnedSentinelTodo(excursion, owner, chatId);
    const originTitle = excursion?.origin.title ?? 'Sentinel';
    // A plain click on an in-app chat link leaves for that chat with a way back.
    const followLink = useCallback<FollowLink>((event, linkKey) => {
        const href = event.currentTarget.getAttribute('href') ?? '';
        if (chatId === null || scopeWorkspaceId === undefined || !href.startsWith('#') || event.button !== 0
            || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
        startSentinelTodoExcursion({
            owner,
            scopeWorkspaceId,
            chatId,
            title: getSentinelTodoChat(scopeWorkspaceId, chatId)?.title ?? null,
            href: window.location.hash,
            linkKey,
        });
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [ownerKey, scopeWorkspaceId, chatId]);

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
                    owner={owner}
                    onToggle={() => toggle(item.id)} onSave={saveItem} onFollowLink={followLink} />
            ))}
        </ul>
    );

    return (
        <div ref={scrollRef} onScroll={event => { scrollTop.current = event.currentTarget.scrollTop; }}
            className="flex h-full flex-col gap-2 overflow-auto p-2 text-xs text-[#1e1e1e] dark:text-[#cccccc]" data-testid="sentinel-todo-tab">
            {pinned && (
                <div role="note" data-testid="sentinel-todo-pinned-banner"
                    className="flex items-start gap-2 rounded bg-[#8764b8]/10 px-2 py-1.5 text-[#5c3d99] dark:text-[#c5a5ed]">
                    <span className="min-w-0 flex-1">
                        <span aria-hidden="true">📌 </span>Pinned from <strong>{originTitle}</strong> while you view linked chats.
                        This is that Sentinel&apos;s list, not this chat&apos;s.
                    </span>
                    <Button size="sm" variant="secondary" onClick={endSentinelTodoExcursion} data-testid="sentinel-todo-unpin"
                        aria-label={`Unpin ${originTitle} To-do`}>Unpin</Button>
                </div>
            )}
            <div className="flex items-center gap-2">
                <span className="font-semibold">To-do</span>
                {ledger && sections.active.length > 0 && (
                    <span className={MUTED} data-testid="sentinel-todo-active-count">{sections.active.length} active</span>
                )}
                {attentionCount > 0 && (
                    <span className="rounded-full bg-[#e8912d]/15 px-1.5 text-[11px] font-medium text-[#b5650f] dark:text-[#cca700]"
                        data-testid="sentinel-todo-attention-count">
                        {attentionCount} need{attentionCount === 1 ? 's' : ''} attention
                    </span>
                )}
                <span className="flex-1" />
                {!addForm.adding && normalCount > 0 && (
                    <Button size="sm" variant="secondary" onClick={addForm.open} data-testid="sentinel-todo-add">Add item</Button>
                )}
            </div>
            {loadError && (
                <Notice tone="error" testId="sentinel-todo-load-error" onRetry={() => { void load(); }}>
                    Could not load the to-do list: {loadError}
                </Notice>
            )}
            {addForm.adding && <AddItemForm form={addForm} testIdPrefix="sentinel-todo-add" label="Add item" />}
            {ledger === null ? (
                !loadError && (
                    <div className={cn('flex items-center gap-2 p-2', MUTED)} role="status" data-testid="sentinel-todo-loading">
                        <Spinner size="sm" /> Loading to-do items…
                    </div>
                )
            ) : (
                <>
                    {normalCount === 0 ? (
                        !addForm.adding && (
                            <div className={cn('flex flex-col items-start gap-2 p-2', MUTED)} data-testid="sentinel-todo-empty">
                                <span>Nothing is tracked yet. Sentinel records concrete work requests, agreed next actions,
                                    and the jobs it delegates for them here; you can add items too.</span>
                                <Button size="sm" onClick={addForm.open}>Add item</Button>
                            </div>
                        )
                    ) : sections.active.length > 0
                        ? renderList(sections.active)
                        : <span className={MUTED} data-testid="sentinel-todo-no-active">No active items.</span>}
                    <section className="flex flex-col gap-1 border-t border-[#e0e0e0] pt-2 dark:border-[#3c3c3c]"
                        aria-labelledby={`${manualId}-heading`} data-testid="sentinel-todo-manual-section">
                        <div className="flex flex-wrap items-center justify-between gap-1">
                            <h3 className="m-0 min-w-0 text-xs font-semibold">
                                <button type="button" id={`${manualId}-heading`} aria-expanded={showManual} aria-controls={`${manualId}-body`}
                                    aria-label={`Manual tracking (${manual.active.length} active)`} onClick={() => setShowManual(v => !v)} data-testid="sentinel-todo-manual-toggle"
                                    className="flex items-center gap-1 rounded px-1 py-0.5 text-left hover:bg-black/[0.04] focus:outline-none focus-visible:ring-1 focus-visible:ring-[#0078d4] dark:hover:bg-white/[0.04]">
                                    <span aria-hidden="true">{showManual ? '▾' : '▸'}</span>
                                    <span>Manual tracking ({manual.active.length})</span>
                                </button>
                            </h3>
                            <span className="mr-auto rounded bg-[#e8912d]/15 px-1.5 py-0.5 text-[10px] font-medium text-[#8a5a00] dark:text-[#cca700]"
                                title="Reminders you update yourself. No jobs are ever started for these."
                                data-testid="sentinel-todo-manual-tracked-only">Tracked only · never run</span>
                            {!manualForm.adding && (
                                <Button size="sm" variant="secondary" data-testid="sentinel-todo-manual-add"
                                    onClick={() => { setShowManual(true); manualForm.open(); }}>Add manual item</Button>
                            )}
                        </div>
                        {showManual && (
                            <div id={`${manualId}-body`} className="flex flex-col gap-1">
                                {manualForm.adding && <AddItemForm form={manualForm} testIdPrefix="sentinel-todo-manual-add" label="Add manual item" manual />}
                                {manual.active.length > 0 ? renderList(manual.active) : (
                                    <span className={cn('px-1', MUTED)} data-testid="sentinel-todo-manual-empty">
                                        {manualCount === 0 ? 'No manual items yet.' : 'No active manual items.'}
                                    </span>
                                )}
                                {manual.done.length > 0 && (
                                    <Section label="Done" count={manual.done.length} open={showManualDone} onToggle={() => setShowManualDone(v => !v)} testId="sentinel-todo-manual-done-section">
                                        {renderList(manual.done)}
                                    </Section>
                                )}
                                {manual.archived.length > 0 && (
                                    <Section label="Archived" count={manual.archived.length} open={showManualArchived} onToggle={() => setShowManualArchived(v => !v)} testId="sentinel-todo-manual-archived-section">
                                        {renderList(manual.archived)}
                                    </Section>
                                )}
                            </div>
                        )}
                    </section>
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
                    <SentinelTodoTriggers owner={owner} items={ledger.items} onItemLink={followTriggerItem} />
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

function TodoRow({ item, owner, expanded, onToggle, onSave, onFollowLink }: {
    item: SentinelTodoItem; expanded: boolean; onToggle: () => void; onSave: SaveItem; onFollowLink: FollowLink;
    owner: SentinelTodoOwner;
}) {
    const [editing, setEditing] = useState<(Draft & { baseRevision: number }) | null>(null);
    const [statusDraft, setStatusDraft] = useState<{ status: SentinelTodoStatus; reason: string } | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [attachError, setAttachError] = useState<string | null>(null);
    const [busy, setBusy] = useState(false);
    const [notesOpen, setNotesOpen] = useState(false);
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
    const displayStatus = sentinelTodoDisplayStatus(item);
    const reasonPreview = !expanded && displayStatus === 'needs_attention' ? item.statusReason : null;
    // Collapsed rows show only the latest job; expanding lists every attempt.
    const shownJobs = expanded ? item.jobs : item.jobs.slice(-1);
    const hiddenJobs = item.jobs.length - shownJobs.length;
    const foldNotes = sentinelTodoFoldNotes(item.notes);
    const canAttach = isSessionContextAttachmentsEnabled();
    const attachmentOwner = {
        ...owner,
        ownerRoutingRef: owner.ownerRoutingRef === null
            || resolveCloneRoute(owner.ownerRoutingRef ?? owner.ownerWorkspaceId).kind === 'local'
            ? null : owner.ownerRoutingRef ?? owner.ownerWorkspaceId,
    };
    const attach = () => {
        const target = attachSelectionToChat(
            owner.ownerRoutingRef ?? owner.ownerWorkspaceId,
            createSentinelTodoContextPayload(attachmentOwner, item),
        );
        setAttachError(target === 'unavailable' ? 'Open the owning Sentinel chat to attach this to-do.' : null);
    };
    // Identifies a followed link within the list, so Back can focus it again.
    const linkKey = (link: string) => `${item.id}|${link}`;
    // Every row reserves the band's gutter, so changing priority never shifts content.
    return (
        <li className="relative rounded border border-[#e0e0e0] pl-1 dark:border-[#3c3c3c]" data-testid={`sentinel-todo-row-${item.id}`}
            draggable={canAttach}
            onDragStart={event => {
                if (!canAttach || (event.target instanceof Element && event.target.closest('input, textarea, select, a'))) {
                    event.preventDefault();
                    return;
                }
                writePointerContextDragData(event.dataTransfer, createSentinelTodoContextPayload(attachmentOwner, item));
                event.stopPropagation();
            }}
            data-priority={high ? 'high' : 'regular'}>
            {high && (
                <span aria-hidden="true" data-testid={`sentinel-todo-priority-band-${item.id}`}
                    className="pointer-events-none absolute inset-y-0 left-0 w-1 rounded-l-[3px] bg-[#e51400] dark:bg-[#f14c4c]" />
            )}
            <button type="button" aria-expanded={expanded} aria-controls={`sentinel-todo-${item.id}-details`} onClick={onToggle}
                className="flex w-full items-start gap-1.5 px-2 pt-1.5 pb-0.5 text-left hover:bg-black/[0.04] focus:outline-none focus-visible:ring-1 focus-visible:ring-[#0078d4] dark:hover:bg-white/[0.04]">
                <StatusBadge status={displayStatus} />
                {high && <HighPriorityBadge itemId={item.id} />}
                <span id={titleId} className={cn('min-w-0 flex-1 break-words font-medium', item.archived && 'line-through opacity-70')}>{item.title}</span>
                <span aria-hidden="true" className={cn('shrink-0 pt-px text-[10px]', MUTED)}>{expanded ? '▾' : '▸'}</span>
            </button>
            <div className={cn('flex flex-wrap items-center gap-x-1.5 gap-y-0.5 px-2 pb-1.5 text-[11px]', MUTED)} data-testid={`sentinel-todo-meta-${item.id}`}>
                {item.targetRepo && (
                    <span className="max-w-full truncate" title={item.targetRepo.workspaceId} data-testid={`sentinel-todo-repo-${item.id}`}>
                        {item.targetRepo.label ?? item.targetRepo.workspaceId}
                    </span>
                )}
                {item.targetRepo && <span aria-hidden="true">·</span>}
                <TodoTime label="Updated" iso={item.updatedAt} testId={`sentinel-todo-updated-${item.id}`} />
                {canAttach && <button type="button" onClick={attach} aria-label={`Attach ${item.title} as context`}
                    title="Attach to owning Sentinel as context"
                    className="ml-auto rounded px-1 hover:bg-black/[0.04] focus-visible:ring-1 focus-visible:ring-[#0078d4] dark:hover:bg-white/[0.04]">
                    Attach
                </button>}
            </div>
            {attachError && <Notice tone="error" testId={`sentinel-todo-attach-error-${item.id}`}>{attachError}</Notice>}
            {reasonPreview && (
                <div className="truncate px-2 pb-1.5 text-[11px] text-[#b5650f] dark:text-[#cca700]" title={reasonPreview}
                    data-testid={`sentinel-todo-reason-preview-${item.id}`}>
                    {reasonPreview}
                </div>
            )}
            {shownJobs.length > 0 && (
                <ul className="flex flex-col gap-0.5 px-2 pb-1.5" aria-label={`Jobs for ${item.title}`}>
                    {shownJobs.map(job => {
                        const review = sentinelTodoReviewLabel(job);
                        const external = /^https?:\/\//i.test(job.openLink);
                        const jobLink = linkKey(`job:${job.serverId ?? ''}:${job.processId}`);
                        return (
                            <li key={`${job.serverId ?? ''}:${job.processId}`} className="flex flex-wrap items-center gap-1">
                                <a href={job.openLink} className="text-[#0078d4] hover:underline focus:outline-none focus-visible:ring-1 focus-visible:ring-[#0078d4] dark:text-[#3794ff]"
                                    data-todo-link={jobLink} onClick={event => onFollowLink(event, jobLink)}
                                    {...(external ? { target: '_blank', rel: 'noopener noreferrer' } : {})}>
                                    {job.title ?? job.processId}
                                </a>
                                {/* Remote links retain their transport kind and the Ralph launch's sessionId. */}
                                {(job.kind === 'ralph' || job.sessionId) && (
                                    <span title="Ralph session" className="inline-flex shrink-0 items-center rounded bg-[#8764b8]/15 px-1.5 py-0.5 text-[11px] font-medium text-[#7150a2] dark:text-[#c5a5ed]">
                                        Ralph
                                    </span>
                                )}
                                {expanded && job.workspaceId && <span className={MUTED}>· {job.serverId ? `${job.workspaceId} @ ${job.serverId}` : job.workspaceId}</span>}
                                <span className={MUTED}>· {sentinelTodoJobStateLabel(job)}</span>
                                {review && <span className={MUTED}>· {review}</span>}
                            </li>
                        );
                    })}
                    {hiddenJobs > 0 && (
                        <li className={MUTED} data-testid={`sentinel-todo-earlier-jobs-${item.id}`}>
                            +{hiddenJobs} earlier job{hiddenJobs === 1 ? '' : 's'}
                        </li>
                    )}
                </ul>
            )}
            {/* Reference-only conversations: navigation links with no execution or review state. */}
            {(item.references?.length ?? 0) > 0 && (
                <ul className="flex flex-col gap-0.5 px-2 pb-1.5" aria-label={`Referenced conversations for ${item.title}`}>
                    {item.references!.map(ref => (
                        <li key={ref.processId} className="flex min-w-0 items-center gap-1" data-testid={`sentinel-todo-reference-${item.id}-${ref.processId}`}>
                            <span className="shrink-0 rounded bg-black/[0.06] px-1 text-[10px] font-medium uppercase tracking-wide text-[#616161] dark:bg-white/[0.08] dark:text-[#a0a0a0]">Ref</span>
                            <a href={ref.openLink} title={ref.title ?? ref.processId}
                                data-todo-link={linkKey(`ref:${ref.processId}`)} onClick={event => onFollowLink(event, linkKey(`ref:${ref.processId}`))}
                                className="min-w-0 truncate text-[#0078d4] hover:underline focus:outline-none focus-visible:ring-1 focus-visible:ring-[#0078d4] dark:text-[#3794ff]">
                                {ref.title ?? ref.processId}
                            </a>
                        </li>
                    ))}
                </ul>
            )}
            {expanded && (
                <div id={`sentinel-todo-${item.id}-details`} className="flex flex-col gap-1.5 border-t border-[#e0e0e0] px-2 py-1.5 dark:border-[#3c3c3c]">
                    {error && (
                        <Notice tone="error" testId={`sentinel-todo-row-error-${item.id}`}
                            onRetry={lastAction.current ? () => { void lastAction.current?.(); } : undefined}>{error}</Notice>
                    )}
                    {displayStatus !== item.status && (
                        <div className={cn('rounded px-2 py-1 text-[11px]', STATUS_STYLES[displayStatus].badge)} data-testid={`sentinel-todo-derived-${item.id}`}>
                            Shown as {SENTINEL_TODO_STATUS_LABELS[displayStatus]} from linked job results.
                            Saved status: {SENTINEL_TODO_STATUS_LABELS[item.status]}.
                        </div>
                    )}
                    {editing ? (
                        <form className="flex flex-col gap-1" onSubmit={saveEdit} data-testid={`sentinel-todo-edit-form-${item.id}`}>
                            <DraftFields draft={editing} onChange={draft => setEditing({ ...editing, ...draft })} idPrefix={`sentinel-todo-edit-${item.id}`}
                                manual={sentinelTodoType(item) === 'manual'} />
                            <div className="flex flex-wrap justify-end gap-1 pt-1">
                                <Button size="sm" variant="secondary" onClick={() => { setEditing(null); setError(null); }}>Cancel</Button>
                                <Button size="sm" type="submit" disabled={!editing.title.trim()} loading={busy}>Save</Button>
                            </div>
                        </form>
                    ) : (
                        <dl className="grid grid-cols-[auto_1fr] gap-x-2 gap-y-1">
                            {item.statusReason && <><dt className={MUTED}>Reason</dt><dd className="whitespace-pre-wrap break-words">{item.statusReason}</dd></>}
                            <dt className={MUTED}>Done when</dt>
                            <dd className="whitespace-pre-wrap break-words">{item.completionCondition || <span className={MUTED}>Not set</span>}</dd>
                            {item.outcome && (
                                <><dt className={MUTED}>Outcome</dt>
                                    <dd className="whitespace-pre-wrap break-words" data-testid={`sentinel-todo-outcome-${item.id}`}>
                                        {item.outcome.summary} <span className={MUTED}>({item.outcome.recordedBy === 'user' ? 'you' : item.outcome.recordedBy})</span>
                                    </dd></>
                            )}
                            {item.notes && (
                                <><dt className={MUTED}>Notes</dt>
                                    <dd className="min-w-0">
                                        {foldNotes && (
                                            <button type="button" aria-expanded={notesOpen} aria-controls={`sentinel-todo-${item.id}-notes`}
                                                onClick={() => setNotesOpen(open => !open)} data-testid={`sentinel-todo-notes-toggle-${item.id}`}
                                                className="rounded text-[#0078d4] hover:underline focus:outline-none focus-visible:ring-1 focus-visible:ring-[#0078d4] dark:text-[#3794ff]">
                                                {notesOpen ? 'Hide notes' : `Show notes (${sentinelTodoLineCount(item.notes)} lines)`}
                                            </button>
                                        )}
                                        {(!foldNotes || notesOpen) && (
                                            <div id={`sentinel-todo-${item.id}-notes`} className="whitespace-pre-wrap break-words">{item.notes}</div>
                                        )}
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
                        <div className="flex flex-col gap-1 border-t border-dashed border-[#e0e0e0] pt-1.5 dark:border-[#3c3c3c]">
                            {!item.archived && item.status !== 'done' && (
                                <StatusChoices status={item.status} disabled={busy} itemId={item.id}
                                    onChoose={status => applyStatus(status, '')} />
                            )}
                            <div className="flex flex-wrap items-center gap-1">
                                <span className={cn('mr-auto flex flex-wrap gap-x-2 text-[11px]', MUTED)} data-testid={`sentinel-todo-times-${item.id}`}>
                                    <TodoTime label="Created" iso={item.createdAt} testId={`sentinel-todo-created-${item.id}`} />
                                </span>
                                {!item.archived && (
                                    <Button size="sm" variant="ghost" disabled={busy} onClick={() => setEditing({
                                        title: item.title, completionCondition: item.completionCondition, notes: item.notes,
                                        priority: sentinelTodoPriority(item), baseRevision: item.revision,
                                    })}>Edit</Button>
                                )}
                                {!item.archived && item.status === 'done' && (
                                    <Button size="sm" variant="ghost" disabled={busy} onClick={() => applyStatus('todo', '')}>Reopen</Button>
                                )}
                                <Button size="sm" variant="ghost" disabled={busy}
                                    onClick={() => { void run(() => onSave(item, { archived: !item.archived }), () => {}); }}>
                                    {item.archived ? 'Restore' : 'Archive'}
                                </Button>
                            </div>
                        </div>
                    )}
                </div>
            )}
        </li>
    );
}

/** Compact status choices: the saved status is pressed; In review is derived and never offered. */
function StatusChoices({ status, disabled, itemId, onChoose }: {
    status: SentinelTodoStatus; disabled: boolean; itemId: string; onChoose: (status: SentinelTodoStatus) => void;
}) {
    return (
        <div role="group" aria-label="Status" className="flex flex-wrap items-center gap-1" data-testid={`sentinel-todo-status-choices-${itemId}`}>
            {SENTINEL_TODO_STATUSES.map(choice => {
                const pressed = choice === status;
                return (
                    <button key={choice} type="button" aria-pressed={pressed} disabled={disabled}
                        onClick={() => { if (!pressed) onChoose(choice); }}
                        className={cn('inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[11px] focus:outline-none focus-visible:ring-1 focus-visible:ring-[#0078d4] disabled:opacity-60',
                            pressed ? cn('border-transparent font-medium', STATUS_STYLES[choice].badge)
                                : 'border-[#e0e0e0] hover:bg-black/[0.04] dark:border-[#3c3c3c] dark:hover:bg-white/[0.04]')}>
                        <span aria-hidden="true">{STATUS_STYLES[choice].mark}</span>
                        {SENTINEL_TODO_STATUS_LABELS[choice]}
                    </button>
                );
            })}
        </div>
    );
}
