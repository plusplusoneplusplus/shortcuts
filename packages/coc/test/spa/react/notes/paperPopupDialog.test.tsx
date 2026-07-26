/**
 * paperPopupDialog.test.tsx — paper-link-embed AC-04 (⛶ Popout maximized modal).
 *
 * Clicking ⛶ Popout on a decorated paper link opens a maximized modal. This
 * component resolves the paper to a pdf.js-loadable target (arXiv → ingest →
 * cached PDF; direct `.pdf` → the href) and then delegates to the shared
 * PdfPopupDialog. While resolving it shows a loading modal; a resolution failure
 * shows an error with an "open in a new tab" escape hatch; `paper === null`
 * renders nothing (closed / unmounted).
 */

// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

// Force desktop layout so the Dialog renders its ✕ close button deterministically.
vi.mock('../../../../src/server/spa/client/react/hooks/ui/useBreakpoint', () => ({
    useBreakpoint: () => ({ isMobile: false, isTablet: false, isDesktop: true, breakpoint: 'desktop' }),
}));

// Stub the pdf.js renderer so the delegated PdfPopupDialog never loads the real
// (browser-only) pdf.js library.
vi.mock(
    '../../../../src/server/spa/client/react/features/notes/editor/extensions/PdfJsRenderer',
    () => ({
        PdfJsRenderer: (props: any) => (
            <div data-testid="pdfjs-render-viewport" data-url={props.url} aria-label={props.label} />
        ),
    }),
);

import { PaperPopupDialog } from '../../../../src/server/spa/client/react/features/notes/editor/extensions/PaperPopupDialog';
import type { PaperLinkInfo } from '../../../../src/server/spa/client/react/features/notes/editor/extensions/paperLink';

const ARXIV: PaperLinkInfo = {
    kind: 'arxiv',
    href: 'https://arxiv.org/pdf/2104.04473',
    arxiv: {
        arxivId: '2104.04473',
        arxivIdBase: '2104.04473',
        pdfUrl: 'https://arxiv.org/pdf/2104.04473',
        absUrl: 'https://arxiv.org/abs/2104.04473',
        filename: '2104.04473',
    } as any,
};

const CACHE_URL = '/api/workspaces/ws1/notes/image?path=.papers%2F2104.04473.pdf';

beforeEach(() => {
    vi.restoreAllMocks();
});

describe('PaperPopupDialog', () => {
    it('renders nothing when paper is null', () => {
        render(<PaperPopupDialog paper={null} resolveSource={vi.fn()} onClose={vi.fn()} />);
        expect(screen.queryByTestId('dialog-overlay')).toBeNull();
        expect(screen.queryByTestId('paper-popup-loading')).toBeNull();
    });

    it('shows a loading modal while the paper resolves, then delegates to the PDF reader (AC-04)', async () => {
        // A resolver that never settles keeps us in the loading state.
        let resolve!: (v: { url: string; label: string }) => void;
        const resolveSource = vi.fn(
            () => new Promise<{ url: string; label: string }>((r) => { resolve = r; }),
        );
        render(<PaperPopupDialog paper={ARXIV} resolveSource={resolveSource} onClose={vi.fn()} />);

        expect(screen.getByTestId('paper-popup-loading')).toBeTruthy();
        expect(screen.queryByTestId('pdfjs-render-viewport')).toBeNull();

        resolve({ url: CACHE_URL, label: '2104.04473' });
        // Resolved → the delegated PdfPopupDialog renders the cached PDF via pdf.js.
        const viewport = await screen.findByTestId('pdfjs-render-viewport');
        expect(viewport.getAttribute('data-url')).toBe(CACHE_URL);
        expect(screen.queryByTestId('paper-popup-loading')).toBeNull();
    });

    it('shows an error with a new-tab escape hatch when resolution fails', async () => {
        const resolveSource = vi.fn(() => Promise.reject(new Error('ingest failed')));
        render(<PaperPopupDialog paper={ARXIV} resolveSource={resolveSource} onClose={vi.fn()} />);

        const link = (await screen.findByRole('link', { name: /open it in a new tab/i })) as HTMLAnchorElement;
        // AC-05 rule: the escape hatch opens the original source URL, not the cache path.
        expect(link.getAttribute('href')).toBe(ARXIV.href);
        expect(screen.queryByTestId('pdfjs-render-viewport')).toBeNull();
    });

    it('calls resolveSource with the paper info', () => {
        const resolveSource = vi.fn(() => new Promise<{ url: string; label: string }>(() => {}));
        render(<PaperPopupDialog paper={ARXIV} resolveSource={resolveSource} onClose={vi.fn()} />);
        expect(resolveSource).toHaveBeenCalledWith(ARXIV);
    });

    it('closes on ✕ (AC-04)', async () => {
        const onClose = vi.fn();
        const resolveSource = vi.fn(() => Promise.resolve({ url: CACHE_URL, label: '2104.04473' }));
        render(<PaperPopupDialog paper={ARXIV} resolveSource={resolveSource} onClose={onClose} />);
        await screen.findByTestId('pdfjs-render-viewport');
        fireEvent.click(screen.getByTestId('dialog-close-btn'));
        expect(onClose).toHaveBeenCalledTimes(1);
    });

    it('uses the maximized panel size (AC-04)', async () => {
        const resolveSource = vi.fn(() => Promise.resolve({ url: CACHE_URL, label: '2104.04473' }));
        render(<PaperPopupDialog paper={ARXIV} resolveSource={resolveSource} onClose={vi.fn()} />);
        await waitFor(() => {
            const panel = screen.getByTestId('pdf-popup-frame-wrap').closest('div.relative') as HTMLElement;
            expect(panel.className).toContain('max-w-[96vw]');
        });
    });
});
