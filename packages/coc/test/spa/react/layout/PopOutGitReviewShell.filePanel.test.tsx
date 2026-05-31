/**
 * Tests for PopOutGitReviewShell — file panel integration and structure.
 */

import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

const LAYOUT_DIR = path.join(
    __dirname, '..', '..', '..', '..', 'src', 'server', 'spa', 'client', 'react', 'layout'
);
const SOURCE = fs.readFileSync(path.join(LAYOUT_DIR, 'PopOutGitReviewShell.tsx'), 'utf-8');

describe('PopOutGitReviewShell: file panel integration', () => {
    it('imports PopOutFilePanel', () => {
        expect(SOURCE).toContain("PopOutFilePanel");
    });

    it('imports parseDiffFileList', () => {
        expect(SOURCE).toContain("parseDiffFileList");
    });

    it('imports useCachedDiff for commit diff fetching', () => {
        expect(SOURCE).toContain("useCachedDiff");
    });

    it('imports FileDiffPanel for selected-file review', () => {
        expect(SOURCE).toContain("FileDiffPanel");
    });

    it('imports diff source factories for selected-file review', () => {
        expect(SOURCE).toContain("createCommitDiffSource");
        expect(SOURCE).toContain("createBranchRangeDiffSource");
    });

    it('imports useFileCommentCounts for comment badges', () => {
        expect(SOURCE).toContain("useFileCommentCounts");
    });

    it('imports computeDiffCommentKey for mapping storage keys to file paths', () => {
        expect(SOURCE).toContain("computeDiffCommentKey");
    });

    it('renders PopOutFilePanel in commit review content', () => {
        expect(SOURCE).toContain('<PopOutFilePanel');
    });

    it('passes isPopOut to CommitDetail', () => {
        // The isPopOut prop should be passed as a boolean (no value = true)
        expect(SOURCE).toMatch(/CommitDetail[\s\S]*?isPopOut/);
    });

    it('passes isPopOut to BranchRangeOverview', () => {
        expect(SOURCE).toMatch(/BranchRangeOverview[\s\S]*?isPopOut/);
    });

    it('renders FileDiffPanel for selected file, placeholder for commit overview', () => {
        const commitSection = SOURCE.slice(
            SOURCE.indexOf('function CommitReviewContent'),
            SOURCE.indexOf('// ── Branch range review content'),
        );
        expect(commitSection).toMatch(/selectedFilePath \? \(/);
        expect(commitSection).toMatch(/selectedFilePath \? \(\s*<FileDiffPanel/);
        expect(commitSection).toContain('Select a file to view its diff');
    });

    it('renders FileDiffPanel for selected commit files', () => {
        const commitSection = SOURCE.slice(
            SOURCE.indexOf('function CommitReviewContent'),
            SOURCE.indexOf('// ── Branch range review content'),
        );
        expect(commitSection).toMatch(/selectedFilePath \? \(\s*<FileDiffPanel/);
        expect(commitSection).toContain('createCommitDiffSource(workspaceId, commitHash');
        expect(commitSection).toContain('onBack={handleBack}');
    });

    it('renders BranchRangeOverview only for branch overview', () => {
        const branchSection = SOURCE.slice(
            SOURCE.indexOf('function BranchRangeReviewContent'),
            SOURCE.indexOf('// ── Inner content'),
        );
        expect(branchSection).toMatch(/selectedFilePath \? \(/);
        expect(branchSection).toMatch(/: \(\s*<BranchRangeOverview/);
        expect(branchSection).toMatch(/<BranchRangeOverview[\s\S]*?isPopOut/);
    });

    it('renders FileDiffPanel for selected branch-range files', () => {
        const branchSection = SOURCE.slice(
            SOURCE.indexOf('function BranchRangeReviewContent'),
            SOURCE.indexOf('// ── Inner content'),
        );
        expect(branchSection).toMatch(/selectedFilePath \? \(\s*<FileDiffPanel/);
        expect(branchSection).toContain('createBranchRangeDiffSource(workspaceId');
        expect(branchSection).toContain('onBack={handleBack}');
    });

    it('does not pass focused-file props into overview components', () => {
        expect(SOURCE).not.toContain('focusedFilePath=');
        expect(SOURCE).not.toContain('onClearFocus=');
    });

    it('uses toggle-deselect handler for file selection', () => {
        expect(SOURCE).toContain('prev === filePath ? null : filePath');
    });

    it('has selectedFilePath state in CommitReviewContent', () => {
        expect(SOURCE).toContain('selectedFilePath');
        expect(SOURCE).toContain('setSelectedFilePath');
    });

    it('has selectedFilePath state in BranchRangeReviewContent', () => {
        // Both content components use selectedFilePath
        const matches = SOURCE.match(/useState<string \| null>\(null\)/g);
        expect(matches).not.toBeNull();
        expect(matches!.length).toBeGreaterThanOrEqual(2);
    });

    it('converts BranchRangeFile to FileChange for file panel', () => {
        expect(SOURCE).toContain('fileChanges');
    });

    it('uses flex layout for content with file panel', () => {
        expect(SOURCE).toContain('flex flex-1 min-h-0');
    });
});

describe('PopOutGitReviewShell: comment count mapping', () => {
    it('maps comment storage keys to file paths for commit mode', () => {
        expect(SOURCE).toContain('computeDiffCommentKey');
        expect(SOURCE).toContain("fileCommentMap");
    });

    it('uses branch-base/branch-head refs for branch-range mode', () => {
        expect(SOURCE).toContain("'branch-base'");
        expect(SOURCE).toContain("'branch-head'");
    });
});

describe('PopOutGitReviewShell: PR source label suppression', () => {
    it('passes showSourceLabel={false} to FileDiffPanel in PR review', () => {
        const prSection = SOURCE.slice(
            SOURCE.indexOf('function PrReviewContent'),
        );
        expect(prSection).toContain('showSourceLabel={false}');
    });
});
