/**
 * paperAnchorGeometry — extract the geometric half of a paper annotation's dual
 * anchor (Goal 2) from a live text-layer selection.
 *
 * The text-quote half (`{selectedText, contextBefore, contextAfter}`) already
 * comes out of {@link getQuickAskSelection}. This module derives the second half:
 * the `{page, rects[]}` that lets a persisted Q&A be painted back onto the exact
 * pixels of the pdf.js canvas overlay.
 *
 * Every rect is normalized to fractions (0..1) of its page's rendered box so the
 * anchor survives a different render scale / zoom on reload — the same page at a
 * different scale still maps the fractions back to the right pixels.
 *
 * pdf.js lays each page out as `renderPdfDocument` builds it: a
 * `.pdfjs-page[data-page-number]` wrapper (fixed px width/height) holding the
 * `<canvas>` and an absolutely-positioned `.textLayer`. We locate the page from
 * the selection's start node, then measure each client rect against that page's
 * bounding box.
 */

/** A single normalized bounding box (fractions 0..1 of the page dimensions). */
export interface PaperRect {
    x: number;
    y: number;
    width: number;
    height: number;
}

/** Geometric half of the dual anchor: page + normalized rects. */
export interface PaperRectAnchor {
    /** 1-based page number the selection lives on. */
    page: number;
    /** One or more normalized boxes (a multi-line selection spans several). */
    rects: PaperRect[];
}

function clamp01(n: number): number {
    if (!Number.isFinite(n)) {return 0;}
    if (n < 0) {return 0;}
    if (n > 1) {return 1;}
    return n;
}

/** Walk up from a DOM node to the nearest `.pdfjs-page` wrapper, if any. */
function findPageElement(node: Node | null): HTMLElement | null {
    let el: HTMLElement | null =
        node && node.nodeType === Node.ELEMENT_NODE
            ? (node as HTMLElement)
            : (node?.parentElement ?? null);
    while (el) {
        if (el.classList?.contains('pdfjs-page')) {return el;}
        el = el.parentElement;
    }
    return null;
}

/**
 * Derive `{page, rects[]}` for the current window selection, if it lies inside a
 * pdf.js text layer under `container`. Returns `null` when there is no usable
 * selection, it is outside a rendered page, or no rect falls on that page.
 *
 * The page is taken from the selection's start; client rects that fall on other
 * pages (a rare cross-page drag) are dropped rather than mis-attributed, so the
 * highlight is always self-consistent on one page.
 */
export function extractPaperRectAnchor(container: HTMLElement | null): PaperRectAnchor | null {
    if (!container) {return null;}
    const sel = typeof window !== 'undefined' ? window.getSelection() : null;
    if (!sel || sel.isCollapsed || sel.rangeCount === 0) {return null;}

    const range = sel.getRangeAt(0);
    if (!container.contains(range.commonAncestorContainer)) {return null;}

    const pageEl = findPageElement(range.startContainer);
    if (!pageEl) {return null;}

    const pageNumber = Number(pageEl.dataset.pageNumber);
    if (!Number.isFinite(pageNumber) || pageNumber < 1) {return null;}

    const pageBox = pageEl.getBoundingClientRect();
    if (!pageBox.width || !pageBox.height) {return null;}

    const rects: PaperRect[] = [];
    const clientRects = range.getClientRects();
    for (let i = 0; i < clientRects.length; i++) {
        const r = clientRects[i];
        if (!r || (r.width === 0 && r.height === 0)) {continue;}
        // Attribute the rect to this page by its centre; skip anything that is
        // really on another page (cross-page drag) so we never mis-normalize.
        const cx = r.left + r.width / 2;
        const cy = r.top + r.height / 2;
        if (cx < pageBox.left || cx > pageBox.right || cy < pageBox.top || cy > pageBox.bottom) {
            continue;
        }
        rects.push({
            x: clamp01((r.left - pageBox.left) / pageBox.width),
            y: clamp01((r.top - pageBox.top) / pageBox.height),
            width: clamp01(r.width / pageBox.width),
            height: clamp01(r.height / pageBox.height),
        });
    }

    if (rects.length === 0) {return null;}
    return { page: pageNumber, rects };
}
