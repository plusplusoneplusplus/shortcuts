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

    describe('component signature — diff and metadata props', () => {
        it('accepts workspaceId prop', () => {
            expect(source).toContain('workspaceId: string');
        });

        it('accepts hash prop', () => {
            expect(source).toContain('hash: string');
        });

        it('accepts optional filePath prop', () => {
            expect(source).toContain('filePath?: string');
        });

        it('accepts optional subject prop', () => {
            expect(source).toContain('subject?: string');
        });

        it('accepts optional author prop', () => {
            expect(source).toContain('author?: string');
        });

        it('accepts optional date prop', () => {
            expect(source).toContain('date?: string');
        });

        it('accepts optional parentHashes prop', () => {
            expect(source).toContain('parentHashes?: string[]');
        });

        it('accepts optional body prop', () => {
            expect(source).toContain('body?: string');
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

        it('has commit-info-hash with short hash and Copy button', () => {
            expect(source).toContain('data-testid="commit-info-hash"');
            expect(source).toContain('data-testid="commit-info-copy-hash-btn"');
            expect(source).toContain('hash.substring(0, 8)');
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

        it('has handleCopyHash callback', () => {
            expect(source).toContain('handleCopyHash');
        });

        it('has Copied! feedback text', () => {
            expect(source).toContain('Copied!');
        });

        it('has body expand/collapse toggle', () => {
            expect(source).toContain('data-testid="commit-info-body-toggle"');
            expect(source).toContain('bodyExpanded');
            expect(source).toContain('Show more');
            expect(source).toContain('Show less');
        });

        it('conditionally renders metadata when hasMetadata is truthy', () => {
            expect(source).toContain('hasMetadata');
        });

        it('formats date using toLocaleString', () => {
            expect(source).toContain('toLocaleString');
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
    });

    describe('commit detail root', () => {
        it('has data-testid', () => {
            expect(source).toContain('data-testid="commit-detail"');
        });
    });
});
