/**
 * Tests for CommitDetail component source structure.
 *
 * Validates exports, props, API usage, always-visible diff,
 * error handling with retry, and rendering of the commit detail panel.
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

    describe('component signature', () => {
        it('accepts workspaceId prop', () => {
            expect(source).toContain('workspaceId: string');
        });

        it('accepts hash prop', () => {
            expect(source).toContain('hash: string');
        });

        it('accepts subject prop', () => {
            expect(source).toContain('subject: string');
        });

        it('accepts author prop', () => {
            expect(source).toContain('author: string');
        });

        it('accepts date prop', () => {
            expect(source).toContain('date: string');
        });

        it('accepts parentHashes prop', () => {
            expect(source).toContain('parentHashes: string[]');
        });

        it('accepts optional body prop', () => {
            expect(source).toContain('body?: string');
        });
    });

    describe('files API integration', () => {
        it('fetches from /git/commits/:hash/files endpoint', () => {
            expect(source).toContain('/git/commits/');
            expect(source).toContain('/files');
        });

        it('imports fetchApi', () => {
            expect(source).toContain("import { fetchApi }");
        });
    });

    describe('diff API integration — always visible', () => {
        it('fetches from /git/commits/:hash/diff endpoint', () => {
            expect(source).toContain('/diff');
        });

        it('auto-fetches diff on mount (no toggle button)', () => {
            // Diff is fetched in a useEffect, not on button click
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

    describe('error handling', () => {
        it('tracks files error state', () => {
            expect(source).toContain('filesError');
            expect(source).toContain('setFilesError');
        });

        it('tracks diff error state', () => {
            expect(source).toContain('diffError');
            expect(source).toContain('setDiffError');
        });

        it('shows visible error for files loading failure', () => {
            expect(source).toContain('data-testid="files-error"');
        });

        it('shows visible error for diff loading failure', () => {
            expect(source).toContain('data-testid="diff-error"');
        });

        it('does NOT silently catch errors', () => {
            expect(source).toContain('catch(err');
            expect(source).not.toContain('catch(() => setFiles([]))');
        });
    });

    describe('header bar', () => {
        it('has header section with data-testid', () => {
            expect(source).toContain('data-testid="commit-detail-header"');
        });

        it('displays commit subject as title', () => {
            expect(source).toContain('{subject}');
        });

        it('displays short hash badge', () => {
            expect(source).toContain('hash.substring(0, 8)');
        });
    });

    describe('metadata rendering', () => {
        it('displays author name', () => {
            expect(source).toContain('{author}');
        });

        it('displays formatted date', () => {
            expect(source).toContain('formattedDate');
        });

        it('displays parent hashes', () => {
            expect(source).toContain('parentHashes');
        });

        it('has Copy Hash button', () => {
            expect(source).toContain('Copy Hash');
            expect(source).toContain('data-testid="copy-hash-btn"');
        });

        it('imports copyToClipboard utility', () => {
            expect(source).toContain("import { copyToClipboard }");
        });

        it('shows Copied! feedback', () => {
            expect(source).toContain('Copied!');
        });
    });

    describe('file change list', () => {
        it('shows files changed count', () => {
            expect(source).toContain('files.length');
            expect(source).toContain('file');
            expect(source).toContain('changed');
        });

        it('renders file status (A/M/D)', () => {
            expect(source).toContain('f.status');
        });

        it('renders file path', () => {
            expect(source).toContain('f.path');
        });

        it('has status labels for Added, Modified, Deleted', () => {
            expect(source).toContain("A: 'Added'");
            expect(source).toContain("M: 'Modified'");
            expect(source).toContain("D: 'Deleted'");
        });

        it('has data-testid for file change list', () => {
            expect(source).toContain('data-testid="file-change-list"');
        });

        it('has loading state for files', () => {
            expect(source).toContain('data-testid="files-loading"');
        });

        it('shows empty state when no files changed', () => {
            expect(source).toContain('No files changed');
            expect(source).toContain('data-testid="no-files-changed"');
        });
    });

    describe('commit body / description', () => {
        it('has commit body section with data-testid', () => {
            expect(source).toContain('data-testid="commit-body"');
        });

        it('only renders body when present', () => {
            expect(source).toContain('{body}');
            expect(source).toContain('body &&');
        });

        it('renders body text in a pre element with word wrap', () => {
            expect(source).toContain('whitespace-pre-wrap');
        });
    });

    describe('commit detail root', () => {
        it('has data-testid', () => {
            expect(source).toContain('data-testid="commit-detail"');
        });
    });
});
