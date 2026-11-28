import { describe, expect, it } from 'vitest';
import { createMarkdownCodec } from '@plusplusoneplusplus/tiptap-kit/markdown';
import { mapMarkdownExtension, pdfMarkdownExtension } from '../src/markdown/index.js';

const MAP_URL = 'https://www.google.com/maps/embed?pb=!1m18';
const { markdownToHtml, htmlToMarkdown } = createMarkdownCodec({
    extensions: [mapMarkdownExtension, pdfMarkdownExtension],
});

describe('mapMarkdownExtension', () => {
    it('turns a Google Maps embed link into a MapBlock placeholder and back', () => {
        const html = markdownToHtml(`[Office](${MAP_URL})`);
        expect(html).toContain(`<div class="md-map-embed" data-map-url="${MAP_URL}" data-map-label="Office"></div>`);
        expect(htmlToMarkdown(html)).toBe(`[Office](${MAP_URL})\n`);
    });

    it('leaves other links alone', () => {
        expect(markdownToHtml('[docs](https://example.com)')).toContain('<a href="https://example.com">docs</a>');
    });

    it('keeps an indented map as a raw placeholder', () => {
        const md = htmlToMarkdown(`<div class="md-map-embed" data-map-url="${MAP_URL}" data-map-label="Office" data-indent="2"></div>`);
        expect(md).toContain('data-indent="2"');
        expect(markdownToHtml(md)).toContain('data-indent="2"');
    });
});

describe('pdfMarkdownExtension', () => {
    it('turns a .pdf image into a PdfBlock placeholder with a literal label and back', () => {
        const html = markdownToHtml('![a\\_b.pdf](files/a_b.pdf)');
        expect(html).toContain('<div class="md-pdf-embed" data-pdf-url="files/a_b.pdf" data-pdf-label="a_b.pdf"></div>');
        expect(htmlToMarkdown(html)).toBe('![a\\_b.pdf](files/a_b.pdf)\n');
    });

    it('keeps normal images as images', () => {
        expect(markdownToHtml('![x](a.png)')).toContain('<img src="a.png" alt="x"');
    });

    it('keeps height, indent and collapsed state as a raw placeholder', () => {
        const md = htmlToMarkdown(
            '<div class="md-pdf-embed" data-pdf-url="a.pdf" data-pdf-label="A" data-indent="1" data-pdf-height="5000" data-pdf-collapsed="true"></div>',
        );
        expect(md).toBe(
            '<div class="md-pdf-embed" data-pdf-url="a.pdf" data-pdf-label="A" data-indent="1" data-pdf-height="1200" data-pdf-collapsed="true"></div>\n',
        );
    });
});
