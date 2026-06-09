/**
 * Shared utilities for pull request list and detail views.
 */

import { AttentionGroup } from './pr-attention-groups';
import {
    authorMatchesPrTeamRosterEntry,
    filterPullRequestsByPrTeamRoster,
    getPrTeamIdentityKey,
    pullRequestMatchesPrTeamRoster,
} from '../../../../../shared/pr-team-matching';

export type PrStatus = 'open' | 'closed' | 'merged' | 'draft';

export type ReviewVote = 'approved' | 'approvedWithSuggestions' | 'waitingForAuthor' | 'rejected' | 'noVote';

export interface PrIdentity {
    id?: string | number;
    displayName?: string;
    email?: string;
    avatarUrl?: string;
}

export interface PrCoworkerRosterEntry {
    id: string;
    displayName: string;
    email?: string;
    avatarUrl?: string;
    addedAt: string;
}

export interface PrCoworkerRosterCandidate {
    id: string;
    displayName: string;
    email?: string;
    avatarUrl?: string;
    prCount: number;
}

export interface Reviewer {
    identity: PrIdentity;
    vote?: string;
    isRequired?: boolean;
}

export interface PrComment {
    id: string | number;
    author?: PrIdentity;
    body: string;
    createdAt?: string;
    updatedAt?: string;
}

export interface CommentThread {
    id: string | number;
    comments: PrComment[];
    status?: string;
    threadContext?: {
        filePath?: string;
        line?: number;
        startLine?: number;
        endLine?: number;
        side?: 'right' | 'left' | 'unknown';
    };
}

/**
 * Provider-agnostic check status as returned by
 * /api/repos/:id/pull-requests/:prId/checks. Mirrors `CheckStatus` in
 * `@plusplusoneplusplus/forge`'s provider abstraction.
 */
export type PullRequestCheckStatus =
    | 'pending'
    | 'running'
    | 'success'
    | 'failure'
    | 'cancelled'
    | 'skipped'
    | 'warning'
    | 'unknown';

export type PullRequestCheckSource = 'check' | 'status';

/** Provider-agnostic check / CI status as returned by /checks. */
export interface PullRequestCheck {
    id: string;
    name: string;
    group?: string;
    status: PullRequestCheckStatus;
    source: PullRequestCheckSource;
    description?: string;
    detailsUrl?: string;
    startedAt?: string;
    completedAt?: string;
    durationMs?: number;
}

/** Shape of a single commit as returned by the /api/repos/:id/pull-requests/:prId/commits endpoint. */
export interface PullRequestCommit {
    id: string;
    shortId: string;
    message: string;
    subject: string;
    author?: PrIdentity;
    committer?: PrIdentity;
    authoredAt?: string;
    committedAt?: string;
    url?: string;
}

export interface PullRequestDiffStats {
    additions: number;
    deletions: number;
    changedFiles: number;
}

export type QueueRiskBadge = 'low' | 'med' | 'high' | 'unknown';

export interface QueueRiskSignals {
    hasFailingCheck?: boolean;
    hasUnresolvedBlockingThread?: boolean;
}

/** Shape of a pull request as returned by the /api/repos/:id/pull-requests endpoint. */
export interface PullRequest {
    id: number | string;
    number?: number;
    title: string;
    description?: string;
    author?: PrIdentity;
    sourceBranch: string;
    targetBranch: string;
    status: PrStatus;
    isDraft?: boolean;
    createdAt: string;
    updatedAt: string;
    mergedAt?: string;
    closedAt?: string;
    url?: string;
    labels?: string[];
    reviewers?: Reviewer[];
    commentCount?: number;
    /** SHA of the PR head commit (used as classification cache key). */
    headSha?: string;
    /** Real diff stats enriched by the server for list/detail queue metadata. */
    diffStats?: PullRequestDiffStats;
}

function stringifyIdentityId(id: string | number | undefined): string {
    if (id === undefined || id === null) return '';
    return String(id).trim();
}

function normalizeOptionalIdentityField(value: string | undefined): string | undefined {
    const trimmed = value?.trim();
    return trimmed ? trimmed : undefined;
}

export function getCoworkerRosterIdentityKey(identity: Pick<PrIdentity, 'id' | 'displayName'>): string {
    return getPrTeamIdentityKey(identity);
}

export function buildCoworkerRosterCandidates(
    pullRequests: readonly Pick<PullRequest, 'author'>[],
): PrCoworkerRosterCandidate[] {
    const byKey = new Map<string, PrCoworkerRosterCandidate>();

    for (const pr of pullRequests) {
        const author = pr.author;
        const displayName = author?.displayName?.trim();
        if (!author || !displayName) continue;

        const key = getCoworkerRosterIdentityKey(author);
        if (!key) continue;

        const existing = byKey.get(key);
        if (existing) {
            existing.prCount += 1;
            existing.email ??= normalizeOptionalIdentityField(author.email);
            existing.avatarUrl ??= normalizeOptionalIdentityField(author.avatarUrl);
            continue;
        }

        const email = normalizeOptionalIdentityField(author.email);
        const avatarUrl = normalizeOptionalIdentityField(author.avatarUrl);
        byKey.set(key, {
            id: stringifyIdentityId(author.id),
            displayName,
            ...(email ? { email } : {}),
            ...(avatarUrl ? { avatarUrl } : {}),
            prCount: 1,
        });
    }

    return [...byKey.values()].sort((a, b) => {
        const leftName = a.displayName.toLowerCase();
        const rightName = b.displayName.toLowerCase();
        if (leftName < rightName) return -1;
        if (leftName > rightName) return 1;
        if (a.id < b.id) return -1;
        if (a.id > b.id) return 1;
        return 0;
    });
}

export function authorMatchesCoworkerRosterEntry(
    author: PrIdentity | undefined,
    entry: Pick<PrCoworkerRosterEntry, 'id' | 'displayName'>,
): boolean {
    return authorMatchesPrTeamRosterEntry(author, entry);
}

export function pullRequestMatchesCoworkerRoster(
    pr: Pick<PullRequest, 'author'>,
    roster: readonly Pick<PrCoworkerRosterEntry, 'id' | 'displayName'>[],
): boolean {
    return pullRequestMatchesPrTeamRoster(pr, roster);
}

export function filterPullRequestsByCoworkerRoster<T extends Pick<PullRequest, 'author'>>(
    pullRequests: readonly T[],
    roster: readonly Pick<PrCoworkerRosterEntry, 'id' | 'displayName'>[],
): T[] {
    return filterPullRequestsByPrTeamRoster(pullRequests, roster);
}

export interface StatusBadge {
    emoji: string;
    label: string;
    className: string;
}

export interface GroupBadgeStyle {
    label: string;
    color: string;
    emoji: string;
}

export function prStatusBadge(status: PrStatus | string): StatusBadge {
    switch (status) {
        case 'open':   return { emoji: '🟢', label: 'Open',   className: 'bg-green-100 text-green-800' };
        case 'draft':  return { emoji: '🟡', label: 'Draft',  className: 'bg-yellow-100 text-yellow-800' };
        case 'merged': return { emoji: '🟣', label: 'Merged', className: 'bg-purple-100 text-purple-800' };
        case 'closed': return { emoji: '🔴', label: 'Closed', className: 'bg-red-100 text-red-800' };
        default:       return { emoji: '⚪', label: String(status), className: 'bg-gray-100 text-gray-800' };
    }
}

export function prStatusColor(status: PrStatus | string): string {
    return prStatusBadge(status).className;
}

export function getGroupBadgeStyle(group: AttentionGroup): GroupBadgeStyle {
    switch (group) {
        case AttentionGroup.RerunNeeded:
            return { label: 'Rerun needed', color: 'bg-orange-100 text-orange-800', emoji: '🔁' };
        case AttentionGroup.ManualUpdateNeeded:
            return { label: 'Update needed', color: 'bg-yellow-100 text-yellow-800', emoji: '✏️' };
        case AttentionGroup.ReviewerNudge:
            return { label: 'Nudge reviewer', color: 'bg-blue-100 text-blue-800', emoji: '💬' };
        case AttentionGroup.MergeValidation:
            return { label: 'Validate merge', color: 'bg-purple-100 text-purple-800', emoji: '✅' };
    }
}

/** Maps a reviewer vote string to a display icon + label. */
export function reviewVoteIcon(vote?: string | null): { icon: string; label: string } {
    switch (vote) {
        case 'approved': return { icon: '✅', label: 'Approved' };
        case 'approvedWithSuggestions': return { icon: '✅', label: 'Approved with suggestions' };
        case 'waitingForAuthor': return { icon: '⏳', label: 'Waiting for author' };
        case 'rejected': return { icon: '❌', label: 'Rejected' };
        default: return { icon: '⬜', label: 'No vote' };
    }
}

/**
 * Returns an exact, human-readable timestamp string such as "Jan 2, 2024, 02:00 PM".
 * No external dependencies.
 */
export function formatTimestamp(iso: string | null | undefined): string {
    if (!iso) return '';
    const d = new Date(iso);
    if (isNaN(d.getTime())) return '';
    return d.toLocaleString(undefined, {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
    });
}

/**
 * @deprecated Use formatTimestamp instead.
 * Kept for backward compatibility — now returns the same exact timestamp.
 */
export function formatRelativeTime(iso: string | null | undefined): string {
    return formatTimestamp(iso);
}

/**
 * Deterministic queue review-time estimate from real diff size:
 * max(1, round(changedLines / 25 + changedFiles * 0.5)).
 */
export function estimateReviewMinutes(diffStats: PullRequestDiffStats | null | undefined): number | null {
    if (!diffStats) return null;
    const changedLines = diffStats.additions + diffStats.deletions;
    return Math.max(1, Math.round(changedLines / 25 + diffStats.changedFiles * 0.5));
}

/**
 * Deterministic queue risk heuristic from real PR diff stats.
 * Risk is based on changed lines and may be bumped once by real blocking signals.
 */
export function deriveQueueRisk(
    diffStats: PullRequestDiffStats | null | undefined,
    signals: QueueRiskSignals = {},
): QueueRiskBadge {
    if (!diffStats) return 'unknown';

    const changedLines = diffStats.additions + diffStats.deletions;
    let risk: QueueRiskBadge;

    if (changedLines < 200) {
        risk = 'low';
    } else if (changedLines <= 800) {
        risk = 'med';
    } else {
        risk = 'high';
    }

    if (!signals.hasFailingCheck && !signals.hasUnresolvedBlockingThread) {
        return risk;
    }

    if (risk === 'low') return 'med';
    if (risk === 'med') return 'high';
    return 'high';
}
