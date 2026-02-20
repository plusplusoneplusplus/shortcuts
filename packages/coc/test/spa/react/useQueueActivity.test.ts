/**
 * Tests for useQueueActivity hook — folderMap aggregation logic.
 *
 * Since the hook depends on React context (useQueue, useApp), we test the
 * pure folderMap computation logic extracted from the hook source.
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
