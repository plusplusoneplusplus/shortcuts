/**
 * PrStatusCard — pinned, read-only status card for the pull requests a chat
 * created (AC-02).
 *
 * Renders one row per associated PR, newest first, stacked. Each row shows the
 * PR number, title, a lifecycle state badge (open / draft / merged / closed),
 * the `head → base` branch pair, a terminal (merged/closed) timestamp, and an
 * "open full PR" deep-link into the existing `PullRequestDetail` view. The card
 * is read-only — no action buttons beyond the deep-link and a retry control.
 *
 * Per-PR UX states (driven by {@link PrStatusCardItem.state}):
 *   - loading: detail fetch in flight → skeleton row
 *   - ready:   detail loaded → full row (terminal rows get muted styling)
 *   - error:   fetch failed → inline error + retry
 *
 * Card-level: with no items the whole card is hidden (empty state). Otherwise
 * the card starts as a compact count row; that top row acts as a dropdown toggle
 * for the full PR list.
 *
 * Reuses {@link prStatusBadge} / {@link formatTimestamp} from the pull-requests
 * feature (no duplicated badge or timestamp logic) and {@link buildPrDetailHash}
 * for the deep-link.
 */
import React, { useEffect, useState } from 'react';
import { prStatusBadge, formatTimestamp, type PrStatus, type PullRequestDiffStats } from '../../pull-requests/pr-utils';
import { buildPrDetailHash } from '../../pull-requests/pr-open-utils';
import { PrChecksCompact, PrChecksSummaryChips, type PrChecksCompactState } from '../../pull-requests/PrChecksSummary';
import type { PrCheckRow } from '../../pull-requests/pr-derived-data';
import { formatUpdatedAgo } from './prStatusFreshness';
import { summarizeLifecycleStatus, summarizeMergeStatus, type LifecycleStatusSummary, type MergeStatusSummary } from './prMergeStatusSummary';

/** Per-PR fetch lifecycle for a card row. */
export type PrStatusCardItemState = 'loading' | 'ready' | 'error';

/**
 * Provider-agnostic auto-merge / auto-complete status (AC-04). A read-only,
 * UI-side mirror of the canonical forge `PullRequestAutoMerge` shape surfaced via
 * the PR-detail endpoint. GitHub maps it from REST `pulls.get`; ADO from
 * `autoCompleteSetBy` / `completionOptions` / `mergeStatus`.
 */
export interface PrAutoMergeInfo {
    /** Whether auto-merge (GitHub) / auto-complete (ADO) is enabled. */
    enabled: boolean;
    /** Unified lifecycle state. */
    state: 'not-enabled' | 'armed' | 'queued' | 'blocked' | string;
    /** Identity that enabled it, when known. */
    enabledBy?: { displayName?: string };
    /** Normalized merge method the provider will use ('squash' | 'merge' | …). */
    mergeMethod?: string;
    /** Reason the merge is blocked — only meaningful when `state` is 'blocked'. */
    blockedReason?: 'failing-checks' | 'pending-review' | 'conflicts' | 'blocked' | string;
}

/**
 * Minimal PR detail the card renders. Intentionally a subset of the canonical
 * `PullRequest` (pr-utils) so a fetched detail object can be passed directly.
 */
export interface PrStatusCardPr {
    number?: number;
    title: string;
    status: PrStatus | string;
    sourceBranch: string;
    targetBranch: string;
    mergedAt?: string;
    closedAt?: string;
    url?: string;
    /** Auto-merge / auto-complete status (AC-04), when surfaced by the detail. */
    autoMerge?: PrAutoMergeInfo;
    /** Real diff stats (additions / deletions / changed files), when the detail carries them. */
    diffStats?: PullRequestDiffStats;
}

export interface PrStatusCardItem {
    /** Stable React key and retry id (e.g. `${originId}:${prId}`). */
    key: string;
    /** Workspace/repo id used to deep-link into PullRequestDetail. */
    repoId: string;
    /** PR number for display + deep-link (falls back to `pr.number`). */
    number: number;
    /** Per-PR fetch state. */
    state: PrStatusCardItemState;
    /** Loaded PR detail (present when `state === 'ready'`). */
    pr?: PrStatusCardPr;
    /** Error message shown when `state === 'error'`. */
    error?: string;
    /** Web URL from detection — fallback external "open" link before detail loads. */
    url?: string;
    /** Sort key — newer sorts first. ISO string or epoch number. */
    createdAt?: string | number;
    /** Per-PR CI-checks fetch lifecycle (AC-03) — undefined until first expanded. */
    checksState?: PrChecksCompactState;
    /** Loaded check rows (present when `checksState === 'ready'`). */
    checks?: PrCheckRow[];
    /** Error message shown when `checksState === 'error'`. */
    checksError?: string;
}

export interface PrStatusCardProps {
    items: PrStatusCardItem[];
    /** Retry a failed item's fetch. */
    onRetry?: (key: string) => void;
    /**
     * Expand a row's CI checks (AC-03) — fired on first expand so the connected
     * card can lazily fetch the checks, and again on an in-panel retry.
     */
    onExpandChecks?: (key: string) => void;
    /** Force-refresh all rows (AC-05) — wires the manual refresh control. */
    onRefresh?: () => void;
    /** True while a refresh is in flight — shows the refresh control as busy. */
    refreshing?: boolean;
    /** Epoch ms of the last successful fetch — drives the "updated Xs ago" label (AC-05). */
    lastUpdatedAt?: number;
}

const TERMINAL_STATES = new Set<string>(['merged', 'closed']);

function isTerminal(status: string | undefined): boolean {
    return !!status && TERMINAL_STATES.has(status);
}

function terminalTimestamp(pr: PrStatusCardPr): string {
    if (pr.status === 'merged') return formatTimestamp(pr.mergedAt);
    if (pr.status === 'closed') return formatTimestamp(pr.closedAt ?? pr.mergedAt);
    return '';
}

/** Hosting provider a PR belongs to — drives the provider-aware auto-merge label. */
export type PrProvider = 'github' | 'azure-devops';

/**
 * Derives the provider from a PR web URL by host (not a PR-URL regex — pure host
 * detection), so the auto-merge label is correct for detected *and* binding-only
 * PRs that only carry a `url` from the fetched detail.
 */
export function prProviderFromUrl(url: string | undefined): PrProvider | undefined {
    if (!url) return undefined;
    if (url.includes('github.com')) return 'github';
    if (url.includes('dev.azure.com') || url.includes('visualstudio.com')) return 'azure-devops';
    return undefined;
}

/** Provider-aware base label: GitHub "Auto-merge" vs Azure DevOps "Auto-complete". */
export function autoMergeLabel(provider: PrProvider | undefined): string {
    return provider === 'azure-devops' ? 'Auto-complete' : 'Auto-merge';
}

/** Human text for each canonical blocked reason. */
const AUTO_MERGE_BLOCKED_REASON_TEXT: Record<string, string> = {
    'failing-checks': 'failing checks',
    'pending-review': 'pending review',
    conflicts: 'conflicts',
    blocked: 'blocked',
};

/** The visible, provider-aware shape of the auto-merge indicator. */
export interface AutoMergeIndicatorModel {
    /** Provider-aware base label ("Auto-merge" | "Auto-complete"). */
    label: string;
    /** Active state (never 'not-enabled' — that yields no indicator). */
    state: 'armed' | 'queued' | 'blocked';
    /** Display name of whoever armed it, when known. */
    enabledBy?: string;
    /** Normalized merge method, when exposed. */
    mergeMethod?: string;
    /** Human blocked-reason text, only when `state` is 'blocked'. */
    blockedReason?: string;
}

/**
 * Reduces the unified auto-merge shape to the indicator the card renders, or
 * `null` when there is nothing to show (disabled / not-enabled / unknown state).
 * Pure + provider-aware so it is unit-testable for both GitHub and ADO.
 */
export function describeAutoMerge(
    autoMerge: PrAutoMergeInfo | undefined,
    provider: PrProvider | undefined,
): AutoMergeIndicatorModel | null {
    if (!autoMerge || !autoMerge.enabled) return null;
    const { state } = autoMerge;
    if (state !== 'armed' && state !== 'queued' && state !== 'blocked') return null;
    return {
        label: autoMergeLabel(provider),
        state,
        enabledBy: autoMerge.enabledBy?.displayName || undefined,
        mergeMethod: autoMerge.mergeMethod || undefined,
        blockedReason:
            state === 'blocked' && autoMerge.blockedReason
                ? AUTO_MERGE_BLOCKED_REASON_TEXT[autoMerge.blockedReason] ?? autoMerge.blockedReason
                : undefined,
    };
}

export const AUTO_MERGE_TONE_CLASS: Record<AutoMergeIndicatorModel['state'], string> = {
    armed: 'bg-[#dafbe1] text-[#1a7f37] dark:bg-[#238636]/25 dark:text-[#3fb950]',
    queued: 'bg-[#ddf4ff] text-[#0969da] dark:bg-[#388bfd]/25 dark:text-[#58a6ff]',
    blocked: 'bg-[#ffebe9] text-[#cf222e] dark:bg-[#f85149]/20 dark:text-[#f85149]',
};

export const AUTO_MERGE_TONE_EMOJI: Record<AutoMergeIndicatorModel['state'], string> = {
    armed: '⚡',
    queued: '⏳',
    blocked: '⛔',
};

function AutoMergeIndicator({ model, testKey }: { model: AutoMergeIndicatorModel; testKey: string }) {
    const parts: string[] = [];
    if (model.state === 'blocked' && model.blockedReason) parts.push(model.blockedReason);
    if (model.mergeMethod) parts.push(model.mergeMethod);
    if (model.enabledBy) parts.push(`by ${model.enabledBy}`);
    const detail = parts.join(' · ');
    const title = `${model.label} ${model.state}${detail ? ` — ${detail}` : ''}`;
    return (
        <span
            className={
                'inline-flex shrink-0 items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-medium ' +
                AUTO_MERGE_TONE_CLASS[model.state]
            }
            data-testid={`pr-status-card-automerge-${testKey}`}
            data-automerge-state={model.state}
            title={title}
        >
            <span aria-hidden="true">{AUTO_MERGE_TONE_EMOJI[model.state]}</span>
            <span>{model.label} {model.state}</span>
            {detail && <span className="font-normal opacity-90">· {detail}</span>}
        </span>
    );
}

/**
 * PR lifecycle-status indicator for the collapsed top-level header — ALWAYS shown
 * (for ready rows) so the user can tell at a glance whether the PR is open, a
 * draft, already merged, or closed, without expanding the card. Single-PR cards
 * show one status badge; multi-PR cards show per-status counts. Reuses
 * {@link prStatusBadge} (no new lifecycle logic).
 */
function PrLifecycleStatusIndicator({ summary }: { summary: LifecycleStatusSummary }) {
    const chipBase = 'inline-flex shrink-0 items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-medium ';

    if (summary.kind === 'single') {
        return (
            <span
                className="flex min-w-0 items-center"
                data-testid="pr-status-card-pr-status"
                data-pr-status-kind="single"
                data-pr-status={summary.status}
                title={summary.label}
            >
                <span className={chipBase + summary.toneClass}>
                    <span aria-hidden="true">{summary.emoji}</span>
                    <span>{summary.label}</span>
                </span>
            </span>
        );
    }

    const title = summary.segments.map(segment => `${segment.count} ${segment.label}`).join(' · ');
    return (
        <span
            className="flex min-w-0 flex-wrap items-center gap-1"
            data-testid="pr-status-card-pr-status"
            data-pr-status-kind="multi"
            title={title}
        >
            {summary.segments.map(segment => (
                <span
                    key={segment.status}
                    className={chipBase + segment.toneClass}
                    data-pr-status-segment={segment.status}
                    data-count={segment.count}
                >
                    <span aria-hidden="true">{segment.emoji}</span>
                    <span>{segment.count} {segment.label}</span>
                </span>
            ))}
        </span>
    );
}

/**
 * Auto-merge status indicator for the collapsed top-level header — shown
 * additionally (next to the lifecycle status) only when auto-merge / auto-complete
 * is active. Single-PR cards mirror that PR's auto-merge (label + reason); multi-PR
 * cards show per-state counts ordered by attention. Read-only text (not a toggle);
 * truncates on narrow widths and participates in the header's `flex-wrap`.
 */
function MergeStatusHeaderIndicator({ summary }: { summary: MergeStatusSummary }) {
    const chipBase = 'inline-flex shrink-0 items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-medium ';

    if (summary.kind === 'single') {
        const model = summary.autoMerge;
        const visibleParts: string[] = [];
        if (model.state === 'blocked' && model.blockedReason) visibleParts.push(model.blockedReason);
        const visibleDetail = visibleParts.join(' · ');
        const titleParts: string[] = [];
        if (model.state === 'blocked' && model.blockedReason) titleParts.push(model.blockedReason);
        if (model.mergeMethod) titleParts.push(model.mergeMethod);
        if (model.enabledBy) titleParts.push(`by ${model.enabledBy}`);
        const title = `${model.label} ${model.state}${titleParts.length ? ` — ${titleParts.join(' · ')}` : ''}`;
        return (
            <span
                className="flex min-w-0 items-center"
                data-testid="pr-status-card-merge-status"
                data-merge-kind="single"
                data-merge-state={model.state}
                title={title}
            >
                <span className={chipBase + 'min-w-0 ' + AUTO_MERGE_TONE_CLASS[model.state]}>
                    <span aria-hidden="true">{AUTO_MERGE_TONE_EMOJI[model.state]}</span>
                    <span className="truncate">
                        {model.label} {model.state}
                        {visibleDetail && <span className="font-normal opacity-90"> · {visibleDetail}</span>}
                    </span>
                </span>
            </span>
        );
    }

    const title = summary.segments.map(segment => `${segment.count} ${segment.label}`).join(' · ');
    return (
        <span
            className="flex min-w-0 flex-wrap items-center gap-1"
            data-testid="pr-status-card-merge-status"
            data-merge-kind="multi"
            title={title}
        >
            {summary.segments.map(segment => (
                <span
                    key={segment.state}
                    className={chipBase + segment.toneClass}
                    data-merge-segment={segment.state}
                    data-count={segment.count}
                >
                    <span aria-hidden="true">{segment.emoji}</span>
                    <span>{segment.count} {segment.label}</span>
                </span>
            ))}
        </span>
    );
}

/** Stable newest-first ordering: descending `createdAt`, input order otherwise. */
function sortNewestFirst(items: PrStatusCardItem[]): PrStatusCardItem[] {
    const toMs = (v: string | number | undefined): number => {
        if (v == null) return Number.NEGATIVE_INFINITY;
        if (typeof v === 'number') return v;
        const t = new Date(v).getTime();
        return Number.isNaN(t) ? Number.NEGATIVE_INFINITY : t;
    };
    return items
        .map((item, idx) => ({ item, idx }))
        .sort((a, b) => {
            const diff = toMs(b.item.createdAt) - toMs(a.item.createdAt);
            return diff !== 0 ? diff : a.idx - b.idx;
        })
        .map(({ item }) => item);
}

export function PrStatusCard({
    items,
    onRetry,
    onExpandChecks,
    onRefresh,
    refreshing = false,
    lastUpdatedAt,
}: PrStatusCardProps) {
    const sorted = sortNewestFirst(items);
    const [expanded, setExpanded] = useState(false);
    // Which rows have their CI-checks panel expanded (AC-03).
    const [checksExpandedKeys, setChecksExpandedKeys] = useState<ReadonlySet<string>>(() => new Set());

    // Tick a clock so the "updated Xs ago" label stays current between fetches.
    const [now, setNow] = useState(() => Date.now());
    useEffect(() => {
        if (lastUpdatedAt === undefined) return undefined;
        const id = setInterval(() => setNow(Date.now()), 5000);
        return () => clearInterval(id);
    }, [lastUpdatedAt]);

    const toggleChecks = (key: string) =>
        setChecksExpandedKeys(prev => {
            const next = new Set(prev);
            if (next.has(key)) next.delete(key);
            else next.add(key);
            return next;
        });

    // Empty state — card is hidden entirely.
    if (sorted.length === 0) return null;

    const updatedLabel = formatUpdatedAgo(lastUpdatedAt, now);
    // Lifecycle status (open/draft/merged/closed) is always shown on the collapsed
    // header; the auto-merge status is shown next to it only when active.
    const lifecycleStatus = summarizeLifecycleStatus(sorted);
    const mergeStatus = summarizeMergeStatus(sorted);

    const showRows = expanded;

    return (
        <div
            className={
                'pr-status-card sticky top-0 z-10 rounded-md border ' +
                'border-[#d0d7de] dark:border-[#3c3c3c] ' +
                'bg-[#f6f8fa] dark:bg-[#161b22] shadow-sm'
            }
            data-testid="pr-status-card"
            role="region"
            aria-label="Pull requests created in this chat"
        >
            {/* Header wraps (flex-wrap) so the freshness label + refresh control
                drop to a second line rather than overflowing on narrow mobile
                viewports (AC-06, 375px). The toggle can shrink (`min-w-0`) and the
                control cluster stays intact (`shrink-0`). */}
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1 px-2.5 py-1.5">
                <button
                    type="button"
                    className={
                        'flex min-w-0 items-center gap-2 text-xs font-semibold ' +
                        'text-[#57606a] dark:text-[#8b949e] select-none ' +
                        'cursor-pointer hover:text-[#1f2328] dark:hover:text-[#c9d1d9]'
                    }
                    data-testid="pr-status-card-toggle"
                    aria-expanded={showRows}
                    onClick={() => setExpanded(v => !v)}
                >
                    <span aria-hidden="true">🔀</span>
                    <span className="truncate">
                        {sorted.length === 1 ? '1 pull request' : `${sorted.length} pull requests`}
                    </span>
                    <span className="shrink-0" aria-hidden="true">{showRows ? '▾' : '▸'}</span>
                </button>

                {lifecycleStatus && <PrLifecycleStatusIndicator summary={lifecycleStatus} />}
                {mergeStatus && <MergeStatusHeaderIndicator summary={mergeStatus} />}

                <div className="ml-auto flex shrink-0 items-center gap-2 text-[11px] text-[#57606a] dark:text-[#8b949e]">
                    {updatedLabel && (
                        <span data-testid="pr-status-card-updated" title={updatedLabel}>
                            {updatedLabel}
                        </span>
                    )}
                    {onRefresh && (
                        <button
                            type="button"
                            className={
                                'inline-flex items-center gap-1 rounded px-1.5 py-0.5 font-medium ' +
                                'text-[#0969da] dark:text-[#58a6ff] hover:bg-black/[0.05] dark:hover:bg-white/[0.08] ' +
                                'disabled:opacity-60'
                            }
                            data-testid="pr-status-card-refresh"
                            aria-label="Refresh pull request status"
                            aria-busy={refreshing}
                            disabled={refreshing}
                            onClick={onRefresh}
                        >
                            <span className={refreshing ? 'animate-spin' : ''} aria-hidden="true">↻</span>
                            <span>{refreshing ? 'Refreshing…' : 'Refresh'}</span>
                        </button>
                    )}
                </div>
            </div>

            {showRows && (
                <div className="border-t border-[#d0d7de] dark:border-[#3c3c3c]">
                    {sorted.map(item => (
                        <PrStatusCardRow
                            key={item.key}
                            item={item}
                            onRetry={onRetry}
                            checksExpanded={checksExpandedKeys.has(item.key)}
                            onToggleChecks={toggleChecks}
                            onExpandChecks={onExpandChecks}
                        />
                    ))}
                </div>
            )}
        </div>
    );
}

function PrStatusCardRow({
    item,
    onRetry,
    checksExpanded,
    onToggleChecks,
    onExpandChecks,
}: {
    item: PrStatusCardItem;
    onRetry?: (key: string) => void;
    checksExpanded: boolean;
    onToggleChecks: (key: string) => void;
    onExpandChecks?: (key: string) => void;
}) {
    const number = item.pr?.number ?? item.number;
    const detailHash = buildPrDetailHash(item.repoId, number);
    const terminal = item.state === 'ready' && isTerminal(item.pr?.status);
    const autoMerge =
        item.state === 'ready' && item.pr
            ? describeAutoMerge(item.pr.autoMerge, prProviderFromUrl(item.pr.url))
            : null;

    const handleToggleChecks = () => {
        const willExpand = !checksExpanded;
        onToggleChecks(item.key);
        // Lazily fetch on first expand (and re-fetch when re-expanding a row
        // whose checks aren't loaded). The connected card dedups in-flight/ready.
        if (willExpand) onExpandChecks?.(item.key);
    };

    return (
        <div
            className={
                'flex flex-col gap-1 px-2.5 py-1.5 text-xs ' +
                'border-b border-[#eaeef2] dark:border-[#21262d] last:border-b-0 ' +
                (terminal ? 'opacity-70' : '')
            }
            data-testid={`pr-status-card-row-${item.key}`}
            data-state={item.state}
        >
            {item.state === 'loading' && (
                <div className="flex items-center gap-2 text-[#57606a] dark:text-[#8b949e]" data-testid={`pr-status-card-loading-${item.key}`}>
                    <span className="font-mono shrink-0 text-[#0969da] dark:text-[#58a6ff]">#{number}</span>
                    <span className="h-3 flex-1 max-w-[12rem] animate-pulse rounded bg-[#d0d7de] dark:bg-[#30363d]" />
                    <span className="shrink-0">Loading…</span>
                </div>
            )}

            {item.state === 'error' && (
                <div className="flex flex-wrap items-center gap-2" data-testid={`pr-status-card-error-${item.key}`} role="alert">
                    <span className="font-mono shrink-0 text-[#0969da] dark:text-[#58a6ff]">#{number}</span>
                    <span className="text-[#cf222e] dark:text-[#f85149] min-w-0 flex-1 truncate">
                        {item.error || 'Failed to load pull request.'}
                    </span>
                    {onRetry && (
                        <button
                            type="button"
                            className="shrink-0 rounded px-1.5 py-0.5 font-medium text-[#0969da] dark:text-[#58a6ff] hover:bg-black/[0.05] dark:hover:bg-white/[0.08]"
                            data-testid={`pr-status-card-retry-${item.key}`}
                            onClick={() => onRetry(item.key)}
                        >
                            Retry
                        </button>
                    )}
                    <a
                        href={detailHash}
                        className="shrink-0 text-[#0969da] dark:text-[#58a6ff] hover:underline"
                        data-testid={`pr-status-card-open-${item.key}`}
                    >
                        Open full PR ↗
                    </a>
                </div>
            )}

            {item.state === 'ready' && item.pr && (
                <>
                    <div className="flex items-center gap-2 min-w-0">
                        <StateBadge status={item.pr.status} />
                        <a
                            href={detailHash}
                            className="font-mono shrink-0 text-[#0969da] dark:text-[#58a6ff] hover:underline"
                            data-testid={`pr-status-card-open-${item.key}`}
                            title="Open full PR"
                        >
                            #{number}
                        </a>
                        <span
                            className={
                                'min-w-0 flex-1 truncate text-[#1f2328] dark:text-[#c9d1d9] ' +
                                (terminal ? 'line-through decoration-[#57606a]/50' : '')
                            }
                            title={item.pr.title}
                        >
                            {item.pr.title}
                        </span>
                    </div>
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[#57606a] dark:text-[#8b949e]">
                        <span className="font-mono truncate max-w-full" data-testid={`pr-status-card-branches-${item.key}`}>
                            {item.pr.sourceBranch} → {item.pr.targetBranch}
                        </span>
                        {terminal && terminalTimestamp(item.pr) && (
                            <span data-testid={`pr-status-card-terminal-time-${item.key}`}>
                                · {item.pr.status === 'merged' ? 'merged' : 'closed'} {terminalTimestamp(item.pr)}
                            </span>
                        )}
                        {autoMerge && <AutoMergeIndicator model={autoMerge} testKey={item.key} />}
                    </div>
                    <div>
                        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                            <button
                                type="button"
                                className="flex shrink-0 items-center gap-1 rounded px-1 py-0.5 text-[11px] font-medium text-[#57606a] hover:text-[#1f2328] dark:text-[#8b949e] dark:hover:text-[#c9d1d9]"
                                data-testid={`pr-status-card-checks-toggle-${item.key}`}
                                aria-expanded={checksExpanded}
                                onClick={handleToggleChecks}
                            >
                                <span aria-hidden="true">{checksExpanded ? '▾' : '▸'}</span>
                                <span>Checks</span>
                            </button>
                            <ChecksInlineSummary
                                item={item}
                                onRetry={onExpandChecks ? () => onExpandChecks(item.key) : undefined}
                            />
                        </div>
                        {checksExpanded && (
                            <div className="mt-1 pl-2" data-testid={`pr-status-card-checks-${item.key}`}>
                                <PrChecksCompact
                                    state={item.checksState ?? 'loading'}
                                    rows={item.checks ?? []}
                                    error={item.checksError}
                                    onRetry={onExpandChecks ? () => onExpandChecks(item.key) : undefined}
                                    testId={`pr-checks-compact-${item.key}`}
                                />
                            </div>
                        )}
                    </div>
                </>
            )}
        </div>
    );
}

function ChecksInlineSummary({
    item,
    onRetry,
}: {
    item: PrStatusCardItem;
    onRetry?: () => void;
}) {
    const testId = `pr-status-card-checks-inline-${item.key}`;
    if (item.checksState === 'loading') {
        return (
            <span
                className="inline-flex items-center gap-1.5 text-[11px] text-[#57606a] dark:text-[#8b949e]"
                data-testid={`${testId}-loading`}
            >
                <span className="h-2 w-2 animate-pulse rounded-full bg-[#d0d7de] dark:bg-[#30363d]" aria-hidden="true" />
                <span>Loading checks…</span>
            </span>
        );
    }
    if (item.checksState === 'error') {
        return (
            <span className="inline-flex items-center gap-1.5 text-[11px]" data-testid={`${testId}-error`} role="alert">
                <span className="text-[#cf222e] dark:text-[#f85149]">checks unavailable</span>
                {onRetry && (
                    <button
                        type="button"
                        className="rounded px-1 py-0.5 font-medium text-[#0969da] dark:text-[#58a6ff] hover:bg-black/[0.05] dark:hover:bg-white/[0.08]"
                        data-testid={`${testId}-retry`}
                        onClick={onRetry}
                    >
                        Retry
                    </button>
                )}
            </span>
        );
    }
    if (item.checksState === 'ready') {
        // Renders nothing when there are zero checks (keeps the line quiet).
        return <PrChecksSummaryChips rows={item.checks ?? []} testId={testId} />;
    }
    // Checks not yet fetched (transient before the eager fetch lands) — stay quiet.
    return null;
}

function StateBadge({ status }: { status: PrStatus | string }) {
    const badge = prStatusBadge(status);
    return (
        <span
            className={`inline-flex shrink-0 items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-medium ${badge.className}`}
            data-testid="pr-status-card-state-badge"
            data-status={status}
        >
            <span aria-hidden="true">{badge.emoji}</span>
            {badge.label}
        </span>
    );
}
