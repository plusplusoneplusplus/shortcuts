/**
 * Tests for the deterministic AI mock data helpers used by the
 * redesigned PR review page.
 */

import { describe, it, expect } from 'vitest';
import {
    buildCheckRowsFromChecks,
    buildCommitRowsFromPrCommits,
    buildMergeReadinessFromData,
    checkStatusClass,
    commitIntentClass,
    findingTagClass,
    getMockAiAnswer,
    getMockAiSummary,
    getMockBranchSnapshot,
    getMockCheckRows,
    getMockCommitRows,
    getMockFiles,
    getMockMergeReadiness,
    getMockPersonaLenses,
    getMockPrFileCount,
    getMockPrReviewMinutes,
    getMockQueueRisk,
    getMockReviewSummaryText,
    getMockSeedChat,
    getMockSuggestedPrompts,
    getMockThreadGroups,
    getMockTimeline,
    getQueueFilterDefinitions,
    inferCommitIntent,
    queueDotClass,
    queueRiskClass,
    riskPillClass,
} from '../../../../../src/server/spa/client/react/features/pull-requests/pr-mock-data';
import type {
    CommentThread,
    PullRequest,
    PullRequestCheck,
    PullRequestCommit,
    Reviewer,
} from '../../../../../src/server/spa/client/react/features/pull-requests/pr-utils';

const basePr: PullRequest = {
    id: 4289,
    number: 4289,
    title: 'feat(stream): add JSONL backpressure to ingestion worker',
    description: 'Switches the ingestion worker to a streaming JSONL pipeline.',
    sourceBranch: 'morgan:jsonl-streaming',
    targetBranch: 'main',
    status: 'open',
    createdAt: new Date('2026-04-01T10:00:00Z').toISOString(),
    updatedAt: new Date('2026-04-02T12:30:00Z').toISOString(),
};

describe('AI mock data', () => {
    it('returns deterministic AI summary for the same PR', () => {
        const a = getMockAiSummary(basePr);
        const b = getMockAiSummary({ ...basePr });
        expect(a).toEqual(b);
        expect(a.metrics).toHaveLength(4);
        expect(a.findings.length).toBeGreaterThan(0);
        expect(['Low', 'Medium', 'High']).toContain(a.risk);
        expect(a.confidence).toBeGreaterThan(0);
        expect(a.confidence).toBeLessThanOrEqual(100);
    });

    it('classifies refactor PRs as high risk', () => {
        const summary = getMockAiSummary({
            ...basePr,
            title: 'refactor(tasks): replace scheduler persistence',
        });
        expect(summary.risk).toBe('High');
    });

    it('classifies docs PRs as low risk', () => {
        const summary = getMockAiSummary({
            ...basePr,
            title: 'docs(api): clarify webhook replay order',
            description: 'Tighten the wording on the webhook replay order docs.',
        });
        expect(summary.risk).toBe('Low');
    });

    it('classifies streaming PRs as medium risk', () => {
        const summary = getMockAiSummary({
            ...basePr,
            title: 'feat(stream): add JSONL backpressure',
            description: 'streaming worker backpressure',
        });
        expect(summary.risk).toBe('Medium');
    });

    it('exposes branch snapshot helpers with stable shape', () => {
        const snap = getMockBranchSnapshot(basePr);
        expect(snap.sourceBranch).toBe(basePr.sourceBranch);
        expect(snap.targetBranch).toBe(basePr.targetBranch);
        expect(snap.additions).toBeGreaterThan(0);
        expect(snap.deletions).toBeGreaterThan(0);
        expect(snap.commitCount).toBeGreaterThan(0);
        expect(snap.fileCount).toBeGreaterThan(0);
    });

    it('returns persona lenses, timeline, and thread groups', () => {
        expect(getMockPersonaLenses().map(lens => lens.persona)).toEqual([
            'Reviewer',
            'Author',
            'Tech lead',
        ]);
        expect(getMockTimeline().length).toBeGreaterThanOrEqual(3);
        const groups = getMockThreadGroups();
        expect(groups.length).toBeGreaterThanOrEqual(4);
        expect(groups.some(group => group.severity === 'blocking')).toBe(true);
    });

    it('returns commit, check, merge-readiness, and file fixtures', () => {
        expect(getMockCommitRows().length).toBeGreaterThanOrEqual(5);
        expect(getMockCheckRows().some(row => row.status === 'warning')).toBe(true);
        expect(getMockMergeReadiness().some(item => item.tag === 'risk')).toBe(true);
        const files = getMockFiles();
        expect(files.some(file => file.annotation)).toBe(true);
    });

    it('returns suggested prompts and seed chat for the assistant', () => {
        expect(getMockSuggestedPrompts()).not.toHaveLength(0);
        const chat = getMockSeedChat();
        expect(chat[0]?.role).toBe('ai');
        const chatAgain = getMockSeedChat();
        expect(chatAgain).not.toBe(chat); // returns a defensive copy
    });

    it('matches AI answers based on question keywords', () => {
        expect(getMockAiAnswer('What can I ignore?').answer).toMatch(/skim|ignore|fixture/i);
        expect(getMockAiAnswer('Draft a comment').answer).toMatch(/comment|draft/i);
        expect(getMockAiAnswer('Can this merge today?').answer).toMatch(/test|merge|owner/i);
        expect(getMockAiAnswer('Anything else?').answer.length).toBeGreaterThan(0);
    });

    it('exposes class-name helpers for tags, intents, statuses, and risks', () => {
        expect(findingTagClass('good')).toContain('green');
        expect(findingTagClass('risk')).toContain('yellow');
        expect(findingTagClass('note')).toContain('blue');
        expect(findingTagClass('ai')).toContain('purple');

        expect(commitIntentClass('feat')).toContain('green');
        expect(commitIntentClass('fix')).toContain('yellow');
        expect(commitIntentClass('refactor')).toContain('purple');

        expect(checkStatusClass('success')).toContain('green');
        expect(checkStatusClass('warning')).toContain('yellow');
        expect(checkStatusClass('failure')).toContain('red');
        expect(checkStatusClass('pending')).toContain('blue');
        expect(checkStatusClass('running')).toContain('blue');
        expect(checkStatusClass('cancelled')).toContain('gray');
        expect(checkStatusClass('skipped')).toContain('gray');
        expect(checkStatusClass('unknown')).toContain('gray');

        expect(riskPillClass('Low')).toContain('green');
        expect(riskPillClass('Medium')).toContain('yellow');
        expect(riskPillClass('High')).toContain('red');
    });

    it('returns a non-empty review summary text', () => {
        const summary = getMockReviewSummaryText(basePr);
        expect(summary.length).toBeGreaterThan(20);
    });
});

describe('commit intent inference', () => {
    it.each([
        ['feat: stream JSONL parser',           'feat'],
        ['feature(stream): add backpressure',   'feat'],
        ['Add cancellation test',               'feat'],
        ['fix: handle abort cleanly',           'fix'],
        ['Fixes regression in retry path',      'fix'],
        ['docs: update README',                 'docs'],
        ['Document ingest rollout',             'docs'],
        ['test: cover slow consumer',           'test'],
        ['refactor: extract parser module',     'refactor'],
        ['Rename old offset cache',             'refactor'],
        ['chore: bump dependencies',            'chore'],
        ['Bump @types/foo to 1.2.3',            'chore'],
    ])('infers %s as %s', (message, expected) => {
        expect(inferCommitIntent(message)).toBe(expected);
    });

    it('falls back to "chore" when the message has no known keyword', () => {
        expect(inferCommitIntent('mystery commit')).toBe('chore');
    });

    it('only looks at the first line of multi-line messages', () => {
        expect(inferCommitIntent('fix: handle abort\n\nfeature notes')).toBe('fix');
    });
});

describe('buildCommitRowsFromPrCommits', () => {
    const realCommits: PullRequestCommit[] = [
        {
            id: 'abc1234deadbeef0000000000000000000000000',
            shortId: 'abc1234',
            message: 'feat: stream JSONL parser',
            subject: 'feat: stream JSONL parser',
            author: { displayName: 'Alice', email: 'alice@example.com' },
            authoredAt: '2024-01-04T12:34:56Z',
            committedAt: '2024-01-04T12:35:00Z',
            url: 'https://example.com/commit/abc1234',
        },
        {
            id: 'def5678deadbeef0000000000000000000000000',
            shortId: 'def5678',
            message: 'fix: handle abort cleanly\n\ndetails',
            subject: 'fix: handle abort cleanly',
        },
    ];

    it('maps real provider commits to PrCommitRow shape with short SHA and metadata', () => {
        const rows = buildCommitRowsFromPrCommits(realCommits);
        expect(rows).toHaveLength(2);
        expect(rows[0]).toEqual({
            sha: 'abc1234deadbeef0000000000000000000000000',
            shortSha: 'abc1234',
            title: 'feat: stream JSONL parser',
            message: 'feat: stream JSONL parser',
            author: { displayName: 'Alice', email: 'alice@example.com' },
            authoredAt: '2024-01-04T12:34:56Z',
            committedAt: '2024-01-04T12:35:00Z',
            url: 'https://example.com/commit/abc1234',
        });
        expect(rows[1]).toMatchObject({
            sha: 'def5678deadbeef0000000000000000000000000',
            shortSha: 'def5678',
            title: 'fix: handle abort cleanly',
        });
    });

    it('uses the first line of the message when subject is missing', () => {
        const rows = buildCommitRowsFromPrCommits([{
            id: 'ffffffffffffffffffffffffffffffffffffffff',
            shortId: 'fffffff',
            message: 'docs: tweak readme\n\nbody text',
            subject: '',
        }]);
        expect(rows[0].title).toBe('docs: tweak readme');
    });

    it('falls back to truncating the full id when shortId is missing', () => {
        const rows = buildCommitRowsFromPrCommits([{
            id: 'longshaaaa',
            shortId: '',
            message: 'docs: tweak readme',
            subject: 'docs: tweak readme',
        }]);
        expect(rows[0].shortSha).toBe('longsha');
    });

    it('returns an empty array when given no commits', () => {
        expect(buildCommitRowsFromPrCommits([])).toEqual([]);
    });
});

describe('buildCheckRowsFromChecks', () => {
    const makeCheck = (over: Partial<PullRequestCheck> = {}): PullRequestCheck => ({
        id: 'c1',
        name: 'build',
        status: 'success',
        source: 'check',
        ...over,
    });

    it('maps every generic check status to a UI row with status + interpretation text', () => {
        const checks: PullRequestCheck[] = [
            makeCheck({ id: '1', name: 'unit-tests', status: 'success', durationMs: 12000 }),
            makeCheck({ id: '2', name: 'lint', status: 'failure', description: 'eslint failed' }),
            makeCheck({ id: '3', name: 'flaky', status: 'warning' }),
            makeCheck({ id: '4', name: 'queued', status: 'pending' }),
            makeCheck({ id: '5', name: 'inflight', status: 'running' }),
            makeCheck({ id: '6', name: 'aborted', status: 'cancelled' }),
            makeCheck({ id: '7', name: 'skipme', status: 'skipped' }),
            makeCheck({ id: '8', name: 'mystery', status: 'unknown' }),
        ];
        const rows = buildCheckRowsFromChecks(checks);
        expect(rows).toHaveLength(8);
        expect(rows[0]).toMatchObject({ id: '1', name: 'unit-tests', status: 'success', duration: '12s' });
        expect(rows[0].interpretation).toMatch(/Completed successfully/i);
        expect(rows[1]).toMatchObject({ id: '2', name: 'lint', status: 'failure', interpretation: 'eslint failed' });
        expect(rows[2].status).toBe('warning');
        expect(rows[3].status).toBe('pending');
        expect(rows[4].status).toBe('running');
        expect(rows[5].status).toBe('cancelled');
        expect(rows[6].status).toBe('skipped');
        expect(rows[7].status).toBe('unknown');
        // Default interpretation per-status when no description is supplied.
        expect(rows[3].interpretation).toMatch(/queue|wait/i);
        expect(rows[5].interpretation).toMatch(/cancel/i);
        expect(rows[7].interpretation).toMatch(/not reported|unknown/i);
    });

    it('preserves detailsUrl, group, and source fields on the row, and prefixes group in the display name', () => {
        const rows = buildCheckRowsFromChecks([
            makeCheck({
                id: 'x',
                name: 'ci',
                detailsUrl: 'https://ex/1',
                group: 'github-actions',
                source: 'check',
            }),
        ]);
        expect(rows[0].detailsUrl).toBe('https://ex/1');
        expect(rows[0].group).toBe('github-actions');
        expect(rows[0].source).toBe('check');
        expect(rows[0].name).toBe('github-actions / ci');
    });

    it('returns an empty list when given no checks', () => {
        expect(buildCheckRowsFromChecks([])).toEqual([]);
    });

    it('formats duration in m ss format for longer runs and omits when missing', () => {
        const rows = buildCheckRowsFromChecks([
            makeCheck({ id: 'long', name: 'integration', status: 'success', durationMs: 185_000 }),
            makeCheck({ id: 'none', name: 'no-duration', status: 'success' }),
        ]);
        expect(rows[0].duration).toBe('3m 05s');
        expect(rows[1].duration).toBe('');
    });
});

describe('buildMergeReadinessFromData', () => {
    const failingCheck: PullRequestCheck = { id: 'f', name: 'lint', status: 'failure', source: 'check' };
    const runningCheck: PullRequestCheck = { id: 'r', name: 'build', status: 'running', source: 'check' };
    const warningCheck: PullRequestCheck = { id: 'w', name: 'cover', status: 'warning', source: 'check' };
    const passingCheck: PullRequestCheck = { id: 'p', name: 'build', status: 'success', source: 'check' };

    it('flags failing checks as a blocking merge-readiness item', () => {
        const items = buildMergeReadinessFromData({
            checks: [failingCheck, passingCheck],
            threads: [],
            reviewers: [],
        });
        const checksItem = items.find(item => item.label === 'Block');
        expect(checksItem).toBeDefined();
        expect(checksItem?.body).toMatch(/1 check failing/i);
        expect(checksItem?.tag).toBe('risk');
    });

    it('reports clean checks when all checks pass', () => {
        const items = buildMergeReadinessFromData({
            checks: [passingCheck],
            threads: [],
            reviewers: [],
        });
        const checksItem = items.find(item => item.label === 'Pass');
        expect(checksItem).toBeDefined();
        expect(checksItem?.tag).toBe('good');
    });

    it('reports a wait-state when checks are still running', () => {
        const items = buildMergeReadinessFromData({
            checks: [runningCheck, passingCheck],
            threads: [],
            reviewers: [],
        });
        const checksItem = items.find(item => item.label === 'Wait');
        expect(checksItem).toBeDefined();
        expect(checksItem?.body).toMatch(/still running/i);
    });

    it('reports a review-state when checks finished with warnings', () => {
        const items = buildMergeReadinessFromData({
            checks: [warningCheck, passingCheck],
            threads: [],
            reviewers: [],
        });
        const checksItem = items.find(item => item.label === 'Review');
        expect(checksItem).toBeDefined();
        expect(checksItem?.body).toMatch(/warning/i);
    });

    it('flags unresolved blocking threads', () => {
        const threads: CommentThread[] = [
            {
                id: 't1',
                status: 'active',
                comments: [{ id: 'c1', author: { displayName: 'a' }, body: 'change please' }],
            },
        ];
        const items = buildMergeReadinessFromData({
            checks: [passingCheck],
            threads,
            reviewers: [],
        });
        const threadsItem = items.find(item => item.label === 'Threads');
        expect(threadsItem).toBeDefined();
        expect(threadsItem?.tag).toBe('risk');
        expect(threadsItem?.body).toMatch(/unresolved/i);
    });

    it('reports resolved threads as good when nothing is active', () => {
        const threads: CommentThread[] = [
            {
                id: 't1',
                status: 'fixed',
                comments: [{ id: 'c1', author: { displayName: 'a' }, body: 'done' }],
            },
        ];
        const items = buildMergeReadinessFromData({
            checks: [passingCheck],
            threads,
            reviewers: [],
        });
        const threadsItem = items.find(item => item.label === 'Threads');
        expect(threadsItem?.tag).toBe('good');
    });

    it('flags missing required-reviewer approval', () => {
        const reviewers: Reviewer[] = [
            { identity: { displayName: 'gatekeeper' }, vote: 'noVote', isRequired: true },
        ];
        const items = buildMergeReadinessFromData({
            checks: [passingCheck],
            threads: [],
            reviewers,
        });
        const reviewerItem = items.find(item => item.label === 'Reviewers');
        expect(reviewerItem).toBeDefined();
        expect(reviewerItem?.body).toMatch(/required reviewer/i);
        expect(reviewerItem?.tag).toBe('note');
    });

    it('flags rejected reviewers as a blocking risk', () => {
        const reviewers: Reviewer[] = [
            { identity: { displayName: 'blocker' }, vote: 'rejected' },
        ];
        const items = buildMergeReadinessFromData({
            checks: [passingCheck],
            threads: [],
            reviewers,
        });
        const reviewerItem = items.find(item => item.label === 'Reviewers');
        expect(reviewerItem?.tag).toBe('risk');
    });

    it('reports clean reviewers when everything is approved', () => {
        const reviewers: Reviewer[] = [
            { identity: { displayName: 'ok' }, vote: 'approved', isRequired: true },
        ];
        const items = buildMergeReadinessFromData({
            checks: [passingCheck],
            threads: [],
            reviewers,
        });
        const reviewerItem = items.find(item => item.label === 'Reviewers');
        expect(reviewerItem?.tag).toBe('good');
    });

    it('reports a note when there are no checks at all', () => {
        const items = buildMergeReadinessFromData({ checks: [], threads: [], reviewers: [] });
        const checksItem = items.find(item => item.label === 'Checks');
        expect(checksItem?.tag).toBe('note');
        expect(checksItem?.body).toMatch(/No CI checks/i);
    });
});

describe('queue helpers', () => {
    it('returns deterministic file count and review minutes inside expected ranges', () => {
        const a = getMockPrFileCount(basePr);
        const b = getMockPrFileCount({ ...basePr });
        expect(a).toBe(b);
        expect(a).toBeGreaterThanOrEqual(2);
        expect(a).toBeLessThanOrEqual(61);

        const t = getMockPrReviewMinutes(basePr);
        expect(t).toBe(getMockPrReviewMinutes({ ...basePr }));
        expect(t).toBeGreaterThanOrEqual(2);
        expect(t).toBeLessThanOrEqual(41);
    });

    it('maps the AI summary risk to a low / med / high queue badge', () => {
        const risk = getMockQueueRisk(basePr);
        expect(['low', 'med', 'high']).toContain(risk);

        expect(getMockQueueRisk({
            ...basePr,
            title: 'docs(api): clarify webhook replay order',
            description: 'Tighten the wording on the webhook replay order docs.',
        })).toBe('low');
        expect(getMockQueueRisk({
            ...basePr,
            title: 'refactor(tasks): replace scheduler persistence',
        })).toBe('high');
    });

    it('exposes class-name helpers for queue dots and risk pills', () => {
        expect(queueDotClass('open')).toContain('green');
        expect(queueDotClass('draft')).toContain('gray');
        expect(queueDotClass('blocked')).toContain('yellow');
        expect(queueDotClass('ready')).toContain('purple');

        expect(queueRiskClass('low')).toContain('green');
        expect(queueRiskClass('med')).toContain('yellow');
        expect(queueRiskClass('high')).toContain('red');
    });

    it('lists the four canonical queue filters in display order', () => {
        expect(getQueueFilterDefinitions().map(filter => filter.id)).toEqual([
            'all',
            'mine',
            'blocked',
            'ready',
        ]);
    });
});
