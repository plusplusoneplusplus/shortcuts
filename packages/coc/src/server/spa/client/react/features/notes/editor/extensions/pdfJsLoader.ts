/**
 * pdf.js loader — renders a PDF into a host DOM container as a stack of
 * `<canvas>` pages each overlaid by a transparent, selectable text layer
 * (Goal 0 AC-01/AC-02).
 *
 * This is the one real infra piece of the paper-reading feature: a native
 * `<iframe>` PDF viewer exposes no text or selection to the host page, so every
 * annotation system in the app (which is `container.textContent`-based) is blind
 * to it. Rendering with pdf.js gives the paper a host-accessible text layer, so
 * dragging across a passage produces a real `window.getSelection()` Range and
 * the existing Quick Ask / comment resolvers can see inside it.
 *
 * We import the **legacy** build (`pdfjs-dist/legacy/build/pdf.mjs`) rather than
 * the modern one: the modern build relies on very recent runtime features
 * (e.g. `Promise.withResolvers`) that are not guaranteed under the es2020
 * esbuild target or the desktop Electron Chromium; the legacy build is compiled
 * for older environments (AC-04).
 *
 * The pdf.js module is loaded via a dynamic `import()` so that:
 *   - the heavy (~1MB) library is referenced from exactly one place, and
 *   - unit tests can `vi.mock('pdfjs-dist/legacy/build/pdf.mjs', …)` without the
 *     real library (which touches browser-only globals) ever executing in jsdom.
 */

/**
 * URL the bundled pdf.js worker is served from. The client build
 * (`scripts/build-client.mjs`) emits `pdf.worker.js` into the client `dist/`,
 * and the dashboard router serves that directory at the site root — so the file
 * resolves at `/pdf.worker.js` (a request for `/static/pdf.worker.js` falls
 * through to the SPA HTML fallback, breaking both the real Worker and pdf.js's
 * fake-worker import). Keep this path root-relative so it matches the router's
 * static resolver (`staticDir` + pathname; see `src/server/router.ts`).
 */
export const PDF_WORKER_URL = '/pdf.worker.js';

/** Rendering scale. 1.5 keeps text crisp on HiDPI without huge canvases. */
export const DEFAULT_PDF_SCALE = 1.5;

/**
 * A rendered document with fewer than this many non-whitespace characters
 * across all of its text layers is treated as scanned / image-only: pdf.js drew
 * the page images but there is no host-selectable text, so Quick Ask and the
 * anchoring resolvers (which are `textContent`-based) have nothing to grab onto.
 * We only flag it — OCR is out of scope (Goal 4 AC-04).
 */
export const MIN_SELECTABLE_TEXT_CHARS = 1;

/** Text-extraction summary produced once a document finishes rendering. */
export interface PdfTextStats {
    /** Trimmed character count summed across every rendered text layer. */
    totalTextLength: number;
    /** Pages in the document (`doc.numPages`). */
    totalPages: number;
    /** Pages whose text layer actually finished rendering. */
    pagesRendered: number;
}

/**
 * True when a document rendered at least one page but yielded essentially no
 * selectable text — i.e. a scanned / image-only PDF. Requiring `pagesRendered`
 * > 0 avoids a false positive when nothing rendered at all (aborted / empty).
 */
export function isLikelyImageOnly(stats: PdfTextStats): boolean {
    return stats.pagesRendered > 0 && stats.totalTextLength < MIN_SELECTABLE_TEXT_CHARS;
}

/** Minimal structural subset of the pdf.js module we depend on. */
interface PdfjsModule {
    GlobalWorkerOptions: { workerSrc: string };
    getDocument: (src: unknown) => { promise: Promise<PdfDocumentProxy>; destroy?: () => void };
    // eslint-disable-next-line @typescript-eslint/naming-convention
    TextLayer: new (opts: {
        textContentSource: unknown;
        container: HTMLElement;
        viewport: unknown;
    }) => { render: () => Promise<void>; cancel?: () => void };
}

interface PdfDocumentProxy {
    numPages: number;
    getPage: (n: number) => Promise<PdfPageProxy>;
    destroy: () => Promise<void>;
}

interface PdfPageProxy {
    getViewport: (opts: { scale: number }) => { width: number; height: number };
    render: (opts: { canvasContext: CanvasRenderingContext2D; viewport: unknown }) => {
        promise: Promise<void>;
        cancel?: () => void;
    };
    streamTextContent: (opts?: Record<string, unknown>) => unknown;
    getTextContent: () => Promise<unknown>;
}

let workerConfigured = false;

async function loadPdfjs(): Promise<PdfjsModule> {
    const mod = (await import('pdfjs-dist/legacy/build/pdf.mjs')) as unknown as PdfjsModule;
    if (!workerConfigured) {
        mod.GlobalWorkerOptions.workerSrc = PDF_WORKER_URL;
        workerConfigured = true;
    }
    return mod;
}

export interface RenderPdfOptions {
    url: string;
    /** Host element the page canvases + text layers are appended into. */
    container: HTMLElement;
    scale?: number;
    /** Aborts an in-flight render (component unmount / url change). */
    signal?: AbortSignal;
    /** Notified after each page finishes so the host can react to progress. */
    onPageRendered?: (pageNumber: number, total: number) => void;
    /**
     * Fired once, after the whole document renders, with a summary of how much
     * selectable text the text layers produced. The host uses this to detect a
     * scanned / image-only PDF (Goal 4 AC-04). Not called when the render is
     * aborted (unmount / url change), since the summary would be incomplete.
     */
    onTextStats?: (stats: PdfTextStats) => void;
}

export interface PdfRenderHandle {
    /** Cancels rendering and releases the pdf.js document. Idempotent. */
    destroy: () => void;
}

/**
 * Render every page of `url` into `container`. Each page is a
 * `.pdfjs-page` wrapper holding a `<canvas>` and an absolutely-positioned
 * `.textLayer` div; the `--scale-factor` CSS variable pdf.js 4.x requires for
 * text-layer geometry is set on each wrapper.
 *
 * Rejects if the document fails to load so the caller can fall back to the
 * native iframe. Individual page failures are swallowed after the first so a
 * single bad page does not blank the whole paper.
 */
export async function renderPdfDocument(opts: RenderPdfOptions): Promise<PdfRenderHandle> {
    const { url, container, scale = DEFAULT_PDF_SCALE, signal, onPageRendered, onTextStats } = opts;
    const pdfjs = await loadPdfjs();

    const loadingTask = pdfjs.getDocument({ url });
    let destroyed = false;
    const doc = await loadingTask.promise;

    const handle: PdfRenderHandle = {
        destroy: () => {
            if (destroyed) return;
            destroyed = true;
            void doc.destroy();
        },
    };

    if (signal?.aborted || destroyed) {
        handle.destroy();
        return handle;
    }
    signal?.addEventListener('abort', handle.destroy, { once: true });

    const total = doc.numPages;
    if (total <= 0) {
        // A malformed PDF that pdf.js "recovered" into an empty document is
        // useless; surface it as a load failure so the caller shows the iframe.
        handle.destroy();
        throw new Error('PDF has no pages');
    }
    // Accumulated across text layers to detect a scanned / image-only PDF: a
    // document that draws page images but produces no selectable text.
    let totalTextLength = 0;
    let pagesRendered = 0;
    for (let pageNumber = 1; pageNumber <= total; pageNumber++) {
        if (destroyed || signal?.aborted) break;
        const page = await doc.getPage(pageNumber);
        const viewport = page.getViewport({ scale });

        const pageEl = container.ownerDocument.createElement('div');
        pageEl.className = 'pdfjs-page';
        pageEl.dataset.pageNumber = String(pageNumber);
        pageEl.style.setProperty('--scale-factor', String(scale));
        pageEl.style.width = `${viewport.width}px`;
        pageEl.style.height = `${viewport.height}px`;

        const canvas = container.ownerDocument.createElement('canvas');
        canvas.className = 'pdfjs-page-canvas';
        canvas.width = Math.floor(viewport.width);
        canvas.height = Math.floor(viewport.height);
        pageEl.appendChild(canvas);

        const textLayerEl = container.ownerDocument.createElement('div');
        textLayerEl.className = 'textLayer';
        pageEl.appendChild(textLayerEl);

        container.appendChild(pageEl);

        const ctx = canvas.getContext('2d');
        if (ctx) {
            try {
                await page.render({ canvasContext: ctx, viewport }).promise;
                const textLayer = new pdfjs.TextLayer({
                    textContentSource: page.streamTextContent({ includeMarkedContent: true }),
                    container: textLayerEl,
                    viewport,
                });
                await textLayer.render();
                totalTextLength += (textLayerEl.textContent ?? '').trim().length;
                pagesRendered += 1;
            } catch {
                // A single failed page must not abort the whole document; the
                // remaining pages still render and the caller keeps its handle.
            }
        }

        onPageRendered?.(pageNumber, total);
    }

    // Report the text summary once, but only for a render that ran to
    // completion — an aborted render (unmount / url change) has partial counts.
    if (!destroyed && !signal?.aborted) {
        onTextStats?.({ totalTextLength, totalPages: total, pagesRendered });
    }

    return handle;
}
