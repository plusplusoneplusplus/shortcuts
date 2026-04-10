import { describe, it, expect } from 'vitest';
import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import Table from '@tiptap/extension-table';
import TableRow from '@tiptap/extension-table-row';
import TableCell from '@tiptap/extension-table-cell';
import TableHeader from '@tiptap/extension-table-header';
import Highlight from '@tiptap/extension-highlight';

function makeEditor() {
    return new Editor({
        extensions: [
            StarterKit,
            Table.configure({ resizable: false }),
            TableRow,
            TableCell,
            TableHeader,
            Highlight.configure({ multicolor: true }),
        ],
        content: '',
    });
}

describe('noteEditor table extensions', () => {
    it('initialises Tiptap editor with table extensions without errors', () => {
        expect(() => makeEditor()).not.toThrow();
    });

    it('accepts HTML table content via setContent() without silently dropping it', () => {
        const editor = makeEditor();
        const html = '<table><tbody><tr><td>Alpha</td><td>Beta</td></tr></tbody></table>';
        editor.commands.setContent(html);
        const out = editor.getHTML();
        expect(out).toContain('<table');
        expect(out).toContain('Alpha');
        expect(out).toContain('Beta');
        editor.destroy();
    });

    it('preserves table structure with th and td cells in getHTML()', () => {
        const editor = makeEditor();
        const html = `
            <table>
              <thead><tr><th>Name</th><th>Score</th></tr></thead>
              <tbody><tr><td>Alice</td><td>42</td></tr></tbody>
            </table>`;
        editor.commands.setContent(html);
        const out = editor.getHTML();
        expect(out).toContain('<th');
        expect(out).toContain('Name');
        expect(out).toContain('<td');
        expect(out).toContain('Alice');
        editor.destroy();
    });
});

describe('noteEditor highlight extension', () => {
    it('initialises with Highlight extension without errors', () => {
        expect(() => makeEditor()).not.toThrow();
    });

    it('preserves <mark> content via setContent() and getHTML()', () => {
        const editor = makeEditor();
        editor.commands.setContent('<p><mark>highlighted</mark></p>');
        const out = editor.getHTML();
        expect(out).toContain('<mark');
        expect(out).toContain('highlighted');
        editor.destroy();
    });

    it('preserves multicolor <mark> with data-color attribute', () => {
        const editor = makeEditor();
        editor.commands.setContent('<p><mark data-color="#ffc8dd" style="background-color: #ffc8dd">pink text</mark></p>');
        const out = editor.getHTML();
        expect(out).toContain('<mark');
        expect(out).toContain('pink text');
        expect(out).toContain('#ffc8dd');
        editor.destroy();
    });

    it('toggleHighlight command applies mark', () => {
        const editor = makeEditor();
        editor.commands.setContent('<p>hello world</p>');
        editor.commands.selectAll();
        editor.commands.toggleHighlight({ color: '#b9f5d0' });
        const out = editor.getHTML();
        expect(out).toContain('<mark');
        expect(out).toContain('#b9f5d0');
        editor.destroy();
    });
});
