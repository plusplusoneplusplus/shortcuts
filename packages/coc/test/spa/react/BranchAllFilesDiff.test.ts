/**
 * Tests for BranchAllFilesDiff component source structure.
 *
 * Validates exports, props, API usage, state management,
 * rendering patterns, and data-testid attributes.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

const COMPONENT_PATH = path.join(
    __dirname, '..', '..', '..', 'src', 'server', 'spa', 'client', 'react', 'features', 'git', 'branches', 'BranchAllFilesDiff.tsx'
);

describe('BranchAllFilesDiff', () => {
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
        it('exports BranchAllFilesDiff as a named export', () => {
            expect(source).toContain('export function BranchAllFilesDiff');
        });

        it('exports BranchRangeFile interface', () => {
            expect(source).toContain('export interface BranchRangeFile');
        });
    });

    describe('imports', () => {
        it('imports typed CoC client', () => {
            expect(source).toContain("getSpaCocClient");
        });

        it('imports Spinner', () => {
            expect(source).toContain("Spinner");
        });
    });

    describe('component signature', () => {
        it('accepts workspaceId prop', () => {
            expect(source).toContain('workspaceId: string');
        });

        it('accepts files prop typed as BranchRangeFile[]', () => {
            expect(source).toContain('files: BranchRangeFile[]');
        });

        it('accepts onFileSelect callback', () => {
            expect(source).toContain('onFileSelect: (filePath: string) => void');
        });
    });

    describe('BranchRangeFile interface', () => {
        it('has path field', () => {
            expect(source).toMatch(/interface BranchRangeFile[\s\S]*?path: string/);
        });

        it('has status field', () => {
            expect(source).toMatch(/interface BranchRangeFile[\s\S]*?status: string/);
        });

        it('has additions and deletions fields', () => {
            expect(source).toMatch(/interface BranchRangeFile[\s\S]*?additions: number/);
            expect(source).toMatch(/interface BranchRangeFile[\s\S]*?deletions: number/);
        });

        it('has optional oldPath field', () => {
            expect(source).toContain('oldPath?: string');
        });
    });

    describe('state management', () => {
        it('defines FileState type with expected fields', () => {
            expect(source).toContain('expanded: boolean');
            expect(source).toContain('loading: boolean');
        });

        it('uses useState for file states keyed by path', () => {
            expect(source).toContain('useState<Record<string, FileState>>');
        });

        it('starts all files collapsed', () => {
            expect(source).toContain('expanded: false');
        });
    });

    describe('API integration', () => {
        it('calls branch-range/files/:filePath/diff endpoint', () => {
            expect(source).toContain('getBranchRangeFileDiff(workspaceId, filePath)');
        });

        it('lazy-fetches diff only when expanding', () => {
            expect(source).toContain('loading: true');
        });
    });

    describe('diff truncation', () => {
        it('truncates to 200 lines', () => {
            expect(source).toContain('DIFF_LINE_LIMIT = 200');
        });

        it('shows link to navigate to full diff', () => {
            expect(source).toContain('Show full diff');
        });
    });

    describe('inline diff rendering', () => {
        it('imports and uses UnifiedDiffViewer for inline diffs', () => {
            expect(source).toContain("from '../diff/UnifiedDiffViewer'");
            expect(source).toContain('UnifiedDiffViewer');
        });

        it('passes enableComments={false} and showLineNumbers={false}', () => {
            expect(source).toContain('enableComments={false}');
            expect(source).toContain('showLineNumbers={false}');
        });

        it('does not render raw <pre> for diff content', () => {
            expect(source).not.toMatch(/<pre[\s\S]*?displayLines\.join/);
        });

        it('wraps viewer in a max-height container', () => {
            expect(source).toContain('max-h-[400px]');
            expect(source).toContain('overflow-y-auto');
        });

        it('passes fileName for syntax highlighting', () => {
            expect(source).toContain('fileName={file.path}');
        });
    });

    describe('rendering', () => {
        it('renders outer container with data-testid', () => {
            expect(source).toContain('data-testid="branch-all-files-diff"');
        });

        it('renders empty state', () => {
            expect(source).toContain('data-testid="branch-all-files-empty"');
            expect(source).toContain('No file changes in range');
        });

        it('renders Open → button to navigate to file diff', () => {
            expect(source).toContain('Open →');
            expect(source).toContain('onFileSelect(file.path)');
        });
    });
});
