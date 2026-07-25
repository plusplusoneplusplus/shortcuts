/**
 * PdfPopupDialog — the ⛶ full-window overlay for PDF note embeds (AC-02/AC-03).
 *
 * Bridges the PdfBlock node view to the React world, mirroring
 * {@link YouTubePopupDialog}: RichEditorCore holds a `popupPdf` state, the
 * embed's ⛶ button (via the PdfBlock `onRequestFullWindow` option) sets it, and
 * this component renders the shared {@link Dialog} with the PDF `<iframe>`
 * filling the app window's width and height.
 *
 * Rendering is fully gated on `pdf`: when it is `null` the component returns
 * `null`, so closing the dialog unmounts the iframe.
 *
 * AC-03: link-only (cross-origin) PDFs still attempt to render in the iframe; a
 * persistent "Open in a new tab" fallback link is shown for the case the
 * browser blocks embedding.
 */

import { Dialog } from '../../../../ui/Dialog';

export interface PdfPopupTarget {
    /** The (already-classified, safe) PDF URL to render in the iframe. */
    url: string;
    /** The filename/label shown in the overlay header. */
    label: string;
}

export interface PdfPopupDialogProps {
    /** The PDF to show full-window, or `null` to keep the dialog closed / unmounted. */
    pdf: PdfPopupTarget | null;
    /** Called when the reader dismisses the dialog (backdrop / ✕ / Esc). */
    onClose: () => void;
}

export function PdfPopupDialog({ pdf, onClose }: PdfPopupDialogProps) {
    // Gate on the target so a close (pdf → null) unmounts the iframe.
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
            <div className="md-pdf-popup-frame-wrap" data-testid="pdf-popup-frame-wrap">
                <iframe
                    className="md-pdf-popup-frame"
                    data-testid="pdf-popup-frame"
                    src={pdf.url}
                    title={pdf.label}
                />
                <div className="pdf-node-view-fallback">
                    If the PDF does not display,{' '}
                    <a href={pdf.url} target="_blank" rel="noopener noreferrer">open it in a new tab</a>.
                </div>
            </div>
        </Dialog>
    );
}
