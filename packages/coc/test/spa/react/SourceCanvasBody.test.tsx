/**
 * Tests for SourceCanvasBody — AC-04 content rendering + AC-05 line highlight.
 *
 * Covers:
 * - `.md`/`.markdown` → formatted markdown with a working Rendered ⇄ Raw toggle
 * - markdown detection via the server `language` hint (extension-agnostic)
 * - source files → syntax-highlighted lines with a line-number gutter + data-line
 * - unknown extensions → plain (un-highlighted) but still gutter'd lines
 * - AC-05: `:line` highlights + scrolls a row; `:start-end` highlights a range;
 *   no line opens at the top (no highlight, no scroll); out-of-range clamps;
 *   rendered markdown highlights the matching `.md-line` row
 */
/* @vitest-environment jsdom */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import { SourceCanvasBody } from '../../../src/server/spa/client/react/features/chat/source-canvas/SourceCanvasBody';

const HIGHLIGHT = 'source-canvas-line-highlight';

/** Build N source lines: "line 1\nline 2\n…\nline N\n". */
function makeLines(n: number): string {
    return Array.from({ length: n }, (_, i) => `line ${i + 1}`).join('\n') + '\n';
}

describe('SourceCanvasBody (AC-04)', () => {
    describe('markdown rendering', () => {
        it('renders a .md file as formatted markdown with a toggle to raw', () => {
            const md = '# Heading\n\nsome **bold** text\n';
            const { getByTestId, queryByTestId } = render(
                <SourceCanvasBody fileName="README.md" content={md} />,
            );

            // Default: rendered markdown (not raw source lines).
            const body = getByTestId('source-canvas-markdown');
            expect(body.classList.contains('markdown-body')).toBe(true);
            // renderMarkdownToHtml emits styled md-line/md-h1/md-bold spans.
            expect(body.querySelector('.md-h1')).not.toBeNull();
            expect(body.querySelector('.md-bold')).not.toBeNull();
            expect(queryByTestId('source-canvas-source')).toBeNull();

            // Toggle exists and starts in "show Raw" state.
            const toggle = getByTestId('source-canvas-md-toggle');
            expect(toggle.textContent).toBe('Raw');
            expect(toggle.getAttribute('aria-pressed')).toBe('false');

            // Toggle → raw source view shows the unrendered markdown lines.
            fireEvent.click(toggle);
            expect(queryByTestId('source-canvas-markdown')).toBeNull();
            const source = getByTestId('source-canvas-source');
            expect(source.textContent).toContain('# Heading');
            expect(toggle.textContent).toBe('Rendered');
            expect(toggle.getAttribute('aria-pressed')).toBe('true');

            // Toggle back → rendered markdown again.
            fireEvent.click(toggle);
            expect(getByTestId('source-canvas-markdown')).not.toBeNull();
            expect(queryByTestId('source-canvas-source')).toBeNull();
        });

        it('treats a non-.md file as markdown when the language hint says so', () => {
            const { getByTestId } = render(
                <SourceCanvasBody fileName="notes.txt" content={'# Hi\n'} language="markdown" />,
            );
            expect(getByTestId('source-canvas-markdown').querySelector('.md-h1')).not.toBeNull();
        });
    });

    describe('source rendering', () => {
        it('renders a .ts file as syntax-highlighted source with a line-number gutter', () => {
            const ts = 'const x = 1;\nfunction f() {\n  return x;\n}\n';
            const { getByTestId, queryByTestId } = render(
                <SourceCanvasBody fileName="app.ts" content={ts} />,
            );

            expect(queryByTestId('source-canvas-markdown')).toBeNull();
            const source = getByTestId('source-canvas-source');

            // One row per source line (trailing newline dropped → 4 lines).
            const lines = source.querySelectorAll('.source-canvas-line');
            expect(lines).toHaveLength(4);

            // Line-number gutter is 1..N.
            const numbers = Array.from(
                source.querySelectorAll('.source-canvas-line-number'),
            ).map((el) => el.textContent);
            expect(numbers).toEqual(['1', '2', '3', '4']);

            // data-line attributes track the 1-based line (for AC-05).
            expect(lines[0].getAttribute('data-line')).toBe('1');
            expect(lines[3].getAttribute('data-line')).toBe('4');

            // highlight.js applied → hljs spans + class on the content span.
            const firstContent = source.querySelector(
                '.source-canvas-line-content',
            ) as HTMLElement;
            expect(firstContent.classList.contains('hljs')).toBe(true);
            expect(firstContent.innerHTML).toContain('hljs-');
            expect(source.textContent).toContain('const x = 1;');
        });

        it('renders an unknown extension as plain gutter lines (no hljs)', () => {
            const { getByTestId } = render(
                <SourceCanvasBody fileName="data.unknownext" content={'alpha\nbeta\n'} />,
            );
            const source = getByTestId('source-canvas-source');
            expect(source.querySelectorAll('.source-canvas-line')).toHaveLength(2);
            const firstContent = source.querySelector(
                '.source-canvas-line-content',
            ) as HTMLElement;
            expect(firstContent.classList.contains('hljs')).toBe(false);
            expect(firstContent.innerHTML).not.toContain('hljs-');
            expect(source.textContent).toContain('alpha');
        });
    });

    describe('line highlight + scroll (AC-05)', () => {
        let scrollIntoView: ReturnType<typeof vi.fn>;

        beforeEach(() => {
            scrollIntoView = vi.fn();
            // jsdom does not implement scrollIntoView — stub it so the canvas
            // can call it and the test can assert the auto-scroll happened.
            (Element.prototype as unknown as { scrollIntoView: unknown }).scrollIntoView =
                scrollIntoView;
        });

        afterEach(() => {
            delete (Element.prototype as unknown as { scrollIntoView?: unknown }).scrollIntoView;
        });

        const rowsOf = (el: HTMLElement) =>
            Array.from(el.querySelectorAll('.source-canvas-line')) as HTMLElement[];

        it('highlights and scrolls to a single referenced line (foo.ts:42)', () => {
            const { getByTestId } = render(
                <SourceCanvasBody fileName="foo.ts" content={makeLines(50)} line={42} />,
            );
            const rows = rowsOf(getByTestId('source-canvas-source'));

            // Only line 42 is highlighted.
            expect(rows[41].classList.contains(HIGHLIGHT)).toBe(true);
            expect(rows[41].getAttribute('data-highlighted')).toBe('true');
            expect(rows[41].getAttribute('data-line')).toBe('42');
            expect(rows.filter((r) => r.classList.contains(HIGHLIGHT))).toHaveLength(1);
            expect(rows[0].classList.contains(HIGHLIGHT)).toBe(false);

            // The target row is scrolled into view.
            expect(scrollIntoView).toHaveBeenCalled();
        });

        it('highlights an inclusive range (foo.ts:42-44)', () => {
            const { getByTestId } = render(
                <SourceCanvasBody fileName="foo.ts" content={makeLines(50)} line={42} endLine={44} />,
            );
            const rows = rowsOf(getByTestId('source-canvas-source'));

            const highlighted = rows
                .filter((r) => r.classList.contains(HIGHLIGHT))
                .map((r) => r.getAttribute('data-line'));
            expect(highlighted).toEqual(['42', '43', '44']);
            expect(rows[40].classList.contains(HIGHLIGHT)).toBe(false); // line 41
            expect(rows[44].classList.contains(HIGHLIGHT)).toBe(false); // line 45
            expect(scrollIntoView).toHaveBeenCalled();
        });

        it('opens at the top with no highlight and no scroll when no line is given', () => {
            const { getByTestId } = render(
                <SourceCanvasBody fileName="foo.ts" content={makeLines(10)} />,
            );
            const rows = rowsOf(getByTestId('source-canvas-source'));
            expect(rows.some((r) => r.classList.contains(HIGHLIGHT))).toBe(false);
            expect(scrollIntoView).not.toHaveBeenCalled();
        });

        it('clamps an out-of-range line to the last line', () => {
            const { getByTestId } = render(
                <SourceCanvasBody fileName="foo.ts" content={makeLines(5)} line={99} />,
            );
            const rows = rowsOf(getByTestId('source-canvas-source'));
            const highlighted = rows
                .filter((r) => r.classList.contains(HIGHLIGHT))
                .map((r) => r.getAttribute('data-line'));
            expect(highlighted).toEqual(['5']);
        });

        it('highlights the matching .md-line row in rendered markdown', () => {
            const md = '# Title\n\nAlpha line\nBravo line\n';
            const { getByTestId } = render(
                <SourceCanvasBody fileName="notes.md" content={md} line={3} />,
            );
            const body = getByTestId('source-canvas-markdown');
            const row = body.querySelector('.md-line[data-line="3"]') as HTMLElement;
            expect(row).not.toBeNull();
            expect(row.classList.contains(HIGHLIGHT)).toBe(true);
            expect(row.textContent).toContain('Alpha line');
            // Other lines are not highlighted.
            const otherHighlighted = Array.from(
                body.querySelectorAll('.md-line'),
            ).filter((r) => r.classList.contains(HIGHLIGHT));
            expect(otherHighlighted).toHaveLength(1);
            expect(scrollIntoView).toHaveBeenCalled();
        });

        it('highlights the referenced line in the markdown raw view too', () => {
            const md = '# Title\n\nAlpha line\nBravo line\n';
            const { getByTestId } = render(
                <SourceCanvasBody fileName="notes.md" content={md} line={3} />,
            );
            // Toggle to raw source view.
            fireEvent.click(getByTestId('source-canvas-md-toggle'));
            const rows = rowsOf(getByTestId('source-canvas-source'));
            const highlighted = rows
                .filter((r) => r.classList.contains(HIGHLIGHT))
                .map((r) => r.getAttribute('data-line'));
            expect(highlighted).toEqual(['3']);
        });
    });
});
