/**
 * paperInlineViewer.test.tsx — paper-link-embed AC-03 (▸ Open inline, ephemeral).
 *
 * Clicking ▸ Open inline expands an in-place pdf.js viewer below the link. This
 * component resolves the paper to a pdf.js-loadable target and renders it via
 * PdfJsRenderer (selectable text layer), falling back to an iframe when pdf.js
 * cannot load the document. A ✕ close control collapses it (onClose). Loading and
 * error states are shown; the error keeps a new-tab escape hatch on the original
 * source URL.
 */

// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';

// Stub the pdf.js renderer so this test never loads the real (browser-only)
// pdf.js library. `shouldError` drives the iframe fallback.
const pdfjsStub = vi.hoisted(() => ({ shouldError: false, lastProps: null as any }));
vi.mock(
    '../../../../src/server/spa/client/react/features/notes/editor/extensions/PdfJsRenderer',
    () => ({
        PdfJsRenderer: (props: any) => {
            pdfjsStub.lastProps = props;
            React.useEffect(() => {
                if (pdfjsStub.shouldError) props.onError?.();
            }, [props.url]);
            return <div data-testid="pdfjs-render-viewport" data-url={props.url} aria-label={props.label} />;
        },
    }),
);

import { PaperInlineViewer } from '../../../../src/server/spa/client/react/features/notes/editor/extensions/PaperInlineViewer';
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

const PDF: PaperLinkInfo = { kind: 'pdf', href: 'https://example.com/paper.pdf' };
const CACHE_URL = '/api/workspaces/ws1/notes/image?path=.papers%2F2104.04473.pdf';

beforeEach(() => {
    pdfjsStub.shouldError = false;
    pdfjsStub.lastProps = null;
});

describe('PaperInlineViewer', () => {
    it('shows a loading state while the paper resolves, then renders via pdf.js (AC-03)', async () => {
        let resolve!: (v: { url: string; label: string }) => void;
        const resolveSource = vi.fn(
            () => new Promise<{ url: string; label: string }>((r) => { resolve = r; }),
        );
        render(<PaperInlineViewer info={ARXIV} resolveSource={resolveSource} onClose={vi.fn()} />);

        expect(screen.getByTestId('paper-inline-loading')).toBeTruthy();
        expect(screen.queryByTestId('pdfjs-render-viewport')).toBeNull();

        resolve({ url: CACHE_URL, label: '2104.04473' });
        const viewport = await screen.findByTestId('pdfjs-render-viewport');
        // Renders the resolved cache URL, never the arXiv source URL, through pdf.js.
        expect(viewport.getAttribute('data-url')).toBe(CACHE_URL);
        expect(screen.queryByTestId('paper-inline-loading')).toBeNull();
        expect(document.querySelector('iframe')).toBeNull();
    });

    it('falls back to an iframe when pdf.js cannot render the document', async () => {
        pdfjsStub.shouldError = true;
        const resolveSource = vi.fn(() => Promise.resolve({ url: PDF.href, label: 'paper.pdf' }));
        render(<PaperInlineViewer info={PDF} resolveSource={resolveSource} onClose={vi.fn()} />);

        const iframe = (await screen.findByTestId('paper-inline-frame')) as HTMLIFrameElement;
        expect(iframe.getAttribute('src')).toBe(PDF.href);
        expect(screen.queryByTestId('pdfjs-render-viewport')).toBeNull();
    });

    it('shows an error with a new-tab escape hatch when resolution fails', async () => {
        const resolveSource = vi.fn(() => Promise.reject(new Error('ingest failed')));
        render(<PaperInlineViewer info={ARXIV} resolveSource={resolveSource} onClose={vi.fn()} />);

        const err = await screen.findByTestId('paper-inline-error');
        const link = err.querySelector('a') as HTMLAnchorElement;
        expect(link.getAttribute('href')).toBe(ARXIV.href);
        expect(link.getAttribute('target')).toBe('_blank');
        expect(screen.queryByTestId('pdfjs-render-viewport')).toBeNull();
    });

    it('calls onClose when the ✕ close control is clicked (collapse)', () => {
        const onClose = vi.fn();
        const resolveSource = vi.fn(() => new Promise<{ url: string; label: string }>(() => {}));
        render(<PaperInlineViewer info={ARXIV} resolveSource={resolveSource} onClose={onClose} />);
        fireEvent.click(screen.getByTestId('paper-inline-close'));
        expect(onClose).toHaveBeenCalledTimes(1);
    });
});
