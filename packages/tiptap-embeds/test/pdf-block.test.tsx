import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import React, { useEffect } from 'react';

vi.mock('@tiptap/react', () => ({
    NodeViewWrapper: ({ children, ...props }: React.PropsWithChildren<Record<string, unknown>>) => (
        <div {...props}>{children}</div>
    ),
    ReactNodeViewRenderer: (component: unknown) => component,
}));

import { PdfBlock, classifyPdfUrl, createPdfBlock, type PdfBlockHost } from '../src/pdf/index.js';

type ViewFactory = { config: { addNodeView(): React.FC<any> } };
const viewOf = (block: unknown) => (block as ViewFactory).config.addNodeView() as React.FC<any>;
const ORIGIN = window.location.origin;

function renderBlock(block: unknown, url: string, options: Record<string, unknown> = {}) {
    const View = viewOf(block);
    return render(<View node={{ attrs: { url, label: 'Doc' } }} updateAttributes={vi.fn()} extension={{ options }} />);
}

afterEach(cleanup);

describe('classifyPdfUrl', () => {
    it('renders same-origin PDFs inline and cross-origin PDFs as links', () => {
        expect(classifyPdfUrl('files/a.pdf', 'https://app.test')).toEqual({ kind: 'inline', href: 'https://app.test/files/a.pdf' });
        expect(classifyPdfUrl('https://cdn.test/a.pdf', 'https://app.test')).toEqual({ kind: 'link', href: 'https://cdn.test/a.pdf' });
    });

    it('rejects empty, non-HTTP, credentialed and non-PDF URLs', () => {
        for (const url of ['', 'javascript:alert(1)//.pdf', 'https://u:p@cdn.test/a.pdf', 'https://app.test/a.png']) {
            expect(classifyPdfUrl(url, 'https://app.test'), url).toEqual({ kind: 'invalid' });
        }
    });
});

describe('PdfBlock (no host hooks)', () => {
    it('renders a same-origin PDF in a native iframe', () => {
        renderBlock(PdfBlock, '/files/a.pdf');
        expect(screen.getByTestId('pdf-node-view-frame').getAttribute('src')).toBe(`${ORIGIN}/files/a.pdf`);
        expect(screen.getByText('Open in new tab')).toBeInTheDocument();
    });

    it('offers a cross-origin PDF as a link only', () => {
        renderBlock(PdfBlock, 'https://cdn.test/a.pdf');
        expect(screen.queryByTestId('pdf-node-view-frame')).toBeNull();
        expect(screen.getByText('Open this PDF in a new tab').getAttribute('href')).toBe('https://cdn.test/a.pdf');
    });

    it('disables full window until the host wires a handler', () => {
        renderBlock(PdfBlock, '/files/a.pdf');
        expect(screen.getByTestId('pdf-node-view-fullwindow')).toBeDisabled();
        cleanup();
        const onRequestFullWindow = vi.fn();
        renderBlock(PdfBlock, '/files/a.pdf', { onRequestFullWindow });
        fireEvent.click(screen.getByTestId('pdf-node-view-fullwindow'));
        expect(onRequestFullWindow).toHaveBeenCalledWith({ url: `${ORIGIN}/files/a.pdf`, label: 'Doc' });
    });
});

describe('createPdfBlock host hooks', () => {
    const viewer = { fail: false };
    const host: PdfBlockHost<{ tag?: string }> = {
        classifyUrl: (url) => (url === 'ok' ? { kind: 'inline', href: `${ORIGIN}/x.pdf` } : { kind: 'invalid' }),
        isDesktopShell: () => true,
        renderViewer: function Viewer({ href, onError }) {
            return <ViewerStub href={href} onError={onError} />;
        },
        renderOverlay: ({ url, options, containerRef }) => (
            <div data-testid="overlay" data-url={url} data-tag={options.tag} data-has-container={String(!!containerRef)} />
        ),
        renderToolbarActions: ({ label }) => <button type="button">Ask {label}</button>,
    };
    function ViewerStub({ href, onError }: { href: string; onError: () => void }) {
        useEffect(() => {
            if (viewer.fail) onError();
        }, [onError]);
        return <div data-testid="viewer" data-href={href} />;
    }
    const block = createPdfBlock(host);

    afterEach(() => {
        viewer.fail = false;
    });

    it('renders the host viewer, overlay and toolbar actions', () => {
        renderBlock(block, 'ok', { tag: 'notes' });
        expect(screen.getByTestId('viewer').getAttribute('data-href')).toBe(`${ORIGIN}/x.pdf`);
        expect(screen.getByTestId('overlay').getAttribute('data-tag')).toBe('notes');
        expect(screen.getByTestId('overlay').getAttribute('data-url')).toBe('ok');
        expect(screen.getByText('Ask Doc')).toBeInTheDocument();
        expect(screen.getByText('Open in new window')).toBeInTheDocument();
        expect(screen.queryByTestId('pdf-node-view-frame')).toBeNull();
    });

    it('falls back to the iframe and drops the overlay when the viewer fails', () => {
        viewer.fail = true;
        renderBlock(block, 'ok');
        expect(screen.getByTestId('pdf-node-view-frame')).toBeInTheDocument();
        expect(screen.queryByTestId('overlay')).toBeNull();
    });

    it('uses the host URL rules', () => {
        renderBlock(block, '/files/a.pdf');
        expect(screen.getByText('Missing or unsafe PDF attachment')).toBeInTheDocument();
    });
});
