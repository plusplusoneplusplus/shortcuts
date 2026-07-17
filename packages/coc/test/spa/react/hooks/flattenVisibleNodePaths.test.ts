/**
 * flattenVisibleNodePaths — unit tests for the utility function.
 *
 * The flattened list drives Shift+Click range selection, so it must include
 * BOTH folder rows and page rows in the same order they render (AC-02).
 */

import { describe, it, expect } from 'vitest';
import { flattenVisibleNodePaths } from '../../../../src/server/spa/client/react/features/notes/editor/NotesSidebar';
import type { NoteTreeNode } from '../../../../src/server/spa/client/react/features/notes/notesApi';

const TREE: NoteTreeNode[] = [
    {
        name: 'NB1',
        path: 'NB1',
        type: 'notebook',
        children: [
            { name: 'a.md', path: 'NB1/a.md', type: 'page' },
            {
                name: 'sec',
                path: 'NB1/sec',
                type: 'section',
                children: [
                    { name: 'b.md', path: 'NB1/sec/b.md', type: 'page' },
                    { name: 'c.md', path: 'NB1/sec/c.md', type: 'page' },
                ],
            },
            { name: 'd.md', path: 'NB1/d.md', type: 'page' },
        ],
    },
    { name: 'e.md', path: 'e.md', type: 'page' },
];

describe('flattenVisibleNodePaths', () => {
    it('returns folder and page paths in render order when everything is expanded', () => {
        const expanded = new Set(['NB1', 'NB1/sec']);
        const result = flattenVisibleNodePaths(TREE, expanded);
        expect(result).toEqual([
            'NB1',
            'NB1/a.md',
            'NB1/sec',
            'NB1/sec/b.md',
            'NB1/sec/c.md',
            'NB1/d.md',
            'e.md',
        ]);
    });

    it('includes a collapsed folder row but skips its children', () => {
        const expanded = new Set(['NB1']); // NB1/sec is collapsed
        const result = flattenVisibleNodePaths(TREE, expanded);
        expect(result).toEqual(['NB1', 'NB1/a.md', 'NB1/sec', 'NB1/d.md', 'e.md']);
    });

    it('returns only top-level rows when nothing is expanded', () => {
        const expanded = new Set<string>();
        const result = flattenVisibleNodePaths(TREE, expanded);
        expect(result).toEqual(['NB1', 'e.md']);
    });

    it('respects visiblePaths filter for both folders and pages', () => {
        const expanded = new Set(['NB1', 'NB1/sec']);
        const visible = new Set(['NB1', 'NB1/sec', 'NB1/sec/b.md', 'e.md']);
        const result = flattenVisibleNodePaths(TREE, expanded, visible);
        expect(result).toEqual(['NB1', 'NB1/sec', 'NB1/sec/b.md', 'e.md']);
    });

    it('returns empty array for empty tree', () => {
        expect(flattenVisibleNodePaths([], new Set())).toEqual([]);
    });

    it('supports a range that spans folders and pages (AC-02)', () => {
        // Simulate what handleSelectWithModifiers does: build the range slice
        // between an anchor and a Shift+Click target from the flat list.
        const flat = flattenVisibleNodePaths(TREE, new Set(['NB1', 'NB1/sec']));
        const anchor = 'NB1/a.md';
        const target = 'NB1/d.md';
        const start = Math.min(flat.indexOf(anchor), flat.indexOf(target));
        const end = Math.max(flat.indexOf(anchor), flat.indexOf(target));
        const range = flat.slice(start, end + 1);
        // The range must pull in the intervening folder row plus its pages.
        expect(range).toEqual(['NB1/a.md', 'NB1/sec', 'NB1/sec/b.md', 'NB1/sec/c.md', 'NB1/d.md']);
        expect(range).toContain('NB1/sec');
    });
});
