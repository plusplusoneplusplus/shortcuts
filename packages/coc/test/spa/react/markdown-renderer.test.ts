/**
 * Tests for renderSourceModeToHtml in markdown-renderer.ts
 *
 * Verifies the source-mode HTML renderer that converts raw markdown into a
 * line-numbered, syntax-highlighted source view. Tests run in Node (no JSDOM).
 */

import { describe, it, expect } from 'vitest';
import { renderSourceModeToHtml } from '../../../src/server/spa/client/markdown-renderer';

describe('renderSourceModeToHtml', () => {
    // ----------------------------------------------------------------
    // Guard / empty input
    // ----------------------------------------------------------------
    describe('empty input', () => {
        it('returns empty string for empty input', () => {
            expect(renderSourceModeToHtml('')).toBe('');
        });
    });

    // ----------------------------------------------------------------
    // Outer container
    // ----------------------------------------------------------------
    describe('outer container', () => {
        it('wraps non-empty input in source-mode-body div', () => {
            const html = renderSourceModeToHtml('Hello');
            expect(html.startsWith('<div class="source-mode-body">')).toBe(true);
            expect(html.endsWith('</div>')).toBe(true);
        });
    });

    // ----------------------------------------------------------------
    // Line number spans
    // ----------------------------------------------------------------
    describe('line numbering', () => {
        it('produces data-line attributes and line-number spans for a two-line input', () => {
            const html = renderSourceModeToHtml('first\nsecond');
            expect(html).toContain('data-line="1"');
            expect(html).toContain('data-line="2"');
            expect(html).toContain('<span class="line-number">1</span>');
            expect(html).toContain('<span class="line-number">2</span>');
        });
    });

    // ----------------------------------------------------------------
    // Plain text line
    // ----------------------------------------------------------------
    describe('plain text line', () => {
        it('renders plain text inside line-content span with no src-* class', () => {
            const html = renderSourceModeToHtml('Hello world');
            expect(html).toContain('<span class="line-content">Hello world</span>');
            expect(html).not.toContain('src-');
        });
    });

    // ----------------------------------------------------------------
    // Headings
    // ----------------------------------------------------------------
    describe('H1 heading', () => {
        it('applies src-h1 and src-hash classes to a heading line', () => {
            const html = renderSourceModeToHtml('# Title');
            expect(html).toContain('src-h1');
            expect(html).toContain('src-hash');
        });
    });

    // ----------------------------------------------------------------
    // Inline formatting
    // ----------------------------------------------------------------
    describe('bold inline', () => {
        it('applies src-bold class to bold text', () => {
            const html = renderSourceModeToHtml('**bold text**');
            expect(html).toContain('src-bold');
        });
    });

    describe('inline code', () => {
        it('applies src-inline-code class to backtick code', () => {
            const html = renderSourceModeToHtml('`code`');
            expect(html).toContain('src-inline-code');
        });
    });

    // ----------------------------------------------------------------
    // Code fences
    // ----------------------------------------------------------------
    describe('code fence', () => {
        it('applies src-code-fence class to the opening fence line', () => {
            const html = renderSourceModeToHtml('```');
            expect(html).toContain('src-code-fence');
        });

        it('does not apply src-* markdown classes to lines inside a code fence', () => {
            // '# not-a-heading' inside a fence must not produce src-h1
            const html = renderSourceModeToHtml('```\n# not-a-heading\n```');
            expect(html).not.toContain('src-h1');
            // The raw text must still appear (HTML-escaped, no highlighting)
            expect(html).toContain('# not-a-heading');
        });

        it('produces the correct number of source-line divs for a fenced block', () => {
            const html = renderSourceModeToHtml('```\nsome code\n```');
            const lineCount = (html.match(/class="source-line"/g) ?? []).length;
            expect(lineCount).toBe(3);
        });

        it('resumes markdown highlighting after the closing fence', () => {
            const html = renderSourceModeToHtml('```\ncode\n```\n# Heading');
            // Line 4 is after the fence — it should receive src-h1
            expect(html).toContain('data-line="4"');
            expect(html).toContain('src-h1');
        });
    });

    // ----------------------------------------------------------------
    // Multi-line end-to-end
    // ----------------------------------------------------------------
    describe('multi-line end-to-end', () => {
        it('produces three source-line divs with correct data-line numbers and src-* classes', () => {
            const html = renderSourceModeToHtml('# H1\nplain\n**bold**');
            expect(html).toContain('data-line="1"');
            expect(html).toContain('data-line="2"');
            expect(html).toContain('data-line="3"');
            // Line 1 must have a heading class
            expect(html).toContain('src-h1');
            // Line 3 must have a bold class
            expect(html).toContain('src-bold');
        });
    });

    // ----------------------------------------------------------------
    // Windows CRLF normalization
    // ----------------------------------------------------------------
    describe('CRLF normalization', () => {
        it('produces exactly two source-line divs for CRLF-separated input', () => {
            const html = renderSourceModeToHtml('line1\r\nline2');
            const lineCount = (html.match(/class="source-line"/g) ?? []).length;
            expect(lineCount).toBe(2);
        });
    });

    // ----------------------------------------------------------------
    // Empty line rendering
    // ----------------------------------------------------------------
    describe('empty line rendering', () => {
        it('renders blank lines as <br> inside the line-content span', () => {
            const html = renderSourceModeToHtml('a\n\nb');
            expect(html).toContain('<span class="line-content"><br></span>');
        });
    });
});
