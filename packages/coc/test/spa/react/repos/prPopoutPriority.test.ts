/**
 * Tests for prPopoutPriority helpers.
 */

import { describe, it, expect } from 'vitest';
import {
    computeCategoryCounts,
    sortFilesByPriority,
    pickPriorityFile,
    type FileBadgeLike,
} from '../../../../src/server/spa/client/react/features/git/diff/prPopoutPriority';
import type { FileChange } from '../../../../src/server/spa/client/react/features/git/diff/FileTree';
import type { HunkCategory } from '../../../../src/server/spa/client/react/features/pull-requests/classification-types';

function file(path: string, status = 'M'): FileChange {
    return { path, status };
}

function badges(map: Record<string, FileBadgeLike>): (p: string) => FileBadgeLike | undefined {
    return (p) => map[p];
}

describe('computeCategoryCounts', () => {
    const FILES: FileChange[] = [
        file('a.ts'), file('b.ts'), file('c.ts'),
        file('d.ts'), file('e.ts'), file('f.ts'),
    ];
    const badge = badges({
        'a.ts': { category: 'logic', intensity: 'high' },
        'b.ts': { category: 'logic', intensity: 'low' },
        'c.ts': { category: 'test', intensity: 'low' },
        'd.ts': { category: 'mechanical', intensity: 'low' },
        'e.ts': { category: 'simple', intensity: 'low' },
        // 'f.ts' unclassified
    });

    it('counts each category and the unclassified bucket', () => {
        const c = computeCategoryCounts(FILES, badge);
        expect(c).toEqual({
            logic: 2,
            mechanical: 1,
            test: 1,
            simple: 1,
            generated: 0,
            unclassified: 1,
            logicHigh: 1,
            total: 6,
        });
    });

    it('handles empty input', () => {
        const c = computeCategoryCounts([], badge);
        expect(c.total).toBe(0);
        expect(c.logic).toBe(0);
        expect(c.unclassified).toBe(0);
    });

    it('treats every file as unclassified when no badges exist', () => {
        const c = computeCategoryCounts(FILES, () => undefined);
        expect(c.unclassified).toBe(6);
        expect(c.logic).toBe(0);
    });
});

describe('sortFilesByPriority', () => {
    it('orders high logic > low logic > test > mechanical > simple > generated > unclassified', () => {
        const files = [
            file('gen.ts'),       // generated
            file('unk.ts'),       // unclassified
            file('simple.ts'),    // simple
            file('mech.ts'),      // mechanical
            file('logicLow.ts'),  // logic low
            file('logicHi.ts'),   // logic high
            file('test.ts'),      // test
        ];
        const badge = badges({
            'gen.ts': { category: 'generated', intensity: 'low' },
            'simple.ts': { category: 'simple', intensity: 'low' },
            'mech.ts': { category: 'mechanical', intensity: 'low' },
            'logicLow.ts': { category: 'logic', intensity: 'low' },
            'logicHi.ts': { category: 'logic', intensity: 'high' },
            'test.ts': { category: 'test', intensity: 'high' },
        });
        const out = sortFilesByPriority(files, { getFileBadge: badge });
        expect(out.map(f => f.path)).toEqual([
            'logicHi.ts',
            'logicLow.ts',
            'test.ts',
            'mech.ts',
            'simple.ts',
            'gen.ts',
            'unk.ts',
        ]);
    });

    it('pushes reviewed files to the end while preserving inner priority', () => {
        const files = [file('a.ts'), file('b.ts'), file('c.ts'), file('d.ts')];
        const badge = badges({
            'a.ts': { category: 'logic', intensity: 'high' },
            'b.ts': { category: 'logic', intensity: 'high' },
            'c.ts': { category: 'test', intensity: 'low' },
            'd.ts': { category: 'mechanical', intensity: 'low' },
        });
        const reviewed = new Set(['a.ts', 'd.ts']);
        const out = sortFilesByPriority(files, { getFileBadge: badge, reviewedFiles: reviewed });
        expect(out.map(f => f.path)).toEqual([
            'b.ts', // unreviewed logic high
            'c.ts', // unreviewed test
            'a.ts', // reviewed logic high
            'd.ts', // reviewed mechanical
        ]);
    });

    it('is stable for files in the same tier', () => {
        const files = [file('x.ts'), file('y.ts'), file('z.ts')];
        const badge = badges({
            'x.ts': { category: 'logic', intensity: 'low' },
            'y.ts': { category: 'logic', intensity: 'low' },
            'z.ts': { category: 'logic', intensity: 'low' },
        });
        const out = sortFilesByPriority(files, { getFileBadge: badge });
        expect(out.map(f => f.path)).toEqual(['x.ts', 'y.ts', 'z.ts']);
    });

    it('returns a new array (does not mutate the input)', () => {
        const files = [file('b.ts'), file('a.ts')];
        const badge = badges({
            'a.ts': { category: 'logic', intensity: 'high' },
            'b.ts': { category: 'mechanical', intensity: 'low' },
        });
        const out = sortFilesByPriority(files, { getFileBadge: badge });
        expect(files.map(f => f.path)).toEqual(['b.ts', 'a.ts']);
        expect(out.map(f => f.path)).toEqual(['a.ts', 'b.ts']);
    });
});

describe('pickPriorityFile', () => {
    const FILES: FileChange[] = [
        file('logicHi.ts'),
        file('logicLow.ts'),
        file('test.ts'),
        file('mech.ts'),
    ];
    const BADGES = badges({
        'logicHi.ts': { category: 'logic', intensity: 'high' },
        'logicLow.ts': { category: 'logic', intensity: 'low' },
        'test.ts': { category: 'test', intensity: 'low' },
        'mech.ts': { category: 'mechanical', intensity: 'low' },
    });

    it('next from null returns the highest-priority file', () => {
        const r = pickPriorityFile(FILES, { getFileBadge: BADGES }, {
            currentPath: null, direction: 'next',
        });
        expect(r).toEqual({ path: 'logicHi.ts', filtersIgnored: false });
    });

    it('next from current advances to the next priority file', () => {
        const r = pickPriorityFile(FILES, { getFileBadge: BADGES }, {
            currentPath: 'logicHi.ts', direction: 'next',
        });
        expect(r.path).toBe('logicLow.ts');
    });

    it('prev from null returns the lowest-priority file', () => {
        const r = pickPriorityFile(FILES, { getFileBadge: BADGES }, {
            currentPath: null, direction: 'prev',
        });
        expect(r.path).toBe('mech.ts');
    });

    it('returns null when at the end of the list with next', () => {
        const r = pickPriorityFile(FILES, { getFileBadge: BADGES }, {
            currentPath: 'mech.ts', direction: 'next',
        });
        expect(r.path).toBeNull();
    });

    it('returns null when at the start of the list with prev', () => {
        const r = pickPriorityFile(FILES, { getFileBadge: BADGES }, {
            currentPath: 'logicHi.ts', direction: 'prev',
        });
        expect(r.path).toBeNull();
    });

    it('skips reviewed files (puts them after unreviewed in candidate order)', () => {
        const reviewed = new Set(['logicHi.ts']);
        // current is the reviewed file → next should jump to next unreviewed in candidate list.
        // Candidate order: [logicLow, test, mech, logicHi].
        const r = pickPriorityFile(FILES, { getFileBadge: BADGES, reviewedFiles: reviewed }, {
            currentPath: 'logicHi.ts', direction: 'next',
        });
        // logicHi is last; next returns null.
        expect(r.path).toBeNull();
        const r2 = pickPriorityFile(FILES, { getFileBadge: BADGES, reviewedFiles: reviewed }, {
            currentPath: null, direction: 'next',
        });
        expect(r2.path).toBe('logicLow.ts');
    });

    it('respects active filters', () => {
        const filters = new Set<HunkCategory>(['logic']);
        const r = pickPriorityFile(FILES, { getFileBadge: BADGES }, {
            currentPath: 'logicHi.ts', direction: 'next', activeFilters: filters,
        });
        expect(r).toEqual({ path: 'logicLow.ts', filtersIgnored: false });
        const r2 = pickPriorityFile(FILES, { getFileBadge: BADGES }, {
            currentPath: 'logicLow.ts', direction: 'next', activeFilters: filters,
        });
        expect(r2.path).toBeNull();
    });

    it('falls back to ignoring filters when filters trap the user (no matches)', () => {
        // Filter for 'generated', but no file is generated.
        const filters = new Set<HunkCategory>(['generated']);
        const r = pickPriorityFile(FILES, { getFileBadge: BADGES }, {
            currentPath: null, direction: 'next', activeFilters: filters,
        });
        expect(r.filtersIgnored).toBe(true);
        expect(r.path).toBe('logicHi.ts');
    });

    it('returns null when there are no files at all', () => {
        const r = pickPriorityFile([], { getFileBadge: () => undefined }, {
            currentPath: null, direction: 'next',
        });
        expect(r.path).toBeNull();
    });

    it('handles unclassified files (no badges) — uses input order', () => {
        const files = [file('a.ts'), file('b.ts'), file('c.ts')];
        const r = pickPriorityFile(files, { getFileBadge: () => undefined }, {
            currentPath: 'a.ts', direction: 'next',
        });
        expect(r.path).toBe('b.ts');
    });
});
