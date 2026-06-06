/**
 * Tests for BranchRangeOverview standalone component.
 *
 * Validates that BranchRangeOverview.tsx contains the range-mode props,
 * resize behavior, rendering patterns, data-testid attributes, and
 * RepoGitTab integration.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

const COMPONENT_PATH = path.join(
    __dirname, '..', '..', '..', 'src', 'server', 'spa', 'client', 'react', 'features', 'git', 'branches', 'BranchRangeOverview.tsx'
);

const REPO_GIT_TAB_PATH = path.join(
    __dirname, '..', '..', '..', 'src', 'server', 'spa', 'client', 'react', 'features', 'git', 'RepoGitTab.tsx'
);

describe('BranchRangeOverview', () => {
    let source: string;

    beforeAll(() => {
        source = fs.readFileSync(COMPONENT_PATH, 'utf-8');
    });

    describe('BranchRangeOverview.tsx exists', () => {
        it('BranchRangeOverview.tsx exists as a standalone file', () => {
            expect(fs.existsSync(COMPONENT_PATH)).toBe(true);
        });
    });

    describe('imports', () => {
        it('imports BranchCommitStrip', () => {
            expect(source).toContain("BranchCommitStrip");
        });

        it('imports BranchAllFilesDiff', () => {
            expect(source).toContain("BranchAllFilesDiff");
        });

        it('imports GitCommitItem type', () => {
            expect(source).toContain("GitCommitItem");
        });

        it('imports BranchRangeInfo type', () => {
            expect(source).toContain("BranchRangeInfo");
        });

        it('imports BranchRangeFile type', () => {
            expect(source).toContain("BranchRangeFile");
        });

        it('does not import UnifiedDiffViewer for focused file mode', () => {
            expect(source).not.toContain("UnifiedDiffViewer");
        });

        it('does not import Spinner for focused file loading state', () => {
            expect(source).not.toContain("Spinner");
        });

        it('imports shared range pointer context helpers', () => {
            expect(source).toContain('createGitRangeContextDragPayload');
            expect(source).toContain('isSessionContextAttachmentsEnabled');
        });
    });

    describe('component signature — range props', () => {
        it('accepts required range prop', () => {
            expect(source).toContain('range: BranchRangeInfo');
            // Ensure it is NOT optional
            expect(source).not.toContain('range?: BranchRangeInfo');
        });

        it('accepts optional commits prop', () => {
            expect(source).toContain('commits?: GitCommitItem[]');
        });

        it('accepts optional unpushedCount prop', () => {
            expect(source).toContain('unpushedCount?: number');
        });

        it('accepts optional files prop', () => {
            expect(source).toContain('files?: BranchRangeFile[]');
        });

        it('accepts optional onFileSelect callback', () => {
            expect(source).toContain('onFileSelect?: (filePath: string) => void');
        });

        it('accepts optional onAllCommentsClick callback', () => {
            expect(source).toContain('onAllCommentsClick?: () => void');
        });
    });

    describe('resize behavior', () => {
        it('persists upper panel height to localStorage', () => {
            expect(source).toContain("'coc.branchRangeOverview.upperHeight'");
        });

        it('loads initial height from localStorage', () => {
            expect(source).toContain('loadUpperHeight');
        });

        it('enforces minimum upper height', () => {
            expect(source).toContain('MIN_UPPER_HEIGHT');
        });

        it('has default upper height of 160px', () => {
            expect(source).toContain('DEFAULT_UPPER_HEIGHT = 160');
        });

        it('enforces 80px minimum upper height', () => {
            expect(source).toContain('MIN_UPPER_HEIGHT = 80');
        });
    });

    describe('overview-only responsibility', () => {
        it('does not accept focused-file props', () => {
            expect(source).not.toContain('focusedFilePath?: string | null');
            expect(source).not.toContain('onClearFocus?: () => void');
        });

        it('does not render focused-file breadcrumb controls', () => {
            expect(source).not.toContain('data-testid="focused-file-breadcrumb"');
            expect(source).not.toContain('data-testid="focused-file-back-btn"');
            expect(source).not.toContain('data-testid="focused-file-path"');
        });

        it('does not contain duplicate focused branch file diff component', () => {
            expect(source).not.toContain('function FocusedBranchFileDiff');
            expect(source).not.toContain('<FocusedBranchFileDiff');
            expect(source).not.toContain('/git/branch-range/files/');
        });

        it('always renders BranchAllFilesDiff in the lower panel', () => {
            expect(source).toContain('<BranchAllFilesDiff');
            expect(source).not.toContain('focusedFilePath ?');
        });
    });

    describe('rendering', () => {
        it('renders upper panel with data-testid', () => {
            expect(source).toContain('data-testid="branch-range-overview-upper"');
        });

        it('renders draggable divider with data-testid', () => {
            expect(source).toContain('data-testid="branch-range-overview-divider"');
        });

        it('renders lower panel with data-testid', () => {
            expect(source).toContain('data-testid="branch-range-overview-lower"');
        });

        it('uses cursor-row-resize on the divider', () => {
            expect(source).toContain('cursor-row-resize');
        });

        it('slices commits to unpushed range for BranchCommitStrip', () => {
            expect(source).toMatch(/slice\(0,\s*unpushedCount/);
        });

        it('passes the range pointer payload into BranchCommitStrip', () => {
            expect(source).toContain('sessionContextPayload={sessionContextPayload}');
        });
    });
});

describe('RepoGitTab — BranchRangeOverview integration', () => {
    let source: string;

    beforeAll(() => {
        source = fs.readFileSync(REPO_GIT_TAB_PATH, 'utf-8');
    });

    it('imports BranchRangeOverview', () => {
        expect(source).toContain("import { BranchRangeOverview }");
    });

    it('renders BranchRangeOverview for branch-range view type', () => {
        expect(source).toContain("rightPanelView?.type === 'branch-range'");
        expect(source).toContain('<BranchRangeOverview');
    });

    it('does NOT render CommitDetail for branch-range view type', () => {
        // CommitDetail is still used for commit view, but not branch-range
        const branchRangeSection = source.slice(
            source.indexOf("rightPanelView?.type === 'branch-range'"),
            source.indexOf("rightPanelView?.type === 'branch-file'")
        );
        expect(branchRangeSection).not.toContain('<CommitDetail');
    });

    it('passes range prop to BranchRangeOverview', () => {
        expect(source).toContain('range={branchRangeData!}');
    });

    it('passes unpushedCount to BranchRangeOverview', () => {
        expect(source).toContain('unpushedCount={unpushedCount}');
    });

    it('passes onFileSelect to BranchRangeOverview that navigates to branch-file', () => {
        expect(source).toContain("type: 'branch-file', filePath");
    });

    it('includes branch-range in RightPanelView union', () => {
        expect(source).toContain("| { type: 'branch-range' }");
    });

    it('defaults to empty right panel (no auto-selection on initial load)', () => {
        expect(source).toContain("setRightPanelView(null)");
        expect(source).not.toContain("rangeInfo && rangeInfo.commitCount > 0");
    });

    it('passes onBranchRangeSelect to BranchChanges', () => {
        expect(source).toContain('onBranchRangeSelect=');
    });

    it('preserves branch-range view during refresh', () => {
        expect(source).toMatch(/branch-range.*working-tree-file|working-tree-file.*branch-range/);
    });

    it('passes onAskAI to BranchRangeOverview in branch-range view', () => {
        expect(source).toContain('onAskAI=');
    });

    it('passes onQueueTask to BranchRangeOverview in branch-range view', () => {
        expect(source).toContain('onQueueTask=');
    });
});
