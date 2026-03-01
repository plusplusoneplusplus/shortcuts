/**
 * Tests for CommitDetail component source structure.
 *
 * Validates exports, props, API usage, error handling, and rendering
 * of the commit detail expanded view.
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
    });

    describe('component signature', () => {
        it('accepts workspaceId prop', () => {
            expect(source).toContain('workspaceId: string');
        });

        it('accepts hash prop', () => {
            expect(source).toContain('hash: string');
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

    describe('diff API integration', () => {
        it('fetches from /git/commits/:hash/diff endpoint', () => {
            expect(source).toContain('/diff');
        });

        it('has View Full Diff button', () => {
            expect(source).toContain('View Full Diff');
            expect(source).toContain('data-testid="view-diff-btn"');
        });

        it('has Hide Diff toggle', () => {
            expect(source).toContain('Hide Diff');
        });

        it('renders diff content in a pre block', () => {
            expect(source).toContain('data-testid="diff-content"');
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
            // Error state is displayed, not swallowed
            expect(source).toContain('catch(err');
            expect(source).not.toContain('catch(() => setFiles([]))');
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
    });

    describe('commit detail root', () => {
        it('has data-testid', () => {
            expect(source).toContain('data-testid="commit-detail"');
        });
    });
});
