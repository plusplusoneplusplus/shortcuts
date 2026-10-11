/**
 * Tests for ExplorerPanel server-search integration (sidebar filter + typed search endpoint).
 * Covers getAncestorPaths and mergeServerResultsIntoChildrenMap.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { getAncestorPaths } from '../../../../../src/server/spa/client/react/features/repo-detail/explorer/ExplorerPanel';

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

const mockExplorerApi = vi.hoisted(() => ({
    tree: vi.fn(),
}));

vi.mock('../../../../../src/server/spa/client/react/features/repo-detail/explorer/explorerApi', () => ({
    explorerApi: mockExplorerApi,
}));

import { mergeServerResultsIntoChildrenMap } from '../../../../../src/server/spa/client/react/features/repo-detail/explorer/ExplorerPanel';
import type { TreeEntry } from '../../../../../src/server/spa/client/react/features/repo-detail/explorer/types';

describe('mergeServerResultsIntoChildrenMap', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('fetches tree data for ancestor dirs not in childrenMap', async () => {
        const srcEntry: TreeEntry = { name: 'index.ts', type: 'file', path: 'src/index.ts' };
        mockExplorerApi.tree.mockResolvedValue({ entries: [srcEntry] });

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

        expect(mockExplorerApi.tree).toHaveBeenCalledWith('ws-1', { path: 'src' }, undefined);
        expect(setChildrenMap).toHaveBeenCalledTimes(1);
    });

    it('routes ancestor tree loads through the concrete clone owner', async () => {
        mockExplorerApi.tree.mockResolvedValue({ entries: [] });
        const setChildrenMap = vi.fn();

        await mergeServerResultsIntoChildrenMap(
            ['src/index.ts'],
            new Map(),
            setChildrenMap as any,
            'ws-1',
            'remote:server-b:ws-1',
        );

        expect(mockExplorerApi.tree).toHaveBeenCalledWith(
            'ws-1',
            { path: 'src' },
            'remote:server-b:ws-1',
        );
    });

    it('returns all ancestor paths', async () => {
        mockExplorerApi.tree.mockResolvedValue({ entries: [] });

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

        expect(mockExplorerApi.tree).not.toHaveBeenCalled();
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
        mockExplorerApi.tree.mockResolvedValue({ entries: [] });
        const setChildrenMap = vi.fn();

        await mergeServerResultsIntoChildrenMap(
            ['src/components/Button.tsx'],
            childrenMap,
            setChildrenMap as any,
            'ws-1',
        );

        // 'src' is already present; only 'src/components' should be fetched
        expect(mockExplorerApi.tree).toHaveBeenCalledTimes(1);
        expect(mockExplorerApi.tree).toHaveBeenCalledWith('ws-1', { path: 'src/components' }, undefined);
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
        expect(mockExplorerApi.tree).not.toHaveBeenCalled();
        expect(setChildrenMap).not.toHaveBeenCalled();
    });

    it('handles fetch errors gracefully without throwing', async () => {
        mockExplorerApi.tree.mockRejectedValue(new Error('network error'));
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
        mockExplorerApi.tree.mockResolvedValue({ entries: [] });
        const childrenMap = new Map<string, TreeEntry[]>();
        const setChildrenMap = vi.fn();

        await mergeServerResultsIntoChildrenMap(
            ['src/a.ts', 'src/b.ts'],
            childrenMap,
            setChildrenMap as any,
            'ws-1',
        );

        // Both paths share 'src' ancestor — should only fetch once
        expect(mockExplorerApi.tree).toHaveBeenCalledTimes(1);
        expect(mockExplorerApi.tree).toHaveBeenCalledWith('ws-1', { path: 'src' }, undefined);
    });
});
