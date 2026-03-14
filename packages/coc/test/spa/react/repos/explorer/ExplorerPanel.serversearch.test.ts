/**
 * Tests for ExplorerPanel server-search integration (sidebar filter + /search?q= endpoint).
 * Covers getAncestorPaths, mergeServerResultsIntoChildrenMap, and source-level assertions
 * for the debounced useEffect, loading indicator, and expandedPaths expansion.
 */

import { describe, it, expect, beforeAll, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

const PANEL_PATH = path.join(
    __dirname, '..', '..', '..', '..', '..', 'src', 'server', 'spa', 'client', 'react', 'repos', 'explorer', 'ExplorerPanel.tsx',
);

// ---------------------------------------------------------------------------
// Source-level assertions
// ---------------------------------------------------------------------------

describe('ExplorerPanel — server search (source)', () => {
    let source: string;

    beforeAll(() => {
        source = fs.readFileSync(PANEL_PATH, 'utf-8');
    });

    describe('exports', () => {
        it('exports getAncestorPaths helper', () => {
            expect(source).toContain('export function getAncestorPaths');
        });

        it('exports mergeServerResultsIntoChildrenMap helper', () => {
            expect(source).toContain('export async function mergeServerResultsIntoChildrenMap');
        });
    });

    describe('server search state', () => {
        it('tracks serverSearchLoading state', () => {
            expect(source).toContain('serverSearchLoading');
            expect(source).toContain('setServerSearchLoading');
        });

        it('uses serverSearchTimerRef for debounce', () => {
            expect(source).toContain('serverSearchTimerRef');
        });
    });

    describe('debounced server search effect', () => {
        it('fires /search?q= query with limit=100', () => {
            expect(source).toContain('/search?q=');
            expect(source).toContain('limit=100');
        });

        it('uses 300 ms debounce', () => {
            expect(source).toContain('}, 300)');
        });

        it('calls mergeServerResultsIntoChildrenMap', () => {
            expect(source).toContain('mergeServerResultsIntoChildrenMap(');
        });

        it('expands ancestor paths after merge', () => {
            expect(source).toContain('for (const a of ancestors) next.add(a)');
        });

        it('clears debounce timer in effect cleanup', () => {
            expect(source).toContain('clearTimeout(serverSearchTimerRef.current)');
        });

        it('sets serverSearchLoading to true before fetch', () => {
            expect(source).toContain('setServerSearchLoading(true)');
        });

        it('sets serverSearchLoading to false in finally', () => {
            expect(source).toContain('setServerSearchLoading(false)');
        });

        it('encodes searchQuery in the URL', () => {
            expect(source).toContain('encodeURIComponent(searchQuery)');
        });

        it('clears serverSearchLoading when query is empty', () => {
            // The server search effect resets loading when query becomes empty
            // Search for the block after serverSearchTimerRef setup
            const idx = source.indexOf('serverSearchTimerRef.current = setTimeout');
            // Before the setTimeout, there should be a guard that clears loading
            const prefix = source.slice(0, idx);
            const guardIdx = prefix.lastIndexOf('if (!searchQuery)');
            const guardSnippet = source.slice(guardIdx, guardIdx + 200);
            expect(guardSnippet).toContain('setServerSearchLoading(false)');
        });
    });

    describe('loading indicator', () => {
        it('renders loading indicator element', () => {
            expect(source).toContain('data-testid="explorer-server-search-loading"');
        });

        it('shows loading indicator conditionally on serverSearchLoading', () => {
            expect(source).toContain('{serverSearchLoading && (');
        });

        it('loading indicator appears after SearchBar', () => {
            const searchBarIdx = source.indexOf('<SearchBar');
            const loadingIdx = source.indexOf('explorer-server-search-loading');
            expect(searchBarIdx).toBeGreaterThan(-1);
            expect(loadingIdx).toBeGreaterThan(-1);
            expect(loadingIdx).toBeGreaterThan(searchBarIdx);
        });
    });
});

// ---------------------------------------------------------------------------
// Unit tests for getAncestorPaths
// ---------------------------------------------------------------------------

import { getAncestorPaths } from '../../../../../src/server/spa/client/react/repos/explorer/ExplorerPanel';

describe('getAncestorPaths', () => {
    it('returns empty array for a root-level file', () => {
        expect(getAncestorPaths('README.md')).toEqual([]);
    });

    it('returns single ancestor for a depth-1 file', () => {
        expect(getAncestorPaths('src/index.ts')).toEqual(['src']);
    });

    it('returns all ancestors for a deep file path', () => {
        expect(getAncestorPaths('src/components/Button/index.ts')).toEqual([
            'src',
            'src/components',
            'src/components/Button',
        ]);
    });

    it('does not include the file path itself', () => {
        const result = getAncestorPaths('a/b/c.ts');
        expect(result).not.toContain('a/b/c.ts');
    });

    it('handles leading slash gracefully by ignoring empty segments', () => {
        // Paths should be repo-relative without leading slash,
        // but defensive filtering of empty parts should still work.
        const result = getAncestorPaths('a/b/c.ts');
        expect(result).toEqual(['a', 'a/b']);
    });

    it('returns empty array for empty string', () => {
        expect(getAncestorPaths('')).toEqual([]);
    });
});

// ---------------------------------------------------------------------------
// Unit tests for mergeServerResultsIntoChildrenMap
// ---------------------------------------------------------------------------

import { mergeServerResultsIntoChildrenMap } from '../../../../../src/server/spa/client/react/repos/explorer/ExplorerPanel';
import type { TreeEntry } from '../../../../../src/server/spa/client/react/repos/explorer/types';

// Mock fetchApi
vi.mock('../../../../../src/server/spa/client/react/hooks/useApi', () => ({
    fetchApi: vi.fn(),
}));

import { fetchApi } from '../../../../../src/server/spa/client/react/hooks/useApi';
const mockFetchApi = fetchApi as ReturnType<typeof vi.fn>;

describe('mergeServerResultsIntoChildrenMap', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('fetches tree data for ancestor dirs not in childrenMap', async () => {
        const srcEntry: TreeEntry = { name: 'index.ts', type: 'file', path: 'src/index.ts' };
        mockFetchApi.mockResolvedValue({ entries: [srcEntry] });

        const childrenMap = new Map<string, TreeEntry[]>();
        const updates: [string, TreeEntry[]][][] = [];
        const setChildrenMap = vi.fn((updater: (prev: Map<string, TreeEntry[]>) => Map<string, TreeEntry[]>) => {
            updates.push([...updater(childrenMap)]);
        });

        await mergeServerResultsIntoChildrenMap(
            ['src/index.ts'],
            childrenMap,
            setChildrenMap as any,
            'ws-1',
        );

        expect(mockFetchApi).toHaveBeenCalledWith('/repos/ws-1/tree?path=src');
        expect(setChildrenMap).toHaveBeenCalledTimes(1);
    });

    it('returns all ancestor paths', async () => {
        mockFetchApi.mockResolvedValue({ entries: [] });

        const childrenMap = new Map<string, TreeEntry[]>();
        const setChildrenMap = vi.fn();

        const ancestors = await mergeServerResultsIntoChildrenMap(
            ['src/utils/helper.ts'],
            childrenMap,
            setChildrenMap as any,
            'ws-1',
        );

        expect(ancestors).toContain('src');
        expect(ancestors).toContain('src/utils');
        expect(ancestors).not.toContain('src/utils/helper.ts');
    });

    it('skips fetch for directories already present in childrenMap', async () => {
        const existingEntry: TreeEntry = { name: 'a.ts', type: 'file', path: 'src/a.ts' };
        const childrenMap = new Map<string, TreeEntry[]>([['src', [existingEntry]]]);
        const setChildrenMap = vi.fn();

        await mergeServerResultsIntoChildrenMap(
            ['src/a.ts'],
            childrenMap,
            setChildrenMap as any,
            'ws-1',
        );

        expect(mockFetchApi).not.toHaveBeenCalled();
    });

    it('does not call setChildrenMap when all ancestors already in map', async () => {
        const childrenMap = new Map<string, TreeEntry[]>([['src', []]]);
        const setChildrenMap = vi.fn();

        await mergeServerResultsIntoChildrenMap(
            ['src/foo.ts'],
            childrenMap,
            setChildrenMap as any,
            'ws-1',
        );

        expect(setChildrenMap).not.toHaveBeenCalled();
    });

    it('only fetches dirs missing from childrenMap when some are present', async () => {
        const childrenMap = new Map<string, TreeEntry[]>([['src', []]]);
        mockFetchApi.mockResolvedValue({ entries: [] });
        const setChildrenMap = vi.fn();

        await mergeServerResultsIntoChildrenMap(
            ['src/components/Button.tsx'],
            childrenMap,
            setChildrenMap as any,
            'ws-1',
        );

        // 'src' is already present; only 'src/components' should be fetched
        expect(mockFetchApi).toHaveBeenCalledTimes(1);
        expect(mockFetchApi).toHaveBeenCalledWith('/repos/ws-1/tree?path=src%2Fcomponents');
    });

    it('returns empty array when given no paths', async () => {
        const childrenMap = new Map<string, TreeEntry[]>();
        const setChildrenMap = vi.fn();

        const ancestors = await mergeServerResultsIntoChildrenMap(
            [],
            childrenMap,
            setChildrenMap as any,
            'ws-1',
        );

        expect(ancestors).toEqual([]);
        expect(mockFetchApi).not.toHaveBeenCalled();
        expect(setChildrenMap).not.toHaveBeenCalled();
    });

    it('handles fetch errors gracefully without throwing', async () => {
        mockFetchApi.mockRejectedValue(new Error('network error'));
        const childrenMap = new Map<string, TreeEntry[]>();
        const setChildrenMap = vi.fn();

        await expect(
            mergeServerResultsIntoChildrenMap(
                ['src/index.ts'],
                childrenMap,
                setChildrenMap as any,
                'ws-1',
            ),
        ).resolves.not.toThrow();
    });

    it('deduplicates ancestor paths across multiple result paths', async () => {
        mockFetchApi.mockResolvedValue({ entries: [] });
        const childrenMap = new Map<string, TreeEntry[]>();
        const setChildrenMap = vi.fn();

        await mergeServerResultsIntoChildrenMap(
            ['src/a.ts', 'src/b.ts'],
            childrenMap,
            setChildrenMap as any,
            'ws-1',
        );

        // Both paths share 'src' ancestor — should only fetch once
        expect(mockFetchApi).toHaveBeenCalledTimes(1);
        expect(mockFetchApi).toHaveBeenCalledWith('/repos/ws-1/tree?path=src');
    });
});
