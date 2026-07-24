/**
 * pdfHeightShared — framework-free height primitives for the inline PDF embed
 * block's resizable viewport.
 *
 * Mirrors indentShared: intentionally dependency-free (no `@tiptap/core` import)
 * so the PdfBlock node can reuse the exact parse / clamp / render logic without
 * pulling in the Extension runtime — and so unit tests that mock `@tiptap/core`
 * don't trip over a top-level `Node.create` when they import the node.
 *
 * Centralizing the clamp bounds and the `height` attribute here is what keeps the
 * node attribute, CSS bounds, and Markdown `data-pdf-height` round-trip from
 * drifting. The bounds must match the `.md-pdf-embed-frame-wrap` CSS
 * (min-height 160px / max-height 1200px) and the `.md-pdf-embed-frame` default
 * height (480px).
 */

export const MIN_PDF_HEIGHT = 160;
export const MAX_PDF_HEIGHT = 1200;
export const DEFAULT_PDF_HEIGHT = 480;

/** Clamp any height value into the supported [MIN, MAX] pixel range. */
export function clampPdfHeight(n: number): number {
    return Math.max(MIN_PDF_HEIGHT, Math.min(Math.round(n), MAX_PDF_HEIGHT));
}

/** Read a clamped height from a `data-pdf-height` attribute (absent/invalid → null). */
export function parsePdfHeightAttr(el: HTMLElement): number | null {
    const raw = el.getAttribute('data-pdf-height');
    if (!raw) return null;
    const n = parseInt(raw, 10);
    return Number.isFinite(n) ? clampPdfHeight(n) : null;
}

/** Render the `data-pdf-height` HTML attribute — omitted entirely when unset. */
export function renderPdfHeightAttr(height: number | null | undefined): Record<string, string> {
    if (height == null) return {};
    return { 'data-pdf-height': String(clampPdfHeight(height)) };
}

/**
 * Shared Tiptap attribute spec for `height`. Symmetric to `createIndentAttribute()`
 * so the parse / clamp / render behaviour stays identical wherever the PDF height
 * is threaded (node attribute, saved HTML, reload).
 */
export function createPdfHeightAttribute() {
    return {
        default: null as number | null,
        parseHTML: (el: HTMLElement) => parsePdfHeightAttr(el),
        renderHTML: (attrs: { height?: number | null }) => renderPdfHeightAttr(attrs.height),
    };
}
