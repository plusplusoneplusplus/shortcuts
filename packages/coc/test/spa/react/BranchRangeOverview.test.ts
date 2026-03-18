/**
 * Tests for BranchRangeOverview component source structure.
 *
 * Validates exports, props, resize behavior, rendering patterns,
 * and data-testid attributes.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

const COMPONENT_PATH = path.join(
    __dirname, '..', '..', '..', 'src', 'server', 'spa', 'client', 'react', 'repos', 'BranchRangeOverview.tsx'
);

const REPO_GIT_TAB_PATH = path.join(
    __dirname, '..', '..', '..', 'src', 'server', 'spa', 'client', 'react', 'repos', 'RepoGitTab.tsx'
);

describe('BranchRangeOverview', () => {
    let source: string;

    beforeAll(() => {
        source = fs.readFileSync(COMPONENT_PATH, 'utf-8');
    });

    describe('file existence', () => {
        it('exists at expected path', () => {
            expect(fs.existsSync(COMPONENT_PATH)).toBe(true);
        });
    });

    describe('exports', () => {
        it('exports BranchRangeOverview as a named export', () => {
            expect(source).toContain('export function BranchRangeOverview');
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

    describe('component signature', () => {
        it('accepts workspaceId prop', () => {
            expect(source).toContain('workspaceId: string');
        });

        it('accepts branchRangeData prop', () => {
            expect(source).toContain('branchRangeData: BranchRangeInfo');
        });

        it('accepts commits prop', () => {
            expect(source).toContain('commits: GitCommitItem[]');
        });

        it('accepts unpushedCount prop', () => {
            expect(source).toContain('unpushedCount: number');
        });

        it('accepts files prop', () => {
            expect(source).toContain('files: BranchRangeFile[]');
        });

        it('accepts onFileSelect callback', () => {
            expect(source).toContain('onFileSelect: (filePath: string) => void');
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
        it('renders outer container with data-testid', () => {
            expect(source).toContain('data-testid="branch-range-overview"');
        });

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
            expect(source).toContain('commits.slice(0, unpushedCount)');
        });
    });
});

describe('RepoGitTab — BranchRangeOverview integration', () => {
    let source: string;

    beforeAll(() => {
        source = fs.readFileSync(REPO_GIT_TAB_PATH, 'utf-8');
    });

    it('imports BranchRangeOverview', () => {
        expect(source).toContain("import { BranchRangeOverview } from './BranchRangeOverview'");
    });

    it('includes branch-range in RightPanelView union', () => {
        expect(source).toContain("| { type: 'branch-range' }");
    });

    it('renders BranchRangeOverview for branch-range view type', () => {
        expect(source).toContain("rightPanelView?.type === 'branch-range'");
        expect(source).toContain('<BranchRangeOverview');
    });

    it('passes unpushedCount (not sliced array) to BranchRangeOverview from RepoGitTab', () => {
        expect(source).toContain('unpushedCount={unpushedCount}');
        // RepoGitTab itself must not slice — slicing is delegated to BranchRangeOverview
        expect(source).not.toContain('commits.slice(0, unpushedCount)');
    });

    it('passes onFileSelect to BranchRangeOverview that navigates to branch-file', () => {
        expect(source).toContain("type: 'branch-file', filePath");
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
