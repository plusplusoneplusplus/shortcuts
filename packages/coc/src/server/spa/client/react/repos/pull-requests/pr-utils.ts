/**
 * Shared utilities for pull request list and detail views.
 */

export type PrStatus = 'open' | 'closed' | 'merged' | 'draft';

/** Shape of a pull request as returned by the /api/repos/:id/pull-requests endpoint. */
export interface PullRequest {
    id: number | string;
    number?: number;
    title: string;
    description?: string;
    createdBy?: { displayName?: string; email?: string; avatarUrl?: string };
    sourceBranch: string;
    targetBranch: string;
    status: PrStatus;
    isDraft?: boolean;
    createdAt: string;
    updatedAt: string;
    mergedAt?: string;
    closedAt?: string;
    url?: string;
    reviewers?: Array<{ identity: { displayName?: string }; vote?: string; isRequired?: boolean }>;
    commentCount?: number;
}

export interface StatusBadge {
    emoji: string;
    label: string;
    className: string;
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

/**
 * Returns a human-readable relative time string such as "3h ago", "2d ago", "just now".
 * No external dependencies.
 */
export function formatRelativeTime(iso: string | null | undefined): string {
    if (!iso) return '';
    const d = new Date(iso);
    const diff = Date.now() - d.getTime();
    if (diff < 60_000) return 'just now';
    const mins = Math.floor(diff / 60_000);
    if (mins < 60) return `${mins}m ago`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    if (days === 1) return 'yesterday';
    if (days < 30) return `${days}d ago`;
    const months = Math.floor(days / 30);
    if (months < 12) return `${months}mo ago`;
    return `${Math.floor(months / 12)}y ago`;
}
