import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import React from 'react';

/**
 * PdfJsRenderer owns the React lifecycle around {@link renderPdfDocument}; the
 * heavy pdf.js work is mocked so we can assert mounting, the ready/error status
 * transitions, the iframe-fallback `onError` callback, and unmount teardown
 * (abort + handle.destroy).
 */

const loader = vi.hoisted(() => ({
    render: vi.fn(),
    destroy: vi.fn(),
}));

vi.mock(
    '../../../../src/server/spa/client/react/features/notes/editor/extensions/pdfJsLoader',
    () => ({
        renderPdfDocument: (opts: any) => loader.render(opts),
        isLikelyImageOnly: (s: any) => s.pagesRendered > 0 && s.totalTextLength < 1,
        MIN_SELECTABLE_TEXT_CHARS: 1,
        PDF_WORKER_URL: '/pdf.worker.js',
        DEFAULT_PDF_SCALE: 1.5,
    }),
);

import { PdfJsRenderer } from '../../../../src/server/spa/client/react/features/notes/editor/extensions/PdfJsRenderer';

beforeEach(() => {
    loader.render.mockReset();
    loader.destroy.mockReset();
    // Default: resolves with a handle, reports one page rendered, and reports
    // a text-bearing document (so the image-only notice stays hidden).
    loader.render.mockImplementation(async (opts: any) => {
        opts.onPageRendered?.(1, 1);
        opts.onTextStats?.({ totalTextLength: 500, totalPages: 1, pagesRendered: 1 });
        return { destroy: loader.destroy };
    });
});

afterEach(() => cleanup());

describe('PdfJsRenderer', () => {
    it('renders a document surface with the label as its aria-label', async () => {
        render(<PdfJsRenderer url="/x.pdf" label="paper.pdf" />);
        const doc = screen.getByRole('document', { name: 'paper.pdf' });
        expect(doc).toBeTruthy();
        await waitFor(() =>
            expect(screen.getByTestId('pdfjs-render-viewport').getAttribute('data-status')).toBe('ready'),
        );
    });

    it('invokes renderPdfDocument with the url, a container, and an abort signal', async () => {
        render(<PdfJsRenderer url="/paper.pdf" label="p" />);
        await waitFor(() => expect(loader.render).toHaveBeenCalledTimes(1));
        const opts = loader.render.mock.calls[0][0];
        expect(opts.url).toBe('/paper.pdf');
        expect(opts.container).toBeInstanceOf(HTMLElement);
        expect(opts.signal).toBeInstanceOf(AbortSignal);
    });

    it('applies a fixed height to the viewport when provided', () => {
        render(<PdfJsRenderer url="/x.pdf" label="p" height={420} />);
        expect((screen.getByTestId('pdfjs-render-viewport') as HTMLElement).style.height).toBe('420px');
    });

    it('shows a loading indicator until the first page renders', async () => {
        let resolvePage: (() => void) | null = null;
        loader.render.mockImplementation(
            (opts: any) =>
                new Promise((resolve) => {
                    resolvePage = () => {
                        opts.onPageRendered?.(1, 1);
                        resolve({ destroy: loader.destroy });
                    };
                }),
        );
        render(<PdfJsRenderer url="/x.pdf" label="p" />);
        expect(screen.getByTestId('pdfjs-render-loading')).toBeTruthy();
        resolvePage!();
        await waitFor(() => expect(screen.queryByTestId('pdfjs-render-loading')).toBeNull());
    });

    it('calls onError and marks the surface errored when the document fails', async () => {
        loader.render.mockRejectedValue(new Error('boom'));
        const onError = vi.fn();
        render(<PdfJsRenderer url="/x.pdf" label="p" onError={onError} />);
        await waitFor(() => expect(onError).toHaveBeenCalledTimes(1));
        expect(screen.getByTestId('pdfjs-render-viewport').getAttribute('data-status')).toBe('error');
    });

    it('aborts the signal and destroys the handle on unmount', async () => {
        let capturedSignal: AbortSignal | null = null;
        loader.render.mockImplementation(async (opts: any) => {
            capturedSignal = opts.signal;
            opts.onPageRendered?.(1, 1);
            return { destroy: loader.destroy };
        });
        const { unmount } = render(<PdfJsRenderer url="/x.pdf" label="p" />);
        await waitFor(() => expect(loader.render).toHaveBeenCalled());
        unmount();
        expect(capturedSignal!.aborted).toBe(true);
        expect(loader.destroy).toHaveBeenCalled();
    });

    it('forwards the scale prop to renderPdfDocument', async () => {
        render(<PdfJsRenderer url="/x.pdf" label="p" scale={2.25} />);
        await waitFor(() => expect(loader.render).toHaveBeenCalledTimes(1));
        expect(loader.render.mock.calls[0][0].scale).toBe(2.25);
    });

    it('re-renders when the scale prop changes', async () => {
        const { rerender } = render(<PdfJsRenderer url="/x.pdf" label="p" scale={1.5} />);
        await waitFor(() => expect(loader.render).toHaveBeenCalledTimes(1));
        rerender(<PdfJsRenderer url="/x.pdf" label="p" scale={2} />);
        await waitFor(() => expect(loader.render).toHaveBeenCalledTimes(2));
        expect(loader.render.mock.calls[1][0].scale).toBe(2);
    });

    it('clears prior pages and re-renders when the url changes', async () => {
        const { rerender } = render(<PdfJsRenderer url="/a.pdf" label="p" />);
        await waitFor(() => expect(loader.render).toHaveBeenCalledTimes(1));
        rerender(<PdfJsRenderer url="/b.pdf" label="p" />);
        await waitFor(() => expect(loader.render).toHaveBeenCalledTimes(2));
        expect(loader.render.mock.calls[1][0].url).toBe('/b.pdf');
    });

    it('does not show the image-only notice for a document with selectable text', async () => {
        render(<PdfJsRenderer url="/x.pdf" label="p" />);
        await waitFor(() =>
            expect(screen.getByTestId('pdfjs-render-viewport').getAttribute('data-status')).toBe('ready'),
        );
        expect(screen.queryByTestId('pdfjs-image-only-notice')).toBeNull();
        expect(screen.getByTestId('pdfjs-render-viewport').getAttribute('data-text-layer')).toBeNull();
    });

    it('flags a scanned / image-only document with a notice and data attribute', async () => {
        loader.render.mockImplementation(async (opts: any) => {
            opts.onPageRendered?.(1, 1);
            opts.onTextStats?.({ totalTextLength: 0, totalPages: 2, pagesRendered: 2 });
            return { destroy: loader.destroy };
        });
        render(<PdfJsRenderer url="/scan.pdf" label="p" />);
        await waitFor(() =>
            expect(screen.getByTestId('pdfjs-image-only-notice')).toBeTruthy(),
        );
        expect(screen.getByTestId('pdfjs-render-viewport').getAttribute('data-text-layer')).toBe('empty');
    });

    it('clears the image-only notice when the url changes to a text PDF', async () => {
        loader.render.mockImplementationOnce(async (opts: any) => {
            opts.onPageRendered?.(1, 1);
            opts.onTextStats?.({ totalTextLength: 0, totalPages: 1, pagesRendered: 1 });
            return { destroy: loader.destroy };
        });
        const { rerender } = render(<PdfJsRenderer url="/scan.pdf" label="p" />);
        await waitFor(() => expect(screen.getByTestId('pdfjs-image-only-notice')).toBeTruthy());
        // Second render (default mock) reports real text → notice must clear.
        rerender(<PdfJsRenderer url="/text.pdf" label="p" />);
        await waitFor(() => expect(screen.queryByTestId('pdfjs-image-only-notice')).toBeNull());
    });
});
