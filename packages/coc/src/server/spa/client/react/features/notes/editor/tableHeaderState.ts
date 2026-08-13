/**
 * Header-shape helpers for note editor tables.
 *
 * Header-ness is structural in ProseMirror — a header cell is a `tableHeader`
 * node, not a flag on the table — so `editor.isActive('table')` cannot answer
 * "does this table have a header row". These helpers read the shape off the
 * document instead, which is what the toolbar's `aria-pressed` state needs and
 * what `noteMarkdown.ts` keys its GFM-or-raw-HTML routing on.
 *
 * Kept next to `tableColumnWidths.ts` (same reasons: no ProseMirror walking in
 * the toolbar, and it can be exercised against a headless editor).
 */

import type { Editor } from '@tiptap/react';
import type { Node as ProseMirrorNode } from '@tiptap/pm/model';
import { findActiveTable } from './tableColumnWidths';

export interface TableHeaderState {
    /** Every cell of the first row is a header cell. */
    row: boolean;
    /** The first cell of every row is a header cell. */
    column: boolean;
}

const NO_HEADERS: TableHeaderState = { row: false, column: false };

function isHeader(node: ProseMirrorNode): boolean {
    return node.type.name === 'tableHeader';
}

/** The `tableRow` children of a table, skipping anything else. */
function rowsOf(table: ProseMirrorNode): ProseMirrorNode[] {
    const rows: ProseMirrorNode[] = [];
    table.forEach((child) => {
        if (child.type.name === 'tableRow') rows.push(child);
    });
    return rows;
}

/**
 * The header shape of a table node. Both flags are false for a table with no
 * rows or with empty rows; both are true when the corner cell is shared between
 * a header row and a header column.
 */
export function tableHeaderShape(table: ProseMirrorNode): TableHeaderState {
    const rows = rowsOf(table);
    if (rows.length === 0) return NO_HEADERS;

    const firstRowCells: ProseMirrorNode[] = [];
    rows[0].forEach((cell) => firstRowCells.push(cell));

    const row = firstRowCells.length > 0 && firstRowCells.every(isHeader);
    const column = rows.every((r) => r.childCount > 0 && isHeader(r.child(0)));

    return { row, column };
}

/**
 * The header shape of the table containing the cursor. `{row: false, column:
 * false}` when the cursor is outside a table, so callers can render an
 * unpressed button without a null check.
 */
export function tableHeaderState(editor: Editor | null | undefined): TableHeaderState {
    const state = editor?.state;
    if (!state) return NO_HEADERS;
    const active = findActiveTable(state);
    return active ? tableHeaderShape(active.node) : NO_HEADERS;
}
