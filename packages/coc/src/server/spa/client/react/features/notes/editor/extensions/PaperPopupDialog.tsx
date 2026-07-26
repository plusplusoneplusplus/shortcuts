/**
 * PaperPopupDialog — the ⛶ Popout (maximized modal) for a decorated paper link
 * (paper-link-embed, AC-04).
 *
 * Mirrors the PdfBlock ⛶ full-window flow: RichEditorCore holds a `popupPaper`
 * state, the decoration's ⛶ Popout button (via the extension's
 * `onRequestPopout` option) sets it, and this component resolves the paper to a
 * pdf.js-loadable target (arXiv → ingest → cached `.papers/<id>.pdf`; direct
 * `.pdf` → the href) and then delegates to the existing {@link PdfPopupDialog}
 * so the maximized modal, pdf.js text layer, Quick Ask, and annotation layers
 * are all reused, not rebuilt.
 *
 * While the paper is being resolved (arXiv ingest is a network round-trip) a
 * loading modal is shown at the same maximized size; a resolution failure shows
 * an error with an "open in a new tab" escape hatch. Rendering is fully gated on
 * `paper`: when it is `null` the component returns `null`, so closing unmounts
 * the reader.
 */

import { useEffect, useState } from 'react';
import { Dialog } from '../../../../ui/Dialog';
import { PdfPopupDialog, type PdfPopupTarget } from './PdfPopupDialog';
import type { PaperLinkInfo } from './paperLink';

export interface PaperPopupDialogProps {
    /** The paper to show maximized, or `null` to keep the dialog closed. */
    paper: PaperLinkInfo | null;
    /**
     * Resolve the paper to a pdf.js-loadable target ({url,label}). For arXiv this
     * ingests + caches the PDF; for a direct `.pdf` it echoes the href.
     */
    resolveSource: (info: PaperLinkInfo) => Promise<PdfPopupTarget>;
    /** Called when the reader dismisses the dialog (backdrop / ✕ / Esc). */
    onClose: () => void;
    /** Goal 1: workspace the Quick Ask answer endpoint runs against. */
    workspaceId?: string;
    /** Goal 2: current note path — persistence target for answered annotations. */
    notePath?: string | null;
    /** Goal 2: current notes root id, if any. */
    noteRoot?: string;
}

export function PaperPopupDialog({
    paper,
    resolveSource,
    onClose,
    workspaceId,
    notePath,
    noteRoot,
}: PaperPopupDialogProps) {
    const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
    const [target, setTarget] = useState<PdfPopupTarget | null>(null);

    useEffect(() => {
        if (!paper) return;
        let cancelled = false;
        setStatus('loading');
        setTarget(null);
        resolveSource(paper)
            .then((resolved) => {
                if (cancelled) return;
                setTarget(resolved);
                setStatus('ready');
            })
            .catch(() => {
                if (!cancelled) setStatus('error');
            });
        return () => {
            cancelled = true;
        };
    }, [paper, resolveSource]);

    // Gate on the target so a close (paper → null) unmounts the reader.
    if (!paper) return null;

    // Resolved → delegate to the shared full-window PDF reader (pdf.js + iframe
    // fallback + Quick Ask / annotation layers, all reused).
    if (status === 'ready' && target) {
        return (
            <PdfPopupDialog
                pdf={target}
                onClose={onClose}
                workspaceId={workspaceId}
                notePath={notePath}
                noteRoot={noteRoot}
            />
        );
    }

    return (
        <Dialog
            open
            onClose={onClose}
            title={paper.arxiv?.arxivId ?? 'Paper'}
            className="max-w-[96vw] h-[90vh]"
        >
            {status === 'error' ? (
                <div className="paper-embed-popup-error" data-testid="paper-popup-error">
                    Couldn’t load this paper.{' '}
                    <a href={paper.href} target="_blank" rel="noopener noreferrer">
                        Open it in a new tab
                    </a>
                    .
                </div>
            ) : (
                <div className="paper-embed-popup-loading" data-testid="paper-popup-loading">
                    Loading paper…
                </div>
            )}
        </Dialog>
    );
}
