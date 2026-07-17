/**
 * @vitest-environment jsdom
 *
 * Layer E — `exportCanvasAsHtml` orchestrator tests (jsdom for the FileReader /
 * Blob used by asset resolution and for the DOM download). Every browser-only
 * dependency (markdown render, fetch, mermaid, excalidraw exportToSvg, download)
 * is an injected mock, so this exercises the wiring only.
 *
 * Covers: per-type dispatch (markdown → B→C→A wiring, code → A, excalidraw →
 * D→A, extension → D-ext→A wiring with a frozen state + sandboxed offline
 * iframe); download trigger with the `<slug(title)>.html` filename and the built
 * html; warning aggregation across layers; a missing extension UI / a caught
 * failure → `{ ok: false, error }`; and the `refToUrl` / `htmlExportFilename`
 * helpers. Plus mini portability checks (no proxy URL / local path / external
 * script survives).
 */

import { describe, it, expect, vi } from 'vitest';
import {
    exportCanvasAsHtml,
    refToUrl,
    htmlExportFilename,
    browserDownload,
    type ExportableCanvas,
    type ExportCanvasAsHtmlDeps,
} from '../../../../../src/server/spa/client/react/features/canvas/html-export/exportCanvasAsHtml';
import type { AssetFetchResponse } from '../../../../../src/server/spa/client/react/features/canvas/html-export/assets';

/** A fetch response over `bytes` with an optional content-type header. */
function pngResp(ok = true): AssetFetchResponse {
    const blob = new Blob([new Uint8Array([1, 2, 3])], { type: 'image/png' });
    return {
        ok,
        headers: { get: (n: string) => (n.toLowerCase() === 'content-type' ? 'image/png' : null) },
        blob: async () => blob,
    };
}

/** Build a full deps object; override any field per-test. */
function makeDeps(over: Partial<ExportCanvasAsHtmlDeps> = {}): ExportCanvasAsHtmlDeps {
    return {
        renderMarkdown: () => '',
        fetch: async () => pngResp(),
        mermaidApi: { render: () => ({ svg: '<svg id="m"><g/></svg>' }) },
        exportToSvg: () => ({ outerHTML: '<svg id="x"><rect/></svg>' }),
        triggerDownload: vi.fn(),
        ...over,
    };
}

const PROXY_IMG = '/api/workspaces/ws1/files/image?path=%2Ftmp%2Fa.png';

/** Markdown render output with a local image, a mermaid block, and a code block. */
const RENDERED_MARKDOWN =
    '<h1>Doc</h1>' +
    `<p><img src="${PROXY_IMG}" alt="a"></p>` +
    '<pre><code class="language-mermaid">graph TD; A--&gt;B</code></pre>' +
    '<pre><code class="language-javascript">const x = 1;</code></pre>';

function mdCanvas(over: Partial<ExportableCanvas> = {}): ExportableCanvas {
    return { title: 'My Canvas', type: 'markdown', content: '# Doc', workspaceId: 'ws1', ...over };
}

describe('exportCanvasAsHtml — markdown', () => {
    it('wires B→C→A: inlines the image, renders mermaid to SVG, bakes code, embeds source', async () => {
        const deps = makeDeps({ renderMarkdown: () => RENDERED_MARKDOWN });
        const result = await exportCanvasAsHtml(mdCanvas(), deps);

        expect(result.ok).toBe(true);
        const html = result.html ?? '';
        // Layer B: the proxy-URL image is now an inline base64 data URI…
        expect(html).toContain('data:image/png;base64,');
        // Layer C: mermaid block → inline SVG.
        expect(html).toContain('<svg id="m">');
        // Code baking: highlight.js spans + hljs class present.
        expect(html).toContain('hljs language-javascript');
        expect(html).toMatch(/hljs-/);
        // Layer A: source embedded as recoverable markdown script.
        expect(html).toContain('<script type="text/markdown" id="source">');
        expect(html).toContain('# Doc');
    });

    it('portability: no proxy URL or local path survives in the markdown output', async () => {
        const deps = makeDeps({ renderMarkdown: () => RENDERED_MARKDOWN });
        const { html = '' } = await exportCanvasAsHtml(mdCanvas(), deps);
        expect(html).not.toContain('/api/workspaces');
        expect(html).not.toContain('files/image');
        expect(html).not.toMatch(/\/tmp\//);
    });

    it('maps refs through the workspace proxy and fetches once per image', async () => {
        const fetchSpy = vi.fn(async () => pngResp());
        const deps = makeDeps({ renderMarkdown: () => RENDERED_MARKDOWN, fetch: fetchSpy });
        await exportCanvasAsHtml(mdCanvas(), deps);
        expect(fetchSpy).toHaveBeenCalledTimes(1);
        // The already-origin-relative proxy URL is fetched as-is.
        expect(fetchSpy).toHaveBeenCalledWith(PROXY_IMG);
    });

    it('aggregates warnings from a failed image fetch and a failed mermaid render', async () => {
        const deps = makeDeps({
            renderMarkdown: () => RENDERED_MARKDOWN,
            fetch: async () => pngResp(false), // fetch fails → asset warning + placeholder
            mermaidApi: {
                render: () => {
                    throw new Error('boom');
                },
            },
        });
        const result = await exportCanvasAsHtml(mdCanvas(), deps);
        expect(result.ok).toBe(true);
        expect(result.warnings.some((w) => /image/i.test(w))).toBe(true);
        expect(result.warnings.some((w) => /mermaid/i.test(w))).toBe(true);
        // Unresolved image → self-contained placeholder, still no proxy URL.
        expect(result.html).not.toContain('/api/workspaces');
    });
});

describe('exportCanvasAsHtml — code', () => {
    it('serializes a code canvas through Layer A (highlighted, source embedded)', async () => {
        const renderMarkdown = vi.fn(() => '');
        const exportToSvg = vi.fn();
        const deps = makeDeps({ renderMarkdown, exportToSvg });
        const result = await exportCanvasAsHtml(
            { title: 'Snippet', type: 'code', content: 'const y = 2;', language: 'typescript', workspaceId: 'ws1' },
            deps,
        );
        expect(result.ok).toBe(true);
        expect(result.html).toContain('hljs language-typescript');
        expect(result.html).toContain('<script type="text/plain" id="source">');
        // No markdown render / excalidraw path for a code canvas.
        expect(renderMarkdown).not.toHaveBeenCalled();
        expect(exportToSvg).not.toHaveBeenCalled();
    });
});

describe('exportCanvasAsHtml — excalidraw', () => {
    it('wires D→A: rasterizes the scene to inline SVG and embeds the scene JSON', async () => {
        const scene = JSON.stringify({ elements: [{ id: 'r1', type: 'rectangle' }], appState: {} });
        const exportToSvg = vi.fn(() => ({ outerHTML: '<svg id="x"><rect/></svg>' }));
        const deps = makeDeps({ exportToSvg });
        const result = await exportCanvasAsHtml(
            { title: 'Diagram', type: 'excalidraw', content: scene, workspaceId: 'ws1' },
            deps,
        );
        expect(result.ok).toBe(true);
        expect(exportToSvg).toHaveBeenCalledTimes(1);
        expect(result.html).toContain('<svg id="x">');
        expect(result.html).toContain('canvas-export__excalidraw');
        expect(result.html).toContain('<script type="application/json" id="source">');
    });

    it('empty scene → placeholder + warning, export still completes', async () => {
        const deps = makeDeps({ exportToSvg: vi.fn() });
        const result = await exportCanvasAsHtml(
            { title: 'Empty', type: 'excalidraw', content: '{"elements":[]}', workspaceId: 'ws1' },
            deps,
        );
        expect(result.ok).toBe(true);
        expect(result.html).toContain('canvas-export__placeholder');
        expect(result.warnings.length).toBeGreaterThan(0);
    });
});

/** An extension canvas: `content` is the JSON state; `extension.uiHtml` is the UI doc. */
function extCanvas(over: Partial<ExportableCanvas> = {}): ExportableCanvas {
    return {
        title: 'Widget',
        type: 'extension',
        content: '{"count":2}',
        workspaceId: 'ws1',
        extension: {
            uiHtml: '<div id="app">hi</div>\n<script>CanvasHost.onState(function (s) {});</script>',
            revision: 3,
        },
        ...over,
    };
}

describe('exportCanvasAsHtml — extension', () => {
    it('wires D-ext→A: hosts the UI in a sandboxed offline iframe with the frozen state, embeds the state as source, downloads', async () => {
        const triggerDownload = vi.fn();
        // None of the markdown/asset/mermaid/excalidraw deps should be touched.
        const renderMarkdown = vi.fn(() => '');
        const exportToSvg = vi.fn();
        const fetchSpy = vi.fn(async () => pngResp());
        const deps = makeDeps({ triggerDownload, renderMarkdown, exportToSvg, fetch: fetchSpy });

        const result = await exportCanvasAsHtml(extCanvas(), deps);

        expect(result.ok).toBe(true);
        const html = result.html ?? '';
        // Sandboxed iframe hosting the extension UI — allow-scripts ONLY.
        expect(html).toContain('sandbox="allow-scripts"');
        expect(html).not.toContain('allow-same-origin');
        // Offline host is present; capability code is never shipped.
        expect(html).toContain('window.CanvasHost');
        expect(html).not.toContain('capabilitiesJs');
        // Frozen state embedded in the iframe srcdoc (attribute-escaped)…
        expect(html).toContain('&quot;count&quot;');
        // …and as the recoverable JSON source (Layer A, pretty-printed).
        expect(html).toContain('<script type="application/json" id="source">');
        expect(html).toContain('"count": 2');
        // Download uses the slug filename.
        expect(triggerDownload).toHaveBeenCalledTimes(1);
        expect(triggerDownload.mock.calls[0][0]).toBe('widget.html');
        // The other renderers were never invoked for an extension canvas.
        expect(renderMarkdown).not.toHaveBeenCalled();
        expect(exportToSvg).not.toHaveBeenCalled();
        expect(fetchSpy).not.toHaveBeenCalled();
    });

    it('fails gracefully with no download when the extension UI document is missing', async () => {
        const triggerDownload = vi.fn();
        const deps = makeDeps({ triggerDownload });
        const result = await exportCanvasAsHtml(
            { title: 'Widget', type: 'extension', content: '{}', workspaceId: 'ws1' },
            deps,
        );
        expect(result.ok).toBe(false);
        expect(result.error).toMatch(/unavailable|extension/i);
        expect(triggerDownload).not.toHaveBeenCalled();
    });

    it('malformed state content → still exports with an empty state and a warning', async () => {
        const triggerDownload = vi.fn();
        const deps = makeDeps({ triggerDownload });
        const result = await exportCanvasAsHtml(extCanvas({ content: '{not json' }), deps);

        expect(result.ok).toBe(true);
        expect(result.warnings.some((w) => /not valid json/i.test(w))).toBe(true);
        // Recoverable source degraded to an empty object, not the broken input.
        expect(result.html).toContain('<script type="application/json" id="source">{}</script>');
        expect(result.html).not.toContain('{not json');
        expect(triggerDownload).toHaveBeenCalledTimes(1);
    });

    it('portability: no /api route, external script, or same-origin sandbox survives', async () => {
        const deps = makeDeps();
        const { html = '' } = await exportCanvasAsHtml(
            extCanvas({
                extension: {
                    uiHtml: '<script src="https://cdn.example.com/app.js"></script><div>x</div>',
                },
            }),
            deps,
        );
        expect(html).not.toContain('/api/');
        expect(html).not.toContain('allow-same-origin');
        // The external <script src> was neutralized, not shipped.
        expect(html).not.toMatch(/<script[^>]+src=/i);
        expect(html).not.toContain('cdn.example.com');
    });
});

describe('exportCanvasAsHtml — download + failure', () => {
    it('triggers the download with the slugified filename and the built html', async () => {
        const triggerDownload = vi.fn();
        const deps = makeDeps({ renderMarkdown: () => '<p>hi</p>', triggerDownload });
        const result = await exportCanvasAsHtml(mdCanvas({ title: 'My Canvas!' }), deps);
        expect(triggerDownload).toHaveBeenCalledTimes(1);
        const [filename, html] = triggerDownload.mock.calls[0];
        expect(filename).toBe('my-canvas.html');
        expect(html).toBe(result.html);
    });

    it('returns { ok: false, error } and does not download when a layer throws', async () => {
        const triggerDownload = vi.fn();
        const deps = makeDeps({
            renderMarkdown: () => {
                throw new Error('render exploded');
            },
            triggerDownload,
        });
        const result = await exportCanvasAsHtml(mdCanvas(), deps);
        expect(result.ok).toBe(false);
        expect(result.error).toContain('render exploded');
        expect(triggerDownload).not.toHaveBeenCalled();
    });
});

describe('refToUrl', () => {
    it('returns an origin-relative proxy URL as-is', () => {
        expect(refToUrl('/api/workspaces/ws/files/image?path=x', 'ws')).toBe(
            '/api/workspaces/ws/files/image?path=x',
        );
    });

    it('wraps a local path / relative attachment ref in the workspace proxy URL', () => {
        expect(refToUrl('.attachments/abc.png', 'ws1')).toBe(
            '/api/workspaces/ws1/files/image?path=.attachments%2Fabc.png',
        );
        expect(refToUrl('/home/u/a.png'.replace(/^\//, ''), 'ws1')).toContain(
            '/api/workspaces/ws1/files/image?path=',
        );
    });

    it('leaves remote and inlined refs unchanged', () => {
        expect(refToUrl('https://cdn/x.png', 'ws')).toBe('https://cdn/x.png');
        expect(refToUrl('data:image/png;base64,AAAA', 'ws')).toBe('data:image/png;base64,AAAA');
    });
});

describe('htmlExportFilename', () => {
    it('slugifies the title and appends .html', () => {
        expect(htmlExportFilename({ title: 'My Great Canvas' })).toBe('my-great-canvas.html');
    });

    it('strips unsafe / cross-platform-illegal characters', () => {
        expect(htmlExportFilename({ title: 'a/b:c*d?"e' })).toBe('a-b-c-d-e.html');
    });

    it('falls back to "canvas" for an empty or symbol-only title', () => {
        expect(htmlExportFilename({ title: '   ' })).toBe('canvas.html');
        expect(htmlExportFilename({ title: '***' })).toBe('canvas.html');
    });
});

describe('browserDownload', () => {
    it('blobs the html as text/html and clicks a transient <a download>', () => {
        const created: HTMLAnchorElement[] = [];
        const realCreate = document.createElement.bind(document);
        const createSpy = vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
            const el = realCreate(tag) as HTMLElement;
            if (tag === 'a') {
                (el as HTMLAnchorElement).click = vi.fn();
                created.push(el as HTMLAnchorElement);
            }
            return el as any;
        });
        // jsdom lacks URL.createObjectURL/revokeObjectURL — stub them.
        const createObjURL = vi.fn(() => 'blob:mock');
        const revokeObjURL = vi.fn();
        (URL as any).createObjectURL = createObjURL;
        (URL as any).revokeObjectURL = revokeObjURL;

        browserDownload('out.html', '<!doctype html><p>x</p>');

        expect(createObjURL).toHaveBeenCalledTimes(1);
        const blobArg = createObjURL.mock.calls[0][0] as Blob;
        expect(blobArg.type).toContain('text/html');
        expect(created).toHaveLength(1);
        expect(created[0].download).toBe('out.html');
        expect(created[0].click).toHaveBeenCalledTimes(1);
        expect(revokeObjURL).toHaveBeenCalledWith('blob:mock');
        createSpy.mockRestore();
    });
});
