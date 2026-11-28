/**
 * The Notes PDF block: the embeds package's `pdfBlock` node with the CoC hooks
 * filled in — the Notes-route URL rules, the pdf.js viewer, the Quick Ask /
 * region-ask / annotation overlays and the "Chat about this paper" button.
 */
import {
    PdfJsRenderer,
    createPdfBlock,
    type PdfBlockOptions as BasePdfBlockOptions,
} from '@plusplusoneplusplus/tiptap-embeds/pdf';
import { classifyPdfBlockUrl } from './pdfBlockUrl';
import { PDF_WORKER_URL } from './pdfWorker';
import { PdfQuickAskLayer } from './PdfQuickAskLayer';
import { PdfRegionAskLayer } from './PdfRegionAskLayer';
import { PdfAnnotationsLayer } from './PdfAnnotationsLayer';
import { paperTextPathFromPdfUrl } from './paperChatGrounding';
import { isDesktopShell } from '../../../../hooks/ui/useDesktopShell';

export type { PdfFullWindowRequest } from '@plusplusoneplusplus/tiptap-embeds/pdf';

export interface PdfBlockOptions extends BasePdfBlockOptions {
    /**
     * Goal 1: workspace the Quick Ask answer endpoint runs against. Threaded from
     * NoteEditor so a text-layer selection can be asked→answered. Undefined
     * disables the Quick Ask layer (e.g. non-note reuse of RichEditorCore).
     */
    workspaceId?: string;
    /**
     * Goal 2: live getter for the current note path (persistence target for
     * answered paper annotations). A getter, not a value, because the editor
     * instance survives note switches — the path must be read at write time.
     */
    getNotePath?: () => string | null | undefined;
    /** Goal 2: live getter for the current notes root id, if any. */
    getNoteRoot?: () => string | undefined;
    /**
     * Goal 3 (AC-03): the "💬 Chat about this paper" button asks the host to open
     * the Notes chat grounded on the paper's full extracted text. Receives the
     * `.papers/<id>.txt` sidecar relpath. Undefined (or a non-cached-paper embed)
     * hides the button.
     */
    onChatAboutPaper?: (paperTextRelPath: string) => void;
}

export const PdfBlock = createPdfBlock<PdfBlockOptions>({
    classifyUrl: (url) => classifyPdfBlockUrl(url, window.location.origin),
    isDesktopShell: () => isDesktopShell(),
    renderViewer: ({ href, label, height, onError }) => (
        <PdfJsRenderer url={href} workerSrc={PDF_WORKER_URL} label={label} height={height} onError={onError} />
    ),
    renderOverlay: ({ url, containerRef, options }) => {
        const layerProps = {
            containerRef,
            workspaceId: options.workspaceId,
            pdfUrl: url,
            getNotePath: options.getNotePath,
            getNoteRoot: options.getNoteRoot,
        };
        return (
            <>
                {/* Goal 1: Quick Ask over the pdf.js text layer. */}
                <PdfQuickAskLayer {...layerProps} />
                {/* Goal 4 AC-01: drag-a-box vision ask over a figure. */}
                <PdfRegionAskLayer {...layerProps} />
                {/* Goal 2: re-render persisted annotations for this PDF. */}
                <PdfAnnotationsLayer {...layerProps} />
            </>
        );
    },
    renderToolbarActions: ({ url, options }) => {
        // Goal 3 (AC-03): only cached, ingested arXiv papers have an extracted
        // `.txt` sidecar to ground on, so the chat action is offered only for those.
        const paperTextPath = paperTextPathFromPdfUrl(url);
        const onChatAboutPaper = options.onChatAboutPaper;
        if (!paperTextPath || !onChatAboutPaper) return null;
        return (
            <button
                type="button"
                className="md-pdf-embed-chat"
                data-testid="pdf-node-view-chat-about-paper"
                title="Chat about this paper"
                aria-label="Chat about this paper"
                onClick={() => onChatAboutPaper(paperTextPath)}
            >
                💬
            </button>
        );
    },
});
