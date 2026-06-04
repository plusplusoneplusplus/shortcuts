import { describe, expect, it } from 'vitest';
import {
    buildPrReviewSummary,
    buildPullRequestDiffStats,
    getPullRequestReviewSummaryText,
    isFailingPullRequestCheck,
    isUnresolvedPullRequestThread,
} from '../../../../../src/server/spa/client/react/features/pull-requests/pr-detail-summary';
import type {
    CommentThread,
    PullRequest,
    PullRequestCheck,
} from '../../../../../src/server/spa/client/react/features/pull-requests/pr-utils';
import type { FileChange } from '../../../../../src/server/spa/client/react/features/git/diff';

const basePr: PullRequest = {
    id: 4289,
    number: 4289,
    title: 'feat(stream): add JSONL backpressure to ingestion worker',
    description: 'Switches the ingestion worker to a streaming JSONL pipeline.',
    sourceBranch: 'morgan:jsonl-streaming',
    targetBranch: 'main',
    status: 'open',
    createdAt: '2026-04-01T10:00:00Z',
    updatedAt: '2026-04-02T12:30:00Z',
};

describe('buildPullRequestDiffStats', () => {
    it('derives changed-file and line counts from parsed diff files', () => {
        const files: FileChange[] = [
            { status: 'M', path: 'src/a.ts', additions: 10, deletions: 2 },
            { status: 'A', path: 'src/b.ts', additions: 4 },
        ];
        expect(buildPullRequestDiffStats(files)).toEqual({
            additions: 14,
            deletions: 2,
            changedFiles: 2,
        });
    });

    it('uses fallback stats when the parsed diff is unavailable', () => {
        expect(buildPullRequestDiffStats([], { additions: 3, deletions: 1, changedFiles: 1 })).toEqual({
            additions: 3,
            deletions: 1,
            changedFiles: 1,
        });
    });
});

describe('buildPrReviewSummary', () => {
    const failingCheck: PullRequestCheck = {
        id: 'lint',
        name: 'lint',
        status: 'failure',
        source: 'check',
        description: 'eslint failed',
    };

    const activeThread: CommentThread = {
        id: 'thread-1',
        status: 'active',
        comments: [{ id: 'c1', body: 'Please handle abort replay before merge.' }],
        threadContext: { filePath: 'src/worker.ts', line: 21 },
    };

    it('builds deterministic facts from PR description, diff, checks, reviewers, and threads', () => {
        const summary = buildPrReviewSummary({
            pr: basePr,
            diffStats: { additions: 120, deletions: 40, changedFiles: 5 },
            checks: [
                { id: 'build', name: 'build', status: 'success', source: 'check' },
                failingCheck,
            ],
            reviewers: [
                { identity: { displayName: 'Approved reviewer' }, vote: 'approved' },
                { identity: { displayName: 'Pending reviewer' }, vote: 'noVote' },
            ],
            threads: [activeThread],
        });

        expect(summary.summary).toBe(basePr.description);
        expect(summary.risk).toBe('Medium');
        expect(summary.metrics).toEqual([
            { key: 'Files', value: '5' },
            { key: 'Lines', value: '+120 / -40' },
            { key: 'Checks', value: '1/2 passing' },
            { key: 'Reviewers', value: '1/2 approved' },
            { key: 'Threads', value: '1/1 unresolved' },
        ]);
        expect(summary.findings.map(finding => finding.body)).toEqual([
            'lint: eslint failed',
            'Unresolved blocking thread at src/worker.ts:21: Please handle abort replay before merge.',
        ]);
    });

    it('uses a good finding when no checks or threads block review', () => {
        const summary = buildPrReviewSummary({
            pr: basePr,
            diffStats: { additions: 12, deletions: 3, changedFiles: 1 },
            checks: [{ id: 'build', name: 'build', status: 'success', source: 'check' }],
            reviewers: [],
            threads: [{ ...activeThread, status: 'resolved' }],
        });

        expect(summary.risk).toBe('Low');
        expect(summary.findings).toEqual([{
            tag: 'good',
            label: 'Good',
            body: 'No failing checks or blocking threads.',
        }]);
    });

    it('surfaces unknown risk when no real diff stats are available', () => {
        const summary = buildPrReviewSummary({
            pr: basePr,
            checks: [],
            reviewers: [],
            threads: [],
        });

        expect(summary.risk).toBe('Unknown');
        expect(summary.metrics[0]).toEqual({ key: 'Files', value: 'n/a' });
    });
});

describe('review summary helpers', () => {
    it('copies exactly the PR description text', () => {
        expect(getPullRequestReviewSummaryText(basePr)).toBe(basePr.description);
        expect(getPullRequestReviewSummaryText({ ...basePr, description: undefined })).toBe('');
    });

    it('classifies only failed checks and active/open threads as blocking signals', () => {
        expect(isFailingPullRequestCheck({ id: '1', name: 'build', status: 'failure', source: 'check' })).toBe(true);
        expect(isFailingPullRequestCheck({ id: '2', name: 'build', status: 'warning', source: 'check' })).toBe(false);

        expect(isUnresolvedPullRequestThread({ id: '1', status: 'open', comments: [] })).toBe(true);
        expect(isUnresolvedPullRequestThread({ id: '2', status: 'resolved', comments: [] })).toBe(false);
    });
});
