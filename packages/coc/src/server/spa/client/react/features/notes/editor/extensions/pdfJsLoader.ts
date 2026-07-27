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
 * How far outside the scroll viewport (in px) a page may be before we start
 * painting it. A generous margin renders the next page or two just ahead of the
 * scroll so the reader rarely sees a blank placeholder, without eagerly painting
 * the whole document (which pegs the main thread on a large paper — the freeze
 * this lazy path fixes).
 */
export const PDF_PAGE_RENDER_MARGIN_PX = 600;

/** Smallest / largest user zoom scale, and the per-click step, for the
 *  full-window reader's zoom controls. Bounds keep the canvas from collapsing
 *  to an unreadable size or ballooning into a memory-hungry render. */
export const MIN_PDF_SCALE = 0.5;
export const MAX_PDF_SCALE = 3;
export const PDF_SCALE_STEP = 0.25;

/** Clamp a requested zoom scale into the supported `[MIN, MAX]` range. */
export function clampPdfScale(value: number): number {
    if (!Number.isFinite(value)) {return DEFAULT_PDF_SCALE;}
    return Math.max(MIN_PDF_SCALE, Math.min(MAX_PDF_SCALE, value));
}

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
     * Fired after each page's text layer renders, with a running summary of how
     * much selectable text the rendered pages have produced so far. Because pages
     * now paint lazily (on scroll) rather than all up front, the summary is
     * reported incrementally: the host re-evaluates the scanned / image-only
     * heuristic (Goal 4 AC-04) as pages come in, so a text-bearing page clears the
     * notice the moment it appears. Not called for a page whose render was aborted
     * (unmount / url change).
     */
    onTextStats?: (stats: PdfTextStats) => void;
}

export interface PdfRenderHandle {
    /** Cancels rendering and releases the pdf.js document. Idempotent. */
    destroy: () => void;
}

/** Per-page bookkeeping: the placeholder wrapper (sized up front) plus the page
 *  proxy + viewport needed to paint its canvas / text layer on demand. The page
 *  proxy is fetched lazily at paint time (only page 1 is fetched up front), and
 *  the viewport starts as page 1's estimate until the real page is loaded. */
interface PdfPageSlot {
    pageNumber: number;
    page: PdfPageProxy | null;
    viewport: { width: number; height: number };
    pageEl: HTMLElement;
    canvas: HTMLCanvasElement;
    textLayerEl: HTMLElement;
    /** Guards against a double render (observer re-fire + eager first paint). */
    started: boolean;
}

/**
 * Render `url` into `container` with lazy, windowed page painting.
 *
 * Every page's `.pdfjs-page` wrapper (holding a `<canvas>` and an
 * absolutely-positioned `.textLayer` div) is created up front, sized from page
 * 1's viewport, so the scroll height / scrollbar is correct and layout is stable
 * immediately without parsing every page (the slow part of a large document). The
 * heavy work — fetching each page, canvas paint + hundreds of text-layer spans —
 * is deferred: an `IntersectionObserver` paints a page only when it scrolls near
 * the viewport (with a {@link PDF_PAGE_RENDER_MARGIN_PX} lookahead), correcting
 * its placeholder size if the real page differs, and the first page paints
 * eagerly so something shows at once. This keeps the main thread free instead of
 * pegging it by rendering an entire multi-page paper back-to-back (the
 * popout-reader freeze this replaces).
 *
 * The `--scale-factor` CSS variable pdf.js 4.x requires for text-layer geometry
 * is set on each wrapper. Rejects if the document fails to load so the caller can
 * fall back to the native iframe. Individual page failures are swallowed so a
 * single bad page does not blank the whole paper.
 */
export async function renderPdfDocument(opts: RenderPdfOptions): Promise<PdfRenderHandle> {
    const { url, container, scale = DEFAULT_PDF_SCALE, signal, onPageRendered, onTextStats } = opts;
    const pdfjs = await loadPdfjs();

    const loadingTask = pdfjs.getDocument({ url });
    let destroyed = false;
    const doc = await loadingTask.promise;

    // Cleanup callbacks (observer disconnect, in-flight render/text-layer
    // cancels) run once on teardown so an unmount / url change stops all work.
    const cleanups: Array<() => void> = [];
    const handle: PdfRenderHandle = {
        destroy: () => {
            if (destroyed) return;
            destroyed = true;
            for (const fn of cleanups.splice(0)) {
                try {
                    fn();
                } catch {
                    // Best-effort teardown: a failed cancel must not mask the rest.
                }
            }
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

    // Accumulated across the text layers that have painted so far, to detect a
    // scanned / image-only PDF: a document that draws page images but produces no
    // selectable text. Reported incrementally as pages paint (they no longer all
    // render up front), so the host's image-only heuristic updates page by page.
    let totalTextLength = 0;
    let pagesRendered = 0;
    const reportStats = () => {
        if (destroyed || signal?.aborted) return;
        onTextStats?.({ totalTextLength, totalPages: total, pagesRendered });
    };

    /** Paint a single page's canvas + text layer, fetching the pdf.js page proxy
     *  (and its true viewport) on first paint. */
    const paintSlot = async (slot: PdfPageSlot): Promise<void> => {
        try {
            if (!slot.page) {
                // Fetch the real page only now that it is needed — parsing every
                // page up front is the very cost the lazy path avoids.
                const page = await doc.getPage(slot.pageNumber);
                if (destroyed || signal?.aborted) return;
                slot.page = page;
                const viewport = page.getViewport({ scale });
                slot.viewport = viewport;
                // Correct the placeholder if this page's real size differs from the
                // page-1 estimate (rare for papers, but keeps layout exact).
                slot.pageEl.style.width = `${viewport.width}px`;
                slot.pageEl.style.height = `${viewport.height}px`;
            }
            const ctx = slot.canvas.getContext('2d');
            if (!ctx) return;
            // Size the canvas backing store only now, at paint time. Allocating it
            // for every page up front would reserve tens of MB of canvas memory for
            // pages that may never be scrolled to, slowing the initial open.
            slot.canvas.width = Math.floor(slot.viewport.width);
            slot.canvas.height = Math.floor(slot.viewport.height);
            const renderTask = slot.page.render({ canvasContext: ctx, viewport: slot.viewport });
            const cancelRender = () => renderTask.cancel?.();
            cleanups.push(cancelRender);
            await renderTask.promise;
            if (destroyed || signal?.aborted) return;
            const textLayer = new pdfjs.TextLayer({
                textContentSource: slot.page.streamTextContent({ includeMarkedContent: true }),
                container: slot.textLayerEl,
                viewport: slot.viewport,
            });
            const cancelText = () => textLayer.cancel?.();
            cleanups.push(cancelText);
            await textLayer.render();
            if (destroyed || signal?.aborted) return;
            totalTextLength += (slot.textLayerEl.textContent ?? '').trim().length;
            pagesRendered += 1;
            reportStats();
        } catch {
            // A single failed page must not abort the whole document; the
            // remaining pages still paint when scrolled into view.
        }
        onPageRendered?.(slot.pageNumber, total);
    };

    // Serial paint queue. A big scroll jump can bring several pages into the
    // render window at once; painting them concurrently piles their (main-thread)
    // canvas + text-layer work into one long task and stalls the tab. Instead we
    // drain the queue one page at a time and yield to the event loop between
    // pages, so input / paint are serviced and no single burst monopolises the
    // main thread. `started` guards against a slot being queued twice.
    const queue: PdfPageSlot[] = [];
    let draining = false;
    const drain = async (): Promise<void> => {
        if (draining) return;
        draining = true;
        try {
            while (queue.length) {
                if (destroyed || signal?.aborted) return;
                const slot = queue.shift()!;
                await paintSlot(slot);
                // Yield so a queued input/scroll/paint can run between pages.
                await new Promise((resolve) => setTimeout(resolve));
            }
        } finally {
            draining = false;
        }
    };
    const enqueue = (slot: PdfPageSlot): void => {
        if (slot.started || destroyed || signal?.aborted) return;
        slot.started = true;
        queue.push(slot);
        void drain();
    };

    // Fetch page 1 only, and use its viewport to size every placeholder at once.
    // Paper pages are near-always uniform, so the scrollbar is correct
    // immediately without parsing all pages up front (that parse is the slow part
    // of a large document). A page whose real size differs is corrected in
    // paintSlot when it scrolls into view.
    const firstPage = await doc.getPage(1);
    if (destroyed || signal?.aborted) return handle;
    const baseViewport = firstPage.getViewport({ scale });

    const slots: PdfPageSlot[] = [];
    for (let pageNumber = 1; pageNumber <= total; pageNumber++) {
        const pageEl = container.ownerDocument.createElement('div');
        pageEl.className = 'pdfjs-page';
        pageEl.dataset.pageNumber = String(pageNumber);
        pageEl.style.setProperty('--scale-factor', String(scale));
        pageEl.style.width = `${baseViewport.width}px`;
        pageEl.style.height = `${baseViewport.height}px`;

        const canvas = container.ownerDocument.createElement('canvas');
        canvas.className = 'pdfjs-page-canvas';
        // Backing store is sized lazily in paintSlot; the wrapper's fixed
        // width/height above already reserves the correct scroll space.
        pageEl.appendChild(canvas);

        const textLayerEl = container.ownerDocument.createElement('div');
        textLayerEl.className = 'textLayer';
        pageEl.appendChild(textLayerEl);

        container.appendChild(pageEl);

        slots.push({
            pageNumber,
            page: pageNumber === 1 ? firstPage : null,
            viewport: baseViewport,
            pageEl,
            canvas,
            textLayerEl,
            started: false,
        });
    }

    // Paint page 1 straight away so the reader sees content immediately.
    if (slots[0]) enqueue(slots[0]);

    // Lazily paint pages as they scroll near the viewport. The scroll container
    // is the `.pdfjs-render-viewport` ancestor (the pages div's parent); using it
    // as the observer root lets `rootMargin` prefetch the next page just before
    // it is visible. Fall back to eager-with-yield when IntersectionObserver is
    // unavailable (old runtimes) so pages still paint without freezing the tab.
    const ObserverCtor =
        typeof IntersectionObserver !== 'undefined' ? IntersectionObserver : undefined;
    if (ObserverCtor) {
        const slotByEl = new Map<Element, PdfPageSlot>();
        for (const slot of slots) slotByEl.set(slot.pageEl, slot);
        const observer = new ObserverCtor(
            (entries) => {
                for (const entry of entries) {
                    if (!entry.isIntersecting) continue;
                    const slot = slotByEl.get(entry.target);
                    if (slot) {
                        observer.unobserve(entry.target);
                        enqueue(slot);
                    }
                }
            },
            {
                root: container.parentElement instanceof HTMLElement ? container.parentElement : null,
                rootMargin: `${PDF_PAGE_RENDER_MARGIN_PX}px 0px`,
            },
        );
        cleanups.push(() => observer.disconnect());
        for (const slot of slots) observer.observe(slot.pageEl);
        // Page 1 was already queued during the sizing loop; stop observing it so
        // the observer doesn't redundantly revisit an already-painted page.
        if (slots[0]) observer.unobserve(slots[0].pageEl);
    } else {
        // No IntersectionObserver (old runtimes): queue every page. The serial,
        // yielding drain keeps the tab alive without an observer to gate paints.
        for (const slot of slots) enqueue(slot);
    }

    return handle;
}
