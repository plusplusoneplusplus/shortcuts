/**
 * Layer A — pure serializer tests (Node env, no DOM).
 *
 * Verifies the standalone-document scaffold, image inlining, the portability
 * contract (no external/proxy/local-path references), source round-trip
 * safety, code highlighting, XSS escaping, and determinism.
 */

import { describe, it, expect } from 'vitest';
import { buildCanvasHtmlDocument } from '../../../../../src/server/spa/client/react/features/canvas/html-export/buildCanvasHtmlDocument';
import { BROKEN_IMAGE_PLACEHOLDER } from '../../../../../src/server/spa/client/react/features/canvas/html-export/styles';
import type { BuildCanvasHtmlDocumentInput } from '../../../../../src/server/spa/client/react/features/canvas/html-export/types';

function build(overrides: Partial<BuildCanvasHtmlDocumentInput>): string {
    const input: BuildCanvasHtmlDocumentInput = {
        type: 'markdown',
        title: 'My Canvas',
        bodyHtml: '<p>hello</p>',
        sourceText: '# hello',
        ...overrides,
    };
    return buildCanvasHtmlDocument(input).html;
}

describe('buildCanvasHtmlDocument — standalone document scaffold', () => {
    it('produces a valid standalone document with doctype, charset, viewport, and title', () => {
        const html = build({ title: 'Report' });
        expect(html.startsWith('<!doctype html>')).toBe(true);
        expect(html).toContain('<meta charset="utf-8">');
        expect(html).toContain('<meta name="viewport" content="width=device-width, initial-scale=1">');
        expect(html).toContain('<title>Report</title>');
        expect(html).toContain('<h1 class="canvas-export__title">Report</h1>');
    });

    it('embeds base CSS and the highlight.js theme inline with no external references', () => {
        const html = build({});
        expect(html).toContain('<style>');
        expect(html).toContain('.canvas-export');
        expect(html).toContain('.hljs');
        // No external stylesheet or script.
        expect(html).not.toMatch(/<link\b/i);
        expect(html).not.toMatch(/<script\s+src/i);
        expect(html).not.toMatch(/rel=["']?stylesheet/i);
    });

    it('falls back to a placeholder title when the title is blank', () => {
        const html = build({ title: '   ' });
        expect(html).toContain('<title>Untitled canvas</title>');
    });
});

describe('buildCanvasHtmlDocument — embedded math (KaTeX) CSS', () => {
    const MATH_CSS =
        '.katex{font:normal 1.21em KaTeX_Main}\n' +
        '@font-face{font-family:KaTeX_Main;src:url(data:font/woff2;base64,AAAA)}';

    it('embeds the supplied math CSS inline in the <style> block', () => {
        const html = build({
            bodyHtml: '<p><span class="katex">E=mc^2</span></p>',
            mathCss: MATH_CSS,
        });
        expect(html).toContain('.katex{font:normal 1.21em KaTeX_Main}');
        expect(html).toContain('@font-face{font-family:KaTeX_Main;src:url(data:font/woff2;base64,AAAA)}');
        // Base CSS is still present alongside it.
        expect(html).toContain('.canvas-export');
    });

    it('adds the narrow-page overflow override only when math CSS is present', () => {
        const withMath = build({ mathCss: MATH_CSS });
        expect(withMath).toContain('.canvas-export__body .katex-display { overflow-x: auto');

        const withoutMath = build({});
        expect(withoutMath).not.toContain('.canvas-export__body .katex-display');
    });

    it('keeps the portability contract — inlined fonts, no external references', () => {
        const html = build({
            bodyHtml: '<span class="katex">x</span>',
            mathCss: MATH_CSS,
        });
        expect(html).toContain('data:font/woff2;base64,');
        expect(html).not.toMatch(/url\(https?:\/\//i);
        expect(html).not.toMatch(/<link\b/i);
        expect(html).not.toMatch(/<script\s+src/i);
    });

    it('ignores blank/whitespace math CSS (no change vs. omitting it)', () => {
        const blank = build({ mathCss: '   ' });
        const omitted = build({});
        expect(blank).toBe(omitted);
    });
});

describe('buildCanvasHtmlDocument — image inlining', () => {
    it('rewrites a proxy-url <img> src to the resolved data URI from the assets map', () => {
        const ref = '/api/workspaces/ws1/files/image?path=x';
        const dataUri = 'data:image/png;base64,AAAA';
        const html = build({
            bodyHtml: `<img src="${ref}" alt="pic">`,
            assets: new Map([[ref, dataUri]]),
        });
        expect(html).toContain(`src="${dataUri}"`);
        expect(html).toContain('alt="pic"');
        expect(html).not.toContain(ref);
    });

    it('resolves an image by its data-local-path when the src is not a map key', () => {
        const localPath = '.attachments/abc.png';
        const dataUri = 'data:image/png;base64,BBBB';
        const html = build({
            bodyHtml: `<img src="/proxy/thing" data-local-path="${localPath}">`,
            assets: new Map([[localPath, dataUri]]),
        });
        expect(html).toContain(`src="${dataUri}"`);
        expect(html).not.toContain('data-local-path');
        expect(html).not.toContain('.attachments/');
    });

    it('leaves an already-inlined data: URI intact', () => {
        const dataUri = 'data:image/png;base64,ZZZZ';
        const html = build({ bodyHtml: `<img src="${dataUri}">` });
        expect(html).toContain(`src="${dataUri}"`);
    });

    it('replaces an unresolved reference with the broken-image placeholder, never a live proxy URL', () => {
        const html = build({
            bodyHtml: '<img src="/api/workspaces/ws1/files/image?path=/home/u/a.png" data-local-path="/home/u/a.png">',
            assets: new Map(),
        });
        expect(html).toContain(BROKEN_IMAGE_PLACEHOLDER);
        expect(html).toContain('canvas-export__broken-image');
        expect(html).not.toContain('/api/workspaces');
        expect(html).not.toContain('/home/u/a.png');
    });

    it('collects a warning for each unresolved image reference', () => {
        const result = buildCanvasHtmlDocument({
            type: 'markdown',
            title: 't',
            bodyHtml: '<img src="/proxy/missing">',
            sourceText: '',
            assets: new Map(),
        });
        expect(result.warnings.length).toBe(1);
        expect(result.warnings[0]).toMatch(/Unresolved image/i);
    });
});

describe('buildCanvasHtmlDocument — portability contract (path-leak guard)', () => {
    it('emits no proxy URL, .attachments path, or absolute local path for unresolved images', () => {
        const html = build({
            bodyHtml:
                '<p>see <img src="/api/workspaces/ws1/files/image?path=/home/user/pic.png" data-local-path="/home/user/pic.png"></p>',
            assets: new Map(),
        });
        expect(html).not.toContain('/api/');
        expect(html).not.toContain('.attachments/');
        expect(html).not.toContain('/home/user');
        expect(html).not.toMatch(/[A-Z]:\\/); // Windows absolute path
    });
});

describe('buildCanvasHtmlDocument — embedded source round-trip', () => {
    it('embeds the original source in a non-rendering script tag', () => {
        const html = build({ type: 'markdown', sourceText: '# Title\n\nbody' });
        expect(html).toContain('<script type="text/markdown" id="source">');
        expect(html).toContain('# Title');
    });

    it('uses application/json for excalidraw scene sources', () => {
        const html = build({ type: 'excalidraw', bodyHtml: '<svg></svg>', sourceText: '{"type":"excalidraw"}' });
        expect(html).toContain('<script type="application/json" id="source">');
    });

    it('escapes a </script> inside the source so it cannot break out of the document', () => {
        const html = build({ sourceText: 'before </script><script>alert(1)</script> after' });
        // The injected closing/opening tags must be neutralized...
        expect(html).not.toContain('</script><script>alert(1)');
        expect(html).toContain('<\\/script');
        // ...leaving exactly one real closing </script> (the source block itself).
        expect(html.split('</script>').length - 1).toBe(1);
    });
});

describe('buildCanvasHtmlDocument — code canvas', () => {
    it('highlights a known language into <pre><code class="language-…"> with escaped HTML', () => {
        const result = buildCanvasHtmlDocument({
            type: 'code',
            title: 'snippet',
            sourceText: 'const x = 1; // <b>note</b>',
            language: 'javascript',
        });
        expect(result.html).toContain('<pre><code class="hljs language-javascript">');
        expect(result.html).toMatch(/hljs-/); // highlight tokens present
        expect(result.html).toContain('&lt;b&gt;'); // HTML inside code is escaped
        // The rendered body (everything before the verbatim source script) must
        // never contain the live tag — only the escaped form.
        const renderedBody = result.html.slice(0, result.html.indexOf('id="source"'));
        expect(renderedBody).not.toContain('<b>note</b>');
    });

    it('falls back to an escaped plain block for an unknown language', () => {
        const html = build({
            type: 'code',
            sourceText: '<script>evil()</script>',
            language: 'klingon',
        });
        expect(html).toContain('class="hljs language-klingon"');
        expect(html).toContain('&lt;script&gt;evil()&lt;/script&gt;');
        // The dangerous markup never appears as a live tag in the body.
        expect(html.split('</script>').length - 1).toBe(1);
    });
});

describe('buildCanvasHtmlDocument — XSS / escaping', () => {
    it('escapes a malicious title so it cannot break the document', () => {
        const html = build({ title: '<script>alert(1)</script> "&" <img>' });
        expect(html).toContain('<title>&lt;script&gt;alert(1)&lt;/script&gt; &quot;&amp;&quot; &lt;img&gt;</title>');
        expect(html).not.toContain('<title><script>');
    });
});

describe('buildCanvasHtmlDocument — determinism', () => {
    it('produces byte-identical output across two calls with the same input', () => {
        const input: BuildCanvasHtmlDocumentInput = {
            type: 'markdown',
            title: 'Deterministic',
            bodyHtml: '<p>x</p><img src="/proxy/a">',
            sourceText: '# x',
            assets: new Map([['/proxy/a', 'data:image/png;base64,AAAA']]),
        };
        const a = buildCanvasHtmlDocument(input).html;
        const b = buildCanvasHtmlDocument(input).html;
        expect(a).toBe(b);
    });
});
