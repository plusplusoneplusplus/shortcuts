/**
 * Tests for CommitDetail component source structure.
 *
 * Validates exports, props (diff + optional metadata), diff-only rendering,
 * commit info header section, per-file diff support, error handling with retry,
 * and the API integration.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

const COMPONENT_PATH = path.join(
    __dirname, '..', '..', '..', 'src', 'server', 'spa', 'client', 'react', 'repos', 'CommitDetail.tsx'
);

const INDEX_PATH = path.join(
    __dirname, '..', '..', '..', 'src', 'server', 'spa', 'client', 'react', 'repos', 'index.ts'
);

describe('CommitDetail', () => {
    let source: string;

    beforeAll(() => {
        source = fs.readFileSync(COMPONENT_PATH, 'utf-8');
    });

    describe('exports', () => {
        it('is exported from repos/index.ts', () => {
            const indexSource = fs.readFileSync(INDEX_PATH, 'utf-8');
            expect(indexSource).toContain("export { CommitDetail }");
            expect(indexSource).toContain("from './CommitDetail'");
        });

        it('exports CommitDetail as a named export', () => {
            expect(source).toContain('export function CommitDetail');
        });

        it('exports CommitDetailProps interface', () => {
            expect(source).toContain('export interface CommitDetailProps');
        });
    });

    describe('component signature — diff props', () => {
        it('accepts workspaceId prop', () => {
            expect(source).toContain('workspaceId: string');
        });

        it('accepts hash prop', () => {
            expect(source).toContain('hash: string');
        });

        it('accepts optional filePath prop', () => {
            expect(source).toContain('filePath?: string');
        });

        it('accepts optional commit prop', () => {
            expect(source).toContain('commit?: GitCommitItem');
        });
    });

    describe('diff API integration — always visible', () => {
        it('fetches from /git/commits/:hash/diff endpoint', () => {
            expect(source).toContain('/diff');
        });

        it('auto-fetches diff on mount (no toggle button)', () => {
            expect(source).not.toContain('View Full Diff');
            expect(source).not.toContain('Hide Diff');
            expect(source).not.toContain('data-testid="view-diff-btn"');
        });

        it('has diff loading state', () => {
            expect(source).toContain('data-testid="diff-loading"');
        });

        it('uses UnifiedDiffViewer for diff display', () => {
            expect(source).toContain('<UnifiedDiffViewer');
        });

        it('imports UnifiedDiffViewer', () => {
            expect(source).toContain("import { UnifiedDiffViewer, HunkNavButtons } from './UnifiedDiffViewer'");
        });

        it('renders diff content with data-testid', () => {
            expect(source).toContain('data-testid="diff-content"');
        });

        it('has diff section container', () => {
            expect(source).toContain('data-testid="diff-section"');
        });

        it('has retry button for diff errors', () => {
            expect(source).toContain('data-testid="retry-diff-btn"');
            expect(source).toContain('Retry');
            expect(source).toContain('handleRetryDiff');
        });
    });

    describe('per-file diff support', () => {
        it('builds diffUrl based on filePath presence', () => {
            expect(source).toContain('const diffUrl = filePath');
        });

        it('constructs per-file diff URL with /files/:filePath/diff', () => {
            expect(source).toContain('/files/');
            expect(source).toContain('/diff');
        });

        it('falls back to full commit diff URL when no filePath', () => {
            expect(source).toContain('/git/commits/${hash}/diff');
        });

        it('shows file path label when filePath is provided', () => {
            expect(source).toContain('data-testid="diff-file-path"');
        });

        it('only renders file path label when filePath exists', () => {
            expect(source).toContain('filePath &&');
        });
    });

    describe('error handling', () => {
        it('tracks diff error state', () => {
            expect(source).toContain('diffError');
            expect(source).toContain('setDiffError');
        });

        it('shows visible error for diff loading failure', () => {
            expect(source).toContain('data-testid="diff-error"');
        });

        it('does NOT silently catch errors', () => {
            expect(source).toContain('catch(err');
        });
    });

    describe('commit info header — metadata in right panel', () => {
        it('has commit-info-header section', () => {
            expect(source).toContain('data-testid="commit-info-header"');
        });

        it('has commit-info-subject section', () => {
            expect(source).toContain('data-testid="commit-info-subject"');
        });

        it('has commit-info-author section', () => {
            expect(source).toContain('data-testid="commit-info-author"');
        });

        it('has commit-info-date section', () => {
            expect(source).toContain('data-testid="commit-info-date"');
        });

        it('has commit-info-hash section', () => {
            expect(source).toContain('data-testid="commit-info-hash"');
        });

        it('has commit-info-parents section', () => {
            expect(source).toContain('data-testid="commit-info-parents"');
        });

        it('has commit-info-body section', () => {
            expect(source).toContain('data-testid="commit-info-body"');
        });

        it('imports copyToClipboard', () => {
            expect(source).toContain('copyToClipboard');
        });

        it('imports GitCommitItem type', () => {
            expect(source).toContain("import type { GitCommitItem } from './CommitList'");
        });

        it('conditionally renders header only for full-commit view (not per-file)', () => {
            expect(source).toContain('commit && !filePath');
        });
    });

    describe('commit detail root', () => {
        it('has data-testid', () => {
            expect(source).toContain('data-testid="commit-detail"');
        });
    });

    describe('DiffMiniMap layout — minimap stays fixed (does not scroll with content)', () => {
        it('outer commit-detail container uses overflow-hidden (not overflow-auto)', () => {
            expect(source).toContain('commit-detail flex flex-col h-full overflow-hidden');
        });

        it('outer commit-detail container does NOT have scrollContainerRef', () => {
            // The ref must NOT appear on the outermost div (which also has "commit-detail" class)
            expect(source).not.toMatch(/ref=\{scrollContainerRef\}[^>]*commit-detail/);
        });

        it('flex row wrapper has flex-1 so it fills remaining height', () => {
            expect(source).toContain('flex flex-1 min-h-0');
        });

        it('diff-section container has overflow-auto for scrolling', () => {
            expect(source).toContain('overflow-auto');
            expect(source).toContain('data-testid="diff-section"');
        });

        it('scrollContainerRef is placed on the diff-section container', () => {
            // ref and diff-section data-testid must be on the same element
            expect(source).toMatch(/ref=\{scrollContainerRef\}[^>]*data-testid="diff-section"/);
        });
    });
});
