/**
 * UnifiedTodoTab — a Sentinel chat's to-do ledger in the unified right panel.
 *
 * A compact list over the owning server's ledger (`client.sentinelTodos`),
 * refreshed by that server's `sentinel-todos-changed` events. Every write
 * carries the item revision it was based on; a conflict reloads the current
 * ledger and keeps whatever the user typed. Job links only navigate; the
 * optional Jobs section manages persistent prompt jobs and the built-in Scrubber;
 * with Jobs disabled, the Scrubber strip controls its read-only assessment chats. Active normal items come first, then
 * the chat's Manual tracking section with its own add form and groups, then the
 * normal Done and Archived sections, then triggers and Jobs or the Scrubber strip,
 * all in the list column beside the detail pane.
 */

import { useCallback, useContext, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type DragEvent, type FormEvent, type MouseEvent, type ReactNode } from 'react';
import type {
    CocClient,
    SentinelTodoItem,
    SentinelTodoLedgerResponse,
    SentinelTodoPriority,
    SentinelTodoStatus,
    SentinelTodoType,
    SentinelTodoTagLibrary,
    SentinelTodoExternalReference,
    UpdateSentinelTodoRequest,
} from '@plusplusoneplusplus/coc-client';
import { SENTINEL_TODO_RECENT_LIMIT } from '@plusplusoneplusplus/coc-client';
import { useCocClient } from '../../../repos/cloneRouting';
import { SentinelTodoJobPreview } from './SentinelTodoJobPreview';
import { SentinelTodoConversationReferences } from './SentinelTodoConversationReferences';
import { Button } from '../../../ui/Button';
import { Spinner } from '../../../ui/Spinner';
import { cn } from '../../../ui/cn';
import { isSessionContextAttachmentsEnabled } from '../../../utils/config';
import { useContainerWidth } from '../../chat/hooks/useContainerWidth';
import { ChatHeaderOverflowMenu } from '../../chat/ChatHeaderOverflowMenu';
import { ChatStatusPill } from '../../chat/ChatStatusPill';
import { attachSelectionToChat } from '../../chat/activeChatAttach';
import { createSentinelTodoContextPayload } from '../../chat/sentinelTodoContext';
import { writePointerContextDragData } from '../../chat/sessionContextDrag';
import { resolveCloneRoute } from '../../../repos/cloneRegistry';
import { formatRelativeTime } from '../../../utils/format';
import { getSentinelTodoChat, useSentinelTodoEvents } from './sentinelTodoChats';
import { SentinelTodoTriggers } from './SentinelTodoTriggers';
import { SentinelTodoDependencies } from './SentinelTodoDependencies';
import { SentinelTodoPrOutcomes } from './SentinelTodoPrOutcomes';
import { SentinelTodoTagChips, SentinelTodoTagPicker, SentinelTodoTagToolbar, sentinelTodoMatchesTag, useSentinelTodoTagsEnabled } from './SentinelTodoTags';
import { externalReferences, SentinelTodoExternalReferences, SentinelTodoExternalReferenceEditor, useSentinelTodoExternalReferencesEnabled } from './SentinelTodoExternalReferences';
import { openUnifiedPanelTab } from './unifiedPanelOpen';
import { resourcePathName } from './unifiedPanelOpenMenuModel';
import { WORKSPACE_PREVIEW_PREFIX } from '../../../shared/file-viewer/workspacePreview';
import { AcceptAllScrubProposals, ScrubberFindingsContext, SentinelTodoScrubFinding } from './SentinelTodoScrubFinding';
import { SentinelTodoJobs } from './SentinelTodoJobs';
import { sentinelTodoRecentPage } from './sentinelTodoStatusModel';
import {
    endSentinelTodoExcursion,
    isPinnedSentinelTodo,
    recallSentinelTodoView,
    rememberSentinelTodoView,
    startSentinelTodoExcursion,
    useSentinelTodoExcursion,
    type SentinelTodoView,
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

type FollowLink = (event: MouseEvent<HTMLAnchorElement>, linkKey: string, href?: string) => void;

type DraftFieldsValue = { title: string; completionCondition: string; notes: string; priority: SentinelTodoPriority };
type Draft = DraftFieldsValue & {
    externalReferences?: SentinelTodoExternalReference[]; externalReferencesChanged?: boolean;
    initialFields?: DraftFieldsValue;
};
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

// 280px of list + 360px of editable details + panel padding and separator.
export const SENTINEL_TODO_SPLIT_MIN_WIDTH = 660;

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
        <span className={cn('inline-flex shrink-0 items-center justify-center rounded px-1 py-0.5 text-[11px] font-medium', style.badge)}
            title={SENTINEL_TODO_STATUS_LABELS[status]} data-testid={`sentinel-todo-status-${status}`}>
            <span aria-hidden="true" className="inline-flex h-3 w-3 items-center justify-center leading-none">{style.mark}</span>
            <span className="sr-only">{SENTINEL_TODO_STATUS_LABELS[status]}</span>
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
    const referencesEnabled = useSentinelTodoExternalReferencesEnabled();
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
            {referencesEnabled && <SentinelTodoExternalReferenceEditor value={draft.externalReferences ?? []}
                onChange={externalReferences => onChange({ ...draft, externalReferences, externalReferencesChanged: true })}
                idPrefix={idPrefix} inputClass={INPUT} />}
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

export function UnifiedTodoTab(props: UnifiedTodoTabProps) {
    const ref = props.owner.ownerRoutingRef === null ? undefined : props.owner.ownerRoutingRef ?? props.owner.ownerWorkspaceId;
    const client = useCocClient(ref);
    const route = resolveCloneRoute(ref);
    const transportKey = route.kind === 'remote' ? route.baseUrl : route.kind;
    return <TodoTab key={`${sentinelTodoOwnerKey(props.owner)}:${transportKey}`} {...props} client={client}
        unavailable={route.kind === 'unresolved-remote'} />;
}

function TodoTab({ owner, scopeWorkspaceId, chatId = null, onErrorChange, client, unavailable }: UnifiedTodoTabProps & {
    client: CocClient; unavailable: boolean;
}) {
    const panelRef = useRef<HTMLDivElement | null>(null);
    const { width } = useContainerWidth(panelRef, { throttleMs: 0, wideThreshold: SENTINEL_TODO_SPLIT_MIN_WIDTH });
    const wide = width >= SENTINEL_TODO_SPLIT_MIN_WIDTH;
    const [ledger, setLedger] = useState<SentinelTodoLedgerResponse | null>(null);
    const [visibleLimit, setVisibleLimit] = useState(SENTINEL_TODO_RECENT_LIMIT);
    const tagsEnabled = useSentinelTodoTagsEnabled();
    const referencesEnabled = useSentinelTodoExternalReferencesEnabled();
    const [tagFilter, setTagFilter] = useState('');
    const [matchMultiple, setMatchMultiple] = useState(false);
    const tagLibrary = tagsEnabled ? ledger?.tagLibrary : undefined;
    const effectiveTagFilter = tagLibrary && (tagFilter === 'untagged' || tagLibrary.tags.some(tag => tag.id === tagFilter)) ? tagFilter : '';
    const [loadError, setLoadError] = useState<string | null>(null);
    const [loading, setLoading] = useState(false);
    const pendingLoads = useRef(0);
    // The owner's remembered view: the origin tab and its pinned copy share it.
    const [restored] = useState(() => recallSentinelTodoView(owner));
    const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set(restored.expandedIds));
    const [selectedId, setSelectedId] = useState<string | null>(restored.selectedId ?? null);
    const [detailOpen, setDetailOpen] = useState(restored.detailOpen ?? restored.selectedId != null);
    const [showDone, setShowDone] = useState(restored.sections?.done ?? false);
    const [showArchived, setShowArchived] = useState(restored.sections?.archived ?? false);
    const [showManual, setShowManual] = useState(restored.sections?.manual ?? true);
    const [showManualDone, setShowManualDone] = useState(restored.sections?.manualDone ?? false);
    const [showManualArchived, setShowManualArchived] = useState(restored.sections?.manualArchived ?? false);
    const manualId = useId();
    const detailId = useId();

    // A response that lands after the tab's owner changed — or after a newer
    // load started — is discarded rather than painted over the current ledger.
    const loadSeq = useRef(0);
    const mounted = useRef(true);
    const ownerKey = sentinelTodoOwnerKey(owner);
    // The applied snapshot's revision and the newest request let a write reuse a
    // read that already covers its committed revision instead of fetching again.
    const loadedRevision = useRef(-1);
    const inFlight = useRef<Promise<void> | null>(null);
    const fetchLedger = useCallback(async () => {
        if (!mounted.current) return;
        const seq = ++loadSeq.current;
        if (unavailable) {
            setLoadError('Owning server is not connected.');
            return;
        }
        pendingLoads.current += 1;
        setLoading(true);
        try {
            // Dependencies, triggers and Scrubber projections need the full snapshot, not just visible rows.
            const next = await client.sentinelTodos.get(owner.ownerWorkspaceId, owner.processId, { full: true });
            if (!mounted.current || seq !== loadSeq.current) return;
            loadedRevision.current = next.revision;
            setLedger(next);
            setLoadError(null);
        } catch (error) {
            if (!mounted.current || seq !== loadSeq.current) return;
            setLoadError(error instanceof Error && error.message ? error.message : 'Could not load the to-do list.');
        } finally {
            pendingLoads.current -= 1;
            if (mounted.current) setLoading(pendingLoads.current > 0);
        }
        // `ownerKey` covers the owner fields read above.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [client, ownerKey, unavailable]);
    const load = useCallback(() => {
        const request: Promise<void> = fetchLedger().finally(() => {
            if (inFlight.current === request) inFlight.current = null;
        });
        inFlight.current = request;
        return request;
    }, [fetchLedger]);
    /** Shows at least a committed write's revision, reusing a covering in-flight or applied read. */
    const showRevision = useCallback(async (revision: number) => {
        // A missing revision never counts as covered.
        const covered = () => loadedRevision.current >= revision;
        while (inFlight.current && !covered()) await inFlight.current;
        if (!covered()) await load();
    }, [load]);

    const refresh = () => {
        if (pendingLoads.current > 0) return;
        void load();
    };

    useEffect(() => {
        mounted.current = true;
        loadedRevision.current = -1;
        setLedger(null);
        setLoadError(null);
        void load();
        return () => { mounted.current = false; loadSeq.current += 1; };
    }, [load]);
    const previousTagsEnabled = useRef(tagsEnabled);
    useEffect(() => {
        const enabledNow = tagsEnabled && !previousTagsEnabled.current;
        previousTagsEnabled.current = tagsEnabled;
        if (enabledNow) void load();
    }, [tagsEnabled, load]);
    useSentinelTodoEvents(owner, () => { void load(); });

    useEffect(() => { onErrorChange?.(loadError !== null); }, [loadError, onErrorChange]);

    const orderedItems = useMemo(() => sentinelTodoRecentPage(ledger?.items ?? [], ledger?.items.length).items, [ledger]);
    const filteredItems = useMemo(() => (ledger?.items ?? []).filter(item => sentinelTodoMatchesTag(item, effectiveTagFilter, tagLibrary)), [ledger, effectiveTagFilter, tagLibrary]);
    const recentItems = useMemo(() => effectiveTagFilter ? sentinelTodoRecentPage(filteredItems, filteredItems.length).items
        : sentinelTodoRecentPage(filteredItems, visibleLimit).items, [filteredItems, visibleLimit, effectiveTagFilter]);
    const sections = useMemo(() => sentinelTodoSections(recentItems, 'normal'), [recentItems]);
    const manual = useMemo(() => sentinelTodoSections(recentItems, 'manual'), [recentItems]);
    useEffect(() => {
        if (!ledger) {
            return;
        }
        const lastOpen = orderedItems.reduce((last, item, index) => expanded.has(item.id) || item.id === selectedId ? index : last, -1);
        if (lastOpen >= 0) {
            setVisibleLimit(limit => Math.max(limit, lastOpen + 1));
        }
    }, [ledger, orderedItems, expanded, selectedId]);
    const normalCount = sections.active.length + sections.done.length + sections.archived.length;
    const manualCount = manual.active.length + manual.done.length + manual.archived.length;
    const attentionCount = sections.active.filter(item => sentinelTodoDisplayStatus(item) === 'needs_attention').length;

    const createItem = useCallback(async (type: SentinelTodoType, draft: Draft, idempotencyKey: string) => {
        const { ledgerRevision } = await client.sentinelTodos.create(owner.ownerWorkspaceId, owner.processId, {
            title: draft.title.trim(),
            completionCondition: draft.completionCondition.trim(),
            notes: draft.notes,
            priority: draft.priority,
            ...(referencesEnabled && draft.externalReferencesChanged && draft.externalReferences?.length
                ? { externalReferences: draft.externalReferences } : {}),
            ...(type === 'manual' ? { type } : {}),
            idempotencyKey,
            ...(tagLibrary && matchMultiple ? { matchMultiple: true } : {}),
        });
        await showRevision(ledgerRevision);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [client, ownerKey, showRevision, tagLibrary, matchMultiple, referencesEnabled]);
    const addForm = useAddItemForm((draft, key) => createItem('normal', draft, key));
    const manualForm = useAddItemForm((draft, key) => createItem('manual', draft, key));
    const openAddForm = () => { setDetailOpen(false); addForm.open(); };

    /** Apply a patch; resolves to an error message, or null on success. */
    const saveItem = useCallback(async (
        item: SentinelTodoItem,
        patch: Omit<UpdateSentinelTodoRequest, 'expectedRevision'>,
        expectedRevision = item.revision,
    ): Promise<{ message: string; conflict: boolean; current?: SentinelTodoItem } | null> => {
        try {
            const { ledgerRevision } = await client.sentinelTodos.update(owner.ownerWorkspaceId, owner.processId, item.id, { expectedRevision, ...patch });
            await showRevision(ledgerRevision);
            return null;
        } catch (error) {
            const failure = sentinelTodoSaveError(error);
            if (!mounted.current) return failure;
            if (failure.conflict) await load();
            const current = (error as { body?: { current?: SentinelTodoItem } }).body?.current;
            return { ...failure, ...(current ? { current } : {}) };
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [client, ownerKey, load, showRevision]);

    const scrollRef = useRef<HTMLDivElement | null>(null);
    const highlightTimer = useRef<ReturnType<typeof setTimeout>>();
    const highlightedRow = useRef<HTMLElement | null>(null);
    const currentView = useRef({ ownerKey, ledger });
    currentView.current = { ownerKey, ledger };
    useEffect(() => () => { clearTimeout(highlightTimer.current); highlightedRow.current?.removeAttribute('data-sentinel-trigger-highlight'); }, [ownerKey, client]);
    const followTriggerItem = (itemId: string) => {
        if (!mounted.current) return;
        if (currentView.current.ownerKey !== ownerKey) return;
        const item = ledger?.items.find(candidate => candidate.id === itemId);
        if (!item) return;
        setTagFilter('');
        setVisibleLimit(limit => Math.max(limit, orderedItems.indexOf(item) + 1));
        const isManual = sentinelTodoType(item) === 'manual';
        if (isManual) setShowManual(true);
        if (!item.archived && item.status === 'done') {
            if (isManual) setShowManualDone(true); else setShowDone(true);
        }
        if (item.archived) {
            if (isManual) setShowManualArchived(true); else setShowArchived(true);
        }
        setExpanded(previous => new Set([...previous, itemId]));
        setSelectedId(itemId); setDetailOpen(true);
        clearTimeout(highlightTimer.current);
        highlightedRow.current?.removeAttribute('data-sentinel-trigger-highlight');
        highlightTimer.current = setTimeout(() => {
            if (currentView.current.ownerKey !== ownerKey
                || !currentView.current.ledger?.items.some(candidate => candidate.id === itemId)) return;
            const row = [...(panelRef.current?.querySelectorAll<HTMLElement>('[data-testid]') ?? [])]
                .find(element => element.dataset.testid === `sentinel-todo-row-${itemId}`);
            if (!row) return;
            highlightedRow.current = row;
            row.scrollIntoView?.({ behavior: 'smooth', block: 'nearest' });
            if (!wide) {
                [...(panelRef.current?.querySelectorAll<HTMLElement>('[data-todo-heading]') ?? [])]
                    .find(heading => heading.dataset.todoHeading === itemId)?.focus({ preventScroll: true });
            } else row.querySelector<HTMLButtonElement>('button[aria-expanded], button[aria-pressed]')?.focus({ preventScroll: true });
            row.setAttribute('data-sentinel-trigger-highlight', 'true');
            highlightTimer.current = setTimeout(() => row.removeAttribute('data-sentinel-trigger-highlight'), 2500);
        }, 0);
    };
    const scrollTop = useRef(restored.scrollTop ?? 0);
    const expandedRef = useRef(expanded);
    expandedRef.current = expanded;
    const viewRef = useRef<SentinelTodoView>({});
    viewRef.current = { selectedId, detailOpen, sections: {
        done: showDone, archived: showArchived, manual: showManual, manualDone: showManualDone, manualArchived: showManualArchived,
    } };
    useEffect(() => () => {
        rememberSentinelTodoView(owner, { scrollTop: scrollTop.current, expandedIds: [...expandedRef.current], ...viewRef.current });
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
        [...(panelRef.current?.querySelectorAll<HTMLElement>('[data-todo-link]') ?? [])]
            .find(link => link.dataset.todoLink === focusLinkKey && !link.closest('[hidden]'))?.focus({ preventScroll: true });
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [ledger]);

    const excursion = useSentinelTodoExcursion();
    const pinned = isPinnedSentinelTodo(excursion, owner, chatId);
    const originTitle = excursion?.origin.title ?? 'Sentinel';
    // A plain click on an in-app chat link leaves for that chat with a way back.
    const followLink = useCallback<FollowLink>((event, linkKey, verifiedHref) => {
        const href = verifiedHref ?? event.currentTarget.getAttribute('href') ?? '';
        if (chatId === null || scopeWorkspaceId === undefined || !href.startsWith('#') || event.button !== 0
            || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
        const itemId = linkKey.split('|')[0];
        if (currentView.current.ledger?.items.some(item => item.id === itemId)) {
            setSelectedId(itemId);
            setDetailOpen(true);
            setExpanded(previous => new Set([...previous, itemId]));
        }
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

    const focusRow = (id: string | null) => {
        [...(panelRef.current?.querySelectorAll<HTMLButtonElement>('[data-todo-select]') ?? [])]
            .find(button => button.dataset.todoSelect === id)?.focus({ preventScroll: true });
    };
    const selectItem = (id: string) => {
        setSelectedId(id);
        setDetailOpen(true);
        setExpanded(previous => new Set([...previous, id]));
        if (!wide) requestAnimationFrame(() => {
            if (!mounted.current || viewRef.current.selectedId !== id || !viewRef.current.detailOpen
                || (document.activeElement !== document.body && !scrollRef.current?.contains(document.activeElement))) return;
            [...(panelRef.current?.querySelectorAll<HTMLElement>('[data-todo-heading]') ?? [])]
                .find(heading => heading.dataset.todoHeading === id)?.focus({ preventScroll: true });
        });
    };
    const closeDetails = () => {
        const id = selectedId;
        setSelectedId(null);
        setDetailOpen(false);
        requestAnimationFrame(() => {
            if (!mounted.current || viewRef.current.selectedId !== null) return;
            focusRow(id);
            if (!scrollRef.current?.contains(document.activeElement)) scrollRef.current?.focus({ preventScroll: true });
        });
    };
    const selected = ledger?.items.find(item => item.id === selectedId);
    const selectedType = selected ? sentinelTodoType(selected) : null;
    const selectedSection = selected ? selected.archived ? 'archived' : selected.status === 'done' ? 'done' : 'active' : null;
    // Reveal on selection or section movement, not on every snapshot or item edit.
    useLayoutEffect(() => {
        if (selectedType === null || selectedSection === null) {
            return;
        }
        if (selectedType === 'manual') {
            setShowManual(true);
            if (selectedSection === 'done') {
                setShowManualDone(true);
            }
            if (selectedSection === 'archived') {
                setShowManualArchived(true);
            }
        } else {
            if (selectedSection === 'done') {
                setShowDone(true);
            }
            if (selectedSection === 'archived') {
                setShowArchived(true);
            }
        }
    }, [selectedId, selectedType, selectedSection]);
    const toggleSection = (open: boolean, setOpen: (open: boolean) => void, containsSelection: boolean) => {
        setOpen(!open);
        if (open && containsSelection) {
            setSelectedId(null);
            setDetailOpen(false);
        }
    };
    useLayoutEffect(() => {
        if (wide || !detailOpen || !selected) return;
        if (scrollRef.current?.contains(document.activeElement)) {
            [...(panelRef.current?.querySelectorAll<HTMLElement>('[data-todo-heading]') ?? [])]
                .find(heading => heading.dataset.todoHeading === selectedId)?.focus({ preventScroll: true });
        }
    }, [wide, detailOpen, selected, selectedId]);
    const rowProps = (item: SentinelTodoItem) => ({
        item, owner, currentWorkspaceId: scopeWorkspaceId,
        headingId: `${detailId}-${item.id}`,
        items: ledger?.items ?? [], ledgerRevision: ledger?.revision ?? 0,
        onLedgerChange: load, onItemLink: followTriggerItem,
        onArtifactLink: (reference: string, artifactWorkspaceId?: string) => openUnifiedPanelTab(scopeWorkspaceId ?? owner.ownerRoutingRef ?? owner.ownerWorkspaceId, {
            kind: 'file' as const, ownerWorkspaceId: artifactWorkspaceId ?? owner.ownerWorkspaceId, ownerRoutingRef: owner.ownerRoutingRef,
            chatId, resourceId: WORKSPACE_PREVIEW_PREFIX + reference, label: resourcePathName(reference),
        }),
        onSave: saveItem, onFollowLink: followLink,
        tagLibrary, tagClient: client, matchMultiple,
    });
    const renderList = (items: readonly SentinelTodoItem[]) => (
        <ul className="flex flex-col gap-1" role="list">
            {items.map(item => <CompactTodoRow key={item.id} {...rowProps(item)} selected={item.id === selectedId} onSelect={() => selectItem(item.id)} />)}
        </ul>
    );

    return (
        <div ref={panelRef}
            className="flex h-full min-h-0 flex-col gap-2 overflow-auto p-2 text-xs text-[#1e1e1e] dark:text-[#cccccc]"
            data-testid="sentinel-todo-tab" data-layout={wide ? 'split' : 'single'}>
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
            <SentinelTodoJobs owner={owner} ready={ledger !== null} items={ledger?.items ?? []} onFollowLink={followLink} onLedgerChange={load} toolbar={
            <div role="toolbar" aria-label="To-do actions" className="flex flex-wrap items-center gap-2">
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
                <AcceptAllScrubProposals />
                <div className="flex shrink-0 items-center gap-2">
                    <button type="button" aria-label="Refresh to-do list" title="Refresh to-do list"
                        aria-busy={loading} disabled={loading} onClick={refresh} data-testid="sentinel-todo-refresh"
                        className="flex h-7 w-7 shrink-0 items-center justify-center rounded text-[#848484] transition-colors hover:bg-[#e8e8e8] dark:hover:bg-[#2d2d2d] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#007acc]/50 disabled:opacity-50 disabled:cursor-not-allowed">
                        <svg className={cn(loading && 'motion-safe:animate-spin')} width="14" height="14" viewBox="0 0 16 16"
                            fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" aria-hidden="true">
                            <path d="M13 6a5.2 5.2 0 1 0 .1 4M13 2v4H9" />
                        </svg>
                    </button>
                    {!addForm.adding && normalCount > 0 && (
                        <Button size="sm" variant="secondary" onClick={openAddForm} data-testid="sentinel-todo-add">Add item</Button>
                    )}
                </div>
            </div>}>
            {scrubber => <>
            {tagsEnabled && <SentinelTodoTagToolbar owner={owner} client={client} library={tagLibrary} onLedgerChange={load}
                loading={loading} loadError={loadError} onRetry={refresh}
                filter={effectiveTagFilter} onFilter={setTagFilter} multiple={matchMultiple} onMultiple={setMatchMultiple} />}
            {loadError && (
                <Notice tone="error" testId="sentinel-todo-load-error" onRetry={() => { void load(); }}>
                    Could not load the to-do list: {loadError}
                </Notice>
            )}
            <div className="flex min-h-[160px] flex-1 gap-2">
            <div ref={scrollRef}
                tabIndex={-1}
                onScroll={event => { scrollTop.current = event.currentTarget.scrollTop; }}
                style={wide ? { flex: '0 0 43%' } : undefined}
                hidden={!wide && detailOpen && !!selected}
                className="min-w-0 flex-1 overflow-auto"
                data-testid="sentinel-todo-list"
                onKeyDown={event => {
                    if (!(event.target instanceof HTMLElement) || !event.target.matches('[data-todo-select]')) return;
                    const buttons = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('[data-todo-select]')];
                    const index = buttons.indexOf(event.target as HTMLButtonElement);
                    const next = event.key === 'ArrowDown' ? Math.min(index + 1, buttons.length - 1)
                        : event.key === 'ArrowUp' ? Math.max(index - 1, 0) : event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : -1;
                    if (next < 0) return;
                    event.preventDefault();
                    buttons[next]?.focus();
                }}>
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
                                <span>{effectiveTagFilter ? 'No normal items match this tag filter.' : ledger.items.some(item => sentinelTodoType(item) === 'normal')
                                    ? 'No normal items in this recent view. Show older items to see more.'
                                    : 'Nothing is tracked yet. Sentinel records concrete work requests, agreed next actions, and the jobs it delegates for them here; you can add items too.'}</span>
                                <Button size="sm" onClick={openAddForm}>Add item</Button>
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
                                    aria-label={`Manual tracking (${manual.active.length} active)`} onClick={() => toggleSection(showManual, setShowManual, selectedType === 'manual')} data-testid="sentinel-todo-manual-toggle"
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
                                        {manualCount === 0
                                            ? ledger.items.some(item => sentinelTodoType(item) === 'manual')
                                                ? 'No manual items in this recent view.'
                                                : 'No manual items yet.'
                                            : 'No active manual items.'}
                                    </span>
                                )}
                                {manual.done.length > 0 && (
                                    <Section label="Done" count={manual.done.length} open={showManualDone} onToggle={() => toggleSection(showManualDone, setShowManualDone, selectedType === 'manual' && selectedSection === 'done')} testId="sentinel-todo-manual-done-section">
                                        {renderList(manual.done)}
                                    </Section>
                                )}
                                {manual.archived.length > 0 && (
                                    <Section label="Archived" count={manual.archived.length} open={showManualArchived} onToggle={() => toggleSection(showManualArchived, setShowManualArchived, selectedType === 'manual' && selectedSection === 'archived')} testId="sentinel-todo-manual-archived-section">
                                        {renderList(manual.archived)}
                                    </Section>
                                )}
                            </div>
                        )}
                    </section>
                    {sections.done.length > 0 && (
                        <Section label="Done" count={sections.done.length} open={showDone} onToggle={() => toggleSection(showDone, setShowDone, selectedType === 'normal' && selectedSection === 'done')} testId="sentinel-todo-done-section">
                            {renderList(sections.done)}
                        </Section>
                    )}
                    {sections.archived.length > 0 && (
                        <Section label="Archived" count={sections.archived.length} open={showArchived} onToggle={() => toggleSection(showArchived, setShowArchived, selectedType === 'normal' && selectedSection === 'archived')} testId="sentinel-todo-archived-section">
                            {renderList(sections.archived)}
                        </Section>
                    )}
                    {!effectiveTagFilter && ledger.items.length > recentItems.length && (
                        <Button size="sm" variant="secondary"
                            onClick={() => setVisibleLimit(recentItems.length + SENTINEL_TODO_RECENT_LIMIT)}
                            data-testid="sentinel-todo-show-older">
                            Show older items ({ledger.items.length - recentItems.length})
                        </Button>
                    )}
                    <SentinelTodoTriggers owner={owner} items={ledger.items} onItemLink={followTriggerItem} />
                    {scrubber}
                </>
            )}
            </div>
            <section hidden={!wide && (!detailOpen || !selected)}
                className={cn('min-w-0 flex-1 overflow-auto', wide && 'border-l border-[#e0e0e0] pl-2 dark:border-[#3c3c3c]')}
                aria-label={selected ? undefined : 'Item details'} aria-labelledby={selected ? `${detailId}-${selected.id}` : undefined}
                data-testid="sentinel-todo-details">
                {!wide && selected && <Button size="sm" variant="secondary" onClick={() => {
                    setDetailOpen(false);
                    requestAnimationFrame(() => focusRow(selectedId));
                }}>Back to list</Button>}
                {!selected && <p role="status" className={cn('p-2', MUTED)}>
                    {ledger === null ? (loadError ? 'Details unavailable until the list loads.' : 'Loading item details…')
                        : selectedId ? 'This item is no longer in the list. Select another item.' : 'Select an item to view its details.'}
                </p>}
                <ul className="flex flex-col gap-1">
                    {(ledger?.items ?? []).filter(item => expanded.has(item.id) || item.id === selectedId).map(item =>
                        <TodoDetail key={item.id} {...rowProps(item)} hidden={item.id !== selectedId} onClose={closeDetails} />)}
                </ul>
            </section>
            </div>
            </>}
            </SentinelTodoJobs>
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

type TodoDetailProps = {
    item: SentinelTodoItem; onSave: SaveItem; onFollowLink: FollowLink;
    items: readonly SentinelTodoItem[]; ledgerRevision: number; onLedgerChange: () => Promise<void>; onItemLink: (itemId: string) => void;
    onArtifactLink: (reference: string, workspaceId?: string) => void;
    owner: SentinelTodoOwner;
    currentWorkspaceId?: string;
    hidden?: boolean;
    headingId?: string;
    tagLibrary?: SentinelTodoTagLibrary;
    tagClient: CocClient;
    matchMultiple: boolean;
    onClose: () => void;
};

function useTodoAttachment(owner: SentinelTodoOwner, item: SentinelTodoItem) {
    const canAttach = isSessionContextAttachmentsEnabled();
    const [attachError, setAttachError] = useState<string | null>(null);
    const attachmentOwner = {
        ...owner,
        ownerRoutingRef: owner.ownerRoutingRef === null
            || resolveCloneRoute(owner.ownerRoutingRef ?? owner.ownerWorkspaceId).kind === 'local'
            ? null : owner.ownerRoutingRef ?? owner.ownerWorkspaceId,
    };
    return {
        canAttach, attachError,
        attach: () => {
            const target = attachSelectionToChat(
                owner.ownerRoutingRef ?? owner.ownerWorkspaceId,
                createSentinelTodoContextPayload(attachmentOwner, item),
            );
            setAttachError(target === 'unavailable' ? 'Open the owning Sentinel chat to attach this to-do.' : null);
        },
        drag: (event: DragEvent<HTMLElement>) => {
            if (!canAttach || (event.target instanceof Element && event.target.closest('input, textarea, select, a'))) {
                event.preventDefault();
                return;
            }
            writePointerContextDragData(event.dataTransfer, createSentinelTodoContextPayload(attachmentOwner, item));
            event.stopPropagation();
        },
    };
}

function AttachTodoButton({ title, onClick, onDragStart }: {
    title: string; onClick: () => void; onDragStart?: (event: DragEvent<HTMLButtonElement>) => void;
}) {
    return <button type="button" onClick={onClick} aria-label={`Attach ${title} as context`}
        draggable={onDragStart ? true : undefined} onDragStart={onDragStart}
        title="Attach to owning Sentinel as context"
        className="ml-auto rounded px-1 hover:bg-black/[0.04] focus-visible:ring-1 focus-visible:ring-[#0078d4] dark:hover:bg-white/[0.04]">
        Attach
    </button>;
}

function TodoCardMenu({ owner, onAttach }: { owner: SentinelTodoOwner; onAttach: () => void }) {
    const root = useRef<HTMLDivElement>(null);
    const trigger = () => root.current?.querySelector<HTMLButtonElement>('button[aria-haspopup="menu"]');
    return <div ref={root} className="ml-auto shrink-0" draggable={false}
        onPointerDown={event => event.stopPropagation()}
        onMouseDown={event => event.stopPropagation()}
        onClick={event => event.stopPropagation()}
        onKeyUp={event => event.stopPropagation()}
        onKeyDown={event => {
            event.stopPropagation();
            // The shared menu's document Escape listener is outside this card boundary.
            if (event.key === 'Escape' && trigger()?.getAttribute('aria-expanded') === 'true') {
                event.preventDefault();
                trigger()?.click();
                trigger()?.focus();
            }
        }}
        onDragStart={event => { event.preventDefault(); event.stopPropagation(); }}>
        <ChatHeaderOverflowMenu wsId={owner.ownerRoutingRef ?? owner.ownerWorkspaceId} items={[{
            key: 'attach', label: 'Attach', onClick: () => {
                trigger()?.focus();
                onAttach();
            },
        }]} />
    </div>;
}

function CompactTodoRow({ item, owner, currentWorkspaceId, onFollowLink, tagLibrary, selected, onSelect }: Pick<TodoDetailProps, 'item' | 'owner' | 'currentWorkspaceId' | 'onFollowLink' | 'tagLibrary'> & {
    selected: boolean; onSelect: () => void;
}) {
    const { canAttach, attach, attachError, drag } = useTodoAttachment(owner, item);
    const high = sentinelTodoPriority(item) === 'high';
    const reasonPreview = sentinelTodoDisplayStatus(item) === 'needs_attention' && item.statusReason ? <span
        className="min-w-0 max-w-full flex-[1_1_8rem] truncate text-[11px] text-[#b5650f] dark:text-[#cca700]" title={item.statusReason}
        data-testid={`sentinel-todo-reason-preview-${item.id}`}>{item.statusReason}</span> : null;
    return <li data-testid={`sentinel-todo-row-${item.id}`} data-priority={sentinelTodoPriority(item)}
        draggable={canAttach} onDragStart={drag}
        className={cn('relative rounded border pl-1', selected
            ? 'border-[#0078d4]/50 bg-[#0078d4]/10 dark:border-[#3794ff]/50'
            : 'border-[#e0e0e0] dark:border-[#3c3c3c]')}>
        {high && <span aria-hidden="true" data-testid={`sentinel-todo-priority-band-${item.id}`}
            className="pointer-events-none absolute inset-y-0 left-0 w-1 rounded-l-[3px] bg-[#e51400] dark:bg-[#f14c4c]" />}
        <div className="flex items-start gap-1 px-1.5 pt-1 pb-0.5">
            <button type="button" aria-pressed={selected} data-todo-select={item.id} onClick={onSelect} title={item.title}
                className="flex min-w-0 flex-1 flex-wrap items-center gap-x-1.5 gap-y-0.5 rounded text-left focus:outline-none focus-visible:ring-1 focus-visible:ring-[#0078d4]">
                <StatusBadge status={sentinelTodoDisplayStatus(item)} />
                {high && <HighPriorityBadge itemId={item.id} />}
                <span className={cn('min-w-0 flex-1 basis-[8rem] break-words [overflow-wrap:anywhere] font-medium', item.archived && 'line-through opacity-70')}>{item.title}</span>
                {sentinelTodoType(item) === 'manual' && <span className={MUTED}>Tracking only</span>}
            </button>
            {canAttach && <TodoCardMenu owner={owner} onAttach={attach} />}
        </div>
        {tagLibrary && item.tagIds?.length ? <div className="px-1.5 pb-1"><SentinelTodoTagChips item={item} library={tagLibrary} /></div> : null}
        <div className={cn('flex flex-wrap items-center gap-x-1.5 gap-y-0.5 px-1.5 pb-1 text-[11px]', MUTED)} data-testid={`sentinel-todo-meta-${item.id}`}>
            {item.targetRepo && <span className="min-w-0 max-w-full break-words" title={item.targetRepo.workspaceId}
                data-testid={`sentinel-todo-repo-${item.id}`}>{item.targetRepo.label ?? item.targetRepo.workspaceId}</span>}
            <TodoTime label="Updated" iso={item.updatedAt} testId={`sentinel-todo-updated-${item.id}`} />
        </div>
        {(item.jobs.length > 0 || reasonPreview) && <div className="min-w-0 px-1.5 pb-1">
            <TodoJobs item={item} owner={owner} currentWorkspaceId={currentWorkspaceId} onFollowLink={onFollowLink} reasonPreview={reasonPreview} />
        </div>}
        {attachError && <Notice tone="error" testId={`sentinel-todo-attach-error-${item.id}`}>{attachError}</Notice>}
        <SentinelTodoScrubFinding item={item} />
        <SentinelTodoExternalReferences item={item} />
    </li>;
}

function TodoDetail({ item, owner, currentWorkspaceId, onSave, onFollowLink, items, ledgerRevision, onLedgerChange, onItemLink, onArtifactLink, hidden, headingId, tagLibrary, tagClient, matchMultiple, onClose }: TodoDetailProps) {
    const referencesEnabled = useSentinelTodoExternalReferencesEnabled();
    const [restoredDraft] = useState(() => recallSentinelTodoView(owner).itemDrafts?.[item.id]);
    const [editing, setEditing] = useState<(Draft & { baseRevision: number }) | null>(restoredDraft?.editing ?? null);
    const [statusDraft, setStatusDraft] = useState<{ status: SentinelTodoStatus; reason: string } | null>(restoredDraft?.statusDraft ?? null);
    const [error, setError] = useState<string | null>(restoredDraft?.error ?? null);
    const { canAttach, attach, attachError, drag } = useTodoAttachment(owner, item);
    const [busy, setBusy] = useState(false);
    const [tagsBusy, setTagsBusy] = useState(false);
    const [dependenciesBusy, setDependenciesBusy] = useState(false);
    const [outcomesBusy, setOutcomesBusy] = useState(false);
    const { mutationPending: scrubberBusy } = useContext(ScrubberFindingsContext);
    const closeBlocked = busy || tagsBusy || dependenciesBusy || outcomesBusy || scrubberBusy;
    const [notesOpen, setNotesOpen] = useState(restoredDraft?.notesOpen ?? true);
    const lastAction = useRef<(() => Promise<void>) | null>(null);
    const live = useRef(true);
    useEffect(() => { live.current = true; return () => { live.current = false; }; }, []);
    useLayoutEffect(() => {
        rememberSentinelTodoView(owner, { itemDrafts: {
            ...recallSentinelTodoView(owner).itemDrafts, [item.id]: { editing, statusDraft, error, notesOpen },
        } });
    }, [owner, item.id, editing, statusDraft, error, notesOpen]);

    const run = async (action: () => Promise<{ message: string; conflict: boolean; current?: SentinelTodoItem } | null>,
        onDone: () => void, onConflict?: (current?: SentinelTodoItem) => void) => {
        const attempt = async () => {
            setBusy(true);
            setError(null);
            const failure = await action();
            if (!live.current) return;
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
        const initial = draft.initialFields ?? { title: item.title, completionCondition: item.completionCondition,
            notes: item.notes, priority: sentinelTodoPriority(item) };
        const fieldsChanged = draft.title.trim() !== initial.title.trim() || draft.completionCondition.trim() !== initial.completionCondition.trim()
            || draft.notes !== initial.notes || draft.priority !== initial.priority;
        void run(() => onSave(item, {
            ...(fieldsChanged ? {
                title: draft.title.trim(),
                completionCondition: draft.completionCondition.trim(),
                notes: draft.notes,
                priority: draft.priority,
            } : {}),
            ...(referencesEnabled && draft.externalReferencesChanged
                && JSON.stringify(draft.externalReferences ?? []) !== JSON.stringify(externalReferences(item))
                ? { externalReferences: draft.externalReferences ?? [] } : {}),
            ...(fieldsChanged && tagLibrary && matchMultiple ? { matchMultiple: true } : {}),
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

    const domId = headingId ?? `sentinel-todo-${item.id}`;
    const titleId = domId;
    const high = sentinelTodoPriority(item) === 'high';
    const displayStatus = sentinelTodoDisplayStatus(item);
    const foldNotes = sentinelTodoFoldNotes(item.notes);
    // Every row reserves the band's gutter, so changing priority never shifts content.
    return (
        <li hidden={hidden} className="relative select-text rounded border border-[#e0e0e0] pl-1 dark:border-[#3c3c3c]"
            data-testid={`sentinel-todo-detail-${item.id}`}
            data-priority={high ? 'high' : 'regular'}>
            {high && (
                <span aria-hidden="true" data-testid={`sentinel-todo-priority-band-${item.id}`}
                    className="pointer-events-none absolute inset-y-0 left-0 w-1 rounded-l-[3px] bg-[#e51400] dark:bg-[#f14c4c]" />
            )}
            <div className="flex items-start">
                <h2 id={titleId} tabIndex={-1} data-todo-heading={item.id}
                    className="m-0 flex min-w-0 flex-1 flex-wrap items-center gap-1.5 break-words px-2 py-2 text-xs font-semibold focus:outline-none focus-visible:ring-1 focus-visible:ring-[#0078d4]">
                    <span className="min-w-0 w-full">{item.title}</span>
                    <StatusBadge status={displayStatus} />
                    {high && <HighPriorityBadge itemId={item.id} />}
                    {sentinelTodoType(item) === 'manual' && <span className={MUTED}>Tracked only · never run</span>}
                </h2>
                <button type="button" aria-label="Close To-do details" title="Close To-do details"
                    disabled={closeBlocked} onClick={() => { if (!closeBlocked) onClose(); }}
                    className="m-1 flex h-6 w-6 shrink-0 items-center justify-center rounded text-[#848484] hover:bg-black/[0.04] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[#0078d4] disabled:cursor-not-allowed disabled:opacity-50 dark:hover:bg-white/[0.04]">
                    <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
                        <path d="m4 4 8 8M12 4l-8 8" />
                    </svg>
                </button>
            </div>
            {tagLibrary && <SentinelTodoTagPicker item={item} owner={owner} client={tagClient} library={tagLibrary}
                multiple={matchMultiple} onLedgerChange={onLedgerChange} onBusyChange={setTagsBusy} />}
            <SentinelTodoScrubFinding item={item} />
            <div className={cn('flex flex-wrap items-center gap-x-1.5 gap-y-0.5 px-2 pb-1.5 text-[11px]', MUTED)} data-testid={`sentinel-todo-meta-${item.id}`}>
                {item.targetRepo && (
                    <span className="max-w-full truncate" title={item.targetRepo.workspaceId} data-testid={`sentinel-todo-repo-${item.id}`}>
                        {item.targetRepo.label ?? item.targetRepo.workspaceId}
                    </span>
                )}
                {item.targetRepo && <span aria-hidden="true">·</span>}
                <TodoTime label="Updated" iso={item.updatedAt} testId={`sentinel-todo-updated-${item.id}`} />
                {canAttach && <AttachTodoButton title={item.title} onClick={attach} onDragStart={drag} />}
            </div>
            {attachError && <Notice tone="error" testId={`sentinel-todo-attach-error-${item.id}`}>{attachError}</Notice>}
            <TodoJobs item={item} owner={owner} currentWorkspaceId={currentWorkspaceId} expanded onFollowLink={onFollowLink} />
            {!hidden && <SentinelTodoPrOutcomes owner={owner} item={item} ledgerRevision={ledgerRevision} onBusyChange={setOutcomesBusy} />}
            <SentinelTodoConversationReferences item={item} owner={owner} onFollowLink={onFollowLink} />
            <SentinelTodoExternalReferences item={item} />
            <SentinelTodoDependencies owner={owner} item={item} items={items} ledgerRevision={ledgerRevision}
                expanded onLedgerChange={onLedgerChange} onItemLink={onItemLink} onArtifactLink={onArtifactLink} onBusyChange={setDependenciesBusy} />
            <div id={`${domId}-details`} className="flex flex-col gap-1.5 border-t border-[#e0e0e0] px-2 py-1.5 dark:border-[#3c3c3c]">
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
                            <DraftFields draft={editing} onChange={draft => setEditing({ ...editing, ...draft })} idPrefix={`${domId}-edit`}
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
                                            <button type="button" aria-expanded={notesOpen} aria-controls={`${domId}-notes`}
                                                onClick={() => setNotesOpen(open => !open)} data-testid={`sentinel-todo-notes-toggle-${item.id}`}
                                                className="rounded text-[#0078d4] hover:underline focus:outline-none focus-visible:ring-1 focus-visible:ring-[#0078d4] dark:text-[#3794ff]">
                                                {notesOpen ? 'Hide notes' : `Show notes (${sentinelTodoLineCount(item.notes)} lines)`}
                                            </button>
                                        )}
                                        {(!foldNotes || notesOpen) && (
                                            <div id={`${domId}-notes`} className="whitespace-pre-wrap break-words">{item.notes}</div>
                                        )}
                                    </dd></>
                            )}
                        </dl>
                    )}
                    {statusDraft && (
                        <form className="flex flex-col gap-1" data-testid={`sentinel-todo-reason-form-${item.id}`}
                            onSubmit={event => { event.preventDefault(); applyStatus(statusDraft.status, statusDraft.reason, true); }}>
                            <label className="text-[11px] font-medium" htmlFor={`${domId}-reason`}>
                                Reason for {SENTINEL_TODO_STATUS_LABELS[statusDraft.status]}
                                {sentinelTodoStatusReason(statusDraft.status) === 'optional' && <span className={MUTED}> (optional)</span>}
                            </label>
                            <input id={`${domId}-reason`} className={INPUT} value={statusDraft.reason} maxLength={2000} autoFocus
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
                                        externalReferences: externalReferences(item),
                                        initialFields: { title: item.title, completionCondition: item.completionCondition,
                                            notes: item.notes, priority: sentinelTodoPriority(item) },
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
        </li>
    );
}

function TodoJobs({ item, owner, currentWorkspaceId, expanded = false, onFollowLink, reasonPreview }: Pick<TodoDetailProps, 'item' | 'owner' | 'currentWorkspaceId' | 'onFollowLink'> & { expanded?: boolean; reasonPreview?: ReactNode }) {
    const shownJobs = expanded ? item.jobs : item.jobs.slice(-1);
    const hiddenJobs = item.jobs.length - shownJobs.length;
    if (!shownJobs.length) return reasonPreview ? <div className="flex min-w-0">{reasonPreview}</div> : null;
    return <ul className={cn('flex min-w-0 w-full flex-wrap gap-x-1.5 gap-y-0.5 text-[11px]',
        expanded ? 'flex-col items-stretch px-2 pb-1.5' : 'items-center')} aria-label={`Jobs for ${item.title}`}>
        {shownJobs.map(job => {
            const review = sentinelTodoReviewLabel(job);
            const executionLabel = sentinelTodoJobStateLabel(job);
            const jobLink = `${item.id}|job:${job.serverId ?? ''}:${job.processId}`;
            return <li key={`${job.serverId ?? ''}:${job.processId}`} className={cn('flex w-full min-w-0 max-w-full flex-wrap items-center gap-1',
                expanded && 'text-left [overflow-wrap:anywhere]')}>
                <SentinelTodoJobPreview key={`${sentinelTodoOwnerKey(owner)}:${job.workspaceId}:${job.serverId ?? ''}:${job.processId}:${job.sessionId ?? ''}`}
                    job={job} owner={owner} itemTitle={expanded ? undefined : item.title} linkKey={jobLink} onFollowLink={onFollowLink}
                    targetRepo={item.targetRepo} currentWorkspaceId={currentWorkspaceId}>
                    <ChatStatusPill status={job.execution.state} label={executionLabel} showDuration={false}
                        aria-label={`Job execution: ${executionLabel}`} data-testid="sentinel-todo-job-execution"
                        className="shrink-0 !h-[18px] !px-1.5" />
                    {review && <span className={cn(MUTED, 'max-w-full break-words [overflow-wrap:anywhere]')} aria-label={`Job review: ${review}`}>· {review}</span>}
                    {reasonPreview}
                </SentinelTodoJobPreview>
            </li>;
        })}
        {hiddenJobs > 0 && <li className={MUTED} data-testid={`sentinel-todo-earlier-jobs-${item.id}`}>
            +{hiddenJobs} earlier job{hiddenJobs === 1 ? '' : 's'}
        </li>}
    </ul>;
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
