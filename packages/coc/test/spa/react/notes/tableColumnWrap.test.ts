/**
 * tableColumnWrap.test.ts — the per-column `wrap` cell attribute and the
 * column toggle command (AC-01, AC-02, AC-03, AC-05, AC-06, AC-07).
 *
 * The attribute is driven through a real Editor configured the way
 * `RichEditorCore.tsx` configures it, so parse → attribute → render is the real
 * tiptap path. jsdom does no layout, so nothing here asserts on widths or on
 * whether an ellipsis rendered — only on attributes and doc content.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { Editor } from '@tiptap/core';
import { StarterKit } from '@tiptap/starter-kit';
import { Table } from '@tiptap/extension-table';
import { TableRow } from '@tiptap/extension-table-row';
import { CellSelection } from '@tiptap/pm/tables';
import {
    TableCellWithWrap,
    TableHeaderWithWrap,
    activeColumnWrap,
    isTableWrapMode,
    toggleActiveColumnWrap,
} from '../../../../src/server/spa/client/react/features/notes/editor/extensions/tableColumnWrap';

let editor: Editor | null = null;

function makeEditor(content: string): Editor {
    editor = new Editor({
        extensions: [
            StarterKit.configure({ link: false }),
            Table.configure({ resizable: true, handleWidth: 5, cellMinWidth: 60, lastColumnResizable: true }),
            TableRow,
            TableCellWithWrap,
            TableHeaderWithWrap,
        ],
        content,
    });
    return editor;
}

afterEach(() => {
    editor?.destroy();
    editor = null;
});

/** Every cell node in the doc, in document order. */
function cells(ed: Editor): { type: string; attrs: Record<string, unknown> }[] {
    const found: { type: string; attrs: Record<string, unknown> }[] = [];
    ed.state.doc.descendants(node => {
        if (node.type.name === 'tableCell' || node.type.name === 'tableHeader') {
            found.push({ type: node.type.name, attrs: node.attrs });
        }
    });
    return found;
}

function wraps(ed: Editor): unknown[] {
    return cells(ed).map(c => c.attrs.wrap);
}

/** Document positions of every cell node, in document order. */
function cellPositions(ed: Editor): number[] {
    const found: number[] = [];
    ed.state.doc.descendants((node, pos) => {
        if (node.type.name === 'tableCell' || node.type.name === 'tableHeader') found.push(pos);
    });
    return found;
}

/** Text content of the cell at the given document-order index. */
function cellText(ed: Editor, index: number): string {
    const pos = cellPositions(ed)[index];
    return ed.state.doc.nodeAt(pos)!.textContent;
}

/** Put the caret inside the cell at the given document-order index. */
function caretInCell(ed: Editor, index: number): void {
    ed.commands.setTextSelection(cellPositions(ed)[index] + 2);
}

/** Select the rectangle spanning the cells at the two given indices. */
function selectCells(ed: Editor, anchorIndex: number, headIndex: number): void {
    const positions = cellPositions(ed);
    const { state } = ed;
    ed.view.dispatch(
        state.tr.setSelection(
            CellSelection.create(state.doc, positions[anchorIndex], positions[headIndex]),
        ),
    );
}

// A 3-column grid: header row plus two body rows. Cell indices run 0..8.
const GRID =
    '<table><tbody>'
    + '<tr><th>h1</th><th>h2</th><th>h3</th></tr>'
    + '<tr><td>a1</td><td>a2</td><td>a3</td></tr>'
    + '<tr><td>b1</td><td>b2</td><td>b3</td></tr>'
    + '</tbody></table>';

describe('wrap cell attribute (AC-01)', () => {
    it('defaults to wrap and renders no data-wrap attribute', () => {
        const ed = makeEditor('<table><tbody><tr><td>a</td></tr></tbody></table>');
        expect(cells(ed)[0].attrs.wrap).toBe('wrap');
        expect(ed.getHTML()).not.toContain('data-wrap');
    });

    it('parses data-wrap="nowrap" and renders it back', () => {
        const ed = makeEditor('<table><tbody><tr><td data-wrap="nowrap">a</td></tr></tbody></table>');
        expect(cells(ed)[0].attrs.wrap).toBe('nowrap');
        expect(ed.getHTML()).toContain('data-wrap="nowrap"');
    });

    it('carries the attribute on header cells too', () => {
        const ed = makeEditor('<table><tbody><tr><th data-wrap="nowrap">h</th></tr></tbody></table>');
        const [cell] = cells(ed);
        expect(cell.type).toBe('tableHeader');
        expect(cell.attrs.wrap).toBe('nowrap');
        expect(ed.getHTML()).toContain('data-wrap="nowrap"');
    });

    it('treats an unknown data-wrap value as the default', () => {
        const ed = makeEditor('<table><tbody><tr><td data-wrap="sideways">a</td></tr></tbody></table>');
        expect(cells(ed)[0].attrs.wrap).toBe('wrap');
        expect(ed.getHTML()).not.toContain('data-wrap');
    });

    it('ignores a pasted white-space style rather than clipping uninvited', () => {
        const ed = makeEditor(
            '<table><tbody><tr><td style="white-space: nowrap">a</td></tr></tbody></table>',
        );
        expect(cells(ed)[0].attrs.wrap).toBe('wrap');
    });

    it('keeps colspan, rowspan, colwidth and a fill alongside the wrap mode', () => {
        const ed = makeEditor(
            '<table><tbody><tr>'
            + '<td colspan="2" rowspan="3" colwidth="120,140" data-bg="pink" data-wrap="nowrap">a</td>'
            + '</tr></tbody></table>',
        );
        const attrs = cells(ed)[0].attrs;
        expect(attrs.wrap).toBe('nowrap');
        expect(attrs.backgroundColor).toBe('pink');
        expect(attrs.colspan).toBe(2);
        expect(attrs.rowspan).toBe(3);
        expect(attrs.colwidth).toEqual([120, 140]);

        const html = ed.getHTML();
        expect(html).toContain('data-wrap="nowrap"');
        expect(html).toContain('data-bg="pink"');
        expect(html).toContain('colwidth="120,140"');
    });

    it('recognises only the two wrap modes', () => {
        expect(isTableWrapMode('wrap')).toBe(true);
        expect(isTableWrapMode('nowrap')).toBe(true);
        expect(isTableWrapMode('clip')).toBe(false);
        expect(isTableWrapMode(null)).toBe(false);
    });
});

describe('toggleActiveColumnWrap (AC-02, AC-03)', () => {
    it('sets every cell of the caret column, header row included (AC-02)', () => {
        const ed = makeEditor(GRID);
        caretInCell(ed, 4); // middle column, first body row
        expect(toggleActiveColumnWrap(ed)).toBe(true);

        expect(wraps(ed)).toEqual([
            'wrap', 'nowrap', 'wrap',
            'wrap', 'nowrap', 'wrap',
            'wrap', 'nowrap', 'wrap',
        ]);
        const html = ed.getHTML();
        expect(html.match(/data-wrap="nowrap"/g)).toHaveLength(3);
    });

    it('restores the column and drops data-wrap on a second press (AC-03)', () => {
        const ed = makeEditor(GRID);
        caretInCell(ed, 0);
        toggleActiveColumnWrap(ed);
        expect(activeColumnWrap(ed)).toBe('nowrap');

        expect(toggleActiveColumnWrap(ed)).toBe(true);
        expect(wraps(ed).every(w => w === 'wrap')).toBe(true);
        expect(ed.getHTML()).not.toContain('data-wrap');
    });

    it('applies the whole column in one undo step', () => {
        const ed = makeEditor(GRID);
        caretInCell(ed, 0);
        toggleActiveColumnWrap(ed);
        ed.commands.undo();
        expect(wraps(ed).every(w => w === 'wrap')).toBe(true);
    });

    it('covers every column a cell selection spans', () => {
        const ed = makeEditor(GRID);
        selectCells(ed, 0, 1); // first two columns of the header row
        expect(toggleActiveColumnWrap(ed)).toBe(true);

        expect(wraps(ed)).toEqual([
            'nowrap', 'nowrap', 'wrap',
            'nowrap', 'nowrap', 'wrap',
            'nowrap', 'nowrap', 'wrap',
        ]);
    });

    it('reaches every column a merged cell covers', () => {
        const ed = makeEditor(
            '<table><tbody>'
            + '<tr><td colspan="2">wide</td><td>c</td></tr>'
            + '<tr><td>a</td><td>b</td><td>c</td></tr>'
            + '</tbody></table>',
        );
        caretInCell(ed, 0);
        expect(toggleActiveColumnWrap(ed)).toBe(true);
        // The merged cell plus both cells beneath it; the third column is untouched.
        expect(wraps(ed)).toEqual(['nowrap', 'wrap', 'nowrap', 'nowrap', 'wrap']);
    });

    it('finishes a half-applied column rather than reverting it', () => {
        const ed = makeEditor(
            '<table><tbody>'
            + '<tr><td data-wrap="nowrap">a</td><td>x</td></tr>'
            + '<tr><td>b</td><td>y</td></tr>'
            + '</tbody></table>',
        );
        caretInCell(ed, 0);
        expect(activeColumnWrap(ed)).toBe('wrap');
        toggleActiveColumnWrap(ed);
        expect(wraps(ed)).toEqual(['nowrap', 'wrap', 'nowrap', 'wrap']);
    });

    it('does nothing outside a table', () => {
        const ed = makeEditor('<p>plain</p>');
        expect(activeColumnWrap(ed)).toBeNull();
        expect(toggleActiveColumnWrap(ed)).toBe(false);
    });

    it('tolerates a missing editor', () => {
        expect(activeColumnWrap(null)).toBeNull();
        expect(activeColumnWrap(undefined)).toBeNull();
        expect(toggleActiveColumnWrap(null)).toBe(false);
    });
});

describe('activeColumnWrap tracks the selection (AC-04)', () => {
    it('reports the column under the caret and updates when it moves', () => {
        const ed = makeEditor(GRID);
        caretInCell(ed, 1);
        toggleActiveColumnWrap(ed);

        caretInCell(ed, 7); // same column, last row
        expect(activeColumnWrap(ed)).toBe('nowrap');
        caretInCell(ed, 6); // first column
        expect(activeColumnWrap(ed)).toBe('wrap');
    });
});

describe('editing and structural commands (AC-05, AC-06, AC-07)', () => {
    it('leaves cell text editable and intact when clipped (AC-05)', () => {
        const ed = makeEditor(GRID);
        caretInCell(ed, 3);
        toggleActiveColumnWrap(ed);

        caretInCell(ed, 3);
        ed.commands.insertContent('edited-');
        // Clipping is visual only: the cell still holds all of its text.
        expect(cellText(ed, 3)).toBe('edited-a1');
        expect(wraps(ed)[3]).toBe('nowrap');
    });

    // AC-06 is not satisfied yet: prosemirror-tables builds a new row from the
    // cell type's defaults, so a row added into a nowrap column wraps. Locked in
    // as the current behavior so the follow-up that fixes it has to update this
    // test deliberately rather than silently.
    it('gives a row added into a nowrap column the default (AC-06, pending)', () => {
        const ed = makeEditor(GRID);
        caretInCell(ed, 3);
        toggleActiveColumnWrap(ed);

        caretInCell(ed, 3);
        ed.chain().focus().addRowAfter().run();
        expect(cells(ed)).toHaveLength(12);
        // New row sits between the old rows 2 and 3, so its cells are 6..8.
        expect(wraps(ed).slice(6, 9)).toEqual(['wrap', 'wrap', 'wrap']);
        // The rows that already existed keep the setting.
        expect(wraps(ed).filter(w => w === 'nowrap')).toHaveLength(3);
    });

    it('keeps the setting on the right column after addColumnBefore (AC-07)', () => {
        const ed = makeEditor(GRID);
        caretInCell(ed, 1);
        toggleActiveColumnWrap(ed);

        caretInCell(ed, 0);
        ed.chain().focus().addColumnBefore().run();
        // A blank column is inserted at index 0, so the nowrap column is now 2.
        expect(wraps(ed).slice(0, 4)).toEqual(['wrap', 'wrap', 'nowrap', 'wrap']);
        expect(wraps(ed).filter(w => w === 'nowrap')).toHaveLength(3);
    });

    it('keeps the setting on the right column after deleteColumn (AC-07)', () => {
        const ed = makeEditor(GRID);
        caretInCell(ed, 2);
        toggleActiveColumnWrap(ed);

        caretInCell(ed, 0);
        ed.chain().focus().deleteColumn().run();
        // Two columns left, the surviving nowrap one now last in each row.
        expect(wraps(ed)).toEqual([
            'wrap', 'nowrap',
            'wrap', 'nowrap',
            'wrap', 'nowrap',
        ]);
    });
});
