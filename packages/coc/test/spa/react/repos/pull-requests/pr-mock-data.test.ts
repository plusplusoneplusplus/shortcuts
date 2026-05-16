/**
 * Tests for the deterministic AI mock data helpers used by the
 * redesigned PR review page.
 */

import { describe, it, expect } from 'vitest';
import {
    buildCommitRowsFromPrCommits,
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
import type { PullRequest, PullRequestCommit } from '../../../../../src/server/spa/client/react/features/pull-requests/pr-utils';

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
        expect(getMockCheckRows().some(row => row.status === 'warn')).toBe(true);
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

        expect(checkStatusClass('ok')).toContain('green');
        expect(checkStatusClass('warn')).toContain('yellow');
        expect(checkStatusClass('fail')).toContain('red');

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
        },
        {
            id: 'def5678deadbeef0000000000000000000000000',
            shortId: 'def5678',
            message: 'fix: handle abort cleanly\n\ndetails',
            subject: 'fix: handle abort cleanly',
        },
    ];

    it('maps real provider commits to rows with inferred intent and short hash', () => {
        const rows = buildCommitRowsFromPrCommits(realCommits);
        expect(rows).toHaveLength(2);
        expect(rows[0]).toMatchObject({
            id: 'abc1234deadbeef0000000000000000000000000',
            title: 'feat: stream JSONL parser',
            intent: 'feat',
            hash: 'abc1234',
        });
        expect(rows[1]).toMatchObject({
            id: 'def5678deadbeef0000000000000000000000000',
            title: 'fix: handle abort cleanly',
            intent: 'fix',
            hash: 'def5678',
        });
        expect(rows[0].note.length).toBeGreaterThan(0);
    });

    it('falls back to the full id when shortId is missing', () => {
        const rows = buildCommitRowsFromPrCommits([{
            id: 'longshaaaa',
            shortId: '',
            message: 'docs: tweak readme',
            subject: 'docs: tweak readme',
        }]);
        expect(rows[0].hash).toBe('longsha');
    });

    it('returns an empty array when given no commits', () => {
        expect(buildCommitRowsFromPrCommits([])).toEqual([]);
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
