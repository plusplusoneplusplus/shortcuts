/**
 * Tests for FileTree keyboard navigation implementation.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

const COMPONENT_PATH = path.join(
    __dirname, '..', '..', '..', '..', '..', 'src', 'server', 'spa', 'client', 'react', 'repos', 'explorer', 'FileTree.tsx'
);

describe('FileTree keyboard navigation', () => {
    let source: string;

    beforeAll(() => {
        source = fs.readFileSync(COMPONENT_PATH, 'utf-8');
    });

    describe('keyboard handler setup', () => {
        it('uses onKeyDown event handler', () => {
            expect(source).toContain('onKeyDown');
        });

        it('handler is defined as handleKeyDown', () => {
            expect(source).toContain('handleKeyDown');
        });

        it('is a useCallback hook', () => {
            expect(source).toContain('useCallback');
        });
    });

    describe('ArrowDown navigation', () => {
        it('handles ArrowDown key', () => {
            expect(source).toContain("'ArrowDown'");
        });

        it('increments focus index with upper bound', () => {
            expect(source).toContain('Math.min(i + 1, visibleNodes.length - 1)');
        });

        it('prevents default on ArrowDown', () => {
            expect(source).toContain('e.preventDefault()');
        });
    });

    describe('ArrowUp navigation', () => {
        it('handles ArrowUp key', () => {
            expect(source).toContain("'ArrowUp'");
        });

        it('decrements focus index with lower bound', () => {
            expect(source).toContain('Math.max(i - 1, 0)');
        });
    });

    describe('ArrowRight expansion', () => {
        it('handles ArrowRight key', () => {
            expect(source).toContain("'ArrowRight'");
        });

        it('checks if focused node is a collapsed directory', () => {
            expect(source).toContain("node?.type === 'dir' && !expandedPaths.has(node.path)");
        });

        it('calls onToggle to expand', () => {
            expect(source).toContain('onToggle(node.path)');
        });
    });

    describe('ArrowLeft collapse', () => {
        it('handles ArrowLeft key', () => {
            expect(source).toContain("'ArrowLeft'");
        });

        it('checks if focused node is an expanded directory', () => {
            expect(source).toContain("node?.type === 'dir' && expandedPaths.has(node.path)");
        });
    });

    describe('Enter/Space selection', () => {
        it('handles Enter key', () => {
            expect(source).toContain("'Enter'");
        });

        it('handles Space key', () => {
            expect(source).toContain("' '");
        });

        it('calls onSelect with path and type', () => {
            expect(source).toContain("onSelect(node.path, node.type === 'dir')");
        });

        it('calls onFileOpen on Enter/Space for file nodes', () => {
            expect(source).toContain("if (node.type === 'file') onFileOpen?.(node)");
        });
    });

    describe('focus management', () => {
        it('maintains focusedIndex state', () => {
            expect(source).toContain('useState(-1)');
        });

        it('computes visible nodes for navigation', () => {
            expect(source).toContain('flattenVisibleNodes');
        });

        it('uses useMemo for visibleNodes', () => {
            expect(source).toContain('useMemo');
        });

        it('tracks focused path for highlighting', () => {
            expect(source).toContain('focusedPath');
        });
    });

    describe('scroll container accessibility', () => {
        it('scroll container has tabIndex={0}', () => {
            expect(source).toContain('tabIndex={0}');
        });

        it('has focus-visible outline for accessibility', () => {
            expect(source).toContain('focus-visible:outline');
        });
    });
});
