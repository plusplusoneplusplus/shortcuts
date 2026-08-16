/**
 * AC-03: a font-size span written by the editor must survive the save/reload
 * cycle — editor HTML → Markdown → HTML → editor HTML — without the shared
 * `textStyle` span rule fighting the color, font-family, note-link or comment
 * span rules, and without changing what a note free of font-size spans
 * serializes to.
 *
 * The picker list and the real-editor mark are covered by noteFontSize.test.ts.
 */
import { describe, it, expect } from 'vitest';
import {
    markdownToHtml,
    htmlToMarkdown,
} from '../../../../src/server/spa/client/react/features/notes/editor/noteMarkdown';
import {
    markdownToRichEditorHtml,
    richEditorHtmlToMarkdown,
} from '../../../../src/server/spa/client/react/shared/markdown-document/markdownRichConversion';
import {
    FONT_SIZE_OPTIONS,
} from '../../../../src/server/spa/client/react/features/notes/editor/fontSizes';
import {
    FONT_FAMILY_OPTIONS,
    normalizeFontStack,
} from '../../../../src/server/spa/client/react/features/notes/editor/fontFamilies';

/** md → html → md, the exact path a save/reload cycle takes. */
function roundTrip(md: string): string {
    return htmlToMarkdown(markdownToHtml(md)).trim();
}

const RED = '#e11d48';
const MONO = normalizeFontStack(FONT_FAMILY_OPTIONS.find((o) => o.id === 'mono')!.stack)!;

/**
 * The pair of helpers the editor actually calls on load and save. The IO stub
 * only has to resolve image `src`, which none of these fixtures carry.
 */
const io = {
    buildFileUrl: (workspaceId: string, path: string) => `/api/files/${workspaceId}/${path}`,
} as never;

function editorRoundTrip(md: string): string {
    const { html, frontMatter } = markdownToRichEditorHtml({ markdown: md, io, workspaceId: 'ws' });
    return richEditorHtmlToMarkdown({ html, frontMatter }).trim();
}

describe('noteMarkdown — font size (AC-03)', () => {
    describe('markdownToHtml', () => {
        it('passes a font-size span through to Tiptap', () => {
            expect(markdownToHtml('<span style="font-size:24px">hi</span>')).toContain(
                '<span style="font-size:24px">hi</span>',
            );
        });

        it('canonicalizes the spelling on the way in', () => {
            expect(markdownToHtml('<span style="font-size: 24.0 px">hi</span>')).toContain(
                '<span style="font-size:24px">hi</span>',
            );
        });

        it('keeps color, font-family and font-size together on one span', () => {
            const style = `color:${RED}; font-family:${MONO}; font-size:18px`;
            expect(markdownToHtml(`<span style="${style}">hi</span>`)).toContain(
                `<span style="${style}">hi</span>`,
            );
        });

        it('drops a size in a unit that is not persisted', () => {
            const html = markdownToHtml('<span style="font-size:2em">x</span>');
            expect(html).toContain('<span>x</span>');
            expect(html).not.toContain('font-size');
        });

        it('drops a size outside the persisted range', () => {
            expect(markdownToHtml('<span style="font-size:0px">x</span>')).not.toContain('font-size');
            expect(markdownToHtml('<span style="font-size:9999px">x</span>')).not.toContain('font-size');
        });

        it('does not confuse background-size for font-size', () => {
            const html = markdownToHtml('<span style="background-size:24px">x</span>');
            expect(html).toContain('<span>x</span>');
            expect(html).not.toContain('size');
        });

        it('does not put a font-size on a mark', () => {
            const html = markdownToHtml('<mark style="background-color:#b9f5d0;font-size:24px">hi</mark>');
            expect(html).toContain('<mark style="background-color:#b9f5d0">hi</mark>');
            expect(html).not.toContain('font-size');
        });
    });

    describe('htmlToMarkdown', () => {
        it('serializes a font-size span as inline HTML', () => {
            expect(htmlToMarkdown('<p><span style="font-size: 24px">hi</span></p>').trim()).toBe(
                '<span style="font-size:24px">hi</span>',
            );
        });

        it('emits color, then font-family, then font-size', () => {
            expect(
                htmlToMarkdown(
                    `<p><span style="font-size: 18px; font-family: ${MONO}; color: ${RED}">hi</span></p>`,
                ).trim(),
            ).toBe(`<span style="color:${RED}; font-family:${MONO}; font-size:18px">hi</span>`);
        });

        it('drops an empty font-size span rather than emitting a bare wrapper', () => {
            expect(htmlToMarkdown('<p><span style="font-size: 24px"></span></p>').trim()).toBe('');
        });

        it('unwraps a span whose size is not persistable', () => {
            expect(htmlToMarkdown('<p><span style="font-size: 2em">hi</span></p>').trim()).toBe('hi');
        });

        it('leaves the note-link span rule alone', () => {
            expect(
                htmlToMarkdown('<p><span class="note-link" data-note-path="a/b.md">b</span></p>').trim(),
            ).toBe('[[note:a/b.md]]');
        });
    });

    describe('round trip', () => {
        it('is idempotent for every size in the picker list', () => {
            for (const option of FONT_SIZE_OPTIONS) {
                if (!option.size) continue; // "Default" unsets the mark, it persists nothing.
                const md = `<span style="font-size:${option.size}">hi</span>`;
                expect(roundTrip(md)).toBe(md);
                expect(roundTrip(roundTrip(md))).toBe(md);
            }
        });

        it('nests inside bold and wraps bold', () => {
            expect(roundTrip('**<span style="font-size:30px">big bold</span>**')).toBe(
                '**<span style="font-size:30px">big bold</span>**',
            );
            expect(roundTrip('<span style="font-size:30px">**big bold**</span>')).toBe(
                '<span style="font-size:30px">**big bold**</span>',
            );
        });

        it('nests inside italic and inside a link', () => {
            expect(roundTrip('_<span style="font-size:12px">small</span>_')).toBe(
                '_<span style="font-size:12px">small</span>_',
            );
            expect(
                roundTrip('[<span style="font-size:12px">label</span>](https://example.com)'),
            ).toBe('[<span style="font-size:12px">label</span>](https://example.com)');
        });

        it('carries color, family and size on one span', () => {
            const md = `<span style="color:${RED}; font-family:${MONO}; font-size:16px">all three</span>`;
            expect(roundTrip(md)).toBe(md);
            expect(roundTrip(roundTrip(md))).toBe(md);
        });

        it('survives inside a highlight, a heading and a list item', () => {
            const inMark = '==<span style="font-size:24px">big</span>==';
            expect(roundTrip(inMark)).toBe(inMark);
            // A size is a mark, so the heading stays a heading.
            const inHeading = '## <span style="font-size:36px">Title</span>';
            expect(roundTrip(inHeading)).toBe(inHeading);
            const inList = '-   <span style="font-size:14px">item</span>';
            expect(roundTrip(inList)).toBe(inList);
        });

        it('survives alongside plain text in a sentence', () => {
            const md = 'before <span style="font-size:48px">big</span> after';
            expect(roundTrip(md)).toBe(md);
        });

        it('goes through the editor load/save helpers unchanged', () => {
            const md = `<span style="color:${RED}; font-size:24px">styled</span>`;
            expect(editorRoundTrip(md)).toBe(md);
            expect(editorRoundTrip(editorRoundTrip(md))).toBe(md);
        });
    });

    describe('no collateral change', () => {
        // AC-03.3: a note carrying no font-size span must serialize exactly as
        // it did before the rule existed.
        const PLAIN = [
            '# Heading',
            '',
            'Plain paragraph with **bold**, _italic_, `code` and a [link](https://example.com).',
            '',
            '-   one',
            '-   two',
            '',
            '> quote',
            '',
            // Written as the canonical grammar name: the fence-alias rewrite is
            // pre-existing behavior and would otherwise mask the real assertion.
            '```typescript',
            'const a = 1;',
            '```',
            '',
            '| a | b |',
            '| --- | --- |',
            '| 1 | 2 |',
            '',
            `Colored <span style="color:${RED}">text</span> and ==highlight==.`,
        ].join('\n');

        it('leaves a note without font-size spans byte-identical', () => {
            expect(roundTrip(PLAIN)).toBe(PLAIN);
            expect(roundTrip(roundTrip(PLAIN))).toBe(PLAIN);
        });
    });
});
