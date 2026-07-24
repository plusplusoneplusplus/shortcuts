import { describe, it, expect } from 'vitest';
import { markdownToHtml, htmlToMarkdown, rewriteImageSrcToApi, rewriteImageSrcToRelative } from '../../../../src/server/spa/client/react/features/notes/editor/noteMarkdown';

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

        it('does not tag regular bullet list as taskList when followed by a task list', () => {
            // Regression: the old cross-boundary regex would incorrectly tag the
            // first <ul> (bullets) as taskList when both lists appear together.
            const md = '- bullet one\n- bullet two\n\n---\n\n- [x] done\n- [ ] todo';
            const html = markdownToHtml(md);
            // The task-list <ul> must be tagged
            expect(html).toContain('<ul data-type="taskList">');
            // The regular bullet <ul> must NOT be tagged as taskList
            // There should be exactly one taskList tag, not two
            const taskListMatches = (html.match(/data-type="taskList"/g) ?? []).length;
            expect(taskListMatches).toBe(1);
            // Regular bullets must still appear as a plain <ul>
            expect(html).toContain('<ul>');
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

        it('converts mermaid fenced block to language-mermaid code element', () => {
            const html = markdownToHtml('```mermaid\ngraph TD\nA --> B\n```');
            expect(html).toContain('<code class="language-mermaid">');
            expect(html).toContain('graph TD');
            // marked HTML-encodes > inside code blocks
            expect(html).toContain('A --&gt; B');
        });

        it('converts links', () => {
            const html = markdownToHtml('[text](https://example.com)');
            expect(html).toContain('<a');
            expect(html).toContain('href="https://example.com"');
            expect(html).toContain('text');
        });

        it('converts allowlisted Google Maps links to map embed placeholders', () => {
            const url = 'https://www.google.com/maps/embed?pb=!1m18!1m12';
            const html = markdownToHtml(`[Lake Chelan](${url})`);
            expect(html).toContain('class="md-map-embed"');
            expect(html).toContain(`data-map-url="${url}"`);
            expect(html).toContain('data-map-label="Lake Chelan"');
            expect(html).not.toContain('<a href');
        });

        it('leaves Google Maps share links as normal hyperlinks', () => {
            const html = markdownToHtml('[Shared map](https://maps.app.goo.gl/example)');
            expect(html).toContain('<a');
            expect(html).toContain('href="https://maps.app.goo.gl/example"');
            expect(html).not.toContain('md-map-embed');
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

        it('converts <pre><code class="language-mermaid"> back to mermaid fenced block', () => {
            const md = htmlToMarkdown(
                '<pre><code class="language-mermaid">graph TD\nA --> B</code></pre>'
            );
            expect(norm(md)).toContain('```mermaid');
            expect(norm(md)).toContain('graph TD');
            expect(norm(md)).toContain('A --> B');
            expect(norm(md)).toContain('```');
        });

        it('converts map embed placeholders back to plain markdown links', () => {
            const url = 'https://www.google.com/maps/embed?pb=!1m18!1m12';
            const md = htmlToMarkdown(`<div class="md-map-embed" data-map-url="${url}" data-map-label="Lake Chelan"></div>`);
            expect(md).toBe(`[Lake Chelan](${url})\n`);
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
            // Should produce tight list (no blank lines between items)
            expect(rt).toMatch(/-\s+item one/);
            expect(rt).toMatch(/-\s+item two/);
            expect(rt).not.toMatch(/item one\n\s*\n/);
        });

        it('ordered list', () => {
            const md = '1. first\n2. second';
            const rt = norm(roundTrip(md));
            expect(rt).toContain('1.');
            expect(rt).toContain('first');
            expect(rt).toContain('second');
            // Should not have blank lines between items
            expect(rt).not.toMatch(/first\n\s*\n/);
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

        it('mermaid fenced block', () => {
            const md = '```mermaid\ngraph TD\nA --> B\n```';
            const rt = norm(roundTrip(md));
            expect(rt).toContain('```mermaid');
            expect(rt).toContain('graph TD');
            expect(rt).toContain('A --> B');
        });

        it('link', () => {
            const md = '[text](https://example.com)';
            const rt = norm(roundTrip(md));
            expect(rt).toContain('[text]');
            expect(rt).toContain('https://example.com');
        });

        it('allowlisted Google Maps link', () => {
            const md = '[Lake Chelan](https://www.google.com/maps/embed?pb=!1m18!1m12)';
            expect(norm(roundTrip(md))).toBe(md);
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

        it('single-newline separated bold fields render on separate lines (regression)', () => {
            // Content authored outside the editor with single newlines must not collapse
            const md = '**Dates:** May 22 – May 25\n**Group:** 3 adults, 1 kid\n**Gear:** Paddleboard';
            const html = markdownToHtml(md);
            // Each bold field must be separated — not all smashed into one <p> with spaces
            expect(html).toContain('<br');
        });

        it('single-newline fields round-trip to preserved line breaks', () => {
            const md = '**Dates:** May 22 – May 25\n**Group:** 3 adults\n**Gear:** Paddleboard';
            const rt = norm(roundTrip(md));
            // All three field labels must survive
            expect(rt).toContain('**Dates:**');
            expect(rt).toContain('**Group:**');
            expect(rt).toContain('**Gear:**');
            // They must appear on separate lines (not smashed into one line with spaces)
            expect(rt).not.toMatch(/\*\*Dates:\*\*.*\*\*Group:\*\*/);
        });

        it('<br> in html round-trips without trailing spaces', () => {
            const html = '<p>line one<br>line two</p>';
            const md = htmlToMarkdown(html);
            // Must NOT produce trailing-space hard-break ("  \n")
            expect(md).not.toMatch(/  \n/);
            // Must still separate the two lines
            expect(md).toContain('\n');
        });
    });

    // ── Tight list fix (unwrapSingleParagraphListItems) ─────────────────

    describe('tight list round-trip', () => {
        it('single-<p> bullet list items produce tight list', () => {
            const html =
                '<ul><li><p>alpha</p></li><li><p>beta</p></li><li><p>gamma</p></li></ul>';
            const md = norm(htmlToMarkdown(html));
            // Tight: no blank lines between items
            expect(md).toMatch(/-\s+alpha/);
            expect(md).toMatch(/-\s+beta/);
            expect(md).toMatch(/-\s+gamma/);
            expect(md).not.toMatch(/alpha\n\s*\n/);
            expect(md).not.toMatch(/beta\n\s*\n/);
        });

        it('single-<p> ordered list items produce tight list', () => {
            const html =
                '<ol><li><p>first</p></li><li><p>second</p></li></ol>';
            const md = norm(htmlToMarkdown(html));
            expect(md).not.toMatch(/first\n\s*\n/);
            expect(md).toContain('first');
            expect(md).toContain('second');
        });

        it('multi-<p> list items still produce loose list', () => {
            const html =
                '<ul><li><p>para one</p><p>para two</p></li><li><p>item b</p></li></ul>';
            const md = htmlToMarkdown(html);
            // First item has two paragraphs — turndown should insert a blank/indented line
            expect(md).toMatch(/para one\n[\s]*\n[\s]*para two/);
        });

        it('nested lists are not broken', () => {
            const html =
                '<ul>' +
                '<li><p>parent</p><ul><li><p>child</p></li></ul></li>' +
                '</ul>';
            const md = norm(htmlToMarkdown(html));
            expect(md).toContain('parent');
            expect(md).toContain('child');
        });

        it('inline formatting inside tight list items is preserved', () => {
            const html =
                '<ul>' +
                '<li><p><a href="https://example.com">link</a> and <strong>bold</strong></p></li>' +
                '<li><p><code>code</code> text</p></li>' +
                '</ul>';
            const md = norm(htmlToMarkdown(html));
            expect(md).toContain('[link](https://example.com)');
            expect(md).toContain('**bold**');
            expect(md).toContain('`code`');
            // Tight — no blank lines between items
            expect(md).not.toMatch(/bold\n\s*\n/);
        });

        it('task list items are unaffected by unwrap (own rule handles them)', () => {
            const html =
                '<ul data-type="taskList">' +
                '<li data-type="taskItem" data-checked="true">done</li>' +
                '<li data-type="taskItem" data-checked="false">todo</li>' +
                '</ul>';
            const md = norm(htmlToMarkdown(html));
            expect(md).toContain('- [x] done');
            expect(md).toContain('- [ ] todo');
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

        it('htmlToMarkdown — Tiptap table HTML (no <thead>, <th> in <tbody>)', () => {
            const html =
                '<table><tbody>' +
                '<tr><th><p>H1</p></th><th><p>H2</p></th></tr>' +
                '<tr><td><p>C1</p></td><td><p>C2</p></td></tr>' +
                '</tbody></table>';
            const md = htmlToMarkdown(html);
            expect(md).toContain('| H1 | H2 |');
            expect(md).toContain('| --- |');
            expect(md).toContain('| C1 | C2 |');
            const lines = norm(md).split('\n').filter(Boolean);
            expect(lines).toHaveLength(3);
        });

        it('htmlToMarkdown — Tiptap table with alignment (no <thead>)', () => {
            const html =
                '<table><tbody>' +
                '<tr><th style="text-align: left"><p>L</p></th><th style="text-align: center"><p>C</p></th><th style="text-align: right"><p>R</p></th></tr>' +
                '<tr><td><p>a</p></td><td><p>b</p></td><td><p>c</p></td></tr>' +
                '</tbody></table>';
            const md = htmlToMarkdown(html);
            expect(md).toContain('| --- |');
            expect(md).toContain('| :---: |');
            expect(md).toContain('| ---: |');
        });

        it('htmlToMarkdown — Tiptap empty 3x3 table survives', () => {
            const html =
                '<table><tbody>' +
                '<tr><th><p></p></th><th><p></p></th><th><p></p></th></tr>' +
                '<tr><td><p></p></td><td><p></p></td><td><p></p></td></tr>' +
                '<tr><td><p></p></td><td><p></p></td><td><p></p></td></tr>' +
                '</tbody></table>';
            const md = htmlToMarkdown(html);
            expect(md).toContain('| --- |');
            const lines = norm(md).split('\n').filter(Boolean);
            expect(lines).toHaveLength(4); // header + separator + 2 body rows
        });

        it('round-trip — Tiptap table HTML survives save/reload cycle', () => {
            const tiptapHtml =
                '<table><tbody>' +
                '<tr><th><p>Name</p></th><th><p>Value</p></th></tr>' +
                '<tr><td><p>foo</p></td><td><p>bar</p></td></tr>' +
                '</tbody></table>';
            const md = htmlToMarkdown(tiptapHtml);
            const reloadedHtml = markdownToHtml(md);
            expect(reloadedHtml).toContain('<table>');
            expect(reloadedHtml).toContain('<th');
            expect(reloadedHtml).toContain('Name');
            expect(reloadedHtml).toContain('bar');
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

        it('htmlToMarkdown — td-only table (no th, no thead) emits separator', () => {
            const html =
                '<table><tbody>' +
                '<tr><td>A</td><td>B</td></tr>' +
                '<tr><td>1</td><td>2</td></tr>' +
                '</tbody></table>';
            const md = htmlToMarkdown(html);
            expect(md).toContain('| A | B |');
            expect(md).toContain('| --- |');
            expect(md).toContain('| 1 | 2 |');
        });

        it('round-trip — td-only table survives save/reload cycle', () => {
            // Start from the markdown that a td-only table would produce
            const html =
                '<table><tbody>' +
                '<tr><td>Name</td><td>Value</td></tr>' +
                '<tr><td>foo</td><td>bar</td></tr>' +
                '</tbody></table>';
            const md = htmlToMarkdown(html);
            const reloadedHtml = markdownToHtml(md);
            // Must come back as a table, not paragraphs
            expect(reloadedHtml).toContain('<table>');
            expect(reloadedHtml).toContain('Name');
            expect(reloadedHtml).toContain('bar');
            expect(reloadedHtml).not.toMatch(/<p>\|/);
        });

        it('round-trip — pasted table (td-only) renders back as table', () => {
            const html =
                '<table><tbody>' +
                '<tr><td>X</td><td>Y</td></tr>' +
                '<tr><td>1</td><td>2</td></tr>' +
                '</tbody></table>';
            const md = htmlToMarkdown(html);
            const reloadedHtml = markdownToHtml(md);
            expect(reloadedHtml).toContain('<table>');
            expect(reloadedHtml).toContain('<th');
            expect(reloadedHtml).not.toContain('<p>| X');
        });
    });

    // ── Image resize serialization ──────────────────────────────────────

    describe('image resize serialization', () => {
        it('htmlToMarkdown — img with width attribute serializes as HTML <img> tag', () => {
            const html = '<img src=".attachments/abc.png" alt="screenshot" width="450">';
            const md = htmlToMarkdown(html);
            expect(md).toContain('<img src=".attachments/abc.png"');
            expect(md).toContain('width="450"');
            expect(md).not.toContain('![');
        });

        it('htmlToMarkdown — img without width attribute serializes as standard markdown', () => {
            const html = '<img src=".attachments/abc.png" alt="screenshot">';
            const md = htmlToMarkdown(html);
            expect(md).toContain('![screenshot](.attachments/abc.png)');
            expect(md).not.toContain('<img');
        });

        it('markdownToHtml — inline HTML <img> with width is preserved', () => {
            const md = '<img src=".attachments/abc.png" alt="screenshot" width="450" />';
            const html = markdownToHtml(md);
            expect(html).toContain('src=".attachments/abc.png"');
            expect(html).toContain('width="450"');
        });

        it('rewriteImageSrcToRelative — rewrites standard markdown image URLs', () => {
            const md = '![alt](/api/workspaces/ws1/notes/image?path=.attachments%2Fimg.png)';
            const result = rewriteImageSrcToRelative(md);
            expect(result).toBe('![alt](.attachments/img.png)');
        });

        it('rewriteImageSrcToRelative — rewrites HTML <img> tags with API URLs', () => {
            const md = '<img src="/api/workspaces/ws1/notes/image?path=.attachments%2Fimg.png" alt="shot" width="300" />';
            const result = rewriteImageSrcToRelative(md);
            expect(result).toContain('src=".attachments/img.png"');
            expect(result).toContain('width="300"');
            expect(result).not.toContain('/api/workspaces');
        });

        it('rewriteImageSrcToApi — rewrites relative src in HTML <img> tags', () => {
            const html = '<img src=".attachments/abc.png" alt="x" width="200">';
            const result = rewriteImageSrcToApi(html, 'ws1');
            expect(result).toContain('src="/api/workspaces/ws1/notes/image?path=');
            expect(result).toContain('width="200"');
        });

        it('round-trip — image with width survives markdown → html → markdown', () => {
            const md = '<img src=".attachments/abc.png" alt="screenshot" width="450" />\n';
            const html = markdownToHtml(md);
            expect(html).toContain('width="450"');
            const rt = htmlToMarkdown(html);
            expect(rt).toContain('width="450"');
            expect(rt).toContain('src=".attachments/abc.png"');
        });

        it('round-trip — image without width uses standard markdown syntax', () => {
            const md = '![screenshot](.attachments/abc.png)\n';
            const html = markdownToHtml(md);
            const rt = htmlToMarkdown(html);
            expect(rt).toContain('![screenshot](.attachments/abc.png)');
            expect(rt).not.toContain('<img');
        });

        it('round-trip — mixed content with resized and normal images', () => {
            const md = [
                '# Title',
                '',
                '![normal](.attachments/a.png)',
                '',
                '<img src=".attachments/b.png" alt="resized" width="300" />',
                '',
                'Some text.',
                '',
            ].join('\n');
            const html = markdownToHtml(md);
            const rt = htmlToMarkdown(html);
            expect(rt).toContain('![normal](.attachments/a.png)');
            expect(rt).toContain('width="300"');
            expect(rt).toContain('# Title');
            expect(rt).toContain('Some text.');
        });

        it('rewriteImageSrcToRelative — handles both markdown and HTML images in same content', () => {
            const md = [
                '![alt1](/api/workspaces/ws1/notes/image?path=.attachments%2Fa.png)',
                '<img src="/api/workspaces/ws1/notes/image?path=.attachments%2Fb.png" alt="alt2" width="250" />',
            ].join('\n');
            const result = rewriteImageSrcToRelative(md);
            expect(result).toContain('![alt1](.attachments/a.png)');
            expect(result).toContain('src=".attachments/b.png"');
            expect(result).toContain('width="250"');
        });
    });

    // ── Empty paragraph preservation ────────────────────────────────────
    //
    // Tiptap emits `<p></p>` for each Enter the user presses with no content.
    // Without dedicated handling, turndown drops these and CommonMark collapses
    // any sequence of blank lines into a single paragraph break, so consecutive
    // empty lines vanish on save/reload. The fix emits `&nbsp;` placeholder
    // paragraphs in markdown and strips the resulting `<p>&nbsp;</p>` back to
    // `<p></p>` on load.
    describe('empty paragraph round-trip', () => {
        function emptyParagraphCount(html: string): number {
            return (html.match(/<p>(?:<\/p>|<br\s*\/?\s*><\/p>)/gi) ?? []).length;
        }

        it('preserves a single empty paragraph between two paragraphs', () => {
            const original = '<p>first</p><p></p><p>second</p>';
            const md = htmlToMarkdown(original);
            expect(md).toContain('&nbsp;');
            const reloaded = markdownToHtml(md);
            expect(emptyParagraphCount(reloaded)).toBe(1);
            expect(reloaded).toContain('<p>first</p>');
            expect(reloaded).toContain('<p>second</p>');
        });

        it('preserves three consecutive empty paragraphs', () => {
            const original = '<p>first</p><p></p><p></p><p></p><p>second</p>';
            const md = htmlToMarkdown(original);
            // Each empty paragraph emits one `&nbsp;` line.
            expect((md.match(/&nbsp;/g) ?? []).length).toBe(3);
            const reloaded = markdownToHtml(md);
            expect(emptyParagraphCount(reloaded)).toBe(3);
        });

        it('treats <p><br></p> as an empty paragraph', () => {
            const original = '<p>first</p><p><br></p><p><br></p><p>second</p>';
            const md = htmlToMarkdown(original);
            expect((md.match(/&nbsp;/g) ?? []).length).toBe(2);
            const reloaded = markdownToHtml(md);
            expect(emptyParagraphCount(reloaded)).toBe(2);
        });

        it('preserves a leading empty paragraph', () => {
            const original = '<p></p><p>text</p>';
            const md = htmlToMarkdown(original);
            expect(md.startsWith('<p>&nbsp;</p>')).toBe(true);
            const reloaded = markdownToHtml(md);
            expect(emptyParagraphCount(reloaded)).toBe(1);
        });

        it('preserves a trailing empty paragraph', () => {
            const original = '<p>text</p><p></p>';
            const md = htmlToMarkdown(original);
            expect(md).toContain('&nbsp;');
            const reloaded = markdownToHtml(md);
            expect(emptyParagraphCount(reloaded)).toBe(1);
        });

        it('does not introduce empty paragraphs into normal content', () => {
            const original = '<p>hello</p><p>world</p>';
            const md = htmlToMarkdown(original);
            expect(md).not.toContain('&nbsp;');
            const reloaded = markdownToHtml(md);
            expect(emptyParagraphCount(reloaded)).toBe(0);
        });

        it('keeps the empty-document shortcut working for a lone <p></p>', () => {
            // A document containing only a single empty paragraph is treated
            // as an empty doc — we don't want to start writing &nbsp; into
            // every freshly-created note.
            expect(htmlToMarkdown('<p></p>')).toBe('');
        });

        it('round-trips mixed blank-line patterns idempotently', () => {
            // After one round-trip, a second save must produce identical markdown
            // (no NBSP accumulation, no extra blanks).
            const original = '<p>a</p><p></p><p></p><p>b</p><p></p><p>c</p>';
            const md1 = htmlToMarkdown(original);
            const html1 = markdownToHtml(md1);
            const md2 = htmlToMarkdown(html1);
            expect(md2).toBe(md1);
        });

        it('reloaded empty paragraph contains no stray NBSP character for Tiptap', () => {
            // Tiptap should see `<p></p>`, not `<p>&nbsp;</p>`, otherwise the user
            // sees a leading non-breaking-space character in the empty line.
            const md = htmlToMarkdown('<p>a</p><p></p><p>b</p>');
            const reloaded = markdownToHtml(md);
            expect(reloaded).not.toContain('<p>&nbsp;</p>');
            // Also no literal NBSP ( ) inside a paragraph
            expect(reloaded).not.toMatch(/<p> <\/p>/);
        });

        it('preserves empty paragraphs across heading and list contexts', () => {
            const original = '<h1>Title</h1><p></p><p></p><p>body</p><p></p><ul><li>item</li></ul>';
            const md = htmlToMarkdown(original);
            const reloaded = markdownToHtml(md);
            expect(emptyParagraphCount(reloaded)).toBe(3);
            expect(reloaded).toContain('<h1');
            expect(reloaded).toContain('<ul>');
            expect(reloaded).toContain('item');
        });

        it('round-trips when input already contains <p>&nbsp;</p> (no NBSP accumulation)', () => {
            // Defensive: simulate Tiptap echoing back `<p>&nbsp;</p>` (e.g. paste).
            const original = '<p>a</p><p>&nbsp;</p><p>&nbsp;</p><p>b</p>';
            const md = htmlToMarkdown(original);
            expect((md.match(/&nbsp;/g) ?? []).length).toBe(2);
            const reloaded = markdownToHtml(md);
            expect(emptyParagraphCount(reloaded)).toBe(2);
            // Idempotent across one more cycle.
            expect(htmlToMarkdown(reloaded)).toBe(md);
        });

        it('keeps norm() comparison stable for non-empty content (regression guard)', () => {
            // norm() is the helper at the top of this file; verify the new
            // empty-paragraph machinery doesn't break the existing pattern.
            const original = '<p>line one</p><p>line two</p>';
            const md = htmlToMarkdown(original);
            expect(norm(md)).toBe('line one\n\nline two');
        });
    });

    // ── Text alignment and indentation ──────────────────────────────────────
    //
    // Aligned/indented paragraphs and headings have no standard markdown syntax,
    // so they are round-tripped as raw HTML blocks that marked passes through.

    describe('text alignment (htmlToMarkdown)', () => {
        it('emits raw HTML block for center-aligned paragraph', () => {
            const html = '<p style="text-align: center">centered</p>';
            const md = htmlToMarkdown(html);
            expect(md).toContain('<p style="text-align: center">centered</p>');
            // Must not produce a plain paragraph
            expect(md).not.toMatch(/^centered\n/m);
        });

        it('emits raw HTML block for right-aligned paragraph', () => {
            const html = '<p style="text-align: right">right</p>';
            const md = htmlToMarkdown(html);
            expect(md).toContain('<p style="text-align: right">right</p>');
        });

        it('emits raw HTML block for justify-aligned paragraph', () => {
            const html = '<p style="text-align: justify">justified</p>';
            const md = htmlToMarkdown(html);
            expect(md).toContain('<p style="text-align: justify">justified</p>');
        });

        it('does NOT emit raw HTML for left-aligned paragraph (left is default)', () => {
            const html = '<p style="text-align: left">normal</p>';
            const md = htmlToMarkdown(html);
            // Should be plain markdown paragraph, not a raw HTML block
            expect(md).toContain('normal');
            expect(md).not.toContain('text-align: left');
        });

        it('emits raw HTML for center-aligned heading', () => {
            const html = '<h2 style="text-align: center">Centered H2</h2>';
            const md = htmlToMarkdown(html);
            expect(md).toContain('<h2 style="text-align: center">Centered H2</h2>');
        });

        it('preserves inline formatting inside aligned paragraph', () => {
            const html = '<p style="text-align: center"><strong>bold</strong> text</p>';
            const md = htmlToMarkdown(html);
            expect(md).toContain('text-align: center');
            expect(md).toContain('<strong>bold</strong>');
        });

        it('round-trip — center-aligned paragraph survives save/reload', () => {
            const html = '<p style="text-align: center">hello</p>';
            const md = htmlToMarkdown(html);
            const reloaded = markdownToHtml(md);
            expect(reloaded).toContain('text-align: center');
            expect(reloaded).toContain('hello');
        });

        it('round-trip — right-aligned heading survives save/reload', () => {
            const html = '<h1 style="text-align: right">Title</h1>';
            const md = htmlToMarkdown(html);
            const reloaded = markdownToHtml(md);
            expect(reloaded).toContain('text-align: right');
            expect(reloaded).toContain('Title');
        });

        it('round-trip — mixed aligned and plain paragraphs', () => {
            const html = '<p>plain</p><p style="text-align: center">centered</p><p>plain again</p>';
            const md = htmlToMarkdown(html);
            const reloaded = markdownToHtml(md);
            expect(reloaded).toContain('plain');
            expect(reloaded).toContain('centered');
            expect(reloaded).toContain('text-align: center');
        });
    });

    describe('paragraph indentation (htmlToMarkdown)', () => {
        it('emits raw HTML block for indented paragraph (data-indent)', () => {
            const html = '<p data-indent="1">indented</p>';
            const md = htmlToMarkdown(html);
            expect(md).toContain('<p data-indent="1">indented</p>');
            expect(md).not.toMatch(/^indented\n/m);
        });

        it('emits raw HTML block for deeply indented paragraph', () => {
            const html = '<p data-indent="3">deep</p>';
            const md = htmlToMarkdown(html);
            expect(md).toContain('<p data-indent="3">deep</p>');
        });

        it('does NOT emit raw HTML for data-indent="0" (default)', () => {
            const html = '<p data-indent="0">normal</p>';
            const md = htmlToMarkdown(html);
            expect(md).toContain('normal');
            expect(md).not.toContain('data-indent');
        });

        it('emits raw HTML for indented heading', () => {
            const html = '<h3 data-indent="2">Indented H3</h3>';
            const md = htmlToMarkdown(html);
            expect(md).toContain('<h3 data-indent="2">Indented H3</h3>');
        });

        it('round-trip — indented paragraph survives save/reload', () => {
            const html = '<p data-indent="2">hello</p>';
            const md = htmlToMarkdown(html);
            const reloaded = markdownToHtml(md);
            expect(reloaded).toContain('data-indent="2"');
            expect(reloaded).toContain('hello');
        });

        it('round-trip — alignment and indent combined on same paragraph', () => {
            const html = '<p style="text-align: center" data-indent="1">combo</p>';
            const md = htmlToMarkdown(html);
            expect(md).toContain('text-align: center');
            expect(md).toContain('data-indent="1"');
            const reloaded = markdownToHtml(md);
            expect(reloaded).toContain('text-align: center');
            expect(reloaded).toContain('data-indent="1"');
            expect(reloaded).toContain('combo');
        });
    });

    // ── Inline PDF embeds ────────────────────────────────────────────────────
    //
    // `.pdf` image-embed markdown (`![label](x.pdf)`) renders as a placeholder
    // div the PdfBlock node view picks up; on save it serializes back to the
    // same image syntax. Non-pdf images stay ordinary `<img>` tags.
    describe('PDF embeds', () => {
        it('markdownToHtml — renders a .pdf image embed as a pdf placeholder div', () => {
            const html = markdownToHtml('![Doc](.attachments/sample.pdf)');
            expect(html).toContain('class="md-pdf-embed"');
            expect(html).toContain('data-pdf-url=".attachments/sample.pdf"');
            expect(html).toContain('data-pdf-label="Doc"');
            expect(html).not.toContain('<img');
        });

        it('markdownToHtml — non-pdf image still becomes an <img> tag', () => {
            const html = markdownToHtml('![shot](.attachments/pic.png)');
            expect(html).toContain('<img');
            expect(html).toContain('src=".attachments/pic.png"');
            expect(html).not.toContain('md-pdf-embed');
        });

        it('htmlToMarkdown — serializes a pdf placeholder div back to image syntax', () => {
            const html = '<div class="md-pdf-embed" data-pdf-url=".attachments/sample.pdf" data-pdf-label="Doc"></div>';
            const md = htmlToMarkdown(html);
            expect(md).toContain('![Doc](.attachments/sample.pdf)');
            expect(md).not.toContain('md-pdf-embed');
        });

        it('round-trips a pdf embed through html and back', () => {
            const original = '![Sample PDF](.attachments/sample.pdf)\n';
            const html = markdownToHtml(original);
            expect(html).toContain('data-pdf-url=".attachments/sample.pdf"');
            const md = htmlToMarkdown(html);
            expect(md).toContain('![Sample PDF](.attachments/sample.pdf)');
        });

        it('rewriteImageSrcToApi — rewrites data-pdf-url to the notes image API URL', () => {
            const html = '<div class="md-pdf-embed" data-pdf-url=".attachments/sample.pdf" data-pdf-label="Doc"></div>';
            const result = rewriteImageSrcToApi(html, 'ws1');
            expect(result).toContain('data-pdf-url="/api/workspaces/ws1/notes/image?path=');
            expect(result).toContain(encodeURIComponent('.attachments/sample.pdf'));
        });

        it('rewriteImageSrcToRelative — rewrites a pdf image API URL back to a relative path', () => {
            const md = '![Doc](/api/workspaces/ws1/notes/image?path=.attachments%2Fsample.pdf)';
            const result = rewriteImageSrcToRelative(md);
            expect(result).toBe('![Doc](.attachments/sample.pdf)');
        });
    });

    // ── Visual embed indentation persistence (AC-02) ────────────────────────
    //
    // A nonzero embed indent has no canonical Markdown syntax, so it is stored as
    // raw HTML carrying `data-indent`; marked passes it through and the embed's
    // own parseHTML re-reads it. Returning to level 0 drops `data-indent` and the
    // serializer returns to the canonical form (unless another customization —
    // e.g. an image width — already forces raw HTML). The editor-side HTML shapes
    // below match each node's renderHTML output.
    const MAP_EMBED_URL = 'https://www.google.com/maps/embed?pb=!1m18!1m12';

    describe('embed indentation persistence — image', () => {
        it('nonzero indent (no width) serializes to a raw <img> with data-indent', () => {
            const md = htmlToMarkdown('<img src=".attachments/a.png" alt="pic" data-indent="2">');
            expect(md).toContain('<img src=".attachments/a.png"');
            expect(md).toContain('data-indent="2"');
            // Not the canonical `![]()` form (which has no room for the indent)
            expect(md).not.toContain('![');
        });

        it('reloads the raw <img> with data-indent preserved', () => {
            const md = htmlToMarkdown('<img src=".attachments/a.png" alt="pic" data-indent="2">');
            const reloaded = markdownToHtml(md);
            expect(reloaded).toContain('src=".attachments/a.png"');
            expect(reloaded).toContain('data-indent="2"');
        });

        it('level 0 returns to canonical markdown with no data-indent', () => {
            const md = htmlToMarkdown('<img src=".attachments/a.png" alt="pic" data-indent="0">');
            expect(md).toContain('![pic](.attachments/a.png)');
            expect(md).not.toContain('data-indent');
            expect(md).not.toContain('<img');
        });

        it('width and indent round-trip together', () => {
            const html = '<img src=".attachments/a.png" alt="pic" width="300" data-indent="2">';
            const md = htmlToMarkdown(html);
            expect(md).toContain('width="300"');
            expect(md).toContain('data-indent="2"');
            const rt = htmlToMarkdown(markdownToHtml(md));
            expect(rt).toContain('src=".attachments/a.png"');
            expect(rt).toContain('width="300"');
            expect(rt).toContain('data-indent="2"');
        });

        it('clamps an out-of-range data-indent down to MAX (8)', () => {
            const md = htmlToMarkdown('<img src=".attachments/a.png" alt="pic" data-indent="99">');
            expect(md).toContain('data-indent="8"');
        });

        it('treats a negative data-indent as level 0 (canonical markdown)', () => {
            const md = htmlToMarkdown('<img src=".attachments/a.png" alt="pic" data-indent="-3">');
            expect(md).toContain('![pic](.attachments/a.png)');
            expect(md).not.toContain('data-indent');
        });

        it('attachment URL rewriting round-trips with data-indent present', () => {
            // Save: the live editor carries the notes-image API URL; the raw <img>
            // must be rewritten back to the relative `.attachments/` path.
            const editorHtml =
                '<img src="/api/workspaces/ws1/notes/image?path=.attachments%2Fa.png" alt="pic" width="300" data-indent="2">';
            const saved = rewriteImageSrcToRelative(htmlToMarkdown(editorHtml));
            expect(saved).toContain('src=".attachments/a.png"');
            expect(saved).toContain('width="300"');
            expect(saved).toContain('data-indent="2"');
            expect(saved).not.toContain('/api/workspaces');
            // Load: the relative path is rewritten back to an API URL, indent intact.
            const loaded = rewriteImageSrcToApi(markdownToHtml(saved), 'ws1');
            expect(loaded).toContain('src="/api/workspaces/ws1/notes/image?path=');
            expect(loaded).toContain('data-indent="2"');
        });

        it('local-image URL rewriting round-trips with data-indent present', () => {
            const markdownImg = '<img src="/home/u/chart.png" alt="c" width="200" data-indent="3" />';
            // Load: absolute path → local-image API URL, indent intact.
            const loaded = rewriteImageSrcToApi(markdownToHtml(markdownImg), 'ws1');
            expect(loaded).toContain('local-image?path=');
            expect(loaded).toContain('data-indent="3"');
            // Save: local-image API URL → original absolute path, indent intact.
            const saved = rewriteImageSrcToRelative(htmlToMarkdown(loaded));
            expect(saved).toContain('src="/home/u/chart.png"');
            expect(saved).toContain('data-indent="3"');
        });
    });

    describe('embed indentation persistence — PDF', () => {
        const indentedHtml =
            '<div class="md-pdf-embed" data-pdf-url=".attachments/a.pdf" data-pdf-label="Doc" data-indent="2"></div>';

        it('nonzero indent serializes to a raw md-pdf-embed div (not image syntax)', () => {
            const md = htmlToMarkdown(indentedHtml);
            expect(md).toContain('class="md-pdf-embed"');
            expect(md).toContain('data-pdf-url=".attachments/a.pdf"');
            expect(md).toContain('data-pdf-label="Doc"');
            expect(md).toContain('data-indent="2"');
            // Must NOT route through `![]()` — a raw <img>/pdf image reloads as an image.
            expect(md).not.toContain('![');
        });

        it('reloads the raw div with url, label and indent preserved', () => {
            const reloaded = markdownToHtml(htmlToMarkdown(indentedHtml));
            expect(reloaded).toContain('class="md-pdf-embed"');
            expect(reloaded).toContain('data-pdf-url=".attachments/a.pdf"');
            expect(reloaded).toContain('data-pdf-label="Doc"');
            expect(reloaded).toContain('data-indent="2"');
        });

        it('level 0 returns to canonical image syntax with no data-indent', () => {
            const md = htmlToMarkdown(
                '<div class="md-pdf-embed" data-pdf-url=".attachments/a.pdf" data-pdf-label="Doc" data-indent="0"></div>',
            );
            expect(md).toContain('![Doc](.attachments/a.pdf)');
            expect(md).not.toContain('data-indent');
            expect(md).not.toContain('md-pdf-embed');
        });

        it('attachment URL rewriting round-trips with data-indent present', () => {
            const editorHtml =
                '<div class="md-pdf-embed" data-pdf-url="/api/workspaces/ws1/notes/image?path=.attachments%2Fa.pdf" data-pdf-label="Doc" data-indent="2"></div>';
            const saved = rewriteImageSrcToRelative(htmlToMarkdown(editorHtml));
            expect(saved).toContain('data-pdf-url=".attachments/a.pdf"');
            expect(saved).toContain('data-indent="2"');
            expect(saved).not.toContain('/api/workspaces');
            const loaded = rewriteImageSrcToApi(markdownToHtml(saved), 'ws1');
            expect(loaded).toContain('data-pdf-url="/api/workspaces/ws1/notes/image?path=');
            expect(loaded).toContain('data-indent="2"');
        });
    });

    describe('embed height persistence — PDF', () => {
        const heightHtml =
            '<div class="md-pdf-embed" data-pdf-url=".attachments/a.pdf" data-pdf-label="Doc" data-pdf-height="720"></div>';

        it('a height-only embed serializes to a raw md-pdf-embed div (not image syntax)', () => {
            const md = htmlToMarkdown(heightHtml);
            expect(md).toContain('class="md-pdf-embed"');
            expect(md).toContain('data-pdf-url=".attachments/a.pdf"');
            expect(md).toContain('data-pdf-label="Doc"');
            expect(md).toContain('data-pdf-height="720"');
            expect(md).not.toContain('data-indent');
            // Must NOT route through `![]()` — the height would be lost.
            expect(md).not.toContain('![');
        });

        it('reloads the raw div with url, label and height preserved', () => {
            const reloaded = markdownToHtml(htmlToMarkdown(heightHtml));
            expect(reloaded).toContain('class="md-pdf-embed"');
            expect(reloaded).toContain('data-pdf-url=".attachments/a.pdf"');
            expect(reloaded).toContain('data-pdf-height="720"');
        });

        it('clamps an out-of-range height on serialization', () => {
            const md = htmlToMarkdown(
                '<div class="md-pdf-embed" data-pdf-url=".attachments/a.pdf" data-pdf-label="Doc" data-pdf-height="9999"></div>',
            );
            expect(md).toContain('data-pdf-height="1200"');
        });

        it('height + indent together both survive the round-trip', () => {
            const both =
                '<div class="md-pdf-embed" data-pdf-url=".attachments/a.pdf" data-pdf-label="Doc" data-indent="2" data-pdf-height="640"></div>';
            const md = htmlToMarkdown(both);
            expect(md).toContain('data-indent="2"');
            expect(md).toContain('data-pdf-height="640"');
            expect(md).not.toContain('![');

            const reloaded = markdownToHtml(md);
            expect(reloaded).toContain('data-indent="2"');
            expect(reloaded).toContain('data-pdf-height="640"');
        });

        it('no height and no indent still serializes to canonical image syntax', () => {
            const md = htmlToMarkdown(
                '<div class="md-pdf-embed" data-pdf-url=".attachments/a.pdf" data-pdf-label="Doc"></div>',
            );
            expect(md).toContain('![Doc](.attachments/a.pdf)');
            expect(md).not.toContain('data-pdf-height');
            expect(md).not.toContain('md-pdf-embed');
        });
    });

    describe('embed collapse persistence — PDF', () => {
        const collapsedHtml =
            '<div class="md-pdf-embed" data-pdf-url=".attachments/a.pdf" data-pdf-label="Doc" data-pdf-collapsed="true"></div>';

        it('a collapsed-only embed serializes to a raw md-pdf-embed div (not image syntax)', () => {
            const md = htmlToMarkdown(collapsedHtml);
            expect(md).toContain('class="md-pdf-embed"');
            expect(md).toContain('data-pdf-url=".attachments/a.pdf"');
            expect(md).toContain('data-pdf-label="Doc"');
            expect(md).toContain('data-pdf-collapsed="true"');
            expect(md).not.toContain('data-indent');
            expect(md).not.toContain('data-pdf-height');
            // Must NOT route through `![]()` — the collapse flag would be lost.
            expect(md).not.toContain('![');
        });

        it('reloads the raw div still collapsed', () => {
            const reloaded = markdownToHtml(htmlToMarkdown(collapsedHtml));
            expect(reloaded).toContain('class="md-pdf-embed"');
            expect(reloaded).toContain('data-pdf-url=".attachments/a.pdf"');
            expect(reloaded).toContain('data-pdf-collapsed="true"');
        });

        it('collapsed + indent + height all survive together', () => {
            const all =
                '<div class="md-pdf-embed" data-pdf-url=".attachments/a.pdf" data-pdf-label="Doc" data-indent="2" data-pdf-height="640" data-pdf-collapsed="true"></div>';
            const md = htmlToMarkdown(all);
            expect(md).toContain('data-indent="2"');
            expect(md).toContain('data-pdf-height="640"');
            expect(md).toContain('data-pdf-collapsed="true"');
            expect(md).not.toContain('![');

            const reloaded = markdownToHtml(md);
            expect(reloaded).toContain('data-indent="2"');
            expect(reloaded).toContain('data-pdf-height="640"');
            expect(reloaded).toContain('data-pdf-collapsed="true"');
        });

        it('not collapsed and not indented still serializes to canonical image syntax', () => {
            const md = htmlToMarkdown(
                '<div class="md-pdf-embed" data-pdf-url=".attachments/a.pdf" data-pdf-label="Doc"></div>',
            );
            expect(md).toContain('![Doc](.attachments/a.pdf)');
            expect(md).not.toContain('data-pdf-collapsed');
            expect(md).not.toContain('md-pdf-embed');
        });
    });

    describe('embed indentation persistence — map', () => {
        const indentedHtml =
            `<div class="md-map-embed" data-map-url="${MAP_EMBED_URL}" data-map-label="Map" data-indent="2"></div>`;

        it('nonzero indent serializes to a raw md-map-embed div (not a link)', () => {
            const md = htmlToMarkdown(indentedHtml);
            expect(md).toContain('class="md-map-embed"');
            expect(md).toContain(`data-map-url="${MAP_EMBED_URL}"`);
            expect(md).toContain('data-map-label="Map"');
            expect(md).toContain('data-indent="2"');
            expect(md).not.toMatch(/^\[Map\]\(/m);
        });

        it('reloads the raw div with url, label and indent preserved', () => {
            const reloaded = markdownToHtml(htmlToMarkdown(indentedHtml));
            expect(reloaded).toContain('class="md-map-embed"');
            expect(reloaded).toContain(`data-map-url="${MAP_EMBED_URL}"`);
            expect(reloaded).toContain('data-indent="2"');
        });

        it('level 0 returns to a plain markdown link with no data-indent', () => {
            const md = htmlToMarkdown(
                `<div class="md-map-embed" data-map-url="${MAP_EMBED_URL}" data-map-label="Map" data-indent="0"></div>`,
            );
            expect(md).toBe(`[Map](${MAP_EMBED_URL})\n`);
            expect(md).not.toContain('data-indent');
        });
    });

    describe('embed indentation persistence — mermaid', () => {
        const indentedHtml =
            '<pre data-indent="2"><code class="language-mermaid">graph TD\nA --&gt; B</code></pre>';

        it('nonzero indent serializes to a raw <pre> block (not a fenced code block)', () => {
            const md = htmlToMarkdown(indentedHtml);
            expect(md).toContain('data-indent="2"');
            expect(md).toContain('class="language-mermaid"');
            expect(md).toContain('graph TD');
            expect(md).not.toContain('```mermaid');
        });

        it('reloads the raw <pre> with code and indent preserved', () => {
            const reloaded = markdownToHtml(htmlToMarkdown(indentedHtml));
            expect(reloaded).toContain('data-indent="2"');
            expect(reloaded).toContain('language-mermaid');
            expect(reloaded).toContain('graph TD');
            expect(reloaded).toContain('A --&gt; B');
        });

        it('level 0 returns to a fenced mermaid block with no data-indent', () => {
            const md = htmlToMarkdown(
                '<pre><code class="language-mermaid">graph TD\nA --&gt; B</code></pre>',
            );
            expect(norm(md)).toContain('```mermaid');
            expect(md).not.toContain('data-indent');
        });
    });

    describe('embed indentation persistence — display math', () => {
        const indentedHtml =
            '<div data-math="display" data-tex="x^2" data-delim="double-dollar" data-indent="2">x^2</div>';

        it('nonzero indent serializes to a raw math div (not delimited `$$`)', () => {
            const md = htmlToMarkdown(indentedHtml);
            expect(md).toContain('data-math="display"');
            expect(md).toContain('data-tex="x^2"');
            expect(md).toContain('data-delim="double-dollar"');
            expect(md).toContain('data-indent="2"');
            expect(md).not.toContain('$$');
        });

        it('reloads the raw math div with tex, delimiter and indent preserved', () => {
            const reloaded = markdownToHtml(htmlToMarkdown(indentedHtml));
            expect(reloaded).toContain('data-math="display"');
            expect(reloaded).toContain('data-tex="x^2"');
            expect(reloaded).toContain('data-delim="double-dollar"');
            expect(reloaded).toContain('data-indent="2"');
        });

        it('level 0 returns to delimited `$$…$$` with no data-indent', () => {
            const md = htmlToMarkdown(
                '<div data-math="display" data-tex="x^2" data-delim="double-dollar">x^2</div>',
            );
            expect(md).toContain('$$x^2$$');
            expect(md).not.toContain('data-indent');
        });
    });

    describe('embed indentation persistence — stability (source mode)', () => {
        // Source mode shows the persisted markdown verbatim; re-saving an
        // unchanged indented embed must be idempotent (no metadata drift).
        it.each([
            ['image', '<img src=".attachments/a.png" alt="pic" width="300" data-indent="2">'],
            [
                'pdf',
                '<div class="md-pdf-embed" data-pdf-url=".attachments/a.pdf" data-pdf-label="Doc" data-indent="2"></div>',
            ],
            [
                'map',
                `<div class="md-map-embed" data-map-url="${MAP_EMBED_URL}" data-map-label="Map" data-indent="2"></div>`,
            ],
            [
                'mermaid',
                '<pre data-indent="2"><code class="language-mermaid">graph TD\nA --&gt; B</code></pre>',
            ],
            [
                'math',
                '<div data-math="display" data-tex="x^2" data-delim="double-dollar" data-indent="2">x^2</div>',
            ],
        ])('is idempotent across a second save for %s', (_name, editorHtml) => {
            const md1 = htmlToMarkdown(editorHtml);
            const md2 = htmlToMarkdown(markdownToHtml(md1));
            expect(md2).toBe(md1);
        });
    });
});
