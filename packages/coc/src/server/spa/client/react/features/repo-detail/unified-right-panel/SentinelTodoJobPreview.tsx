import { useCallback, useEffect, useId, useMemo, useRef, useState, type FocusEvent, type MouseEvent } from 'react';
import { createPortal } from 'react-dom';
import type { SentinelTodoJobLink, SentinelTodoTargetRepo } from '@plusplusoneplusplus/coc-client';
import { useCocClient } from '../../../repos/cloneRouting';
import { resolveCloneRoute } from '../../../repos/cloneRegistry';
import { buildRemoteCloneKey } from '../../../repos/cloneIdentity';
import { useAppOptional } from '../../../contexts/AppContext';
import { useReposOptional } from '../../../contexts/ReposContext';
import { useAnchoredPanelPosition } from '../../../shared/useAnchoredPanelPosition';
import { usePortalContainer } from '../../../ui/usePortalContainer';
import { WORKFLOW_REGISTRY, normalizeChatMode } from '../../../repos/modeConfig';
import { getChatRowModeBadgeClasses } from '../../chat/chat-row-style';
import { formatRelativeTime } from '../../../utils/format';
import { sentinelTodoJobStateLabel, sentinelTodoReviewLabel, type SentinelTodoOwner } from './sentinelTodoPanelModel';
import { resolveSentinelTodoJobOwner } from './sentinelTodoJobOwner';

interface PreviewData { excerpt: string; source: string; at?: string; fetchedAt: number }
const CACHE_MS = 15_000;
const MUTED = 'text-[#616161] dark:text-[#9d9d9d]';
const LINK = 'rounded text-[#0078d4] hover:underline focus-visible:outline focus-visible:outline-[#0078d4] dark:text-[#3794ff]';

/** One ledger-validated job reference. Reads only compact owner-scoped metadata, never transcripts. */
export function SentinelTodoJobPreview({ job, owner, targetRepo, currentWorkspaceId, linkKey, onFollowLink, itemTitle }: {
    itemTitle?: string;
    job: SentinelTodoJobLink; owner: SentinelTodoOwner; targetRepo?: SentinelTodoTargetRepo; currentWorkspaceId?: string; linkKey: string;
    onFollowLink: (event: MouseEvent<HTMLAnchorElement>, key: string) => void;
}) {
    const ralph = job.kind === 'ralph' || !!job.sessionId;
    const mode = ralph ? 'ralph' : normalizeChatMode(job.mode);
    const badgeMode = mode === 'ask' || mode === 'autopilot' || mode === 'ralph' ? mode : undefined;
    const badgeLabel = WORKFLOW_REGISTRY.find(entry => entry.mode === badgeMode)?.label;
    const app = useAppOptional();
    const repos = useReposOptional();
    const workspaces = useMemo(() => [
        ...(repos?.repos.map(repo => repo.workspace) ?? []),
        ...(app?.state.workspaces ?? []),
        ...(repos?.remoteGroupWorkspaces ?? []),
    ], [repos?.repos, app?.state.workspaces, repos?.remoteGroupWorkspaces]);
    const jobOwner = resolveSentinelTodoJobOwner({
        job, owner, targetRepo, workspaces,
        currentWorkspaceId: currentWorkspaceId ?? app?.state.selectedRepoId ?? undefined,
    });
    const routeRef = job.serverId ? buildRemoteCloneKey(job.serverId, job.workspaceId) : owner.ownerRoutingRef ?? undefined;
    const route = resolveCloneRoute(routeRef ?? null);
    const unavailable = !job.workspaceId || route.kind === 'unresolved-remote' || (job.kind === 'remote' && !job.serverId);
    const client = useCocClient(routeRef);
    // Each rendered reference retains at most one bounded excerpt; unmount releases it.
    const executionKey = JSON.stringify(job.execution);
    const cache = useRef<{ client: typeof client; executionKey: string; data: PreviewData }>();
    const [data, setData] = useState<PreviewData>();
    const [error, setError] = useState<string>();
    const [loading, setLoading] = useState(false);
    const [open, setOpen] = useState(false);
    const triggerRef = useRef<HTMLSpanElement>(null);
    const panelRef = useRef<HTMLDivElement>(null);
    const paneRef = useRef<HTMLElement | null>(null);
    const returnRef = useRef<HTMLElement | null>(null);
    const enter = useRef<ReturnType<typeof setTimeout>>();
    const leave = useRef<ReturnType<typeof setTimeout>>();
    const persistent = useRef(false);
    const suppressed = useRef(false);
    const entering = useRef(false);
    const pointerWithin = useRef(false);
    const id = useId();
    const title = job.title ?? job.processId;
    const linkTitle = itemTitle !== undefined && title === itemTitle ? 'Open job' : title;
    const external = /^https?:\/\//i.test(job.openLink);
    // The ledger validates stored destinations; an unresolved remote may use its
    // external destination but must never acquire a page-origin hash fallback.
    const navigable = external || (job.openLink.startsWith('#') && !unavailable);
    const portal = usePortalContainer(open);
    const clear = useCallback(() => { clearTimeout(enter.current); clearTimeout(leave.current); }, []);
    const dismiss = useCallback((restore = false) => {
        clear(); persistent.current = false; suppressed.current = true; setOpen(false);
        if (restore) returnRef.current?.focus();
    }, [clear]);
    const show = (explicit = false) => {
        clear();
        if (suppressed.current && !explicit) return;
        if (explicit) { suppressed.current = false; persistent.current = true; entering.current = true; }
        returnRef.current ??= triggerRef.current?.querySelector<HTMLElement>('a') ?? null;
        paneRef.current = triggerRef.current?.closest('[data-testid="sentinel-todo-tab"]') ?? null;
        document.dispatchEvent(new CustomEvent('sentinel-todo-job-preview-open', { detail: id }));
        setOpen(true);
        if (explicit) {
            const first = panelRef.current?.querySelector<HTMLElement>('button');
            if (first) { entering.current = false; first.focus(); }
        }
    };
    const scheduleLeave = () => {
        clear();
        if (persistent.current) return;
        leave.current = setTimeout(() => {
            if (!triggerRef.current?.contains(document.activeElement) && !panelRef.current?.contains(document.activeElement)) dismiss();
        }, 250);
    };
    const blur = (event: FocusEvent<HTMLElement>) => {
        const next = event.relatedTarget;
        if (next instanceof Node && (triggerRef.current?.contains(next) || panelRef.current?.contains(next))) return;
        // A pointer preview stays usable while focus moves elsewhere; keyboard
        // departure from a persistent dialog dismisses it as well.
        if (!pointerWithin.current || persistent.current) dismiss();
        suppressed.current = false;
    };
    useEffect(() => () => clear(), [clear]);
    useEffect(() => {
        if (!open) return;
        const anotherPreview = (event: Event) => { if ((event as CustomEvent<string>).detail !== id) dismiss(); };
        const outside = (event: PointerEvent) => {
            if (event.target instanceof Node && !triggerRef.current?.contains(event.target) && !panelRef.current?.contains(event.target)) dismiss();
        };
        const escape = (event: KeyboardEvent) => {
            if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); dismiss(true); }
        };
        document.addEventListener('sentinel-todo-job-preview-open', anotherPreview);
        document.addEventListener('pointerdown', outside);
        document.addEventListener('keydown', escape);
        return () => { document.removeEventListener('sentinel-todo-job-preview-open', anotherPreview); document.removeEventListener('pointerdown', outside); document.removeEventListener('keydown', escape); };
    }, [open, dismiss, id]);
    useEffect(() => {
        if (open && portal && entering.current) {
            entering.current = false;
            panelRef.current?.querySelector<HTMLElement>('button')?.focus();
        }
    }, [open, portal]);
    useEffect(() => {
        if (!open || unavailable) return;
        const cached = cache.current?.client === client && cache.current.executionKey === executionKey ? cache.current.data : undefined;
        setData(cached); setError(undefined);
        if (cached && Date.now() - cached.fetchedAt < CACHE_MS) { setLoading(false); return; }
        const controller = new AbortController();
        let current = true;
        setLoading(true);
        const timeout = setTimeout(() => {
            controller.abort();
            if (current) { setError('Owner read timed out'); setLoading(false); current = false; }
        }, 8_000);
        const read = async (): Promise<PreviewData> => {
            if (ralph) {
                if (!job.sessionId) throw new Error('Ralph session identity unavailable');
                const group = await client.taskGroups.get(job.workspaceId, job.sessionId, { signal: controller.signal });
                if (group.workspaceId !== job.workspaceId || group.groupId !== job.sessionId || group.type !== 'ralph') throw new Error('Owner returned a different session');
                const extra = group.extra ?? {};
                const iteration = typeof extra.currentIteration === 'number' ? extra.currentIteration : undefined;
                const limit = typeof extra.maxIterations === 'number' ? extra.maxIterations : undefined;
                const phase = typeof extra.detailStatus === 'string' ? extra.detailStatus : group.status;
                const reason = typeof extra.terminalReason === 'string' ? extra.terminalReason : undefined;
                return { excerpt: `${iteration === undefined ? 'Session' : `Iteration ${iteration}${limit === undefined ? '' : ` of ${limit}`}`} · ${phase}${reason ? `\n${reason}` : ''}`.slice(0, 800), source: 'Whole-session summary', at: group.updatedAt, fetchedAt: Date.now() };
            }
            const { process } = await client.processes.get(job.processId, { workspace: job.workspaceId, exclude: ['conversation', 'toolCalls'], preview: true }, { signal: controller.signal });
            if ((process.id !== job.processId && process.id !== job.processId.replace(/^queue_/, '')) || process.workspaceId !== job.workspaceId) throw new Error('Owner returned a different job');
            const preview = process.jobPreview;
            if (!preview) throw new Error('Compact job preview unsupported by this owner');
            const excerpt = preview.excerpt.trim();
            return { excerpt: excerpt ? excerpt.slice(0, 800) : job.execution.state === 'queued' ? 'No progress yet. Waiting for execution.' : 'No compact progress or result excerpt available.', source: preview.source === 'progress' ? 'Latest recorded assistant response' : preview.source === 'result' ? 'Recorded job result' : preview.source === 'error' ? 'Recorded job error' : 'Owner metadata', at: preview.updatedAt, fetchedAt: Date.now() };
        };
        void read().then(next => { if (current) { cache.current = { client, executionKey, data: next }; setData(next); } })
            .catch(failure => { if (current) setError(failure instanceof Error ? failure.message : 'Owner read failed'); })
            .finally(() => { clearTimeout(timeout); if (current) setLoading(false); });
        return () => { current = false; clearTimeout(timeout); controller.abort(); };
    }, [open, client, unavailable, job.workspaceId, job.processId, job.sessionId, job.execution.state, executionKey, ralph]);
    const position = useAnchoredPanelPosition({ open, placement: 'down', align: 'left', gap: 6, constrainHeight: true, triggerRef, panelRef, boundaryRef: paneRef, anchorKey: `${loading}:${error}:${data?.fetchedAt}` });
    const follow = (event: MouseEvent<HTMLAnchorElement>) => { onFollowLink(event, linkKey); dismiss(); };
    const anchorProps = { href: navigable ? job.openLink : undefined, ...(external ? { target: '_blank', rel: 'noopener noreferrer' } : {}), onClick: follow };
    const reason = 'reason' in job.execution ? job.execution.reason : undefined;
    const stale = !!data && (unavailable || loading || !!error || Date.now() - data.fetchedAt >= CACHE_MS);
    return <>
        <span ref={triggerRef} className="inline-flex min-w-0 max-w-full flex-wrap items-center gap-1" onPointerEnter={event => {
            if (event.pointerType !== 'mouse') return;
            pointerWithin.current = true; suppressed.current = false; clear(); enter.current = setTimeout(() => show(), 200);
        }} onPointerLeave={() => { pointerWithin.current = false; scheduleLeave(); }} onFocus={event => {
            returnRef.current = event.target as HTMLElement;
            if (!suppressed.current) show();
        }} onBlur={blur} onKeyDown={event => {
            if (event.key === 'ArrowDown' || (event.key === 'Tab' && !event.shiftKey && event.target === triggerRef.current?.querySelector('button') && open)) {
                event.preventDefault(); show(true);
            }
        }}>
            <a {...anchorProps} role="link" tabIndex={navigable ? undefined : 0} data-todo-link={linkKey} title={title} aria-label={linkTitle === title ? undefined : `Open job: ${title}`} aria-description="Focus to preview; ArrowDown enters preview actions." className={`${LINK} min-w-0 break-words [overflow-wrap:anywhere]`} aria-disabled={!navigable || undefined}>{linkTitle}</a>
            {jobOwner.showBadge && <span role="note" data-testid="sentinel-todo-job-owner" title={jobOwner.description} aria-label={jobOwner.description}
                className="inline-block min-w-0 max-w-full truncate rounded-full border border-[#d0d7de] bg-black/[0.04] px-1.5 py-0.5 text-[10px] text-[#616161] dark:border-[#4a4a4a] dark:bg-white/[0.06] dark:text-[#bbbbbb]"
                style={{ maxWidth: 'min(100%, 15rem)' }}>
                <span aria-hidden="true">{jobOwner.label}</span>
            </span>}
            {badgeMode && <span title={badgeMode === 'ralph' ? 'Ralph session' : `${badgeLabel} mode`}
                data-testid="sentinel-todo-job-mode"
                className={badgeMode === 'ralph'
                    ? 'inline-flex shrink-0 items-center rounded bg-[#8764b8]/15 px-1.5 py-0.5 text-[11px] font-medium text-[#7150a2] dark:text-[#c5a5ed]'
                    : `${getChatRowModeBadgeClasses(badgeMode === 'autopilot' ? 'auto' : 'ask')} !w-auto !rounded-full !py-0.5 px-1.5 shrink-0 !font-sans !font-medium !normal-case !tracking-normal !text-[11px]`}>
                {badgeLabel}
            </span>}
            <button type="button" aria-label={`Preview job: ${title}`} aria-haspopup="dialog" aria-expanded={open} aria-controls={open ? id : undefined}
                className={`${LINK} shrink-0 px-1 text-[11px]`} onClick={event => {
                    returnRef.current = event.currentTarget;
                    if (open && persistent.current) dismiss(true); else show(true);
                }}>ⓘ</button>
        </span>
        {open && portal && createPortal(<div ref={panelRef} id={id} role="dialog" aria-modal="false" aria-labelledby={`${id}-title`} data-native-view-overlay
            className="fixed z-50 w-[330px] overflow-auto rounded border border-[#d0d7de] bg-white p-3 text-xs text-[#1e1e1e] shadow-lg dark:border-[#3c3c3c] dark:bg-[#252526] dark:text-[#cccccc]"
            style={{ ...position, maxHeight: Math.min(320, position.maxHeight ?? 320), overflowWrap: 'anywhere' }}
            onPointerEnter={() => { pointerWithin.current = true; clear(); }} onPointerLeave={() => { pointerWithin.current = false; scheduleLeave(); }} onFocus={clear} onBlur={blur}
            onKeyDown={event => {
                if (event.key === 'Tab' && event.shiftKey && event.target === panelRef.current?.querySelector('button')) {
                    event.preventDefault(); dismiss(true);
                }
            }}>
            <header className="flex items-start justify-between gap-2"><h3 id={`${id}-title`} className="font-medium">{title}</h3>
                <button type="button" aria-label="Close job preview" className={LINK} onClick={() => dismiss(true)}>×</button></header>
            <p role="note" className={`mt-1 text-[11px] ${MUTED}`} title={jobOwner.description} aria-label={jobOwner.description}>
                <span aria-hidden="true">{jobOwner.label}</span>
            </p>
            <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-2 gap-y-1 text-[11px]">
                <dt className={MUTED}>Execution</dt><dd>{sentinelTodoJobStateLabel(job)} · {ralph ? 'Ralph session' : 'Ordinary job'}</dd>
                <dt className={MUTED}>Review</dt><dd>{sentinelTodoReviewLabel(job) ?? 'No terminal review recorded'}</dd>
            </dl>
            <div role="status" className="mt-2 whitespace-pre-wrap rounded bg-black/[0.04] p-2 text-[11px] dark:bg-white/[0.04]">
                {unavailable ? 'Preview unavailable: owning server is unresolved. Stored state may be stale.' : loading ? 'Loading job preview from its owner…' : error ? `${error.includes('unsupported') ? 'Preview unavailable' : 'Preview error'}: ${error}. Stored state may be stale.` : null}
                {data && <p className="mt-1">{data.excerpt}</p>}
                {reason && <p className="mt-1">Recorded result: {reason}</p>}
            </div>
            <p className={`mt-1 text-[10px] ${MUTED}`}>{data ? `${stale ? 'Stale · ' : ''}${data.source} · ${data.at && !Number.isNaN(Date.parse(data.at)) ? formatRelativeTime(data.at) : 'timestamp unavailable'} · fetched ${formatRelativeTime(new Date(data.fetchedAt).toISOString())}` : `Stored link · ${formatRelativeTime(job.linkedAt)}`}</p>
            <footer className="sticky bottom-0 mt-2 flex justify-end bg-white dark:bg-[#252526] border-t border-[#e0e0e0] pt-2 dark:border-[#3c3c3c]">{navigable ? <a {...anchorProps} className={`${LINK} rounded border border-[#d0d7de] px-2 py-1 dark:border-[#3c3c3c]`}>Open job ↗</a> : <span className={MUTED}>Open job unavailable</span>}</footer>
            <p className={`mt-2 text-[10px] ${MUTED}`}>Job completion and review do not mark this item Done.</p>
        </div>, portal)}
    </>;
}
