/**
 * paperAnchorGeometry — extract `{page, rects[]}` (the geometric half of a paper
 * annotation's dual anchor) from a live text-layer selection.
 *
 * jsdom implements neither layout nor real Selection geometry, so we build a
 * `.pdfjs-page` wrapper by hand, stub its `getBoundingClientRect`, and drive
 * `window.getSelection()` with a fake Range whose `getClientRects()` we control.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { extractPaperRectAnchor } from '../../../../src/server/spa/client/react/features/notes/editor/extensions/paperAnchorGeometry';

interface RectLike { left: number; top: number; width: number; height: number; right: number; bottom: number }

function rect(left: number, top: number, width: number, height: number): RectLike {
    return { left, top, width, height, right: left + width, bottom: top + height };
}

/**
 * Build a container holding one `.pdfjs-page` (page box 100×200 at origin
 * 10,20), and point a fake window selection at a text node inside it with the
 * given client rects.
 */
function setup(opts: {
    pageNumber?: string;
    pageBox?: RectLike;
    clientRects: RectLike[];
    /** When true, the selection lives outside the container. */
    outside?: boolean;
    collapsed?: boolean;
    rangeCount?: number;
}): HTMLElement {
    const container = document.createElement('div');
    const page = document.createElement('div');
    page.className = 'pdfjs-page';
    if (opts.pageNumber !== undefined) {page.dataset.pageNumber = opts.pageNumber;}
    const box = opts.pageBox ?? rect(10, 20, 100, 200);
    page.getBoundingClientRect = () => box as DOMRect;
    const textNode = document.createTextNode('ring all-reduce');
    page.appendChild(textNode);
    container.appendChild(page);
    document.body.appendChild(container);

    const anchorNode = opts.outside ? document.createTextNode('elsewhere') : textNode;
    if (opts.outside) {document.body.appendChild(anchorNode);}

    const fakeRange = {
        commonAncestorContainer: anchorNode,
        startContainer: anchorNode,
        getClientRects: () => opts.clientRects as unknown as DOMRectList,
    };
    vi.spyOn(window, 'getSelection').mockReturnValue({
        isCollapsed: opts.collapsed ?? false,
        rangeCount: opts.rangeCount ?? 1,
        getRangeAt: () => fakeRange,
    } as unknown as Selection);

    return container;
}

afterEach(() => {
    vi.restoreAllMocks();
    document.body.replaceChildren();
});

describe('extractPaperRectAnchor', () => {
    it('returns the page number and rects normalized to page fractions', () => {
        // Page box: left=10 top=20 width=100 height=200. A rect at (20,40) sized
        // 30×10 → x=0.1 y=0.1 width=0.3 height=0.05.
        const container = setup({ pageNumber: '3', clientRects: [rect(20, 40, 30, 10)] });
        const anchor = extractPaperRectAnchor(container);
        expect(anchor).toEqual({
            page: 3,
            rects: [{ x: 0.1, y: 0.1, width: 0.3, height: 0.05 }],
        });
    });

    it('collects one normalized box per client rect (multi-line selection)', () => {
        const container = setup({
            pageNumber: '1',
            clientRects: [rect(10, 20, 50, 10), rect(10, 30, 100, 10)],
        });
        const anchor = extractPaperRectAnchor(container)!;
        expect(anchor.rects).toHaveLength(2);
        expect(anchor.rects[0]).toEqual({ x: 0, y: 0, width: 0.5, height: 0.05 });
        expect(anchor.rects[1]).toEqual({ x: 0, y: 0.05, width: 1, height: 0.05 });
    });

    it('clamps out-of-page rects into the 0..1 range', () => {
        // A rect wider/taller than the page still normalizes but is clamped.
        const container = setup({ pageNumber: '2', clientRects: [rect(10, 20, 200, 400)] });
        const anchor = extractPaperRectAnchor(container)!;
        expect(anchor.rects[0]).toEqual({ x: 0, y: 0, width: 1, height: 1 });
    });

    it('skips zero-size rects', () => {
        const container = setup({
            pageNumber: '1',
            clientRects: [rect(20, 40, 0, 0), rect(20, 40, 30, 10)],
        });
        const anchor = extractPaperRectAnchor(container)!;
        expect(anchor.rects).toHaveLength(1);
    });

    it('drops rects whose centre falls on a different page', () => {
        // Page box is 10..110 × 20..220; this rect is far below it.
        const container = setup({ pageNumber: '1', clientRects: [rect(20, 900, 30, 10)] });
        expect(extractPaperRectAnchor(container)).toBeNull();
    });

    it('returns null for a null container', () => {
        expect(extractPaperRectAnchor(null)).toBeNull();
    });

    it('returns null when the selection is collapsed', () => {
        const container = setup({ pageNumber: '1', clientRects: [rect(20, 40, 30, 10)], collapsed: true });
        expect(extractPaperRectAnchor(container)).toBeNull();
    });

    it('returns null when there is no range', () => {
        const container = setup({ pageNumber: '1', clientRects: [rect(20, 40, 30, 10)], rangeCount: 0 });
        expect(extractPaperRectAnchor(container)).toBeNull();
    });

    it('returns null when the selection is outside the container', () => {
        const container = setup({ pageNumber: '1', clientRects: [rect(20, 40, 30, 10)], outside: true });
        expect(extractPaperRectAnchor(container)).toBeNull();
    });

    it('returns null when the selection is not inside a .pdfjs-page', () => {
        const container = document.createElement('div');
        const textNode = document.createTextNode('no page here');
        container.appendChild(textNode);
        document.body.appendChild(container);
        vi.spyOn(window, 'getSelection').mockReturnValue({
            isCollapsed: false,
            rangeCount: 1,
            getRangeAt: () => ({
                commonAncestorContainer: textNode,
                startContainer: textNode,
                getClientRects: () => [rect(0, 0, 10, 10)] as unknown as DOMRectList,
            }),
        } as unknown as Selection);
        expect(extractPaperRectAnchor(container)).toBeNull();
    });

    it('returns null when the page number is missing or invalid', () => {
        const container = setup({ pageNumber: undefined, clientRects: [rect(20, 40, 30, 10)] });
        expect(extractPaperRectAnchor(container)).toBeNull();
    });
});
