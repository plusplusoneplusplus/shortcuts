import { describe, expect, it } from 'vitest';
import {
    AttentionGroup,
    ATTENTION_GROUP_CONFIGS,
    QUEUE_SECTION_CONFIGS,
    classifyPr,
    classifyQueueSection,
    mapAttentionToQueueSection,
} from '../../../../../src/server/spa/client/react/features/pull-requests/pr-attention-groups';

const makePr = (overrides: Partial<any> = {}) => ({
    id: 1,
    number: 1,
    title: 'Fix bug',
    sourceBranch: 'feature/fix',
    targetBranch: 'main',
    status: 'open',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    author: { displayName: 'Alice' },
    reviewers: [],
    ...overrides,
});

describe('pr attention groups', () => {
    it('exports the four ordered configs used by the PR layout', () => {
        expect(ATTENTION_GROUP_CONFIGS.map(config => config.group)).toEqual([
            AttentionGroup.RerunNeeded,
            AttentionGroup.ManualUpdateNeeded,
            AttentionGroup.ReviewerNudge,
            AttentionGroup.MergeValidation,
        ]);
    });

    it('classifies requested changes as manual update needed', () => {
        const pr = makePr({ reviewers: [{ identity: { displayName: 'Reviewer' }, vote: 'waitingForAuthor' }] });

        expect(classifyPr(pr)).toBe(AttentionGroup.ManualUpdateNeeded);
    });

    it('classifies active threads as manual update needed', () => {
        const pr = makePr({ labels: ['ci-failed'] });

        expect(classifyPr(pr, [{ id: 1, status: 'active', comments: [] }])).toBe(AttentionGroup.ManualUpdateNeeded);
    });

    it('classifies failed CI signals as rerun needed', () => {
        expect(classifyPr(makePr({ labels: ['ci-failed'] }))).toBe(AttentionGroup.RerunNeeded);
        expect(classifyPr(makePr({ description: 'The build timed out.' }))).toBe(AttentionGroup.RerunNeeded);
    });

    it('classifies stale no-vote reviews as reviewer nudge needed', () => {
        const stale = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();

        expect(classifyPr(makePr({
            updatedAt: stale,
            reviewers: [{ identity: { displayName: 'Reviewer' }, vote: 'noVote' }],
        }))).toBe(AttentionGroup.ReviewerNudge);
    });

    it('does not nudge reviewers for recently updated PRs', () => {
        expect(classifyPr(makePr({
            reviewers: [{ identity: { displayName: 'Reviewer' }, vote: 'noVote' }],
        }))).toBe(AttentionGroup.MergeValidation);
    });

    it('classifies approved PRs and unclassified PRs as merge validation needed', () => {
        expect(classifyPr(makePr({
            reviewers: [{ identity: { displayName: 'Reviewer' }, vote: 'approvedWithSuggestions' }],
        }))).toBe(AttentionGroup.MergeValidation);
        expect(classifyPr(makePr())).toBe(AttentionGroup.MergeValidation);
    });
});

describe('queue-section mapping', () => {
    it('exposes the two ordered queue sections used by the rail', () => {
        expect(QUEUE_SECTION_CONFIGS.map(config => config.section)).toEqual([
            'needs-review',
            'ready',
        ]);
    });

    it('maps merge-validation to the ready section', () => {
        expect(mapAttentionToQueueSection(AttentionGroup.MergeValidation)).toBe('ready');
    });

    it('maps the other three attention groups to needs-review', () => {
        expect(mapAttentionToQueueSection(AttentionGroup.RerunNeeded)).toBe('needs-review');
        expect(mapAttentionToQueueSection(AttentionGroup.ManualUpdateNeeded)).toBe('needs-review');
        expect(mapAttentionToQueueSection(AttentionGroup.ReviewerNudge)).toBe('needs-review');
    });

    it('classifyQueueSection composes classifyPr and the queue mapping', () => {
        const blocked = makePr({ reviewers: [{ identity: { displayName: 'Reviewer' }, vote: 'waitingForAuthor' }] });
        const ready = makePr({ reviewers: [{ identity: { displayName: 'Reviewer' }, vote: 'approved' }] });
        expect(classifyQueueSection(blocked)).toBe('needs-review');
        expect(classifyQueueSection(ready)).toBe('ready');
    });
});
