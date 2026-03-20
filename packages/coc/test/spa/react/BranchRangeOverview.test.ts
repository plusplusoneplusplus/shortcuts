/**
 * Tests for branch-range mode in CommitDetail (formerly BranchRangeOverview).
 *
 * Validates that CommitDetail contains the range-mode props, resize behavior,
 * rendering patterns, data-testid attributes, and RepoGitTab integration
 * after the BranchRangeOverview → CommitDetail merge.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

const COMPONENT_PATH = path.join(
    __dirname, '..', '..', '..', 'src', 'server', 'spa', 'client', 'react', 'repos', 'CommitDetail.tsx'
);

const REPO_GIT_TAB_PATH = path.join(
    __dirname, '..', '..', '..', 'src', 'server', 'spa', 'client', 'react', 'repos', 'RepoGitTab.tsx'
);

const OLD_COMPONENT_PATH = path.join(
    __dirname, '..', '..', '..', 'src', 'server', 'spa', 'client', 'react', 'repos', 'BranchRangeOverview.tsx'
);

describe('CommitDetail — range mode (merged from BranchRangeOverview)', () => {
    let source: string;

    beforeAll(() => {
        source = fs.readFileSync(COMPONENT_PATH, 'utf-8');
    });

    describe('BranchRangeOverview is deleted', () => {
        it('BranchRangeOverview.tsx no longer exists', () => {
            expect(fs.existsSync(OLD_COMPONENT_PATH)).toBe(false);
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
    });

    describe('component signature — range props', () => {
        it('accepts optional range prop', () => {
            expect(source).toContain('range?: BranchRangeInfo');
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
    });
});

describe('RepoGitTab — CommitDetail range-mode integration', () => {
    let source: string;

    beforeAll(() => {
        source = fs.readFileSync(REPO_GIT_TAB_PATH, 'utf-8');
    });

    it('does NOT import BranchRangeOverview (deleted)', () => {
        expect(source).not.toContain("import { BranchRangeOverview }");
    });

    it('renders CommitDetail for branch-range view type', () => {
        expect(source).toContain("rightPanelView?.type === 'branch-range'");
        expect(source).toContain('<CommitDetail');
    });

    it('passes range prop (not branchRangeData) to CommitDetail', () => {
        expect(source).toContain('range={branchRangeData!}');
    });

    it('passes unpushedCount to CommitDetail', () => {
        expect(source).toContain('unpushedCount={unpushedCount}');
    });

    it('passes onFileSelect to CommitDetail that navigates to branch-file', () => {
        expect(source).toContain("type: 'branch-file', filePath");
    });

    it('includes branch-range in RightPanelView union', () => {
        expect(source).toContain("| { type: 'branch-range' }");
    });

    it('sets branch-range as default view when branch range has commits on desktop', () => {
        expect(source).toContain("type: 'branch-range'");
        expect(source).toContain("rangeInfo && rangeInfo.commitCount > 0");
    });

    it('passes onBranchRangeSelect to BranchChanges', () => {
        expect(source).toContain('onBranchRangeSelect=');
    });

    it('preserves branch-range view during refresh', () => {
        expect(source).toMatch(/branch-range.*working-tree-file|working-tree-file.*branch-range/);
    });
});
