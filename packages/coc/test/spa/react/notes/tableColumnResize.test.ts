/**
 * tableColumnResize.test.ts — dragging a column border (AC-03, AC-04).
 *
 * ProseMirror's `columnResizing` plugin owns the drag. It normally finds the
 * border under the pointer with `posAtCoords` / `getBoundingClientRect`, which
 * jsdom reports as all-zero — so we do NOT simulate the hover half. Instead we
 * hand the plugin the handle directly (its own `setHandle` meta, the same one
 * `updateHandle()` dispatches on hover) and then drive its real mousedown
 * handler and the window `mouseup` it listens for. Everything the drag actually
 * decides — which cells get a `colwidth`, and the `cellMinWidth` clamp — runs
 * for real, with the plugin configured exactly as `RichEditorCore.tsx`
 * configures it.
 *
 * The starting width comes from `currentColWidth`, which prefers the cell's
 * existing `colwidth` over `offsetWidth`; that is why the fixtures that assert
 * on a precise result start out sized.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { Editor } from '@tiptap/core';
import { StarterKit } from '@tiptap/starter-kit';
import { Table } from '@tiptap/extension-table';
import { TableRow } from '@tiptap/extension-table-row';
import { TableCell } from '@tiptap/extension-table-cell';
import { TableHeader } from '@tiptap/extension-table-header';
import { columnResizingPluginKey } from '@tiptap/pm/tables';

/** Mirrors RichEditorCore.tsx. */
const CELL_MIN_WIDTH = 60;

let editor: Editor | null = null;

function makeEditor(content: string, cellMinWidth = CELL_MIN_WIDTH): Editor {
    editor = new Editor({
        extensions: [
            StarterKit.configure({ link: false }),
            Table.configure({ resizable: true, handleWidth: 5, cellMinWidth, lastColumnResizable: true }),
            TableRow,
            TableHeader,
            TableCell,
        ],
        content,
    });
    return editor;
}

afterEach(() => {
    editor?.destroy();
    editor = null;
});

const SIZED_TABLE = `
<table><tbody>
<tr><th colwidth="180">A</th><th colwidth="120">B</th></tr>
<tr><td colwidth="180">1</td><td colwidth="120">2</td></tr>
<tr><td colwidth="180">3</td><td colwidth="120">4</td></tr>
</tbody></table>`;

const PLAIN_TABLE = `
<table><tbody>
<tr><th>A</th><th>B</th></tr>
<tr><td>1</td><td>2</td></tr>
</tbody></table>`;

/** Every `colwidth` in the doc, in document order. */
function colwidths(ed: Editor): unknown[] {
    const out: unknown[] = [];
    ed.state.doc.descendants((node) => {
        if (node.type.name === 'tableCell' || node.type.name === 'tableHeader') {
            out.push(node.attrs.colwidth);
        }
        return true;
    });
    return out;
}

/** Positions of every cell node, in document order. */
function cellPositions(ed: Editor): number[] {
    const out: number[] = [];
    ed.state.doc.descendants((node, pos) => {
        if (node.type.name === 'tableCell' || node.type.name === 'tableHeader') out.push(pos);
        return true;
    });
    return out;
}

/**
 * Drag the right border of the cell at `cellPos` by `deltaX` pixels, through the
 * plugin's own handlers.
 */
function dragColumnBorder(ed: Editor, cellPos: number, deltaX: number): void {
    const { view } = ed;
    // What `updateHandle()` dispatches when the pointer is over a border.
    view.dispatch(view.state.tr.setMeta(columnResizingPluginKey, { setHandle: cellPos }));

    const plugin = columnResizingPluginKey.get(view.state);
    expect(plugin, 'columnResizing plugin is installed').toBeTruthy();
    const mousedown = plugin!.props.handleDOMEvents!.mousedown as (v: typeof view, e: MouseEvent) => void;

    const startX = 400;
    mousedown(view, new MouseEvent('mousedown', { clientX: startX, clientY: 0, bubbles: true }));
    // handleMouseDown registers `finish` on the window; that is what commits the width.
    window.dispatchEvent(new MouseEvent('mouseup', { clientX: startX + deltaX, clientY: 0, bubbles: true }));
}

describe('table column resize — AC-03 the drag writes colwidth', () => {
    it('widens every cell of the dragged column and leaves the others alone', () => {
        const ed = makeEditor(SIZED_TABLE);
        const firstColumnHeader = cellPositions(ed)[0];

        dragColumnBorder(ed, firstColumnHeader, +60);

        // Column 1 → 240 on all three rows; column 2 untouched at 120.
        expect(colwidths(ed)).toEqual([[240], [120], [240], [120], [240], [120]]);
    });

    it('narrows every cell of the dragged column', () => {
        const ed = makeEditor(SIZED_TABLE);

        dragColumnBorder(ed, cellPositions(ed)[0], -40);

        expect(colwidths(ed)).toEqual([[140], [120], [140], [120], [140], [120]]);
    });

    it('resizes the last column too (lastColumnResizable)', () => {
        const ed = makeEditor(SIZED_TABLE);
        const secondColumnHeader = cellPositions(ed)[1];

        dragColumnBorder(ed, secondColumnHeader, +80);

        expect(colwidths(ed)).toEqual([[180], [200], [180], [200], [180], [200]]);
    });

    it('sizes a column of a table that had no widths at all', () => {
        const ed = makeEditor(PLAIN_TABLE);

        // jsdom reports offsetWidth 0, so the start width is 0 and the drag
        // resolves to the clamp — the point here is only which cells change.
        dragColumnBorder(ed, cellPositions(ed)[0], +200);

        expect(colwidths(ed)).toEqual([[200], null, [200], null]);
    });

    it('leaves a second table in the document untouched', () => {
        const ed = makeEditor(`${SIZED_TABLE}<p>between</p>${SIZED_TABLE}`);
        const positions = cellPositions(ed);

        dragColumnBorder(ed, positions[0], +60);

        expect(colwidths(ed).slice(6)).toEqual([[180], [120], [180], [120], [180], [120]]);
    });

    it('puts the width where the markdown serializer will find it', () => {
        const ed = makeEditor(SIZED_TABLE);

        dragColumnBorder(ed, cellPositions(ed)[0], +60);

        expect(ed.getHTML()).toContain('colwidth="240"');
    });

    it('is a single undo step', () => {
        const ed = makeEditor(SIZED_TABLE);

        dragColumnBorder(ed, cellPositions(ed)[0], +60);
        ed.commands.undo();

        expect(colwidths(ed)).toEqual([[180], [120], [180], [120], [180], [120]]);
    });
});

describe('table column resize — AC-04 the cellMinWidth clamp', () => {
    it('cannot be dragged narrower than cellMinWidth', () => {
        const ed = makeEditor(SIZED_TABLE);

        dragColumnBorder(ed, cellPositions(ed)[0], -500);

        expect(colwidths(ed)).toEqual([[60], [120], [60], [120], [60], [120]]);
    });

    it('stops exactly at cellMinWidth rather than one pixel below', () => {
        const ed = makeEditor(SIZED_TABLE);

        // 180 - 119 = 61, one pixel above the floor.
        dragColumnBorder(ed, cellPositions(ed)[0], -119);
        expect(colwidths(ed)[0]).toEqual([61]);

        // 61 - 5 would be 56; the clamp holds it at 60.
        dragColumnBorder(ed, cellPositions(ed)[0], -5);
        expect(colwidths(ed)[0]).toEqual([60]);
    });

    it('clamps the last column as well', () => {
        const ed = makeEditor(SIZED_TABLE);

        dragColumnBorder(ed, cellPositions(ed)[1], -500);

        expect(colwidths(ed)).toEqual([[180], [60], [180], [60], [180], [60]]);
    });

    it('uses the configured cellMinWidth, not the plugin default of 25', () => {
        const ed = makeEditor(SIZED_TABLE, 100);

        dragColumnBorder(ed, cellPositions(ed)[0], -500);

        expect(colwidths(ed)[0]).toEqual([100]);
    });
});
