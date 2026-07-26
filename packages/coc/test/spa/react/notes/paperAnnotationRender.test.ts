/**
 * paperAnnotationRender — pure DOM primitives for painting persisted paper
 * annotations back onto a rendered pdf.js document (Goal 2 read/render half).
 *
 * jsdom has no layout, so these tests exercise the url matching, filtering, and
 * the overlay-box DOM structure (percentage geometry, click activation, clear).
 */

import { describe, expect, it, vi } from 'vitest';
import {
    annotationsForPdf,
    clearAnnotationOverlays,
    findPageForNumber,
    normalizePdfUrl,
    paintAnnotationOverlay,
    pdfUrlsMatch,
    regionToRectAnchor,
    PAPER_OVERLAY_ATTR,
    PAPER_OVERLAY_ID_ATTR,
} from '../../../../src/server/spa/client/react/features/notes/editor/extensions/paperAnnotationRender';
import type {
    PaperAnnotation,
    PaperRectAnchor,
} from '../../../../src/server/notes/paper-annotations-types';

function ann(partial: Partial<PaperAnnotation> & { id: string }): PaperAnnotation {
    return {
        createdAt: '2026-07-25T00:00:00.000Z',
        pdfUrl: 'https://arxiv.org/pdf/1802.05799',
        quote: { selectedText: 'ring all-reduce', contextBefore: 'a ', contextAfter: ' pattern' },
        answer: 'It is a bandwidth-optimal collective.',
        ...partial,
    };
}

describe('normalizePdfUrl', () => {
    it('reduces an absolute url to its lowercased pathname + search', () => {
        expect(normalizePdfUrl('https://Arxiv.org/pdf/1802.05799?x=1')).toBe('/pdf/1802.05799?x=1');
    });
    it('resolves a relative url against the document base', () => {
        // jsdom base is http://localhost/ by default.
        expect(normalizePdfUrl('paper.pdf')).toBe('/paper.pdf');
    });
    it('returns empty for empty/whitespace', () => {
        expect(normalizePdfUrl('')).toBe('');
        expect(normalizePdfUrl('   ')).toBe('');
        expect(normalizePdfUrl(undefined)).toBe('');
    });
});

describe('pdfUrlsMatch', () => {
    it('matches identical normalized urls', () => {
        expect(pdfUrlsMatch('/static/x.pdf', '/static/x.pdf')).toBe(true);
    });
    it('bridges a relative node attr and a resolved href by basename', () => {
        // inline persists the raw attr, full-window persists the resolved href.
        expect(pdfUrlsMatch('1802.05799.pdf', 'https://arxiv.org/pdf/1802.05799.pdf')).toBe(true);
    });
    it('does not match different documents', () => {
        expect(pdfUrlsMatch('/a/one.pdf', '/b/two.pdf')).toBe(false);
    });
    it('never matches when either side is empty', () => {
        expect(pdfUrlsMatch('', '/x.pdf')).toBe(false);
        expect(pdfUrlsMatch('/x.pdf', undefined)).toBe(false);
    });
});

describe('annotationsForPdf', () => {
    it('keeps only annotations for the pdf, newest first', () => {
        const list = [
            ann({ id: 'a', pdfUrl: 'https://arxiv.org/pdf/1802.05799', createdAt: '2026-07-25T01:00:00.000Z' }),
            ann({ id: 'b', pdfUrl: 'https://elsewhere/other.pdf' }),
            ann({ id: 'c', pdfUrl: 'https://arxiv.org/pdf/1802.05799', createdAt: '2026-07-25T02:00:00.000Z' }),
        ];
        const out = annotationsForPdf(list, 'https://arxiv.org/pdf/1802.05799');
        expect(out.map(a => a.id)).toEqual(['c', 'a']);
    });
});

/** Build a pdf.js-like page wrapper with a data-page-number. */
function makePage(container: HTMLElement, pageNumber: number): HTMLElement {
    const el = document.createElement('div');
    el.className = 'pdfjs-page';
    el.dataset.pageNumber = String(pageNumber);
    container.appendChild(el);
    return el;
}

const POSITION: PaperRectAnchor = {
    page: 2,
    rects: [
        { x: 0.1, y: 0.2, width: 0.3, height: 0.05 },
        { x: 0.1, y: 0.26, width: 0.2, height: 0.05 },
    ],
};

describe('paintAnnotationOverlay', () => {
    it('paints one absolutely-positioned box per rect on the right page', () => {
        const container = document.createElement('div');
        makePage(container, 1);
        const page2 = makePage(container, 2);
        const onActivate = vi.fn();

        const boxes = paintAnnotationOverlay(container, 'ann-1', POSITION, 'ring all-reduce', onActivate);

        expect(boxes).toHaveLength(2);
        expect(page2.querySelectorAll(`[${PAPER_OVERLAY_ATTR}]`)).toHaveLength(2);
        const first = boxes[0];
        expect(first.getAttribute(PAPER_OVERLAY_ID_ATTR)).toBe('ann-1');
        expect(first.style.left).toBe('10%');
        expect(first.style.top).toBe('20%');
        expect(first.style.width).toBe('30%');
        expect(first.style.height).toBe('5%');
    });

    it('activates on click', () => {
        const container = document.createElement('div');
        makePage(container, 2);
        const onActivate = vi.fn();
        const [box] = paintAnnotationOverlay(container, 'ann-1', POSITION, 'x', onActivate);
        box.click();
        expect(onActivate).toHaveBeenCalledWith(box);
    });

    it('returns [] when the page is not rendered yet', () => {
        const container = document.createElement('div');
        makePage(container, 1);
        const boxes = paintAnnotationOverlay(container, 'ann-1', POSITION, 'x', vi.fn());
        expect(boxes).toEqual([]);
    });

    it('skips zero-size rects', () => {
        const container = document.createElement('div');
        makePage(container, 2);
        const boxes = paintAnnotationOverlay(
            container,
            'ann-1',
            { page: 2, rects: [{ x: 0.1, y: 0.2, width: 0, height: 0 }] },
            'x',
            vi.fn(),
        );
        expect(boxes).toEqual([]);
    });
});

describe('regionToRectAnchor', () => {
    it('wraps a single region box into a one-rect page anchor', () => {
        const anchor = regionToRectAnchor({
            page: 3,
            rect: { x: 0.2, y: 0.3, width: 0.4, height: 0.1 },
        });
        expect(anchor.page).toBe(3);
        expect(anchor.rects).toEqual([{ x: 0.2, y: 0.3, width: 0.4, height: 0.1 }]);
    });

    it('produces an anchor the overlay painter accepts', () => {
        const container = document.createElement('div');
        makePage(container, 1);
        const boxes = paintAnnotationOverlay(
            container,
            'r1',
            regionToRectAnchor({ page: 1, rect: { x: 0.1, y: 0.1, width: 0.5, height: 0.2 } }),
            'Figure region',
            vi.fn(),
        );
        expect(boxes).toHaveLength(1);
        expect(boxes[0].style.width).toBe('50%');
    });
});

describe('clearAnnotationOverlays + findPageForNumber', () => {
    it('removes all overlay boxes and is idempotent', () => {
        const container = document.createElement('div');
        makePage(container, 2);
        paintAnnotationOverlay(container, 'ann-1', POSITION, 'x', vi.fn());
        expect(container.querySelectorAll(`[${PAPER_OVERLAY_ATTR}]`)).toHaveLength(2);
        clearAnnotationOverlays(container);
        expect(container.querySelectorAll(`[${PAPER_OVERLAY_ATTR}]`)).toHaveLength(0);
        clearAnnotationOverlays(container); // no-op
        expect(container.querySelectorAll(`[${PAPER_OVERLAY_ATTR}]`)).toHaveLength(0);
    });

    it('finds a page by number', () => {
        const container = document.createElement('div');
        makePage(container, 1);
        const p3 = makePage(container, 3);
        expect(findPageForNumber(container, 3)).toBe(p3);
        expect(findPageForNumber(container, 9)).toBeNull();
    });
});
