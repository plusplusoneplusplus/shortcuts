import { describe, it, expect } from 'vitest';
import {
    gitReviewPopOutKey,
    gitReviewBranchPopOutKey,
    gitReviewPrPopOutKey,
    GIT_REVIEW_POPOUT_CHANNEL,
    GIT_REVIEW_POPOUT_LS_KEY,
} from '../../../../src/server/spa/client/react/contexts/GitReviewPopOutContext';

describe('gitReviewPopOutKey', () => {
    it('creates composite key from workspaceId and commitHash', () => {
        expect(gitReviewPopOutKey('ws1', 'abc123')).toBe('ws1::commit::abc123');
    });

    it('includes full commit hash', () => {
        const hash = 'abcdef1234567890abcdef1234567890abcdef12';
        expect(gitReviewPopOutKey('ws1', hash)).toContain(hash);
    });
});

describe('gitReviewBranchPopOutKey', () => {
    it('creates composite key from workspaceId', () => {
        expect(gitReviewBranchPopOutKey('ws1')).toBe('ws1::branch-range');
    });
});

describe('gitReviewPrPopOutKey', () => {
    it('creates composite key from workspaceId and prId', () => {
        expect(gitReviewPrPopOutKey('ws1', '42')).toBe('ws1::pr::42');
    });

    it('includes the full prId string', () => {
        expect(gitReviewPrPopOutKey('ws2', 'some-pr-id')).toBe('ws2::pr::some-pr-id');
    });
});

describe('GitReviewPopOut constants', () => {
    it('exports a distinct BroadcastChannel name', () => {
        expect(GIT_REVIEW_POPOUT_CHANNEL).toBe('coc-git-review-popout');
    });

    it('exports a distinct localStorage key', () => {
        expect(GIT_REVIEW_POPOUT_LS_KEY).toBe('coc-git-review-popout-msg');
    });
});
