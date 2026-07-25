/**
 * paperRegionCapture — turn a drag-a-box over the pdf.js canvas into a
 * figure/equation region capture (Goal 4 AC-01, client capture half).
 *
 * The text-selection Quick Ask path ({@link extractPaperRectAnchor}) can only
 * anchor to real glyphs, so a figure or an equation image has nothing to grab.
 * This module handles the other half: the reader rubber-bands a rectangle over a
 * page, and we
 *
 *   1. locate the {@link findPageElement rendered page} under the box,
 *   2. normalize the box to 0..1 page fractions (the same {@link PaperRegionAnchor}
 *      shape the sidecar persists and {@link regionToRectAnchor} re-paints), and
 *   3. rasterize just that sub-region of the page's `<canvas>` to a PNG data URL
 *      so it can be attached to a vision-capable model at ask time.
 *
 * Pure DOM + canvas (no React), so the geometry and crop are unit-testable with a
 * mocked canvas context under jsdom.
 */

import type { PaperRegionAnchor, PaperRect } from '../../../../../../../notes/paper-annotations-types';

/** A drag rectangle in viewport (client) coordinates. */
export interface RegionViewportBox {
    left: number;
    top: number;
    width: number;
    height: number;
}

/** Everything a region ask needs from one drag-a-box. */
export interface RegionCapture {
    /** Normalized `{page, rect}` anchor — persisted so the box re-highlights on reload. */
    region: PaperRegionAnchor;
    /** PNG data URL of the cropped page region — attached to the vision model. */
    image: string;
    /** Selectable page text under the region, if any — loose grounding for the prompt. */
    pageText: string;
    /** Viewport rect of the clamped box, for anchoring the input / answer popover. */
    rect: { top: number; left: number; bottom: number; right: number };
}

/**
 * Smallest drag (viewport px, in each dimension) that counts as a deliberate
 * region select rather than a stray click — both for the raw drag and for the
 * portion that actually falls on the page.
 */
export const MIN_REGION_PX = 8;

function clamp01(n: number): number {
    if (!Number.isFinite(n)) {return 0;}
    if (n < 0) {return 0;}
    if (n > 1) {return 1;}
    return n;
}

/** The rendered `.pdfjs-page` whose box contains the point (viewport coords). */
function findPageAtPoint(container: HTMLElement, x: number, y: number): HTMLElement | null {
    const pages = container.querySelectorAll<HTMLElement>('.pdfjs-page[data-page-number]');
    for (let i = 0; i < pages.length; i++) {
        const box = pages[i].getBoundingClientRect();
        if (x >= box.left && x <= box.right && y >= box.top && y <= box.bottom) {
            return pages[i];
        }
    }
    return null;
}

/**
 * Crop the sub-region `rect` (normalized 0..1 of the page) out of a page canvas
 * into a fresh canvas and return it as a PNG data URL. Returns `null` when the
 * region is empty or the 2D context / encode is unavailable (e.g. jsdom without
 * a canvas mock), so the caller can decline the ask rather than send junk.
 */
function cropPageCanvas(canvas: HTMLCanvasElement, rect: PaperRect): string | null {
    const doc = canvas.ownerDocument;
    if (!doc) {return null;}
    const sx = rect.x * canvas.width;
    const sy = rect.y * canvas.height;
    const sw = rect.width * canvas.width;
    const sh = rect.height * canvas.height;
    if (sw <= 0 || sh <= 0) {return null;}

    const out = doc.createElement('canvas');
    out.width = Math.max(1, Math.round(sw));
    out.height = Math.max(1, Math.round(sh));
    const ctx = out.getContext('2d');
    if (!ctx) {return null;}
    try {
        ctx.drawImage(canvas, sx, sy, sw, sh, 0, 0, out.width, out.height);
        const url = out.toDataURL('image/png');
        return typeof url === 'string' && url.startsWith('data:') ? url : null;
    } catch {
        // Tainted canvas (should not happen for same-origin pdf.js) or no encoder.
        return null;
    }
}

/**
 * Capture the figure/equation region described by `box` (a viewport-coordinate
 * drag rectangle) inside a pdf.js render `container`. Returns the normalized
 * anchor + a cropped PNG + the page text under it, or `null` when the box is too
 * small, falls outside every rendered page, or the crop cannot be produced.
 *
 * The box is clipped to the page it centres on, so a drag that overshoots the
 * page edge still yields a clean on-page region rather than a mis-normalized one.
 */
export function captureRegion(
    container: HTMLElement | null,
    box: RegionViewportBox,
): RegionCapture | null {
    if (!container) {return null;}
    if (box.width < MIN_REGION_PX || box.height < MIN_REGION_PX) {return null;}

    const cx = box.left + box.width / 2;
    const cy = box.top + box.height / 2;
    const pageEl = findPageAtPoint(container, cx, cy);
    if (!pageEl) {return null;}

    const page = Number(pageEl.dataset.pageNumber);
    if (!Number.isFinite(page) || page < 1) {return null;}

    const pageBox = pageEl.getBoundingClientRect();
    if (!pageBox.width || !pageBox.height) {return null;}

    // Clip the drag box to the page (never anchor beyond the page's pixels).
    const x0 = Math.max(box.left, pageBox.left);
    const y0 = Math.max(box.top, pageBox.top);
    const x1 = Math.min(box.left + box.width, pageBox.right);
    const y1 = Math.min(box.top + box.height, pageBox.bottom);
    if (x1 - x0 < MIN_REGION_PX || y1 - y0 < MIN_REGION_PX) {return null;}

    const rect: PaperRect = {
        x: clamp01((x0 - pageBox.left) / pageBox.width),
        y: clamp01((y0 - pageBox.top) / pageBox.height),
        width: clamp01((x1 - x0) / pageBox.width),
        height: clamp01((y1 - y0) / pageBox.height),
    };
    if (rect.width <= 0 || rect.height <= 0) {return null;}

    const canvas =
        pageEl.querySelector<HTMLCanvasElement>('canvas.pdfjs-page-canvas') ??
        pageEl.querySelector<HTMLCanvasElement>('canvas');
    if (!canvas) {return null;}
    const image = cropPageCanvas(canvas, rect);
    if (!image) {return null;}

    const pageText = (pageEl.querySelector('.textLayer')?.textContent ?? '').trim();

    return {
        region: { page, rect },
        image,
        pageText,
        rect: { top: y0, left: x0, bottom: y1, right: x1 },
    };
}
