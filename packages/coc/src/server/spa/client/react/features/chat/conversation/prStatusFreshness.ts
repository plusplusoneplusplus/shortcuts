/**
 * prStatusFreshness — pure freshness / smart-polling logic for the chat PR
 * status card (AC-05).
 *
 * No React, no I/O — just the predicate that decides whether the card should
 * keep auto-polling and the "updated Xs ago" label formatter, so both can be
 * unit-tested independently of {@link ./usePrChatStatusItems} (the async layer
 * that drives the actual `setInterval` + force-refresh fetches).
 *
 * The smart-polling rule (from the spec): poll ONLY while at least one PR is
 * non-terminal AND its checks are pending/running, its auto-merge is armed/queued,
 * or its reviewer approval is unresolved. Once every PR is terminal/settled the
 * predicate is false, so the hook stops polling.
 */
import type { PrCheckRow } from '../../pull-requests/pr-derived-data';
import { hasUnresolvedReviewerApproval } from '../../pull-requests/pr-utils';
import type { PrStatusCardItem } from './PrStatusCard';

/**
 * Smart-poll cadence while a PR is still settling (AC-05 [assumption ~45s]).
 * Exported so the hook and tests share one source of truth.
 */
export const PR_STATUS_POLL_INTERVAL_MS = 45_000;

/** PR lifecycle states that are settled — no further polling needed. */
const TERMINAL_PR_STATES = new Set<string>(['merged', 'closed']);

/** A check that has not settled yet — its PR's state can still change. */
function isCheckInProgress(row: PrCheckRow): boolean {
    return row.status === 'pending' || row.status === 'running';
}

/** Auto-merge that is armed or queued — the PR is expected to merge soon. */
function isAutoMergePending(item: PrStatusCardItem): boolean {
    const autoMerge = item.pr?.autoMerge;
    return !!autoMerge && autoMerge.enabled && (autoMerge.state === 'armed' || autoMerge.state === 'queued');
}

/**
 * Whether a single card row is still "active": loaded (`ready`), non-terminal,
 * AND has checks pending/running, auto-merge armed/queued, or unresolved reviewer
 * approval. Terminal (merged/closed) rows and idle open rows are inactive, so they
 * do not keep the card polling.
 */
export function isPrItemActive(item: PrStatusCardItem): boolean {
    if (item.state !== 'ready' || !item.pr) return false;
    if (TERMINAL_PR_STATES.has(item.pr.status)) return false;
    if (isAutoMergePending(item)) return true;
    if (item.checksState === 'ready' && (item.checks ?? []).some(isCheckInProgress)) return true;
    if (item.reviewersState === 'ready' && hasUnresolvedReviewerApproval(item.reviewers ?? [])) return true;
    return false;
}

/**
 * Smart-polling predicate (AC-05): true while ANY PR is still active (non-terminal
 * with pending/running checks or armed/queued auto-merge). Returns false when
 * every PR is terminal/settled, so the hook stops auto-polling.
 */
export function shouldPollPrStatusItems(items: readonly PrStatusCardItem[]): boolean {
    return items.some(isPrItemActive);
}

/**
 * Human "updated Xs ago" freshness label (AC-05). Pure — takes an explicit `now`
 * (epoch ms) so it is deterministic in tests. Returns '' when there is no recorded
 * update yet.
 */
export function formatUpdatedAgo(updatedAt: number | undefined, now: number): string {
    if (updatedAt === undefined) return '';
    const deltaSec = Math.max(0, Math.round((now - updatedAt) / 1000));
    if (deltaSec < 5) return 'updated just now';
    if (deltaSec < 60) return `updated ${deltaSec}s ago`;
    const mins = Math.floor(deltaSec / 60);
    if (mins < 60) return `updated ${mins}m ago`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `updated ${hours}h ago`;
    const days = Math.floor(hours / 24);
    return `updated ${days}d ago`;
}
