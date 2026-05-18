/**
 * flattenVisiblePagePaths — unit tests for the utility function.
 */

import { describe, it, expect } from 'vitest';
import { flattenVisiblePagePaths } from '../../../../src/server/spa/client/react/features/notes/editor/NotesSidebar';
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

describe('flattenVisiblePagePaths', () => {
    it('returns all page paths when everything is expanded', () => {
        const expanded = new Set(['NB1', 'NB1/sec']);
        const result = flattenVisiblePagePaths(TREE, expanded);
        expect(result).toEqual([
            'NB1/a.md',
            'NB1/sec/b.md',
            'NB1/sec/c.md',
            'NB1/d.md',
            'e.md',
        ]);
    });

    it('skips children of collapsed folders', () => {
        const expanded = new Set(['NB1']); // NB1/sec is collapsed
        const result = flattenVisiblePagePaths(TREE, expanded);
        expect(result).toEqual(['NB1/a.md', 'NB1/d.md', 'e.md']);
    });

    it('returns only root-level pages when nothing is expanded', () => {
        const expanded = new Set<string>();
        const result = flattenVisiblePagePaths(TREE, expanded);
        expect(result).toEqual(['e.md']);
    });

    it('respects visiblePaths filter', () => {
        const expanded = new Set(['NB1', 'NB1/sec']);
        const visible = new Set(['NB1', 'NB1/sec', 'NB1/sec/b.md', 'e.md']);
        const result = flattenVisiblePagePaths(TREE, expanded, visible);
        expect(result).toEqual(['NB1/sec/b.md', 'e.md']);
    });

    it('returns empty array for empty tree', () => {
        expect(flattenVisiblePagePaths([], new Set())).toEqual([]);
    });
});
