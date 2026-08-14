/**
 * tableCellBackground.test.ts — the `backgroundColor` cell attribute
 * (AC-06, AC-13, AC-14).
 *
 * The helper functions are exercised directly; the attribute itself is driven
 * through a real Editor configured the way `RichEditorCore.tsx` configures it,
 * so parse → attribute → render is the real tiptap path rather than a
 * hand-called `renderHTML`.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { Editor } from '@tiptap/core';
import { StarterKit } from '@tiptap/starter-kit';
import { Table } from '@tiptap/extension-table';
import { TableRow } from '@tiptap/extension-table-row';
import { CellSelection } from '@tiptap/pm/tables';
import {
    TABLE_CELL_COLORS,
    activeCellBackgroundColor,
    TableCellWithBackground,
    TableHeaderWithBackground,
    isKnownTableCellColor,
    tableCellBackgroundVar,
    tableCellColorFromStyle,
} from '../../../../src/server/spa/client/react/features/notes/editor/extensions/tableCellBackground';
import {
    htmlToMarkdown,
    markdownToHtml,
} from '../../../../src/server/spa/client/react/features/notes/editor/noteMarkdown';

let editor: Editor | null = null;

function makeEditor(content: string): Editor {
    editor = new Editor({
        extensions: [
            StarterKit.configure({ link: false }),
            Table.configure({ resizable: true, handleWidth: 5, cellMinWidth: 60, lastColumnResizable: true }),
            TableRow,
            TableCellWithBackground,
            TableHeaderWithBackground,
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

describe('TABLE_CELL_COLORS palette', () => {
    it('exposes the six shared tokens with light-theme swatches', () => {
        expect(TABLE_CELL_COLORS.map(c => c.token)).toEqual([
            'yellow', 'green', 'blue', 'pink', 'orange', 'purple',
        ]);
        for (const color of TABLE_CELL_COLORS) {
            expect(color.swatch).toMatch(/^#[0-9a-f]{6}$/i);
            expect(color.name.length).toBeGreaterThan(0);
        }
    });

    it('names the CSS variable after the token', () => {
        expect(tableCellBackgroundVar('yellow')).toBe('--note-table-bg-yellow');
    });

    it('recognises only palette tokens', () => {
        expect(isKnownTableCellColor('green')).toBe(true);
        expect(isKnownTableCellColor('chartreuse')).toBe(false);
        expect(isKnownTableCellColor(null)).toBe(false);
        expect(isKnownTableCellColor(42)).toBe(false);
    });
});

describe('tableCellColorFromStyle', () => {
    it('reads our own CSS variable back', () => {
        expect(tableCellColorFromStyle('background-color: var(--note-table-bg-blue);')).toBe('blue');
    });

    it('maps an exact light-palette hex to its token, case-insensitively', () => {
        expect(tableCellColorFromStyle('background-color: #FFF3B0')).toBe('yellow');
    });

    it('ignores other declarations in the same style attribute', () => {
        expect(tableCellColorFromStyle('text-align: center; background-color: #b9f5d0;')).toBe('green');
    });

    it('drops colors outside the palette rather than guessing a nearest token', () => {
        expect(tableCellColorFromStyle('background-color: red')).toBeNull();
        expect(tableCellColorFromStyle('background-color: rgb(12, 34, 56)')).toBeNull();
        expect(tableCellColorFromStyle('background-color: var(--note-table-bg-chartreuse)')).toBeNull();
        expect(tableCellColorFromStyle('text-align: right')).toBeNull();
        expect(tableCellColorFromStyle('')).toBeNull();
        expect(tableCellColorFromStyle(null)).toBeNull();
    });
});

describe('backgroundColor cell attribute', () => {
    it('defaults to null and renders no background attributes', () => {
        const ed = makeEditor('<table><tbody><tr><td>a</td></tr></tbody></table>');
        expect(cells(ed)[0].attrs.backgroundColor).toBeNull();
        const html = ed.getHTML();
        expect(html).not.toContain('data-bg');
        expect(html).not.toContain('background-color');
    });

    it('parses data-bg and renders both the token and the CSS variable (AC-06)', () => {
        const ed = makeEditor('<table><tbody><tr><td data-bg="yellow">a</td></tr></tbody></table>');
        expect(cells(ed)[0].attrs.backgroundColor).toBe('yellow');
        const html = ed.getHTML();
        expect(html).toContain('data-bg="yellow"');
        expect(html).toContain('background-color: var(--note-table-bg-yellow);');
    });

    it('carries the attribute on header cells too', () => {
        const ed = makeEditor('<table><tbody><tr><th data-bg="green">h</th></tr></tbody></table>');
        const [cell] = cells(ed);
        expect(cell.type).toBe('tableHeader');
        expect(cell.attrs.backgroundColor).toBe('green');
        expect(ed.getHTML()).toContain('data-bg="green"');
    });

    it('falls back to an inline background-color hex when data-bg is absent', () => {
        const ed = makeEditor(
            '<table><tbody><tr><td style="background-color: #bde0fe">a</td></tr></tbody></table>',
        );
        expect(cells(ed)[0].attrs.backgroundColor).toBe('blue');
    });

    it('drops an unknown data-bg value without throwing (AC-14)', () => {
        const ed = makeEditor(
            '<table><tbody><tr><td data-bg="chartreuse">a</td><td style="background-color: red">b</td></tr></tbody></table>',
        );
        expect(cells(ed).map(c => c.attrs.backgroundColor)).toEqual([null, null]);
        const html = ed.getHTML();
        expect(html).not.toContain('chartreuse');
        expect(html).not.toContain('var(--note-table-bg-');
    });

    it('keeps colspan, rowspan and colwidth alongside a fill (AC-13)', () => {
        const ed = makeEditor(
            '<table><tbody><tr><td colspan="2" rowspan="3" colwidth="120,140" data-bg="pink">a</td></tr></tbody></table>',
        );
        const attrs = cells(ed)[0].attrs;
        expect(attrs.backgroundColor).toBe('pink');
        expect(attrs.colspan).toBe(2);
        expect(attrs.rowspan).toBe(3);
        expect(attrs.colwidth).toEqual([120, 140]);

        const html = ed.getHTML();
        expect(html).toContain('colspan="2"');
        expect(html).toContain('rowspan="3"');
        expect(html).toContain('colwidth="120,140"');
        expect(html).toContain('data-bg="pink"');
    });

    it('keeps an authored text-align style when a fill is added', () => {
        const ed = makeEditor(
            '<table><tbody><tr><td style="text-align: center" data-bg="orange">a</td></tr></tbody></table>',
        );
        const html = ed.getHTML();
        expect(html).toContain('data-bg="orange"');
        expect(html).toMatch(/text-align:\s*center/);
        expect(html).toContain('var(--note-table-bg-orange)');
    });

    it('setCellAttribute fills the caret cell and clears it again', () => {
        const ed = makeEditor('<table><tbody><tr><td>a</td><td>b</td></tr></tbody></table>');
        ed.commands.setTextSelection(3);
        ed.chain().focus().setCellAttribute('backgroundColor', 'purple').run();
        expect(cells(ed).map(c => c.attrs.backgroundColor)).toEqual(['purple', null]);

        ed.chain().focus().setCellAttribute('backgroundColor', null).run();
        expect(cells(ed).map(c => c.attrs.backgroundColor)).toEqual([null, null]);
    });
});

// ── Selection-aware active token (AC-03, AC-04, AC-15) ───────────────────────

/** Document positions of every cell node, in document order. */
function cellPositions(ed: Editor): number[] {
    const found: number[] = [];
    ed.state.doc.descendants((node, pos) => {
        if (node.type.name === 'tableCell' || node.type.name === 'tableHeader') found.push(pos);
    });
    return found;
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

const GRID =
    '<table><tbody>'
    + '<tr><th>h1</th><th>h2</th></tr>'
    + '<tr><td>a</td><td>b</td></tr>'
    + '</tbody></table>';

describe('activeCellBackgroundColor', () => {
    it('returns null without an editor', () => {
        expect(activeCellBackgroundColor(null)).toBeNull();
        expect(activeCellBackgroundColor(undefined)).toBeNull();
    });

    it('reads the caret cell, including a header cell', () => {
        const ed = makeEditor(
            '<table><tbody><tr><th data-bg="blue">h</th></tr><tr><td data-bg="pink">a</td></tr></tbody></table>',
        );
        const [headerPos, cellPos] = cellPositions(ed);
        ed.commands.setTextSelection(headerPos + 2);
        expect(activeCellBackgroundColor(ed)).toBe('blue');
        ed.commands.setTextSelection(cellPos + 2);
        expect(activeCellBackgroundColor(ed)).toBe('pink');
    });

    it('returns null for an unfilled cell', () => {
        const ed = makeEditor(GRID);
        ed.commands.setTextSelection(cellPositions(ed)[0] + 2);
        expect(activeCellBackgroundColor(ed)).toBeNull();
    });

    it('reports the shared token of a uniformly filled cell selection', () => {
        const ed = makeEditor(GRID);
        selectCells(ed, 0, 3);
        ed.chain().focus().setCellAttribute('backgroundColor', 'yellow').run();
        expect(activeCellBackgroundColor(ed)).toBe('yellow');
    });

    it('reports null when the selection spans cells with differing fills', () => {
        const ed = makeEditor(GRID);
        selectCells(ed, 0, 1);
        ed.chain().focus().setCellAttribute('backgroundColor', 'green').run();
        selectCells(ed, 0, 3);
        expect(activeCellBackgroundColor(ed)).toBeNull();
    });

    it('ignores an unknown token left on the cell', () => {
        const ed = makeEditor('<table><tbody><tr><td>a</td></tr></tbody></table>');
        const [pos] = cellPositions(ed);
        ed.view.dispatch(ed.state.tr.setNodeMarkup(pos, undefined, {
            ...ed.state.doc.nodeAt(pos)!.attrs,
            backgroundColor: 'chartreuse',
        }));
        ed.commands.setTextSelection(pos + 2);
        expect(activeCellBackgroundColor(ed)).toBeNull();
    });
});

describe('setCellAttribute over a cell selection', () => {
    it('fills a whole row, header included, in one undo step (AC-03, AC-04)', () => {
        const ed = makeEditor(GRID);
        selectCells(ed, 0, 1);
        ed.chain().focus().setCellAttribute('backgroundColor', 'blue').run();

        expect(cells(ed).map(c => c.attrs.backgroundColor)).toEqual(['blue', 'blue', null, null]);
        ed.commands.undo();
        expect(cells(ed).map(c => c.attrs.backgroundColor)).toEqual([null, null, null, null]);
    });

    it('fills a whole column across header and body rows (AC-04)', () => {
        const ed = makeEditor(GRID);
        selectCells(ed, 0, 2);
        ed.chain().focus().setCellAttribute('backgroundColor', 'orange').run();

        expect(cells(ed).map(c => c.attrs.backgroundColor)).toEqual(['orange', null, 'orange', null]);
    });

    it('clears every cell in the selection (AC-05)', () => {
        const ed = makeEditor(GRID);
        selectCells(ed, 0, 3);
        ed.chain().focus().setCellAttribute('backgroundColor', 'pink').run();
        selectCells(ed, 0, 3);
        ed.chain().focus().setCellAttribute('backgroundColor', null).run();

        expect(cells(ed).map(c => c.attrs.backgroundColor)).toEqual([null, null, null, null]);
        expect(ed.getHTML()).not.toContain('data-bg');
    });
});

describe('markdown round trip through a real editor (AC-12)', () => {
    /** doc → getHTML → .md → HTML → doc, the exact save/reload path. */
    function reload(ed: Editor): Editor {
        const md = htmlToMarkdown(ed.getHTML());
        ed.destroy();
        return makeEditor(markdownToHtml(md));
    }

    it('survives a save and reload with every token intact', () => {
        const ed = makeEditor(GRID);
        selectCells(ed, 0, 1);
        ed.chain().focus().setCellAttribute('backgroundColor', 'blue').run();
        selectCells(ed, 3, 3);
        ed.chain().focus().setCellAttribute('backgroundColor', 'purple').run();
        const before = cells(ed).map(c => `${c.type}:${String(c.attrs.backgroundColor)}`);
        expect(before).toEqual([
            'tableHeader:blue', 'tableHeader:blue', 'tableCell:null', 'tableCell:purple',
        ]);

        const reloaded = reload(ed);
        expect(cells(reloaded).map(c => `${c.type}:${String(c.attrs.backgroundColor)}`)).toEqual(before);
    });

    it('leaves an uncolored table on the pipe-table path', () => {
        const ed = makeEditor(GRID);
        const md = htmlToMarkdown(ed.getHTML());
        expect(md).toContain('| --- |');
        expect(md).not.toContain('<table');
    });

    it('keeps a fill and a colwidth on the same cell (AC-13)', () => {
        const ed = makeEditor(GRID);
        selectCells(ed, 0, 0);
        ed.chain().focus().setCellAttribute('backgroundColor', 'green').run();
        ed.chain().focus().setCellAttribute('colwidth', [180]).run();

        const reloaded = reload(ed);
        const first = cells(reloaded)[0];
        expect(first.attrs.backgroundColor).toBe('green');
        expect(first.attrs.colwidth).toEqual([180]);
    });
});
