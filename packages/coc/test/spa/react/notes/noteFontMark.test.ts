/**
 * AC-02, editor half: a font chosen in a real Tiptap editor must survive the
 * full save/reload cycle — editor HTML → Markdown → editor HTML — and come back
 * as the same `textStyle` mark.
 *
 * The markdown half (marked/turndown rules) is covered by noteMarkdownFont.test.ts;
 * this file guards the wiring in RichEditorCore's extension list, which those
 * tests cannot see.
 */
import { describe, it, expect } from 'vitest';
import { Editor } from '@tiptap/core';
import { StarterKit } from '@tiptap/starter-kit';
import { Highlight } from '@tiptap/extension-highlight';
import { TextStyle, Color, FontFamily } from '@tiptap/extension-text-style';
import {
    markdownToHtml,
    htmlToMarkdown,
} from '../../../../src/server/spa/client/react/features/notes/editor/noteMarkdown';
import {
    FONT_FAMILY_OPTIONS,
    fontStackKey,
    normalizeFontStack,
} from '../../../../src/server/spa/client/react/features/notes/editor/fontFamilies';

const RED = '#e11d48';
const MONO_STACK = FONT_FAMILY_OPTIONS.find((o) => o.id === 'mono')!.stack;
const MONO = normalizeFontStack(MONO_STACK)!;

/** Same extension subset RichEditorCore registers for text-style work. */
function createEditor(content = '<p>hello world</p>') {
    return new Editor({
        extensions: [
            StarterKit.configure({ heading: { levels: [1, 2, 3] }, link: false }),
            Highlight.configure({ multicolor: true }),
            TextStyle,
            Color,
            FontFamily,
        ],
        content,
    });
}

/** Select "hello" (positions 1-6 in a single leading paragraph). */
function selectHello(editor: Editor) {
    editor.commands.setTextSelection({ from: 1, to: 6 });
}

describe('font family mark in a real editor', () => {
    it('exposes setFontFamily/unsetFontFamily on the chain', () => {
        const editor = createEditor();
        const chain = editor.chain();
        expect(typeof chain.setFontFamily).toBe('function');
        expect(typeof chain.unsetFontFamily).toBe('function');
        editor.destroy();
    });

    it('editor HTML → markdown persists the font as an inline span', () => {
        const editor = createEditor();
        selectHello(editor);
        editor.chain().focus().setFontFamily(MONO_STACK).run();
        expect(htmlToMarkdown(editor.getHTML()).trim()).toBe(`<span style="font-family:${MONO}">hello</span> world`);
        editor.destroy();
    });

    it('reload restores the font: markdown → editor → same markdown', () => {
        const md = `<span style="font-family:${MONO}">hello</span> world`;
        const editor = createEditor(markdownToHtml(md));
        editor.commands.setTextSelection({ from: 2, to: 3 });
        expect(fontStackKey(editor.getAttributes('textStyle').fontFamily)).toBe(fontStackKey(MONO_STACK));
        // " world" is outside the span and must stay unstyled.
        editor.commands.setTextSelection({ from: 9, to: 10 });
        expect(fontStackKey(editor.getAttributes('textStyle').fontFamily)).toBeNull();
        expect(htmlToMarkdown(editor.getHTML()).trim()).toBe(md);
        editor.destroy();
    });

    it('unsetFontFamily removes the span and the markdown goes back to plain', () => {
        const editor = createEditor();
        selectHello(editor);
        editor.chain().focus().setFontFamily(MONO_STACK).run();
        selectHello(editor);
        editor.chain().focus().unsetFontFamily().run();
        expect(htmlToMarkdown(editor.getHTML()).trim()).toBe('hello world');
        editor.destroy();
    });

    it('font and color share one span and both survive the round trip', () => {
        const editor = createEditor();
        selectHello(editor);
        editor.chain().focus().setColor(RED).setFontFamily(MONO_STACK).run();
        const md = htmlToMarkdown(editor.getHTML()).trim();
        expect(md).toBe(`<span style="color:${RED}; font-family:${MONO}">hello</span> world`);

        const reloaded = createEditor(markdownToHtml(md));
        reloaded.commands.setTextSelection({ from: 2, to: 3 });
        expect(reloaded.getAttributes('textStyle').color).toBeTruthy();
        expect(fontStackKey(reloaded.getAttributes('textStyle').fontFamily)).toBe(fontStackKey(MONO_STACK));
        // Idempotent: a second save produces byte-identical Markdown.
        expect(htmlToMarkdown(reloaded.getHTML()).trim()).toBe(md);
        reloaded.destroy();
        editor.destroy();
    });

    it('font nests inside bold and survives the round trip', () => {
        const editor = createEditor();
        selectHello(editor);
        editor.chain().focus().toggleBold().setFontFamily(MONO_STACK).run();
        const md = htmlToMarkdown(editor.getHTML()).trim();
        expect(md).toContain(`font-family:${MONO}`);
        expect(md).toContain('**');

        const reloaded = createEditor(markdownToHtml(md));
        reloaded.commands.setTextSelection({ from: 2, to: 3 });
        expect(fontStackKey(reloaded.getAttributes('textStyle').fontFamily)).toBe(fontStackKey(MONO_STACK));
        expect(reloaded.isActive('bold')).toBe(true);
        expect(htmlToMarkdown(reloaded.getHTML()).trim()).toBe(md);
        reloaded.destroy();
        editor.destroy();
    });

    it('unsetColor leaves the font intact and vice versa', () => {
        const editor = createEditor();
        selectHello(editor);
        editor.chain().focus().setColor(RED).setFontFamily(MONO_STACK).run();

        selectHello(editor);
        editor.chain().focus().unsetColor().run();
        let md = htmlToMarkdown(editor.getHTML()).trim();
        expect(md).toContain(`font-family:${MONO}`);
        expect(md).not.toContain('color:');

        selectHello(editor);
        editor.chain().focus().unsetFontFamily().run();
        md = htmlToMarkdown(editor.getHTML()).trim();
        expect(md).toBe('hello world');
        editor.destroy();
    });

    it('a foreign pasted font stack round-trips without crashing', () => {
        const editor = createEditor();
        selectHello(editor);
        editor.chain().focus().setFontFamily('Wingdings, fantasy').run();
        const md = htmlToMarkdown(editor.getHTML()).trim();
        expect(md).toBe('<span style="font-family:Wingdings, fantasy">hello</span> world');
        expect(htmlToMarkdown(markdownToHtml(md)).trim()).toBe(md);
        editor.destroy();
    });
});
