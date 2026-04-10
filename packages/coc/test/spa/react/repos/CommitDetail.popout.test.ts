/**
 * Tests for git review pop-out button in CommitDetail.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

const COMPONENT_PATH = path.join(
    __dirname, '..', '..', '..', '..', 'src', 'server', 'spa', 'client', 'react', 'repos', 'CommitDetail.tsx'
);

describe('CommitDetail: pop-out button', () => {
    let source: string;

    beforeAll(() => {
        source = fs.readFileSync(COMPONENT_PATH, 'utf-8');
    });

    it('accepts isPopOut prop', () => {
        expect(source).toContain('isPopOut?: boolean');
    });

    it('imports useGitReviewPopOut', () => {
        expect(source).toContain('useGitReviewPopOut');
    });

    it('imports gitReviewPopOutKey', () => {
        expect(source).toContain('gitReviewPopOutKey');
    });

    it('imports buildGitReviewPopOutUrl', () => {
        expect(source).toContain('buildGitReviewPopOutUrl');
    });

    it('has a pop-out button with data-testid', () => {
        expect(source).toContain('data-testid="commit-popout-btn"');
    });

    it('hides pop-out button when isPopOut is true', () => {
        expect(source).toContain('!isPopOut');
    });

    it('calls window.open for pop-out', () => {
        expect(source).toContain('window.open(url');
    });

    it('marks review as popped out after window.open', () => {
        expect(source).toContain('markPoppedOut(gitReviewPopOutKey');
    });

    it('uses named window to prevent duplicate pop-outs', () => {
        expect(source).toContain('coc-git-review-');
    });
});
