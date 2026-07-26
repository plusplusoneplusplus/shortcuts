/**
 * paperAnnotationRender — pure DOM primitives for painting persisted paper
 * annotations back onto a rendered pdf.js document (Goal 2 read/render half).
 *
 * A stored {@link PaperAnnotation} carries a dual anchor:
 *   - a text-quote selector (re-resolved against the live text layer by the
 *     shared {@link resolveSidenoteAnchor} → a margin 💡 chip at the passage), and
 *   - an optional `{page, rects[]}` geometric anchor (normalized 0..1 fractions →
 *     absolutely-positioned overlay boxes on the exact pixels of the page).
 *
 * This module owns the geometric half plus the pdfUrl matching used to decide
 * which annotations belong to a rendered block. It is pure DOM (no React), so the
 * primitives are unit-testable with jsdom.
 */

import type {
    PaperAnnotation,
    PaperRectAnchor,
    PaperRegionAnchor,
} from '../../../../../../../notes/paper-annotations-types';

/** Attribute stamped on every overlay box (used to find + clear them). */
export const PAPER_OVERLAY_ATTR = 'data-paper-annotation-overlay';
/** Attribute carrying the owning annotation id on each overlay box. */
export const PAPER_OVERLAY_ID_ATTR = 'data-paper-annotation-id';
/** Visual class for an overlay highlight box (see noteEditor.css). */
export const PAPER_OVERLAY_CLASS = 'paper-annotation-overlay';
/** Shared test id for overlay boxes. */
export const PAPER_OVERLAY_TESTID = 'paper-annotation-overlay';

/**
 * Normalize a PDF url to a comparable key. The inline block persists the raw
 * markdown node attribute (often relative, e.g. `1802.05799.pdf`), while the
 * full-window view persists the resolved href. Reduce both to `pathname` when
 * parseable so the read half can match an annotation to the block that renders
 * its PDF regardless of which surface wrote it.
 */
export function normalizePdfUrl(raw: string | null | undefined): string {
    if (!raw) {return '';}
    const trimmed = raw.trim();
    if (!trimmed) {return '';}
    try {
        const base = typeof window !== 'undefined' ? window.location?.href : undefined;
        const parsed = base ? new URL(trimmed, base) : new URL(trimmed);
        return (parsed.pathname + parsed.search).toLowerCase();
    } catch {
        return trimmed.toLowerCase();
    }
}

/** Last path segment of a normalized url (its basename), for a looser match. */
function basename(normalized: string): string {
    const noQuery = normalized.split('?')[0];
    const parts = noQuery.split('/').filter(Boolean);
    return parts.length ? parts[parts.length - 1] : noQuery;
}

/**
 * True when two PDF urls refer to the same document. Exact normalized match, or
 * (to bridge the relative-attr vs resolved-href gap) a shared non-empty basename.
 */
export function pdfUrlsMatch(a: string | null | undefined, b: string | null | undefined): boolean {
    const na = normalizePdfUrl(a);
    const nb = normalizePdfUrl(b);
    if (!na || !nb) {return false;}
    if (na === nb) {return true;}
    const ba = basename(na);
    const bb = basename(nb);
    return !!ba && ba === bb;
}

/** Filter a sidecar's annotations to those belonging to `pdfUrl`, newest first. */
export function annotationsForPdf(
    annotations: PaperAnnotation[],
    pdfUrl: string | null | undefined,
): PaperAnnotation[] {
    return annotations
        .filter(a => pdfUrlsMatch(a.pdfUrl, pdfUrl))
        .sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0));
}

/**
 * Adapt a single-box region anchor (Goal 4 AC-01 — a figure/equation drag-a-box)
 * to the multi-rect {@link PaperRectAnchor} shape {@link paintAnnotationOverlay}
 * consumes, so a region highlight reuses the exact same percentage-geometry paint
 * path as a text-selection highlight.
 */
export function regionToRectAnchor(region: PaperRegionAnchor): PaperRectAnchor {
    return { page: region.page, rects: [region.rect] };
}

/** Find the rendered page wrapper for a 1-based page number under `container`. */
export function findPageForNumber(container: HTMLElement, page: number): HTMLElement | null {
    return container.querySelector<HTMLElement>(`.pdfjs-page[data-page-number="${page}"]`);
}

/** Remove every overlay box previously injected under `container`. Idempotent. */
export function clearAnnotationOverlays(container: HTMLElement | null): void {
    if (!container) {return;}
    container.querySelectorAll(`[${PAPER_OVERLAY_ATTR}]`).forEach(el => el.parentNode?.removeChild(el));
}

/**
 * Paint the geometric anchor of one annotation as absolutely-positioned overlay
 * boxes on its page. Each box is a `<button>` (keyboard/click focusable) placed
 * with percentage geometry from the normalized rects, so it lands on the same
 * pixels regardless of the render scale. Returns the created boxes (empty when
 * the page is not rendered yet or the anchor has no usable rects).
 */
export function paintAnnotationOverlay(
    container: HTMLElement,
    annotationId: string,
    position: PaperRectAnchor,
    label: string,
    onActivate: (el: HTMLElement) => void,
): HTMLElement[] {
    const doc = container.ownerDocument;
    if (!doc) {return [];}
    const pageEl = findPageForNumber(container, position.page);
    if (!pageEl) {return [];}

    const created: HTMLElement[] = [];
    for (const rect of position.rects) {
        if (!rect || (rect.width <= 0 && rect.height <= 0)) {continue;}
        const box = doc.createElement('button');
        box.setAttribute('type', 'button');
        box.setAttribute(PAPER_OVERLAY_ATTR, '');
        box.setAttribute(PAPER_OVERLAY_ID_ATTR, annotationId);
        box.setAttribute('data-testid', PAPER_OVERLAY_TESTID);
        box.setAttribute('aria-label', `Paper annotation: ${label}`);
        box.setAttribute('title', label);
        box.className = PAPER_OVERLAY_CLASS;
        box.style.position = 'absolute';
        box.style.left = `${rect.x * 100}%`;
        box.style.top = `${rect.y * 100}%`;
        box.style.width = `${rect.width * 100}%`;
        box.style.height = `${rect.height * 100}%`;
        box.addEventListener('click', ev => {
            ev.preventDefault();
            ev.stopPropagation();
            onActivate(box);
        });
        pageEl.appendChild(box);
        created.push(box);
    }
    return created;
}
