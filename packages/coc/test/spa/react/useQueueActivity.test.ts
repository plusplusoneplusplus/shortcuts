/**
 * Tests for useQueueActivity hook — folderMap aggregation and
 * repoQueueMap preference logic.
 *
 * Since the hook depends on React context (useQueue, useApp), we test the
 * pure computation logic extracted from the hook source.
 */

import { describe, it, expect } from 'vitest';
import type { QueueActivityMap, QueueFolderActivityMap } from '../../../src/server/spa/client/react/hooks/useQueueActivity';

/**
 * Replicates the folderMap computation logic from useQueueActivity.
 */
function computeFolderMap(fileMap: QueueActivityMap): QueueFolderActivityMap {
    const folderMap: QueueFolderActivityMap = {};
    for (const [rel, count] of Object.entries(fileMap)) {
        const parts = rel.split('/');
        for (let i = 1; i < parts.length; i++) {
            const prefix = parts.slice(0, i).join('/');
            folderMap[prefix] = (folderMap[prefix] || 0) + count;
        }
    }
    return folderMap;
}

describe('useQueueActivity — folderMap aggregation', () => {
    it('returns empty folderMap for empty fileMap', () => {
        expect(computeFolderMap({})).toEqual({});
    });

    it('returns empty folderMap for root-level files (no folder prefix)', () => {
        expect(computeFolderMap({ 'task.md': 1 })).toEqual({});
    });

    it('aggregates single nested file to its ancestor folders', () => {
        const folderMap = computeFolderMap({ 'a/b/c.md': 1 });
        expect(folderMap).toEqual({ 'a': 1, 'a/b': 1 });
    });

    it('aggregates multiple files under the same parent folder', () => {
        const folderMap = computeFolderMap({
            'a/b/x.md': 1,
            'a/c/y.md': 1,
        });
        expect(folderMap['a']).toBe(2);
        expect(folderMap['a/b']).toBe(1);
        expect(folderMap['a/c']).toBe(1);
    });

    it('handles counts greater than 1', () => {
        const folderMap = computeFolderMap({ 'a/b/file.md': 3 });
        expect(folderMap['a']).toBe(3);
        expect(folderMap['a/b']).toBe(3);
    });

    it('handles deeply nested paths', () => {
        const folderMap = computeFolderMap({ 'a/b/c/d/e.md': 1 });
        expect(folderMap).toEqual({
            'a': 1,
            'a/b': 1,
            'a/b/c': 1,
            'a/b/c/d': 1,
        });
    });

    it('correctly sums across files in different subtrees', () => {
        const folderMap = computeFolderMap({
            'feature1/task-a.md': 1,
            'feature1/sub/task-b.md': 2,
            'feature2/task-c.md': 1,
        });
        expect(folderMap['feature1']).toBe(3); // 1 + 2
        expect(folderMap['feature1/sub']).toBe(2);
        expect(folderMap['feature2']).toBe(1);
    });
});

// ── repoQueueMap preference logic ──────────────────────────────────────

/**
 * Replicates the activeItems selection logic from useQueueActivity.
 * When repoQueueMap has an entry for the given wsId, its queued/running
 * arrays are preferred over the top-level arrays.
 */
function resolveActiveItems(
    queueState: {
        queued?: any[];
        running?: any[];
        repoQueueMap?: Record<string, { queued?: any[]; running?: any[] }>;
    },
    wsId: string,
): any[] {
    const repoEntry = queueState.repoQueueMap?.[wsId];
    const queued = repoEntry?.queued ?? queueState.queued ?? [];
    const running = repoEntry?.running ?? queueState.running ?? [];
    return [...queued, ...running];
}

describe('useQueueActivity — repoQueueMap preference', () => {
    const itemA = { id: 'a' };
    const itemB = { id: 'b' };
    const itemC = { id: 'c' };
    const itemD = { id: 'd' };

    it('falls back to top-level arrays when repoQueueMap has no entry for wsId', () => {
        const items = resolveActiveItems(
            { queued: [itemA], running: [itemB], repoQueueMap: {} },
            'ws-1',
        );
        expect(items).toEqual([itemA, itemB]);
    });

    it('prefers repoQueueMap entry over top-level arrays', () => {
        const items = resolveActiveItems(
            {
                queued: [itemA],
                running: [itemB],
                repoQueueMap: {
                    'ws-1': { queued: [itemC], running: [itemD] },
                },
            },
            'ws-1',
        );
        expect(items).toEqual([itemC, itemD]);
    });

    it('returns repo items even when top-level arrays are empty', () => {
        const items = resolveActiveItems(
            {
                queued: [],
                running: [],
                repoQueueMap: {
                    'ws-1': { queued: [itemA], running: [] },
                },
            },
            'ws-1',
        );
        expect(items).toEqual([itemA]);
    });

    it('returns empty when both repo entry and top-level are empty', () => {
        const items = resolveActiveItems(
            {
                queued: [],
                running: [],
                repoQueueMap: {
                    'ws-1': { queued: [], running: [] },
                },
            },
            'ws-1',
        );
        expect(items).toEqual([]);
    });

    it('falls back to top-level when repoQueueMap is undefined', () => {
        const items = resolveActiveItems(
            { queued: [itemA], running: [] },
            'ws-1',
        );
        expect(items).toEqual([itemA]);
    });

    it('returns empty when everything is undefined/empty', () => {
        const items = resolveActiveItems({}, 'ws-1');
        expect(items).toEqual([]);
    });

    it('does not mix repo and top-level data for the same wsId', () => {
        // When a repo entry exists, top-level arrays should be completely ignored
        const items = resolveActiveItems(
            {
                queued: [itemA, itemB],
                running: [itemC],
                repoQueueMap: {
                    'ws-1': { queued: [itemD], running: [] },
                },
            },
            'ws-1',
        );
        expect(items).toEqual([itemD]);
        expect(items).not.toContainEqual(itemA);
        expect(items).not.toContainEqual(itemB);
        expect(items).not.toContainEqual(itemC);
    });

    it('selects correct repo entry when multiple repos exist', () => {
        const items = resolveActiveItems(
            {
                queued: [],
                running: [],
                repoQueueMap: {
                    'ws-1': { queued: [itemA], running: [] },
                    'ws-2': { queued: [itemB], running: [itemC] },
                },
            },
            'ws-2',
        );
        expect(items).toEqual([itemB, itemC]);
    });
});
