/**
 * useNotesDragDrop — unit tests for the notes drag-and-drop hook.
 */

import { describe, it, expect } from 'vitest';
import {
    getNotesParentPath,
    canNoteDrop,
    type NoteDragItem,
} from '../../../src/server/spa/client/react/hooks/useNotesDragDrop';

// ── getNotesParentPath ─────────────────────────────────────────────────

describe('getNotesParentPath', () => {
    it('returns empty string for top-level items', () => {
        expect(getNotesParentPath('notebook')).toBe('');
        expect(getNotesParentPath('page.md')).toBe('');
    });

    it('returns the parent path for nested items', () => {
        expect(getNotesParentPath('notebook/section')).toBe('notebook');
        expect(getNotesParentPath('a/b/c/page.md')).toBe('a/b/c');
    });
});

// ── canNoteDrop ────────────────────────────────────────────────────────

function makeItem(overrides: Partial<NoteDragItem>): NoteDragItem {
    return { path: 'p', name: 'p', type: 'page', ...overrides };
}

describe('canNoteDrop', () => {
    it('returns false when dragged item and target are the same', () => {
        const item = makeItem({ path: 'nb/page.md', type: 'page' });
        expect(canNoteDrop(item, item, 'before')).toBe(false);
    });

    it('returns false when dropping a folder inside itself (circular)', () => {
        const folder = makeItem({ path: 'work', name: 'work', type: 'notebook' });
        const target = makeItem({ path: 'work', name: 'work', type: 'notebook' });
        expect(canNoteDrop(folder, target, 'inside')).toBe(false);
    });

    it('returns false when dropping a folder inside a descendant', () => {
        const folder = makeItem({ path: 'work', name: 'work', type: 'notebook' });
        const descendant = makeItem({ path: 'work/section', name: 'section', type: 'section' });
        expect(canNoteDrop(folder, descendant, 'inside')).toBe(false);
    });

    it('returns false when dropping a folder before/after itself', () => {
        const folder = makeItem({ path: 'nb', name: 'nb', type: 'notebook' });
        const same = makeItem({ path: 'nb', name: 'nb', type: 'notebook' });
        expect(canNoteDrop(folder, same, 'before')).toBe(false);
    });

    it('returns false when dropping a folder before/after a descendant', () => {
        const folder = makeItem({ path: 'nb', name: 'nb', type: 'notebook' });
        const child = makeItem({ path: 'nb/child', name: 'child', type: 'section' });
        expect(canNoteDrop(folder, child, 'after')).toBe(false);
    });

    it('returns true for valid page reorder (before)', () => {
        const page = makeItem({ path: 'nb/page-a.md', name: 'page-a.md', type: 'page' });
        const other = makeItem({ path: 'nb/page-b.md', name: 'page-b.md', type: 'page' });
        expect(canNoteDrop(page, other, 'before')).toBe(true);
    });

    it('returns true for valid page reorder (after)', () => {
        const page = makeItem({ path: 'nb/page-a.md', name: 'page-a.md', type: 'page' });
        const other = makeItem({ path: 'nb/page-b.md', name: 'page-b.md', type: 'page' });
        expect(canNoteDrop(page, other, 'after')).toBe(true);
    });

    it('returns true when dropping a folder into an unrelated folder', () => {
        const src = makeItem({ path: 'work', name: 'work', type: 'notebook' });
        const tgt = makeItem({ path: 'personal', name: 'personal', type: 'notebook' });
        expect(canNoteDrop(src, tgt, 'inside')).toBe(true);
    });

    it('returns true when dropping a page into a folder', () => {
        const page = makeItem({ path: 'work/note.md', name: 'note.md', type: 'page' });
        const folder = makeItem({ path: 'personal', name: 'personal', type: 'notebook' });
        expect(canNoteDrop(page, folder, 'inside')).toBe(true);
    });
});
