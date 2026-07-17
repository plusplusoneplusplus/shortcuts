/**
 * @vitest-environment jsdom
 *
 * Layer G — full-pipeline integration test for the canvas → self-contained HTML
 * export. Unlike the per-layer suites (which mock the neighbouring layers), this
 * drives the REAL orchestrator (Layer E) over the REAL lower layers:
 *   - `chatMarkdownToHtml` (the production markdown renderer) as `renderMarkdown`,
 *   - real Layer B (`collectImageRefs` + `resolveAssets`),
 *   - real Layer C (`inlineMermaid`, over forge's genuine `.mermaid-container`
 *     markup — the format the on-screen preview actually emits),
 *   - real Layer E code-baking (`highlightMarkdownCodeBlocks`),
 *   - real Layer A (`buildCanvasHtmlDocument`).
 *
 * Only the browser-only / network leaves are stubbed: `fetch` returns a tiny PNG,
 * `mermaidApi.render` returns a fixed SVG (mermaid is DOM-bound), and `exportToSvg`
 * is unused for markdown. jsdom supplies the `FileReader`/`Blob` that Layer B's
 * base64 conversion needs.
 *
 * A single markdown canvas exercises every path — 1 local image, 1 mermaid block,
 * 1 highlighted code block, 1 GFM table — and the assertions enforce the full
 * portability contract: every local asset inlined, and NO proxy URL / `/api/`
 * reference / `.attachments/` ref / absolute filesystem path / external
 * `<link rel=stylesheet>` / external `<script src>` / non-namespace `http(s)` URL
 * survives. Every string check is path-separator agnostic.
 *
 * A second suite drives the REAL extension path (Layer E → D-ext → A): it hosts a
 * realistic state-rendering extension UI in the offline sandboxed iframe and
 * enforces the same portability contract plus the extension-specific guarantees —
 * an `allow-scripts`-only sandbox, an offline `CanvasHost` whose `invoke`/`setState`
 * are inert, the frozen state visible in the `srcdoc`, `capabilitiesJs` never
 * shipped, no network dependency, and byte-identical determinism. A dirty-UI case
 * proves external `<script src>` / `<link>` refs are neutralized (with warnings)
 * and the export still completes offline rather than crashing.
 */

import { describe, it, expect, vi } from 'vitest';
import {
    exportCanvasAsHtml,
    type ExportableCanvas,
    type ExportCanvasAsHtmlDeps,
} from '../../../../../src/server/spa/client/react/features/canvas/html-export/exportCanvasAsHtml';
import type { AssetFetchResponse } from '../../../../../src/server/spa/client/react/features/canvas/html-export/assets';
import { chatMarkdownToHtml } from '../../../../../src/server/spa/client/react/features/chat/conversation/ConversationTurnBubble';

const WORKSPACE_ID = 'ws-int';

/** A realistic mermaid render output: a self-contained `<svg>` with the standard
 *  SVG XML namespace (`http://www.w3.org/2000/svg` — a namespace URI, NOT a
 *  network reference, so it is legitimately present in a portable file). */
const MERMAID_SVG =
    '<svg xmlns="http://www.w3.org/2000/svg" id="mermaid-out" role="img" viewBox="0 0 100 40">' +
    '<g><rect x="0" y="0" width="40" height="20"/><text x="4" y="14">A</text>' +
    '<rect x="60" y="0" width="40" height="20"/><text x="64" y="14">B</text></g></svg>';

/** A minimal 1x1-ish PNG fetch response. */
function pngResp(): AssetFetchResponse {
    const blob = new Blob([new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])], { type: 'image/png' });
    return {
        ok: true,
        headers: { get: (n: string) => (n.toLowerCase() === 'content-type' ? 'image/png' : null) },
        blob: async () => blob,
    };
}

/** A markdown canvas that hits every render path: image + mermaid + code + table. */
const CONTENT = [
    '# Integration Doc',
    '',
    'Intro paragraph for the exported snapshot.',
    '',
    '![diagram](assets/diagram.png)',
    '',
    '```mermaid',
    'graph TD; A-->B',
    '```',
    '',
    '```ts',
    'const answer: number = 42;',
    '```',
    '',
    '| Name | Value |',
    '| ---- | ----- |',
    '| a | 1 |',
    '| b | 2 |',
    '',
].join('\n');

function makeCanvas(): ExportableCanvas {
    return { title: 'Integration Doc', type: 'markdown', content: CONTENT, workspaceId: WORKSPACE_ID };
}

/** Real renderer + real B/C/A; only the leaf browser/network deps are stubbed. */
function makeDeps(over: Partial<ExportCanvasAsHtmlDeps> = {}): ExportCanvasAsHtmlDeps {
    return {
        renderMarkdown: (content, wsId) => chatMarkdownToHtml(content, wsId),
        fetch: async () => pngResp(),
        mermaidApi: { render: () => ({ svg: MERMAID_SVG }) },
        exportToSvg: vi.fn(),
        triggerDownload: vi.fn(),
        ...over,
    };
}

/** Every absolute `http(s)://…` URL that appears in the output. */
function externalUrls(html: string): string[] {
    return html.match(/https?:\/\/[^\s"'<>)]+/gi) ?? [];
}

describe('canvas HTML export — full pipeline (Layer G)', () => {
    it('renders image + mermaid + code + table into one portable document', async () => {
        const fetchSpy = vi.fn(async () => pngResp());
        const triggerDownload = vi.fn();
        const deps = makeDeps({ fetch: fetchSpy, triggerDownload });

        const result = await exportCanvasAsHtml(makeCanvas(), deps);

        expect(result.ok).toBe(true);
        expect(result.warnings).toHaveLength(0);
        const html = result.html ?? '';

        // --- Content: each render path produced its expected artifact. ---
        // Exactly one image, inlined as a base64 PNG data URI (Layer B → Layer A).
        expect(html.match(/<img\b/gi) ?? []).toHaveLength(1);
        expect(html.match(/data:image\/png;base64,/gi) ?? []).toHaveLength(1);
        expect(html).toMatch(/<img[^>]*src="data:image\/png;base64,[^"]+"/i);

        // Exactly one inline mermaid <svg> (Layer C); the mermaid runtime is not shipped.
        expect(html.match(/<svg\b/gi) ?? []).toHaveLength(1);
        expect(html).toContain('id="mermaid-out"');
        expect(html).toContain('canvas-export__mermaid');
        expect(html).not.toContain('mermaid-loading'); // forge's loading placeholder is gone
        expect(html).not.toContain('mermaid.js');

        // Highlighted code block (code-baking): hljs class + token spans.
        expect(html).toMatch(/class="hljs language-ts"/i);
        expect(html).toMatch(/class="hljs-/);

        // Rendered GFM table.
        expect(html).toContain('<table>');
        expect(html).toContain('<th>Name</th>');

        // Embedded, recoverable source in a non-rendering script.
        expect(html).toContain('<script type="text/markdown" id="source">');
        // The source is embedded verbatim (only `</script>`/`<!--` are neutralized),
        // so the original mermaid fence is recoverable exactly as authored.
        expect(html).toContain('graph TD; A-->B');
        expect(html).toContain('# Integration Doc');

        // --- Portability contract (path-separator agnostic). ---
        // 2) No external references: no proxy URL / api path / attachments ref.
        expect(html).not.toContain('/api/');
        expect(html).not.toContain('files/image');
        expect(html).not.toContain('/api/workspaces');
        expect(html).not.toContain('.attachments/');
        // App-only image attributes are stripped so no local path/proxy leaks via them.
        expect(html).not.toContain('data-local-path');
        expect(html).not.toContain('onerror');
        // No external stylesheet or script.
        expect(html).not.toMatch(/<link\b[^>]*rel=["']?stylesheet/i);
        expect(html).not.toMatch(/<script\b[^>]*\bsrc=/i);
        // 3) No absolute local filesystem path (Linux/macOS or Windows). The
        // Windows drive check requires the drive letter to sit at a boundary so
        // it never collides with a URL scheme colon (`http://`, `data:`).
        expect(html).not.toMatch(/\/home\//);
        expect(html).not.toMatch(/\/Users\//);
        expect(html).not.toMatch(/(?<![A-Za-z0-9])[A-Za-z]:[\\/]/);
        // Every absolute http(s) URL present must be an XML namespace, never a
        // fetchable external resource.
        for (const url of externalUrls(html)) {
            expect(url).toMatch(/^https?:\/\/www\.w3\.org\//);
        }

        // The image was fetched exactly once, via the same-origin workspace proxy.
        expect(fetchSpy).toHaveBeenCalledTimes(1);
        expect(fetchSpy.mock.calls[0][0]).toMatch(
            /^\/api\/workspaces\/ws-int\/files\/image\?path=/,
        );

        // Download triggered with the slugified filename and the built document.
        expect(triggerDownload).toHaveBeenCalledTimes(1);
        expect(triggerDownload.mock.calls[0][0]).toBe('integration-doc.html');
        expect(triggerDownload.mock.calls[0][1]).toBe(html);
    });

    it('is deterministic: the same canvas produces byte-identical output', async () => {
        const first = await exportCanvasAsHtml(makeCanvas(), makeDeps());
        const second = await exportCanvasAsHtml(makeCanvas(), makeDeps());
        expect(first.ok).toBe(true);
        expect(second.ok).toBe(true);
        expect(second.html).toBe(first.html);
    });
});

/** A realistic extension UI: it reads its state through the offline `CanvasHost`
 *  and renders it, plus an action button that would call `invoke` — a mutation
 *  that is inert in the offline snapshot (hence the view-only banner). Fully
 *  self-contained: no external `<script>`/`<link>` and no network URLs. */
const EXTENSION_UI_HTML = [
    '<div id="app">',
    '  <h2 id="label"></h2>',
    '  <p id="count"></p>',
    '  <button id="inc" type="button">Increment</button>',
    '</div>',
    '<script>',
    '  window.CanvasHost.onState(function (state) {',
    "    document.getElementById('label').textContent = state.label || '';",
    "    document.getElementById('count').textContent = 'count=' + (state.count || 0);",
    '  });',
    "  document.getElementById('inc').addEventListener('click', function () {",
    "    window.CanvasHost.invoke('increment', {});",
    '  });',
    '</script>',
].join('\n');

/** An extension canvas: `content` holds the current JSON state, and
 *  `extension.uiHtml` is the separately-fetched UI document (never
 *  `capabilitiesJs` — capability code stays server-only). */
function makeExtensionCanvas(over: Partial<ExportableCanvas> = {}): ExportableCanvas {
    return {
        title: 'Counter Widget',
        type: 'extension',
        content: '{"count":7,"label":"Hello"}',
        workspaceId: WORKSPACE_ID,
        extension: { uiHtml: EXTENSION_UI_HTML, revision: 5 },
        ...over,
    };
}

describe('canvas HTML export — extension full pipeline (Layer G)', () => {
    it('hosts the extension UI + frozen state in an offline, view-only, portable snapshot', async () => {
        // Wrap the real deps in spies: the extension path must touch NONE of them
        // (no markdown render, no fetch, no mermaid, no excalidraw). It is a pure,
        // network-free string build (E → D-ext → A).
        const renderMarkdown = vi.fn((c: string, w: string) => chatMarkdownToHtml(c, w));
        const fetchSpy = vi.fn(async () => pngResp());
        const exportToSvg = vi.fn();
        const triggerDownload = vi.fn();
        const deps = makeDeps({ renderMarkdown, fetch: fetchSpy, exportToSvg, triggerDownload });

        const result = await exportCanvasAsHtml(makeExtensionCanvas(), deps);

        expect(result.ok).toBe(true);
        expect(result.warnings).toHaveLength(0);
        const html = result.html ?? '';

        // --- Render surface: exactly one sandboxed, allow-scripts-ONLY iframe. ---
        expect(html.match(/<iframe\b/gi) ?? []).toHaveLength(1);
        expect(html).toContain('sandbox="allow-scripts"');
        expect(html).not.toContain('allow-same-origin');

        // The view-only banner is shown (interactive actions cannot run offline).
        expect(html).toContain('canvas-export__viewonly-banner');
        expect(html).toContain('View-only snapshot');

        // Offline CanvasHost: onState delivers the frozen state; invoke/setState are
        // inert, so nothing in the file can run a capability or persist state.
        expect(html).toContain('window.CanvasHost');
        expect(html).toContain('invoke: inert');
        expect(html).toContain('setState: inert');
        // Capability code is NEVER shipped.
        expect(html).not.toContain('capabilitiesJs');

        // The extension UI itself ships inside the (attribute-escaped) srcdoc.
        expect(html).toContain('id=&quot;app&quot;');
        expect(html).toContain('Increment');

        // Frozen state is visible in the srcdoc (attribute-escaped `"` → &quot;),
        // so a file:// open renders exactly the state captured at export time.
        expect(html).toContain('&quot;count&quot;:7');
        expect(html).toContain('&quot;label&quot;:&quot;Hello&quot;');
        // The revision is surfaced to the extension via the onState meta.
        expect(html).toContain('&quot;revision&quot;:5');

        // Recoverable, pretty-printed JSON source (Layer A embeds the frozen state).
        expect(html).toContain('<script type="application/json" id="source">');
        expect(html).toContain('"count": 7');
        expect(html).toContain('"label": "Hello"');

        // --- Portability contract (path-separator agnostic), same as markdown. ---
        expect(html).not.toContain('/api/');
        expect(html).not.toContain('.attachments/');
        expect(html).not.toContain('data-local-path');
        expect(html).not.toMatch(/<link\b[^>]*rel=["']?stylesheet/i);
        expect(html).not.toMatch(/<script\b[^>]*\bsrc=/i);
        expect(html).not.toMatch(/\/home\//);
        expect(html).not.toMatch(/\/Users\//);
        expect(html).not.toMatch(/(?<![A-Za-z0-9])[A-Za-z]:[\\/]/);
        // A clean, self-contained extension ships ZERO external URLs.
        expect(externalUrls(html)).toHaveLength(0);

        // No render/network dep was touched — the export made no network request.
        expect(renderMarkdown).not.toHaveBeenCalled();
        expect(fetchSpy).not.toHaveBeenCalled();
        expect(exportToSvg).not.toHaveBeenCalled();

        // Download used the slugified filename and the built document.
        expect(triggerDownload).toHaveBeenCalledTimes(1);
        expect(triggerDownload.mock.calls[0][0]).toBe('counter-widget.html');
        expect(triggerDownload.mock.calls[0][1]).toBe(html);
    });

    it('is deterministic: the same extension canvas produces byte-identical output', async () => {
        const first = await exportCanvasAsHtml(makeExtensionCanvas(), makeDeps());
        const second = await exportCanvasAsHtml(makeExtensionCanvas(), makeDeps());
        expect(first.ok).toBe(true);
        expect(second.ok).toBe(true);
        expect(second.html).toBe(first.html);
    });

    it('neutralizes external <script src>/<link> refs (with warnings) and still exports offline', async () => {
        const dirtyUi = [
            '<link rel="stylesheet" href="https://cdn.example.com/theme.css">',
            '<script src="https://cdn.example.com/app.js"></script>',
            '<div id="app">offline</div>',
            '<script>window.CanvasHost.onState(function (s) {});</script>',
        ].join('\n');

        const result = await exportCanvasAsHtml(
            makeExtensionCanvas({ extension: { uiHtml: dirtyUi, revision: 1 } }),
            makeDeps(),
        );

        expect(result.ok).toBe(true);
        const html = result.html ?? '';
        // The removable external references were stripped, not shipped.
        expect(html).not.toMatch(/<script\b[^>]*\bsrc=/i);
        expect(html).not.toMatch(/<link\b/i);
        expect(html).not.toContain('cdn.example.com/app.js');
        expect(html).not.toContain('cdn.example.com/theme.css');
        // …and each removal is reported so the export never silently degrades.
        expect(result.warnings.some((w) => /script src/i.test(w))).toBe(true);
        expect(result.warnings.some((w) => /link/i.test(w))).toBe(true);
        // Still portable + sandboxed despite the dirty input.
        expect(html).not.toContain('/api/');
        expect(html).toContain('sandbox="allow-scripts"');
        expect(html).not.toContain('allow-same-origin');
    });
});
