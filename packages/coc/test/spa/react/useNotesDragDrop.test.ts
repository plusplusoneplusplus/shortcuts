/**
 * useNotesDragDrop — unit tests for the notes drag-and-drop hook.
 */

import { describe, it, expect } from 'vitest';
import {
    getNotesParentPath,
    getDraggedItems,
    canNoteDrop,
    planBulkMove,
    type NoteDragItem,
} from '../../../src/server/spa/client/react/features/notes/hooks/useNotesDragDrop';

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

    // ── Bulk (multi-selection) drags ────────────────────────────────────
    it('rejects a bulk drop when the target is one of the dragged rows', () => {
        const items = [
            makeItem({ path: 'a.md', name: 'a.md', type: 'page' }),
            makeItem({ path: 'b.md', name: 'b.md', type: 'page' }),
        ];
        const dragged = makeItem({ path: 'a.md', name: 'a.md', type: 'page', items });
        const target = makeItem({ path: 'b.md', name: 'b.md', type: 'page' });
        expect(canNoteDrop(dragged, target, 'before')).toBe(false);
    });

    it('rejects a bulk drop into a descendant of any dragged folder', () => {
        const items = [
            makeItem({ path: 'work', name: 'work', type: 'notebook' }),
            makeItem({ path: 'notes/todo.md', name: 'todo.md', type: 'page' }),
        ];
        const dragged = makeItem({ path: 'notes/todo.md', name: 'todo.md', type: 'page', items });
        const target = makeItem({ path: 'work/section', name: 'section', type: 'section' });
        expect(canNoteDrop(dragged, target, 'inside')).toBe(false);
    });

    it('allows a bulk drop into an unrelated folder', () => {
        const items = [
            makeItem({ path: 'a.md', name: 'a.md', type: 'page' }),
            makeItem({ path: 'nb/b.md', name: 'b.md', type: 'page' }),
        ];
        const dragged = makeItem({ path: 'a.md', name: 'a.md', type: 'page', items });
        const target = makeItem({ path: 'personal', name: 'personal', type: 'notebook' });
        expect(canNoteDrop(dragged, target, 'inside')).toBe(true);
    });
});

// ── getDraggedItems ─────────────────────────────────────────────────────

describe('getDraggedItems', () => {
    it('returns the single item when no selection set is attached', () => {
        const item = makeItem({ path: 'a.md', name: 'a.md', type: 'page' });
        expect(getDraggedItems(item)).toEqual([item]);
    });

    it('returns the carried selection set when present', () => {
        const items = [
            makeItem({ path: 'a.md', name: 'a.md', type: 'page' }),
            makeItem({ path: 'b.md', name: 'b.md', type: 'page' }),
        ];
        const dragged = makeItem({ path: 'a.md', name: 'a.md', type: 'page', items });
        expect(getDraggedItems(dragged)).toBe(items);
    });
});

// ── planBulkMove ────────────────────────────────────────────────────────

describe('planBulkMove', () => {
    const noSysFolder = () => false;

    it('moves a 3-item selection into a folder (correct rename targets)', () => {
        const items = [
            makeItem({ path: 'Notebook1/TopPage', name: 'TopPage', type: 'page' }),
            makeItem({ path: 'Notebook1/PageA', name: 'PageA', type: 'page' }),
            makeItem({ path: 'Notebook3/PageB', name: 'PageB', type: 'page' }),
        ];
        expect(planBulkMove(items, 'Notebook2', noSysFolder)).toEqual([
            { from: 'Notebook1/TopPage', to: 'Notebook2/TopPage' },
            { from: 'Notebook1/PageA', to: 'Notebook2/PageA' },
            { from: 'Notebook3/PageB', to: 'Notebook2/PageB' },
        ]);
    });

    it('moves selected folders alongside pages', () => {
        const items = [
            makeItem({ path: 'Notebook1/SectionA', name: 'SectionA', type: 'section' }),
            makeItem({ path: 'Notebook1/page.md', name: 'page.md', type: 'page' }),
        ];
        expect(planBulkMove(items, 'Notebook2', noSysFolder)).toEqual([
            { from: 'Notebook1/SectionA', to: 'Notebook2/SectionA' },
            { from: 'Notebook1/page.md', to: 'Notebook2/page.md' },
        ]);
    });

    it('moves items to root when destParent is empty', () => {
        const items = [
            makeItem({ path: 'Notebook1/PageA', name: 'PageA', type: 'page' }),
            makeItem({ path: 'Notebook1/PageB', name: 'PageB', type: 'page' }),
        ];
        expect(planBulkMove(items, '', noSysFolder)).toEqual([
            { from: 'Notebook1/PageA', to: 'PageA' },
            { from: 'Notebook1/PageB', to: 'PageB' },
        ]);
    });

    it('drops nested descendants — only selection roots move', () => {
        const items = [
            makeItem({ path: 'Notebook1', name: 'Notebook1', type: 'notebook' }),
            makeItem({ path: 'Notebook1/Section1', name: 'Section1', type: 'section' }),
            makeItem({ path: 'Notebook1/Section1/Page1', name: 'Page1', type: 'page' }),
        ];
        // Only the top-level folder moves; the section+page travel inside it.
        expect(planBulkMove(items, 'Notebook2', noSysFolder)).toEqual([
            { from: 'Notebook1', to: 'Notebook2/Notebook1' },
        ]);
    });

    it('guards descendant drops (folder into its own subtree)', () => {
        const items = [
            makeItem({ path: 'work', name: 'work', type: 'notebook' }),
        ];
        expect(planBulkMove(items, 'work/section', noSysFolder)).toEqual([]);
    });

    it('skips rows already living in the destination folder', () => {
        const items = [
            makeItem({ path: 'Notebook2/PageA', name: 'PageA', type: 'page' }),
            makeItem({ path: 'Notebook1/PageB', name: 'PageB', type: 'page' }),
        ];
        expect(planBulkMove(items, 'Notebook2', noSysFolder)).toEqual([
            { from: 'Notebook1/PageB', to: 'Notebook2/PageB' },
        ]);
    });

    it('skips system folders', () => {
        const items = [
            makeItem({ path: 'Journal', name: 'Journal', type: 'notebook' }),
            makeItem({ path: 'Notebook1/PageA', name: 'PageA', type: 'page' }),
        ];
        const isSys = (item: NoteDragItem) => item.path === 'Journal';
        expect(planBulkMove(items, 'Notebook2', isSys)).toEqual([
            { from: 'Notebook1/PageA', to: 'Notebook2/PageA' },
        ]);
    });
});
