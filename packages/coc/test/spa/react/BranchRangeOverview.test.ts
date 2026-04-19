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
    __dirname, '..', '..', '..', 'src', 'server', 'spa', 'client', 'react', 'repos', 'BranchRangeOverview.tsx'
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

        it('imports UnifiedDiffViewer for focused file mode', () => {
            expect(source).toContain("UnifiedDiffViewer");
        });

        it('imports Spinner for focused file loading state', () => {
            expect(source).toContain("Spinner");
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

    describe('focused-file mode', () => {
        it('accepts optional focusedFilePath prop', () => {
            expect(source).toContain('focusedFilePath?: string | null');
        });

        it('accepts optional onClearFocus prop', () => {
            expect(source).toContain('onClearFocus?: () => void');
        });

        it('has focused-file breadcrumb bar', () => {
            expect(source).toContain('data-testid="focused-file-breadcrumb"');
        });

        it('has back button to clear focus', () => {
            expect(source).toContain('data-testid="focused-file-back-btn"');
            expect(source).toContain('← All files');
        });

        it('displays focused file path', () => {
            expect(source).toContain('data-testid="focused-file-path"');
        });

        it('has FocusedBranchFileDiff component', () => {
            expect(source).toContain('function FocusedBranchFileDiff');
        });

        it('fetches per-file diff for branch range', () => {
            expect(source).toContain('/git/branch-range/files/');
        });

        it('conditionally renders FocusedBranchFileDiff or BranchAllFilesDiff', () => {
            expect(source).toContain('focusedFilePath ?');
            expect(source).toContain('<FocusedBranchFileDiff');
        });

        it('passes fileName and showLineNumbers to UnifiedDiffViewer in FocusedBranchFileDiff', () => {
            const focusedFn = source.slice(
                source.indexOf('function FocusedBranchFileDiff'),
                source.indexOf('export function BranchRangeOverview')
            );
            expect(focusedFn).toContain('fileName={filePath}');
            expect(focusedFn).toContain('showLineNumbers');
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

