/**
 * embedIndentation.test.ts — AC-01 coverage for visual-embed indentation.
 *
 * Verifies that the shared IndentExtension commands (and the Tab / Shift-Tab
 * shortcuts) increase and decrease the `indent` attribute on every block-level
 * visual embed — image, pdfBlock, mapBlock, mermaidBlock, mathDisplay — using
 * the same 0..MAX_INDENT scale as paragraphs and headings, with clamping at
 * both ends. Inline mathInline must NOT gain an indent attribute.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Editor } from '@tiptap/core';
import { StarterKit } from '@tiptap/starter-kit';
import {
    IndentExtension,
    MAX_INDENT,
    INDENT_TYPES,
    EMBED_INDENT_TYPES,
    TEXT_INDENT_TYPES,
} from '../../../../src/server/spa/client/react/features/notes/editor/extensions/indentExtension';
import { ResizableImage } from '../../../../src/server/spa/client/react/features/notes/editor/extensions/resizableImage';
import { PdfBlock } from '../../../../src/server/spa/client/react/features/notes/editor/extensions/pdfBlock';
import { MapBlock } from '../../../../src/server/spa/client/react/features/notes/editor/extensions/mapBlock';
import { MermaidBlock } from '../../../../src/server/spa/client/react/features/notes/editor/extensions/mermaidBlock';
import { MathInline, MathDisplay } from '../../../../src/server/spa/client/react/features/notes/editor/extensions/mathNode';

const MAP_URL = 'https://www.google.com/maps/embed?pb=!1m18!1m12';

// HTML fragment that setContent() must parse into a single node of `type`.
const EMBED_HTML: Record<string, string> = {
    image: '<img src=".attachments/a.png" alt="pic">',
    pdfBlock:
        '<div class="md-pdf-embed" data-pdf-url=".attachments/a.pdf" data-pdf-label="Doc"></div>',
    mapBlock: `<div class="md-map-embed" data-map-url="${MAP_URL}" data-map-label="Map"></div>`,
    mermaidBlock: '<pre><code class="language-mermaid">graph TD\nA --&gt; B</code></pre>',
    mathDisplay: '<div data-math="display" data-tex="x^2" data-delim="double-dollar">x^2</div>',
};

function makeEditor(content: string) {
    return new Editor({
        extensions: [
            // Embed nodes precede StarterKit so their parseHTML rules win.
            MapBlock,
            PdfBlock,
            MermaidBlock,
            MathInline,
            MathDisplay,
            StarterKit.configure({ heading: { levels: [1, 2, 3] }, link: false }),
            IndentExtension,
            ResizableImage.configure({ inline: false, allowBase64: false }),
        ],
        content,
    });
}

/** Find the first node of `type` and select it (NodeSelection). */
function selectNode(editor: Editor, type: string): void {
    let pos: number | null = null;
    editor.state.doc.descendants((node, p) => {
        if (pos === null && node.type.name === type) pos = p;
        return pos === null;
    });
    if (pos === null) throw new Error(`no ${type} node found in doc`);
    editor.commands.setNodeSelection(pos);
}

/** Read the indent attribute of the first node of `type`. */
function indentOf(editor: Editor, type: string): number {
    let val: number | null = null;
    editor.state.doc.descendants((node) => {
        if (val === null && node.type.name === type) val = (node.attrs.indent as number) ?? 0;
        return val === null;
    });
    return val ?? 0;
}

/** The exact chain pattern the toolbar buttons use. */
function toolbarIncrease(editor: Editor): boolean {
    return editor.chain().focus().increaseIndent().run();
}
function toolbarDecrease(editor: Editor): boolean {
    return editor.chain().focus().decreaseIndent().run();
}

/** Dispatch a real Tab / Shift-Tab keydown to exercise the keymap. */
function pressTab(editor: Editor, shift = false): void {
    editor.view.dom.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Tab', shiftKey: shift, bubbles: true, cancelable: true }),
    );
}

describe('centralized indent node-type lists', () => {
    it('INDENT_TYPES is text types plus the five embed types', () => {
        expect(TEXT_INDENT_TYPES).toEqual(['paragraph', 'heading']);
        expect(EMBED_INDENT_TYPES).toEqual([
            'image',
            'pdfBlock',
            'mapBlock',
            'mermaidBlock',
            'mathDisplay',
        ]);
        for (const t of [...TEXT_INDENT_TYPES, ...EMBED_INDENT_TYPES]) {
            expect(INDENT_TYPES).toContain(t);
        }
    });

    it('does NOT list inline mathInline as an indentable type', () => {
        expect(INDENT_TYPES).not.toContain('mathInline');
    });
});

describe.each(EMBED_INDENT_TYPES)('indent commands on <%s>', (type) => {
    let editor: Editor;

    beforeEach(() => {
        editor = makeEditor(EMBED_HTML[type]);
    });
    afterEach(() => {
        editor.destroy();
    });

    it('parses into the expected node with indent default 0', () => {
        expect(indentOf(editor, type)).toBe(0);
        expect(editor.getHTML()).not.toContain('data-indent');
    });

    it('toolbar Increase indent raises the level and serializes data-indent', () => {
        selectNode(editor, type);
        expect(toolbarIncrease(editor)).toBe(true);
        expect(indentOf(editor, type)).toBe(1);
        expect(editor.getHTML()).toContain('data-indent="1"');
    });

    it('toolbar Increase then Decrease returns to level 0 (no data-indent)', () => {
        selectNode(editor, type);
        toolbarIncrease(editor);
        toolbarIncrease(editor);
        expect(indentOf(editor, type)).toBe(2);
        toolbarDecrease(editor);
        expect(indentOf(editor, type)).toBe(1);
        toolbarDecrease(editor);
        expect(indentOf(editor, type)).toBe(0);
        expect(editor.getHTML()).not.toContain('data-indent');
    });

    it('Tab increases and Shift+Tab decreases the selected embed', () => {
        selectNode(editor, type);
        pressTab(editor);
        expect(indentOf(editor, type)).toBe(1);
        pressTab(editor);
        expect(indentOf(editor, type)).toBe(2);
        pressTab(editor, true);
        expect(indentOf(editor, type)).toBe(1);
    });

    it('clamps at MAX_INDENT (8) going up', () => {
        selectNode(editor, type);
        for (let i = 0; i < MAX_INDENT + 4; i++) toolbarIncrease(editor);
        expect(indentOf(editor, type)).toBe(MAX_INDENT);
    });

    it('clamps at 0 going down and reports no change', () => {
        selectNode(editor, type);
        expect(indentOf(editor, type)).toBe(0);
        // decreaseIndent on a level-0 node makes no change.
        expect(toolbarDecrease(editor)).toBe(false);
        expect(indentOf(editor, type)).toBe(0);
    });
});

describe('existing text-block indentation is preserved', () => {
    it('paragraph Tab still increases indent', () => {
        const editor = makeEditor('<p>hello</p>');
        editor.commands.setTextSelection(2);
        pressTab(editor);
        expect(indentOf(editor, 'paragraph')).toBe(1);
        editor.destroy();
    });

    it('list-item Tab is left to the list keymap (no paragraph indent applied)', () => {
        const editor = makeEditor('<ul><li><p>one</p></li><li><p>two</p></li></ul>');
        // Put the cursor inside the second list item.
        let liPos = 0;
        let count = 0;
        editor.state.doc.descendants((node, p) => {
            if (node.type.name === 'paragraph') {
                count += 1;
                if (count === 2) liPos = p + 1;
            }
            return true;
        });
        editor.commands.setTextSelection(liPos);
        pressTab(editor);
        // Tab must NOT set a data-indent on the list paragraph (list keymap owns Tab).
        expect(editor.getHTML()).not.toContain('data-indent');
        editor.destroy();
    });
});

describe('inline math is not indentable', () => {
    it('mathInline has no indent attribute', () => {
        const editor = makeEditor('<p>see <span data-math="inline" data-tex="a" data-delim="dollar">a</span></p>');
        let mathInlineAttrs: Record<string, unknown> | null = null;
        editor.state.doc.descendants((node) => {
            if (node.type.name === 'mathInline') mathInlineAttrs = node.attrs;
            return true;
        });
        expect(mathInlineAttrs).not.toBeNull();
        expect(mathInlineAttrs!).not.toHaveProperty('indent');
        editor.destroy();
    });
});
