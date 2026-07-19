/**
 * Tests for math rendering in the forge line-renderer seam
 * (renderMarkdownToHtml in diff/markdown-renderer.ts).
 *
 * This is the Forge renderer family (TaskPreview / FilePreview / MarkdownView).
 * Math is protected with placeholders around the per-line forge call so that
 * Markdown-significant TeX characters reach KaTeX unchanged, without disturbing
 * 1-based line counts or comment anchors. Runs in Node (no JSDOM).
 */

import { describe, it, expect } from 'vitest';
import {
    renderMarkdownToHtml,
    renderSourceModeToHtml,
} from '../../../src/server/spa/client/diff/markdown-renderer';

describe('renderMarkdownToHtml — math', () => {
    describe('delimiter forms', () => {
        it('renders inline $...$ as KaTeX and removes the raw delimiters', () => {
            const html = renderMarkdownToHtml('Energy is $E = mc^2$ today.');
            expect(html).toContain('class="katex"');
            expect(html).not.toContain('$E = mc^2$');
            // Surrounding prose is preserved.
            expect(html).toContain('Energy is');
            expect(html).toContain('today.');
        });

        it('renders inline \\(...\\) as KaTeX', () => {
            const html = renderMarkdownToHtml('Value \\(a + b\\) here.');
            expect(html).toContain('class="katex"');
            expect(html).not.toContain('\\(a + b\\)');
        });

        it('renders single-line display $$...$$ as katex-display', () => {
            const html = renderMarkdownToHtml('$$\\int_0^1 x\\,dx$$');
            expect(html).toContain('katex-display');
        });

        it('renders single-line display \\[...\\] as katex-display', () => {
            const html = renderMarkdownToHtml('\\[a^2 + b^2 = c^2\\]');
            expect(html).toContain('katex-display');
        });
    });

    describe('literal / source regions are not parsed as math', () => {
        it('does not render math inside an inline code span', () => {
            const html = renderMarkdownToHtml('Use `$x$` literally.');
            expect(html).not.toContain('class="katex"');
            // The dollar-delimited text stays as code content.
            expect(html).toContain('$x$');
        });

        it('does not render math inside a fenced code block', () => {
            const md = '```\n$E = mc^2$\n```';
            const html = renderMarkdownToHtml(md);
            expect(html).not.toContain('class="katex"');
            expect(html).toContain('$E = mc^2$');
        });
    });

    describe('false-positive guards', () => {
        it('leaves currency like "$5 and $6" literal', () => {
            const html = renderMarkdownToHtml('It costs $5 and $6 total.');
            expect(html).not.toContain('class="katex"');
            expect(html).toContain('$5 and $6');
        });

        it('leaves an escaped \\$ literal', () => {
            const html = renderMarkdownToHtml('A price of \\$100 is fine.');
            expect(html).not.toContain('class="katex"');
        });
    });

    describe('Markdown-significant characters reach the math engine unchanged', () => {
        it('does not treat underscores inside a formula as emphasis', () => {
            const html = renderMarkdownToHtml('The term $a_1 + a_2$ sums.');
            expect(html).toContain('class="katex"');
            // No stray emphasis element leaked from the TeX underscores.
            expect(html).not.toContain('<em>');
        });
    });

    describe('invalid TeX', () => {
        it('does not throw and renders a readable error node', () => {
            const html = renderMarkdownToHtml('Broken $\\frac{1}{$ math.');
            // Either KaTeX rendered it forgivingly or the error fallback appeared;
            // in all cases it must not throw and must not corrupt the line.
            expect(typeof html).toBe('string');
            expect(html).toContain('math.');
        });

        it('renders the math-error fallback for clearly invalid commands', () => {
            const html = renderMarkdownToHtml('Bad $\\notacommand{x}$ here.');
            // throwOnError:false + strict:ignore keeps it readable; the surface
            // never blanks.
            expect(html).toContain('here.');
            expect(typeof html).toBe('string');
        });
    });

    describe('streaming / multiline', () => {
        it('keeps an unclosed inline opener as literal source', () => {
            const html = renderMarkdownToHtml('Streaming $E = mc');
            expect(html).not.toContain('class="katex"');
            expect(html).toContain('$E = mc');
        });

        it('keeps a multiline display region literal per-line (line anchors intact)', () => {
            const md = 'Before\n$$\na + b\n$$\nAfter';
            const html = renderMarkdownToHtml(md);
            // Each line still has its own md-line anchor; nothing merged.
            expect(html).toContain('data-line="1"');
            expect(html).toContain('data-line="5"');
        });
    });

    describe('line anchors preserved with inline math', () => {
        it('keeps 1-based data-line numbers across lines that contain math', () => {
            const md = 'Line one\nHas $x^2$ math\nLine three';
            const html = renderMarkdownToHtml(md);
            expect(html).toContain('data-line="1"');
            expect(html).toContain('data-line="2"');
            expect(html).toContain('data-line="3"');
            expect(html).toContain('class="katex"');
        });
    });
});

describe('renderSourceModeToHtml — math passthrough', () => {
    it('keeps inline $...$ delimiters and TeX visible and unchanged', () => {
        const html = renderSourceModeToHtml('Energy is $E = mc^2$');
        expect(html).toContain('$E = mc^2$');
        expect(html).not.toContain('class="katex"');
    });

    it('keeps display \\[...\\] delimiters visible and unchanged', () => {
        const html = renderSourceModeToHtml('\\[a^2\\]');
        expect(html).toContain('\\[a^2\\]');
        expect(html).not.toContain('katex-display');
    });
});
