/**
 * Tests for CommitList component source structure.
 *
 * Validates exports, props, single-select behavior, keyboard navigation,
 * and rendering patterns.
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

        it('accepts optional selectedHash prop', () => {
            expect(source).toContain('selectedHash');
        });

        it('accepts optional onSelect callback', () => {
            expect(source).toContain('onSelect');
        });

        it('accepts optional loading prop', () => {
            expect(source).toContain('loading?: boolean');
        });

        it('accepts optional defaultCollapsed prop', () => {
            expect(source).toContain('defaultCollapsed?: boolean');
        });

        it('accepts optional showEmpty prop', () => {
            expect(source).toContain('showEmpty?: boolean');
        });

        it('accepts optional emptyMessage prop', () => {
            expect(source).toContain('emptyMessage?: string');
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

        it('has optional body field', () => {
            expect(source).toContain('body?: string');
        });
    });

    describe('single-select behavior', () => {
        it('uses selectedHash for selection state', () => {
            expect(source).toContain('selectedHash');
        });

        it('calls onSelect when a commit row is clicked', () => {
            expect(source).toContain('onSelect');
        });

        it('shows filled dot for selected commit', () => {
            expect(source).toContain('●');
        });

        it('shows hollow dot for unselected commit', () => {
            expect(source).toContain('○');
        });

        it('applies selected background style', () => {
            expect(source).toContain('bg-blue-50');
            expect(source).toContain('dark:bg-blue-900/20');
        });

        it('does not use accordion expand/collapse', () => {
            expect(source).not.toContain('expandedHash');
            expect(source).not.toContain('toggleExpand');
        });

        it('does not render CommitDetail inline', () => {
            expect(source).not.toContain('<CommitDetail');
        });
    });

    describe('keyboard navigation', () => {
        it('handles ArrowDown key', () => {
            expect(source).toContain('ArrowDown');
        });

        it('handles ArrowUp key', () => {
            expect(source).toContain('ArrowUp');
        });

        it('has onKeyDown handler', () => {
            expect(source).toContain('onKeyDown');
        });

        it('uses listbox role for accessibility', () => {
            expect(source).toContain('role="listbox"');
        });

        it('uses option role on rows', () => {
            expect(source).toContain('role="option"');
        });

        it('sets aria-selected on rows', () => {
            expect(source).toContain('aria-selected');
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

        it('renders commit count in title', () => {
            expect(source).toContain('commits.length');
        });

        it('has sticky section headers', () => {
            expect(source).toContain('sticky');
        });

        it('scrolls selected row into view', () => {
            expect(source).toContain('scrollIntoView');
        });
    });

    describe('collapse behavior', () => {
        it('tracks collapsed state', () => {
            expect(source).toContain('const [collapsed, setCollapsed] = useState(defaultCollapsed)');
        });

        it('uses defaultCollapsed prop for initial state', () => {
            expect(source).toContain('defaultCollapsed = false');
        });

        it('renders header as a clickable button', () => {
            expect(source).toContain('<button');
            expect(source).toContain('onClick={() => setCollapsed(prev => !prev)');
        });

        it('shows expand/collapse chevron indicators', () => {
            expect(source).toContain('▶');
            expect(source).toContain('▼');
        });

        it('has toggle data-testid', () => {
            expect(source).toContain('-toggle');
        });

        it('hides content when collapsed', () => {
            expect(source).toContain('!collapsed &&');
        });
    });

    describe('empty state with showEmpty', () => {
        it('renders custom emptyMessage when showEmpty is true', () => {
            expect(source).toContain('showEmpty ?');
        });

        it('falls back to default message when emptyMessage is not provided', () => {
            expect(source).toContain("emptyMessage || 'No commits'");
        });

        it('uses italic styling for custom empty state', () => {
            expect(source).toContain('italic');
        });

        it('uses dimmed text styling when empty', () => {
            expect(source).toContain("isDimmed ? 'text-[#848484]'");
        });
    });
});
