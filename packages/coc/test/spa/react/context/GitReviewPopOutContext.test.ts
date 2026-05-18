/**
 * Tests for GitReviewPopOutContext.
 */

import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import {
    gitReviewPopOutKey,
    gitReviewBranchPopOutKey,
    gitReviewPrPopOutKey,
    GIT_REVIEW_POPOUT_CHANNEL,
    GIT_REVIEW_POPOUT_LS_KEY,
} from '../../../../src/server/spa/client/react/contexts/GitReviewPopOutContext';

const CONTEXT_DIR = path.join(
    __dirname, '..', '..', '..', '..', 'src', 'server', 'spa', 'client', 'react', 'contexts'
);
const SOURCE = fs.readFileSync(path.join(CONTEXT_DIR, 'GitReviewPopOutContext.tsx'), 'utf-8');

// ── Key builders ──────────────────────────────────────────────────────────────

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

// ── Constants ─────────────────────────────────────────────────────────────────

describe('GitReviewPopOut constants', () => {
    it('exports a distinct BroadcastChannel name', () => {
        expect(GIT_REVIEW_POPOUT_CHANNEL).toBe('coc-git-review-popout');
    });

    it('exports a distinct localStorage key', () => {
        expect(GIT_REVIEW_POPOUT_LS_KEY).toBe('coc-git-review-popout-msg');
    });
});

// ── Source structure tests ─────────────────────────────────────────────────────

describe('GitReviewPopOutContext: structure', () => {
    it('exports GitReviewPopOutProvider', () => {
        expect(SOURCE).toContain('export function GitReviewPopOutProvider');
    });

    it('exports useGitReviewPopOut hook', () => {
        expect(SOURCE).toContain('export function useGitReviewPopOut');
    });

    it('exports useGitReviewPopOutChannel hook', () => {
        expect(SOURCE).toContain('export function useGitReviewPopOutChannel');
    });

    it('exports GitReviewPopOutContextValue interface', () => {
        expect(SOURCE).toContain('export interface GitReviewPopOutContextValue');
    });

    it('exports GitReviewPopOutMessage type', () => {
        expect(SOURCE).toContain('export type GitReviewPopOutMessage');
    });
});

describe('GitReviewPopOutContext: message types', () => {
    it('defines git-review-popout-opened message', () => {
        expect(SOURCE).toContain("'git-review-popout-opened'");
    });

    it('defines git-review-popout-closed message', () => {
        expect(SOURCE).toContain("'git-review-popout-closed'");
    });

    it('defines git-review-popout-restore message', () => {
        expect(SOURCE).toContain("'git-review-popout-restore'");
    });

    it('defines git-review-comments-updated message', () => {
        expect(SOURCE).toContain("'git-review-comments-updated'");
    });
});

describe('GitReviewPopOutContext: state management', () => {
    it('tracks poppedOutReviews as a Set', () => {
        expect(SOURCE).toContain('poppedOutReviews: Set<string>');
    });

    it('has markPoppedOut method', () => {
        expect(SOURCE).toContain('markPoppedOut');
    });

    it('has markRestored method', () => {
        expect(SOURCE).toContain('markRestored');
    });

    it('has postMessage method', () => {
        expect(SOURCE).toContain('postMessage');
    });
});

describe('GitReviewPopOutContext: BroadcastChannel', () => {
    it('uses BroadcastChannel', () => {
        expect(SOURCE).toContain('new BroadcastChannel(GIT_REVIEW_POPOUT_CHANNEL)');
    });

    it('has localStorage fallback', () => {
        expect(SOURCE).toContain('localStorage.setItem(GIT_REVIEW_POPOUT_LS_KEY');
    });

    it('listens for popout-closed to auto-restore', () => {
        expect(SOURCE).toContain("msg.type === 'git-review-popout-closed'");
    });

    it('sends popout-restore message on markRestored', () => {
        expect(SOURCE).toContain("postMessage({ type: 'git-review-popout-restore'");
    });
});
