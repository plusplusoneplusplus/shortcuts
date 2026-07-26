/**
 * pdfPopupDialog.test.tsx — AC-02/AC-03/AC-04 (full-window PDF overlay).
 *
 * The ⛶ full-window button on a PDF embed opens the shared Dialog filling the
 * app window. Goal 0 AC-03: the reader renders through PdfJsRenderer (pdf.js
 * canvas + selectable text layer) by default, so selection works full-window;
 * the native `<iframe>` is only the fallback for PDFs pdf.js cannot render.
 * Gating on the target means closing the dialog unmounts the reader. A
 * persistent fallback link covers the cross-origin case where the browser
 * blocks embedding.
 */

// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useState } from 'react';
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';

// Force desktop layout so the Dialog renders its ✕ close button deterministically.
vi.mock('../../../../src/server/spa/client/react/hooks/ui/useBreakpoint', () => ({
    useBreakpoint: () => ({ isMobile: false, isTablet: false, isDesktop: true, breakpoint: 'desktop' }),
}));

// Stub the pdf.js renderer so this dialog test never loads the real
// (browser-only) pdf.js library. `shouldError` simulates a document that fails
// to render, which drives the iframe fallback inside PdfPopupDialog.
const pdfjsStub = vi.hoisted(() => ({ shouldError: false, lastProps: null as any }));
vi.mock(
    '../../../../src/server/spa/client/react/features/notes/editor/extensions/PdfJsRenderer',
    () => ({
        PdfJsRenderer: (props: any) => {
            pdfjsStub.lastProps = props;
            React.useEffect(() => {
                if (pdfjsStub.shouldError) props.onError?.();
            }, [props.url]);
            return (
                <div
                    data-testid="pdfjs-render-viewport"
                    data-url={props.url}
                    role="document"
                    aria-label={props.label}
                />
            );
        },
    }),
);

import { PdfPopupDialog } from '../../../../src/server/spa/client/react/features/notes/editor/extensions/PdfPopupDialog';

const PDF = { url: 'https://app.example/api/workspaces/ws1/notes/image?path=x.pdf', label: 'sample.pdf' };

beforeEach(() => {
    pdfjsStub.shouldError = false;
    pdfjsStub.lastProps = null;
});

describe('PdfPopupDialog', () => {
    it('renders nothing (no dialog, no reader) when pdf is null', () => {
        render(<PdfPopupDialog pdf={null} onClose={vi.fn()} />);
        expect(screen.queryByTestId('dialog-overlay')).toBeNull();
        expect(screen.queryByTestId('pdfjs-render-viewport')).toBeNull();
        expect(document.querySelector('iframe')).toBeNull();
    });

    it('opens a Dialog whose header shows the filename and renders the PDF via pdf.js (AC-03)', () => {
        render(<PdfPopupDialog pdf={PDF} onClose={vi.fn()} />);

        expect(screen.getByTestId('dialog-overlay')).toBeTruthy();
        // AC-02: header bar shows the filename/label.
        expect(screen.getByRole('heading', { name: 'sample.pdf' })).toBeTruthy();
        // AC-03: full-window reader is the selectable pdf.js text layer, not an iframe.
        const viewport = screen.getByTestId('pdfjs-render-viewport');
        expect(viewport.getAttribute('data-url')).toBe(PDF.url);
        expect(viewport.getAttribute('aria-label')).toBe('sample.pdf');
        expect(document.querySelector('iframe')).toBeNull();
    });

    it('falls back to the native iframe when pdf.js cannot render the document', () => {
        pdfjsStub.shouldError = true;
        render(<PdfPopupDialog pdf={PDF} onClose={vi.fn()} />);

        const iframe = screen.getByTestId('pdf-popup-frame') as HTMLIFrameElement;
        expect(iframe.getAttribute('src')).toBe(PDF.url);
        expect(iframe.getAttribute('title')).toBe('sample.pdf');
        expect(screen.queryByTestId('pdfjs-render-viewport')).toBeNull();
    });

    it('renders a persistent "open it in a new tab" fallback link (AC-03)', () => {
        render(<PdfPopupDialog pdf={PDF} onClose={vi.fn()} />);
        const link = screen.getByRole('link', { name: /open it in a new tab/i }) as HTMLAnchorElement;
        expect(link.getAttribute('href')).toBe(PDF.url);
        expect(link.getAttribute('target')).toBe('_blank');
        expect(link.getAttribute('rel')).toBe('noopener noreferrer');
    });

    it('uses a wide (non-narrow) panel so the PDF fills horizontally (AC-02)', () => {
        render(<PdfPopupDialog pdf={PDF} onClose={vi.fn()} />);
        const panel = screen.getByTestId('pdf-popup-frame-wrap').closest('div.relative') as HTMLElement;
        // Not the default narrow max-w-lg centered dialog.
        expect(panel.className).toContain('max-w-[96vw]');
        expect(panel.className).not.toContain('max-w-lg');
    });

    it('calls onClose when the dialog ✕ button is clicked (AC-04)', () => {
        const onClose = vi.fn();
        render(<PdfPopupDialog pdf={PDF} onClose={onClose} />);
        fireEvent.click(screen.getByTestId('dialog-close-btn'));
        expect(onClose).toHaveBeenCalledTimes(1);
    });

    it('calls onClose on Escape and on a backdrop click (AC-04)', () => {
        const onClose = vi.fn();
        render(<PdfPopupDialog pdf={PDF} onClose={onClose} />);

        fireEvent.keyDown(document, { key: 'Escape' });
        expect(onClose).toHaveBeenCalledTimes(1);

        fireEvent.click(screen.getByTestId('dialog-overlay'));
        expect(onClose).toHaveBeenCalledTimes(2);
    });

    it('removes the reader from the DOM when closed (AC-04)', () => {
        function Harness() {
            const [pdf, setPdf] = useState<typeof PDF | null>(PDF);
            return <PdfPopupDialog pdf={pdf} onClose={() => setPdf(null)} />;
        }
        render(<Harness />);
        expect(screen.getByTestId('pdfjs-render-viewport')).toBeTruthy();

        fireEvent.click(screen.getByTestId('dialog-close-btn'));
        expect(screen.queryByTestId('pdfjs-render-viewport')).toBeNull();
    });

    it('recovers from a prior fallback when a different PDF is opened', () => {
        function Harness() {
            const [pdf, setPdf] = useState<typeof PDF | null>(PDF);
            return (
                <div>
                    <button data-testid="swap" onClick={() => setPdf({ url: 'https://app.example/other.pdf', label: 'other.pdf' })} />
                    <PdfPopupDialog pdf={pdf} onClose={() => setPdf(null)} />
                </div>
            );
        }
        // First PDF fails pdf.js → iframe fallback.
        pdfjsStub.shouldError = true;
        render(<Harness />);
        expect(screen.getByTestId('pdf-popup-frame')).toBeTruthy();

        // A healthy second PDF should render via pdf.js again, not stay on the iframe.
        pdfjsStub.shouldError = false;
        fireEvent.click(screen.getByTestId('swap'));
        expect(screen.getByTestId('pdfjs-render-viewport').getAttribute('data-url')).toBe(
            'https://app.example/other.pdf',
        );
        expect(document.querySelector('iframe')).toBeNull();
    });
});
