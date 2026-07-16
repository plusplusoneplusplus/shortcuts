/**
 * Layer C — mermaid pre-render tests (node env; injected mock mermaid api).
 *
 * Covers both source formats (`.mermaid-container` from `chatMarkdownToHtml` and
 * a plain `language-mermaid` code block), inline-SVG replacement with the mermaid
 * runtime absent from the output, HTML-entity unescaping of the source before
 * rendering, deterministic block ids / output, and non-fatal render failure
 * (fallback to a source code block + warning, export still succeeds).
 */

import { describe, it, expect, vi } from 'vitest';
import {
    inlineMermaid,
    type MermaidRenderApi,
} from '../../../../../src/server/spa/client/react/features/canvas/html-export/mermaid';

/** HTML-escape like the renderers do, so tests build inputs the way the pipeline emits them. */
function escapeHtml(text: string): string {
    return text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

/** A `.mermaid-container` block exactly as forge `renderMermaidContainer` emits it. */
function container(code: string, id = 'chat-mermaid-1'): string {
    const lines = code.split('\n').length;
    return (
        `<div class="mermaid-container" data-start-line="1" data-end-line="${lines + 2}" data-mermaid-id="${id}">` +
        '<div class="mermaid-header">' +
        '<span class="mermaid-label">Mermaid Diagram</span>' +
        `<span class="mermaid-line-count">(${lines} line${lines !== 1 ? 's' : ''})</span>` +
        '</div>' +
        '<div class="mermaid-content">' +
        '<div class="mermaid-preview mermaid-loading">Loading diagram...</div>' +
        `<div class="mermaid-source" style="display: none;"><code>${escapeHtml(code)}</code></div>` +
        '</div>' +
        '</div>'
    );
}

/** A plain `language-mermaid` code block as bare `marked` emits it. */
function preBlock(code: string): string {
    return `<pre><code class="language-mermaid">${escapeHtml(code)}</code></pre>`;
}

/** A mock renderer that echoes the (raw) code and the id into a fake SVG. */
const echoApi: MermaidRenderApi = {
    render: (id, code) => ({ svg: `<svg data-id="${id}"><text>${code}</text></svg>` }),
};

describe('inlineMermaid — container format (chatMarkdownToHtml)', () => {
    it('replaces a .mermaid-container with the rendered inline <svg>', async () => {
        const html = `<p>before</p>${container('graph TD; A-->B')}<p>after</p>`;
        const { html: out, warnings } = await inlineMermaid(html, echoApi);
        expect(out).toContain('<div class="canvas-export__mermaid"><svg');
        expect(out).toContain('<text>graph TD; A-->B</text>'); // source unescaped before render
        expect(out).toContain('<p>before</p>');
        expect(out).toContain('<p>after</p>');
        expect(out).not.toContain('mermaid-container');
        expect(out).not.toContain('Loading diagram');
        expect(warnings).toEqual([]);
    });

    it('unescapes HTML entities in the source before handing it to the renderer', async () => {
        const seen: string[] = [];
        const api: MermaidRenderApi = {
            render: (_id, code) => {
                seen.push(code);
                return { svg: '<svg></svg>' };
            },
        };
        await inlineMermaid(container('graph LR; A["a & b"] --> B'), api);
        expect(seen).toEqual(['graph LR; A["a & b"] --> B']);
    });
});

describe('inlineMermaid — plain language-mermaid code block', () => {
    it('replaces a <pre><code class="language-mermaid"> block with inline <svg>', async () => {
        const { html: out } = await inlineMermaid(preBlock('sequenceDiagram\n A->>B: hi'), echoApi);
        expect(out).toContain('<div class="canvas-export__mermaid"><svg');
        expect(out).toContain('sequenceDiagram');
        expect(out).not.toMatch(/language-mermaid/);
    });
});

describe('inlineMermaid — no runtime shipped', () => {
    it('emits no mermaid runtime reference in the output', async () => {
        const svg = '<svg><g class="node"></g></svg>';
        const api: MermaidRenderApi = { render: () => ({ svg }) };
        const { html: out } = await inlineMermaid(container('graph TD; A-->B'), api);
        expect(out).not.toMatch(/mermaid(\.min)?\.js/i);
        expect(out).not.toMatch(/cdn\.jsdelivr/i);
        expect(out).not.toMatch(/<script/i);
    });
});

describe('inlineMermaid — multiple blocks', () => {
    it('renders every block in order with deterministic, unique ids', async () => {
        const html = `${container('graph TD; A-->B', 'chat-mermaid-1')}<hr>${preBlock('graph LR; C-->D')}`;
        const { html: out } = await inlineMermaid(html, echoApi);
        expect(out).toContain('data-id="canvas-export-mermaid-0"');
        expect(out).toContain('data-id="canvas-export-mermaid-1"');
        // Order preserved: first block's svg precedes the <hr> precedes the second.
        expect(out.indexOf('canvas-export-mermaid-0')).toBeLessThan(out.indexOf('<hr>'));
        expect(out.indexOf('<hr>')).toBeLessThan(out.indexOf('canvas-export-mermaid-1'));
    });
});

describe('inlineMermaid — failures never abort the export', () => {
    it('falls back to a source code block and warns when the renderer throws', async () => {
        const api: MermaidRenderApi = {
            render: () => {
                throw new Error('parse error');
            },
        };
        const { html: out, warnings } = await inlineMermaid(container('graph TD; A-->B'), api);
        expect(out).toContain('<pre class="canvas-export__mermaid-fallback"><code class="language-mermaid">');
        expect(out).toContain('graph TD; A--&gt;B'); // source preserved (escaped)
        expect(out).not.toContain('canvas-export__mermaid"><svg');
        expect(warnings).toHaveLength(1);
        expect(warnings[0]).toMatch(/parse error/);
    });

    it('falls back and warns when the renderer yields no SVG', async () => {
        const api: MermaidRenderApi = { render: () => ({ svg: '' }) };
        const { html: out, warnings } = await inlineMermaid(preBlock('graph TD; A-->B'), api);
        expect(out).toContain('canvas-export__mermaid-fallback');
        expect(warnings).toHaveLength(1);
        expect(warnings[0]).toMatch(/no SVG/i);
    });

    it('supports an async renderer (awaits the Promise)', async () => {
        const api: MermaidRenderApi = {
            render: async (id, code) => ({ svg: `<svg data-id="${id}">${code}</svg>` }),
        };
        const { html: out } = await inlineMermaid(container('graph TD; A-->B'), api);
        expect(out).toContain('data-id="canvas-export-mermaid-0"');
    });

    it('omits an empty mermaid block and warns, without calling the renderer', async () => {
        const render = vi.fn(() => ({ svg: '<svg></svg>' }));
        const { html: out, warnings } = await inlineMermaid(`<p>x</p>${preBlock('   ')}`, { render });
        expect(render).not.toHaveBeenCalled();
        expect(out).toBe('<p>x</p>');
        expect(warnings[0]).toMatch(/empty/i);
    });
});

describe('inlineMermaid — no-op cases', () => {
    it('returns html unchanged with no warnings when there are no mermaid blocks', async () => {
        const html = '<h1>Doc</h1><p>text</p><pre><code class="language-js">const x = 1;</code></pre>';
        const { html: out, warnings } = await inlineMermaid(html, echoApi);
        expect(out).toBe(html);
        expect(warnings).toEqual([]);
    });

    it('handles empty input', async () => {
        expect(await inlineMermaid('', echoApi)).toEqual({ html: '', warnings: [] });
    });
});

describe('inlineMermaid — determinism', () => {
    it('produces identical output across two calls with the same input', async () => {
        const html = `${container('graph TD; A-->B')}<hr>${preBlock('graph LR; C-->D')}`;
        const a = await inlineMermaid(html, echoApi);
        const b = await inlineMermaid(html, echoApi);
        expect(a.html).toBe(b.html);
    });
});
