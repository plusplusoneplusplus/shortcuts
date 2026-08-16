import { describe, it, expect } from 'vitest';
import {
    markdownToHtml,
    htmlToMarkdown,
} from '../../../../src/server/spa/client/react/features/notes/editor/noteMarkdown';
import {
    DEFAULT_HIGHLIGHT_COLOR,
    HIGHLIGHT_COLORS,
    normalizeCssColor,
    readStyleProp,
} from '../../../../src/server/spa/client/react/features/notes/editor/colorPalette';

/** md → html → md, the exact path a save/reload cycle takes. */
function roundTrip(md: string): string {
    return htmlToMarkdown(markdownToHtml(md)).trim();
}

const RED = '#e11d48';
const GREEN = HIGHLIGHT_COLORS[1].color; // #b9f5d0

describe('colorPalette', () => {
    describe('normalizeCssColor', () => {
        it('passes a canonical 6-digit hex through', () => {
            expect(normalizeCssColor('#e11d48')).toBe('#e11d48');
        });

        it('lowercases hex', () => {
            expect(normalizeCssColor('#E11D48')).toBe('#e11d48');
        });

        it('expands 3-digit shorthand hex', () => {
            expect(normalizeCssColor('#abc')).toBe('#aabbcc');
        });

        it('converts the rgb() form the browser normalizes styles to', () => {
            // Tiptap re-reads `element.style.color`, which a real browser reports
            // as rgb(); without this the round trip would churn every save.
            expect(normalizeCssColor('rgb(225, 29, 72)')).toBe('#e11d48');
        });

        it('converts rgba() by dropping the alpha channel', () => {
            expect(normalizeCssColor('rgba(225, 29, 72, 0.5)')).toBe('#e11d48');
        });

        it('rejects forms that are not persisted', () => {
            for (const value of ['red', 'hsl(0, 100%, 50%)', 'var(--x)', 'transparent', '', null, undefined]) {
                expect(normalizeCssColor(value)).toBeNull();
            }
        });
    });

    describe('readStyleProp', () => {
        it('reads a declaration', () => {
            expect(readStyleProp('color: #e11d48', 'color')).toBe('#e11d48');
        });

        it('does not match the tail of background-color when asked for color', () => {
            expect(readStyleProp('background-color: #b9f5d0', 'color')).toBeNull();
            expect(readStyleProp('background-color: #b9f5d0', 'background-color')).toBe('#b9f5d0');
        });

        it('picks the right declaration out of a multi-declaration style', () => {
            expect(readStyleProp('font-weight: bold; color: #e11d48; margin: 0', 'color')).toBe('#e11d48');
        });
    });
});

describe('noteMarkdown — text color (AC-01)', () => {
    describe('markdownToHtml', () => {
        it('parses a colored span back into a colored span', () => {
            expect(markdownToHtml(`<span style="color:${RED}">hi</span>`)).toContain(
                `<span style="color:${RED}">hi</span>`,
            );
        });

        it('normalizes the color spelling on the way in', () => {
            expect(markdownToHtml('<span style="color: #E11D48">hi</span>')).toContain(
                `<span style="color:${RED}">hi</span>`,
            );
        });

        it('keeps a colored span inline within a sentence', () => {
            const html = markdownToHtml(`plain **b** <span style="color:${RED}">red</span> tail`);
            expect(html).toContain('<strong>b</strong>');
            expect(html).toContain(`<span style="color:${RED}">red</span>`);
        });

        it('strips styles other than color from a span', () => {
            const html = markdownToHtml('<span style="letter-spacing:2px;position:fixed">x</span>');
            expect(html).toContain('<span>x</span>');
            expect(html).not.toContain('letter-spacing');
            expect(html).not.toContain('position');
        });

        it('keeps only the color declaration when a span carries several', () => {
            const html = markdownToHtml(`<span style="letter-spacing:2px;color:${RED}">x</span>`);
            expect(html).toContain(`<span style="color:${RED}">x</span>`);
            expect(html).not.toContain('letter-spacing');
        });

        it('ignores a color form that is not persisted', () => {
            const html = markdownToHtml('<span style="color:red">x</span>');
            expect(html).toContain('<span>x</span>');
        });

        it('leaves a span with no style attribute untouched', () => {
            expect(markdownToHtml('<span class="x">hi</span>')).toContain('<span class="x">hi</span>');
        });
    });

    describe('htmlToMarkdown', () => {
        it('serializes a colored span as inline HTML', () => {
            expect(htmlToMarkdown(`<p><span style="color: ${RED}">hi</span></p>`).trim()).toBe(
                `<span style="color:${RED}">hi</span>`,
            );
        });

        it('serializes the browser-normalized rgb() form as hex', () => {
            expect(htmlToMarkdown('<p><span style="color: rgb(225, 29, 72)">hi</span></p>').trim()).toBe(
                `<span style="color:${RED}">hi</span>`,
            );
        });

        it('emits no span for uncolored text', () => {
            const md = htmlToMarkdown('<p>plain <strong>bold</strong> text</p>');
            expect(md.trim()).toBe('plain **bold** text');
            expect(md).not.toContain('<span');
        });

        it('unwraps a span whose style carried no persisted color', () => {
            expect(htmlToMarkdown('<p><span style="letter-spacing: 2px">hi</span></p>').trim()).toBe('hi');
        });

        it('drops an empty colored span rather than emitting a bare wrapper', () => {
            expect(htmlToMarkdown(`<p><span style="color: ${RED}"></span></p>`).trim()).toBe('');
        });

        it('does not disturb the note-link span rule', () => {
            expect(
                htmlToMarkdown('<p><span class="note-link" data-note-path="a/b.md">b</span></p>').trim(),
            ).toBe('[[note:a/b.md]]');
        });
    });

    describe('round trip', () => {
        it('is idempotent for a colored word', () => {
            const md = `<span style="color:${RED}">hi</span>`;
            expect(roundTrip(md)).toBe(md);
            expect(roundTrip(roundTrip(md))).toBe(md);
        });

        it('nests inside bold', () => {
            const md = `**<span style="color:${RED}">red bold</span>**`;
            expect(roundTrip(md)).toBe(md);
        });

        it('wraps bold', () => {
            const md = `<span style="color:${RED}">**red bold**</span>`;
            expect(roundTrip(md)).toBe(md);
        });

        it('nests inside italic', () => {
            const md = `_<span style="color:${RED}">red italic</span>_`;
            expect(roundTrip(md)).toBe(md);
        });

        it('nests inside a link', () => {
            const md = `[<span style="color:${RED}">label</span>](https://example.com)`;
            expect(roundTrip(md)).toBe(md);
        });

        it('survives alongside plain text in a sentence', () => {
            const md = `before <span style="color:${RED}">red</span> after`;
            expect(roundTrip(md)).toBe(md);
        });
    });
});

describe('noteMarkdown — highlight color persistence (AC-02)', () => {
    it('keeps a bare highlight as ==text==', () => {
        expect(roundTrip('==hi==')).toBe('==hi==');
    });

    it('parses a bare ==text== to a default-colored highlight', () => {
        // No migration: an existing note stays exactly as it was, and the editor
        // paints it the default yellow.
        const html = markdownToHtml('==hi==');
        expect(html).toContain('<mark>hi</mark>');
        expect(html).not.toContain('background-color');
    });

    it('serializes a default-colored mark as bare ==text==', () => {
        expect(
            htmlToMarkdown(
                `<p><mark data-color="${DEFAULT_HIGHLIGHT_COLOR}" style="background-color: ${DEFAULT_HIGHLIGHT_COLOR}">hi</mark></p>`,
            ).trim(),
        ).toBe('==hi==');
    });

    it('serializes a non-default color as inline HTML', () => {
        expect(
            htmlToMarkdown(`<p><mark data-color="${GREEN}" style="background-color: ${GREEN}">hi</mark></p>`).trim(),
        ).toBe(`<mark style="background-color:${GREEN}">hi</mark>`);
    });

    it('recovers the color from data-color when the style attribute is absent', () => {
        expect(htmlToMarkdown(`<p><mark data-color="${GREEN}">hi</mark></p>`).trim()).toBe(
            `<mark style="background-color:${GREEN}">hi</mark>`,
        );
    });

    it('round-trips a colored highlight idempotently', () => {
        const md = `<mark style="background-color:${GREEN}">hi</mark>`;
        expect(roundTrip(md)).toBe(md);
        expect(roundTrip(roundTrip(md))).toBe(md);
    });

    it('normalizes the browser rgb() form of a highlight color', () => {
        expect(htmlToMarkdown('<p><mark style="background-color: rgb(185, 245, 208)">hi</mark></p>').trim()).toBe(
            `<mark style="background-color:${GREEN}">hi</mark>`,
        );
    });

    it('strips a non-background-color style from a mark on parse', () => {
        const html = markdownToHtml('<mark style="color:#000;background-color:#b9f5d0">hi</mark>');
        expect(html).toContain(`<mark style="background-color:${GREEN}">hi</mark>`);
        expect(html).not.toContain('color:#000');
    });
});

describe('noteMarkdown — text and highlight color together (AC-03 plumbing)', () => {
    it('round-trips a text color nested inside a colored highlight', () => {
        const md = `<mark style="background-color:${GREEN}"><span style="color:${RED}">both</span></mark>`;
        expect(roundTrip(md)).toBe(md);
    });

    it('round-trips a colored highlight nested inside a text color', () => {
        const md = `<span style="color:${RED}"><mark style="background-color:${GREEN}">both</mark></span>`;
        expect(roundTrip(md)).toBe(md);
    });

    it('round-trips a text color on a default-colored highlight', () => {
        const md = `==<span style="color:${RED}">both</span>==`;
        expect(roundTrip(md)).toBe(md);
    });
});
