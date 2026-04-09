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
});
