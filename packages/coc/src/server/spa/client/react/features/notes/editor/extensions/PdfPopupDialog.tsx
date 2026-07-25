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
                        <PdfJsRenderer url={pdf.url} label={pdf.label} onError={handlePdfJsError} />
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
