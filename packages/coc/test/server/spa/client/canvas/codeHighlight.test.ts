/**
 * Layer E helper — `highlightMarkdownCodeBlocks` tests.
 *
 * Pure string transform over highlight.js (Node-safe), so no jsdom pragma. The
 * input mirrors what the chat markdown renderer emits: `<pre><code
 * class="language-X">ESCAPED</code></pre>`. Covers: a known language gets baked
 * `hljs-` token spans + the `hljs` class; the escaped source is decoded before
 * highlighting and re-escaped in output; an unknown language / `mermaid` /
 * class-less block is left untouched; multiple blocks; and determinism.
 */

import { describe, it, expect } from 'vitest';
import { highlightMarkdownCodeBlocks } from '../../../../../src/server/spa/client/react/features/canvas/html-export/codeHighlight';

/** A code block exactly as the chat markdown renderer emits it (source HTML-escaped). */
function block(lang: string, escapedSource: string): string {
    return `<pre><code class="language-${lang}">${escapedSource}</code></pre>`;
}

describe('highlightMarkdownCodeBlocks', () => {
    it('bakes highlight.js spans and the hljs class for a known language', () => {
        const out = highlightMarkdownCodeBlocks(block('javascript', 'const x = 1;'));
        expect(out).toContain('<pre><code class="hljs language-javascript">');
        expect(out).toMatch(/hljs-/); // token spans present
        expect(out).toContain('</code></pre>');
    });

    it('decodes the escaped source before highlighting and re-escapes in output', () => {
        // Rendered source escapes `<`/`>`/`&`; highlighting must operate on the
        // decoded text and the output must not reintroduce a raw `<` from the code.
        const out = highlightMarkdownCodeBlocks(
            block('typescript', 'const a: Array&lt;number&gt; = [];'),
        );
        expect(out).toContain('hljs language-typescript');
        // The generic angle brackets survive as escaped entities (no raw tag
        // injected from the code content, even though hljs may wrap `number`).
        expect(out).toContain('&lt;');
        expect(out).toContain('&gt;');
        expect(out).not.toContain('<number>');
    });

    it('leaves an unknown language block untouched', () => {
        const input = block('klingon', 'nuqneH');
        expect(highlightMarkdownCodeBlocks(input)).toBe(input);
    });

    it('leaves a mermaid code block untouched (Layer C owns those)', () => {
        const input = block('mermaid', 'graph TD; A--&gt;B');
        expect(highlightMarkdownCodeBlocks(input)).toBe(input);
    });

    it('leaves a class-less code block untouched', () => {
        const input = '<pre><code>plain text</code></pre>';
        expect(highlightMarkdownCodeBlocks(input)).toBe(input);
    });

    it('bakes every code block in a document', () => {
        const html =
            '<p>intro</p>' +
            block('javascript', 'let a = 1;') +
            '<p>mid</p>' +
            block('python', 'x = 2');
        const out = highlightMarkdownCodeBlocks(html);
        expect(out).toContain('hljs language-javascript');
        expect(out).toContain('hljs language-python');
        expect(out).toContain('<p>intro</p>');
        expect(out).toContain('<p>mid</p>');
    });

    it('is deterministic (same input → identical output)', () => {
        const input = block('javascript', 'const x = 1;');
        expect(highlightMarkdownCodeBlocks(input)).toBe(highlightMarkdownCodeBlocks(input));
    });

    it('returns empty input unchanged', () => {
        expect(highlightMarkdownCodeBlocks('')).toBe('');
    });
});
