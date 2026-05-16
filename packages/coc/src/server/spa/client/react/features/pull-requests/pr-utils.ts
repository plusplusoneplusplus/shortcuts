/**
 * Shared utilities for pull request list and detail views.
 */

import { AttentionGroup } from './pr-attention-groups';

export type PrStatus = 'open' | 'closed' | 'merged' | 'draft';

export type ReviewVote = 'approved' | 'approvedWithSuggestions' | 'waitingForAuthor' | 'rejected' | 'noVote';

export interface Reviewer {
    identity: { displayName?: string; email?: string; avatarUrl?: string };
    vote?: string;
    isRequired?: boolean;
}

export interface PrComment {
    id: string | number;
    author?: { displayName?: string; email?: string };
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
    author?: { displayName?: string; email?: string; avatarUrl?: string };
    committer?: { displayName?: string; email?: string; avatarUrl?: string };
    authoredAt?: string;
    committedAt?: string;
    url?: string;
}

/** Shape of a pull request as returned by the /api/repos/:id/pull-requests endpoint. */
export interface PullRequest {
    id: number | string;
    number?: number;
    title: string;
    description?: string;
    author?: { displayName?: string; email?: string; avatarUrl?: string };
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
