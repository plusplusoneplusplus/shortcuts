/**
 * Tests for FileTree component source structure.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

const COMPONENT_PATH = path.join(
    __dirname, '..', '..', '..', '..', '..', 'src', 'server', 'spa', 'client', 'react', 'repos', 'explorer', 'FileTree.tsx'
);

describe('FileTree', () => {
    let source: string;

    beforeAll(() => {
        source = fs.readFileSync(COMPONENT_PATH, 'utf-8');
    });

    describe('exports', () => {
        it('exports FileTree as a named export', () => {
            expect(source).toContain('export function FileTree');
        });

        it('exports FileTreeProps interface', () => {
            expect(source).toContain('export interface FileTreeProps');
        });

        it('exports flattenVisibleNodes helper', () => {
            expect(source).toContain('export function flattenVisibleNodes');
        });
    });

    describe('component signature', () => {
        it('accepts workspaceId prop', () => {
            expect(source).toContain('workspaceId: string');
        });

        it('accepts entries prop', () => {
            expect(source).toContain('entries: TreeEntry[]');
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

        it('accepts onSelect callback', () => {
            expect(source).toContain('onSelect: (path: string, isDirectory: boolean) => void');
        });

        it('accepts onToggle callback', () => {
            expect(source).toContain('onToggle: (path: string) => void');
        });

        it('accepts onChildrenLoaded callback', () => {
            expect(source).toContain('onChildrenLoaded: (parentPath: string, children: TreeEntry[]) => void');
        });

        it('accepts optional onFileOpen callback', () => {
            expect(source).toContain('onFileOpen?: (entry: TreeEntry) => void');
        });
    });

    describe('rendering', () => {
        it('has data-testid="file-tree"', () => {
            expect(source).toContain('data-testid="file-tree"');
        });

        it('has a scrollable container with data-testid', () => {
            expect(source).toContain('data-testid="file-tree-scroll"');
        });

        it('has overflow-y-auto on scroll container', () => {
            expect(source).toContain('overflow-y-auto');
        });

        it('applies tabIndex to enable keyboard focus', () => {
            expect(source).toContain('tabIndex={0}');
        });

        it('applies focus-visible outline', () => {
            expect(source).toContain('focus-visible:outline');
        });

        it('renders TreeNode components for root entries', () => {
            expect(source).toContain('<TreeNode');
            expect(source).toContain('depth={0}');
        });

        it('passes isFocused prop to TreeNode', () => {
            expect(source).toContain('isFocused=');
        });
    });

    describe('keyboard navigation', () => {
        it('attaches onKeyDown handler to scroll container', () => {
            expect(source).toContain('onKeyDown={handleKeyDown}');
        });

        it('handles ArrowDown key', () => {
            expect(source).toContain("case 'ArrowDown':");
        });

        it('handles ArrowUp key', () => {
            expect(source).toContain("case 'ArrowUp':");
        });

        it('handles ArrowRight key for directory expansion', () => {
            expect(source).toContain("case 'ArrowRight':");
        });

        it('handles ArrowLeft key for directory collapse', () => {
            expect(source).toContain("case 'ArrowLeft':");
        });

        it('handles Enter key for selection', () => {
            expect(source).toContain("case 'Enter':");
        });

        it('handles Space key for selection', () => {
            expect(source).toContain("case ' ':");
        });

        it('prevents default on arrow keys', () => {
            expect(source).toContain('e.preventDefault()');
        });

        it('maintains focusedIndex state', () => {
            expect(source).toContain('focusedIndex');
            expect(source).toContain('setFocusedIndex');
        });

        it('ArrowRight expands collapsed directory', () => {
            expect(source).toContain("node?.type === 'dir' && !expandedPaths.has(node.path)");
        });

        it('ArrowRight calls onFileOpen for file nodes', () => {
            expect(source).toContain("node?.type === 'file'");
            expect(source).toContain("onFileOpen?.(node)");
        });

        it('ArrowLeft collapses expanded directory', () => {
            expect(source).toContain("node?.type === 'dir' && expandedPaths.has(node.path)");
        });
    });
});

describe('flattenVisibleNodes', () => {
    let flattenFn: typeof import('../../../../../src/server/spa/client/react/repos/explorer/FileTree').flattenVisibleNodes;

    beforeAll(async () => {
        const mod = await import('../../../../../src/server/spa/client/react/repos/explorer/FileTree');
        flattenFn = mod.flattenVisibleNodes;
    });

    it('returns empty array for empty entries', () => {
        expect(flattenFn([], new Set(), new Map())).toEqual([]);
    });

    it('returns root entries when nothing is expanded', () => {
        const entries = [
            { name: 'a', type: 'file' as const, path: 'a' },
            { name: 'b', type: 'dir' as const, path: 'b' },
        ];
        const result = flattenFn(entries, new Set(), new Map());
        expect(result).toHaveLength(2);
        expect(result[0].path).toBe('a');
        expect(result[1].path).toBe('b');
    });

    it('includes children of expanded directories', () => {
        const entries = [
            { name: 'src', type: 'dir' as const, path: 'src' },
        ];
        const childrenMap = new Map([
            ['src', [
                { name: 'index.ts', type: 'file' as const, path: 'src/index.ts' },
                { name: 'util.ts', type: 'file' as const, path: 'src/util.ts' },
            ]],
        ]);
        const result = flattenFn(entries, new Set(['src']), childrenMap);
        expect(result).toHaveLength(3);
        expect(result[0].path).toBe('src');
        expect(result[1].path).toBe('src/index.ts');
        expect(result[2].path).toBe('src/util.ts');
    });

    it('does not include children of collapsed directories', () => {
        const entries = [
            { name: 'src', type: 'dir' as const, path: 'src' },
        ];
        const childrenMap = new Map([
            ['src', [
                { name: 'index.ts', type: 'file' as const, path: 'src/index.ts' },
            ]],
        ]);
        const result = flattenFn(entries, new Set(), childrenMap);
        expect(result).toHaveLength(1);
        expect(result[0].path).toBe('src');
    });

    it('handles nested expanded directories', () => {
        const entries = [
            { name: 'src', type: 'dir' as const, path: 'src' },
        ];
        const childrenMap = new Map([
            ['src', [{ name: 'lib', type: 'dir' as const, path: 'src/lib' }]],
            ['src/lib', [{ name: 'a.ts', type: 'file' as const, path: 'src/lib/a.ts' }]],
        ]);
        const result = flattenFn(entries, new Set(['src', 'src/lib']), childrenMap);
        expect(result).toHaveLength(3);
        expect(result[0].path).toBe('src');
        expect(result[1].path).toBe('src/lib');
        expect(result[2].path).toBe('src/lib/a.ts');
    });

    it('does not include children when childrenMap entry is missing', () => {
        const entries = [
            { name: 'src', type: 'dir' as const, path: 'src' },
        ];
        const result = flattenFn(entries, new Set(['src']), new Map());
        expect(result).toHaveLength(1);
    });
});
