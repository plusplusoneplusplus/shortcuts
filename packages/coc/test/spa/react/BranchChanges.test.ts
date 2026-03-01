/**
 * Tests for BranchChanges component source structure.
 *
 * Validates exports, props, API usage, state management, rendering,
 * status mappings, error handling, and data-testid attributes.
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
    });

    describe('component signature', () => {
        it('accepts workspaceId prop', () => {
            expect(source).toContain('workspaceId: string');
        });

        it('defines BranchChangesProps interface', () => {
            expect(source).toContain('interface BranchChangesProps');
        });
    });

    describe('internal types', () => {
        it('defines BranchRangeInfo interface', () => {
            expect(source).toContain('interface BranchRangeInfo');
        });

        it('BranchRangeInfo has baseRef, headRef, commitCount, additions, deletions', () => {
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

        it('fetches from /git/branch-range endpoint on mount', () => {
            expect(source).toContain('/git/branch-range');
        });

        it('fetches from /git/branch-range/files endpoint for file list', () => {
            expect(source).toContain('/git/branch-range/files');
        });

        it('encodes workspaceId in fetch URL', () => {
            expect(source).toContain('encodeURIComponent(workspaceId)');
        });
    });

    describe('state management', () => {
        it('tracks rangeInfo state', () => {
            expect(source).toContain('setRangeInfo');
        });

        it('tracks files state', () => {
            expect(source).toContain('setFiles');
        });

        it('tracks loading state', () => {
            expect(source).toContain('setLoading');
        });

        it('tracks filesLoading state', () => {
            expect(source).toContain('setFilesLoading');
        });

        it('tracks expanded state', () => {
            expect(source).toContain('setExpanded');
        });

        it('tracks hidden state', () => {
            expect(source).toContain('setHidden');
        });

        it('tracks filesError state', () => {
            expect(source).toContain('setFilesError');
        });
    });

    describe('default branch handling', () => {
        it('checks for onDefaultBranch in response', () => {
            expect(source).toContain('onDefaultBranch');
        });

        it('sets hidden to true when on default branch', () => {
            expect(source).toContain('setHidden(true)');
        });

        it('returns null when hidden', () => {
            expect(source).toContain('if (loading || hidden || !rangeInfo) return null');
        });
    });

    describe('error handling', () => {
        it('hides section silently on range fetch error', () => {
            // The catch handler for the range fetch sets hidden=true
            expect(source).toMatch(/\.catch\(\s*\(\)\s*=>\s*\{[\s\S]*?setHidden\(true\)/);
        });

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

        it('BranchChanges appears before CommitList in the commit list panel', () => {
            const branchChangesIndex = gitTabSource.indexOf('<BranchChanges');
            const commitListPanelIndex = gitTabSource.indexOf('{commitListPanel}');
            expect(branchChangesIndex).toBeGreaterThan(-1);
            expect(commitListPanelIndex).toBeGreaterThan(-1);
            expect(branchChangesIndex).toBeLessThan(commitListPanelIndex);
        });
    });
});
