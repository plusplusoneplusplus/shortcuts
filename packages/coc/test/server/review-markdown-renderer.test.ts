/**
 * Review Markdown Renderer Tests
 *
 * Tests for the browser-compatible markdown rendering module
 * used by the SPA review editor.
 */

import { describe, it, expect } from 'vitest';
import {
    escapeHtml,
    generateAnchorId,
    applyInlineMarkdown,
    applyMarkdownHighlighting,
    renderMarkdownContent,
    renderSourceContent,
    applySourceModeHighlighting,
} from '../../src/server/spa/client/review-markdown-renderer';

describe('Review Markdown Renderer', () => {
    describe('escapeHtml', () => {
        it('escapes HTML entities', () => {
            expect(escapeHtml('<script>alert("xss")</script>')).toBe(
                '&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;'
            );
        });

        it('escapes ampersands', () => {
            expect(escapeHtml('a & b')).toBe('a &amp; b');
        });

        it('escapes single quotes', () => {
            expect(escapeHtml("it's")).toBe('it&#039;s');
        });

        it('returns empty string for empty input', () => {
            expect(escapeHtml('')).toBe('');
        });
    });

    describe('generateAnchorId', () => {
        it('generates lowercase hyphenated id from heading', () => {
            expect(generateAnchorId('Hello World')).toBe('hello-world');
        });

        it('removes punctuation', () => {
            expect(generateAnchorId('What is this?')).toBe('what-is-this');
        });

        it('removes markdown formatting', () => {
            expect(generateAnchorId('**Bold** and *italic*')).toBe('bold-and-italic');
        });

        it('collapses multiple hyphens', () => {
            expect(generateAnchorId('A   B')).toBe('a-b');
        });

        it('returns empty string for empty input', () => {
            expect(generateAnchorId('')).toBe('');
        });
    });

    describe('applyInlineMarkdown', () => {
        it('renders bold text', () => {
            const result = applyInlineMarkdown('**bold**');
            expect(result).toContain('<strong>bold</strong>');
        });

        it('renders italic text', () => {
            const result = applyInlineMarkdown('*italic*');
            expect(result).toContain('<em>italic</em>');
        });

        it('renders inline code', () => {
            const result = applyInlineMarkdown('use `code` here');
            expect(result).toContain('md-inline-code');
            expect(result).toContain('`code`');
        });

        it('renders links', () => {
            const result = applyInlineMarkdown('[text](http://example.com)');
            expect(result).toContain('href="http://example.com"');
            expect(result).toContain('text');
            expect(result).toContain('md-link');
        });

        it('renders strikethrough', () => {
            const result = applyInlineMarkdown('~~deleted~~');
            expect(result).toContain('<del>deleted</del>');
        });

        it('renders images with API-resolved paths', () => {
            const result = applyInlineMarkdown('![alt](./image.png)', '/api');
            expect(result).toContain('md-image-preview');
            expect(result).toContain('/api/review/images/');
        });

        it('preserves absolute URLs in images', () => {
            const result = applyInlineMarkdown('![alt](https://example.com/img.png)');
            expect(result).toContain('src="https://example.com/img.png"');
        });

        it('returns empty string for empty input', () => {
            expect(applyInlineMarkdown('')).toBe('');
        });
    });

    describe('applyMarkdownHighlighting', () => {
        it('renders headings with proper HTML tags', () => {
            const result = applyMarkdownHighlighting('# Title', 1, false, null);
            expect(result.html).toContain('<h1');
            expect(result.html).toContain('Title');
            expect(result.html).toContain('</h1>');
            expect(result.anchorId).toBe('title');
        });

        it('renders h2-h6 headings', () => {
            const h2 = applyMarkdownHighlighting('## Subtitle', 1, false, null);
            expect(h2.html).toContain('<h2');

            const h3 = applyMarkdownHighlighting('### H3', 1, false, null);
            expect(h3.html).toContain('<h3');
        });

        it('renders blockquotes', () => {
            const result = applyMarkdownHighlighting('> quoted text', 1, false, null);
            expect(result.html).toContain('<blockquote');
            expect(result.html).toContain('quoted text');
        });

        it('renders unordered list items', () => {
            const result = applyMarkdownHighlighting('- item one', 1, false, null);
            expect(result.html).toContain('<li');
            expect(result.html).toContain('item one');
        });

        it('renders ordered list items', () => {
            const result = applyMarkdownHighlighting('1. first item', 1, false, null);
            expect(result.html).toContain('<li');
            expect(result.html).toContain('first item');
        });

        it('renders horizontal rules', () => {
            const result = applyMarkdownHighlighting('---', 1, false, null);
            expect(result.html).toContain('<hr');
        });

        it('detects code fence start', () => {
            const result = applyMarkdownHighlighting('```typescript', 1, false, null);
            expect(result.isCodeFenceStart).toBe(true);
            expect(result.inCodeBlock).toBe(true);
            expect(result.codeBlockLang).toBe('typescript');
        });

        it('detects code fence end', () => {
            const result = applyMarkdownHighlighting('```', 1, true, 'typescript');
            expect(result.isCodeFenceEnd).toBe(true);
            expect(result.inCodeBlock).toBe(false);
        });

        it('escapes HTML inside code blocks', () => {
            const result = applyMarkdownHighlighting('<div>hello</div>', 1, true, 'html');
            expect(result.html).toContain('&lt;div&gt;');
            expect(result.inCodeBlock).toBe(true);
        });

        it('renders checkboxes in list items', () => {
            const checked = applyMarkdownHighlighting('- [x] done', 1, false, null);
            expect(checked.html).toContain('checkbox');
            expect(checked.html).toContain('checked');

            const unchecked = applyMarkdownHighlighting('- [ ] todo', 1, false, null);
            expect(unchecked.html).toContain('checkbox');
        });

        it('renders regular text with inline markdown', () => {
            const result = applyMarkdownHighlighting('Hello **world**', 1, false, null);
            expect(result.html).toContain('<strong>world</strong>');
        });
    });

    describe('renderMarkdownContent', () => {
        it('renders a full document with mixed content', () => {
            const content = '# Title\n\nSome **bold** text.\n\n- item 1\n- item 2\n';
            const html = renderMarkdownContent(content);

            expect(html).toContain('<h1');
            expect(html).toContain('Title');
            expect(html).toContain('<strong>bold</strong>');
            expect(html).toContain('<li');
            expect(html).toContain('item 1');
        });

        it('renders code blocks with language label', () => {
            const content = '```javascript\nconst x = 1;\n```\n';
            const html = renderMarkdownContent(content);

            expect(html).toContain('review-code-block');
            expect(html).toContain('language-javascript');
            expect(html).toContain('const x = 1;');
            expect(html).toContain('review-code-lang');
        });

        it('wraps lines in review-line divs', () => {
            const content = 'line one\nline two\n';
            const html = renderMarkdownContent(content);

            expect(html).toContain('class="review-line"');
            expect(html).toContain('data-line="1"');
            expect(html).toContain('data-line="2"');
        });

        it('handles empty lines with <br>', () => {
            const content = 'text\n\nmore text';
            const html = renderMarkdownContent(content);

            expect(html).toContain('<br>');
        });

        it('handles CRLF line endings', () => {
            const content = 'line one\r\nline two\r\n';
            const html = renderMarkdownContent(content);

            expect(html).toContain('data-line="1"');
            expect(html).toContain('data-line="2"');
        });

        it('handles unclosed code blocks', () => {
            const content = '```python\nprint("hello")\n';
            const html = renderMarkdownContent(content);

            expect(html).toContain('review-code-block');
            expect(html).toContain('print');
        });
    });

    describe('renderSourceContent', () => {
        it('renders lines with line numbers', () => {
            const content = 'first\nsecond\nthird';
            const html = renderSourceContent(content);

            expect(html).toContain('review-line-number');
            expect(html).toContain('source-mode');
            expect(html).toContain('>1<');
            expect(html).toContain('>2<');
            expect(html).toContain('>3<');
        });

        it('renders empty lines with <br>', () => {
            const content = 'line\n\nline';
            const html = renderSourceContent(content);

            expect(html).toContain('<br>');
        });
    });

    describe('applySourceModeHighlighting', () => {
        it('detects code fences', () => {
            const result = applySourceModeHighlighting('```', false);
            expect(result.inCodeBlock).toBe(true);
            expect(result.html).toContain('src-code-fence');
        });

        it('escapes code block content', () => {
            const result = applySourceModeHighlighting('<div>', true);
            expect(result.html).toContain('&lt;div&gt;');
            expect(result.inCodeBlock).toBe(true);
        });

        it('highlights headings', () => {
            const result = applySourceModeHighlighting('## Heading', false);
            expect(result.html).toContain('src-h2');
        });

        it('highlights horizontal rules', () => {
            const result = applySourceModeHighlighting('---', false);
            expect(result.html).toContain('src-hr');
        });
    });
});
