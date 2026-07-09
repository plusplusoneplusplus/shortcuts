/**
 * Tests for TreeNode component source structure.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

const COMPONENT_PATH = path.join(
    __dirname, '..', '..', '..', '..', '..', 'src', 'server', 'spa', 'client', 'react', 'features', 'repo-detail', 'explorer', 'TreeNode.tsx'
);

describe('TreeNode', () => {
    let source: string;

    beforeAll(() => {
        source = fs.readFileSync(COMPONENT_PATH, 'utf-8');
    });

    describe('exports', () => {
        it('exports TreeNode as a named export', () => {
            expect(source).toContain('export function TreeNode');
        });

        it('exports TreeNodeProps interface', () => {
            expect(source).toContain('export interface TreeNodeProps');
        });
    });

    describe('component signature', () => {
        it('accepts entry prop', () => {
            expect(source).toContain('entry: TreeEntry');
        });

        it('accepts depth prop', () => {
            expect(source).toContain('depth: number');
        });

        it('accepts workspaceId prop', () => {
            expect(source).toContain('workspaceId: string');
        });

        it('accepts selectedPath prop', () => {
            expect(source).toContain('selectedPath: string | null');
        });

        it('accepts expandedPaths prop', () => {
            expect(source).toContain('expandedPaths: Set<string>');
        });

        it('accepts childrenMap prop', () => {
            expect(source).toContain('childrenMap: Map<string, TreeEntry[]>');
        });

        it('accepts isFocused prop', () => {
            expect(source).toContain('isFocused');
        });

        it('accepts optional onFileOpen callback', () => {
            expect(source).toContain('onFileOpen?: (entry: TreeEntry) => void');
        });
    });

    describe('file-type icons', () => {
        it('uses folder icon for directories', () => {
            expect(source).toContain("'📁'");
        });

        it('uses note icon for markdown files', () => {
            expect(source).toContain("'📝'");
        });

        it('uses document icon for JS/TS files', () => {
            expect(source).toContain("'📄'");
        });

        it('uses gear icon for config files', () => {
            expect(source).toContain("'⚙️'");
        });

        it('uses image icon for image files', () => {
            expect(source).toContain("'🖼️'");
        });

        it('checks for .md extension', () => {
            expect(source).toContain('.md');
        });

        it('checks for .ts extension', () => {
            expect(source).toContain('.ts');
        });

        it('checks for .json extension', () => {
            expect(source).toContain('.json');
        });

        it('checks for .yaml extension', () => {
            expect(source).toContain('.yaml');
        });

        it('checks for .png extension', () => {
            expect(source).toContain('.png');
        });

        it('checks for .svg extension', () => {
            expect(source).toContain('.svg');
        });
    });

    describe('rendering', () => {
        it('has data-testid with entry path', () => {
            expect(source).toContain('data-testid={`tree-node-${entry.path}`}');
        });

        it('has data-tree-index attribute', () => {
            expect(source).toContain('data-tree-index');
        });

        it('applies depth-based indentation via paddingLeft', () => {
            expect(source).toContain('paddingLeft');
            expect(source).toContain('depth * 16');
        });

        it('uses chevron for directory expand/collapse', () => {
            expect(source).toContain('▶');
        });

        it('applies rotate-90 when expanded', () => {
            expect(source).toContain('rotate-90');
        });

        it('applies selected styling with accent color', () => {
            expect(source).toContain('bg-[#0078d4]/10');
            expect(source).toContain('dark:bg-[#3794ff]/10');
        });

        it('applies an explicit legible foreground for unselected rows (dark-mode readability)', () => {
            // Regression: without an explicit color the row inherits the near-black
            // app default, which is invisible on the dark sidebar background.
            expect(source).toContain('text-[#1e1e1e] dark:text-[#cccccc]');
        });

        it('does not stack two text-color classes on selected rows (cn has no tailwind-merge)', () => {
            // The base foreground must be gated behind the unselected branch so a
            // selected row carries only the accent color, not both.
            expect(source).not.toMatch(/text-\[#1e1e1e\] dark:text-\[#cccccc\][^']*text-\[#0078d4\]/);
            expect(source).toContain("? 'bg-[#0078d4]/10 dark:bg-[#3794ff]/10 text-[#0078d4] dark:text-[#3794ff]'");
        });

        it('applies hover styling', () => {
            expect(source).toContain('hover:bg-black/[0.04]');
            expect(source).toContain('dark:hover:bg-white/[0.04]');
        });

        it('applies focused ring styling', () => {
            expect(source).toContain('ring-1 ring-[#0078d4]/50');
        });

        it('shows Spinner while loading', () => {
            expect(source).toContain('<Spinner size="sm"');
        });
    });

    describe('lazy loading', () => {
        it('fetches from the tree API endpoint', () => {
            expect(source).toContain('explorerApi.tree(workspaceId');
            expect(source).toContain('path: entry.path');
        });

        it('calls onChildrenLoaded after fetch', () => {
            expect(source).toContain('onChildrenLoaded(entry.path, data.entries)');
        });

        it('uses explorerApi for API calls', () => {
            expect(source).toContain("import { explorerApi } from './explorerApi'");
        });

        it('handles cancellation on unmount', () => {
            expect(source).toContain('cancelled = true');
        });
    });

    describe('recursive rendering', () => {
        it('renders child TreeNode components recursively', () => {
            expect(source).toContain('<TreeNode');
            expect(source).toContain('depth={depth + 1}');
        });

        it('only renders children when expanded and loaded', () => {
            expect(source).toContain('isExpanded && children &&');
        });
    });

    describe('interaction', () => {
        it('calls onToggle for directory clicks', () => {
            expect(source).toContain('onToggle(entry.path)');
        });

        it('calls onSelect on click', () => {
            expect(source).toContain('onSelect(entry.path, isDir)');
        });

        it('scrolls focused node into view', () => {
            expect(source).toContain("scrollIntoView({ block: 'nearest' })");
        });

        it('has onDoubleClick handler for file open (accessibility fallback)', () => {
            expect(source).toContain('onDoubleClick');
            expect(source).toContain('onFileOpen?.(entry)');
        });

        it('fires onFileOpen on single-click for files, not directories', () => {
            // handleClick opens files (non-directories) on single-click
            expect(source).toContain('} else {');
            expect(source).toContain('onFileOpen?.(entry)');
            // Verify it's inside handleClick (not just in onDoubleClick)
            const handleClickBlock = source.slice(source.indexOf('const handleClick'), source.indexOf('onSelect(entry.path, isDir)'));
            expect(handleClickBlock).toContain('onFileOpen?.(entry)');
        });
    });
});
