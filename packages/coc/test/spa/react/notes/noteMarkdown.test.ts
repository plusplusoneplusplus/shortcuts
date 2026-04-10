import { describe, it, expect } from 'vitest';
import { markdownToHtml, htmlToMarkdown } from '../../../../src/server/spa/client/react/repos/notes/noteMarkdown';

/** Normalize whitespace for comparison: trim + collapse internal whitespace runs. */
function norm(s: string): string {
    return s.replace(/\r\n/g, '\n').trim();
}

describe('noteMarkdown', () => {
    // ── markdownToHtml ──────────────────────────────────────────────────

    describe('markdownToHtml', () => {
        it('returns empty string for empty input', () => {
            expect(markdownToHtml('')).toBe('');
        });

        it('converts headings', () => {
            const html = markdownToHtml('# Heading 1');
            expect(html).toContain('<h1');
            expect(html).toContain('Heading 1');
        });

        it('converts bold and italic', () => {
            const html = markdownToHtml('**bold** and *italic*');
            expect(html).toContain('<strong>bold</strong>');
            expect(html).toContain('<em>italic</em>');
        });

        it('converts bullet lists', () => {
            const html = markdownToHtml('- item one\n- item two');
            expect(html).toContain('<ul>');
            expect(html).toContain('<li>');
            expect(html).toContain('item one');
        });

        it('converts ordered lists', () => {
            const html = markdownToHtml('1. first\n2. second');
            expect(html).toContain('<ol>');
            expect(html).toContain('first');
        });

        it('converts task lists to Tiptap attributes', () => {
            const html = markdownToHtml('- [x] done\n- [ ] todo');
            expect(html).toContain('data-type="taskList"');
            expect(html).toContain('data-type="taskItem"');
            expect(html).toContain('data-checked="true"');
            expect(html).toContain('data-checked="false"');
        });

        it('converts blockquotes', () => {
            const html = markdownToHtml('> quoted text');
            expect(html).toContain('<blockquote>');
            expect(html).toContain('quoted text');
        });

        it('converts inline code', () => {
            const html = markdownToHtml('use `const x`');
            expect(html).toContain('<code>const x</code>');
        });

        it('converts fenced code blocks', () => {
            const html = markdownToHtml('```js\nconst x = 1;\n```');
            expect(html).toContain('<pre>');
            expect(html).toContain('<code');
            expect(html).toContain('const x = 1;');
        });

        it('converts links', () => {
            const html = markdownToHtml('[text](https://example.com)');
            expect(html).toContain('<a');
            expect(html).toContain('href="https://example.com"');
            expect(html).toContain('text');
        });

        it('converts horizontal rules', () => {
            const html = markdownToHtml('---');
            expect(html).toContain('<hr');
        });

        it('converts strikethrough', () => {
            const html = markdownToHtml('~~strike~~');
            expect(html).toContain('<del>strike</del>');
        });

        it('converts ==highlight== to <mark>', () => {
            const html = markdownToHtml('==highlighted text==');
            expect(html).toContain('<mark>');
            expect(html).toContain('highlighted text');
            expect(html).toContain('</mark>');
        });

        it('converts inline highlight within a sentence', () => {
            const html = markdownToHtml('This is ==important== text');
            expect(html).toContain('<mark>important</mark>');
        });
    });

    // ── htmlToMarkdown ──────────────────────────────────────────────────

    describe('htmlToMarkdown', () => {
        it('returns empty string for empty input', () => {
            expect(htmlToMarkdown('')).toBe('');
        });

        it('returns empty string for empty paragraph (Tiptap empty doc)', () => {
            expect(htmlToMarkdown('<p></p>')).toBe('');
            expect(htmlToMarkdown('<p> </p>')).toBe('');
        });

        it('converts heading HTML to atx headings', () => {
            expect(norm(htmlToMarkdown('<h1>Title</h1>'))).toBe('# Title');
            expect(norm(htmlToMarkdown('<h2>Sub</h2>'))).toBe('## Sub');
            expect(norm(htmlToMarkdown('<h3>Sub3</h3>'))).toBe('### Sub3');
        });

        it('converts bold/italic HTML to markdown', () => {
            const md = htmlToMarkdown('<p><strong>bold</strong> and <em>italic</em></p>');
            expect(md).toContain('**bold**');
            expect(md).toContain('_italic_');
        });

        it('converts blockquote HTML', () => {
            const md = htmlToMarkdown('<blockquote><p>quoted</p></blockquote>');
            expect(norm(md)).toContain('> quoted');
        });

        it('converts inline code', () => {
            const md = htmlToMarkdown('<p>use <code>foo</code></p>');
            expect(md).toContain('`foo`');
        });

        it('converts Tiptap task list HTML to markdown task items', () => {
            const html =
                '<ul data-type="taskList">' +
                '<li data-type="taskItem" data-checked="true">done</li>' +
                '<li data-type="taskItem" data-checked="false">todo</li>' +
                '</ul>';
            const md = htmlToMarkdown(html);
            expect(md).toContain('- [x] done');
            expect(md).toContain('- [ ] todo');
        });

        it('output always ends with a single newline', () => {
            const md = htmlToMarkdown('<p>hello</p>');
            expect(md).toMatch(/\n$/);
            expect(md).not.toMatch(/\n\n$/);
        });

        it('converts <mark> to ==text==', () => {
            const md = htmlToMarkdown('<p>this is <mark>highlighted</mark> text</p>');
            expect(md).toContain('==highlighted==');
        });

        it('converts <mark> with style attribute to ==text==', () => {
            const md = htmlToMarkdown('<p><mark data-color="#ffc8dd" style="background-color: #ffc8dd">pink</mark></p>');
            expect(md).toContain('==pink==');
        });
    });

    // ── Round-trip ──────────────────────────────────────────────────────

    describe('round-trip (markdown → html → markdown)', () => {
        function roundTrip(md: string): string {
            return htmlToMarkdown(markdownToHtml(md));
        }

        it('headings H1–H3', () => {
            expect(norm(roundTrip('# H1'))).toBe('# H1');
            expect(norm(roundTrip('## H2'))).toBe('## H2');
            expect(norm(roundTrip('### H3'))).toBe('### H3');
        });

        it('bold text', () => {
            expect(norm(roundTrip('**bold**'))).toBe('**bold**');
        });

        it('italic text', () => {
            const rt = norm(roundTrip('*italic*'));
            // turndown may use _ for italic
            expect(rt === '*italic*' || rt === '_italic_').toBe(true);
        });

        it('strikethrough', () => {
            expect(norm(roundTrip('~~strike~~'))).toBe('~~strike~~');
        });

        it('highlight', () => {
            expect(norm(roundTrip('==highlighted=='))).toBe('==highlighted==');
        });

        it('highlight within a sentence', () => {
            const rt = norm(roundTrip('This has ==important== info'));
            expect(rt).toContain('==important==');
        });

        it('bullet list', () => {
            const md = '- item one\n- item two';
            const rt = norm(roundTrip(md));
            expect(rt).toContain('item one');
            expect(rt).toContain('item two');
            // Turndown may add extra whitespace after the bullet marker
            expect(rt).toMatch(/-\s+item one/);
            expect(rt).toMatch(/-\s+item two/);
        });

        it('ordered list', () => {
            const md = '1. first\n2. second';
            const rt = norm(roundTrip(md));
            expect(rt).toContain('1.');
            expect(rt).toContain('first');
            expect(rt).toContain('second');
        });

        it('task list preserves checked state', () => {
            const md = '- [x] done\n- [ ] todo';
            const rt = norm(roundTrip(md));
            expect(rt).toContain('- [x] done');
            expect(rt).toContain('- [ ] todo');
        });

        it('blockquote', () => {
            const rt = norm(roundTrip('> quoted text'));
            expect(rt).toContain('> quoted text');
        });

        it('inline code', () => {
            expect(norm(roundTrip('`code`'))).toBe('`code`');
        });

        it('fenced code block', () => {
            const md = '```js\nconst x = 1;\n```';
            const rt = norm(roundTrip(md));
            expect(rt).toContain('```');
            expect(rt).toContain('const x = 1;');
        });

        it('link', () => {
            const md = '[text](https://example.com)';
            const rt = norm(roundTrip(md));
            expect(rt).toContain('[text]');
            expect(rt).toContain('https://example.com');
        });

        it('horizontal rule', () => {
            const rt = norm(roundTrip('---'));
            // turndown may use --- or * * * or ___
            expect(rt).toMatch(/^(-{3}|\* \* \*|_{3})$/);
        });

        it('empty string', () => {
            expect(roundTrip('')).toBe('');
        });

        it('mixed content preserves structure', () => {
            const md = [
                '# Title',
                '',
                'A paragraph with **bold** and *italic*.',
                '',
                '- item one',
                '- item two',
                '',
                '> a quote',
                '',
                '```',
                'code block',
                '```',
            ].join('\n');
            const rt = roundTrip(md);
            expect(rt).toContain('# Title');
            expect(rt).toContain('**bold**');
            expect(rt).toMatch(/-\s+item one/);
            expect(rt).toContain('> a quote');
            expect(rt).toContain('code block');
        });

        it('trailing newline convention', () => {
            const rt = roundTrip('# Hello');
            expect(rt.endsWith('\n')).toBe(true);
            // Should not have double trailing newlines
            expect(rt.endsWith('\n\n')).toBe(false);
        });
    });

    // ── Table support ───────────────────────────────────────────────────

    describe('table support', () => {
        function roundTrip(md: string): string {
            return htmlToMarkdown(markdownToHtml(md));
        }

        it('htmlToMarkdown — simple 2×2 table', () => {
            const html = '<table><thead><tr><th>A</th><th>B</th></tr></thead>' +
                         '<tbody><tr><td>1</td><td>2</td></tr></tbody></table>';
            const md = htmlToMarkdown(html);
            expect(md).toContain('| A | B |');
            expect(md).toContain('| --- |');
            expect(md).toContain('| 1 | 2 |');
        });

        it('htmlToMarkdown — header-only table (no <tbody>)', () => {
            const html = '<table><thead><tr><th>H1</th><th>H2</th></tr></thead></table>';
            const md = htmlToMarkdown(html);
            expect(md).toContain('| H1 | H2 |');
            expect(md).toContain('| --- |');
            const lines = norm(md).split('\n').filter(Boolean);
            expect(lines).toHaveLength(2);
        });

        it('htmlToMarkdown — alignment (center and right)', () => {
            const html =
              '<table><thead><tr>' +
              '<th style="text-align: left">L</th>' +
              '<th style="text-align: center">C</th>' +
              '<th style="text-align: right">R</th>' +
              '</tr></thead></table>';
            const md = htmlToMarkdown(html);
            expect(md).toContain('| --- |');
            expect(md).toContain('| :---: |');
            expect(md).toContain('| ---: |');
        });

        it('htmlToMarkdown — cell content with inline formatting (bold)', () => {
            const html =
              '<table><thead><tr><th>Name</th></tr></thead>' +
              '<tbody><tr><td><strong>Alice</strong></td></tr></tbody></table>';
            const md = htmlToMarkdown(html);
            expect(md).toContain('**Alice**');
        });

        it('htmlToMarkdown — pipe characters in cell content are escaped', () => {
            const html =
              '<table><thead><tr><th>Code</th></tr></thead>' +
              '<tbody><tr><td>a | b</td></tr></tbody></table>';
            const md = htmlToMarkdown(html);
            expect(md).toContain('a \\| b');
            const bodyRow = norm(md).split('\n').find(l => l.includes('a'));
            // Strip escaped pipes before splitting to verify cell count
            const unescaped = bodyRow?.replace(/\\\|/g, '') ?? '';
            expect(unescaped.split('|').filter(Boolean)).toHaveLength(1);
        });

        it('htmlToMarkdown — empty cells produce blank cell slots', () => {
            const html =
              '<table><thead><tr><th>A</th><th>B</th></tr></thead>' +
              '<tbody><tr><td></td><td>val</td></tr></tbody></table>';
            const md = htmlToMarkdown(html);
            const bodyRow = norm(md).split('\n').find(l => l.includes('val')) ?? '';
            expect(bodyRow.startsWith('|')).toBe(true);
            expect(bodyRow.endsWith('|')).toBe(true);
            expect((bodyRow.match(/\|/g) ?? []).length).toBeGreaterThanOrEqual(3);
        });

        it('round-trip — simple table', () => {
            const md = '| Header 1 | Header 2 |\n| --- | --- |\n| Cell 1 | Cell 2 |';
            const rt = norm(roundTrip(md));
            expect(rt).toContain('| Header 1 | Header 2 |');
            expect(rt).toContain('| --- |');
            expect(rt).toContain('| Cell 1 | Cell 2 |');
        });

        it('round-trip — table mixed with other content', () => {
            const md = [
              '# Title',
              '',
              'Intro paragraph.',
              '',
              '| Col A | Col B |',
              '| --- | --- |',
              '| x | y |',
              '',
              'Outro paragraph.',
            ].join('\n');
            const rt = norm(roundTrip(md));
            expect(rt).toContain('# Title');
            expect(rt).toContain('Intro paragraph');
            expect(rt).toContain('| Col A | Col B |');
            expect(rt).toContain('| x | y |');
            expect(rt).toContain('Outro paragraph');
        });
    });
});
