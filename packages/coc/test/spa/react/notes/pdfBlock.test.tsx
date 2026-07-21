import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import React from 'react';

vi.mock('@tiptap/core', () => ({
    Node: { create: (config: unknown) => config },
}));

vi.mock('@tiptap/react', () => ({
    NodeViewWrapper: ({
        children,
        ...props
    }: React.PropsWithChildren<Record<string, unknown>>) => <div {...props}>{children}</div>,
    ReactNodeViewRenderer: (component: unknown) => component,
}));

import { PdfBlock } from '../../../../src/server/spa/client/react/features/notes/editor/extensions/pdfBlock';

const pdfUrl = '/api/workspaces/ws1/notes/image?path=.attachments%2Fsample.pdf';

type ExtensionConfig = {
    parseHTML(): Array<{ tag: string; getAttrs: (el: HTMLElement) => false | { url: string; label: string } }>;
    renderHTML(args: { node: { attrs: { url: string; label: string } } }): unknown[];
};

type NodeViewConfig = ExtensionConfig & {
    addNodeView(): React.FC<any>;
};

const config = PdfBlock as unknown as ExtensionConfig;
const nodeViewConfig = PdfBlock as unknown as NodeViewConfig;
const PdfBlockView = nodeViewConfig.addNodeView() as React.FC<any>;

function makeProps(url = pdfUrl, label = 'sample.pdf', updateAttributes = vi.fn()) {
    return { node: { attrs: { url, label } }, updateAttributes } as any;
}

describe('PdfBlock parseHTML', () => {
    it('matches md-pdf-embed placeholders and extracts attrs', () => {
        const div = document.createElement('div');
        div.className = 'md-pdf-embed';
        div.setAttribute('data-pdf-url', '.attachments/sample.pdf');
        div.setAttribute('data-pdf-label', 'Sample PDF');

        const [rule] = config.parseHTML();
        expect(rule.tag).toBe('div.md-pdf-embed');
        expect(rule.getAttrs(div)).toEqual({ url: '.attachments/sample.pdf', label: 'Sample PDF' });
    });

    it('defaults the label to "PDF" when data-pdf-label is missing', () => {
        const div = document.createElement('div');
        div.className = 'md-pdf-embed';
        div.setAttribute('data-pdf-url', '.attachments/sample.pdf');

        const [rule] = config.parseHTML();
        expect(rule.getAttrs(div)).toEqual({ url: '.attachments/sample.pdf', label: 'PDF' });
    });

    it('rejects a placeholder missing data-pdf-url', () => {
        const div = document.createElement('div');
        div.className = 'md-pdf-embed';

        const [rule] = config.parseHTML();
        expect(rule.getAttrs(div)).toBe(false);
    });
});

describe('PdfBlock renderHTML', () => {
    it('round-trips to the markdown placeholder structure', () => {
        const result = config.renderHTML({ node: { attrs: { url: '.attachments/sample.pdf', label: 'Sample PDF' } } });
        expect(result).toEqual([
            'div',
            {
                class: 'md-pdf-embed',
                'data-pdf-url': '.attachments/sample.pdf',
                'data-pdf-label': 'Sample PDF',
            },
        ]);
    });
});

describe('PdfBlockView', () => {
    beforeEach(() => {
        vi.stubGlobal('open', vi.fn());
    });

    afterEach(() => {
        cleanup();
        vi.unstubAllGlobals();
    });

    it('renders the PDF iframe with the correct src', () => {
        render(<PdfBlockView {...makeProps()} />);

        const iframe = screen.getByTestId('pdf-node-view-frame') as HTMLIFrameElement;
        expect(iframe).toBeTruthy();
        expect(iframe.getAttribute('src')).toBe(pdfUrl);
        expect(iframe.getAttribute('title')).toBe('sample.pdf');
        expect(iframe.getAttribute('sandbox')).toBe('allow-same-origin allow-scripts');
        expect(iframe.getAttribute('loading')).toBe('lazy');
    });

    it('exposes a drag handle on the node view wrapper', () => {
        render(<PdfBlockView {...makeProps()} />);
        const wrapper = screen.getByTestId('pdf-node-view');
        expect(wrapper.getAttribute('data-drag-handle')).toBe('');
    });

    it('renders a visible fallback link to open the PDF in a new tab', () => {
        render(<PdfBlockView {...makeProps()} />);
        const link = screen.getByRole('link', { name: /open it in a new tab/i }) as HTMLAnchorElement;
        expect(link.getAttribute('href')).toBe(pdfUrl);
        expect(link.getAttribute('target')).toBe('_blank');
    });

    it('opens the PDF from the toolbar button', () => {
        render(<PdfBlockView {...makeProps()} />);
        screen.getByRole('button', { name: 'Open in new tab' }).click();
        expect(window.open).toHaveBeenCalledWith(pdfUrl, '_blank', 'noopener,noreferrer');
    });

    it('shows an error and no iframe when the url is empty', () => {
        render(<PdfBlockView {...makeProps('', 'PDF')} />);
        expect(screen.queryByTestId('pdf-node-view-frame')).toBeNull();
        expect(screen.getByText('Missing PDF attachment')).toBeTruthy();
    });
});
