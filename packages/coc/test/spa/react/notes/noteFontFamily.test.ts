/**
 * AC-01: the font-family list and its normalizer, plus proof that the
 * `fontFamily` attribute really exists on the `textStyle` mark in a Tiptap
 * editor built from RichEditorCore's extension subset.
 *
 * The toolbar half lives in NoteEditorToolbar.test.tsx; the Markdown round trip
 * (AC-02) lives in noteMarkdownFont.test.ts.
 */
import { describe, it, expect } from 'vitest';
import { Editor } from '@tiptap/core';
import { StarterKit } from '@tiptap/starter-kit';
import { TextStyle, Color, FontFamily } from '@tiptap/extension-text-style';
import {
    FONT_FAMILY_OPTIONS,
    findFontOption,
    fontStackKey,
    normalizeFontStack,
} from '../../../../src/server/spa/client/react/features/notes/editor/fontFamilies';

const MONO = '"JetBrains Mono", Consolas, "SF Mono", Menlo, monospace';

describe('FONT_FAMILY_OPTIONS', () => {
    it('is exactly the six agreed entries, in order', () => {
        expect(FONT_FAMILY_OPTIONS.map((o) => o.label)).toEqual([
            'Default',
            'Sans',
            'Serif',
            'Mono',
            'Arial',
            'Times',
        ]);
    });

    it('ships a monospace coding font', () => {
        const mono = FONT_FAMILY_OPTIONS.find((o) => o.id === 'mono');
        expect(mono?.stack).toBe(MONO);
        expect(mono?.stack).toContain('monospace');
    });

    it('leaves Default with no stack — it unsets the mark rather than setting a font', () => {
        expect(FONT_FAMILY_OPTIONS[0].stack).toBe('');
    });

    it('every stack ends in a generic family so nothing depends on a downloaded font', () => {
        for (const { stack } of FONT_FAMILY_OPTIONS.filter((o) => o.stack)) {
            expect(stack).toMatch(/(sans-serif|serif|monospace)$/);
        }
    });

    it('excludes the fonts that were rejected from the list', () => {
        const all = FONT_FAMILY_OPTIONS.map((o) => o.stack).join(' ');
        expect(all).not.toContain('Courier New');
        expect(all).not.toContain('Comic Sans');
    });
});

describe('normalizeFontStack', () => {
    it('rewrites double quotes to single so the stack fits in a style attribute', () => {
        expect(normalizeFontStack(MONO)).toBe("'JetBrains Mono', Consolas, 'SF Mono', Menlo, monospace");
        expect(normalizeFontStack(MONO)).not.toContain('"');
    });

    it('normalizes spacing and quoting the browser churns', () => {
        expect(normalizeFontStack("'JetBrains Mono',Consolas,  'SF Mono' ,Menlo,monospace")).toBe(
            normalizeFontStack(MONO),
        );
    });

    it('is idempotent — a second save produces the same string', () => {
        const once = normalizeFontStack(MONO)!;
        expect(normalizeFontStack(once)).toBe(once);
    });

    it('keeps a leading -apple-system bare', () => {
        expect(normalizeFontStack('-apple-system, "Segoe UI", Roboto, sans-serif')).toBe(
            "-apple-system, 'Segoe UI', Roboto, sans-serif",
        );
    });

    it('preserves an unknown foreign family', () => {
        expect(normalizeFontStack('Comic Sans MS, cursive')).toBe("'Comic Sans MS', cursive");
    });

    it('rejects values that are not a plain font stack', () => {
        for (const value of [
            '',
            '   ',
            null,
            undefined,
            'url(evil.css)',
            'expression(alert(1))',
            'Arial; position: fixed',
            'var(--x)',
            '<script>',
        ]) {
            expect(normalizeFontStack(value)).toBeNull();
        }
    });
});

describe('findFontOption', () => {
    it('matches a stack regardless of quote style and case', () => {
        expect(findFontOption(MONO)?.id).toBe('mono');
        expect(findFontOption("'jetbrains mono',consolas,'sf mono',menlo,MONOSPACE")?.id).toBe('mono');
    });

    it('returns null for unset, foreign and unparsable values', () => {
        expect(findFontOption(null)).toBeNull();
        expect(findFontOption('')).toBeNull();
        expect(findFontOption('Comic Sans MS, cursive')).toBeNull();
        expect(findFontOption('url(evil.css)')).toBeNull();
    });

    it('never matches the Default row, which carries no stack', () => {
        expect(fontStackKey(FONT_FAMILY_OPTIONS[0].stack)).toBeNull();
        for (const option of FONT_FAMILY_OPTIONS.filter((o) => o.stack)) {
            expect(findFontOption(option.stack)?.id).toBe(option.id);
        }
    });
});

/** The extension subset RichEditorCore registers for text-style work. */
function createEditor(content = '<p>hello world</p>') {
    return new Editor({
        extensions: [StarterKit.configure({ heading: { levels: [1, 2, 3] }, link: false }), TextStyle, Color, FontFamily],
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

    it('setFontFamily wraps the selection in a styled span', () => {
        const editor = createEditor();
        selectHello(editor);
        editor.chain().focus().setFontFamily(MONO).run();
        expect(editor.getHTML()).toContain('font-family');
        expect(findFontOption(editor.getAttributes('textStyle').fontFamily)?.id).toBe('mono');
        editor.destroy();
    });

    it('applies per selection — the rest of the paragraph keeps no font', () => {
        const editor = createEditor();
        selectHello(editor);
        editor.chain().focus().setFontFamily(MONO).run();
        editor.commands.setTextSelection({ from: 8, to: 12 });
        expect(editor.getAttributes('textStyle').fontFamily).toBeFalsy();
        editor.destroy();
    });

    it('unsetFontFamily clears it again', () => {
        const editor = createEditor();
        selectHello(editor);
        editor.chain().focus().setFontFamily(MONO).run();
        selectHello(editor);
        editor.chain().focus().unsetFontFamily().run();
        expect(editor.getAttributes('textStyle').fontFamily).toBeFalsy();
        editor.destroy();
    });

    it('coexists with a text color on the same run', () => {
        const editor = createEditor();
        selectHello(editor);
        editor.chain().focus().setColor('#e11d48').setFontFamily(MONO).run();
        const attrs = editor.getAttributes('textStyle');
        expect(attrs.color).toBeTruthy();
        expect(findFontOption(attrs.fontFamily)?.id).toBe('mono');

        // Dropping the font must leave the color alone, and vice versa.
        selectHello(editor);
        editor.chain().focus().unsetFontFamily().run();
        expect(editor.getAttributes('textStyle').color).toBeTruthy();
        editor.destroy();
    });

    it('a collapsed selection stores the mark so typed text picks the font up', () => {
        const editor = createEditor();
        editor.commands.setTextSelection({ from: 6, to: 6 });
        editor.chain().focus().setFontFamily(MONO).run();
        expect(findFontOption(editor.getAttributes('textStyle').fontFamily)?.id).toBe('mono');
        editor.destroy();
    });
});
