/**
 * pdfPopupDialog.test.tsx — AC-02/AC-03/AC-04 (full-window PDF overlay).
 *
 * The ⛶ full-window button on a PDF embed opens the shared Dialog with the PDF
 * `<iframe>` filling the app window. Gating on the target means closing the
 * dialog unmounts the iframe. A persistent fallback link covers the cross-origin
 * case where the browser blocks embedding (AC-03).
 */

// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { useState } from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { PdfPopupDialog } from '../../../../src/server/spa/client/react/features/notes/editor/extensions/PdfPopupDialog';

// Force desktop layout so the Dialog renders its ✕ close button deterministically.
vi.mock('../../../../src/server/spa/client/react/hooks/ui/useBreakpoint', () => ({
    useBreakpoint: () => ({ isMobile: false, isTablet: false, isDesktop: true, breakpoint: 'desktop' }),
}));

const PDF = { url: 'https://app.example/api/workspaces/ws1/notes/image?path=x.pdf', label: 'sample.pdf' };

describe('PdfPopupDialog', () => {
    it('renders nothing (no dialog, no iframe) when pdf is null', () => {
        render(<PdfPopupDialog pdf={null} onClose={vi.fn()} />);
        expect(screen.queryByTestId('dialog-overlay')).toBeNull();
        expect(document.querySelector('iframe')).toBeNull();
    });

    it('opens a Dialog whose header shows the filename and an iframe for the PDF url', () => {
        render(<PdfPopupDialog pdf={PDF} onClose={vi.fn()} />);

        expect(screen.getByTestId('dialog-overlay')).toBeTruthy();
        // AC-02: header bar shows the filename/label.
        expect(screen.getByRole('heading', { name: 'sample.pdf' })).toBeTruthy();
        const iframe = screen.getByTestId('pdf-popup-frame') as HTMLIFrameElement;
        expect(iframe.getAttribute('src')).toBe(PDF.url);
        expect(iframe.getAttribute('title')).toBe('sample.pdf');
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

    it('removes the iframe from the DOM when closed (AC-04)', () => {
        function Harness() {
            const [pdf, setPdf] = useState<typeof PDF | null>(PDF);
            return <PdfPopupDialog pdf={pdf} onClose={() => setPdf(null)} />;
        }
        render(<Harness />);
        expect(document.querySelector('iframe')).toBeTruthy();

        fireEvent.click(screen.getByTestId('dialog-close-btn'));
        expect(document.querySelector('iframe')).toBeNull();
    });
});
