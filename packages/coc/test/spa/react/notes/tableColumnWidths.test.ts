/**
 * tableColumnWidths.test.ts — the helpers behind "Reset column widths" (AC-08),
 * against a real ProseMirror document.
 *
 * A dragged column border lives in the `colwidth` attribute of every cell in
 * that column, and `noteMarkdown.ts` persists a table as raw HTML exactly when
 * some cell carries one. Clearing them all is what turns the table back into a
 * plain GFM pipe table.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { Editor } from '@tiptap/core';
import { StarterKit } from '@tiptap/starter-kit';
import { Table } from '@tiptap/extension-table';
import { TableRow } from '@tiptap/extension-table-row';
import { TableCell } from '@tiptap/extension-table-cell';
import { TableHeader } from '@tiptap/extension-table-header';
import {
    findActiveTable,
    tableHasColumnWidths,
    activeTableHasColumnWidths,
    clearActiveTableColumnWidths,
} from '../../../../src/server/spa/client/react/features/notes/editor/tableColumnWidths';

let editor: Editor | null = null;

function makeEditor(content: string): Editor {
    editor = new Editor({
        extensions: [
            StarterKit.configure({ link: false }),
            // Mirrors RichEditorCore.tsx.
            Table.configure({ resizable: true, handleWidth: 5, cellMinWidth: 60, lastColumnResizable: true }),
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
<tr><th colwidth="180">A</th><th>B</th></tr>
<tr><td colwidth="180">1</td><td>2</td></tr>
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

/** Put the cursor inside the first cell of the table. */
function cursorInTable(ed: Editor): void {
    let pos: number | null = null;
    ed.state.doc.descendants((node, at) => {
        if (pos === null && node.type.name === 'tableHeader') pos = at + 2;
        return pos === null;
    });
    ed.commands.setTextSelection(pos as unknown as number);
}

describe('tableColumnWidths — detection', () => {
    it('parses colwidth off the cells of a sized table', () => {
        const ed = makeEditor(SIZED_TABLE);
        expect(colwidths(ed)).toEqual([[180], null, [180], null]);
    });

    it('reports widths for a table that has one', () => {
        const ed = makeEditor(SIZED_TABLE);
        cursorInTable(ed);
        expect(activeTableHasColumnWidths(ed)).toBe(true);
    });

    it('reports no widths for a plain table', () => {
        const ed = makeEditor(PLAIN_TABLE);
        cursorInTable(ed);
        expect(activeTableHasColumnWidths(ed)).toBe(false);
    });

    it('reports no widths when the cursor is outside any table', () => {
        const ed = makeEditor(`<p>before</p>${SIZED_TABLE}`);
        ed.commands.setTextSelection(2);
        expect(findActiveTable(ed.state)).toBeNull();
        expect(activeTableHasColumnWidths(ed)).toBe(false);
    });

    it('finds the table node the cursor sits in', () => {
        const ed = makeEditor(SIZED_TABLE);
        cursorInTable(ed);
        const active = findActiveTable(ed.state);
        expect(active).not.toBeNull();
        expect(active!.node.type.name).toBe('table');
        expect(tableHasColumnWidths(active!.node)).toBe(true);
        expect(ed.state.doc.nodeAt(active!.pos)).toBe(active!.node);
    });

    it('tolerates a null editor', () => {
        expect(activeTableHasColumnWidths(null)).toBe(false);
        expect(clearActiveTableColumnWidths(null)).toBe(false);
    });
});

describe('tableColumnWidths — clearing', () => {
    it('clears colwidth on every cell of the table', () => {
        const ed = makeEditor(SIZED_TABLE);
        cursorInTable(ed);

        expect(clearActiveTableColumnWidths(ed)).toBe(true);

        expect(colwidths(ed)).toEqual([null, null, null, null]);
        expect(activeTableHasColumnWidths(ed)).toBe(false);
    });

    it('drops colwidth from the serialized HTML, so the table serializes as a pipe table again', () => {
        const ed = makeEditor(SIZED_TABLE);
        cursorInTable(ed);
        clearActiveTableColumnWidths(ed);

        expect(ed.getHTML()).not.toContain('colwidth');
    });

    it('leaves cell content and table shape untouched', () => {
        const ed = makeEditor(SIZED_TABLE);
        cursorInTable(ed);
        clearActiveTableColumnWidths(ed);

        const html = ed.getHTML();
        expect(html).toContain('A');
        expect(html).toContain('2');
        expect(colwidths(ed).length).toBe(4);
    });

    it('is a no-op on a table that has no widths', () => {
        const ed = makeEditor(PLAIN_TABLE);
        cursorInTable(ed);
        const before = ed.getHTML();

        expect(clearActiveTableColumnWidths(ed)).toBe(false);
        expect(ed.getHTML()).toBe(before);
    });

    it('only touches the table the cursor is in', () => {
        const ed = makeEditor(`${SIZED_TABLE}<p>between</p>${SIZED_TABLE}`);
        cursorInTable(ed); // first table

        clearActiveTableColumnWidths(ed);

        // First table cleared, second one keeps its widths.
        expect(colwidths(ed)).toEqual([null, null, null, null, [180], null, [180], null]);
    });

    it('is undoable in one step', () => {
        const ed = makeEditor(SIZED_TABLE);
        cursorInTable(ed);
        clearActiveTableColumnWidths(ed);

        ed.commands.undo();

        expect(colwidths(ed)).toEqual([[180], null, [180], null]);
    });
});
