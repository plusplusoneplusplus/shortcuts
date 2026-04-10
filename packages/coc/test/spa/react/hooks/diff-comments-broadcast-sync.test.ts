/**
 * Tests for BroadcastChannel sync in diff comment hooks.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

const HOOKS_DIR = path.join(
    __dirname, '..', '..', '..', '..', 'src', 'server', 'spa', 'client', 'react', 'hooks'
);

describe('useDiffComments: BroadcastChannel sync', () => {
    let source: string;

    beforeAll(() => {
        source = fs.readFileSync(path.join(HOOKS_DIR, 'useDiffComments.ts'), 'utf-8');
    });

    it('imports GIT_REVIEW_POPOUT_CHANNEL', () => {
        expect(source).toContain('GIT_REVIEW_POPOUT_CHANNEL');
    });

    it('imports GitReviewPopOutMessage type', () => {
        expect(source).toContain('GitReviewPopOutMessage');
    });

    it('creates a BroadcastChannel for git-review-comments-updated', () => {
        expect(source).toContain('new BroadcastChannel(GIT_REVIEW_POPOUT_CHANNEL)');
    });

    it('listens for git-review-comments-updated message', () => {
        expect(source).toContain("'git-review-comments-updated'");
    });

    it('calls fetchComments when comments-updated is received', () => {
        expect(source).toContain('void fetchComments()');
    });
});

describe('useAllCommitComments: BroadcastChannel sync', () => {
    let source: string;

    beforeAll(() => {
        source = fs.readFileSync(path.join(HOOKS_DIR, 'useAllCommitComments.ts'), 'utf-8');
    });

    it('imports GIT_REVIEW_POPOUT_CHANNEL', () => {
        expect(source).toContain('GIT_REVIEW_POPOUT_CHANNEL');
    });

    it('imports GitReviewPopOutMessage type', () => {
        expect(source).toContain('GitReviewPopOutMessage');
    });

    it('creates a BroadcastChannel for git-review-comments-updated', () => {
        expect(source).toContain('new BroadcastChannel(GIT_REVIEW_POPOUT_CHANNEL)');
    });

    it('listens for git-review-comments-updated message', () => {
        expect(source).toContain("'git-review-comments-updated'");
    });

    it('calls fetchComments when comments-updated is received', () => {
        expect(source).toContain('void fetchComments()');
    });
});
