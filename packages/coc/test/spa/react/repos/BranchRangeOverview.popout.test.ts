/**
 * Tests for git review pop-out button in BranchRangeOverview.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

const COMPONENT_PATH = path.join(
    __dirname, '..', '..', '..', '..', 'src', 'server', 'spa', 'client', 'react', 'repos', 'BranchRangeOverview.tsx'
);

describe('BranchRangeOverview: pop-out button', () => {
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

    it('imports gitReviewBranchPopOutKey', () => {
        expect(source).toContain('gitReviewBranchPopOutKey');
    });

    it('imports buildGitBranchRangePopOutUrl', () => {
        expect(source).toContain('buildGitBranchRangePopOutUrl');
    });

    it('has a pop-out button with data-testid', () => {
        expect(source).toContain('data-testid="branch-range-popout-btn"');
    });

    it('hides pop-out button when isPopOut is true', () => {
        expect(source).toContain('!isPopOut');
    });

    it('calls window.open for pop-out', () => {
        expect(source).toContain('window.open(url');
    });

    it('marks review as popped out after window.open', () => {
        expect(source).toContain('markPoppedOut(gitReviewBranchPopOutKey');
    });
});
