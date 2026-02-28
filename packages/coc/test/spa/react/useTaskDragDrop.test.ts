/**
 * Tests for useTaskDragDrop — validation logic, serialization, and hook behavior.
 */

import { describe, it, expect } from 'vitest';
import {
    canDrop,
    getParentPath,
    serializeDragData,
    deserializeDragData,
    DRAG_MIME_TYPE,
} from '../../../src/server/spa/client/react/hooks/useTaskDragDrop';
import type { DragItem } from '../../../src/server/spa/client/react/hooks/useTaskDragDrop';

// ── getParentPath ──────────────────────────────────────────────────────

describe('getParentPath', () => {
    it('returns parent folder for nested file', () => {
        expect(getParentPath('a/b/file.md')).toBe('a/b');
    });

    it('returns parent folder for one-level deep file', () => {
        expect(getParentPath('feature1/task.md')).toBe('feature1');
    });

    it('returns empty string for root-level file', () => {
        expect(getParentPath('file.md')).toBe('');
    });

    it('returns parent for nested folder path', () => {
        expect(getParentPath('a/b/c')).toBe('a/b');
    });

    it('returns empty string for top-level folder', () => {
        expect(getParentPath('feature1')).toBe('');
    });
});

// ── canDrop ────────────────────────────────────────────────────────────

describe('canDrop', () => {
    it('returns true for valid file move to different folder', () => {
        const items: DragItem[] = [{ path: 'feature1/task.md', type: 'file', name: 'task.md' }];
        expect(canDrop(items, 'feature2')).toBe(true);
    });

    it('returns true for valid folder move', () => {
        const items: DragItem[] = [{ path: 'feature1', type: 'folder', name: 'feature1' }];
        expect(canDrop(items, 'feature2')).toBe(true);
    });

    it('returns true for move to root (empty string)', () => {
        const items: DragItem[] = [{ path: 'feature1/task.md', type: 'file', name: 'task.md' }];
        expect(canDrop(items, '')).toBe(true);
    });

    it('returns false when items array is empty', () => {
        expect(canDrop([], 'feature1')).toBe(false);
    });

    it('returns false for same-parent drop (no-op)', () => {
        const items: DragItem[] = [{ path: 'feature1/task.md', type: 'file', name: 'task.md' }];
        expect(canDrop(items, 'feature1')).toBe(false);
    });

    it('returns false for root-level file dropped to root', () => {
        const items: DragItem[] = [{ path: 'task.md', type: 'file', name: 'task.md' }];
        expect(canDrop(items, '')).toBe(false);
    });

    it('returns false for circular folder move (into self)', () => {
        const items: DragItem[] = [{ path: 'feature1', type: 'folder', name: 'feature1' }];
        expect(canDrop(items, 'feature1')).toBe(false);
    });

    it('returns false for circular folder move (into descendant)', () => {
        const items: DragItem[] = [{ path: 'a', type: 'folder', name: 'a' }];
        expect(canDrop(items, 'a/b/c')).toBe(false);
    });

    it('returns false when dropping into archive folder', () => {
        const items: DragItem[] = [{ path: 'feature1/task.md', type: 'file', name: 'task.md' }];
        expect(canDrop(items, 'archive')).toBe(false);
    });

    it('returns false when dropping into archive subfolder', () => {
        const items: DragItem[] = [{ path: 'feature1/task.md', type: 'file', name: 'task.md' }];
        expect(canDrop(items, 'archive/old')).toBe(false);
    });

    it('returns false if any item in multi-select has same parent', () => {
        const items: DragItem[] = [
            { path: 'feature1/a.md', type: 'file', name: 'a.md' },
            { path: 'feature1/b.md', type: 'file', name: 'b.md' },
        ];
        expect(canDrop(items, 'feature1')).toBe(false);
    });

    it('returns true for multi-select move to different folder', () => {
        const items: DragItem[] = [
            { path: 'feature1/a.md', type: 'file', name: 'a.md' },
            { path: 'feature1/b.md', type: 'file', name: 'b.md' },
        ];
        expect(canDrop(items, 'feature2')).toBe(true);
    });

    it('does not treat file path as circular even if it matches target prefix', () => {
        // File "a" dropped into "a/b" — only folders should be checked for circular
        const items: DragItem[] = [{ path: 'a', type: 'file', name: 'a' }];
        expect(canDrop(items, 'a/b')).toBe(true);
    });
});

// ── Serialization ──────────────────────────────────────────────────────

describe('serializeDragData / deserializeDragData', () => {
    it('round-trips a single DragItem', () => {
        const items: DragItem[] = [{ path: 'feature1/task.md', type: 'file', name: 'task.md' }];
        const serialized = serializeDragData(items);
        const deserialized = deserializeDragData(serialized);
        expect(deserialized).toEqual(items);
    });

    it('round-trips multiple DragItems', () => {
        const items: DragItem[] = [
            { path: 'feature1/task.md', type: 'file', name: 'task.md' },
            { path: 'feature2', type: 'folder', name: 'feature2' },
        ];
        const serialized = serializeDragData(items);
        const deserialized = deserializeDragData(serialized);
        expect(deserialized).toEqual(items);
    });

    it('returns empty array for invalid JSON', () => {
        expect(deserializeDragData('not json')).toEqual([]);
    });

    it('returns empty array for non-array JSON', () => {
        expect(deserializeDragData('{"path":"x"}')).toEqual([]);
    });

    it('filters out items with missing required fields', () => {
        const data = JSON.stringify([
            { path: 'a.md', type: 'file', name: 'a' },
            { path: 'b.md', type: 'invalid', name: 'b' },
            { path: 'c.md', type: 'file' }, // missing name
        ]);
        const result = deserializeDragData(data);
        expect(result).toEqual([{ path: 'a.md', type: 'file', name: 'a' }]);
    });
});

// ── DRAG_MIME_TYPE ──────────────────────────────────────────────────────

describe('DRAG_MIME_TYPE', () => {
    it('is a non-empty string', () => {
        expect(typeof DRAG_MIME_TYPE).toBe('string');
        expect(DRAG_MIME_TYPE.length).toBeGreaterThan(0);
    });
});
