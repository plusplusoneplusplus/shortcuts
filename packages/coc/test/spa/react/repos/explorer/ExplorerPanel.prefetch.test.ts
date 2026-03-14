/**
 * Tests for ExplorerPanel two-level prefetch (depth=2 on mount).
 *
 * Unit tests for seedFromEntries helper and source-level assertions
 * that the mount fetch uses depth=2 and seeds childrenMap.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

const COMPONENT_PATH = path.join(
    __dirname, '..', '..', '..', '..', '..', 'src', 'server', 'spa', 'client', 'react', 'repos', 'explorer', 'ExplorerPanel.tsx'
);
const TYPES_PATH = path.join(
    __dirname, '..', '..', '..', '..', '..', 'src', 'server', 'spa', 'client', 'react', 'repos', 'explorer', 'types.ts'
);

// ---------------------------------------------------------------------------
// Source-level assertions
// ---------------------------------------------------------------------------

describe('ExplorerPanel — two-level prefetch (source)', () => {
    let source: string;

    beforeAll(() => {
        source = fs.readFileSync(COMPONENT_PATH, 'utf-8');
    });

    it('exports seedFromEntries as a named export', () => {
        expect(source).toContain('export function seedFromEntries');
    });

    it('mount fetch uses depth=2', () => {
        expect(source).toContain('tree?path=/&depth=2');
    });

    it('seeds childrenMap after setting rootEntries', () => {
        expect(source).toContain('seedFromEntries(data.entries, seedMap)');
        expect(source).toContain('setChildrenMap(prev => new Map([...prev, ...seedMap]))');
    });
});

describe('TreeEntry type', () => {
    let source: string;

    beforeAll(() => {
        source = fs.readFileSync(TYPES_PATH, 'utf-8');
    });

    it('has optional children field', () => {
        expect(source).toContain('children?: TreeEntry[]');
    });
});

// ---------------------------------------------------------------------------
// Unit tests for seedFromEntries
// ---------------------------------------------------------------------------

import { seedFromEntries } from '../../../../../src/server/spa/client/react/repos/explorer/ExplorerPanel';
import type { TreeEntry } from '../../../../../src/server/spa/client/react/repos/explorer/types';

describe('seedFromEntries', () => {
    it('populates map with direct children of root-level dirs', () => {
        const child1: TreeEntry = { name: 'a.ts', type: 'file', path: 'src/a.ts' };
        const child2: TreeEntry = { name: 'b.ts', type: 'file', path: 'src/b.ts' };
        const entries: TreeEntry[] = [
            { name: 'src', type: 'dir', path: 'src', children: [child1, child2] },
            { name: 'README.md', type: 'file', path: 'README.md' },
        ];

        const map = new Map<string, TreeEntry[]>();
        seedFromEntries(entries, map);

        expect(map.size).toBe(1);
        expect(map.get('src')).toEqual([child1, child2]);
    });

    it('recursively populates nested directories', () => {
        const deepFile: TreeEntry = { name: 'index.ts', type: 'file', path: 'src/utils/index.ts' };
        const utilsDir: TreeEntry = { name: 'utils', type: 'dir', path: 'src/utils', children: [deepFile] };
        const entries: TreeEntry[] = [
            { name: 'src', type: 'dir', path: 'src', children: [utilsDir] },
        ];

        const map = new Map<string, TreeEntry[]>();
        seedFromEntries(entries, map);

        expect(map.get('src')).toEqual([utilsDir]);
        expect(map.get('src/utils')).toEqual([deepFile]);
    });

    it('does not add dirs without children', () => {
        const entries: TreeEntry[] = [
            { name: 'empty', type: 'dir', path: 'empty' },
        ];

        const map = new Map<string, TreeEntry[]>();
        seedFromEntries(entries, map);

        expect(map.size).toBe(0);
    });

    it('does not add file entries', () => {
        const entries: TreeEntry[] = [
            { name: 'file.ts', type: 'file', path: 'file.ts' },
        ];

        const map = new Map<string, TreeEntry[]>();
        seedFromEntries(entries, map);

        expect(map.size).toBe(0);
    });

    it('handles empty entries array', () => {
        const map = new Map<string, TreeEntry[]>();
        seedFromEntries([], map);
        expect(map.size).toBe(0);
    });

    it('merges into an existing map without overwriting existing keys', () => {
        const existingEntry: TreeEntry = { name: 'old.ts', type: 'file', path: 'lib/old.ts' };
        const newEntry: TreeEntry = { name: 'new.ts', type: 'file', path: 'src/new.ts' };

        const map = new Map<string, TreeEntry[]>([['lib', [existingEntry]]]);
        const entries: TreeEntry[] = [
            { name: 'src', type: 'dir', path: 'src', children: [newEntry] },
        ];

        seedFromEntries(entries, map);

        // Existing key preserved
        expect(map.get('lib')).toEqual([existingEntry]);
        // New key added
        expect(map.get('src')).toEqual([newEntry]);
    });
});
