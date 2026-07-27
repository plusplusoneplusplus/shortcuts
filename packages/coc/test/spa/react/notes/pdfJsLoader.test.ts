import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The pdf.js library is browser-only (touches DOMMatrix, workers, etc.), so we
 * mock the legacy build entirely and assert the loader's orchestration:
 * worker-src configuration, per-page canvas + text-layer construction, the
 * `--scale-factor` variable pdf.js 4.x needs, resilience to a single bad page,
 * and abort/destroy teardown.
 */

interface FakePage {
    getViewport: ReturnType<typeof vi.fn>;
    render: ReturnType<typeof vi.fn>;
    streamTextContent: ReturnType<typeof vi.fn>;
    getTextContent: ReturnType<typeof vi.fn>;
}

const state = vi.hoisted(() => ({
    // Configurable fake pdf.js surface, reset per test.
    workerSrc: '',
    numPages: 2,
    getPageImpl: null as null | ((n: number) => Promise<FakePage>),
    getDocumentReject: false,
    // Text the mock TextLayer writes into each page's container on render, so
    // the loader's text-length accumulation (image-only detection) is exercised.
    textLayerText: '',
    textLayerCtor: vi.fn(),
    textLayerRender: vi.fn().mockResolvedValue(undefined),
    docDestroy: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('pdfjs-dist/legacy/build/pdf.mjs', () => {
    class TextLayer {
        container: HTMLElement;
        constructor(opts: { container: HTMLElement }) {
            state.textLayerCtor(opts);
            this.container = opts.container;
        }
        render() {
            // Real pdf.js appends transparent glyph spans; for detection we only
            // care about the resulting textContent, so set it directly.
            if (state.textLayerText) this.container.textContent = state.textLayerText;
            return state.textLayerRender();
        }
    }
    return {
        GlobalWorkerOptions: {
            get workerSrc() {
                return state.workerSrc;
            },
            set workerSrc(v: string) {
                state.workerSrc = v;
            },
        },
        getDocument: () => ({
            promise: state.getDocumentReject
                ? Promise.reject(new Error('load failed'))
                : Promise.resolve({
                      numPages: state.numPages,
                      getPage: (n: number) => state.getPageImpl!(n),
                      destroy: state.docDestroy,
                  }),
        }),
        TextLayer,
    };
});

import {
    renderPdfDocument,
    isLikelyImageOnly,
    clampPdfScale,
    MIN_SELECTABLE_TEXT_CHARS,
    MIN_PDF_SCALE,
    MAX_PDF_SCALE,
    PDF_WORKER_URL,
    DEFAULT_PDF_SCALE,
} from '../../../../src/server/spa/client/react/features/notes/editor/extensions/pdfJsLoader';

function makePage(overrides: Partial<FakePage> = {}): FakePage {
    return {
        getViewport: vi.fn(() => ({ width: 200, height: 300 })),
        render: vi.fn(() => ({ promise: Promise.resolve() })),
        streamTextContent: vi.fn(() => ({ source: 'stream' })),
        getTextContent: vi.fn(() => Promise.resolve({})),
        ...overrides,
    };
}

/**
 * Lazy rendering paints a page only when its wrapper scrolls near the viewport.
 * jsdom has no real IntersectionObserver, so we install a controllable mock: it
 * records observed elements and exposes {@link triggerIntersections} to simulate
 * a page scrolling into view (i.e. the reader scrolling down the paper).
 */
class MockIntersectionObserver {
    cb: (entries: Array<{ target: Element; isIntersecting: boolean }>, o: unknown) => void;
    root: Element | Document | null;
    rootMargin: string;
    observed = new Set<Element>();
    constructor(
        cb: (entries: Array<{ target: Element; isIntersecting: boolean }>, o: unknown) => void,
        opts?: { root?: Element | Document | null; rootMargin?: string },
    ) {
        this.cb = cb;
        this.root = opts?.root ?? null;
        this.rootMargin = opts?.rootMargin ?? '';
        ioInstances.push(this);
    }
    observe(el: Element) {
        this.observed.add(el);
    }
    unobserve(el: Element) {
        this.observed.delete(el);
    }
    disconnect() {
        this.observed.clear();
        this.disconnected = true;
    }
    takeRecords() {
        return [];
    }
    disconnected = false;
}

let ioInstances: MockIntersectionObserver[] = [];

/** Fire `isIntersecting: true` for every element currently observed — the test
 *  equivalent of the whole document scrolling into view. */
function triggerIntersections() {
    for (const o of ioInstances) {
        const els = [...o.observed];
        if (els.length) o.cb(els.map((target) => ({ target, isIntersecting: true })), o);
    }
}

/** Flush the microtask + macrotask queues so async page renders settle. The
 *  generous count also covers the eager-with-yield fallback, which awaits a
 *  timer between each page. */
async function flush() {
    for (let i = 0; i < 12; i++) await new Promise((resolve) => setTimeout(resolve, 0));
}

let getContextSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
    state.workerSrc = '';
    state.numPages = 2;
    state.getDocumentReject = false;
    state.textLayerText = '';
    state.getPageImpl = () => Promise.resolve(makePage());
    state.textLayerCtor.mockClear();
    state.textLayerRender.mockClear().mockResolvedValue(undefined);
    state.docDestroy.mockClear().mockResolvedValue(undefined);
    // jsdom returns null from getContext; provide a fake 2d context so the
    // canvas render path executes.
    getContextSpy = vi
        .spyOn(HTMLCanvasElement.prototype, 'getContext')
        .mockReturnValue({} as unknown as CanvasRenderingContext2D);
    ioInstances = [];
    vi.stubGlobal('IntersectionObserver', MockIntersectionObserver);
});

afterEach(() => {
    getContextSpy.mockRestore();
    vi.unstubAllGlobals();
});

describe('renderPdfDocument', () => {
    it('configures the worker src to the served root path', async () => {
        const container = document.createElement('div');
        await renderPdfDocument({ url: '/x.pdf', container });
        expect(state.workerSrc).toBe(PDF_WORKER_URL);
        // The client build emits `pdf.worker.js` into `dist/`, which the router
        // serves at the site root (`path.join(staticDir, pathname)`). A
        // `/static/…` URL would map to `dist/static/pdf.worker.js` (absent) and
        // fall through to the SPA HTML, so the worker load would silently fail
        // and pdf.js would drop back to the native iframe.
        expect(PDF_WORKER_URL).toBe('/pdf.worker.js');
    });

    it('creates a sized wrapper (canvas + text layer) for every page up front', async () => {
        const container = document.createElement('div');
        await renderPdfDocument({ url: '/x.pdf', container });

        // Every page's wrapper/canvas/text-layer exists immediately so the
        // scrollbar reflects the full document — even though only page 1 paints.
        const pages = container.querySelectorAll('.pdfjs-page');
        expect(pages).toHaveLength(2);
        expect(container.querySelectorAll('canvas.pdfjs-page-canvas')).toHaveLength(2);
        expect(container.querySelectorAll('div.textLayer')).toHaveLength(2);
        expect((pages[0] as HTMLElement).style.getPropertyValue('--scale-factor')).toBe(
            String(DEFAULT_PDF_SCALE),
        );
        expect((pages[0] as HTMLElement).dataset.pageNumber).toBe('1');
        expect((pages[0] as HTMLElement).style.width).toBe('200px');
        expect((pages[0] as HTMLElement).style.height).toBe('300px');
    });

    it('paints only the first page eagerly, then the rest as they scroll into view', async () => {
        const container = document.createElement('div');
        await renderPdfDocument({ url: '/x.pdf', container });
        await flush();
        // First page painted immediately so content shows at once; page 2 waits.
        expect(state.textLayerCtor).toHaveBeenCalledTimes(1);
        expect(state.textLayerRender).toHaveBeenCalledTimes(1);

        triggerIntersections();
        await flush();
        // Scrolling page 2 into view paints it.
        expect(state.textLayerCtor).toHaveBeenCalledTimes(2);
        expect(state.textLayerRender).toHaveBeenCalledTimes(2);
    });

    it('observes every page wrapper against the scroll-container root with a lookahead margin', async () => {
        const viewport = document.createElement('div');
        const container = document.createElement('div');
        viewport.appendChild(container);
        await renderPdfDocument({ url: '/x.pdf', container });

        expect(ioInstances).toHaveLength(1);
        const io = ioInstances[0];
        // Root is the pages div's parent (the .pdfjs-render-viewport scroller).
        expect(io.root).toBe(viewport);
        expect(io.rootMargin).toContain('px');
        // Page 1 is unobserved (painted eagerly); page 2 stays observed.
        expect(io.observed.size).toBe(1);
    });

    it('passes the requested scale to the viewport and page wrapper', async () => {
        const page = makePage();
        state.numPages = 1;
        state.getPageImpl = () => Promise.resolve(page);
        const container = document.createElement('div');
        await renderPdfDocument({ url: '/x.pdf', container, scale: 2 });
        expect(page.getViewport).toHaveBeenCalledWith({ scale: 2 });
        expect((container.querySelector('.pdfjs-page') as HTMLElement).style.getPropertyValue('--scale-factor')).toBe('2');
    });

    it('reports progress as each page paints', async () => {
        const onPageRendered = vi.fn();
        const container = document.createElement('div');
        await renderPdfDocument({ url: '/x.pdf', container, onPageRendered });
        await flush();
        // First page paints eagerly.
        expect(onPageRendered).toHaveBeenNthCalledWith(1, 1, 2);
        // Second page reports only once scrolled into view.
        expect(onPageRendered).toHaveBeenCalledTimes(1);
        triggerIntersections();
        await flush();
        expect(onPageRendered).toHaveBeenNthCalledWith(2, 2, 2);
    });

    it('rejects when the document fails to load so the caller can fall back', async () => {
        state.getDocumentReject = true;
        const container = document.createElement('div');
        await expect(renderPdfDocument({ url: '/x.pdf', container })).rejects.toThrow('load failed');
    });

    it('keeps rendering remaining pages when one page throws', async () => {
        state.numPages = 2;
        state.getPageImpl = (n: number) =>
            n === 1
                ? Promise.resolve(
                      makePage({ render: vi.fn(() => ({ promise: Promise.reject(new Error('bad page')) })) }),
                  )
                : Promise.resolve(makePage());
        const container = document.createElement('div');
        await renderPdfDocument({ url: '/x.pdf', container });
        await flush();
        triggerIntersections();
        await flush();
        // Both page wrappers exist; page 1's paint threw but page 2's text layer
        // still renders once it scrolls into view.
        expect(container.querySelectorAll('.pdfjs-page')).toHaveLength(2);
        expect(state.textLayerCtor).toHaveBeenCalledTimes(1);
    });

    it('destroys the pdf document via the handle (idempotent)', async () => {
        const container = document.createElement('div');
        const handle = await renderPdfDocument({ url: '/x.pdf', container });
        handle.destroy();
        handle.destroy();
        expect(state.docDestroy).toHaveBeenCalledTimes(1);
    });

    it('bails and tears down when the signal aborts during the initial page fetch', async () => {
        const controller = new AbortController();
        state.numPages = 3;
        // Abort while fetching page 1 (the only up-front page load).
        state.getPageImpl = () => {
            controller.abort();
            return Promise.resolve(makePage());
        };
        const container = document.createElement('div');
        await renderPdfDocument({ url: '/x.pdf', container, signal: controller.signal });
        await flush();
        // Aborted before any placeholder was built or page painted.
        expect(container.querySelectorAll('.pdfjs-page').length).toBe(0);
        expect(state.textLayerCtor).not.toHaveBeenCalled();
        expect(state.docDestroy).toHaveBeenCalled();
    });

    it('reports a running text summary as pages paint', async () => {
        state.numPages = 2;
        state.textLayerText = 'Hello world'; // 11 chars per page
        const onTextStats = vi.fn();
        const container = document.createElement('div');
        await renderPdfDocument({ url: '/x.pdf', container, onTextStats });
        await flush();
        // First page painted → partial summary with the running totals so far.
        expect(onTextStats).toHaveBeenLastCalledWith({
            totalTextLength: 11,
            totalPages: 2,
            pagesRendered: 1,
        });
        // A page with real text is not image-only.
        expect(isLikelyImageOnly(onTextStats.mock.lastCall![0])).toBe(false);

        triggerIntersections();
        await flush();
        // Scrolling page 2 in accumulates the running total.
        expect(onTextStats).toHaveBeenLastCalledWith({
            totalTextLength: 22,
            totalPages: 2,
            pagesRendered: 2,
        });
    });

    it('reports zero text for a scanned / image-only document (empty text layers)', async () => {
        state.numPages = 3;
        state.textLayerText = ''; // pages draw but produce no selectable text
        const onTextStats = vi.fn();
        const container = document.createElement('div');
        await renderPdfDocument({ url: '/x.pdf', container, onTextStats });
        await flush();
        // The very first painted page already flags image-only — the host shows
        // the notice without waiting for the whole document to render.
        const first = onTextStats.mock.lastCall![0];
        expect(first).toEqual({ totalTextLength: 0, totalPages: 3, pagesRendered: 1 });
        expect(isLikelyImageOnly(first)).toBe(true);

        triggerIntersections();
        await flush();
        const stats = onTextStats.mock.lastCall![0];
        expect(stats).toEqual({ totalTextLength: 0, totalPages: 3, pagesRendered: 3 });
        expect(isLikelyImageOnly(stats)).toBe(true);
    });

    it('ignores whitespace-only text layers when measuring selectable text', async () => {
        state.numPages = 1;
        state.textLayerText = '   \n\t  ';
        const onTextStats = vi.fn();
        const container = document.createElement('div');
        await renderPdfDocument({ url: '/x.pdf', container, onTextStats });
        await flush();
        expect(onTextStats.mock.lastCall![0].totalTextLength).toBe(0);
    });

    it('does not report text stats when the render is aborted before any page paints', async () => {
        const controller = new AbortController();
        state.numPages = 3;
        state.getPageImpl = () => {
            controller.abort();
            return Promise.resolve(makePage());
        };
        const onTextStats = vi.fn();
        const container = document.createElement('div');
        await renderPdfDocument({ url: '/x.pdf', container, signal: controller.signal, onTextStats });
        await flush();
        expect(onTextStats).not.toHaveBeenCalled();
    });

    it('disconnects the observer and stops painting further pages on destroy', async () => {
        state.numPages = 3;
        const onPageRendered = vi.fn();
        const container = document.createElement('div');
        const handle = await renderPdfDocument({ url: '/x.pdf', container, onPageRendered });
        await flush();
        expect(onPageRendered).toHaveBeenCalledTimes(1); // page 1 painted eagerly

        handle.destroy();
        expect(ioInstances[0].disconnected).toBe(true);
        expect(state.docDestroy).toHaveBeenCalledTimes(1);

        // A scroll after teardown must not paint anything more.
        triggerIntersections();
        await flush();
        expect(onPageRendered).toHaveBeenCalledTimes(1);
    });

    it('stops painting pending pages once the signal aborts mid-scroll', async () => {
        state.numPages = 3;
        const controller = new AbortController();
        const onPageRendered = vi.fn();
        const container = document.createElement('div');
        await renderPdfDocument({
            url: '/x.pdf',
            container,
            signal: controller.signal,
            onPageRendered,
        });
        await flush();
        expect(onPageRendered).toHaveBeenCalledTimes(1);

        controller.abort();
        triggerIntersections();
        await flush();
        // Abort tore down the observer; no further pages paint.
        expect(onPageRendered).toHaveBeenCalledTimes(1);
    });

    it('falls back to eager (yielding) rendering when IntersectionObserver is unavailable', async () => {
        vi.stubGlobal('IntersectionObserver', undefined);
        state.numPages = 3;
        const onPageRendered = vi.fn();
        const container = document.createElement('div');
        await renderPdfDocument({ url: '/x.pdf', container, onPageRendered });
        await flush();
        // Without an observer every page still paints — just yielding between
        // pages so the main thread is never monopolised.
        expect(onPageRendered).toHaveBeenCalledTimes(3);
        expect(state.textLayerCtor).toHaveBeenCalledTimes(3);
    });
});

describe('isLikelyImageOnly', () => {
    it('flags a rendered document with no selectable text', () => {
        expect(isLikelyImageOnly({ totalTextLength: 0, totalPages: 4, pagesRendered: 4 })).toBe(true);
    });

    it('does not flag a document that has selectable text', () => {
        expect(isLikelyImageOnly({ totalTextLength: 500, totalPages: 4, pagesRendered: 4 })).toBe(false);
    });

    it('does not flag when nothing rendered (avoids a false positive on abort / empty)', () => {
        expect(isLikelyImageOnly({ totalTextLength: 0, totalPages: 0, pagesRendered: 0 })).toBe(false);
    });

    it('treats a single stray character as selectable (threshold is one char)', () => {
        expect(MIN_SELECTABLE_TEXT_CHARS).toBe(1);
        expect(isLikelyImageOnly({ totalTextLength: 1, totalPages: 2, pagesRendered: 2 })).toBe(false);
    });
});

describe('clampPdfScale', () => {
    it('keeps an in-range scale unchanged', () => {
        expect(clampPdfScale(DEFAULT_PDF_SCALE)).toBe(DEFAULT_PDF_SCALE);
        expect(clampPdfScale(2)).toBe(2);
    });

    it('clamps below the minimum up to MIN_PDF_SCALE', () => {
        expect(clampPdfScale(0)).toBe(MIN_PDF_SCALE);
        expect(clampPdfScale(-5)).toBe(MIN_PDF_SCALE);
    });

    it('clamps above the maximum down to MAX_PDF_SCALE', () => {
        expect(clampPdfScale(99)).toBe(MAX_PDF_SCALE);
    });

    it('falls back to the default for non-finite input', () => {
        expect(clampPdfScale(NaN)).toBe(DEFAULT_PDF_SCALE);
        expect(clampPdfScale(Infinity)).toBe(DEFAULT_PDF_SCALE);
    });
});
