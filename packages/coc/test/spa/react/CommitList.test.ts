/**
 * Tests for CommitList component source structure.
 *
 * Validates exports, props, single-select behavior, keyboard navigation,
 * hover tooltip, expandable file list, and rendering patterns.
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

        it('accepts optional onFileSelect callback', () => {
            expect(source).toContain('onFileSelect?: (hash: string, filePath: string) => void');
        });

        it('accepts optional workspaceId prop', () => {
            expect(source).toContain('workspaceId?: string');
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
    });

    describe('expandable file list', () => {
        it('tracks expandedHash state', () => {
            expect(source).toContain('expandedHash');
            expect(source).toContain('setExpandedHash');
        });

        it('caches fetched files by hash', () => {
            expect(source).toContain('fileCache');
            expect(source).toContain('setFileCache');
        });

        it('tracks filesLoading state', () => {
            expect(source).toContain('filesLoading');
            expect(source).toContain('setFilesLoading');
        });

        it('fetches files from /git/commits/:hash/files API', () => {
            expect(source).toContain('/git/commits/');
            expect(source).toContain('/files');
        });

        it('imports fetchApi for file list fetching', () => {
            expect(source).toContain("import { fetchApi }");
        });

        it('toggles expand/collapse on commit click via handleCommitClick', () => {
            expect(source).toContain('handleCommitClick');
            expect(source).toContain('expandedHash === commit.hash');
        });

        it('renders expanded file list section with data-testid', () => {
            expect(source).toContain('commit-files-');
        });

        it('has commit-files-loading indicator', () => {
            expect(source).toContain('data-testid="commit-files-loading"');
        });

        it('has commit-file-list data-testid', () => {
            expect(source).toContain('data-testid="commit-file-list"');
        });

        it('calls onFileSelect when a file is clicked', () => {
            expect(source).toContain('onFileSelect?.(commit.hash, f.path)');
        });

        it('shows file status badge (A/M/D)', () => {
            expect(source).toContain('f.status');
        });

        it('shows file path', () => {
            expect(source).toContain('f.path');
        });

        it('has status labels for file changes', () => {
            expect(source).toContain("A: 'Added'");
            expect(source).toContain("M: 'Modified'");
            expect(source).toContain("D: 'Deleted'");
        });

        it('has status colors for file changes', () => {
            expect(source).toContain("A: 'text-[#16825d]'");
            expect(source).toContain("M: 'text-[#0078d4]'");
            expect(source).toContain("D: 'text-[#d32f2f]'");
        });

        it('only fetches files when workspaceId is provided', () => {
            expect(source).toContain('workspaceId');
            expect(source).toContain('!fileCache[commit.hash] && workspaceId');
        });
    });

    describe('hover tooltip', () => {
        it('tracks hoveredCommit state', () => {
            expect(source).toContain('hoveredCommit');
            expect(source).toContain('setHoveredCommit');
        });

        it('tracks tooltipAnchorRect state', () => {
            expect(source).toContain('tooltipAnchorRect');
            expect(source).toContain('setTooltipAnchorRect');
        });

        it('uses 250ms hover delay', () => {
            expect(source).toContain('250');
        });

        it('has handleRowMouseEnter callback', () => {
            expect(source).toContain('handleRowMouseEnter');
        });

        it('has handleRowMouseLeave callback', () => {
            expect(source).toContain('handleRowMouseLeave');
        });

        it('clears timer on mouse leave', () => {
            expect(source).toContain('clearTimeout(hoverTimerRef.current)');
        });

        it('cleans up timer on unmount', () => {
            expect(source).toContain('if (hoverTimerRef.current) clearTimeout(hoverTimerRef.current)');
        });

        it('renders CommitTooltip when hovered', () => {
            expect(source).toContain('<CommitTooltip');
        });

        it('imports CommitTooltip', () => {
            expect(source).toContain("import { CommitTooltip } from './CommitTooltip'");
        });

        it('attaches onMouseEnter to commit rows', () => {
            expect(source).toContain('onMouseEnter');
        });

        it('attaches onMouseLeave to commit rows', () => {
            expect(source).toContain('onMouseLeave');
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
