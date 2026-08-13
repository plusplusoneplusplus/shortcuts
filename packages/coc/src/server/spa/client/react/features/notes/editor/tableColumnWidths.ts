/**
 * Column-width helpers for note editor tables.
 *
 * ProseMirror's `columnResizing` plugin records a dragged width in the
 * `colwidth` attribute of every cell in that column (an array of length
 * `colspan`). Those attributes are what `noteMarkdown.ts` persists as a raw
 * HTML block, so clearing them is what turns a resized table back into a plain
 * GFM pipe table.
 *
 * Kept out of `NoteEditorToolbar.tsx` so the toolbar stays free of ProseMirror
 * document walking, and so these can be exercised against a headless editor.
 */

import type { Editor } from '@tiptap/react';
import type { Node as ProseMirrorNode } from '@tiptap/pm/model';
import type { EditorState } from '@tiptap/pm/state';

/** Node type names that carry a `colwidth` attribute. */
const CELL_TYPES = ['tableCell', 'tableHeader'];

export interface ActiveTable {
    node: ProseMirrorNode;
    /** Absolute document position of the table node itself. */
    pos: number;
}

/**
 * The innermost table containing the selection head, or null when the cursor is
 * outside a table. Walks outwards so a table nested in a list or blockquote is
 * still found.
 */
export function findActiveTable(state: EditorState): ActiveTable | null {
    const $from = state.selection.$from;
    for (let depth = $from.depth; depth > 0; depth--) {
        const node = $from.node(depth);
        if (node.type.name === 'table') {
            return { node, pos: $from.before(depth) };
        }
    }
    return null;
}

/** True when the cell carries at least one non-null entry in `colwidth`. */
function cellHasWidth(node: ProseMirrorNode): boolean {
    const colwidth = node.attrs?.colwidth;
    return Array.isArray(colwidth) && colwidth.some((w) => typeof w === 'number' && w > 0);
}

/** True when any cell of the table has an explicit column width. */
export function tableHasColumnWidths(table: ProseMirrorNode): boolean {
    let found = false;
    table.descendants((node) => {
        if (found) return false;
        if (CELL_TYPES.includes(node.type.name) && cellHasWidth(node)) found = true;
        return !found;
    });
    return found;
}

/**
 * True when the cursor sits in a table that has at least one dragged column
 * width — the enablement condition for "Reset column widths".
 */
export function activeTableHasColumnWidths(editor: Editor | null | undefined): boolean {
    const state = editor?.state;
    if (!state) return false;
    const active = findActiveTable(state);
    return active ? tableHasColumnWidths(active.node) : false;
}

/**
 * Clear `colwidth` on every cell of the table containing the cursor.
 *
 * One transaction for the whole table, rather than tiptap's
 * `setCellAttribute` (which only reaches the current cell selection).
 * Returns true when a transaction was dispatched.
 */
export function clearActiveTableColumnWidths(editor: Editor | null | undefined): boolean {
    const state = editor?.state;
    if (!state || !editor) return false;
    const active = findActiveTable(state);
    if (!active) return false;

    const tr = state.tr;
    active.node.descendants((node, offset) => {
        if (!CELL_TYPES.includes(node.type.name)) return true;
        if (node.attrs?.colwidth == null) return false;
        // `offset` is relative to the table's content, hence `pos + 1`.
        tr.setNodeMarkup(active.pos + 1 + offset, undefined, { ...node.attrs, colwidth: null });
        return false;
    });

    if (!tr.docChanged) return false;
    editor.view.dispatch(tr);
    return true;
}
