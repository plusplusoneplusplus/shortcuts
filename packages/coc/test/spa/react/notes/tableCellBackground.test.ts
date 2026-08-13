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
import {
    TABLE_CELL_COLORS,
    TableCellWithBackground,
    TableHeaderWithBackground,
    isKnownTableCellColor,
    tableCellBackgroundVar,
    tableCellColorFromStyle,
} from '../../../../src/server/spa/client/react/features/notes/editor/extensions/tableCellBackground';

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
