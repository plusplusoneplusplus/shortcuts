/**
 * Tests for BranchChanges component source structure.
 *
 * Validates exports, props (including lifted branchRangeData), API usage
 * for file fetches, state management, rendering, status mappings,
 * error handling, and data-testid attributes.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

const COMPONENT_PATH = path.join(
    __dirname, '..', '..', '..', 'src', 'server', 'spa', 'client', 'react', 'repos', 'BranchChanges.tsx'
);

const INDEX_PATH = path.join(
    __dirname, '..', '..', '..', 'src', 'server', 'spa', 'client', 'react', 'repos', 'index.ts'
);

const REPO_GIT_TAB_PATH = path.join(
    __dirname, '..', '..', '..', 'src', 'server', 'spa', 'client', 'react', 'repos', 'RepoGitTab.tsx'
);

describe('BranchChanges', () => {
    let source: string;

    beforeAll(() => {
        source = fs.readFileSync(COMPONENT_PATH, 'utf-8');
    });

    describe('exports', () => {
        it('is exported from repos/index.ts', () => {
            const indexSource = fs.readFileSync(INDEX_PATH, 'utf-8');
            expect(indexSource).toContain("export { BranchChanges }");
            expect(indexSource).toContain("from './BranchChanges'");
        });

        it('exports BranchChanges as a named export', () => {
            expect(source).toContain('export function BranchChanges');
        });

        it('exports BranchRangeInfo interface', () => {
            expect(source).toContain('export interface BranchRangeInfo');
        });
    });

    describe('component signature', () => {
        it('accepts workspaceId prop', () => {
            expect(source).toContain('workspaceId: string');
        });

        it('accepts optional branchRangeData prop', () => {
            expect(source).toContain('branchRangeData?: BranchRangeInfo | null');
        });

        it('accepts optional onDefaultBranch prop', () => {
            expect(source).toContain('onDefaultBranch?: boolean');
        });

        it('defines BranchChangesProps interface', () => {
            expect(source).toContain('interface BranchChangesProps');
        });
    });

    describe('internal types', () => {
        it('defines BranchRangeInfo interface with required fields', () => {
            expect(source).toContain('interface BranchRangeInfo');
            expect(source).toContain('baseRef: string');
            expect(source).toContain('headRef: string');
            expect(source).toContain('commitCount: number');
            expect(source).toContain('additions: number');
            expect(source).toContain('deletions: number');
        });

        it('defines BranchRangeFile interface', () => {
            expect(source).toContain('interface BranchRangeFile');
        });

        it('BranchRangeFile has path, status, additions, deletions, oldPath', () => {
            expect(source).toMatch(/interface BranchRangeFile[\s\S]*?path: string/);
            expect(source).toMatch(/interface BranchRangeFile[\s\S]*?status: string/);
            expect(source).toMatch(/interface BranchRangeFile[\s\S]*?oldPath\?: string/);
        });
    });

    describe('API integration', () => {
        it('imports fetchApi from hooks/useApi', () => {
            expect(source).toContain("import { fetchApi } from '../hooks/useApi'");
        });

        it('derives rangeInfo from branchRangeData prop (lifted to parent)', () => {
            expect(source).toContain('const rangeInfo = branchRangeData ?? null');
        });

        it('fetches from /git/branch-range/files endpoint for file list', () => {
            expect(source).toContain('/git/branch-range/files');
        });

        it('encodes workspaceId in fetch URL', () => {
            expect(source).toContain('encodeURIComponent(workspaceId)');
        });
    });

    describe('state management', () => {
        it('derives rangeInfo from branchRangeData prop', () => {
            expect(source).toContain('const rangeInfo = branchRangeData ?? null');
        });

        it('tracks files state', () => {
            expect(source).toContain('setFiles');
        });

        it('tracks filesLoading state', () => {
            expect(source).toContain('setFilesLoading');
        });

        it('tracks expanded state', () => {
            expect(source).toContain('setExpanded');
        });

        it('tracks filesError state', () => {
            expect(source).toContain('setFilesError');
        });

        it('resets file-level state when workspace or range data changes', () => {
            expect(source).toContain('[workspaceId, branchRangeData]');
        });
    });

    describe('default branch handling', () => {
        it('checks for onDefaultBranch prop', () => {
            expect(source).toContain('onDefaultBranch');
        });

        it('returns null when on default branch or no range info', () => {
            expect(source).toContain('if (onDefaultBranch || !rangeInfo) return null');
        });
    });

    describe('error handling', () => {
        it('shows inline error when file fetch fails', () => {
            expect(source).toContain('filesError');
            expect(source).toContain('data-testid="branch-changes-files-error"');
        });
    });

    describe('expand/collapse behavior', () => {
        it('starts collapsed (expanded defaults to false)', () => {
            expect(source).toContain('useState(false)');
        });

        it('toggles expanded state on click', () => {
            expect(source).toContain('setExpanded');
        });

        it('lazily fetches files on first expand', () => {
            // The useEffect for files depends on expanded state
            expect(source).toContain('expanded');
            expect(source).toContain('files.length');
        });

        it('shows expand/collapse indicators', () => {
            expect(source).toContain('▼');
            expect(source).toContain('▶');
        });
    });

    describe('status mappings', () => {
        it('maps full word statuses to single chars', () => {
            expect(source).toContain("added: 'A'");
            expect(source).toContain("modified: 'M'");
            expect(source).toContain("deleted: 'D'");
            expect(source).toContain("renamed: 'R'");
            expect(source).toContain("copied: 'C'");
        });

        it('has status colors matching CommitDetail palette', () => {
            expect(source).toContain("added:    'text-[#16825d]'");
            expect(source).toContain("modified: 'text-[#0078d4]'");
            expect(source).toContain("deleted:  'text-[#d32f2f]'");
        });

        it('has purple color for renamed files', () => {
            expect(source).toContain("renamed:  'text-[#9c27b0]'");
        });

        it('has status labels for tooltips', () => {
            expect(source).toContain("added: 'Added'");
            expect(source).toContain("modified: 'Modified'");
            expect(source).toContain("deleted: 'Deleted'");
            expect(source).toContain("renamed: 'Renamed'");
            expect(source).toContain("copied: 'Copied'");
        });
    });

    describe('rendering — collapsed state', () => {
        it('shows branch name in header', () => {
            expect(source).toContain('branchLabel');
            expect(source).toContain('Branch Changes:');
        });

        it('shows commit count ahead of base', () => {
            expect(source).toContain('rangeInfo.commitCount');
            expect(source).toContain('ahead of');
        });

        it('shows additions and deletions in summary', () => {
            expect(source).toContain('+{rangeInfo.additions}');
            expect(source).toContain('−{rangeInfo.deletions}');
        });

        it('shows file count in summary', () => {
            expect(source).toContain('rangeInfo.fileCount');
        });

        it('extracts short base ref name', () => {
            expect(source).toContain("baseRef.replace(/^origin\\//, '')");
        });

        it('uses header styling matching CommitList', () => {
            expect(source).toContain('text-xs font-semibold uppercase tracking-wide');
            expect(source).toContain('bg-[#f5f5f5] dark:bg-[#252526]');
        });
    });

    describe('rendering — expanded state', () => {
        it('renders file path', () => {
            expect(source).toContain('file.path');
        });

        it('renders file additions and deletions', () => {
            expect(source).toContain('+{file.additions}');
            expect(source).toContain('−{file.deletions}');
        });

        it('renders renamed files with old → new path', () => {
            expect(source).toContain('file.oldPath');
            expect(source).toContain('→');
        });

        it('imports Spinner from shared', () => {
            expect(source).toContain("import { Spinner } from '../shared'");
        });

        it('shows loading spinner during file fetch', () => {
            expect(source).toContain('<Spinner size="sm"');
            expect(source).toContain('Loading files...');
        });
    });

    describe('data-testid attributes', () => {
        it('has branch-changes on outer container', () => {
            expect(source).toContain('data-testid="branch-changes"');
        });

        it('has branch-changes-header on clickable button', () => {
            expect(source).toContain('data-testid="branch-changes-header"');
        });

        it('has branch-changes-summary on summary text', () => {
            expect(source).toContain('data-testid="branch-changes-summary"');
        });

        it('has branch-changes-files on file list container', () => {
            expect(source).toContain('data-testid="branch-changes-files"');
        });

        it('has branch-changes-files-loading on loading indicator', () => {
            expect(source).toContain('data-testid="branch-changes-files-loading"');
        });

        it('has branch-changes-files-error on error message', () => {
            expect(source).toContain('data-testid="branch-changes-files-error"');
        });
    });

    describe('per-file diff viewing', () => {
        describe('state management', () => {
            it('tracks expandedFile state', () => {
                expect(source).toContain('setExpandedFile');
            });

            it('tracks fileDiff state', () => {
                expect(source).toContain('setFileDiff');
            });

            it('tracks fileDiffLoading state', () => {
                expect(source).toContain('setFileDiffLoading');
            });

            it('tracks fileDiffError state', () => {
                expect(source).toContain('setFileDiffError');
            });

            it('tracks showFullDiff state', () => {
                expect(source).toContain('setShowFullDiff');
            });

            it('resets diff state when workspace or range data changes', () => {
                const resetEffect = source.slice(0, source.indexOf('[workspaceId, branchRangeData]'));
                expect(resetEffect).toContain('setExpandedFile(null)');
                expect(resetEffect).toContain('setFileDiff(null)');
                expect(resetEffect).toContain('setFileDiffError(null)');
                expect(resetEffect).toContain('setShowFullDiff(false)');
            });
        });

        describe('toggle handler', () => {
            it('defines toggleFileDiff function', () => {
                expect(source).toContain('const toggleFileDiff');
            });

            it('collapses when clicking the same file (accordion toggle)', () => {
                expect(source).toMatch(/if\s*\(expandedFile\s*===\s*filePath\)/);
            });

            it('fetches per-file diff from correct API endpoint', () => {
                expect(source).toContain('/git/branch-range/files/');
                expect(source).toContain('/diff');
                expect(source).toContain('encodeURIComponent(filePath)');
            });

            it('resets fileDiff to null when switching files', () => {
                // Between the "expand new file" block and the fetch call
                const toggleFn = source.slice(
                    source.indexOf('const toggleFileDiff'),
                    source.indexOf('const renderDiffContent')
                );
                // After setExpandedFile(filePath), fileDiff is set to null
                const expandBlock = toggleFn.slice(toggleFn.indexOf('setExpandedFile(filePath)'));
                expect(expandBlock).toContain('setFileDiff(null)');
            });

            it('sets fileDiffLoading true before fetch', () => {
                const toggleFn = source.slice(
                    source.indexOf('const toggleFileDiff'),
                    source.indexOf('const renderDiffContent')
                );
                expect(toggleFn).toContain('setFileDiffLoading(true)');
            });

            it('resets showFullDiff on file change', () => {
                const toggleFn = source.slice(
                    source.indexOf('const toggleFileDiff'),
                    source.indexOf('const renderDiffContent')
                );
                // showFullDiff is reset in both collapse and expand paths
                const occurrences = toggleFn.split('setShowFullDiff(false)').length - 1;
                expect(occurrences).toBeGreaterThanOrEqual(2);
            });

            it('sets fileDiff from API response data.diff', () => {
                expect(source).toContain("data.diff ?? ''");
            });

            it('captures error message on fetch failure', () => {
                expect(source).toContain("err.message || 'Failed to load diff'");
            });
        });

        describe('file rows — clickable buttons', () => {
            it('renders file rows as <button> elements', () => {
                // The file row is a <button> with onClick calling toggleFileDiff
                expect(source).toContain('onClick={() => toggleFileDiff(file.path)');
            });

            it('has data-testid on each file row button', () => {
                expect(source).toContain('data-testid={`branch-file-row-${file.path}`}');
            });

            it('shows expand/collapse chevron per file row', () => {
                // The file row has a chevron that changes based on expandedFile
                expect(source).toContain('expandedFile === file.path');
            });

            it('uses text-left for proper button text alignment', () => {
                expect(source).toContain('text-left');
            });
        });

        describe('inline diff panel', () => {
            it('renders diff panel when file is expanded', () => {
                expect(source).toContain('expandedFile === file.path && (');
            });

            it('has data-testid on each diff panel', () => {
                expect(source).toContain('data-testid={`branch-file-diff-${file.path}`}');
            });

            it('shows loading spinner while diff is fetching', () => {
                // Within the diff panel, fileDiffLoading triggers spinner
                expect(source).toContain('fileDiffLoading ?');
                expect(source).toContain('Loading diff...');
            });

            it('shows error message on diff fetch failure', () => {
                expect(source).toContain('fileDiffError ?');
                expect(source).toContain('Failed to load diff');
            });

            it('calls renderDiffContent for successful diff', () => {
                expect(source).toContain('renderDiffContent()');
            });
        });

        describe('diff rendering with truncation', () => {
            it('defines DIFF_LINE_LIMIT constant at 500', () => {
                expect(source).toContain('const DIFF_LINE_LIMIT = 500');
            });

            it('defines renderDiffContent function', () => {
                expect(source).toContain('const renderDiffContent');
            });

            it('shows "(empty diff)" for empty diff string', () => {
                expect(source).toContain('(empty diff)');
            });

            it('has data-testid for empty diff state', () => {
                expect(source).toContain('data-testid="branch-file-diff-empty"');
            });

            it('splits diff by newlines for truncation logic', () => {
                expect(source).toContain("fileDiff.split('\\n')");
            });

            it('truncates when lines exceed DIFF_LINE_LIMIT and showFullDiff is false', () => {
                expect(source).toContain('lines.length > DIFF_LINE_LIMIT && !showFullDiff');
            });

            it('slices to DIFF_LINE_LIMIT lines when truncated', () => {
                expect(source).toContain('lines.slice(0, DIFF_LINE_LIMIT)');
            });

            it('renders diff content in a <pre> element', () => {
                expect(source).toContain('<pre');
                expect(source).toContain("displayLines.join('\\n')");
            });

            it('has data-testid on diff content pre element', () => {
                expect(source).toContain('data-testid="branch-file-diff-content"');
            });

            it('uses CommitDetail-matching styling on pre element', () => {
                expect(source).toContain('p-3 text-xs font-mono bg-[#f5f5f5] dark:bg-[#2d2d2d]');
                expect(source).toContain('max-h-[500px]');
                expect(source).toContain('whitespace-pre');
            });

            it('renders "Show All" button when truncated', () => {
                expect(source).toContain('data-testid="branch-file-diff-show-all"');
                expect(source).toContain('Diff too large');
                expect(source).toContain('Show All');
            });

            it('Show All button calls setShowFullDiff(true)', () => {
                expect(source).toContain('setShowFullDiff(true)');
            });

            it('Show All button stops event propagation', () => {
                expect(source).toContain('e.stopPropagation()');
            });

            it('shows line limit count in truncation message', () => {
                expect(source).toContain('{DIFF_LINE_LIMIT}');
            });
        });
    });

    describe('integration with RepoGitTab', () => {
        let gitTabSource: string;

        beforeAll(() => {
            gitTabSource = fs.readFileSync(REPO_GIT_TAB_PATH, 'utf-8');
        });

        it('RepoGitTab imports BranchChanges', () => {
            expect(gitTabSource).toContain("import { BranchChanges } from './BranchChanges'");
        });

        it('RepoGitTab renders BranchChanges component', () => {
            expect(gitTabSource).toContain('<BranchChanges');
        });

        it('RepoGitTab passes workspaceId to BranchChanges', () => {
            expect(gitTabSource).toContain('workspaceId={workspaceId}');
        });

        it('RepoGitTab passes branchRangeData to BranchChanges', () => {
            expect(gitTabSource).toContain('branchRangeData={branchRangeData}');
        });

        it('RepoGitTab passes onDefaultBranch to BranchChanges', () => {
            expect(gitTabSource).toContain('onDefaultBranch={onDefaultBranch}');
        });

        it('RepoGitTab imports BranchRangeInfo type from BranchChanges', () => {
            expect(gitTabSource).toContain("import type { BranchRangeInfo } from './BranchChanges'");
        });

        it('BranchChanges appears after GitPanelHeader in left panel', () => {
            const headerIdx = gitTabSource.indexOf('<GitPanelHeader');
            const branchIdx = gitTabSource.indexOf('<BranchChanges');
            expect(headerIdx).toBeGreaterThan(-1);
            expect(branchIdx).toBeGreaterThan(-1);
            expect(headerIdx).toBeLessThan(branchIdx);
        });

        it('BranchChanges appears before CommitList in the commit list panel', () => {
            const branchChangesIndex = gitTabSource.indexOf('<BranchChanges');
            const commitListPanelIndex = gitTabSource.indexOf('{commitListPanel}');
            expect(branchChangesIndex).toBeGreaterThan(-1);
            expect(commitListPanelIndex).toBeGreaterThan(-1);
            expect(branchChangesIndex).toBeLessThan(commitListPanelIndex);
        });
    });
});
