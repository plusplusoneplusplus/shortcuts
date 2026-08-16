/**
 * AC-01: the font-size list and its normalizer, plus proof that the `fontSize`
 * attribute really exists on the `textStyle` mark in a Tiptap editor built from
 * RichEditorCore's extension subset.
 *
 * The toolbar half lives in NoteEditorToolbar.test.tsx; the Markdown round trip
 * (AC-03) lives in noteMarkdownFontSize.test.ts.
 */
import { describe, it, expect } from 'vitest';
import { Editor } from '@tiptap/core';
import { StarterKit } from '@tiptap/starter-kit';
import { TextStyle, Color, FontFamily, FontSize } from '@tiptap/extension-text-style';
import {
    FONT_SIZE_OPTIONS,
    findSizeOption,
    normalizeFontSize,
    readInlineFontSize,
} from '../../../../src/server/spa/client/react/features/notes/editor/fontSizes';
import { activeFontSize } from '../../../../src/server/spa/client/react/features/notes/editor/toolbar/FontSizeDropdown';

describe('FONT_SIZE_OPTIONS', () => {
    it('is exactly the fourteen agreed entries, in order', () => {
        expect(FONT_SIZE_OPTIONS.map((o) => o.label)).toEqual([
            'Default',
            '8',
            '9',
            '10',
            '11',
            '12',
            '14',
            '16',
            '18',
            '24',
            '30',
            '36',
            '48',
            '60',
        ]);
    });

    it('leaves Default with no size — it unsets the mark rather than setting one', () => {
        expect(FONT_SIZE_OPTIONS[0].size).toBe('');
    });

    it('every preset is a px length', () => {
        for (const { size } of FONT_SIZE_OPTIONS.slice(1)) {
            expect(size).toMatch(/^\d+px$/);
        }
    });

    it('gives every row a distinct id and test id', () => {
        expect(new Set(FONT_SIZE_OPTIONS.map((o) => o.id)).size).toBe(FONT_SIZE_OPTIONS.length);
        expect(new Set(FONT_SIZE_OPTIONS.map((o) => o.testId)).size).toBe(FONT_SIZE_OPTIONS.length);
    });
});

describe('normalizeFontSize', () => {
    it('canonicalizes the spellings a browser hands back', () => {
        for (const raw of ['24px', '24 px', '24.0px', ' 24PX ', '24']) {
            expect(normalizeFontSize(raw)).toBe('24px');
        }
    });

    it('is idempotent — a second save produces the same string', () => {
        const once = normalizeFontSize('24 px')!;
        expect(normalizeFontSize(once)).toBe(once);
    });

    it('keeps a genuine fractional size', () => {
        expect(normalizeFontSize('13.5px')).toBe('13.5px');
    });

    it('rejects units other than px, which are not persisted', () => {
        for (const raw of ['1.2em', '2rem', '12pt', '150%', 'larger', 'inherit']) {
            expect(normalizeFontSize(raw)).toBeNull();
        }
    });

    it('rejects values that are not a plain length', () => {
        for (const raw of ['', '   ', null, undefined, 'url(evil.css)', 'expression(alert(1))', '24px; position: fixed', 'var(--x)', '-12px']) {
            expect(normalizeFontSize(raw)).toBeNull();
        }
    });

    it('rejects sizes outside the persisted range', () => {
        expect(normalizeFontSize('0px')).toBeNull();
        expect(normalizeFontSize('0.5px')).toBeNull();
        expect(normalizeFontSize('1000px')).toBeNull();
        expect(normalizeFontSize('400px')).toBe('400px');
    });
});

describe('readInlineFontSize', () => {
    it('reads the declaration out of a style attribute', () => {
        expect(readInlineFontSize('font-size: 24px')).toBe('24px');
        expect(readInlineFontSize('color:#e11d48; font-size:18px')).toBe('18px');
    });

    it('is not fooled by a font-family declaration sharing the prefix', () => {
        expect(readInlineFontSize("font-family: 'SF Mono', monospace")).toBeNull();
        // `-size` must not match as the tail of another property name either.
        expect(readInlineFontSize('background-size: 24px')).toBeNull();
    });

    it('returns null for an absent or unpersistable size', () => {
        expect(readInlineFontSize(null)).toBeNull();
        expect(readInlineFontSize('')).toBeNull();
        expect(readInlineFontSize('color:#fff')).toBeNull();
        expect(readInlineFontSize('font-size: 2em')).toBeNull();
    });
});

describe('findSizeOption', () => {
    it('matches a preset regardless of the spelling it arrives in', () => {
        expect(findSizeOption('24px')?.label).toBe('24');
        expect(findSizeOption('24 PX')?.label).toBe('24');
        expect(findSizeOption(24)?.label).toBe('24');
    });

    it('returns null for unset, off-ladder and unparsable values', () => {
        expect(findSizeOption(null)).toBeNull();
        expect(findSizeOption('')).toBeNull();
        expect(findSizeOption('13px')).toBeNull();
        expect(findSizeOption('2em')).toBeNull();
    });

    it('never matches the Default row, which carries no size', () => {
        expect(findSizeOption(FONT_SIZE_OPTIONS[0].size)).toBeNull();
        for (const option of FONT_SIZE_OPTIONS.slice(1)) {
            expect(findSizeOption(option.size)?.id).toBe(option.id);
        }
    });
});

/** The extension subset RichEditorCore registers for text-style work. */
function createEditor(content = '<p>hello world</p>') {
    return new Editor({
        extensions: [
            StarterKit.configure({ heading: { levels: [1, 2, 3] }, link: false }),
            TextStyle,
            Color,
            FontFamily,
            FontSize,
        ],
        content,
    });
}

/** Select "hello" (positions 1-6 in a single leading paragraph). */
function selectHello(editor: Editor) {
    editor.commands.setTextSelection({ from: 1, to: 6 });
}

describe('font size mark in a real editor', () => {
    it('exposes setFontSize/unsetFontSize on the chain', () => {
        const editor = createEditor();
        const chain = editor.chain();
        expect(typeof chain.setFontSize).toBe('function');
        expect(typeof chain.unsetFontSize).toBe('function');
        editor.destroy();
    });

    it('setFontSize wraps the selection in a styled span', () => {
        const editor = createEditor();
        selectHello(editor);
        editor.chain().focus().setFontSize('24px').run();
        expect(editor.getHTML()).toContain('font-size');
        expect(findSizeOption(editor.getAttributes('textStyle').fontSize)?.label).toBe('24');
        editor.destroy();
    });

    it('parses a size back off the HTML it serialized', () => {
        const editor = createEditor();
        selectHello(editor);
        editor.chain().focus().setFontSize('24px').run();
        const html = editor.getHTML();

        const reloaded = createEditor(html);
        reloaded.commands.setTextSelection({ from: 1, to: 6 });
        expect(findSizeOption(reloaded.getAttributes('textStyle').fontSize)?.label).toBe('24');
        reloaded.destroy();
        editor.destroy();
    });

    it('applies per selection — the rest of the paragraph keeps no size', () => {
        const editor = createEditor();
        selectHello(editor);
        editor.chain().focus().setFontSize('24px').run();
        editor.commands.setTextSelection({ from: 8, to: 12 });
        expect(editor.getAttributes('textStyle').fontSize).toBeFalsy();
        editor.destroy();
    });

    it('unsetFontSize clears it again', () => {
        const editor = createEditor();
        selectHello(editor);
        editor.chain().focus().setFontSize('24px').run();
        selectHello(editor);
        editor.chain().focus().unsetFontSize().run();
        expect(editor.getAttributes('textStyle').fontSize).toBeFalsy();
        editor.destroy();
    });

    it('sizes a heading without changing the block type', () => {
        const editor = createEditor('<h2>heading text</h2>');
        editor.commands.setTextSelection({ from: 1, to: 8 });
        editor.chain().focus().setFontSize('24px').run();

        expect(editor.getHTML()).toContain('<h2>');
        expect(editor.getHTML()).toContain('font-size');
        expect(editor.isActive('heading', { level: 2 })).toBe(true);
        editor.destroy();
    });

    it('coexists with a text color and a font family on the same run', () => {
        const editor = createEditor();
        selectHello(editor);
        editor.chain().focus().setColor('#e11d48').setFontFamily('Arial, sans-serif').setFontSize('24px').run();
        const attrs = editor.getAttributes('textStyle');
        expect(attrs.color).toBeTruthy();
        expect(attrs.fontFamily).toBeTruthy();
        expect(findSizeOption(attrs.fontSize)?.label).toBe('24');

        // Dropping the size must leave the other two alone.
        selectHello(editor);
        editor.chain().focus().unsetFontSize().run();
        const after = editor.getAttributes('textStyle');
        expect(after.fontSize).toBeFalsy();
        expect(after.color).toBeTruthy();
        expect(after.fontFamily).toBeTruthy();
        editor.destroy();
    });

    it('a collapsed selection stores the mark so typed text picks the size up', () => {
        const editor = createEditor();
        editor.commands.setTextSelection({ from: 6, to: 6 });
        editor.chain().focus().setFontSize('24px').run();
        expect(findSizeOption(editor.getAttributes('textStyle').fontSize)?.label).toBe('24');
        editor.destroy();
    });
});

/**
 * AC-02.3: the trigger reads "Default" for a selection that spans more than one
 * size, not just one with no size at all.
 *
 * These run against a real editor because the bug they pin lives in Tiptap:
 * `getAttributes('textStyle')` reports the *first* mark in the range with no
 * check that the range agrees, so every case below reads a size from it.
 */
describe('activeFontSize across a selection', () => {
    /**
     * `hello world` with a size on `hello`, on ` world`, or on neither.
     *
     * The space goes with the second run so that two equal sizes really do
     * cover the whole selection — an unsized space between them would be a
     * third run, and correctly read as mixed.
     */
    function sizedRuns(hello: string | null, world: string | null) {
        const editor = createEditor();
        if (hello) {
            editor.commands.setTextSelection({ from: 1, to: 6 });
            editor.chain().setFontSize(hello).run();
        }
        if (world) {
            editor.commands.setTextSelection({ from: 6, to: 12 });
            editor.chain().setFontSize(world).run();
        }
        // Select the whole paragraph, both runs.
        editor.commands.setTextSelection({ from: 1, to: 12 });
        return editor;
    }

    it('reads null when a sized run is followed by an unsized one', () => {
        const editor = sizedRuns('24px', null);
        // Tiptap alone would answer 24px here — that is the bug being fixed.
        expect(editor.getAttributes('textStyle').fontSize).toBe('24px');
        expect(activeFontSize(editor)).toBeNull();
        editor.destroy();
    });

    it('reads null when an unsized run is followed by a sized one', () => {
        const editor = sizedRuns(null, '24px');
        expect(activeFontSize(editor)).toBeNull();
        editor.destroy();
    });

    it('reads null when the selection spans two different sizes', () => {
        const editor = sizedRuns('12px', '24px');
        expect(activeFontSize(editor)).toBeNull();
        editor.destroy();
    });

    it('reads the size when every run in the selection carries it', () => {
        const editor = sizedRuns('24px', '24px');
        expect(findSizeOption(activeFontSize(editor))?.label).toBe('24');
        editor.destroy();
    });

    it('reads the size when one run covers the whole selection', () => {
        const editor = createEditor();
        selectHello(editor);
        editor.chain().setFontSize('24px').run();
        selectHello(editor);
        expect(findSizeOption(activeFontSize(editor))?.label).toBe('24');
        editor.destroy();
    });

    it('reads the size for a caret inside a sized run', () => {
        const editor = createEditor();
        selectHello(editor);
        editor.chain().setFontSize('24px').run();
        editor.commands.setTextSelection({ from: 3, to: 3 });
        expect(findSizeOption(activeFontSize(editor))?.label).toBe('24');
        editor.destroy();
    });

    it('reads null for a selection with no size anywhere', () => {
        const editor = createEditor();
        editor.commands.setTextSelection({ from: 1, to: 12 });
        expect(activeFontSize(editor)).toBeNull();
        editor.destroy();
    });

    it('treats spellings that normalize alike as one size, not a mix', () => {
        // A reloaded note can carry `24 px` on one run and `24px` on the next.
        const editor = sizedRuns('24 px', '24.0px');
        expect(findSizeOption(activeFontSize(editor))?.label).toBe('24');
        editor.destroy();
    });

    it('spans paragraphs — a size in one and none in the next reads null', () => {
        const editor = createEditor('<p>hello</p><p>world</p>');
        editor.commands.setTextSelection({ from: 1, to: 6 });
        editor.chain().setFontSize('24px').run();
        editor.commands.setTextSelection({ from: 1, to: 13 });
        expect(activeFontSize(editor)).toBeNull();
        editor.destroy();
    });
});

/**
 * The dropdown reads the selection during render, so it also renders against
 * editors that have no live ProseMirror view: a torn-down one, and the partial
 * doubles the toolbar's own tests mount. Reaching straight into
 * `editor.state.selection` / `editor.state.doc` threw for both and took the
 * whole toolbar down with it, so the probes are pinned here.
 */
describe('activeFontSize without a live editor state', () => {
    /** The reads every toolbar double provides, with `state` left to the caller. */
    function double(state?: unknown) {
        return { state, getAttributes: () => ({}) } as unknown as Editor;
    }

    it('reads null when the editor has no state at all', () => {
        expect(activeFontSize(double())).toBeNull();
    });

    it('falls back to the stored marks when a range selection has no doc to walk', () => {
        const editor = {
            state: { selection: { from: 1, to: 5, empty: false } },
            getAttributes: () => ({ fontSize: '24px' }),
        } as unknown as Editor;
        expect(activeFontSize(editor)).toBe('24px');
    });

    it('reads null for a range selection whose doc cannot be walked', () => {
        expect(activeFontSize(double({ selection: { from: 1, to: 5, empty: false }, doc: {} }))).toBeNull();
    });

    it('reads null for a caret on an editor with no doc', () => {
        expect(activeFontSize(double({ selection: { from: 1, to: 1, empty: true } }))).toBeNull();
    });
});
