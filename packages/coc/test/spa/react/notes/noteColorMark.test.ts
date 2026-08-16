/**
 * AC-01/AC-02, editor half: the `textStyle`/`color` mark must actually exist in
 * a real Tiptap editor, and the colors it produces must survive the full
 * save/reload cycle — editor HTML → Markdown → editor HTML.
 *
 * The markdown half (marked/turndown rules) is covered by
 * noteMarkdownColor.test.ts; this file guards the wiring in RichEditorCore's
 * extension list, which those tests cannot see.
 */
import { describe, it, expect } from 'vitest';
import { Editor } from '@tiptap/core';
import { StarterKit } from '@tiptap/starter-kit';
import { Highlight } from '@tiptap/extension-highlight';
import { TextStyle, Color } from '@tiptap/extension-text-style';
import {
    markdownToHtml,
    htmlToMarkdown,
} from '../../../../src/server/spa/client/react/features/notes/editor/noteMarkdown';
import {
    DEFAULT_HIGHLIGHT_COLOR,
    HIGHLIGHT_COLORS,
    normalizeCssColor,
} from '../../../../src/server/spa/client/react/features/notes/editor/colorPalette';

const RED = '#e11d48';
const GREEN = HIGHLIGHT_COLORS[1].color;

/** Same extension subset RichEditorCore registers for color work. */
function createEditor(content = '<p>hello world</p>') {
    return new Editor({
        extensions: [
            StarterKit.configure({ heading: { levels: [1, 2, 3] }, link: false }),
            Highlight.configure({ multicolor: true }),
            TextStyle,
            Color,
        ],
        content,
    });
}

/** Select "hello" (positions 1-6 in a single leading paragraph). */
function selectHello(editor: Editor) {
    editor.commands.setTextSelection({ from: 1, to: 6 });
}

describe('text color mark in a real editor', () => {
    it('exposes setColor/unsetColor and toggleHighlight on the chain', () => {
        const editor = createEditor();
        const chain = editor.chain();
        expect(typeof chain.setColor).toBe('function');
        expect(typeof chain.unsetColor).toBe('function');
        expect(typeof chain.toggleHighlight).toBe('function');
        editor.destroy();
    });

    it('setColor wraps the selection in a styled span', () => {
        const editor = createEditor();
        selectHello(editor);
        editor.chain().focus().setColor(RED).run();
        const html = editor.getHTML();
        expect(html).toContain('<span');
        expect(normalizeCssColor(editor.getAttributes('textStyle').color)).toBe(RED);
        editor.destroy();
    });

    it('editor HTML → markdown persists the color as an inline span', () => {
        const editor = createEditor();
        selectHello(editor);
        editor.chain().focus().setColor(RED).run();
        const md = htmlToMarkdown(editor.getHTML()).trim();
        expect(md).toBe(`<span style="color:${RED}">hello</span> world`);
        editor.destroy();
    });

    it('reload restores the color: markdown → editor → same markdown', () => {
        const md = `<span style="color:${RED}">hello</span> world`;
        const editor = createEditor(markdownToHtml(md));
        editor.commands.setTextSelection({ from: 2, to: 3 });
        expect(normalizeCssColor(editor.getAttributes('textStyle').color)).toBe(RED);
        // " world" is outside the span and must stay uncolored.
        editor.commands.setTextSelection({ from: 9, to: 10 });
        expect(normalizeCssColor(editor.getAttributes('textStyle').color)).toBeNull();
        expect(htmlToMarkdown(editor.getHTML()).trim()).toBe(md);
        editor.destroy();
    });

    it('unsetColor removes the span and the markdown goes back to plain', () => {
        const editor = createEditor();
        selectHello(editor);
        editor.chain().focus().setColor(RED).run();
        selectHello(editor);
        editor.chain().focus().unsetColor().run();
        expect(htmlToMarkdown(editor.getHTML()).trim()).toBe('hello world');
        editor.destroy();
    });

    it('uncolored text emits no span noise', () => {
        const editor = createEditor('<p>plain paragraph</p>');
        expect(htmlToMarkdown(editor.getHTML()).trim()).toBe('plain paragraph');
        editor.destroy();
    });

    it('a non-default highlight persists its background color', () => {
        const editor = createEditor();
        selectHello(editor);
        editor.chain().focus().toggleHighlight({ color: GREEN }).run();
        const md = htmlToMarkdown(editor.getHTML()).trim();
        expect(md).toBe(`<mark style="background-color:${GREEN}">hello</mark> world`);

        const reloaded = createEditor(markdownToHtml(md));
        reloaded.commands.setTextSelection({ from: 2, to: 3 });
        expect(normalizeCssColor(reloaded.getAttributes('highlight').color)).toBe(GREEN);
        expect(htmlToMarkdown(reloaded.getHTML()).trim()).toBe(md);
        reloaded.destroy();
        editor.destroy();
    });

    it('a default-color highlight stays bare ==text==', () => {
        const editor = createEditor();
        selectHello(editor);
        editor.chain().focus().toggleHighlight({ color: DEFAULT_HIGHLIGHT_COLOR }).run();
        expect(htmlToMarkdown(editor.getHTML()).trim()).toBe('==hello== world');
        editor.destroy();
    });

    it('text color and highlight coexist on one selection', () => {
        const editor = createEditor();
        selectHello(editor);
        editor.chain().focus().setColor(RED).toggleHighlight({ color: GREEN }).run();
        const md = htmlToMarkdown(editor.getHTML()).trim();
        expect(md).toContain(`color:${RED}`);
        expect(md).toContain(`background-color:${GREEN}`);

        const reloaded = createEditor(markdownToHtml(md));
        reloaded.commands.setTextSelection({ from: 2, to: 3 });
        expect(normalizeCssColor(reloaded.getAttributes('textStyle').color)).toBe(RED);
        expect(normalizeCssColor(reloaded.getAttributes('highlight').color)).toBe(GREEN);
        // Idempotent: a second save produces byte-identical Markdown.
        expect(htmlToMarkdown(reloaded.getHTML()).trim()).toBe(md);
        reloaded.destroy();
        editor.destroy();
    });

    it('unsetHighlight leaves the text color intact and vice versa', () => {
        const editor = createEditor();
        selectHello(editor);
        editor.chain().focus().setColor(RED).toggleHighlight({ color: GREEN }).run();

        selectHello(editor);
        editor.chain().focus().unsetHighlight().run();
        let md = htmlToMarkdown(editor.getHTML()).trim();
        expect(md).toContain(`color:${RED}`);
        expect(md).not.toContain('background-color');

        selectHello(editor);
        editor.chain().focus().unsetColor().run();
        md = htmlToMarkdown(editor.getHTML()).trim();
        expect(md).toBe('hello world');
        editor.destroy();
    });

    it('color nests inside bold and survives the round trip', () => {
        const editor = createEditor();
        selectHello(editor);
        editor.chain().focus().toggleBold().setColor(RED).run();
        const md = htmlToMarkdown(editor.getHTML()).trim();
        expect(md).toContain(`color:${RED}`);
        expect(md).toContain('**');

        const reloaded = createEditor(markdownToHtml(md));
        reloaded.commands.setTextSelection({ from: 2, to: 3 });
        expect(normalizeCssColor(reloaded.getAttributes('textStyle').color)).toBe(RED);
        expect(reloaded.isActive('bold')).toBe(true);
        reloaded.destroy();
        editor.destroy();
    });
});
