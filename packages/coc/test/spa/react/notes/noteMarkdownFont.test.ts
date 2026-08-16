/**
 * AC-02, markdown half: a font-family span written by the editor must survive
 * the save/reload cycle — editor HTML → Markdown → HTML → editor HTML — without
 * the new turndown rule fighting the color, note-link or comment span rules.
 *
 * The real-editor half is covered by noteFontMark.test.ts.
 */
import { describe, it, expect } from 'vitest';
import {
    markdownToHtml,
    htmlToMarkdown,
} from '../../../../src/server/spa/client/react/features/notes/editor/noteMarkdown';
import {
    FONT_FAMILY_OPTIONS,
    normalizeFontStack,
    readInlineFontFamily,
} from '../../../../src/server/spa/client/react/features/notes/editor/fontFamilies';

/** md → html → md, the exact path a save/reload cycle takes. */
function roundTrip(md: string): string {
    return htmlToMarkdown(markdownToHtml(md)).trim();
}

const RED = '#e11d48';
/** Canonical persisted spelling of the Mono stack: `'JetBrains Mono', Consolas, …`. */
const MONO = normalizeFontStack(FONT_FAMILY_OPTIONS.find((o) => o.id === 'mono')!.stack)!;
const SERIF = normalizeFontStack(FONT_FAMILY_OPTIONS.find((o) => o.id === 'serif')!.stack)!;

describe('readInlineFontFamily', () => {
    it('reads and canonicalizes a font-family declaration', () => {
        expect(readInlineFontFamily('font-family: "JetBrains Mono", Consolas')).toBe("'JetBrains Mono', Consolas");
    });

    it('picks font-family out of a multi-declaration style', () => {
        expect(readInlineFontFamily(`color: ${RED}; font-family: Georgia, serif`)).toBe('Georgia, serif');
    });

    it('returns null when there is no font-family', () => {
        expect(readInlineFontFamily(`color: ${RED}`)).toBeNull();
        expect(readInlineFontFamily('')).toBeNull();
        expect(readInlineFontFamily(null)).toBeNull();
    });

    it('rejects a stack carrying anything unpersistable', () => {
        expect(readInlineFontFamily('font-family: url(evil.woff)')).toBeNull();
    });
});

describe('noteMarkdown — font family (AC-02)', () => {
    describe('markdownToHtml', () => {
        it('passes a font-family span through to Tiptap', () => {
            expect(markdownToHtml(`<span style="font-family:${MONO}">hi</span>`)).toContain(
                `<span style="font-family:${MONO}">hi</span>`,
            );
        });

        it('normalizes the quoting on the way in', () => {
            // A hand-written stack may use double quotes; the persisted form is
            // single-quoted so it can sit inside a double-quoted attribute.
            expect(markdownToHtml('<span style=\'font-family: "Segoe UI" , Roboto\'>hi</span>')).toContain(
                `<span style="font-family:'Segoe UI', Roboto">hi</span>`,
            );
        });

        it('keeps color and font-family together on one span', () => {
            expect(markdownToHtml(`<span style="color:${RED}; font-family:${SERIF}">hi</span>`)).toContain(
                `<span style="color:${RED}; font-family:${SERIF}">hi</span>`,
            );
        });

        it('still strips styles that are none of the persisted declarations', () => {
            const html = markdownToHtml(`<span style="letter-spacing:2px;font-family:${SERIF}">x</span>`);
            expect(html).toContain(`<span style="font-family:${SERIF}">x</span>`);
            expect(html).not.toContain('letter-spacing');
        });

        it('drops a font-family value that is not persistable', () => {
            const html = markdownToHtml('<span style="font-family:expression(alert(1))">x</span>');
            expect(html).toContain('<span>x</span>');
            expect(html).not.toContain('font-family');
        });

        it('does not put a font-family on a mark', () => {
            const html = markdownToHtml(`<mark style="background-color:#b9f5d0;font-family:${SERIF}">hi</mark>`);
            expect(html).toContain('<mark style="background-color:#b9f5d0">hi</mark>');
            expect(html).not.toContain('font-family');
        });
    });

    describe('htmlToMarkdown', () => {
        it('serializes a font-family span as inline HTML', () => {
            expect(htmlToMarkdown(`<p><span style="font-family: ${MONO}">hi</span></p>`).trim()).toBe(
                `<span style="font-family:${MONO}">hi</span>`,
            );
        });

        it('emits color before font-family when a span carries both', () => {
            expect(
                htmlToMarkdown(`<p><span style="font-family: ${MONO}; color: ${RED}">hi</span></p>`).trim(),
            ).toBe(`<span style="color:${RED}; font-family:${MONO}">hi</span>`);
        });

        it('drops an empty font-family span rather than emitting a bare wrapper', () => {
            expect(htmlToMarkdown(`<p><span style="font-family: ${MONO}"></span></p>`).trim()).toBe('');
        });

        it('unwraps a span whose style carried no persisted declaration', () => {
            expect(htmlToMarkdown('<p><span style="letter-spacing: 2px">hi</span></p>').trim()).toBe('hi');
        });

        it('leaves the note-link span rule alone', () => {
            expect(
                htmlToMarkdown('<p><span class="note-link" data-note-path="a/b.md">b</span></p>').trim(),
            ).toBe('[[note:a/b.md]]');
        });
    });

    describe('round trip', () => {
        it('is idempotent for every option in the font list', () => {
            for (const option of FONT_FAMILY_OPTIONS) {
                if (!option.stack) continue; // "Default" unsets the mark, it persists nothing.
                const md = `<span style="font-family:${normalizeFontStack(option.stack)}">hi</span>`;
                expect(roundTrip(md)).toBe(md);
                expect(roundTrip(roundTrip(md))).toBe(md);
            }
        });

        it('nests inside bold', () => {
            const md = `**<span style="font-family:${MONO}">bold mono</span>**`;
            expect(roundTrip(md)).toBe(md);
        });

        it('wraps bold', () => {
            const md = `<span style="font-family:${MONO}">**bold mono**</span>`;
            expect(roundTrip(md)).toBe(md);
        });

        it('nests inside italic and inside a link', () => {
            expect(roundTrip(`_<span style="font-family:${SERIF}">serif</span>_`)).toBe(
                `_<span style="font-family:${SERIF}">serif</span>_`,
            );
            expect(roundTrip(`[<span style="font-family:${SERIF}">label</span>](https://example.com)`)).toBe(
                `[<span style="font-family:${SERIF}">label</span>](https://example.com)`,
            );
        });

        it('carries color and font on one span', () => {
            const md = `<span style="color:${RED}; font-family:${MONO}">both</span>`;
            expect(roundTrip(md)).toBe(md);
            expect(roundTrip(roundTrip(md))).toBe(md);
        });

        it('survives inside a highlight', () => {
            const md = `==<span style="font-family:${MONO}">mono</span>==`;
            expect(roundTrip(md)).toBe(md);
        });

        it('survives alongside plain text in a sentence', () => {
            const md = `before <span style="font-family:${MONO}">mono</span> after`;
            expect(roundTrip(md)).toBe(md);
        });
    });
});
