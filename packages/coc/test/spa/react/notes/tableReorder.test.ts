/**
 * tableReorder.test.ts — the four row/column move commands (AC-01 … AC-10).
 *
 * Driven through a real Editor configured the way `RichEditorCore.tsx`
 * configures it, so selection → index derivation → prosemirror-tables splice →
 * rendered HTML is the real path. jsdom does no layout, and nothing here needs
 * any: every assertion is about document order or a command's return value.
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import { Editor } from '@tiptap/core';
import { StarterKit } from '@tiptap/starter-kit';
import { Table } from '@tiptap/extension-table';
import { TableRow } from '@tiptap/extension-table-row';
import { CellSelection } from '@tiptap/pm/tables';
import * as pmTables from '@tiptap/pm/tables';
import {
    TableCellWithWrap,
    TableHeaderWithWrap,
} from '../../../../src/server/spa/client/react/features/notes/editor/extensions/tableColumnWrap';
import { TableReorder } from '../../../../src/server/spa/client/react/features/notes/editor/extensions/tableReorder';

let editor: Editor | null = null;

function makeEditor(content: string): Editor {
    editor = new Editor({
        extensions: [
            StarterKit.configure({ link: false }),
            Table.configure({ resizable: true, handleWidth: 5, cellMinWidth: 60, lastColumnResizable: true }),
            TableRow,
            TableCellWithWrap,
            TableHeaderWithWrap,
            TableReorder,
        ],
        content,
    });
    return editor;
}

afterEach(() => {
    editor?.destroy();
    editor = null;
    vi.useRealTimers();
});

/** 3-column table: a header row plus `bodyRows` rows of `<prefix><col>` text. */
function tableHtml(bodyRows: string[][], header = ['H1', 'H2', 'H3']): string {
    const head = `<tr>${header.map((h) => `<th><p>${h}</p></th>`).join('')}</tr>`;
    const body = bodyRows.map((row) => `<tr>${row.map((c) => `<td><p>${c}</p></td>`).join('')}</tr>`).join('');
    return `<table><tbody>${head}${body}</tbody></table>`;
}

const THREE_BY_THREE = tableHtml([
    ['A1', 'A2', 'A3'],
    ['B1', 'B2', 'B3'],
    ['C1', 'C2', 'C3'],
]);

/** Cell text per row, read back off the document rather than the HTML string. */
function rows(ed: Editor): string[][] {
    const out: string[][] = [];
    ed.state.doc.descendants((node) => {
        if (node.type.name !== 'tableRow') return true;
        const cells: string[] = [];
        node.forEach((cell) => cells.push(cell.textContent));
        out.push(cells);
        return false;
    });
    return out;
}

/**
 * Absolute position inside the cell at (row, col) — where a click would put the
 * caret. Walks the doc rather than hard-coding offsets so the helper survives a
 * change in cell content length.
 */
function cellPos(ed: Editor, row: number, col: number): number {
    let tablePos = -1;
    let table: import('@tiptap/pm/model').Node | null = null;
    ed.state.doc.descendants((node, pos) => {
        if (node.type.name === 'table' && !table) {
            table = node;
            tablePos = pos;
        }
        return !table;
    });
    if (!table) throw new Error('no table in doc');
    const map = pmTables.TableMap.get(table);
    return tablePos + 1 + map.positionAt(row, col, table) + 2;
}

function putCaret(ed: Editor, row: number, col: number): void {
    ed.commands.setTextSelection(cellPos(ed, row, col));
}

describe('tableReorder — exports and registration (AC-01)', () => {
    // Cheap insurance against a prosemirror-tables downgrade below 1.8.5:
    // these two commands are recent upstream additions, reached through
    // @tiptap/pm, and their absence would only surface at runtime otherwise.
    it('prosemirror-tables exports moveTableRow and moveTableColumn', () => {
        expect(typeof pmTables.moveTableRow).toBe('function');
        expect(typeof pmTables.moveTableColumn).toBe('function');
    });

    it('registers four move commands on the editor chain', () => {
        const ed = makeEditor(THREE_BY_THREE);
        const chain = ed.chain();
        expect(typeof chain.moveTableRowUp).toBe('function');
        expect(typeof chain.moveTableRowDown).toBe('function');
        expect(typeof chain.moveTableColumnLeft).toBe('function');
        expect(typeof chain.moveTableColumnRight).toBe('function');
    });
});

describe('tableReorder — happy paths (AC-02, AC-03)', () => {
    it('moveTableRowDown swaps the cursor row with the one below it', () => {
        const ed = makeEditor(THREE_BY_THREE);
        putCaret(ed, 1, 0); // row A
        expect(ed.commands.moveTableRowDown()).toBe(true);
        expect(rows(ed)).toEqual([
            ['H1', 'H2', 'H3'],
            ['B1', 'B2', 'B3'],
            ['A1', 'A2', 'A3'],
            ['C1', 'C2', 'C3'],
        ]);
    });

    it('moveTableRowUp swaps the cursor row with the one above it', () => {
        const ed = makeEditor(THREE_BY_THREE);
        putCaret(ed, 3, 2); // row C
        expect(ed.commands.moveTableRowUp()).toBe(true);
        expect(rows(ed)).toEqual([
            ['H1', 'H2', 'H3'],
            ['A1', 'A2', 'A3'],
            ['C1', 'C2', 'C3'],
            ['B1', 'B2', 'B3'],
        ]);
    });

    it('moveTableColumnRight reorders every row consistently', () => {
        const ed = makeEditor(THREE_BY_THREE);
        putCaret(ed, 1, 0);
        expect(ed.commands.moveTableColumnRight()).toBe(true);
        expect(rows(ed)).toEqual([
            ['H2', 'H1', 'H3'],
            ['A2', 'A1', 'A3'],
            ['B2', 'B1', 'B3'],
            ['C2', 'C1', 'C3'],
        ]);
    });

    it('moveTableColumnLeft reorders every row consistently', () => {
        const ed = makeEditor(THREE_BY_THREE);
        putCaret(ed, 2, 2);
        expect(ed.commands.moveTableColumnLeft()).toBe(true);
        expect(rows(ed)).toEqual([
            ['H1', 'H3', 'H2'],
            ['A1', 'A3', 'A2'],
            ['B1', 'B3', 'B2'],
            ['C1', 'C3', 'C2'],
        ]);
    });

    it('carries the whole cell content, not just its text', () => {
        const ed = makeEditor(
            '<table><tbody>'
            + '<tr><th><p>H1</p></th><th><p>H2</p></th></tr>'
            + '<tr><td><p>plain</p></td><td><p>x</p></td></tr>'
            + '<tr><td><p><strong>bold</strong></p></td><td><p>y</p></td></tr>'
            + '</tbody></table>',
        );
        putCaret(ed, 2, 0);
        expect(ed.commands.moveTableRowUp()).toBe(true);
        const html = ed.getHTML();
        expect(html.indexOf('<strong>bold</strong>')).toBeLessThan(html.indexOf('plain'));
    });

    it('keeps header cells as header cells through a body-row move', () => {
        const ed = makeEditor(THREE_BY_THREE);
        putCaret(ed, 1, 0);
        ed.commands.moveTableRowDown();
        expect(ed.getHTML().match(/<th/g)).toHaveLength(3);
    });
});

describe('tableReorder — the header row is pinned at index 0 (AC-04)', () => {
    it('moveTableRowUp returns false in the first body row', () => {
        const ed = makeEditor(THREE_BY_THREE);
        putCaret(ed, 1, 0);
        const before = rows(ed);
        expect(ed.commands.moveTableRowUp()).toBe(false);
        expect(rows(ed)).toEqual(before);
    });

    it('moveTableRowUp returns false in the header row', () => {
        const ed = makeEditor(THREE_BY_THREE);
        putCaret(ed, 0, 1);
        const before = rows(ed);
        expect(ed.commands.moveTableRowUp()).toBe(false);
        expect(rows(ed)).toEqual(before);
    });

    it('moveTableRowDown returns false in the header row', () => {
        const ed = makeEditor(THREE_BY_THREE);
        putCaret(ed, 0, 1);
        const before = rows(ed);
        expect(ed.commands.moveTableRowDown()).toBe(false);
        expect(rows(ed)).toEqual(before);
    });

    it('row 0 moves freely in a table with no header row', () => {
        const ed = makeEditor(
            '<table><tbody>'
            + '<tr><td><p>A1</p></td><td><p>A2</p></td></tr>'
            + '<tr><td><p>B1</p></td><td><p>B2</p></td></tr>'
            + '</tbody></table>',
        );
        putCaret(ed, 0, 0);
        expect(ed.commands.moveTableRowDown()).toBe(true);
        expect(rows(ed)).toEqual([['B1', 'B2'], ['A1', 'A2']]);
    });
});

describe('tableReorder — bounds (AC-05)', () => {
    it('moveTableRowDown returns false in the last row', () => {
        const ed = makeEditor(THREE_BY_THREE);
        putCaret(ed, 3, 0);
        const before = rows(ed);
        expect(ed.commands.moveTableRowDown()).toBe(false);
        expect(rows(ed)).toEqual(before);
    });

    it('moveTableColumnLeft returns false in the first column', () => {
        const ed = makeEditor(THREE_BY_THREE);
        putCaret(ed, 1, 0);
        const before = rows(ed);
        expect(ed.commands.moveTableColumnLeft()).toBe(false);
        expect(rows(ed)).toEqual(before);
    });

    it('moveTableColumnRight returns false in the last column', () => {
        const ed = makeEditor(THREE_BY_THREE);
        putCaret(ed, 1, 2);
        const before = rows(ed);
        expect(ed.commands.moveTableColumnRight()).toBe(false);
        expect(rows(ed)).toEqual(before);
    });
});

describe('tableReorder — outside a table (AC-06)', () => {
    it('every command returns false with the cursor in a paragraph', () => {
        const ed = makeEditor('<p>hello</p>');
        ed.commands.setTextSelection(2);
        expect(ed.commands.moveTableRowUp()).toBe(false);
        expect(ed.commands.moveTableRowDown()).toBe(false);
        expect(ed.commands.moveTableColumnLeft()).toBe(false);
        expect(ed.commands.moveTableColumnRight()).toBe(false);
        expect(ed.getHTML()).toContain('<p>hello</p>');
    });
});

describe('tableReorder — merged cells (AC-07)', () => {
    const MERGED = '<table><tbody>'
        + '<tr><th><p>H1</p></th><th><p>H2</p></th></tr>'
        + '<tr><td colspan="2"><p>wide</p></td></tr>'
        + '<tr><td><p>B1</p></td><td><p>B2</p></td></tr>'
        + '</tbody></table>';

    it('returns false for a colspan table even from an unmerged cell', () => {
        const ed = makeEditor(MERGED);
        putCaret(ed, 2, 0);
        const before = rows(ed);
        expect(ed.commands.moveTableRowUp()).toBe(false);
        expect(ed.commands.moveTableRowDown()).toBe(false);
        expect(ed.commands.moveTableColumnLeft()).toBe(false);
        expect(ed.commands.moveTableColumnRight()).toBe(false);
        expect(rows(ed)).toEqual(before);
    });

    it('returns false for a rowspan table', () => {
        const ed = makeEditor(
            '<table><tbody>'
            + '<tr><th><p>H1</p></th><th><p>H2</p></th></tr>'
            + '<tr><td rowspan="2"><p>tall</p></td><td><p>A2</p></td></tr>'
            + '<tr><td><p>B2</p></td></tr>'
            + '</tbody></table>',
        );
        putCaret(ed, 1, 1);
        const before = rows(ed);
        expect(ed.commands.moveTableRowDown()).toBe(false);
        expect(rows(ed)).toEqual(before);
    });
});

describe('tableReorder — multi-cell selections (AC-08)', () => {
    function selectCells(ed: Editor, from: [number, number], to: [number, number]): void {
        const anchor = ed.state.doc.resolve(cellPos(ed, from[0], from[1]) - 2);
        const head = ed.state.doc.resolve(cellPos(ed, to[0], to[1]) - 2);
        ed.view.dispatch(ed.state.tr.setSelection(new CellSelection(anchor, head)));
    }

    it('row moves return false when the selection spans two rows', () => {
        const ed = makeEditor(THREE_BY_THREE);
        selectCells(ed, [1, 0], [2, 0]);
        const before = rows(ed);
        expect(ed.commands.moveTableRowDown()).toBe(false);
        expect(ed.commands.moveTableRowUp()).toBe(false);
        expect(rows(ed)).toEqual(before);
    });

    it('column moves return false when the selection spans two columns', () => {
        const ed = makeEditor(THREE_BY_THREE);
        selectCells(ed, [1, 0], [1, 1]);
        const before = rows(ed);
        expect(ed.commands.moveTableColumnRight()).toBe(false);
        expect(ed.commands.moveTableColumnLeft()).toBe(false);
        expect(rows(ed)).toEqual(before);
    });
});

describe('tableReorder — selection after a move (AC-09)', () => {
    it('leaves a CellSelection over the moved row at its new index', () => {
        const ed = makeEditor(THREE_BY_THREE);
        putCaret(ed, 1, 0);
        ed.commands.moveTableRowDown();
        const selection = ed.state.selection;
        expect(selection).toBeInstanceOf(CellSelection);
        const texts: string[] = [];
        (selection as CellSelection).forEachCell((cell) => texts.push(cell.textContent));
        expect(texts).toEqual(['A1', 'A2', 'A3']);
    });

    it('repeat invocation keeps moving the same row', () => {
        const ed = makeEditor(THREE_BY_THREE);
        putCaret(ed, 1, 0);
        expect(ed.commands.moveTableRowDown()).toBe(true);
        expect(ed.commands.moveTableRowDown()).toBe(true);
        expect(rows(ed)).toEqual([
            ['H1', 'H2', 'H3'],
            ['B1', 'B2', 'B3'],
            ['C1', 'C2', 'C3'],
            ['A1', 'A2', 'A3'],
        ]);
    });

    it('repeat invocation keeps moving the same column', () => {
        const ed = makeEditor(THREE_BY_THREE);
        putCaret(ed, 1, 0);
        expect(ed.commands.moveTableColumnRight()).toBe(true);
        expect(ed.commands.moveTableColumnRight()).toBe(true);
        expect(rows(ed)[0]).toEqual(['H2', 'H3', 'H1']);
    });
});

describe('tableReorder — undo granularity (AC-10)', () => {
    it('a single move is a single undo step', () => {
        const ed = makeEditor(THREE_BY_THREE);
        const before = rows(ed);
        putCaret(ed, 1, 0);
        ed.commands.moveTableRowDown();
        expect(rows(ed)).not.toEqual(before);
        ed.commands.undo();
        expect(rows(ed)).toEqual(before);
    });

    it('two moves 100 ms apart need two undos', () => {
        vi.useFakeTimers();
        const ed = makeEditor(THREE_BY_THREE);
        const before = rows(ed);
        putCaret(ed, 1, 0);
        ed.commands.moveTableRowDown();
        const afterFirst = rows(ed);
        vi.advanceTimersByTime(100);
        ed.commands.moveTableRowDown();

        ed.commands.undo();
        expect(rows(ed)).toEqual(afterFirst);
        ed.commands.undo();
        expect(rows(ed)).toEqual(before);
    });
});
