/**
 * Tests for filterEntries and hasMatchingDescendant helper functions.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import type { TreeEntry } from '../../../../../src/server/spa/client/react/repos/explorer/types';

describe('filterEntries', () => {
    let filterFn: typeof import('../../../../../src/server/spa/client/react/repos/explorer/FileTree').filterEntries;
    let hasMatchFn: typeof import('../../../../../src/server/spa/client/react/repos/explorer/FileTree').hasMatchingDescendant;

    beforeAll(async () => {
        const mod = await import('../../../../../src/server/spa/client/react/repos/explorer/FileTree');
        filterFn = mod.filterEntries;
        hasMatchFn = mod.hasMatchingDescendant;
    });

    const entries: TreeEntry[] = [
        { name: 'src', type: 'dir', path: 'src' },
        { name: 'README.md', type: 'file', path: 'README.md' },
        { name: 'package.json', type: 'file', path: 'package.json' },
        { name: 'dist', type: 'dir', path: 'dist' },
    ];

    const childrenMap = new Map<string, TreeEntry[]>([
        ['src', [
            { name: 'index.ts', type: 'file', path: 'src/index.ts' },
            { name: 'utils', type: 'dir', path: 'src/utils' },
        ]],
        ['src/utils', [
            { name: 'helper.ts', type: 'file', path: 'src/utils/helper.ts' },
        ]],
        ['dist', [
            { name: 'bundle.js', type: 'file', path: 'dist/bundle.js' },
        ]],
    ]);

    it('returns all entries when query is empty', () => {
        expect(filterFn(entries, '', childrenMap)).toEqual(entries);
    });

    it('filters files by case-insensitive name match', () => {
        const result = filterFn(entries, 'readme', childrenMap);
        expect(result).toHaveLength(1);
        expect(result[0].name).toBe('README.md');
    });

    it('keeps directories whose name matches', () => {
        const result = filterFn(entries, 'src', childrenMap);
        expect(result.some(e => e.name === 'src')).toBe(true);
    });

    it('keeps directories with matching cached descendants', () => {
        const result = filterFn(entries, 'index', childrenMap);
        expect(result.some(e => e.name === 'src')).toBe(true);
    });

    it('keeps un-fetched directories (benefit of the doubt)', () => {
        const sparseMap = new Map<string, TreeEntry[]>();
        // 'src' has no entry in sparseMap => unfetched
        const result = filterFn(entries, 'xyz', sparseMap);
        // Both 'src' and 'dist' should remain (unfetched dirs)
        expect(result.some(e => e.name === 'src')).toBe(true);
        expect(result.some(e => e.name === 'dist')).toBe(true);
    });

    it('removes files that do not match', () => {
        const result = filterFn(entries, 'package', childrenMap);
        expect(result.some(e => e.name === 'README.md')).toBe(false);
    });

    it('removes directories that have no matching descendants and name does not match', () => {
        const result = filterFn(entries, 'readme', childrenMap);
        expect(result.some(e => e.name === 'src')).toBe(false);
        expect(result.some(e => e.name === 'dist')).toBe(false);
    });

    describe('hasMatchingDescendant', () => {
        it('returns true when a direct child matches', () => {
            const dir: TreeEntry = { name: 'src', type: 'dir', path: 'src' };
            expect(hasMatchFn(dir, 'index', childrenMap)).toBe(true);
        });

        it('returns true when a nested descendant matches', () => {
            const dir: TreeEntry = { name: 'src', type: 'dir', path: 'src' };
            expect(hasMatchFn(dir, 'helper', childrenMap)).toBe(true);
        });

        it('returns false when no descendant matches', () => {
            const dir: TreeEntry = { name: 'dist', type: 'dir', path: 'dist' };
            expect(hasMatchFn(dir, 'index', childrenMap)).toBe(false);
        });

        it('returns false when directory has no cached children', () => {
            const dir: TreeEntry = { name: 'lib', type: 'dir', path: 'lib' };
            expect(hasMatchFn(dir, 'anything', childrenMap)).toBe(false);
        });
    });
});
