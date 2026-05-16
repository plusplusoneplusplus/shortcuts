import type { CommentThread, PullRequest, Reviewer } from './pr-utils';

export enum AttentionGroup {
    RerunNeeded = 'rerun-needed',
    ManualUpdateNeeded = 'manual-update-needed',
    ReviewerNudge = 'reviewer-nudge-needed',
    MergeValidation = 'merge-validation-needed',
}

export interface AttentionGroupConfig {
    group: AttentionGroup;
    key: AttentionGroup;
    label: string;
    description: string;
    defaultAction: string;
    icon: string;
    emoji: string;
    color: string;
}

export const ATTENTION_GROUP_CONFIGS: AttentionGroupConfig[] = [
    {
        group: AttentionGroup.RerunNeeded,
        key: AttentionGroup.RerunNeeded,
        label: 'Rerun needed',
        description: 'PR has failed, stale, or missing checks.',
        defaultAction: '/rerun',
        icon: '🔁',
        emoji: '🔁',
        color: 'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-200',
    },
    {
        group: AttentionGroup.ManualUpdateNeeded,
        key: AttentionGroup.ManualUpdateNeeded,
        label: 'Manual update needed',
        description: 'Reviewer requested changes or left unresolved threads.',
        defaultAction: '/update',
        icon: '✏️',
        emoji: '✏️',
        color: 'bg-orange-100 text-orange-800 dark:bg-orange-900/40 dark:text-orange-200',
    },
    {
        group: AttentionGroup.ReviewerNudge,
        key: AttentionGroup.ReviewerNudge,
        label: 'Reviewer nudge needed',
        description: 'No reviewer has voted and the PR has gone stale.',
        defaultAction: '/nudge',
        icon: '👋',
        emoji: '👋',
        color: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/40 dark:text-yellow-200',
    },
    {
        group: AttentionGroup.MergeValidation,
        key: AttentionGroup.MergeValidation,
        label: 'Merge validation needed',
        description: 'Ready for final validation before merge.',
        defaultAction: '/validate',
        icon: '✅',
        emoji: '✅',
        color: 'bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-200',
    },
];

const CI_FAIL_LABELS = new Set(['ci-failed', 'ci-failure', 'build-failed', 'checks-failed']);
const CI_FAIL_KEYWORDS = ['failed', 'timed out', 'timeout', 'build failure'];
const STALE_THRESHOLD_MS = 24 * 60 * 60 * 1000;

function normalizeVote(vote: Reviewer['vote']): string {
    return (vote ?? '').toLowerCase().replace(/[-_\s]/g, '');
}

function hasActiveThread(thread: CommentThread): boolean {
    const status = thread.status?.toLowerCase();
    return status == null || status === 'active' || status === 'open';
}

function isNoVote(reviewer: Reviewer): boolean {
    const vote = normalizeVote(reviewer.vote);
    return vote === '' || vote === 'novote';
}

function isApproval(reviewer: Reviewer): boolean {
    const vote = normalizeVote(reviewer.vote);
    return vote === 'approved' || vote === 'approvedwithsuggestions';
}

/**
 * Two-bucket queue grouping used by the redesigned PR queue rail.
 * Backed by the existing four-group attention classifier.
 */
export type QueueSection = 'needs-review' | 'ready';

export interface QueueSectionConfig {
    section: QueueSection;
    label: string;
}

export const QUEUE_SECTION_CONFIGS: QueueSectionConfig[] = [
    { section: 'needs-review', label: 'Needs review' },
    { section: 'ready',        label: 'Ready after checks' },
];

export function mapAttentionToQueueSection(group: AttentionGroup): QueueSection {
    return group === AttentionGroup.MergeValidation ? 'ready' : 'needs-review';
}

export function classifyQueueSection(pr: PullRequest, threads?: CommentThread[]): QueueSection {
    return mapAttentionToQueueSection(classifyPr(pr, threads));
}

export function classifyPr(pr: PullRequest, threads?: CommentThread[]): AttentionGroup {
    const reviewers = pr.reviewers ?? [];
    const openThreads = threads?.filter(hasActiveThread) ?? [];

    const hasRequestedChanges = reviewers.some(reviewer => {
        const vote = normalizeVote(reviewer.vote);
        return vote === 'waitingforauthor' || vote === 'rejected';
    });
    if (hasRequestedChanges || openThreads.length > 0) {
        return AttentionGroup.ManualUpdateNeeded;
    }

    const labelsMatch = (pr.labels ?? []).some(label => CI_FAIL_LABELS.has(label.toLowerCase()));
    const description = (pr.description ?? '').toLowerCase();
    const descriptionMatches = CI_FAIL_KEYWORDS.some(keyword => description.includes(keyword));
    if (labelsMatch || descriptionMatches) {
        return AttentionGroup.RerunNeeded;
    }

    const updatedAt = new Date(pr.updatedAt).getTime();
    const isStale = Number.isFinite(updatedAt) && Date.now() - updatedAt > STALE_THRESHOLD_MS;
    if (reviewers.length > 0 && reviewers.every(isNoVote) && isStale) {
        return AttentionGroup.ReviewerNudge;
    }

    return AttentionGroup.MergeValidation;
}
