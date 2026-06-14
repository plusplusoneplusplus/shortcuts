/**
 * Tests for SourceCanvasBody — AC-04 content rendering.
 *
 * Covers:
 * - `.md`/`.markdown` → formatted markdown with a working Rendered ⇄ Raw toggle
 * - markdown detection via the server `language` hint (extension-agnostic)
 * - source files → syntax-highlighted lines with a line-number gutter + data-line
 * - unknown extensions → plain (un-highlighted) but still gutter'd lines
 */
/* @vitest-environment jsdom */

import { describe, it, expect } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import { SourceCanvasBody } from '../../../src/server/spa/client/react/features/chat/source-canvas/SourceCanvasBody';

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
});
