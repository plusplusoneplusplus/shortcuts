/**
 * Layer E helper — `highlightMarkdownCodeBlocks` tests.
 *
 * Pure string transform over highlight.js (Node-safe), so no jsdom pragma. The
 * inputs cover bare pre elements and the chat renderer's attributed blocks with
 * copy controls. Covers: a known language gets baked
 * `hljs-` token spans + the `hljs` class; the escaped source is decoded before
 * highlighting and re-escaped in output; an unknown language / `mermaid` /
 * class-less block is left untouched; multiple blocks; and determinism.
 */

import { describe, it, expect } from 'vitest';
import { chatMarkdownToHtml } from '../../../../../src/server/spa/client/react/features/chat/conversation/markdownHtml';
import { highlightMarkdownCodeBlocks } from '../../../../../src/server/spa/client/react/features/canvas/html-export/codeHighlight';

/** A bare code block with HTML-escaped source. */
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

    it('preserves pre attributes while baking highlighting', () => {
        const pre = '<pre class="code-block-content" data-example="kept">';
        const out = highlightMarkdownCodeBlocks(`${pre}<code class="language-ts">const x = 1;</code></pre>`);
        expect(out).toContain(`${pre}<code class="hljs language-ts">`);
        expect(out).toMatch(/class="hljs-/);
    });

    it('highlights real Copy all blocks independently without changing their source or controls', () => {
        const input = chatMarkdownToHtml([
            'Prose before', '', '```ts', 'const items: Array<string> = ["&lt;"];', '```',
            '', 'Between blocks', '', '```python', 'if True:', '    print("hello")', '```',
        ].join('\n'));
        const out = highlightMarkdownCodeBlocks(input);
        expect(out).toContain('class="hljs language-ts"');
        expect(out).toContain('class="hljs language-python"');
        expect(out).toMatch(/class="hljs-/);
        // Everything outside code contents, including data-raw and Copy all,
        // stays byte-for-byte identical to the shared renderer's output.
        const withoutCode = (html: string) => html.replace(/<code[^>]*>[\s\S]*?<\/code>/g, '<code></code>');
        expect(withoutCode(out)).toBe(withoutCode(input));
        expect(out.match(/class="code-block-copy"/g)).toHaveLength(2);
        expect(out).toContain('&amp;lt;');
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
