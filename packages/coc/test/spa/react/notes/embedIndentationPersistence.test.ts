/**
 * embedIndentationPersistence.test.ts — AC-02 coverage for lossless persistence
 * of visual-embed indentation through the Markdown save/reload cycle.
 *
 * Drives a live Tiptap editor: sets an indent on each block-level visual embed
 * (image, pdfBlock, mapBlock, mermaidBlock, mathDisplay), serializes to Markdown
 * via htmlToMarkdown, reloads via markdownToHtml into a fresh editor, and asserts
 * the indent level AND every embed-specific attribute survived unchanged.
 * Returning an embed to level 0 must drop the raw HTML and restore the canonical
 * Markdown form.
 */

import { describe, it, expect } from 'vitest';
import { Editor } from '@tiptap/core';
import { StarterKit } from '@tiptap/starter-kit';
import { IndentExtension } from '../../../../src/server/spa/client/react/features/notes/editor/extensions/indentExtension';
import { ResizableImage } from '../../../../src/server/spa/client/react/features/notes/editor/extensions/resizableImage';
import { PdfBlock } from '../../../../src/server/spa/client/react/features/notes/editor/extensions/pdfBlock';
import { MapBlock } from '../../../../src/server/spa/client/react/features/notes/editor/extensions/mapBlock';
import { MermaidBlock } from '../../../../src/server/spa/client/react/features/notes/editor/extensions/mermaidBlock';
import { MathInline, MathDisplay } from '../../../../src/server/spa/client/react/features/notes/editor/extensions/mathNode';
import { htmlToMarkdown, markdownToHtml } from '../../../../src/server/spa/client/react/features/notes/editor/noteMarkdown';

const MAP_URL = 'https://www.google.com/maps/embed?pb=!1m18!1m12';

// Initial editor HTML for each embed (matches each node's parseHTML input).
const EMBED_HTML: Record<string, string> = {
    image: '<img src=".attachments/a.png" alt="pic">',
    pdfBlock:
        '<div class="md-pdf-embed" data-pdf-url=".attachments/a.pdf" data-pdf-label="Doc"></div>',
    mapBlock: `<div class="md-map-embed" data-map-url="${MAP_URL}" data-map-label="Map"></div>`,
    mermaidBlock: '<pre><code class="language-mermaid">graph TD\nA --&gt; B</code></pre>',
    mathDisplay: '<div data-math="display" data-tex="x^2" data-delim="double-dollar">x^2</div>',
};

// Embed-specific attributes that must survive the save/reload cycle unchanged.
const DATA_ATTRS: Record<string, string[]> = {
    image: ['src', 'alt'],
    pdfBlock: ['url', 'label'],
    mapBlock: ['url', 'label'],
    mermaidBlock: ['code'],
    mathDisplay: ['tex', 'delimiter'],
};

function makeEditor(content: string): Editor {
    return new Editor({
        extensions: [
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

/** Return the attrs of the first node of `type`, or null if none. */
function firstNodeAttrs(editor: Editor, type: string): Record<string, unknown> | null {
    let attrs: Record<string, unknown> | null = null;
    editor.state.doc.descendants((node) => {
        if (attrs === null && node.type.name === type) attrs = { ...node.attrs };
        return attrs === null;
    });
    return attrs;
}

/** Select the first node of `type` (NodeSelection). */
function selectNode(editor: Editor, type: string): void {
    let pos: number | null = null;
    editor.state.doc.descendants((node, p) => {
        if (pos === null && node.type.name === type) pos = p;
        return pos === null;
    });
    if (pos === null) throw new Error(`no ${type} node found in doc`);
    editor.commands.setNodeSelection(pos);
}

/** Serialize an editor's content to Markdown and reload it into a fresh editor. */
function saveReload(editor: Editor): { markdown: string; reloaded: Editor } {
    const markdown = htmlToMarkdown(editor.getHTML());
    const reloaded = makeEditor(markdownToHtml(markdown));
    return { markdown, reloaded };
}

describe.each(Object.keys(EMBED_HTML))('indent persistence for <%s>', (type) => {
    it('preserves a nonzero indent and all embed data across save/reload', () => {
        const editor = makeEditor(EMBED_HTML[type]);
        const before = firstNodeAttrs(editor, type);
        expect(before).not.toBeNull();
        expect(before!.indent).toBe(0);

        // Indent twice via the toolbar-compatible command.
        selectNode(editor, type);
        editor.chain().focus().increaseIndent().run();
        editor.chain().focus().increaseIndent().run();
        expect(firstNodeAttrs(editor, type)!.indent).toBe(2);

        const { markdown, reloaded } = saveReload(editor);
        // The persisted Markdown must carry the indent as raw HTML metadata.
        expect(markdown).toContain('data-indent="2"');

        const after = firstNodeAttrs(reloaded, type);
        expect(after).not.toBeNull();
        expect(after!.indent).toBe(2);
        // Every embed-specific attribute survived unchanged.
        for (const key of DATA_ATTRS[type]) {
            expect(after![key]).toEqual(before![key]);
        }

        editor.destroy();
        reloaded.destroy();
    });

    it('returns to canonical Markdown (no data-indent) when indented back to level 0', () => {
        const editor = makeEditor(EMBED_HTML[type]);
        selectNode(editor, type);
        editor.chain().focus().increaseIndent().run();
        editor.chain().focus().increaseIndent().run();

        // Reload at indent 2, then bring it back down to 0 and re-save.
        const { reloaded } = saveReload(editor);
        selectNode(reloaded, type);
        reloaded.chain().focus().decreaseIndent().run();
        reloaded.chain().focus().decreaseIndent().run();
        expect(firstNodeAttrs(reloaded, type)!.indent).toBe(0);

        const finalMarkdown = htmlToMarkdown(reloaded.getHTML());
        expect(finalMarkdown).not.toContain('data-indent');

        // The node still reloads with its data intact at level 0.
        const final = makeEditor(markdownToHtml(finalMarkdown));
        const attrs = firstNodeAttrs(final, type);
        expect(attrs).not.toBeNull();
        expect(attrs!.indent).toBe(0);

        editor.destroy();
        reloaded.destroy();
        final.destroy();
    });

    it('clamps a persisted indent above MAX (8) on reload', () => {
        // A hand-authored / corrupted note may carry an over-range data-indent;
        // the shared safety policy clamps it to MAX on parse.
        const indentedHtml: Record<string, string> = {
            image: '<img src=".attachments/a.png" alt="pic" data-indent="99">',
            pdfBlock:
                '<div class="md-pdf-embed" data-pdf-url=".attachments/a.pdf" data-pdf-label="Doc" data-indent="99"></div>',
            mapBlock: `<div class="md-map-embed" data-map-url="${MAP_URL}" data-map-label="Map" data-indent="99"></div>`,
            mermaidBlock:
                '<pre data-indent="99"><code class="language-mermaid">graph TD\nA --&gt; B</code></pre>',
            mathDisplay:
                '<div data-math="display" data-tex="x^2" data-delim="double-dollar" data-indent="99">x^2</div>',
        };
        const editor = makeEditor(indentedHtml[type]);
        expect(firstNodeAttrs(editor, type)!.indent).toBe(8);
        editor.destroy();
    });
});
