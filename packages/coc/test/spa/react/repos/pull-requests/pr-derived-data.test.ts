/**
 * Tests for deterministic PR data adapters used by the redesigned PR review page.
 */

import { describe, it, expect } from 'vitest';
import {
    buildCheckRowsFromChecks,
    buildCommitRowsFromPrCommits,
    buildMergeReadinessFromData,
    buildQueueFilterCounts,
    buildThreadGroupsFromThreads,
    buildTimelineFromRealData,
    checkStatusClass,
    deriveThreadSeverity,
    findingTagClass,
    getQueueFilterDefinitions,
    matchesFilter,
    queueDotClass,
    queueRiskClass,
    scopeForFilter,
} from '../../../../../src/server/spa/client/react/features/pull-requests/pr-derived-data';
import type {
    CommentThread,
    PullRequest,
    PullRequestCheck,
    PullRequestCommit,
    Reviewer,
} from '../../../../../src/server/spa/client/react/features/pull-requests/pr-utils';

describe('PR deterministic data helpers', () => {
    it('exposes class-name helpers for finding tags, statuses, queue dots, and risk pills', () => {
        expect(findingTagClass('good')).toContain('green');
        expect(findingTagClass('risk')).toContain('yellow');
        expect(findingTagClass('note')).toContain('blue');

        expect(checkStatusClass('success')).toContain('green');
        expect(checkStatusClass('warning')).toContain('yellow');
        expect(checkStatusClass('failure')).toContain('red');
        expect(checkStatusClass('pending')).toContain('blue');
        expect(checkStatusClass('running')).toContain('blue');
        expect(checkStatusClass('cancelled')).toContain('gray');
        expect(checkStatusClass('skipped')).toContain('gray');
        expect(checkStatusClass('unknown')).toContain('gray');

        expect(queueDotClass('open')).toContain('green');
        expect(queueDotClass('draft')).toContain('gray');
        expect(queueDotClass('blocked')).toContain('yellow');
        expect(queueDotClass('ready')).toContain('purple');

        expect(queueRiskClass('low')).toContain('green');
        expect(queueRiskClass('med')).toContain('yellow');
        expect(queueRiskClass('high')).toContain('red');
        expect(queueRiskClass('unknown')).toContain('gray');
    });
});

describe('buildCommitRowsFromPrCommits', () => {
    const realCommits: PullRequestCommit[] = [
        {
            id: 'abc1234deadbeef0000000000000000000000000',
            shortId: 'abc1234',
            message: 'feat: stream JSONL parser',
            subject: 'feat: stream JSONL parser',
            author: { displayName: 'Contributor One' },
            authoredAt: '2024-01-04T12:34:56Z',
            committedAt: '2024-01-04T12:35:00Z',
            url: 'https://example.invalid/commit/abc1234',
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
            author: { displayName: 'Contributor One' },
            authoredAt: '2024-01-04T12:34:56Z',
            committedAt: '2024-01-04T12:35:00Z',
            url: 'https://example.invalid/commit/abc1234',
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

    it('maps every generic check status to a UI row with status and interpretation text', () => {
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
        expect(rows[3].interpretation).toMatch(/queue|wait/i);
        expect(rows[5].interpretation).toMatch(/cancel/i);
        expect(rows[7].interpretation).toMatch(/not reported|unknown/i);
    });

    it('preserves detailsUrl, group, and source fields on the row, and prefixes group in the display name', () => {
        const rows = buildCheckRowsFromChecks([
            makeCheck({
                id: 'x',
                name: 'ci',
                detailsUrl: 'https://example.invalid/checks/1',
                group: 'github-actions',
                source: 'check',
            }),
        ]);
        expect(rows[0].detailsUrl).toBe('https://example.invalid/checks/1');
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

    it('flags missing, active, and open thread statuses as unresolved', () => {
        const threads: CommentThread[] = [
            {
                id: 't1',
                status: 'active',
                comments: [{ id: 'c1', author: { displayName: 'Reviewer One' }, body: 'change please' }],
            },
            {
                id: 't2',
                status: 'open',
                comments: [{ id: 'c2', author: { displayName: 'Reviewer Two' }, body: 'another change' }],
            },
            {
                id: 't3',
                comments: [{ id: 'c3', author: { displayName: 'Reviewer Three' }, body: 'provider omitted status' }],
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
        expect(threadsItem?.body).toMatch(/3 comment threads are still unresolved/i);
    });

    it('reports resolved threads as good when nothing is active', () => {
        const threads: CommentThread[] = [
            {
                id: 't1',
                status: 'fixed',
                comments: [{ id: 'c1', author: { displayName: 'Reviewer One' }, body: 'done' }],
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
            { identity: { displayName: 'Required Reviewer' }, vote: 'noVote', isRequired: true },
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
            { identity: { displayName: 'Blocking Reviewer' }, vote: 'rejected' },
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
            { identity: { displayName: 'Approving Reviewer' }, vote: 'approved', isRequired: true },
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
    const makeQueuePr = (overrides: Partial<PullRequest> = {}): PullRequest => ({
        id: 1,
        number: 1,
        title: 'Queue PR',
        sourceBranch: 'feature',
        targetBranch: 'main',
        status: 'open',
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
        author: { id: 'author-1', displayName: 'Author One' },
        reviewers: [],
        ...overrides,
    });

    it('lists the canonical queue filters in display order', () => {
        expect(getQueueFilterDefinitions().map(filter => filter.id)).toEqual([
            'all',
            'mine',
            'team',
            'blocked',
            'ready',
        ]);
    });

    it('includes "foryou" filter when suggestionsEnabled is true', () => {
        expect(getQueueFilterDefinitions({ suggestionsEnabled: true }).map(f => f.id)).toEqual([
            'all',
            'mine',
            'team',
            'blocked',
            'ready',
            'foryou',
        ]);
    });

    it('labels the foryou filter as "For You"', () => {
        const foryou = getQueueFilterDefinitions({ suggestionsEnabled: true }).find(f => f.id === 'foryou');
        expect(foryou).toBeDefined();
        expect(foryou!.label).toBe('For You');
    });

    it('excludes "foryou" filter by default', () => {
        const ids = getQueueFilterDefinitions().map(f => f.id);
        expect(ids).not.toContain('foryou');
    });

    it('maps Team and For You filters to the all-PR server scope', () => {
        expect(scopeForFilter('mine')).toBe('mine');
        expect(scopeForFilter('blocked')).toBe('mine');
        expect(scopeForFilter('ready')).toBe('mine');
        expect(scopeForFilter('all')).toBe('all');
        expect(scopeForFilter('team')).toBe('all');
        expect(scopeForFilter('foryou')).toBe('all');
    });

    it('matches Team PRs by coworker roster union', () => {
        const teamPr = makeQueuePr({ author: { id: 'github-123', displayName: 'Teammate' } });
        const fallbackPr = makeQueuePr({ author: { displayName: 'ADO Teammate' } });
        const strangerPr = makeQueuePr({ author: { id: 'someone-else', displayName: 'Someone Else' } });

        expect(matchesFilter(teamPr, 'team', {
            coworkerRoster: [{ id: 'github-123', displayName: 'Different Display' }],
        })).toBe(true);
        expect(matchesFilter(fallbackPr, 'team', {
            coworkerRoster: [{ id: '', displayName: 'ado teammate' }],
        })).toBe(true);
        expect(matchesFilter(strangerPr, 'team', {
            coworkerRoster: [{ id: 'github-123', displayName: 'Teammate' }],
        })).toBe(false);
    });

    it('counts Team matches from the loaded PR set', () => {
        const counts = buildQueueFilterCounts([
            makeQueuePr({ id: 1, number: 1, author: { id: 'u1', displayName: 'One' } }),
            makeQueuePr({ id: 2, number: 2, author: { id: 'u2', displayName: 'Two' } }),
            makeQueuePr({
                id: 3,
                number: 3,
                author: { id: 'u3', displayName: 'Three' },
                reviewers: [{ identity: { displayName: 'Reviewer' }, vote: 'waitingForAuthor' }],
            }),
        ], {
            effectiveScope: 'all',
            suggestedPrNumbers: new Set([2]),
            coworkerRoster: [
                { id: 'u1', displayName: 'One' },
                { id: '', displayName: 'two' },
            ],
        });

        expect(counts).toMatchObject({
            all: 3,
            mine: 0,
            team: 2,
            blocked: 1,
            ready: 2,
            foryou: 1,
        });
    });
});

describe('thread group derivation', () => {
    it('derives thread severity from real thread status and comment text', () => {
        expect(deriveThreadSeverity({ id: 1, comments: [{ body: 'this crash is a regression' }] })).toBe('blocking');
        expect(deriveThreadSeverity({ id: 2, comments: [{ body: 'nit: typo in label' }] })).toBe('noise');
        expect(deriveThreadSeverity({ id: 3, status: 'fixed', comments: [{ body: 'resolved follow-up' }] })).toBe('non-blocking');
        expect(deriveThreadSeverity({ id: 4, comments: [{ body: 'general note about future work' }] })).toBe('non-blocking');
    });

    it('groups real threads into deterministic severity buckets with example file paths', () => {
        const groups = buildThreadGroupsFromThreads([
            { id: 1, comments: [{ body: 'this looks like a real bug, crash on null' }], threadContext: { filePath: 'src/foo.ts' } },
            { id: 2, comments: [{ body: 'nit: typo here' }] },
            { id: 3, comments: [{ body: 'general note about future work' }], threadContext: { filePath: 'src/bar.ts' } },
        ]);

        expect(groups.map(group => group.id)).toEqual(['blocking', 'non-blocking', 'noise']);
        expect(groups.map(group => group.count)).toEqual([1, 1, 1]);
        expect(groups[0].body).toContain('src/foo.ts');
        expect(groups[1].body).toContain('src/bar.ts');
    });
});

const threadGroups = [
    { id: 'blocking',     title: 'Blocking concerns',     count: 2 },
    { id: 'non-blocking', title: 'Non-blocking feedback', count: 1 },
    { id: 'noise',        title: 'Nits and noise',        count: 0 },
];

const sampleThreads: CommentThread[] = [
    {
        id: 't1',
        status: 'active',
        comments: [
            {
                id: 'c1',
                author: { displayName: 'Reviewer One' },
                body: 'Can we prove abort does not replay the final partial line?',
            },
        ],
    },
    {
        id: 't2',
        status: 'active',
        comments: [
            {
                id: 'c2',
                author: { displayName: 'Reviewer Two' },
                body: 'Style nit: rename variable.',
            },
        ],
    },
];

const sampleCommits: PullRequestCommit[] = [
    {
        id: 'abc1',
        shortId: 'abc1',
        message: 'Added parser boundary docs',
        subject: 'Added parser boundary docs',
        author: { displayName: 'Contributor One' },
    },
    {
        id: 'abc2',
        shortId: 'abc2',
        message: 'Replaced the old batch fixture helper',
        subject: 'Replaced the old batch fixture helper',
        author: { displayName: 'Contributor One' },
    },
    {
        id: 'abc3',
        shortId: 'abc3',
        message: 'Fix cancellation edge case',
        subject: 'Fix cancellation edge case',
        author: { displayName: 'Contributor One' },
    },
];

describe('buildTimelineFromRealData', () => {
    it('returns an empty array when both threads and commits are empty', () => {
        expect(buildTimelineFromRealData([], [], [])).toEqual([]);
    });

    it('emits a summary event when threads are present', () => {
        const events = buildTimelineFromRealData(sampleThreads, [], threadGroups);
        const summaryEvent = events.find(e => e.kind === 'summary');
        expect(summaryEvent).toBeDefined();
        expect(summaryEvent!.initials).toBe('PR');
        expect(summaryEvent!.title).toMatch(/Grouped 2 review threads into 2 topics/);
        expect(summaryEvent!.detail).toMatch(/Blocking concerns/);
        expect(summaryEvent!.detail).toMatch(/Non-blocking feedback/);
    });

    it('omits the summary event when there are no threads', () => {
        const events = buildTimelineFromRealData([], sampleCommits, []);
        expect(events.find(e => e.kind === 'summary')).toBeUndefined();
    });

    it('emits a reviewer event with initials derived from the commenter name', () => {
        const events = buildTimelineFromRealData(sampleThreads, [], threadGroups);
        const reviewerEvent = events.find(e => e.kind === 'reviewer');
        expect(reviewerEvent).toBeDefined();
        expect(reviewerEvent!.initials).toBe('RO');
        expect(reviewerEvent!.title).toContain('Reviewer One');
        expect(reviewerEvent!.detail).toContain('abort');
    });

    it('emits an author push event with real commit subjects', () => {
        const events = buildTimelineFromRealData([], sampleCommits, []);
        const authorEvent = events.find(e => e.kind === 'author');
        expect(authorEvent).toBeDefined();
        expect(authorEvent!.initials).toBe('CO');
        expect(authorEvent!.title).toContain('Contributor One');
        expect(authorEvent!.title).toContain('3 commits');
        expect(authorEvent!.detail).toContain('Added parser boundary docs');
    });

    it('respects maxReviewerEvents and maxAuthorEvents options', () => {
        const events = buildTimelineFromRealData(
            sampleThreads, sampleCommits, threadGroups,
            { maxReviewerEvents: 1, maxAuthorEvents: 1 },
        );
        expect(events.filter(e => e.kind === 'reviewer')).toHaveLength(1);
        expect(events.filter(e => e.kind === 'author')).toHaveLength(1);
    });

    it('limits reviewer events to maxReviewerEvents (default 2)', () => {
        const manyThreads: CommentThread[] = Array.from({ length: 5 }, (_, i) => ({
            id: `t${i}`,
            status: 'active',
            comments: [{ id: `c${i}`, author: { displayName: `Reviewer ${i}` }, body: `comment ${i}` }],
        }));
        const events = buildTimelineFromRealData(manyThreads, [], []);
        expect(events.filter(e => e.kind === 'reviewer')).toHaveLength(2);
    });

    it('uses singular "thread" and "topic" when there is exactly one', () => {
        const oneThread: CommentThread[] = [
            {
                id: 'x',
                status: 'active',
                comments: [{ id: 'cx', author: { displayName: 'Reviewer One' }, body: 'question' }],
            },
        ];
        const oneGroup = [{ id: 'blocking', title: 'Blocking', count: 1 }];
        const events = buildTimelineFromRealData(oneThread, [], oneGroup);
        const summaryEvent = events.find(e => e.kind === 'summary');
        expect(summaryEvent!.title).toMatch(/1 review thread into 1 topic/);
    });

    it('truncates long comment bodies to 80 chars with an ellipsis', () => {
        const longBody = 'A'.repeat(100);
        const longThread: CommentThread[] = [
            {
                id: 'long',
                status: 'active',
                comments: [{ id: 'cl', author: { displayName: 'Reviewer One' }, body: longBody }],
            },
        ];
        const events = buildTimelineFromRealData(longThread, [], []);
        const reviewerEvent = events.find(e => e.kind === 'reviewer');
        expect(reviewerEvent!.detail).toHaveLength(85);
        expect(reviewerEvent!.detail).toMatch(/\.\.\."$/);
    });

    it('skips threads with no author displayName or empty body', () => {
        const badThreads: CommentThread[] = [
            { id: 'b1', comments: [] },
            { id: 'b2', comments: [{ id: 'c', body: '' }] },
            { id: 'b3', comments: [{ id: 'c', author: { displayName: '' }, body: 'hi' }] },
        ];
        const events = buildTimelineFromRealData(badThreads, [], []);
        expect(events.filter(e => e.kind === 'reviewer')).toHaveLength(0);
    });

    it('produces correct 2-letter initials for single-name authors', () => {
        const commits: PullRequestCommit[] = [
            { id: 'a', shortId: 'a', message: 'fix thing', subject: 'fix thing', author: { displayName: 'Contributor' } },
        ];
        const events = buildTimelineFromRealData([], commits, []);
        const authorEvent = events.find(e => e.kind === 'author');
        expect(authorEvent!.initials).toBe('CO');
    });

    it('falls back to "Author" when commit has no author name', () => {
        const commits: PullRequestCommit[] = [
            { id: 'a', shortId: 'a', message: 'fix thing', subject: 'fix thing' },
        ];
        const events = buildTimelineFromRealData([], commits, []);
        const authorEvent = events.find(e => e.kind === 'author');
        expect(authorEvent!.title).toContain('Author');
        expect(authorEvent!.initials).toBe('?');
    });
});
