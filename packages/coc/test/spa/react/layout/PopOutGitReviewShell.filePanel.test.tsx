/**
 * Tests for PopOutGitReviewShell — file panel integration and structure.
 */

import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

const LAYOUT_DIR = path.join(
    __dirname, '..', '..', '..', '..', 'src', 'server', 'spa', 'client', 'react', 'layout'
);
const KERNEL_DIR = path.join(LAYOUT_DIR, 'popoutGitReview');

function kernelSource(file: string): string {
    return fs.readFileSync(path.join(KERNEL_DIR, file), 'utf-8');
}

const COMMIT_SOURCE = kernelSource('CommitReviewContent.tsx');
const PR_SOURCE = kernelSource('PrReviewContent.tsx');
const BRANCH_SOURCE = kernelSource('BranchRangeReviewContent.tsx');
const LAYOUT_SOURCE = kernelSource('PopOutReviewLayout.tsx');
const MODEL_SOURCE = kernelSource('usePopOutReviewModel.ts');
const COMMENT_MAP_SOURCE = kernelSource('useFileCommentMap.ts');
/** Every adapter plus the shared kernel, for "somewhere in the flow" assertions. */
const SOURCE = [COMMIT_SOURCE, PR_SOURCE, BRANCH_SOURCE, LAYOUT_SOURCE, MODEL_SOURCE, COMMENT_MAP_SOURCE].join('\n');

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

    it('renders PopOutFilePanel from the shared review layout', () => {
        expect(LAYOUT_SOURCE).toContain('<PopOutFilePanel');
        // Adapters configure the layout instead of rendering the rail themselves.
        expect(COMMIT_SOURCE).toContain('<PopOutReviewLayout');
        expect(PR_SOURCE).toContain('<PopOutReviewLayout');
        expect(BRANCH_SOURCE).toContain('<PopOutReviewLayout');
    });

    it('passes isPopOut to BranchRangeOverview', () => {
        expect(BRANCH_SOURCE).toMatch(/BranchRangeOverview[\s\S]*?isPopOut/);
    });

    it('switches between the diff surface and the overview in one place', () => {
        expect(LAYOUT_SOURCE).toContain('model.selectedFilePath ? renderDiff(model.selectedFilePath) : overview');
    });

    it('renders FileDiffPanel for selected file, placeholder for commit overview', () => {
        expect(COMMIT_SOURCE).toMatch(/renderDiff=\{filePath => \(\s*<FileDiffPanel/);
        expect(COMMIT_SOURCE).toContain('Select a file to view its diff');
    });

    it('renders FileDiffPanel for selected commit files', () => {
        expect(COMMIT_SOURCE).toContain('createCommitDiffSource(workspaceId, commitHash');
        expect(COMMIT_SOURCE).toContain('popOutDiffPanelProps(model, filePath');
    });

    it('renders BranchRangeOverview only for branch overview', () => {
        expect(BRANCH_SOURCE).toMatch(/overview=\{\(\s*<BranchRangeOverview/);
        expect(BRANCH_SOURCE).toMatch(/<BranchRangeOverview[\s\S]*?isPopOut/);
    });

    it('renders FileDiffPanel for selected branch-range files', () => {
        expect(BRANCH_SOURCE).toMatch(/renderDiff=\{filePath => \(\s*<FileDiffPanel/);
        expect(BRANCH_SOURCE).toContain('createBranchRangeDiffSource(workspaceId');
        expect(BRANCH_SOURCE).toContain('popOutDiffPanelProps(model, filePath)');
    });

    it('shares the back handler and label across review types', () => {
        expect(MODEL_SOURCE).toContain('onBack: model.handleBack');
        expect(MODEL_SOURCE).toContain("backLabel: 'All files'");
    });

    it('does not pass focused-file props into overview components', () => {
        expect(SOURCE).not.toContain('focusedFilePath=');
        expect(SOURCE).not.toContain('onClearFocus=');
    });

    it('uses toggle-deselect handler for file selection', () => {
        expect(MODEL_SOURCE).toContain('prev === filePath ? null : filePath');
    });

    it('owns selectedFilePath state once, in the shared review model', () => {
        expect(MODEL_SOURCE).toContain('setSelectedFilePath');
        // No adapter keeps its own copy of the selection.
        for (const adapter of [COMMIT_SOURCE, PR_SOURCE, BRANCH_SOURCE]) {
            expect(adapter).not.toContain('setSelectedFilePath');
            expect(adapter).toContain('usePopOutReviewModel');
        }
    });

    it('converts BranchRangeFile to FileChange for file panel', () => {
        expect(BRANCH_SOURCE).toContain('fileChanges');
    });

    it('uses flex layout for content with file panel', () => {
        expect(LAYOUT_SOURCE).toContain('flex flex-1 min-h-0');
    });
});

describe('PopOutGitReviewShell: comment count mapping', () => {
    it('maps comment storage keys to file paths in one shared hook', () => {
        expect(COMMENT_MAP_SOURCE).toContain('computeDiffCommentKey');
        expect(COMMENT_MAP_SOURCE).toContain('fileCommentMap');
        for (const adapter of [COMMIT_SOURCE, BRANCH_SOURCE]) {
            expect(adapter).toContain('useFileCommentMap(workspaceId');
            expect(adapter).not.toContain('computeDiffCommentKey');
        }
    });

    it('uses parent/commit refs for commit mode', () => {
        expect(COMMIT_SOURCE).toContain('`${commitHash}^`');
    });

    it('uses branch-base/branch-head refs for branch-range mode', () => {
        expect(BRANCH_SOURCE).toContain("'branch-base'");
        expect(BRANCH_SOURCE).toContain("'branch-head'");
    });
});

describe('PopOutGitReviewShell: PR source label suppression', () => {
    it('passes showSourceLabel={false} to FileDiffPanel in PR review', () => {
        expect(PR_SOURCE).toContain('showSourceLabel={false}');
    });
});

describe('PopOutGitReviewShell: PR file list statuses', () => {
    it('builds the PR file list with parseDiffFileList so real statuses survive', () => {
        expect(PR_SOURCE).toContain('setFileList(parseDiffFileList(diffText))');
    });

    it('no longer hardcodes every PR file to modified', () => {
        expect(SOURCE).not.toContain("status: 'modified'");
        expect(SOURCE).not.toContain('extractFileStatsFromDiff');
    });
});
