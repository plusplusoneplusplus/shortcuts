/**
 * PdfPopupDialog — the ⛶ full-window overlay for PDF note embeds (AC-02/AC-03).
 *
 * Bridges the PdfBlock node view to the React world, mirroring
 * {@link YouTubePopupDialog}: RichEditorCore holds a `popupPdf` state, the
 * embed's ⛶ button (via the PdfBlock `onRequestFullWindow` option) sets it, and
 * this component renders the shared {@link Dialog} with the PDF filling the app
 * window's width and height.
 *
 * Rendering is fully gated on `pdf`: when it is `null` the component returns
 * `null`, so closing the dialog unmounts the reader.
 *
 * Goal 0 AC-03: the full-window view renders through {@link PdfJsRenderer}
 * (pdf.js canvas + transparent text layer) exactly like the inline embed, so the
 * text layer stays host-selectable at full size — dragging across a passage
 * still yields a real `window.getSelection()` Range for Quick Ask. The native
 * `<iframe>` is kept only as a fallback for PDFs pdf.js cannot render (also the
 * cross-origin / blocked-embedding case), alongside a persistent
 * "Open in a new tab" link.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { Dialog } from '../../../../ui/Dialog';
import { PdfJsRenderer } from './PdfJsRenderer';
import {
    DEFAULT_PDF_SCALE,
    MAX_PDF_SCALE,
    MIN_PDF_SCALE,
    PDF_SCALE_STEP,
    clampPdfScale,
} from './pdfJsLoader';
import { PdfQuickAskLayer } from './PdfQuickAskLayer';
import { PdfRegionAskLayer } from './PdfRegionAskLayer';
import { PdfAnnotationsLayer } from './PdfAnnotationsLayer';

export interface PdfPopupTarget {
    /** The (already-classified, safe) PDF URL to render. */
    url: string;
    /** The filename/label shown in the overlay header. */
    label: string;
}

export interface PdfPopupDialogProps {
    /** The PDF to show full-window, or `null` to keep the dialog closed / unmounted. */
    pdf: PdfPopupTarget | null;
    /** Called when the reader dismisses the dialog (backdrop / ✕ / Esc). */
    onClose: () => void;
    /**
     * Goal 1: workspace the Quick Ask answer endpoint runs against. Enables
     * select→ask→answer over the full-window text layer; undefined disables it.
     */
    workspaceId?: string;
    /** Goal 2: current note path — persistence target for answered annotations. */
    notePath?: string | null;
    /** Goal 2: current notes root id, if any. */
    noteRoot?: string;
}

export function PdfPopupDialog({ pdf, onClose, workspaceId, notePath, noteRoot }: PdfPopupDialogProps) {
    // Container whose (pdf.js) text-layer selections raise the Quick Ask pill.
    const frameWrapRef = useRef<HTMLDivElement>(null);
    // Inline PDFs render via pdf.js (host-selectable text layer) by default;
    // fall back to the native iframe only if pdf.js fails to load the document.
    const [pdfJsFailed, setPdfJsFailed] = useState(false);
    const handlePdfJsError = useCallback(() => setPdfJsFailed(true), []);

    // User zoom for the pdf.js render. Re-rendering at a new scale keeps the text
    // layer crisp (vs. a CSS transform, which would blur the canvas and desync
    // the selectable text layer / annotation overlays).
    const [scale, setScale] = useState(DEFAULT_PDF_SCALE);
    const zoomBy = useCallback(
        (delta: number) => setScale((s) => clampPdfScale(s + delta)),
        [],
    );
    const resetZoom = useCallback(() => setScale(DEFAULT_PDF_SCALE), []);

    // Reset the fallback state when the target PDF *changes*, so a failure on one
    // paper does not force the iframe when a different paper is later opened. We
    // guard on a prev-url ref rather than resetting in the effect body directly:
    // child effects (PdfJsRenderer's onError) run before this parent effect, so
    // an unconditional reset on mount would clobber a same-render failure.
    const url = pdf?.url;
    const prevUrlRef = useRef(url);
    useEffect(() => {
        if (prevUrlRef.current !== url) {
            prevUrlRef.current = url;
            setPdfJsFailed(false);
            setScale(DEFAULT_PDF_SCALE);
        }
    }, [url]);

    // Gate on the target so a close (pdf → null) unmounts the reader.
    if (!pdf) return null;

    return (
        <Dialog
            open
            onClose={onClose}
            title={pdf.label}
            // Wide/landscape fill (AC-02): near-full app-window width and height,
            // not a narrow centered panel. The `max-w-[` token routes Dialog to
            // its width-override branch.
            className="max-w-[96vw] h-[90vh]"
        >
            <div className="md-pdf-popup-frame-wrap" data-testid="pdf-popup-frame-wrap" ref={frameWrapRef}>
                {pdfJsFailed ? (
                    <iframe
                        className="md-pdf-popup-frame"
                        data-testid="pdf-popup-frame"
                        src={pdf.url}
                        title={pdf.label}
                    />
                ) : (
                    <>
                        {/* Zoom controls for the pdf.js render. Kept out of the
                            iframe-fallback branch: a native <iframe> PDF has its
                            own viewer chrome and no host-controllable scale. */}
                        <div
                            className="pdf-popup-zoom-controls"
                            data-testid="pdf-popup-zoom-controls"
                            aria-label="PDF zoom controls"
                        >
                            <button
                                type="button"
                                data-testid="pdf-popup-zoom-out"
                                aria-label="Zoom out"
                                title="Zoom out"
                                disabled={scale <= MIN_PDF_SCALE}
                                onClick={() => zoomBy(-PDF_SCALE_STEP)}
                            >
                                −
                            </button>
                            <span
                                className="pdf-popup-zoom-level"
                                data-testid="pdf-popup-zoom-level"
                                aria-live="polite"
                            >
                                {Math.round((scale / DEFAULT_PDF_SCALE) * 100)}%
                            </span>
                            <button
                                type="button"
                                data-testid="pdf-popup-zoom-in"
                                aria-label="Zoom in"
                                title="Zoom in"
                                disabled={scale >= MAX_PDF_SCALE}
                                onClick={() => zoomBy(PDF_SCALE_STEP)}
                            >
                                +
                            </button>
                            <button
                                type="button"
                                data-testid="pdf-popup-zoom-reset"
                                aria-label="Reset zoom"
                                title="Reset zoom"
                                disabled={scale === DEFAULT_PDF_SCALE}
                                onClick={resetZoom}
                            >
                                Reset
                            </button>
                        </div>
                        <PdfJsRenderer url={pdf.url} label={pdf.label} scale={scale} onError={handlePdfJsError} />
                        {/* Goal 1: Quick Ask over the full-window pdf.js text layer.
                            Goal 2: persist answered annotations to the note sidecar. */}
                        <PdfQuickAskLayer
                            containerRef={frameWrapRef}
                            workspaceId={workspaceId}
                            pdfUrl={pdf.url}
                            getNotePath={() => notePath}
                            getNoteRoot={() => noteRoot}
                        />
                        {/* Goal 4 AC-01: drag-a-box vision ask over a figure. */}
                        <PdfRegionAskLayer
                            containerRef={frameWrapRef}
                            workspaceId={workspaceId}
                            pdfUrl={pdf.url}
                            getNotePath={() => notePath}
                            getNoteRoot={() => noteRoot}
                        />
                        {/* Goal 2: re-render persisted annotations full-window. */}
                        <PdfAnnotationsLayer
                            containerRef={frameWrapRef}
                            workspaceId={workspaceId}
                            pdfUrl={pdf.url}
                            getNotePath={() => notePath}
                            getNoteRoot={() => noteRoot}
                        />
                    </>
                )}
                <div className="pdf-node-view-fallback">
                    If the PDF does not display,{' '}
                    <a href={pdf.url} target="_blank" rel="noopener noreferrer">open it in a new tab</a>.
                </div>
            </div>
        </Dialog>
    );
}
