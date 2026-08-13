/**
 * tableHeaderState.test.ts — the header-shape helper behind the header row /
 * header column toolbar toggles (AC-03), against a real ProseMirror document.
 *
 * Header-ness is structural (`tableHeader` vs `tableCell` nodes), so this runs
 * the stock tiptap `toggleHeaderRow` / `toggleHeaderColumn` / `toggleHeaderCell`
 * commands on a real editor rather than asserting against hand-written HTML.
 * The `getHTML()` assertions here double as the source of the realistic HTML
 * literals the `noteMarkdown` serialization tests use.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { Editor } from '@tiptap/core';
import { StarterKit } from '@tiptap/starter-kit';
import { Table } from '@tiptap/extension-table';
import { TableRow } from '@tiptap/extension-table-row';
import { TableCell } from '@tiptap/extension-table-cell';
import { TableHeader } from '@tiptap/extension-table-header';
import {
    tableHeaderState,
    tableHeaderShape,
} from '../../../../src/server/spa/client/react/features/notes/editor/tableHeaderState';
import { findActiveTable } from '../../../../src/server/spa/client/react/features/notes/editor/tableColumnWidths';

let editor: Editor | null = null;

function makeEditor(content = ''): Editor {
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

/** A 2×2 table inserted the way the toolbar's size picker inserts one. */
function insertedTable(): Editor {
    const ed = makeEditor();
    ed.chain().focus().insertTable({ rows: 2, cols: 2, withHeaderRow: true }).run();
    return ed;
}

/** Put the cursor inside the first cell of the first table. */
function cursorInTable(ed: Editor): void {
    let pos: number | null = null;
    ed.state.doc.descendants((node, at) => {
        if (pos === null && (node.type.name === 'tableHeader' || node.type.name === 'tableCell')) {
            pos = at + 2;
        }
        return pos === null;
    });
    ed.commands.setTextSelection(pos as unknown as number);
}

/** Cell tag names row by row, e.g. [['th','th'],['td','td']]. */
function cellTags(ed: Editor): string[][] {
    const active = findActiveTable(ed.state);
    const table = active?.node;
    if (!table) return [];
    const rows: string[][] = [];
    table.forEach((row) => {
        const tags: string[] = [];
        row.forEach((cell) => tags.push(cell.type.name === 'tableHeader' ? 'th' : 'td'));
        rows.push(tags);
    });
    return rows;
}

afterEach(() => {
    editor?.destroy();
    editor = null;
});

describe('tableHeaderState — inserted table', () => {
    it('reports a header row and no header column for withHeaderRow: true', () => {
        const ed = insertedTable();
        cursorInTable(ed);
        expect(tableHeaderState(ed)).toEqual({ row: true, column: false });
        expect(cellTags(ed)).toEqual([['th', 'th'], ['td', 'td']]);
    });

    it('reports neither after toggleHeaderRow', () => {
        const ed = insertedTable();
        cursorInTable(ed);

        ed.chain().focus().toggleHeaderRow().run();

        expect(tableHeaderState(ed)).toEqual({ row: false, column: false });
        expect(cellTags(ed)).toEqual([['td', 'td'], ['td', 'td']]);
    });

    it('reports a header column after toggleHeaderColumn on a header-less table', () => {
        const ed = insertedTable();
        cursorInTable(ed);

        ed.chain().focus().toggleHeaderRow().run();
        ed.chain().focus().toggleHeaderColumn().run();

        expect(tableHeaderState(ed)).toEqual({ row: false, column: true });
        expect(cellTags(ed)).toEqual([['th', 'td'], ['th', 'td']]);
    });

    it('reports both when the corner cell is shared', () => {
        const ed = insertedTable();
        cursorInTable(ed);

        ed.chain().focus().toggleHeaderColumn().run();

        expect(tableHeaderState(ed)).toEqual({ row: true, column: true });
        expect(cellTags(ed)).toEqual([['th', 'th'], ['th', 'td']]);
    });

    it('round-trips back to a plain table when both toggles are turned off', () => {
        const ed = insertedTable();
        cursorInTable(ed);

        ed.chain().focus().toggleHeaderColumn().run();
        ed.chain().focus().toggleHeaderColumn().run();
        ed.chain().focus().toggleHeaderRow().run();

        expect(tableHeaderState(ed)).toEqual({ row: false, column: false });
    });

    it('is undoable across a toggle', () => {
        // Parsed content rather than `insertTable`, so the history has nothing
        // to group the toggle with and undo reverts the toggle alone.
        const ed = makeEditor('<table><tbody><tr><th>A</th><th>B</th></tr><tr><td>1</td><td>2</td></tr></tbody></table>');
        cursorInTable(ed);
        const before = ed.getHTML();

        ed.chain().focus().toggleHeaderColumn().run();
        ed.commands.undo();

        expect(ed.getHTML()).toBe(before);
        expect(tableHeaderState(ed)).toEqual({ row: true, column: false });
    });

    it('does not report a header row for a single header cell', () => {
        const ed = insertedTable();
        cursorInTable(ed);

        ed.chain().focus().toggleHeaderRow().run(); // drop to all td
        ed.chain().focus().toggleHeaderCell().run(); // promote just the caret cell

        expect(cellTags(ed)).toEqual([['th', 'td'], ['td', 'td']]);
        expect(tableHeaderState(ed)).toEqual({ row: false, column: false });
    });
});

describe('tableHeaderState — parsed HTML shapes', () => {
    const cases: Array<{ name: string; html: string; expected: { row: boolean; column: boolean } }> = [
        {
            name: 'header row only',
            html: '<table><tbody><tr><th>A</th><th>B</th></tr><tr><td>1</td><td>2</td></tr></tbody></table>',
            expected: { row: true, column: false },
        },
        {
            name: 'header column only',
            html: '<table><tbody><tr><th>A</th><td>1</td></tr><tr><th>B</th><td>2</td></tr></tbody></table>',
            expected: { row: false, column: true },
        },
        {
            name: 'both',
            html: '<table><tbody><tr><th>A</th><th>B</th></tr><tr><th>1</th><td>2</td></tr></tbody></table>',
            expected: { row: true, column: true },
        },
        {
            name: 'neither',
            html: '<table><tbody><tr><td>A</td><td>B</td></tr><tr><td>1</td><td>2</td></tr></tbody></table>',
            expected: { row: false, column: false },
        },
        {
            name: 'single header cell',
            html: '<table><tbody><tr><td>A</td><th>B</th></tr><tr><td>1</td><td>2</td></tr></tbody></table>',
            expected: { row: false, column: false },
        },
    ];

    for (const { name, html, expected } of cases) {
        it(`reads ${name}`, () => {
            const ed = makeEditor(html);
            cursorInTable(ed);
            expect(tableHeaderState(ed)).toEqual(expected);
        });
    }

    it('reads the shape of the table the cursor is in, not the first one', () => {
        const ed = makeEditor(
            '<table><tbody><tr><th>A</th><th>B</th></tr></tbody></table>'
            + '<p>between</p>'
            + '<table><tbody><tr><th>A</th><td>1</td></tr><tr><th>B</th><td>2</td></tr></tbody></table>',
        );
        // Cursor into the last cell of the document, i.e. the second table.
        ed.commands.setTextSelection(ed.state.doc.content.size - 4);
        expect(tableHeaderState(ed)).toEqual({ row: false, column: true });
    });
});

describe('tableHeaderState — degenerate input', () => {
    it('returns no headers when the cursor is outside a table', () => {
        const ed = makeEditor('<p>before</p><table><tbody><tr><th>A</th></tr></tbody></table>');
        ed.commands.setTextSelection(2);
        expect(tableHeaderState(ed)).toEqual({ row: false, column: false });
    });

    it('tolerates a null editor', () => {
        expect(tableHeaderState(null)).toEqual({ row: false, column: false });
        expect(tableHeaderState(undefined)).toEqual({ row: false, column: false });
    });

    it('returns no headers for a table node with no rows', () => {
        const ed = makeEditor('<table><tbody><tr><th>A</th></tr></tbody></table>');
        const table = findActiveTable(ed.state)?.node;
        expect(table).toBeTruthy();
        const empty = table!.type.create(table!.attrs);
        expect(tableHeaderShape(empty)).toEqual({ row: false, column: false });
    });
});
