/**
 * Shared types for the canvas → self-contained HTML export pipeline.
 *
 * The pipeline is layered for testability (see the goal spec):
 *   Layer A  buildCanvasHtmlDocument  — pure serializer (this dir)
 *   Layer B  asset extraction + inline (jsdom)
 *   Layer C  mermaid pre-render        (jsdom)
 *   Layer D  excalidraw rasterization  (jsdom)
 *   Layer E  exportCanvasAsHtml        — orchestrator
 *   Layer F  CanvasPanel "Export as HTML" menu item
 *
 * These types are shared across the layers so the pure core and the I/O-bound
 * adapters agree on a single contract.
 */

/** Canvas types that participate in HTML export (mirrors CanvasType). */
export type CanvasHtmlExportType = 'markdown' | 'code' | 'excalidraw' | 'extension';

/**
 * Input to the pure serializer (Layer A). No DOM, no I/O — every asset has
 * already been fetched and inlined by the caller, and every renderer-specific
 * transform (mermaid → svg, excalidraw → svg) has already run.
 */
export interface BuildCanvasHtmlDocumentInput {
    /** Canvas type. Drives the body rendering strategy. */
    type: CanvasHtmlExportType;
    /** Canvas title. Escaped into <title> and the visible header. */
    title: string;
    /**
     * Pre-rendered body HTML for `markdown` and `excalidraw` canvases (the
     * output of `chatMarkdownToHtml` / the excalidraw → svg adapter). Ignored
     * for `code` canvases, which the serializer highlights from `sourceText`.
     */
    bodyHtml?: string;
    /**
     * Original canvas source text. Embedded verbatim in a non-rendering
     * `<script>` so the source is recoverable from the exported file.
     */
    sourceText: string;
    /**
     * Map from an image reference (the exact `src` attribute value, or the
     * `data-local-path` value, that appears in `bodyHtml`) → a resolved
     * `data:` URI. References with no entry become a broken-image placeholder.
     */
    assets?: Map<string, string>;
    /** Language hint for `code` canvases (e.g. "typescript"). */
    language?: string;
    /**
     * Self-contained KaTeX CSS (layout rules + `KaTeX_*` `@font-face` with the
     * fonts already inlined as `data:` URIs) to embed inline so rendered `.katex`
     * math styles correctly offline. Supplied for `markdown` exports (whose body
     * may contain rendered math); omitted/empty ships the math markup unstyled.
     * Must stay self-contained — no external `url(https://…)` — to keep the
     * portability contract. Production value comes from `getExportKatexCss`.
     */
    mathCss?: string;
}

/** Result of building an export document. */
export interface BuildCanvasHtmlDocumentResult {
    /** The full standalone HTML document. */
    html: string;
    /** Non-fatal issues (e.g. an image ref with no resolved asset). */
    warnings: string[];
}
