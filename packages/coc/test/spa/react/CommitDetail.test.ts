/**
 * Tests for CommitDetail component source structure.
 *
 * Validates exports, props, diff-only rendering (no header/metadata/file list),
 * per-file diff support, error handling with retry, and the simplified API.
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

    describe('component signature — diff-only props', () => {
        it('accepts workspaceId prop', () => {
            expect(source).toContain('workspaceId: string');
        });

        it('accepts hash prop', () => {
            expect(source).toContain('hash: string');
        });

        it('accepts optional filePath prop', () => {
            expect(source).toContain('filePath?: string');
        });

        it('does NOT accept subject prop', () => {
            expect(source).not.toMatch(/^\s+subject:\s+string/m);
        });

        it('does NOT accept author prop', () => {
            expect(source).not.toMatch(/^\s+author:\s+string/m);
        });

        it('does NOT accept date prop', () => {
            expect(source).not.toMatch(/^\s+date:\s+string/m);
        });

        it('does NOT accept parentHashes prop', () => {
            expect(source).not.toContain('parentHashes: string[]');
        });

        it('does NOT accept body prop', () => {
            expect(source).not.toContain('body?: string');
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
            expect(source).toContain("import { UnifiedDiffViewer } from './UnifiedDiffViewer'");
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

    describe('removed sections — metadata moved to left panel', () => {
        it('does NOT have commit-detail-header', () => {
            expect(source).not.toContain('data-testid="commit-detail-header"');
        });

        it('does NOT have commit-body section', () => {
            expect(source).not.toContain('data-testid="commit-body"');
        });

        it('does NOT have file-change-list section', () => {
            expect(source).not.toContain('data-testid="file-change-list"');
        });

        it('does NOT have files-loading indicator', () => {
            expect(source).not.toContain('data-testid="files-loading"');
        });

        it('does NOT have files-error indicator', () => {
            expect(source).not.toContain('data-testid="files-error"');
        });

        it('does NOT have no-files-changed indicator', () => {
            expect(source).not.toContain('data-testid="no-files-changed"');
        });

        it('does NOT have Copy Hash button', () => {
            expect(source).not.toContain('Copy Hash');
            expect(source).not.toContain('data-testid="copy-hash-btn"');
        });

        it('does NOT import copyToClipboard', () => {
            expect(source).not.toContain('copyToClipboard');
        });
    });

    describe('commit detail root', () => {
        it('has data-testid', () => {
            expect(source).toContain('data-testid="commit-detail"');
        });
    });
});
