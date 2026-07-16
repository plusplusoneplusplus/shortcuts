/**
 * Layer E — the canvas → self-contained HTML export orchestrator.
 *
 * `exportCanvasAsHtml(canvas, deps)` dispatches by canvas type and wires the
 * lower layers into one standalone document, then triggers the download:
 *   - markdown → render (B: collect + resolve assets) → (C: inline mermaid) →
 *     bake code highlighting → (A: serialize).
 *   - code     → (A: serialize; Layer A highlights the source itself).
 *   - excalidraw → (D: rasterize scene to SVG) → (A: serialize).
 *   - extension → not exportable in Phase 1 (Layer F shows a view-only note);
 *     returns `{ ok: false }` with a reason rather than throwing.
 *
 * Every browser-only capability (markdown render, `fetch`, `mermaid.render`,
 * excalidraw `exportToSvg`, and the DOM download) is INJECTED via `deps`, so the
 * orchestrator unit-tests with plain mocks and never imports the DOM-bound or
 * Node-unloadable libraries (`@excalidraw/excalidraw`, mermaid) directly. Layer
 * F supplies the real implementations.
 *
 * Never throws: any failure is caught and returned as `{ ok: false, error }`,
 * and per-image / per-diagram problems surface as aggregated `warnings` while
 * the export still completes. Deterministic — no `Date.now()` / `Math.random()`.
 */

import { buildCanvasHtmlDocument } from './buildCanvasHtmlDocument';
import { collectImageRefs, resolveAssets } from './assets';
import type { AssetFetchFn, AssetFetchResponse } from './assets';
import { inlineMermaid } from './mermaid';
import type { MermaidRenderApi } from './mermaid';
import { excalidrawToInlineSvg } from './excalidraw';
import type { ExcalidrawExportToSvgFn } from './excalidraw';
import { highlightMarkdownCodeBlocks } from './codeHighlight';
import type { CanvasHtmlExportType } from './types';

/** The minimal canvas shape the exporter needs (the full `Canvas` satisfies it). */
export interface ExportableCanvas {
    /** Canvas title — used for the `<title>`, heading, and download filename. */
    title: string;
    /** Canvas type; drives the render pipeline. */
    type: CanvasHtmlExportType;
    /** Raw canvas source (markdown text, code, or excalidraw scene JSON). */
    content: string;
    /** Language hint for `code` canvases. */
    language?: string;
    /** Workspace id — used to resolve local image proxy URLs. */
    workspaceId: string;
}

/** Injected side-effecting dependencies. Keeps Layer E pure of DOM/library imports. */
export interface ExportCanvasAsHtmlDeps {
    /** Renders markdown canvas source to body HTML. Production: `chatMarkdownToHtml`. */
    renderMarkdown: (content: string, workspaceId: string) => string;
    /** Fetches an asset URL. Production: the browser `fetch` (its `Response` satisfies this). */
    fetch: (url: string) => Promise<AssetFetchResponse>;
    /** Renders a mermaid diagram to SVG (Layer C). Production: lazy-loaded `mermaid.render`. */
    mermaidApi: MermaidRenderApi;
    /** Rasterizes an excalidraw scene to SVG (Layer D). Production: `@excalidraw/excalidraw` `exportToSvg`. */
    exportToSvg: ExcalidrawExportToSvgFn;
    /** Triggers a browser download of the built document. Production: `browserDownload`. */
    triggerDownload: (filename: string, html: string) => void;
}

/** Outcome of an export attempt. */
export interface ExportCanvasAsHtmlResult {
    /** Whether a document was produced and the download triggered. */
    ok: boolean;
    /** The built HTML document (present when `ok`). */
    html?: string;
    /** The download filename used (present when `ok`). */
    filename?: string;
    /** Aggregated non-fatal issues from every layer (unresolved images, failed diagrams). */
    warnings: string[];
    /** Failure reason when `!ok` (unsupported type, or a caught error). */
    error?: string;
}

function errorMessage(err: unknown): string {
    return err instanceof Error ? err.message : String(err);
}

/**
 * Slugify a canvas title into a cross-platform-safe filename stem: lowercased,
 * every run of non-alphanumeric characters collapsed to a single dash, trimmed,
 * capped in length. Windows-illegal characters (`< > : " / \ | ? *`) and control
 * characters are removed by construction. Falls back to `canvas` when empty.
 */
function slugifyTitle(title: string): string {
    const slug = String(title ?? '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 80)
        .replace(/-+$/g, '');
    return slug || 'canvas';
}

/** The `<slug(title)>.html` download filename for a canvas export. */
export function htmlExportFilename(canvas: { title: string }): string {
    return `${slugifyTitle(canvas.title)}.html`;
}

/**
 * Map a collected image reference to a fetchable, same-origin URL.
 *   - an origin-relative URL (the proxy URL `/api/…`) is fetched as-is;
 *   - a remote/inline ref (should not reach here — `collectImageRefs` filters
 *     them) is returned unchanged;
 *   - anything else (a local filesystem path or a relative `.attachments/…` ref
 *     captured from `data-local-path`) is wrapped in the workspace image proxy
 *     URL so the browser can fetch it same-origin.
 */
export function refToUrl(ref: string, workspaceId: string): string {
    if (/^(data:|blob:)/i.test(ref) || /^(https?:)?\/\//i.test(ref)) return ref;
    if (ref.startsWith('/')) return ref;
    return `/api/workspaces/${encodeURIComponent(workspaceId)}/files/image?path=${encodeURIComponent(ref)}`;
}

/**
 * Default DOM download implementation for `triggerDownload`. Blobs the document
 * as `text/html` and clicks a transient `<a download>`; browser-only, so it is
 * injected rather than called directly by the orchestrator.
 */
export function browserDownload(filename: string, html: string): void {
    const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
}

/** Build the markdown export document: render → inline assets + mermaid → bake code → serialize. */
async function buildMarkdownDocument(
    canvas: ExportableCanvas,
    deps: ExportCanvasAsHtmlDeps,
    warnings: string[],
): Promise<string> {
    const rendered = deps.renderMarkdown(canvas.content, canvas.workspaceId);

    // Layer B — collect local image refs from the rendered `<img>` tags and
    // resolve them to inline data URIs (mermaid/code passes below never touch
    // `<img>`, so these keys stay valid for Layer A's rewrite).
    const refs = collectImageRefs(rendered);
    const fetchFn: AssetFetchFn = (ref) => deps.fetch(refToUrl(ref, canvas.workspaceId));
    const { assets, warnings: assetWarnings } = await resolveAssets(refs, fetchFn);
    warnings.push(...assetWarnings);

    // Layer C — pre-render mermaid diagrams to inline SVG (runtime not shipped).
    const mermaid = await inlineMermaid(rendered, deps.mermaidApi);
    warnings.push(...mermaid.warnings);

    // Pre-bake highlight.js spans so the embedded theme CSS colours code offline.
    const bodyHtml = highlightMarkdownCodeBlocks(mermaid.html);

    const built = buildCanvasHtmlDocument({
        type: 'markdown',
        title: canvas.title,
        bodyHtml,
        sourceText: canvas.content,
        assets,
    });
    warnings.push(...built.warnings);
    return built.html;
}

/** Build the excalidraw export document: rasterize scene → wrap → serialize. */
async function buildExcalidrawDocument(
    canvas: ExportableCanvas,
    deps: ExportCanvasAsHtmlDeps,
    warnings: string[],
): Promise<string> {
    const { svg, warnings: sceneWarnings } = await excalidrawToInlineSvg(
        canvas.content,
        deps.exportToSvg,
    );
    warnings.push(...sceneWarnings);
    const built = buildCanvasHtmlDocument({
        type: 'excalidraw',
        title: canvas.title,
        bodyHtml: `<div class="canvas-export__excalidraw">${svg}</div>`,
        sourceText: canvas.content,
    });
    warnings.push(...built.warnings);
    return built.html;
}

/**
 * Export a canvas to a self-contained, portable HTML file and trigger its
 * download. Returns `{ ok, html, filename, warnings }` on success, or
 * `{ ok: false, error, warnings }` for an unsupported type or a caught failure.
 */
export async function exportCanvasAsHtml(
    canvas: ExportableCanvas,
    deps: ExportCanvasAsHtmlDeps,
): Promise<ExportCanvasAsHtmlResult> {
    const warnings: string[] = [];
    try {
        let html: string;
        switch (canvas.type) {
            case 'markdown':
                html = await buildMarkdownDocument(canvas, deps, warnings);
                break;
            case 'code':
                html = buildCodeDocument(canvas, warnings);
                break;
            case 'excalidraw':
                html = await buildExcalidrawDocument(canvas, deps, warnings);
                break;
            case 'extension':
                return {
                    ok: false,
                    warnings,
                    error: 'Extension canvases export as a view-only snapshot — coming soon.',
                };
            default:
                return { ok: false, warnings, error: `Unsupported canvas type "${String(canvas.type)}".` };
        }

        const filename = htmlExportFilename(canvas);
        deps.triggerDownload(filename, html);
        return { ok: true, html, filename, warnings };
    } catch (err) {
        return { ok: false, warnings, error: errorMessage(err) };
    }
}

/** Build the code export document (Layer A highlights the source; no assets/mermaid). */
function buildCodeDocument(canvas: ExportableCanvas, warnings: string[]): string {
    const built = buildCanvasHtmlDocument({
        type: 'code',
        title: canvas.title,
        sourceText: canvas.content,
        language: canvas.language,
    });
    warnings.push(...built.warnings);
    return built.html;
}
