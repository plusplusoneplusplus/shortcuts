/**
 * tableReorder.ts — move a table row or column one position.
 *
 * Tables in notes are comparison grids and checklists, which is exactly the
 * content people reorder after writing it. Without a move, reordering means
 * inserting a blank row in the target position, retyping every cell and
 * deleting the original — a cost that scales with the width of the table.
 *
 * The splicing itself is not hand-rolled. `prosemirror-tables@1.8.5` ships
 * `moveTableRow` / `moveTableColumn`, which rebuild the whole table node and
 * `replaceWith` it in a single step; `@tiptap/extension-table@3.30.0` simply
 * does not surface them. This extension is that missing surface, plus the two
 * things the ProseMirror commands leave to the caller: deriving the current
 * index from the selection (they take absolute `from`/`to`, not a direction),
 * and deciding when a move is illegal.
 *
 * Import path matters: `@tiptap/pm/tables`, never `prosemirror-tables`
 * directly, so there is exactly one copy of the table plugin in the bundle.
 */

import { Extension } from '@tiptap/core';
import type { Node as ProseMirrorNode } from '@tiptap/pm/model';
import type { EditorState, Transaction } from '@tiptap/pm/state';
import { closeHistory } from '@tiptap/pm/history';
import { isInTable, moveTableColumn, moveTableRow, selectedRect } from '@tiptap/pm/tables';

declare module '@tiptap/core' {
    interface Commands<ReturnType> {
        tableReorder: {
            /** Swap the row holding the cursor with the one above it. */
            moveTableRowUp: () => ReturnType;
            /** Swap the row holding the cursor with the one below it. */
            moveTableRowDown: () => ReturnType;
            /** Swap the column holding the cursor with the one to its left. */
            moveTableColumnLeft: () => ReturnType;
            /** Swap the column holding the cursor with the one to its right. */
            moveTableColumnRight: () => ReturnType;
        };
    }
}

/**
 * True when any cell of the table spans more than one row or column.
 *
 * Merged cells are out of scope, and not only because no UI creates them: GFM
 * pipe tables cannot represent a merge, so `noteMarkdown.ts` would flatten it
 * on the next save anyway. The guard is load-bearing rather than defensive —
 * `getSelectionRangeInRow` inside prosemirror-tables deliberately *widens* the
 * moved band to cover a straddling `rowspan`, so without this a move would
 * carry along rows the user never pointed at.
 */
function hasMergedCells(table: ProseMirrorNode): boolean {
    let merged = false;
    table.descendants((node) => {
        if (merged) return false;
        const role = node.type.spec.tableRole;
        if (role !== 'cell' && role !== 'header_cell') return true;
        if ((node.attrs.colspan ?? 1) > 1 || (node.attrs.rowspan ?? 1) > 1) merged = true;
        return false;
    });
    return merged;
}

/**
 * True when the table's first row is a header row.
 *
 * Tiptap renders every row inside one `<tbody>`, so the turndown rule in
 * `noteMarkdown.ts` decides where the GFM `| --- |` separator goes by asking
 * whether *that row* contains a `th`. Cells keep their type through a move, so
 * a header row dragged to position 2 would emit the separator after the second
 * body row — markdown that does not round-trip. Hence: when row 0 is a header,
 * it is pinned there and body rows reorder among themselves. A table with no
 * header row (the user toggled it off) has no such constraint.
 */
function hasHeaderRow(table: ProseMirrorNode): boolean {
    const firstRow = table.maybeChild(0);
    if (!firstRow) return false;
    let header = false;
    firstRow.forEach((cell) => {
        if (cell.type.spec.tableRole === 'header_cell') header = true;
    });
    return header;
}

type Axis = 'row' | 'column';

/**
 * Shared precondition check and index derivation for all four commands.
 *
 * Returns the `from`/`to` pair to hand to prosemirror-tables, or null when the
 * move is illegal — which is what makes `editor.can().moveTableRowUp()` report
 * a disabled button rather than the button silently doing nothing.
 */
function resolveMove(state: EditorState, axis: Axis, delta: -1 | 1): { from: number; to: number } | null {
    if (!isInTable(state)) return null;

    const rect = selectedRect(state);
    if (hasMergedCells(rect.table)) return null;

    if (axis === 'row') {
        // A multi-row selection would be a block move, which is out of scope.
        if (rect.bottom - rect.top > 1) return null;
        const from = rect.top;
        const to = from + delta;
        const minIndex = hasHeaderRow(rect.table) ? 1 : 0;
        if (from < minIndex || to < minIndex || to >= rect.map.height) return null;
        return { from, to };
    }

    if (rect.right - rect.left > 1) return null;
    const from = rect.left;
    const to = from + delta;
    // Header *columns* need no clamp: the separator row is generated from the
    // first row's cell count, which a column move leaves unchanged.
    if (to < 0 || to >= rect.map.width) return null;
    return { from, to };
}

function move(state: EditorState, dispatch: ((tr: Transaction) => void) | undefined, axis: Axis, delta: -1 | 1): boolean {
    const indexes = resolveMove(state, axis, delta);
    if (!indexes) return false;

    // `closeHistory` on the way out, not on `state.tr` — the ProseMirror
    // command builds its own transaction internally, and this is the only
    // place we get to touch it. Without it prosemirror-history groups two
    // quick consecutive moves into one undo step.
    const wrapped = dispatch
        ? (tr: Transaction) => {
              closeHistory(tr);
              dispatch(tr);
          }
        : undefined;

    // `select: true` leaves a CellSelection over the moved band at its new
    // index, so `selectedRect` keeps pointing at the same row and clicking the
    // button again moves it one further.
    const command = axis === 'row'
        ? moveTableRow({ ...indexes, select: true })
        : moveTableColumn({ ...indexes, select: true });

    return command(state, wrapped);
}

export const TableReorder = Extension.create({
    name: 'tableReorder',

    addCommands() {
        return {
            moveTableRowUp: () => ({ state, dispatch }) => move(state, dispatch, 'row', -1),
            moveTableRowDown: () => ({ state, dispatch }) => move(state, dispatch, 'row', 1),
            moveTableColumnLeft: () => ({ state, dispatch }) => move(state, dispatch, 'column', -1),
            moveTableColumnRight: () => ({ state, dispatch }) => move(state, dispatch, 'column', 1),
        };
    },
});
