/**
 * Tests for CommitList component source structure.
 *
 * Validates exports, props, rendering patterns, and accordion behavior.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

const COMPONENT_PATH = path.join(
    __dirname, '..', '..', '..', 'src', 'server', 'spa', 'client', 'react', 'repos', 'CommitList.tsx'
);

const INDEX_PATH = path.join(
    __dirname, '..', '..', '..', 'src', 'server', 'spa', 'client', 'react', 'repos', 'index.ts'
);

describe('CommitList', () => {
    let source: string;

    beforeAll(() => {
        source = fs.readFileSync(COMPONENT_PATH, 'utf-8');
    });

    describe('exports', () => {
        it('is exported from repos/index.ts', () => {
            const indexSource = fs.readFileSync(INDEX_PATH, 'utf-8');
            expect(indexSource).toContain("export { CommitList }");
            expect(indexSource).toContain("from './CommitList'");
        });

        it('exports CommitList as a named export', () => {
            expect(source).toContain('export function CommitList');
        });

        it('exports GitCommitItem interface', () => {
            expect(source).toContain('export interface GitCommitItem');
        });
    });

    describe('component signature', () => {
        it('accepts title prop', () => {
            expect(source).toContain('title: string');
        });

        it('accepts commits prop', () => {
            expect(source).toContain('commits: GitCommitItem[]');
        });

        it('accepts workspaceId prop', () => {
            expect(source).toContain('workspaceId: string');
        });

        it('accepts optional loading prop', () => {
            expect(source).toContain('loading?: boolean');
        });
    });

    describe('GitCommitItem interface', () => {
        it('has hash field', () => {
            expect(source).toContain('hash: string');
        });

        it('has shortHash field', () => {
            expect(source).toContain('shortHash: string');
        });

        it('has subject field', () => {
            expect(source).toContain('subject: string');
        });

        it('has author field', () => {
            expect(source).toContain('author: string');
        });

        it('has date field', () => {
            expect(source).toContain('date: string');
        });

        it('has parentHashes field', () => {
            expect(source).toContain('parentHashes: string[]');
        });
    });

    describe('accordion behavior', () => {
        it('tracks expanded hash state', () => {
            expect(source).toContain('expandedHash');
            expect(source).toContain('setExpandedHash');
        });

        it('toggles expansion on click', () => {
            expect(source).toContain('toggleExpand');
        });

        it('renders CommitDetail when expanded', () => {
            expect(source).toContain('<CommitDetail');
            expect(source).toContain("import { CommitDetail }");
        });
    });

    describe('rendering', () => {
        it('shows loading state', () => {
            expect(source).toContain('data-testid="commit-list-loading"');
        });

        it('shows empty state', () => {
            expect(source).toContain('data-testid="commit-list-empty"');
            expect(source).toContain('No commits');
        });

        it('displays short hash for each commit', () => {
            expect(source).toContain('commit.shortHash');
        });

        it('displays subject for each commit', () => {
            expect(source).toContain('commit.subject');
        });

        it('displays relative time using formatRelativeTime', () => {
            expect(source).toContain("import { formatRelativeTime }");
            expect(source).toContain('formatRelativeTime(commit.date)');
        });

        it('displays author for each commit', () => {
            expect(source).toContain('commit.author');
        });

        it('shows expand/collapse indicator', () => {
            expect(source).toContain('▼');
            expect(source).toContain('▶');
        });

        it('renders commit count in title', () => {
            expect(source).toContain('commits.length');
        });
    });
});
