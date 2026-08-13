/**
 * tableColumnWrap.ts — per-column "wrap / no wrap" for note tables.
 *
 * A column holding one long free-text value (a description, a URL, a log line)
 * blows every row up to several lines and squeezes the other columns into a
 * ribbon. Notion's answer is a per-column switch: keep the text on one line and
 * clip it with an ellipsis. This is that switch.
 *
 * Storage is a `wrap` attribute on each cell rather than an array on the table
 * node. Tiptap has no column node — a column is just an index across rows — and
 * a table-level array would have to be re-indexed on every `addColumnBefore` /
 * `deleteColumn`, with no hook to do it from. A per-cell attribute travels with
 * its cell through all of those commands for free, and serializes to the DOM as
 * `data-wrap` so both the CSS and the raw-HTML markdown path read it with no
 * extra plumbing.
 *
 * The default (`'wrap'`) renders no attribute at all, so a table nobody has
 * touched produces byte-identical HTML to before this feature existed — which is
 * what keeps it on the GFM pipe-table path in `noteMarkdown.ts`.
 */

import type { Editor } from '@tiptap/react';
import type { Node as ProseMirrorNode } from '@tiptap/pm/model';
import type { EditorState } from '@tiptap/pm/state';
import { TableMap } from '@tiptap/pm/tables';
import { TableCellWithBackground, TableHeaderWithBackground } from './tableCellBackground';
import { findActiveTable } from '../tableColumnWidths';

export type TableWrapMode = 'wrap' | 'nowrap';

/** Node type names that carry a `wrap` attribute. */
const CELL_TYPES = ['tableCell', 'tableHeader'];

export function isTableWrapMode(value: unknown): value is TableWrapMode {
    return value === 'wrap' || value === 'nowrap';
}

const wrapAttribute = {
    wrap: {
        default: 'wrap' as TableWrapMode,
        // Only `data-wrap` is read. A pasted cell may carry its own
        // `style="white-space: nowrap"` from Excel or Notion; honoring that
        // would silently clip content the user never asked to clip, so foreign
        // styles land in the default state.
        parseHTML: (element: HTMLElement): TableWrapMode =>
            element.getAttribute('data-wrap') === 'nowrap' ? 'nowrap' : 'wrap',
        renderHTML: (attributes: Record<string, unknown>): Record<string, string> =>
            attributes.wrap === 'nowrap' ? { 'data-wrap': 'nowrap' } : {},
    },
};

// `...this.parent?.()` is load-bearing twice over: it keeps the stock colspan /
// rowspan / colwidth attributes *and* the `backgroundColor` one these extend.
export const TableCellWithWrap = TableCellWithBackground.extend({
    addAttributes() {
        return { ...this.parent?.(), ...wrapAttribute };
    },
});

export const TableHeaderWithWrap = TableHeaderWithBackground.extend({
    addAttributes() {
        return { ...this.parent?.(), ...wrapAttribute };
    },
});

interface ActiveColumns {
    table: ProseMirrorNode;
    /** Absolute position of the table's first child — TableMap's origin. */
    tableStart: number;
    map: TableMap;
    /** Column indices covered by the selection, ascending and deduplicated. */
    columns: number[];
}

/**
 * The columns the selection touches, via `TableMap` rather than a raw child
 * index so a `colspan`/`rowspan` cell maps to every column it actually covers.
 *
 * Both selection shapes are handled: a `CellSelection` (duck-typed through
 * `forEachCell`, so this file needs no `CellSelection` import) contributes every
 * cell in its rectangle, and a plain caret contributes the one cell it sits in.
 */
function activeColumns(state: EditorState | undefined): ActiveColumns | null {
    if (!state) return null;
    const active = findActiveTable(state);
    if (!active) return null;

    const tableStart = active.pos + 1;
    const map = TableMap.get(active.node);
    const columns = new Set<number>();

    const addCell = (relativePos: number): void => {
        try {
            const rect = map.findCell(relativePos);
            for (let col = rect.left; col < rect.right; col++) columns.add(col);
        } catch {
            // findCell throws for a position that is not a cell start — a doc
            // shape we should never see, but not worth losing the toolbar over.
        }
    };

    const selection = state.selection as unknown as {
        forEachCell?: (fn: (node: ProseMirrorNode, pos: number) => void) => void;
    };

    if (typeof selection.forEachCell === 'function') {
        selection.forEachCell((_node, pos) => addCell(pos - tableStart));
    } else {
        const $from = state.selection.$from;
        for (let depth = $from.depth; depth > 0; depth--) {
            if (CELL_TYPES.includes($from.node(depth).type.name)) {
                addCell($from.before(depth) - tableStart);
                break;
            }
        }
    }

    if (columns.size === 0) return null;
    return { table: active.node, tableStart, map, columns: [...columns].sort((a, b) => a - b) };
}

/** Every distinct cell of the given columns, as absolute positions. */
function cellsInColumns(active: ActiveColumns): { pos: number; node: ProseMirrorNode }[] {
    const seen = new Set<number>();
    const cells: { pos: number; node: ProseMirrorNode }[] = [];
    for (const col of active.columns) {
        const rects = active.map.cellsInRect({
            left: col,
            right: col + 1,
            top: 0,
            bottom: active.map.height,
        });
        for (const relativePos of rects) {
            if (seen.has(relativePos)) continue;
            seen.add(relativePos);
            const node = active.table.nodeAt(relativePos);
            if (node) cells.push({ pos: active.tableStart + relativePos, node });
        }
    }
    return cells;
}

/**
 * The wrap mode of the column under the cursor, or null when the cursor is
 * outside a table.
 *
 * A column counts as `'nowrap'` only when *every* one of its cells is — a
 * half-applied column (a row added before the setting existed, say) reads as
 * `'wrap'`, so the next toggle press finishes the job rather than undoing it.
 */
export function activeColumnWrap(editor: Editor | null | undefined): TableWrapMode | null {
    const active = activeColumns(editor?.state);
    if (!active) return null;
    const cells = cellsInColumns(active);
    if (cells.length === 0) return null;
    return cells.every(cell => cell.node.attrs?.wrap === 'nowrap') ? 'nowrap' : 'wrap';
}

/**
 * Flip the wrap mode of every cell in the column(s) the selection touches, in a
 * single transaction so one Ctrl+Z reverts the whole column.
 *
 * `setCellAttribute` is deliberately not used: it only reaches the current cell
 * selection, and the point here is to reach the whole column from a plain caret.
 * Returns true when a transaction was dispatched.
 */
export function toggleActiveColumnWrap(editor: Editor | null | undefined): boolean {
    if (!editor) return false;
    const state = editor.state;
    const active = activeColumns(state);
    if (!active) return false;

    const target: TableWrapMode = activeColumnWrap(editor) === 'nowrap' ? 'wrap' : 'nowrap';
    const tr = state.tr;
    for (const { pos, node } of cellsInColumns(active)) {
        if (node.attrs?.wrap === target) continue;
        tr.setNodeMarkup(pos, undefined, { ...node.attrs, wrap: target });
    }

    if (!tr.docChanged) return false;
    editor.view.dispatch(tr);
    return true;
}
