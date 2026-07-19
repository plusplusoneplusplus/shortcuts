// @vitest-environment jsdom
/**
 * AC-02 — rich-editor formula conversion.
 *
 * Verifies that noteMarkdown's Source↔Rich conversion turns the four TeX
 * delimiter forms into editable formula placeholders and serializes them back
 * to the original delimited source byte-for-byte, without ever persisting
 * rendered KaTeX/MathML into the Markdown.
 */
import { describe, it, expect } from 'vitest';
import {
    markdownToHtml,
    htmlToMarkdown,
} from '../../../../src/server/spa/client/react/features/notes/editor/noteMarkdown';

function roundTrip(md: string): string {
    return htmlToMarkdown(markdownToHtml(md));
}

/** Trim + normalize line endings for comparison. */
function norm(s: string): string {
    return s.replace(/\r\n/g, '\n').trim();
}

describe('noteMarkdown — math formula nodes (AC-02)', () => {
    // ── markdownToHtml → editable placeholder markup ────────────────────────

    describe('markdownToHtml emits editable formula placeholders', () => {
        it('inline $...$', () => {
            const html = markdownToHtml('mass energy $E=mc^2$ done');
            expect(html).toContain('data-math="inline"');
            expect(html).toContain('data-tex="E=mc^2"');
            expect(html).toContain('data-delim="dollar"');
            // No rendered KaTeX markup is emitted for the editor path.
            expect(html).not.toContain('class="katex"');
        });

        it('inline \\(...\\)', () => {
            const html = markdownToHtml('area \\(\\pi r^2\\) end');
            expect(html).toContain('data-math="inline"');
            expect(html).toContain('data-delim="paren"');
            expect(html).toContain('data-tex="\\pi r^2"');
        });

        it('display $$...$$', () => {
            const html = markdownToHtml('$$\\int_0^1 x\\,dx$$');
            expect(html).toContain('data-math="display"');
            expect(html).toContain('data-delim="double-dollar"');
        });

        it('display \\[...\\]', () => {
            const html = markdownToHtml('\\[a^2 + b^2 = c^2\\]');
            expect(html).toContain('data-math="display"');
            expect(html).toContain('data-delim="bracket"');
        });

        it('multiple formulas in one paragraph', () => {
            const html = markdownToHtml('$a$ and $b$ and $c$');
            expect((html.match(/data-math="inline"/g) ?? []).length).toBe(3);
        });

        it('does not parse math inside inline code', () => {
            const html = markdownToHtml('use `$x$` literally');
            expect(html).not.toContain('data-math=');
            expect(html).toContain('<code>$x$</code>');
        });

        it('does not parse math inside fenced code', () => {
            const html = markdownToHtml('```\n$x=1$\n```');
            expect(html).not.toContain('data-math=');
        });

        it('leaves currency literal', () => {
            const html = markdownToHtml('It costs $5 and $6 today');
            expect(html).not.toContain('data-math=');
        });
    });

    // ── byte-for-byte round trips ───────────────────────────────────────────

    describe('lossless round trip (markdown → html → markdown)', () => {
        it('inline $...$', () => {
            expect(norm(roundTrip('$E=mc^2$'))).toBe('$E=mc^2$');
        });

        it('inline \\(...\\)', () => {
            expect(norm(roundTrip('\\(\\pi r^2\\)'))).toBe('\\(\\pi r^2\\)');
        });

        it('display $$...$$', () => {
            expect(norm(roundTrip('$$\\int_0^1 x\\,dx$$'))).toBe('$$\\int_0^1 x\\,dx$$');
        });

        it('display \\[...\\]', () => {
            expect(norm(roundTrip('\\[a^2 + b^2 = c^2\\]'))).toBe('\\[a^2 + b^2 = c^2\\]');
        });

        it('preserves the exact inner TeX including markdown-significant chars', () => {
            // Underscores/backslashes must not be consumed as emphasis or escapes.
            const md = '$a_1 + b_2 \\cdot c$';
            expect(norm(roundTrip(md))).toBe(md);
        });

        it('inline formula amid prose and punctuation', () => {
            const md = 'The value $x^2$, when squared, grows.';
            expect(norm(roundTrip(md))).toBe(md);
        });

        it('multiple inline formulas in one paragraph', () => {
            const md = 'Both $a$ and $b$ hold.';
            expect(norm(roundTrip(md))).toBe(md);
        });

        it('formula adjacent to bold text', () => {
            const md = '**bold** $x=1$ text';
            const rt = norm(roundTrip(md));
            expect(rt).toContain('**bold**');
            expect(rt).toContain('$x=1$');
        });

        it('multiline display math', () => {
            const md = '$$\n\\begin{aligned}\na &= b \\\\\nc &= d\n\\end{aligned}\n$$';
            const rt = norm(roundTrip(md));
            expect(rt).toContain('\\begin{aligned}');
            expect(rt).toContain('a &= b');
            expect(rt).toContain('$$');
        });

        it('invalid TeX still round-trips its source', () => {
            const md = '$\\frac{1}{$';
            // The renderer never throws; conversion preserves the source.
            expect(norm(roundTrip(md))).toBe('$\\frac{1}{$');
        });
    });

    // ── edited serialization ────────────────────────────────────────────────

    describe('edited serialization', () => {
        it('re-serializes an edited formula with its original delimiter', () => {
            // Simulate the NodeView applying an edit: data-tex changes, delimiter
            // is preserved on the element.
            const editedHtml =
                '<p><span data-math="inline" data-tex="E=mc^3" data-delim="dollar">E=mc^3</span></p>';
            expect(norm(htmlToMarkdown(editedHtml))).toBe('$E=mc^3$');
        });

        it('display node serializes with double-dollar delimiter', () => {
            const html =
                '<div data-math="display" data-tex="x^2" data-delim="double-dollar">x^2</div>';
            expect(norm(htmlToMarkdown(html))).toBe('$$x^2$$');
        });

        it('paren delimiter is preserved on serialize', () => {
            const html =
                '<p><span data-math="inline" data-tex="y" data-delim="paren">y</span></p>';
            expect(norm(htmlToMarkdown(html))).toBe('\\(y\\)');
        });

        it('bracket delimiter is preserved on serialize', () => {
            const html =
                '<div data-math="display" data-tex="z" data-delim="bracket">z</div>';
            expect(norm(htmlToMarkdown(html))).toBe('\\[z\\]');
        });
    });

    // ── no rendered markup persisted ────────────────────────────────────────

    describe('no KaTeX/MathML persisted (code-search style assertion)', () => {
        it('htmlToMarkdown output never contains KaTeX/MathML markup', () => {
            const md = '$E=mc^2$ and $$\\int x$$ and \\(a\\) and \\[b\\]';
            const html = markdownToHtml(md);
            const back = htmlToMarkdown(html);
            expect(back).not.toContain('katex');
            expect(back).not.toContain('<math');
            expect(back).not.toContain('MathML');
            expect(back).not.toContain('mathml');
        });

        it('formula survives a second save/reload cycle (idempotent)', () => {
            const md = '$E=mc^2$';
            const once = roundTrip(md);
            const twice = roundTrip(norm(once));
            expect(norm(once)).toBe(norm(twice));
        });
    });
});
