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
    MIN_SELECTABLE_TEXT_CHARS,
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
});

afterEach(() => {
    getContextSpy.mockRestore();
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

    it('renders one canvas + text layer per page with the scale-factor variable', async () => {
        const container = document.createElement('div');
        await renderPdfDocument({ url: '/x.pdf', container });

        const pages = container.querySelectorAll('.pdfjs-page');
        expect(pages).toHaveLength(2);
        expect(container.querySelectorAll('canvas.pdfjs-page-canvas')).toHaveLength(2);
        expect(container.querySelectorAll('div.textLayer')).toHaveLength(2);
        expect((pages[0] as HTMLElement).style.getPropertyValue('--scale-factor')).toBe(
            String(DEFAULT_PDF_SCALE),
        );
        expect((pages[0] as HTMLElement).dataset.pageNumber).toBe('1');
        // Text layer is constructed from the streamed text content.
        expect(state.textLayerCtor).toHaveBeenCalledTimes(2);
        expect(state.textLayerRender).toHaveBeenCalledTimes(2);
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

    it('reports progress after each page', async () => {
        const onPageRendered = vi.fn();
        const container = document.createElement('div');
        await renderPdfDocument({ url: '/x.pdf', container, onPageRendered });
        expect(onPageRendered).toHaveBeenNthCalledWith(1, 1, 2);
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
        // Both page wrappers exist; page 2's text layer still renders.
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

    it('stops rendering pages once the signal is aborted', async () => {
        const controller = new AbortController();
        let firstPage = true;
        state.numPages = 3;
        state.getPageImpl = () => {
            if (!firstPage) {
                // Abort before the second page is fetched.
                controller.abort();
            }
            firstPage = false;
            return Promise.resolve(makePage());
        };
        const container = document.createElement('div');
        await renderPdfDocument({ url: '/x.pdf', container, signal: controller.signal });
        // Page 1 rendered, then abort halted the loop before page 3.
        expect(container.querySelectorAll('.pdfjs-page').length).toBeLessThan(3);
        expect(state.docDestroy).toHaveBeenCalled();
    });

    it('reports the summed text length across pages once rendering completes', async () => {
        state.numPages = 2;
        state.textLayerText = 'Hello world'; // 11 chars per page
        const onTextStats = vi.fn();
        const container = document.createElement('div');
        await renderPdfDocument({ url: '/x.pdf', container, onTextStats });
        expect(onTextStats).toHaveBeenCalledTimes(1);
        expect(onTextStats).toHaveBeenCalledWith({
            totalTextLength: 22,
            totalPages: 2,
            pagesRendered: 2,
        });
        // A document with real text is not image-only.
        expect(isLikelyImageOnly(onTextStats.mock.calls[0][0])).toBe(false);
    });

    it('reports zero text for a scanned / image-only document (empty text layers)', async () => {
        state.numPages = 3;
        state.textLayerText = ''; // pages draw but produce no selectable text
        const onTextStats = vi.fn();
        const container = document.createElement('div');
        await renderPdfDocument({ url: '/x.pdf', container, onTextStats });
        const stats = onTextStats.mock.calls[0][0];
        expect(stats).toEqual({ totalTextLength: 0, totalPages: 3, pagesRendered: 3 });
        expect(isLikelyImageOnly(stats)).toBe(true);
    });

    it('ignores whitespace-only text layers when measuring selectable text', async () => {
        state.numPages = 1;
        state.textLayerText = '   \n\t  ';
        const onTextStats = vi.fn();
        const container = document.createElement('div');
        await renderPdfDocument({ url: '/x.pdf', container, onTextStats });
        expect(onTextStats.mock.calls[0][0].totalTextLength).toBe(0);
    });

    it('does not report text stats when the render is aborted', async () => {
        const controller = new AbortController();
        let firstPage = true;
        state.numPages = 3;
        state.getPageImpl = () => {
            if (!firstPage) controller.abort();
            firstPage = false;
            return Promise.resolve(makePage());
        };
        const onTextStats = vi.fn();
        const container = document.createElement('div');
        await renderPdfDocument({ url: '/x.pdf', container, signal: controller.signal, onTextStats });
        expect(onTextStats).not.toHaveBeenCalled();
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
