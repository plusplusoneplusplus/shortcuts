/**
 * PdfJsRenderer — renders an inline PDF via pdf.js (canvas + transparent,
 * selectable text layer) in place of the native `<iframe>` (Goal 0 AC-01).
 *
 * The heavy lifting lives in {@link renderPdfDocument}; this component owns the
 * React lifecycle: it mounts a scroll container, kicks off a render on
 * mount / url change, aborts + tears down the pdf.js document on unmount, and
 * calls {@link onError} if the document fails to load so the host can fall back
 * to the iframe. Selection works because the text layer is real host DOM, not
 * an opaque iframe.
 */
import { useEffect, useRef, useState } from 'react';
import { renderPdfDocument, isLikelyImageOnly, type PdfRenderHandle } from './pdfJsLoader';

export interface PdfJsRendererProps {
    /** Same-origin, inline-classified PDF URL. */
    url: string;
    /** Filename/label, used for the aria-label of the reading surface. */
    label: string;
    /** Optional fixed viewport height (px); scrolls internally when set. */
    height?: number | null;
    /**
     * Render scale (zoom). Defaults to {@link DEFAULT_PDF_SCALE} in the loader
     * when omitted; a change re-renders the document at the new size.
     */
    scale?: number;
    /**
     * Called when the document cannot be rendered by pdf.js. The host
     * (PdfBlockView) uses this to fall back to the native iframe so a broken or
     * unsupported PDF still shows something.
     */
    onError?: () => void;
}

export function PdfJsRenderer({ url, label, height, scale, onError }: PdfJsRendererProps) {
    const containerRef = useRef<HTMLDivElement>(null);
    const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
    // True once a rendered document is found to have no selectable text
    // (scanned / image-only). Drives the "no selectable text" notice (AC-04).
    const [imageOnly, setImageOnly] = useState(false);

    useEffect(() => {
        const container = containerRef.current;
        if (!container) return;

        const controller = new AbortController();
        let handle: PdfRenderHandle | null = null;
        let cancelled = false;

        // Clear any pages from a prior url before re-rendering.
        container.replaceChildren();
        setStatus('loading');
        setImageOnly(false);

        renderPdfDocument({
            url,
            container,
            scale,
            signal: controller.signal,
            onPageRendered: () => {
                if (!cancelled) setStatus('ready');
            },
            onTextStats: (stats) => {
                if (!cancelled) setImageOnly(isLikelyImageOnly(stats));
            },
        })
            .then((h) => {
                handle = h;
                if (cancelled) h.destroy();
                else setStatus((s) => (s === 'loading' ? 'ready' : s));
            })
            .catch(() => {
                if (cancelled) return;
                setStatus('error');
                onError?.();
            });

        return () => {
            cancelled = true;
            controller.abort();
            handle?.destroy();
        };
    }, [url, scale, onError]);

    return (
        <div
            className="pdfjs-render-viewport"
            data-testid="pdfjs-render-viewport"
            data-status={status}
            data-text-layer={imageOnly ? 'empty' : undefined}
            style={height ? { height: `${height}px` } : undefined}
        >
            {imageOnly && status === 'ready' && (
                <div
                    className="pdfjs-render-notice"
                    data-testid="pdfjs-image-only-notice"
                    role="status"
                >
                    No selectable text — this looks like a scanned or image-only PDF,
                    so highlighting and Ask AI aren’t available here.
                </div>
            )}
            <div
                ref={containerRef}
                className="pdfjs-render-pages"
                data-testid="pdfjs-render-pages"
                role="document"
                aria-label={label}
            />
            {status === 'loading' && (
                <div className="pdfjs-render-status" data-testid="pdfjs-render-loading">
                    Loading PDF…
                </div>
            )}
        </div>
    );
}
