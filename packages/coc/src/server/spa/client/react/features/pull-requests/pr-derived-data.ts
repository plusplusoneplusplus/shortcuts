/**
 * Deterministic provider/git-derived adapters for PR review UI surfaces.
 *
 * This module contains only presentational transforms for real provider data.
 * It does not call an LLM and does not expose fixture-backed PR judgments.
 */

import type { PullRequestCommit, CommentThread, QueueRiskBadge } from './pr-utils';
import type { PullRequestCheck, PullRequestCheckStatus, Reviewer } from './pr-utils';
import type { PrCommitRow } from './PrCommitTable';

export type FindingTag = 'good' | 'risk' | 'note';
export type CheckStatus = PullRequestCheckStatus;
export type MergeReadinessTag = 'good' | 'risk' | 'note';
export type PrTimelineKind = 'summary' | 'reviewer' | 'author';
export type ThreadGroupSeverity = 'blocking' | 'non-blocking' | 'noise';

export interface PrTimelineEvent {
    initials: string;
    kind: PrTimelineKind;
    title: string;
    detail: string;
}

export interface PrCheckRow {
    id: string;
    name: string;
    status: CheckStatus;
    duration: string;
    interpretation: string;
    /** Optional provider group (e.g. GitHub App name, ADO genre). */
    group?: string;
    /** Optional source kind - modern check vs. legacy commit-status. */
    source?: 'check' | 'status';
    /** Optional details URL - opens in a new tab when present. */
    detailsUrl?: string;
}

export interface MergeReadinessItem {
    tag: MergeReadinessTag;
    label: string;
    body: string;
}

const FINDING_TAG_CLASS: Record<FindingTag, string> = {
    good: 'bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-200',
    risk: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/40 dark:text-yellow-200',
    note: 'bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-200',
};

export function findingTagClass(tag: FindingTag): string {
    return FINDING_TAG_CLASS[tag];
}

export function checkStatusClass(status: CheckStatus): string {
    switch (status) {
        case 'success':   return 'text-green-700 dark:text-green-300';
        case 'warning':   return 'text-yellow-700 dark:text-yellow-300';
        case 'failure':   return 'text-red-700 dark:text-red-400';
        case 'cancelled': return 'text-gray-600 dark:text-gray-300';
        case 'skipped':   return 'text-gray-500 dark:text-gray-400';
        case 'pending':   return 'text-blue-600 dark:text-blue-300';
        case 'running':   return 'text-blue-700 dark:text-blue-200';
        case 'unknown':   return 'text-gray-500 dark:text-gray-400';
    }
}

/**
 * Extract initials from a display name. Returns up to 2 characters.
 * Falls back to '?' when the name is empty.
 */
function nameInitials(displayName: string | undefined): string {
    const name = (displayName ?? '').trim();
    if (!name) return '?';
    const parts = name.split(/\s+/);
    if (parts.length >= 2) {
        return (parts[0][0]! + parts[parts.length - 1][0]!).toUpperCase();
    }
    return name.slice(0, 2).toUpperCase();
}

/**
 * Build a conversation timeline from real PR data.
 *
 * - If threads exist: one summary entry for thread buckets.
 * - One reviewer entry per unique commenter (up to `maxReviewerEvents`),
 *   using the first comment body as the detail snippet.
 * - One author push entry per unique author group (up to `maxAuthorEvents`),
 *   summarising the subjects of their commits.
 *
 * Returns an empty array when both inputs are empty so the panel renders
 * cleanly without placeholder content.
 */
export function buildTimelineFromRealData(
    threads: CommentThread[],
    commits: PullRequestCommit[],
    threadGroups: Array<{ id: string; title: string; count: number }>,
    options: { maxReviewerEvents?: number; maxAuthorEvents?: number } = {},
): PrTimelineEvent[] {
    const { maxReviewerEvents = 2, maxAuthorEvents = 1 } = options;
    const events: PrTimelineEvent[] = [];

    if (threads.length > 0) {
        const nonEmpty = threadGroups.filter(g => g.count > 0);
        const groupCount = nonEmpty.length;
        const topicNames = nonEmpty
            .slice(0, 3)
            .map(g => g.title)
            .join(', ');
        const suffix = nonEmpty.length > 3 ? `, and ${nonEmpty.length - 3} more` : '';
        events.push({
            initials: 'PR',
            kind: 'summary',
            title: `Grouped ${threads.length} review thread${threads.length === 1 ? '' : 's'} into ${groupCount} topic${groupCount === 1 ? '' : 's'}.`,
            detail: topicNames ? `${topicNames}${suffix}.` : 'No notable topics.',
        });
    }

    let reviewerCount = 0;
    for (const thread of threads) {
        if (reviewerCount >= maxReviewerEvents) break;
        const first = thread.comments?.[0];
        if (!first?.author?.displayName || !first.body) continue;
        const raw = first.body.replace(/[\n\r]+/g, ' ').trim();
        const snippet = raw.length > 80 ? `${raw.slice(0, 80)}...` : raw;
        events.push({
            initials: nameInitials(first.author.displayName),
            kind: 'reviewer',
            title: `${first.author.displayName} left a comment.`,
            detail: `"${snippet}"`,
        });
        reviewerCount++;
    }

    const byAuthor = new Map<string, { displayName: string; subjects: string[] }>();
    for (const commit of commits) {
        const name = commit.author?.displayName ?? commit.committer?.displayName ?? '';
        if (!byAuthor.has(name)) {
            byAuthor.set(name, { displayName: name, subjects: [] });
        }
        const subject =
            commit.subject ||
            (commit.message ? commit.message.split('\n', 1)[0] : '') ||
            commit.shortId ||
            commit.id;
        if (subject) byAuthor.get(name)!.subjects.push(subject);
    }

    let authorCount = 0;
    for (const [, group] of byAuthor) {
        if (authorCount >= maxAuthorEvents) break;
        const count = group.subjects.length;
        const detail = group.subjects.slice(0, 3).join('; ');
        events.push({
            initials: nameInitials(group.displayName || undefined),
            kind: 'author',
            title: `${group.displayName || 'Author'} pushed ${count} commit${count === 1 ? '' : 's'}.`,
            detail,
        });
        authorCount++;
    }

    return events;
}

/** Map real `PullRequestCommit` records to the row shape consumed by `PrCommitTable`. */
export function buildCommitRowsFromPrCommits(commits: PullRequestCommit[]): PrCommitRow[] {
    return commits.map(commit => {
        const sha = commit.id ?? '';
        const shortSha = commit.shortId || (sha ? sha.slice(0, 7) : '');
        const subjectLine =
            commit.subject ||
            (commit.message ? commit.message.split('\n', 1)[0] : '');
        return {
            sha,
            shortSha,
            title: subjectLine || shortSha || sha,
            message: commit.message,
            author: commit.author,
            authoredAt: commit.authoredAt,
            committedAt: commit.committedAt,
            url: commit.url,
        };
    });
}

function formatDurationMs(ms: number | undefined): string {
    if (!ms || ms < 0 || !Number.isFinite(ms)) return '';
    const totalSeconds = Math.round(ms / 1000);
    if (totalSeconds < 60) return `${totalSeconds}s`;
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${minutes}m ${String(seconds).padStart(2, '0')}s`;
}

function interpretCheckStatus(status: CheckStatus, description?: string): string {
    if (description && description.trim()) return description.trim();
    switch (status) {
        case 'success':   return 'Completed successfully.';
        case 'warning':   return 'Completed with warnings.';
        case 'failure':   return 'Failed - review log before merging.';
        case 'cancelled': return 'Cancelled before completion.';
        case 'skipped':   return 'Skipped or not applicable.';
        case 'pending':   return 'Queued or waiting to start.';
        case 'running':   return 'Currently running.';
        case 'unknown':   return 'Status not reported by provider.';
    }
}

/**
 * Convert provider-agnostic `PullRequestCheck[]` (from the /checks REST
 * endpoint) into display rows for `PrChecksTable`. The interpretation
 * column falls back to the provider description, then a generic per-status
 * sentence - no AI involved.
 */
export function buildCheckRowsFromChecks(checks: PullRequestCheck[]): PrCheckRow[] {
    return checks.map(check => {
        const name = check.group ? `${check.group} / ${check.name}` : check.name;
        return {
            id: check.id,
            name,
            status: check.status,
            duration: formatDurationMs(check.durationMs),
            interpretation: interpretCheckStatus(check.status, check.description),
            group: check.group,
            source: check.source,
            detailsUrl: check.detailsUrl,
        };
    });
}

function isUnresolvedThread(thread: CommentThread): boolean {
    const status = thread.status?.toLowerCase();
    return status == null || status === 'active' || status === 'open';
}

/**
 * Derive a deterministic merge-readiness checklist from real PR signals:
 * checks, comment threads, and reviewer votes. No AI or fixture data involved.
 */
export function buildMergeReadinessFromData(params: {
    checks: PullRequestCheck[];
    threads: CommentThread[];
    reviewers: Reviewer[];
}): MergeReadinessItem[] {
    const { checks, threads, reviewers } = params;

    const items: MergeReadinessItem[] = [];

    const failed = checks.filter(c => c.status === 'failure');
    const inProgress = checks.filter(c => c.status === 'running' || c.status === 'pending');
    const warning = checks.filter(c => c.status === 'warning');
    const succeeded = checks.filter(c => c.status === 'success');

    if (checks.length === 0) {
        items.push({
            tag: 'note',
            label: 'Checks',
            body: 'No CI checks reported for this pull request yet.',
        });
    } else if (failed.length > 0) {
        const names = failed.slice(0, 3).map(c => c.name).join(', ');
        const more = failed.length > 3 ? ` (+${failed.length - 3} more)` : '';
        items.push({
            tag: 'risk',
            label: 'Block',
            body: `${failed.length} check${failed.length === 1 ? '' : 's'} failing: ${names}${more}.`,
        });
    } else if (inProgress.length > 0) {
        items.push({
            tag: 'note',
            label: 'Wait',
            body: `${inProgress.length} check${inProgress.length === 1 ? ' is' : 's are'} still running.`,
        });
    } else if (warning.length > 0) {
        items.push({
            tag: 'note',
            label: 'Review',
            body: `${warning.length} check${warning.length === 1 ? '' : 's'} completed with warnings.`,
        });
    } else {
        items.push({
            tag: 'good',
            label: 'Pass',
            body: `All ${succeeded.length} reported check${succeeded.length === 1 ? '' : 's'} completed successfully.`,
        });
    }

    const unresolvedThreads = threads.filter(isUnresolvedThread);
    if (unresolvedThreads.length > 0) {
        items.push({
            tag: 'risk',
            label: 'Threads',
            body: `${unresolvedThreads.length} comment thread${unresolvedThreads.length === 1 ? ' is' : 's are'} still unresolved.`,
        });
    } else if (threads.length > 0) {
        items.push({
            tag: 'good',
            label: 'Threads',
            body: `All ${threads.length} comment thread${threads.length === 1 ? '' : 's'} resolved.`,
        });
    }

    const approved = reviewers.filter(r => r.vote === 'approved' || r.vote === 'approvedWithSuggestions');
    const rejected = reviewers.filter(r => r.vote === 'rejected' || r.vote === 'waitingForAuthor');
    const requiredPending = reviewers.filter(
        r => r.isRequired && r.vote !== 'approved' && r.vote !== 'approvedWithSuggestions',
    );
    if (reviewers.length === 0) {
        items.push({ tag: 'note', label: 'Reviewers', body: 'No reviewers assigned yet.' });
    } else if (rejected.length > 0) {
        items.push({
            tag: 'risk',
            label: 'Reviewers',
            body: `${rejected.length} reviewer${rejected.length === 1 ? '' : 's'} requested changes or is waiting for author.`,
        });
    } else if (requiredPending.length > 0) {
        items.push({
            tag: 'note',
            label: 'Reviewers',
            body: `${requiredPending.length} required reviewer${requiredPending.length === 1 ? '' : 's'} have not approved yet.`,
        });
    } else {
        items.push({
            tag: 'good',
            label: 'Reviewers',
            body: `${approved.length} of ${reviewers.length} reviewer${reviewers.length === 1 ? '' : 's'} approved.`,
        });
    }

    return items;
}

export type QueueFilter = 'all' | 'mine' | 'blocked' | 'ready' | 'foryou';
export type QueueDotState = 'open' | 'draft' | 'blocked' | 'ready';

export function queueRiskClass(risk: QueueRiskBadge): string {
    switch (risk) {
        case 'low':     return 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-200';
        case 'med':     return 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/40 dark:text-yellow-200';
        case 'high':    return 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-200';
        case 'unknown': return 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-300';
    }
}

export function queueDotClass(state: QueueDotState): string {
    switch (state) {
        case 'open':
            return 'border-green-600 dark:border-green-500';
        case 'draft':
            return 'border-gray-500 bg-gray-500';
        case 'blocked':
            return 'border-yellow-600 bg-yellow-600 dark:border-yellow-500 dark:bg-yellow-500';
        case 'ready':
            return 'border-purple-600 bg-purple-600 dark:border-purple-400 dark:bg-purple-400';
    }
}

export interface QueueFilterCounts {
    all: number;
    mine: number;
    blocked: number;
    ready: number;
    foryou: number;
}

const ALL_FILTERS: QueueFilter[] = ['all', 'mine', 'blocked', 'ready', 'foryou'];

export function getQueueFilterDefinitions(options?: { suggestionsEnabled?: boolean }): Array<{ id: QueueFilter; label: string }> {
    const filters: Array<{ id: QueueFilter; label: string }> = [
        { id: 'all',     label: 'All' },
        { id: 'mine',    label: 'Mine' },
        { id: 'blocked', label: 'Blocked' },
        { id: 'ready',   label: 'Ready' },
    ];
    if (options?.suggestionsEnabled) {
        filters.push({ id: 'foryou', label: 'For You' });
    }
    return filters;
}

export { ALL_FILTERS as QUEUE_FILTERS };

export interface ThreadGroupSummary {
    id: ThreadGroupSeverity;
    title: string;
    count: number;
    severity: ThreadGroupSeverity;
    body: string;
}

export function deriveThreadSeverity(thread: {
    id: string | number;
    status?: string;
    comments?: Array<{ body?: string }>;
}): ThreadGroupSeverity {
    const body = (thread.comments ?? []).map(c => c.body ?? '').join(' ').toLowerCase();
    if (/(bug|crash|wrong|broken|incorrect|fail|leak|race|regress|block|security|data loss)/.test(body)) {
        return 'blocking';
    }
    if (/(nit|typo|style|format|naming|consider|maybe|fyi)/.test(body)) {
        return 'noise';
    }

    const status = thread.status?.toLowerCase();
    if (status === 'closed' || status === 'fixed' || status === 'resolved' || status === 'done') {
        return 'non-blocking';
    }

    return 'non-blocking';
}

export function buildThreadGroupsFromThreads(
    threads: Array<{
        id: string | number;
        status?: string;
        comments?: Array<{ body?: string }>;
        threadContext?: { filePath?: string };
    }>,
): ThreadGroupSummary[] {
    const tally = { blocking: 0, 'non-blocking': 0, noise: 0 } as Record<ThreadGroupSeverity, number>;
    const exampleFiles: Record<ThreadGroupSeverity, string | undefined> = {
        blocking: undefined, 'non-blocking': undefined, noise: undefined,
    };

    for (const thread of threads) {
        const severity = deriveThreadSeverity(thread);
        tally[severity] += 1;
        if (!exampleFiles[severity] && thread.threadContext?.filePath) {
            exampleFiles[severity] = thread.threadContext.filePath;
        }
    }

    const definitions = [
        { id: 'blocking',     title: 'Blocking concerns',     body: 'Threads that mention bugs, regressions, blocked work, or correctness risks.' },
        { id: 'non-blocking', title: 'Non-blocking feedback', body: 'Threads that surface clarifications, refactors, and follow-ups.' },
        { id: 'noise',        title: 'Nits and noise',        body: 'Threads that look like style suggestions or low-impact comments.' },
    ] as const;

    return definitions.map(def => ({
        id: def.id,
        title: def.title,
        count: tally[def.id],
        severity: def.id,
        body: exampleFiles[def.id]
            ? `${def.body} First example in ${exampleFiles[def.id]}.`
            : def.body,
    }));
}
