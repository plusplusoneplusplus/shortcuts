/**
 * paperRegionCapture — Goal 4 AC-01 (client capture half) pure geometry + crop.
 *
 * Builds a fake pdf.js page (a `.pdfjs-page[data-page-number]` with a stubbed
 * bounding box, a `<canvas>` and a `.textLayer`), stubs the canvas 2D context /
 * `toDataURL`, then drives {@link captureRegion} across the box → page-fraction
 * normalization, page clipping, page selection, and the crop → PNG data URL.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { captureRegion, MIN_REGION_PX }
    from '../../../../src/server/spa/client/react/features/notes/editor/extensions/paperRegionCapture';

interface Box { left: number; top: number; width: number; height: number }

function domRect(b: Box): DOMRect {
    return {
        left: b.left,
        top: b.top,
        width: b.width,
        height: b.height,
        right: b.left + b.width,
        bottom: b.top + b.height,
        x: b.left,
        y: b.top,
        toJSON: () => ({}),
    } as DOMRect;
}

/**
 * Build a container with one or more pdf.js pages, each with a stubbed bounding
 * box. `withCanvas` / `text` control the crop + page-text extraction.
 */
function buildContainer(pages: Array<{
    page: number;
    box: Box;
    withCanvas?: boolean;
    text?: string;
}>): HTMLElement {
    const container = document.createElement('div');
    for (const p of pages) {
        const pageEl = document.createElement('div');
        pageEl.className = 'pdfjs-page';
        pageEl.dataset.pageNumber = String(p.page);
        pageEl.getBoundingClientRect = () => domRect(p.box);
        if (p.withCanvas ?? true) {
            const canvas = document.createElement('canvas');
            canvas.className = 'pdfjs-page-canvas';
            canvas.width = 800;
            canvas.height = 1000;
            pageEl.appendChild(canvas);
        }
        const tl = document.createElement('div');
        tl.className = 'textLayer';
        tl.textContent = p.text ?? '';
        pageEl.appendChild(tl);
        container.appendChild(pageEl);
    }
    document.body.appendChild(container);
    return container;
}

let getContextSpy: ReturnType<typeof vi.spyOn>;
let toDataUrlSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
    getContextSpy = vi.spyOn(HTMLCanvasElement.prototype, 'getContext')
        .mockReturnValue({ drawImage: vi.fn() } as unknown as CanvasRenderingContext2D);
    toDataUrlSpy = vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL')
        .mockReturnValue('data:image/png;base64,AAAA');
});

afterEach(() => {
    document.body.innerHTML = '';
    vi.restoreAllMocks();
});

describe('captureRegion — normalization + crop', () => {
    it('normalizes an on-page box to page fractions and crops a PNG', () => {
        const container = buildContainer([
            { page: 1, box: { left: 100, top: 50, width: 800, height: 1000 }, text: 'fig caption' },
        ]);
        // Box fully inside the page: viewport [300,250]..[500,550].
        const cap = captureRegion(container, { left: 300, top: 250, width: 200, height: 300 });
        expect(cap).not.toBeNull();
        expect(cap!.region.page).toBe(1);
        expect(cap!.region.rect).toEqual({
            x: (300 - 100) / 800,   // 0.25
            y: (250 - 50) / 1000,   // 0.20
            width: 200 / 800,       // 0.25
            height: 300 / 1000,     // 0.30
        });
        expect(cap!.image).toBe('data:image/png;base64,AAAA');
        expect(cap!.pageText).toBe('fig caption');
        expect(cap!.rect).toEqual({ top: 250, left: 300, bottom: 550, right: 500 });
    });

    it('clips a box overshooting the page edge to the page bounds', () => {
        const container = buildContainer([
            { page: 1, box: { left: 0, top: 0, width: 400, height: 400 } },
        ]);
        // Drag runs off the right + bottom edges (centre (350,350) still on-page);
        // only the on-page part [250,250]..[400,400] counts.
        const cap = captureRegion(container, { left: 250, top: 250, width: 200, height: 200 });
        expect(cap).not.toBeNull();
        expect(cap!.rect).toEqual({ top: 250, left: 250, bottom: 400, right: 400 });
        expect(cap!.region.rect).toEqual({ x: 0.625, y: 0.625, width: 0.375, height: 0.375 });
    });

    it('selects the page under the box centre when several are rendered', () => {
        const container = buildContainer([
            { page: 1, box: { left: 0, top: 0, width: 400, height: 400 } },
            { page: 2, box: { left: 0, top: 420, width: 400, height: 400 }, text: 'page two' },
        ]);
        // Centre (200, 620) lands on page 2.
        const cap = captureRegion(container, { left: 100, top: 520, width: 200, height: 200 });
        expect(cap!.region.page).toBe(2);
        expect(cap!.pageText).toBe('page two');
    });
});

describe('captureRegion — rejections', () => {
    it('returns null for a box smaller than the minimum in either dimension', () => {
        const container = buildContainer([
            { page: 1, box: { left: 0, top: 0, width: 400, height: 400 } },
        ]);
        expect(captureRegion(container, { left: 10, top: 10, width: MIN_REGION_PX - 1, height: 50 }))
            .toBeNull();
        expect(captureRegion(container, { left: 10, top: 10, width: 50, height: MIN_REGION_PX - 1 }))
            .toBeNull();
    });

    it('returns null when the box centre is outside every rendered page', () => {
        const container = buildContainer([
            { page: 1, box: { left: 0, top: 0, width: 200, height: 200 } },
        ]);
        // Centre (700, 700) is well outside the page.
        expect(captureRegion(container, { left: 600, top: 600, width: 200, height: 200 })).toBeNull();
    });

    it('returns null when the page has no canvas to crop', () => {
        const container = buildContainer([
            { page: 1, box: { left: 0, top: 0, width: 400, height: 400 }, withCanvas: false },
        ]);
        expect(captureRegion(container, { left: 50, top: 50, width: 100, height: 100 })).toBeNull();
    });

    it('returns null when the crop cannot be encoded (no 2D context)', () => {
        getContextSpy.mockReturnValue(null);
        const container = buildContainer([
            { page: 1, box: { left: 0, top: 0, width: 400, height: 400 } },
        ]);
        expect(captureRegion(container, { left: 50, top: 50, width: 100, height: 100 })).toBeNull();
    });

    it('returns null for a null container', () => {
        expect(captureRegion(null, { left: 0, top: 0, width: 100, height: 100 })).toBeNull();
    });

    it('does not crop when toDataURL yields a non-data string', () => {
        toDataUrlSpy.mockReturnValue('not-a-data-url');
        const container = buildContainer([
            { page: 1, box: { left: 0, top: 0, width: 400, height: 400 } },
        ]);
        expect(captureRegion(container, { left: 50, top: 50, width: 100, height: 100 })).toBeNull();
    });
});
