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
 * Card-level: with no items the whole card is hidden (empty state). When there
 * are several PRs the list collapses to a count via a `<details>`-style toggle.
 *
 * Reuses {@link prStatusBadge} / {@link formatTimestamp} from the pull-requests
 * feature (no duplicated badge or timestamp logic) and {@link buildPrDetailHash}
 * for the deep-link.
 */
import React, { useState } from 'react';
import { prStatusBadge, formatTimestamp, type PrStatus } from '../../pull-requests/pr-utils';
import { buildPrDetailHash } from '../../pull-requests/pr-open-utils';

/** Per-PR fetch lifecycle for a card row. */
export type PrStatusCardItemState = 'loading' | 'ready' | 'error';

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
}

export interface PrStatusCardProps {
    items: PrStatusCardItem[];
    /** Retry a failed item's fetch. */
    onRetry?: (key: string) => void;
    /**
     * Collapse the list to a count when the number of PRs exceeds this.
     * Defaults to 2 (one or two PRs stay expanded).
     */
    collapseThreshold?: number;
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

export function PrStatusCard({ items, onRetry, collapseThreshold = 2 }: PrStatusCardProps) {
    const sorted = sortNewestFirst(items);
    const [expanded, setExpanded] = useState(sorted.length <= collapseThreshold);

    // Empty state — card is hidden entirely.
    if (sorted.length === 0) return null;

    const collapsible = sorted.length > collapseThreshold;
    const showRows = !collapsible || expanded;

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
            <button
                type="button"
                className={
                    'flex w-full items-center gap-2 px-2.5 py-1.5 text-xs font-semibold ' +
                    'text-[#57606a] dark:text-[#8b949e] select-none ' +
                    (collapsible ? 'cursor-pointer hover:text-[#1f2328] dark:hover:text-[#c9d1d9]' : 'cursor-default')
                }
                data-testid="pr-status-card-toggle"
                aria-expanded={showRows}
                onClick={collapsible ? () => setExpanded(v => !v) : undefined}
            >
                <span aria-hidden="true">🔀</span>
                <span>
                    {sorted.length === 1 ? '1 pull request' : `${sorted.length} pull requests`}
                </span>
                {collapsible && (
                    <span className="ml-auto" aria-hidden="true">{showRows ? '▾' : '▸'}</span>
                )}
            </button>

            {showRows && (
                <div className="border-t border-[#d0d7de] dark:border-[#3c3c3c]">
                    {sorted.map(item => (
                        <PrStatusCardRow key={item.key} item={item} onRetry={onRetry} />
                    ))}
                </div>
            )}
        </div>
    );
}

function PrStatusCardRow({ item, onRetry }: { item: PrStatusCardItem; onRetry?: (key: string) => void }) {
    const number = item.pr?.number ?? item.number;
    const detailHash = buildPrDetailHash(item.repoId, number);
    const terminal = item.state === 'ready' && isTerminal(item.pr?.status);

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
                    </div>
                </>
            )}
        </div>
    );
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
