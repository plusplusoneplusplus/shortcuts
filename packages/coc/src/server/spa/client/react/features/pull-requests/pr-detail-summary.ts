import type { FileChange } from '../git/diff';
import { deriveQueueRisk } from './pr-utils';
import type {
    CommentThread,
    PullRequest,
    PullRequestCheck,
    PullRequestDiffStats,
    QueueRiskBadge,
    Reviewer,
} from './pr-utils';

export type PrReviewFindingTag = 'good' | 'risk' | 'note';
export type PrReviewRiskLevel = 'Low' | 'Medium' | 'High' | 'Unknown';

export interface PrReviewMetric {
    key: string;
    value: string;
}

export interface PrReviewFinding {
    tag: PrReviewFindingTag;
    label: string;
    body: string;
}

export interface PrReviewSummary {
    risk: PrReviewRiskLevel;
    summary: string;
    metrics: PrReviewMetric[];
    findings: PrReviewFinding[];
    blockingThreadCount: number;
    unresolvedCount: number;
}

export function buildPullRequestDiffStats(
    files: readonly FileChange[],
    fallback?: PullRequestDiffStats,
): PullRequestDiffStats | undefined {
    if (files.length === 0) return fallback;
    return {
        additions: files.reduce((sum, file) => sum + (file.additions ?? 0), 0),
        deletions: files.reduce((sum, file) => sum + (file.deletions ?? 0), 0),
        changedFiles: files.length,
    };
}

export function getPullRequestReviewSummaryText(pr: PullRequest): string {
    return (pr.description ?? '').trim();
}

export function isFailingPullRequestCheck(check: PullRequestCheck): boolean {
    return check.status === 'failure';
}

export function isUnresolvedPullRequestThread(thread: CommentThread): boolean {
    const status = thread.status?.toLowerCase();
    return status == null || status === 'active' || status === 'open';
}

export function reviewRiskPillClass(risk: PrReviewRiskLevel): string {
    switch (risk) {
        case 'Low':     return 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-200';
        case 'Medium':  return 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/40 dark:text-yellow-200';
        case 'High':    return 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-200';
        case 'Unknown': return 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-300';
    }
}

export function buildPrReviewSummary(params: {
    pr: PullRequest;
    diffStats?: PullRequestDiffStats;
    checks: PullRequestCheck[];
    reviewers: Reviewer[];
    threads: CommentThread[];
}): PrReviewSummary {
    const { pr, diffStats, checks, reviewers, threads } = params;
    const failingChecks = checks.filter(isFailingPullRequestCheck);
    const unresolvedThreads = threads.filter(isUnresolvedPullRequestThread);
    const approvedReviewers = reviewers.filter(isApprovedReviewer);
    const passingChecks = checks.filter(check => check.status === 'success');
    const risk = riskLevelFromQueueRisk(deriveQueueRisk(diffStats, {
        hasFailingCheck: failingChecks.length > 0,
        hasUnresolvedBlockingThread: unresolvedThreads.length > 0,
    }));

    const findings: PrReviewFinding[] = [
        ...failingChecks.map(check => ({
            tag: 'risk' as const,
            label: 'Risk',
            body: checkFindingText(check),
        })),
        ...unresolvedThreads.map(thread => ({
            tag: 'risk' as const,
            label: 'Thread',
            body: threadFindingText(thread),
        })),
    ];

    if (findings.length === 0) {
        findings.push({
            tag: 'good',
            label: 'Good',
            body: 'No failing checks or blocking threads.',
        });
    }

    return {
        risk,
        summary: getPullRequestReviewSummaryText(pr) || 'No PR description provided.',
        metrics: [
            { key: 'Files', value: diffStats ? String(diffStats.changedFiles) : 'n/a' },
            { key: 'Lines', value: diffStats ? `+${diffStats.additions} / -${diffStats.deletions}` : 'n/a' },
            { key: 'Checks', value: checks.length > 0 ? `${passingChecks.length}/${checks.length} passing` : '0 reported' },
            { key: 'Reviewers', value: reviewers.length > 0 ? `${approvedReviewers.length}/${reviewers.length} approved` : '0 assigned' },
            { key: 'Threads', value: threads.length > 0 ? `${unresolvedThreads.length}/${threads.length} unresolved` : '0 open' },
        ],
        findings,
        blockingThreadCount: unresolvedThreads.length,
        unresolvedCount: unresolvedThreads.length,
    };
}

function riskLevelFromQueueRisk(risk: QueueRiskBadge): PrReviewRiskLevel {
    switch (risk) {
        case 'low':     return 'Low';
        case 'med':     return 'Medium';
        case 'high':    return 'High';
        case 'unknown': return 'Unknown';
    }
}

function isApprovedReviewer(reviewer: Reviewer): boolean {
    const vote = (reviewer.vote ?? '').toLowerCase().replace(/[-_\s]/g, '');
    return vote === 'approved' || vote === 'approvedwithsuggestions';
}

function checkFindingText(check: PullRequestCheck): string {
    const name = check.group ? `${check.group} / ${check.name}` : check.name;
    const description = check.description?.trim();
    return description ? `${name}: ${description}` : `${name} failed.`;
}

function threadFindingText(thread: CommentThread): string {
    const location = threadLocation(thread);
    const excerpt = firstThreadComment(thread);
    return excerpt
        ? `Unresolved blocking thread at ${location}: ${excerpt}`
        : `Unresolved blocking thread at ${location}.`;
}

function threadLocation(thread: CommentThread): string {
    const filePath = thread.threadContext?.filePath?.trim();
    if (!filePath) return `thread ${thread.id}`;
    const line = thread.threadContext.line ?? thread.threadContext.startLine;
    return line == null ? filePath : `${filePath}:${line}`;
}

function firstThreadComment(thread: CommentThread): string {
    const body = thread.comments.find(comment => comment.body.trim().length > 0)?.body ?? '';
    return truncate(body.replace(/\s+/g, ' ').trim(), 120);
}

function truncate(value: string, maxLength: number): string {
    if (value.length <= maxLength) return value;
    return `${value.slice(0, Math.max(0, maxLength - 3))}...`;
}
