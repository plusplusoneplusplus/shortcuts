/**
 * AC-01: the superscript / subscript marks as RichEditorCore registers them —
 * they apply `<sup>` / `<sub>` in the editor DOM, they carry Tiptap's default
 * `Mod-.` / `Mod-,` shortcuts, and the `excludes` extension makes them mutually
 * exclusive (upstream declares no `excludes`, so a run could otherwise carry
 * both marks at once).
 *
 * AC-02's toolbar descriptors are asserted at the bottom of this file (the
 * button rendering itself is covered by formattingCommands.test.ts); the
 * Markdown round trip (AC-03) lives in noteMarkdown.test.ts.
 */
import { describe, it, expect } from 'vitest';
import { Editor } from '@tiptap/core';
import { StarterKit } from '@tiptap/starter-kit';
import { Superscript } from '@tiptap/extension-superscript';
import { Subscript } from '@tiptap/extension-subscript';
import {
    FORMATTING_GROUPS,
    FORMATTING_COMMANDS,
} from '../../../../src/server/spa/client/react/features/notes/editor/toolbar/formattingCommands';

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

describe('superscript / subscript toolbar commands', () => {
    /** Ids of the first group, which is where the inline marks live. */
    const markGroup = () =>
        FORMATTING_GROUPS[0].map((i) => (i.kind === 'command' ? i.command.id : i.slot));

    it('sits directly after strike, in sup-then-sub order', () => {
        const ids = markGroup();
        expect(ids.slice(ids.indexOf('strike'), ids.indexOf('strike') + 3))
            .toEqual(['strike', 'superscript', 'subscript']);
    });

    it('drives the pressed state off the mark names', () => {
        for (const id of ['superscript', 'subscript']) {
            const command = FORMATTING_COMMANDS.find((c) => c.id === id);
            expect(command, id).toBeDefined();
            expect(command!.activeName).toBe(id);
        }
    });

    it('labels the buttons with the x² / x₂ glyphs', () => {
        const byId = (id: string) => FORMATTING_COMMANDS.find((c) => c.id === id)!;
        expect(byId('superscript').label).toBe('Superscript');
        expect(byId('superscript').icon).toBe('x²');
        expect(byId('subscript').label).toBe('Subscript');
        expect(byId('subscript').icon).toBe('x₂');
    });

    it('toggles the real marks through the descriptor `run`', () => {
        const editor = makeEditor('<p>x2</p>');
        editor.commands.setTextSelection({ from: 2, to: 3 });
        FORMATTING_COMMANDS.find((c) => c.id === 'superscript')!.run(editor as never);
        expect(editor.getHTML()).toBe('<p>x<sup>2</sup></p>');
        FORMATTING_COMMANDS.find((c) => c.id === 'subscript')!.run(editor as never);
        expect(editor.getHTML()).toBe('<p>x<sub>2</sub></p>');
        editor.destroy();
    });
});
