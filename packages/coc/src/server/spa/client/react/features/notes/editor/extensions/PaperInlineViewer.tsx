/**
 * PaperInlineViewer — ephemeral in-place PDF viewer for a decorated paper link
 * (paper-link-embed, AC-03).
 *
 * Rendered beneath a paper link's paragraph when the reader clicks ▸ Open inline.
 * It resolves the link to a renderable, pdf.js-loadable URL (for arXiv: ingest →
 * cached `.papers/<id>.pdf`; for a direct `.pdf`: the href itself) via the host's
 * {@link resolveSource} callback, then renders it through {@link PdfJsRenderer}
 * so the text layer stays host-selectable. If pdf.js cannot load the document it
 * falls back to a plain `<iframe>`; if resolution itself fails it shows an error
 * with an "open in a new tab" escape hatch.
 *
 * This view is purely ephemeral: the expand state lives in the decoration
 * plugin, never in the document, so a reload returns the link to plain text and
 * the saved `.md` is never rewritten. A ✕ close control collapses it via
 * {@link onClose}.
 */

import { useEffect, useRef, useState } from 'react';
import { PdfJsRenderer } from './PdfJsRenderer';
import type { PdfPopupTarget } from './PdfPopupDialog';
import type { PaperLinkInfo } from './paperLink';

export interface PaperInlineViewerProps {
    /** The classified paper link to render. */
    info: PaperLinkInfo;
    /**
     * Resolve the paper to a pdf.js-loadable target ({url,label}). For arXiv this
     * ingests + caches the PDF; for a direct `.pdf` it echoes the href. Rejects
     * when the paper cannot be prepared (network / ingest failure).
     */
    resolveSource: (info: PaperLinkInfo) => Promise<PdfPopupTarget>;
    /** Collapse the inline viewer back to a plain link (the ✕ / close control). */
    onClose: () => void;
}

export function PaperInlineViewer({ info, resolveSource, onClose }: PaperInlineViewerProps) {
    const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
    const [target, setTarget] = useState<PdfPopupTarget | null>(null);
    // pdf.js failed to load a *resolved* document → fall back to the iframe.
    const [pdfJsFailed, setPdfJsFailed] = useState(false);
    const frameWrapRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        let cancelled = false;
        setStatus('loading');
        setPdfJsFailed(false);
        setTarget(null);
        resolveSource(info)
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
    }, [info, resolveSource]);

    return (
        <div className="paper-embed-inline-shell" data-testid="paper-inline-viewer">
            <div className="paper-embed-inline-toolbar">
                <span className="paper-embed-inline-title" title={info.href}>
                    {target?.label ?? info.arxiv?.arxivId ?? 'Paper'}
                </span>
                <button
                    type="button"
                    className="paper-embed-inline-close"
                    data-testid="paper-inline-close"
                    title="Close inline viewer"
                    aria-label="Close inline paper viewer"
                    onClick={onClose}
                >
                    ✕
                </button>
            </div>

            {status === 'loading' && (
                <div className="paper-embed-inline-status" data-testid="paper-inline-loading">
                    Loading paper…
                </div>
            )}

            {status === 'error' && (
                <div className="paper-embed-inline-error" data-testid="paper-inline-error">
                    Couldn’t load this paper.{' '}
                    <a href={info.href} target="_blank" rel="noopener noreferrer">
                        Open it in a new tab
                    </a>
                    .
                </div>
            )}

            {status === 'ready' && target && (
                <div
                    className="paper-embed-inline-frame-wrap"
                    data-testid="paper-inline-frame-wrap"
                    ref={frameWrapRef}
                >
                    {pdfJsFailed ? (
                        <iframe
                            className="paper-embed-inline-frame"
                            data-testid="paper-inline-frame"
                            src={target.url}
                            title={target.label}
                            loading="lazy"
                        />
                    ) : (
                        <PdfJsRenderer
                            url={target.url}
                            label={target.label}
                            onError={() => setPdfJsFailed(true)}
                        />
                    )}
                    <div className="pdf-node-view-fallback">
                        If the PDF does not display,{' '}
                        <a href={info.href} target="_blank" rel="noopener noreferrer">
                            open it in a new tab
                        </a>
                        .
                    </div>
                </div>
            )}
        </div>
    );
}
