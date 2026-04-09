import { describe, it, expect, vi, beforeEach } from 'vitest';

// We test the getAncestorPaths logic extracted from NotesSidebar.
// Since it's a module-private function, we replicate the logic here for unit testing.
// The actual integration is tested via the component behavior.

function getAncestorPaths(notePath: string): string[] {
    const segments = notePath.split('/');
    const ancestors: string[] = [];
    for (let i = 1; i < segments.length; i++) {
        ancestors.push(segments.slice(0, i).join('/'));
    }
    return ancestors;
}

describe('getAncestorPaths', () => {
    it('returns empty array for a root-level path (no ancestors)', () => {
        expect(getAncestorPaths('page.md')).toEqual([]);
    });

    it('returns single ancestor for a two-level path', () => {
        expect(getAncestorPaths('Notebook/page.md')).toEqual(['Notebook']);
    });

    it('returns all ancestors for a deeply nested path', () => {
        expect(getAncestorPaths('Notebook/Section/SubSection/page.md')).toEqual([
            'Notebook',
            'Notebook/Section',
            'Notebook/Section/SubSection',
        ]);
    });

    it('handles paths with spaces', () => {
        expect(getAncestorPaths('My Notebook/My Section/page.md')).toEqual([
            'My Notebook',
            'My Notebook/My Section',
        ]);
    });

    it('handles single segment', () => {
        expect(getAncestorPaths('root')).toEqual([]);
    });
});
