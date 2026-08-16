/**
 * AC-01: the superscript / subscript marks as RichEditorCore registers them —
 * they apply `<sup>` / `<sub>` in the editor DOM, they carry Tiptap's default
 * `Mod-.` / `Mod-,` shortcuts, and the `excludes` extension makes them mutually
 * exclusive (upstream declares no `excludes`, so a run could otherwise carry
 * both marks at once).
 *
 * The toolbar half (AC-02) lives in NoteEditorToolbar.test.tsx; the Markdown
 * round trip (AC-03) lives in noteMarkdown.test.ts.
 */
import { describe, it, expect } from 'vitest';
import { Editor } from '@tiptap/core';
import { StarterKit } from '@tiptap/starter-kit';
import { Superscript } from '@tiptap/extension-superscript';
import { Subscript } from '@tiptap/extension-subscript';

/** The same pair RichEditorCore registers, extended the same way. */
const SUPERSCRIPT = Superscript.extend({ excludes: 'superscript subscript' });
const SUBSCRIPT = Subscript.extend({ excludes: 'superscript subscript' });

function makeEditor(content: string): Editor {
    return new Editor({
        extensions: [StarterKit, SUPERSCRIPT, SUBSCRIPT],
        content,
    });
}

describe('superscript / subscript marks', () => {
    it('toggleSuperscript wraps the selection in <sup>', () => {
        const editor = makeEditor('<p>x2</p>');
        editor.commands.setTextSelection({ from: 2, to: 3 });
        editor.commands.toggleSuperscript();
        expect(editor.getHTML()).toBe('<p>x<sup>2</sup></p>');
        expect(editor.isActive('superscript')).toBe(true);
        editor.destroy();
    });

    it('toggleSubscript wraps the selection in <sub>', () => {
        const editor = makeEditor('<p>H2O</p>');
        editor.commands.setTextSelection({ from: 2, to: 3 });
        editor.commands.toggleSubscript();
        expect(editor.getHTML()).toBe('<p>H<sub>2</sub>O</p>');
        expect(editor.isActive('subscript')).toBe(true);
        editor.destroy();
    });

    it('applying superscript over a subscript run clears the subscript', () => {
        const editor = makeEditor('<p>H<sub>2</sub>O</p>');
        editor.commands.setTextSelection({ from: 2, to: 3 });
        editor.commands.toggleSuperscript();
        expect(editor.getHTML()).toBe('<p>H<sup>2</sup>O</p>');
        expect(editor.isActive('subscript')).toBe(false);
        editor.destroy();
    });

    it('applying subscript over a superscript run clears the superscript', () => {
        const editor = makeEditor('<p>x<sup>2</sup></p>');
        editor.commands.setTextSelection({ from: 2, to: 3 });
        editor.commands.toggleSubscript();
        expect(editor.getHTML()).toBe('<p>x<sub>2</sub></p>');
        expect(editor.isActive('superscript')).toBe(false);
        editor.destroy();
    });

    it('parses existing <sup>/<sub> HTML back into the marks', () => {
        const editor = makeEditor('<p>H<sub>2</sub>O and x<sup>2</sup></p>');
        expect(editor.getHTML()).toBe('<p>H<sub>2</sub>O and x<sup>2</sup></p>');
        editor.destroy();
    });

    it('keeps Tiptap\'s default Mod-. / Mod-, shortcuts', () => {
        expect(Object.keys(SUPERSCRIPT.config.addKeyboardShortcuts!.call({
            editor: null,
        } as never))).toEqual(['Mod-.']);
        expect(Object.keys(SUBSCRIPT.config.addKeyboardShortcuts!.call({
            editor: null,
        } as never))).toEqual(['Mod-,']);
    });
});
