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
    __dirname, '..', '..', '..', 'src', 'server', 'spa', 'client', 'react', 'features', 'git', 'branches', 'BranchChanges.tsx'
);

const REPO_GIT_TAB_PATH = path.join(
    __dirname, '..', '..', '..', 'src', 'server', 'spa', 'client', 'react', 'features', 'git', 'RepoGitTab.tsx'
);

describe('BranchChanges', () => {
    let source: string;

    beforeAll(() => {
        source = fs.readFileSync(COMPONENT_PATH, 'utf-8');
    });

    describe('exports', () => {
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

        it('accepts optional onFileSelect prop', () => {
            expect(source).toContain('onFileSelect?: (filePath: string) => void');
        });

        it('accepts optional selectedFile prop', () => {
            expect(source).toContain('selectedFile?: string | null');
        });

        it('accepts optional onBranchRangeSelect prop', () => {
            expect(source).toContain('onBranchRangeSelect?: () => void');
        });

        it('calls onBranchRangeSelect on header click', () => {
            expect(source).toContain('onBranchRangeSelect?.()');
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

        it('defines BranchRangeFile interface extending FileChange', () => {
            expect(source).toContain('interface BranchRangeFile');
            expect(source).toContain('extends FileChange');
        });
    });

    describe('API integration', () => {
        it('imports typed CoC client', () => {
            expect(source).toContain("import { getSpaCocClient } from '../../../api/cocClient'");
        });

        it('derives rangeInfo from branchRangeData prop (lifted to parent)', () => {
            expect(source).toContain('const rangeInfo = branchRangeData ?? null');
        });

        it('fetches from /git/branch-range/files endpoint for file list', () => {
            expect(source).toContain('listBranchRangeFiles(workspaceId)');
        });

        it('uses typed client for workspace-scoped routes', () => {
            expect(source).toContain('getSpaCocClient().git');
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
            expect(source).toContain('listBranchRangeFiles(workspaceId)');
        });

        it('shows expand/collapse indicators', () => {
            expect(source).toContain('▼');
            expect(source).toContain('▶');
        });
    });

    describe('status mappings (shared from FileTree)', () => {
        let fileTreeSource: string;

        beforeAll(() => {
            const fileTreePath = path.join(
                __dirname, '..', '..', '..', 'src', 'server', 'spa', 'client', 'react', 'features', 'git', 'diff', 'FileTree.tsx'
            );
            fileTreeSource = fs.readFileSync(fileTreePath, 'utf-8');
        });

        it('imports shared status infrastructure from FileTree', () => {
            expect(source).toContain("from '../diff/FileTree'");
            expect(source).toContain('FlatFileList');
        });

        it('FileTree has char-keyed STATUS_COLORS for all statuses', () => {
            expect(fileTreeSource).toContain("A: 'text-[#16825d]'");
            expect(fileTreeSource).toContain("M: 'text-[#0078d4]'");
            expect(fileTreeSource).toContain("D: 'text-[#d32f2f]'");
            expect(fileTreeSource).toContain("R: 'text-[#9c27b0]'");
        });

        it('FileTree has STATUS_LABELS for tooltips', () => {
            expect(fileTreeSource).toContain("A: 'Added'");
            expect(fileTreeSource).toContain("M: 'Modified'");
            expect(fileTreeSource).toContain("D: 'Deleted'");
            expect(fileTreeSource).toContain("R: 'Renamed'");
            expect(fileTreeSource).toContain("C: 'Copied'");
        });

        it('does not define local STATUS_CHARS map (delegated to FileTree)', () => {
            expect(source).not.toContain('const STATUS_CHARS');
        });
    });

    describe('rendering — collapsed state', () => {
        it('shows branch name as the aria-label / accessible label', () => {
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

        it('shows file count in dedicated pill badge', () => {
            expect(source).toContain('rangeInfo.fileCount');
            expect(source).toContain('data-testid="branch-changes-file-count"');
        });

        it('extracts short base ref name', () => {
            expect(source).toContain("baseRef.replace(/^origin\\//, '')");
        });

        it('uses the new branch-range card header treatment', () => {
            // Card-style: blue-accent left border + colored badge replace the
            // legacy uppercase-tracked banner shared with CommitList.
            expect(source).toContain('border-l-[#0078d4]');
            expect(source).toContain('data-testid="branch-changes-badge"');
            expect(source).toContain('Branch Range');
        });

        it('renders the header as a single compact line', () => {
            // Compact card: badge + summary share one row — no fixed 38px min
            // height and no stacked two-line body.
            expect(source).not.toContain('min-h-[38px]');
            expect(source).not.toContain('flex flex-col gap-0.5');
        });

        it('makes the branch-range header a shared pointer context drag source', () => {
            expect(source).toContain('createGitRangeContextDragPayload');
            expect(source).toContain('writePointerContextDragData');
            expect(source).toContain('isSessionContextAttachmentsEnabled');
            expect(source).toContain('data-session-context-kind={sessionContextPayload ? \'range\' : undefined}');
            expect(source).toContain('drag to attach as range context');
        });
    });

    describe('rendering — expanded state', () => {
        it('renders file path', () => {
            expect(source).toContain('file.path');
        });

        it('delegates flat file rendering to shared FlatFileList', () => {
            expect(source).toContain('<FlatFileList');
            expect(source).toContain('files={files}');
        });

        it('passes renderFileExtra slot for inline diff expansion', () => {
            expect(source).toContain('renderFileExtra=');
            expect(source).toContain('expandedFile');
        });

        it('imports Spinner from ui', () => {
            expect(source).toContain("Spinner");
            expect(source).toContain("from '../../../ui'");
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

            it('resets diff state when workspace or range data changes', () => {
                const resetEffect = source.slice(0, source.indexOf('[workspaceId, branchRangeData]'));
                expect(resetEffect).toContain('setExpandedFile(null)');
                expect(resetEffect).toContain('setFileDiff(null)');
                expect(resetEffect).toContain('setFileDiffError(null)');
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
                expect(source).toContain('getBranchRangeFileDiff(workspaceId, filePath)');
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

            it('sets fileDiff from API response data.diff', () => {
                expect(source).toContain("data.diff ?? ''");
            });

            it('captures error message on fetch failure', () => {
                expect(source).toContain("err.message || 'Failed to load diff'");
            });
        });

        describe('file rows — clickable buttons', () => {
            it('uses FlatFileList with onFileSelect={handleFileClick}', () => {
                expect(source).toContain('onFileSelect={handleFileClick}');
            });

            it('defines handleFileClick that delegates to onFileSelect or toggleFileDiff', () => {
                expect(source).toContain('const handleFileClick');
                expect(source).toContain('onFileSelect(filePath)');
                expect(source).toContain('toggleFileDiff(filePath)');
            });

            it('passes file test ID prefix to shared FlatFileList', () => {
                expect(source).toContain('fileTestIdPrefix="branch-file-row"');
            });

            it('passes renderFileExtra slot for inline diff expansion', () => {
                expect(source).toContain('renderFileExtra=');
            });
        });

        describe('inline diff panel', () => {
            it('renders diff panel via renderFileExtra when onFileSelect is absent and file is expanded', () => {
                expect(source).toContain('!onFileSelect && expandedFile ===');
            });

            it('has data-testid on each diff panel', () => {
                expect(source).toContain('data-testid={`branch-file-diff-${');
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

        describe('diff rendering with UnifiedDiffViewer', () => {
            it('imports UnifiedDiffViewer', () => {
                expect(source).toContain("import { UnifiedDiffViewer }");
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

            it('renders diff via UnifiedDiffViewer component', () => {
                expect(source).toContain('<UnifiedDiffViewer');
            });

            it('passes fileName prop from expandedFile', () => {
                expect(source).toContain('fileName={expandedFile ?? undefined}');
            });

            it('passes showLineNumbers prop', () => {
                expect(source).toContain('showLineNumbers');
            });

            it('has data-testid on diff content', () => {
                expect(source).toContain('data-testid="branch-file-diff-content"');
            });

            it('does not use manual truncation or <pre> element', () => {
                expect(source).not.toContain('DIFF_LINE_LIMIT');
                expect(source).not.toContain('showFullDiff');
                expect(source).not.toContain('<pre');
            });
        });
    });

    describe('integration with RepoGitTab', () => {
        let gitTabSource: string;

        beforeAll(() => {
            gitTabSource = fs.readFileSync(REPO_GIT_TAB_PATH, 'utf-8');
        });

        it('RepoGitTab imports BranchChanges', () => {
            expect(gitTabSource).toContain("import { BranchChanges } from './branches/BranchChanges'");
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

        it('RepoGitTab passes onFileSelect to BranchChanges', () => {
            expect(gitTabSource).toContain('onFileSelect={handleFileSelect}');
        });

        it('RepoGitTab passes selectedFile to BranchChanges', () => {
            expect(gitTabSource).toContain('selectedFile={selectedBranchFile}');
        });

        it('RepoGitTab imports BranchRangeInfo type from BranchChanges', () => {
            expect(gitTabSource).toContain("import type { BranchRangeInfo } from './branches/BranchChanges'");
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

        it('RepoGitTab passes onBranchContextMenu to BranchChanges', () => {
            expect(gitTabSource).toContain('onBranchContextMenu={handleBranchContextMenu}');
        });
    });

    describe('context menu support', () => {
        it('accepts optional onBranchContextMenu prop', () => {
            expect(source).toContain('onBranchContextMenu?: (e: React.MouseEvent) => void');
        });

        it('destructures onBranchContextMenu in function signature', () => {
            expect(source).toContain('onBranchContextMenu');
        });

        it('attaches onContextMenu handler to branch-changes header button', () => {
            expect(source).toContain('onContextMenu=');
        });

        it('calls onBranchContextMenu prop from header onContextMenu', () => {
            expect(source).toContain('onBranchContextMenu?.(e)');
        });
    });
});
