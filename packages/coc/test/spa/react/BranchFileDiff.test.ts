/**
 * Tests for BranchFileDiff component source structure.
 *
 * Validates exports, props, API usage, loading/error/retry states,
 * diff rendering, and data-testid attributes for the right-panel
 * branch file diff view.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

const COMPONENT_PATH = path.join(
    __dirname, '..', '..', '..', 'src', 'server', 'spa', 'client', 'react', 'repos', 'BranchFileDiff.tsx'
);

const INDEX_PATH = path.join(
    __dirname, '..', '..', '..', 'src', 'server', 'spa', 'client', 'react', 'repos', 'index.ts'
);

const REPO_GIT_TAB_PATH = path.join(
    __dirname, '..', '..', '..', 'src', 'server', 'spa', 'client', 'react', 'repos', 'RepoGitTab.tsx'
);

describe('BranchFileDiff', () => {
    let source: string;

    beforeAll(() => {
        source = fs.readFileSync(COMPONENT_PATH, 'utf-8');
    });

    describe('exports', () => {
        it('is exported from repos/index.ts', () => {
            const indexSource = fs.readFileSync(INDEX_PATH, 'utf-8');
            expect(indexSource).toContain("export { BranchFileDiff }");
            expect(indexSource).toContain("from './BranchFileDiff'");
        });

        it('exports BranchFileDiff as a named export', () => {
            expect(source).toContain('export function BranchFileDiff');
        });

        it('exports BranchFileDiffProps interface', () => {
            expect(source).toContain('export interface BranchFileDiffProps');
        });

        it('exports BranchFileDiffProps type from index', () => {
            const indexSource = fs.readFileSync(INDEX_PATH, 'utf-8');
            expect(indexSource).toContain("export type { BranchFileDiffProps }");
        });
    });

    describe('component signature', () => {
        it('accepts workspaceId prop', () => {
            expect(source).toContain('workspaceId: string');
        });

        it('accepts filePath prop', () => {
            expect(source).toContain('filePath: string');
        });

        it('destructures both props', () => {
            expect(source).toContain('{ workspaceId, filePath }');
        });
    });

    describe('API integration', () => {
        it('imports fetchApi from hooks/useApi', () => {
            expect(source).toContain("import { fetchApi } from '../hooks/useApi'");
        });

        it('fetches from branch-range per-file diff endpoint', () => {
            expect(source).toContain('/git/branch-range/files/');
            expect(source).toContain('/diff');
        });

        it('encodes workspaceId in fetch URL', () => {
            expect(source).toContain('encodeURIComponent(workspaceId)');
        });

        it('encodes filePath in fetch URL', () => {
            expect(source).toContain('encodeURIComponent(filePath)');
        });

        it('extracts diff from response data', () => {
            expect(source).toContain("data.diff ?? ''");
        });
    });

    describe('state management', () => {
        it('tracks diff state', () => {
            expect(source).toContain('setDiff');
        });

        it('tracks loading state', () => {
            expect(source).toContain('setLoading');
        });

        it('tracks error state', () => {
            expect(source).toContain('setError');
        });

        it('defines fetchDiff as a memoized callback', () => {
            expect(source).toContain('const fetchDiff = useCallback');
        });

        it('depends on workspaceId and filePath for fetchDiff', () => {
            expect(source).toContain('[workspaceId, filePath]');
        });

        it('fetches on mount via useEffect', () => {
            expect(source).toContain('useEffect');
            expect(source).toContain('fetchDiff()');
        });
    });

    describe('retry support', () => {
        it('defines handleRetry callback', () => {
            expect(source).toContain('const handleRetry = useCallback');
        });

        it('has retry button with data-testid', () => {
            expect(source).toContain('data-testid="branch-file-diff-retry-btn"');
        });

        it('renders Retry button text', () => {
            expect(source).toContain('Retry');
        });

        it('connects handleRetry to onClick', () => {
            expect(source).toContain('onClick={handleRetry}');
        });
    });

    describe('loading state', () => {
        it('initializes loading to true', () => {
            expect(source).toContain('useState(true)');
        });

        it('sets loading true before fetch', () => {
            expect(source).toContain('setLoading(true)');
        });

        it('sets loading false after fetch completes', () => {
            expect(source).toContain('setLoading(false)');
        });

        it('shows spinner during loading', () => {
            expect(source).toContain('<Spinner size="sm"');
            expect(source).toContain('Loading diff...');
        });

        it('has loading state data-testid', () => {
            expect(source).toContain('data-testid="branch-file-diff-loading"');
        });
    });

    describe('error state', () => {
        it('captures error message from fetch failure', () => {
            expect(source).toContain("err.message || 'Failed to load diff'");
        });

        it('has error state data-testid', () => {
            expect(source).toContain('data-testid="branch-file-diff-error"');
        });

        it('uses error styling consistent with CommitDetail', () => {
            expect(source).toContain('text-[#d32f2f] dark:text-[#f48771]');
        });
    });

    describe('diff rendering', () => {
        it('uses UnifiedDiffViewer for diff display', () => {
            expect(source).toContain('<UnifiedDiffViewer');
        });

        it('has diff content data-testid', () => {
            expect(source).toContain('data-testid="branch-file-diff-content"');
        });

        it('imports UnifiedDiffViewer', () => {
            expect(source).toContain("import { UnifiedDiffViewer } from './UnifiedDiffViewer'");
        });

        it('shows empty diff message', () => {
            expect(source).toContain('(empty diff)');
        });

        it('has empty diff data-testid', () => {
            expect(source).toContain('data-testid="branch-file-diff-empty"');
        });

        it('does not use DIFF_LINE_LIMIT truncation (full diff shown)', () => {
            expect(source).not.toContain('DIFF_LINE_LIMIT');
            expect(source).not.toContain('Show All');
        });
    });

    describe('header bar', () => {
        it('has header data-testid', () => {
            expect(source).toContain('data-testid="branch-file-diff-header"');
        });

        it('displays file path in header', () => {
            expect(source).toContain('{filePath}');
        });

        it('shows "Branch diff" label', () => {
            expect(source).toContain('Branch diff');
        });

        it('uses font-mono for file path', () => {
            expect(source).toContain('font-mono');
        });

        it('uses styling consistent with CommitDetail header', () => {
            expect(source).toContain('bg-[#fafafa] dark:bg-[#252526]');
        });
    });

    describe('layout', () => {
        it('has root data-testid', () => {
            expect(source).toContain('data-testid="branch-file-diff"');
        });

        it('uses full-height flex layout like CommitDetail', () => {
            expect(source).toContain('flex flex-col h-full overflow-y-auto');
        });

        it('has diff section data-testid', () => {
            expect(source).toContain('data-testid="branch-file-diff-section"');
        });
    });

    describe('imports', () => {
        it('imports useState, useEffect, useCallback from react', () => {
            expect(source).toContain('useState');
            expect(source).toContain('useEffect');
            expect(source).toContain('useCallback');
        });

        it('imports Spinner from shared', () => {
            expect(source).toContain("import { Spinner");
        });

        it('imports Button from shared', () => {
            expect(source).toContain("Button }");
        });
    });

    describe('integration with RepoGitTab', () => {
        let gitTabSource: string;

        beforeAll(() => {
            gitTabSource = fs.readFileSync(REPO_GIT_TAB_PATH, 'utf-8');
        });

        it('RepoGitTab imports BranchFileDiff', () => {
            expect(gitTabSource).toContain("import { BranchFileDiff } from './BranchFileDiff'");
        });

        it('RepoGitTab renders BranchFileDiff component', () => {
            expect(gitTabSource).toContain('<BranchFileDiff');
        });

        it('RepoGitTab passes workspaceId to BranchFileDiff', () => {
            expect(gitTabSource).toContain('workspaceId={workspaceId}');
        });

        it('RepoGitTab passes filePath to BranchFileDiff', () => {
            expect(gitTabSource).toContain('filePath={rightPanelView.filePath}');
        });

        it('RepoGitTab uses key prop on BranchFileDiff for remount', () => {
            expect(gitTabSource).toContain('key={rightPanelView.filePath}');
        });

        it('BranchFileDiff is rendered when rightPanelView type is branch-file', () => {
            expect(gitTabSource).toContain("rightPanelView?.type === 'branch-file'");
        });
    });
});
