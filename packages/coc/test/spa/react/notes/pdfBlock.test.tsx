import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
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

// Stub the pdf.js renderer so these node-view tests never load the real
// (browser-only) pdf.js library. `shouldError` simulates a document that fails
// to render, which drives the iframe fallback inside PdfBlockView.
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
                    data-height={props.height ?? ''}
                    role="document"
                    aria-label={props.label}
                />
            );
        },
    }),
);

import { PdfBlock } from '../../../../src/server/spa/client/react/features/notes/editor/extensions/pdfBlock';

beforeEach(() => {
    pdfjsStub.shouldError = false;
    pdfjsStub.lastProps = null;
});

const pdfUrl = '/api/workspaces/ws1/notes/image?path=.attachments%2Fsample.pdf';
const externalPdfUrl = 'https://files.example/sample.pdf';

type ExtensionConfig = {
    addAttributes(): {
        collapsed: {
            default: boolean;
            parseHTML: (el: HTMLElement) => boolean;
            renderHTML: (attrs: { collapsed?: boolean }) => Record<string, string>;
        };
    };
    parseHTML(): Array<{ tag: string; getAttrs: (el: HTMLElement) => false | { url: string; label: string } }>;
    renderHTML(args: {
        node: { attrs: { url: string; label: string; indent?: number; height?: number | null; collapsed?: boolean } };
    }): unknown[];
};

type NodeViewConfig = ExtensionConfig & {
    addNodeView(): React.FC<any>;
};

const config = PdfBlock as unknown as ExtensionConfig;
const nodeViewConfig = PdfBlock as unknown as NodeViewConfig;
const PdfBlockView = nodeViewConfig.addNodeView() as React.FC<any>;

function makeExtension(onRequestFullWindow: ((req: { url: string; label: string }) => void) | undefined = vi.fn()) {
    return { options: { onRequestFullWindow } };
}

function makeProps(
    url = pdfUrl,
    label = 'sample.pdf',
    updateAttributes = vi.fn(),
    onRequestFullWindow: ((req: { url: string; label: string }) => void) | undefined = vi.fn(),
) {
    return { node: { attrs: { url, label } }, updateAttributes, extension: makeExtension(onRequestFullWindow) } as any;
}

function makeResizeProps(
    overrides: { height?: number | null; selected?: boolean; updateAttributes?: ReturnType<typeof vi.fn> } = {},
) {
    const updateAttributes = overrides.updateAttributes ?? vi.fn();
    return {
        node: { attrs: { url: pdfUrl, label: 'sample.pdf', height: overrides.height ?? null } },
        updateAttributes,
        selected: overrides.selected ?? false,
        extension: makeExtension(),
    } as any;
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

    it('normalizes a pre-fix raw placeholder whose label leaked Markdown escapes', () => {
        // A legacy raw div written before the fix carries `\_` in data-pdf-label.
        const div = document.createElement('div');
        div.className = 'md-pdf-embed';
        div.setAttribute('data-pdf-url', '.attachments/a.pdf');
        div.setAttribute('data-pdf-label', 'OSDI\\_2026\\_Paper\\_Survey.pdf');

        const [rule] = config.parseHTML();
        expect(rule.getAttrs(div)).toEqual({
            url: '.attachments/a.pdf',
            label: 'OSDI_2026_Paper_Survey.pdf',
        });
    });

    it('leaves an already-literal label untouched (new insertions are not double-decoded)', () => {
        const div = document.createElement('div');
        div.className = 'md-pdf-embed';
        div.setAttribute('data-pdf-url', '.attachments/a.pdf');
        div.setAttribute('data-pdf-label', 'OSDI_2026_Paper_Survey.pdf');

        const [rule] = config.parseHTML();
        expect(rule.getAttrs(div)).toEqual({
            url: '.attachments/a.pdf',
            label: 'OSDI_2026_Paper_Survey.pdf',
        });
    });
});

describe('PdfBlock renderHTML', () => {
    it('round-trips to the markdown placeholder structure (no data-indent at level 0)', () => {
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

    it('writes the (already-cleaned) literal label verbatim — no re-escaping on render', () => {
        const result = config.renderHTML({
            node: { attrs: { url: '.attachments/a.pdf', label: 'OSDI_2026_Paper_Survey.pdf' } },
        }) as [string, Record<string, unknown>];
        expect(result[1]).toHaveProperty('data-pdf-label', 'OSDI_2026_Paper_Survey.pdf');
    });

    it('adds data-indent to the placeholder for an indented PDF', () => {
        const result = config.renderHTML({
            node: { attrs: { url: '.attachments/sample.pdf', label: 'Sample PDF', indent: 2 } },
        });
        expect(result).toEqual([
            'div',
            {
                class: 'md-pdf-embed',
                'data-pdf-url': '.attachments/sample.pdf',
                'data-pdf-label': 'Sample PDF',
                'data-indent': '2',
            },
        ]);
    });

    it('adds data-pdf-height to the placeholder for a resized PDF (clamped)', () => {
        const result = config.renderHTML({
            node: { attrs: { url: '.attachments/sample.pdf', label: 'Sample PDF', height: 5000 } },
        });
        expect(result).toEqual([
            'div',
            {
                class: 'md-pdf-embed',
                'data-pdf-url': '.attachments/sample.pdf',
                'data-pdf-label': 'Sample PDF',
                'data-pdf-height': '1200',
            },
        ]);
    });

    it('omits data-pdf-height when the height is unset', () => {
        const result = config.renderHTML({
            node: { attrs: { url: '.attachments/sample.pdf', label: 'Sample PDF', height: null } },
        }) as [string, Record<string, unknown>];
        expect(result[1]).not.toHaveProperty('data-pdf-height');
    });

    it('adds data-pdf-collapsed to the placeholder for a collapsed PDF', () => {
        const result = config.renderHTML({
            node: { attrs: { url: '.attachments/sample.pdf', label: 'Sample PDF', collapsed: true } },
        }) as [string, Record<string, unknown>];
        expect(result[1]).toHaveProperty('data-pdf-collapsed', 'true');
    });

    it('omits data-pdf-collapsed when the PDF is expanded', () => {
        const result = config.renderHTML({
            node: { attrs: { url: '.attachments/sample.pdf', label: 'Sample PDF', collapsed: false } },
        }) as [string, Record<string, unknown>];
        expect(result[1]).not.toHaveProperty('data-pdf-collapsed');
    });
});

describe('PdfBlock collapsed attribute', () => {
    const { collapsed } = config.addAttributes();

    it('defaults to false', () => {
        expect(collapsed.default).toBe(false);
    });

    it('parses data-pdf-collapsed="true" to true', () => {
        const div = document.createElement('div');
        div.setAttribute('data-pdf-collapsed', 'true');
        expect(collapsed.parseHTML(div)).toBe(true);
    });

    it('parses an absent data-pdf-collapsed to false', () => {
        const div = document.createElement('div');
        expect(collapsed.parseHTML(div)).toBe(false);
    });

    it('renders data-pdf-collapsed only when collapsed', () => {
        expect(collapsed.renderHTML({ collapsed: true })).toEqual({ 'data-pdf-collapsed': 'true' });
        expect(collapsed.renderHTML({ collapsed: false })).toEqual({});
    });
});

describe('PdfBlockView', () => {
    const normalizedPdfUrl = new URL(pdfUrl, window.location.origin).href;

    beforeEach(() => {
        vi.stubGlobal('open', vi.fn());
    });

    afterEach(() => {
        cleanup();
        vi.unstubAllGlobals();
    });

    it('renders the pdf.js text-layer viewport (not the iframe) by default', () => {
        render(<PdfBlockView {...makeProps()} />);

        const viewport = screen.getByTestId('pdfjs-render-viewport');
        expect(viewport).toBeTruthy();
        expect(viewport.getAttribute('data-url')).toBe(normalizedPdfUrl);
        expect(viewport.getAttribute('aria-label')).toBe('sample.pdf');
        // No native iframe while pdf.js is rendering — the text layer replaces it.
        expect(screen.queryByTestId('pdf-node-view-frame')).toBeNull();
    });

    it('falls back to the native iframe when pdf.js fails to render', () => {
        pdfjsStub.shouldError = true;
        render(<PdfBlockView {...makeProps()} />);

        const iframe = screen.getByTestId('pdf-node-view-frame') as HTMLIFrameElement;
        expect(iframe.getAttribute('src')).toBe(normalizedPdfUrl);
        expect(iframe.getAttribute('title')).toBe('sample.pdf');
        expect(iframe.getAttribute('loading')).toBe('lazy');
        expect(screen.queryByTestId('pdfjs-render-viewport')).toBeNull();
    });

    it('exposes a drag handle on the node view wrapper', () => {
        render(<PdfBlockView {...makeProps()} />);
        const wrapper = screen.getByTestId('pdf-node-view');
        expect(wrapper.getAttribute('data-drag-handle')).toBe('');
    });

    it('renders a visible fallback link to open the PDF in a new tab', () => {
        render(<PdfBlockView {...makeProps()} />);
        const link = screen.getByRole('link', { name: /open it in a new tab/i }) as HTMLAnchorElement;
        expect(link.getAttribute('href')).toBe(normalizedPdfUrl);
        expect(link.getAttribute('target')).toBe('_blank');
        expect(link.getAttribute('rel')).toBe('noopener noreferrer');
    });

    it('opens only the normalized PDF URL from the toolbar button', () => {
        render(<PdfBlockView {...makeProps()} />);
        screen.getByRole('button', { name: 'Open in new tab' }).click();
        expect(window.open).toHaveBeenCalledWith(normalizedPdfUrl, '_blank', 'noopener,noreferrer');
    });

    it('renders an external PDF as a link without an iframe', () => {
        render(<PdfBlockView {...makeProps(externalPdfUrl, 'External PDF')} />);

        expect(screen.queryByTestId('pdf-node-view-frame')).toBeNull();
        const link = screen.getByRole('link', { name: 'Open this PDF in a new tab' }) as HTMLAnchorElement;
        expect(link.getAttribute('href')).toBe(externalPdfUrl);
        expect(link.getAttribute('target')).toBe('_blank');
        expect(link.getAttribute('rel')).toBe('noopener noreferrer');

        screen.getByRole('button', { name: 'Open in new tab' }).click();
        expect(window.open).toHaveBeenCalledWith(externalPdfUrl, '_blank', 'noopener,noreferrer');
    });

    it('shows a non-interactive error for an unsafe URL', () => {
        render(<PdfBlockView {...makeProps('javascript:alert(1)', 'Unsafe PDF')} />);

        expect(screen.queryByTestId('pdf-node-view-frame')).toBeNull();
        expect(screen.queryByRole('link')).toBeNull();
        expect(screen.getByText('Missing or unsafe PDF attachment')).toBeTruthy();

        const button = screen.getByRole('button', { name: 'Open in new tab' }) as HTMLButtonElement;
        expect(button.disabled).toBe(true);
        button.click();
        expect(window.open).not.toHaveBeenCalled();
    });

    it('shows an error and no active URL when the url is empty', () => {
        render(<PdfBlockView {...makeProps('', 'PDF')} />);
        expect(screen.queryByTestId('pdf-node-view-frame')).toBeNull();
        expect(screen.queryByRole('link')).toBeNull();
        expect(screen.getByText('Missing or unsafe PDF attachment')).toBeTruthy();
    });
});

describe('PdfBlockView full-window button', () => {
    afterEach(() => cleanup());

    const normalizedPdfUrl = new URL(pdfUrl, window.location.origin).href;

    it('renders the ⛶ button next to "Open in new tab" for an inline PDF (AC-01)', () => {
        render(<PdfBlockView {...makeProps()} />);
        const btn = screen.getByTestId('pdf-node-view-fullwindow');
        expect(btn.textContent).toBe('⛶');
        expect(screen.getByRole('button', { name: 'Open in new tab' })).toBeTruthy();
    });

    it('renders the ⛶ button for a link-only (cross-origin) PDF (AC-01)', () => {
        render(<PdfBlockView {...makeProps(externalPdfUrl, 'External PDF')} />);
        expect(screen.getByTestId('pdf-node-view-fullwindow')).toBeTruthy();
    });

    it('requests full window with the normalized inline url and label on click (AC-05)', () => {
        const onRequestFullWindow = vi.fn();
        render(<PdfBlockView {...makeProps(pdfUrl, 'sample.pdf', vi.fn(), onRequestFullWindow)} />);
        screen.getByTestId('pdf-node-view-fullwindow').click();
        expect(onRequestFullWindow).toHaveBeenCalledWith({ url: normalizedPdfUrl, label: 'sample.pdf' });
    });

    it('requests full window with the cross-origin url for a link-only PDF (AC-03)', () => {
        const onRequestFullWindow = vi.fn();
        render(<PdfBlockView {...makeProps(externalPdfUrl, 'External PDF', vi.fn(), onRequestFullWindow)} />);
        screen.getByTestId('pdf-node-view-fullwindow').click();
        expect(onRequestFullWindow).toHaveBeenCalledWith({ url: externalPdfUrl, label: 'External PDF' });
    });

    it('disables the ⛶ button and never requests for an unsafe/invalid URL', () => {
        const onRequestFullWindow = vi.fn();
        render(<PdfBlockView {...makeProps('javascript:alert(1)', 'Unsafe PDF', vi.fn(), onRequestFullWindow)} />);
        const btn = screen.getByTestId('pdf-node-view-fullwindow') as HTMLButtonElement;
        expect(btn.disabled).toBe(true);
        btn.click();
        expect(onRequestFullWindow).not.toHaveBeenCalled();
    });

    it('disables the ⛶ button when no host handler is wired', () => {
        const props = {
            node: { attrs: { url: pdfUrl, label: 'sample.pdf' } },
            updateAttributes: vi.fn(),
            extension: { options: { onRequestFullWindow: undefined } },
        } as any;
        render(<PdfBlockView {...props} />);
        expect((screen.getByTestId('pdf-node-view-fullwindow') as HTMLButtonElement).disabled).toBe(true);
    });
});

describe('PdfBlockView resize', () => {
    afterEach(() => cleanup());

    it('passes the persisted height to the pdf.js viewport', () => {
        render(<PdfBlockView {...makeResizeProps({ height: 300 })} />);
        expect(screen.getByTestId('pdfjs-render-viewport').getAttribute('data-height')).toBe('300');
    });

    it('applies the persisted height as an inline iframe style in the fallback', () => {
        pdfjsStub.shouldError = true;
        render(<PdfBlockView {...makeResizeProps({ height: 300 })} />);
        const iframe = screen.getByTestId('pdf-node-view-frame') as HTMLIFrameElement;
        expect(iframe.style.height).toBe('300px');
    });

    it('leaves the height unset on the viewport when no height is set', () => {
        render(<PdfBlockView {...makeResizeProps({ height: null })} />);
        expect(screen.getByTestId('pdfjs-render-viewport').getAttribute('data-height')).toBe('');
    });

    it('always renders the resize handle for an inline PDF (CSS controls emphasis)', () => {
        render(<PdfBlockView {...makeResizeProps({ selected: false })} />);
        expect(screen.getByTestId('pdf-node-view-resize-handle')).toBeTruthy();
    });

    it('marks the node view as selected so the handle is emphasized', () => {
        const { container } = render(<PdfBlockView {...makeResizeProps({ selected: true })} />);
        expect(container.querySelector('.pdf-node-view.pdf-selected')).toBeTruthy();
    });

    it('does not render a resize handle for an external (link-only) PDF', () => {
        render(<PdfBlockView {...makeProps(externalPdfUrl, 'External PDF')} />);
        expect(screen.queryByTestId('pdf-node-view-resize-handle')).toBeNull();
    });

    it('commits the clamped dragged height on mouseup', () => {
        const updateAttributes = vi.fn();
        render(<PdfBlockView {...makeResizeProps({ height: 300, selected: true, updateAttributes })} />);

        const handle = screen.getByTestId('pdf-node-view-resize-handle');
        fireEvent.mouseDown(handle, { clientY: 100 });
        fireEvent.mouseMove(document, { clientY: 250 });
        fireEvent.mouseUp(document, { clientY: 250 });

        // startHeight 300 + dy 150 = 450 (within [160, 1200]).
        expect(updateAttributes).toHaveBeenCalledWith({ height: 450 });
    });

    it('clamps a drag that overshoots the maximum', () => {
        const updateAttributes = vi.fn();
        render(<PdfBlockView {...makeResizeProps({ height: 1000, selected: true, updateAttributes })} />);

        const handle = screen.getByTestId('pdf-node-view-resize-handle');
        fireEvent.mouseDown(handle, { clientY: 0 });
        fireEvent.mouseMove(document, { clientY: 5000 });
        fireEvent.mouseUp(document, { clientY: 5000 });

        expect(updateAttributes).toHaveBeenCalledWith({ height: 1200 });
    });

    it('resets the height to null on double-click of the handle', () => {
        const updateAttributes = vi.fn();
        render(<PdfBlockView {...makeResizeProps({ height: 600, selected: true, updateAttributes })} />);

        fireEvent.doubleClick(screen.getByTestId('pdf-node-view-resize-handle'));
        expect(updateAttributes).toHaveBeenCalledWith({ height: null });
    });
});

describe('PdfBlockView collapse', () => {
    afterEach(() => cleanup());

    function makeCollapseProps(
        overrides: { collapsed?: boolean; updateAttributes?: ReturnType<typeof vi.fn> } = {},
    ) {
        const updateAttributes = overrides.updateAttributes ?? vi.fn();
        return {
            node: { attrs: { url: pdfUrl, label: 'sample.pdf', collapsed: overrides.collapsed ?? false } },
            updateAttributes,
            selected: false,
            extension: makeExtension(),
        } as any;
    }

    it('renders the pdf.js viewport and an expanded toggle when not collapsed', () => {
        render(<PdfBlockView {...makeCollapseProps({ collapsed: false })} />);
        expect(screen.getByTestId('pdfjs-render-viewport')).toBeTruthy();
        const toggle = screen.getByTestId('pdf-node-view-toggle');
        expect(toggle.getAttribute('aria-expanded')).toBe('true');
        expect(toggle.getAttribute('title')).toBe('Collapse');
    });

    it('unmounts the pdf viewport but keeps the toolbar when collapsed', () => {
        render(<PdfBlockView {...makeCollapseProps({ collapsed: true })} />);
        expect(screen.queryByTestId('pdfjs-render-viewport')).toBeNull();
        expect(screen.queryByTestId('pdf-node-view-frame')).toBeNull();
        // Toolbar (title + actions) stays so the block can be re-expanded.
        expect(screen.getByText('sample.pdf')).toBeTruthy();
        expect(screen.getByRole('button', { name: 'Open in new tab' })).toBeTruthy();
        const toggle = screen.getByTestId('pdf-node-view-toggle');
        expect(toggle.getAttribute('aria-expanded')).toBe('false');
        expect(toggle.getAttribute('title')).toBe('Expand');
    });

    it('marks the wrapper with data-collapsed when collapsed', () => {
        const { container } = render(<PdfBlockView {...makeCollapseProps({ collapsed: true })} />);
        expect(container.querySelector('.pdf-node-view[data-collapsed]')).toBeTruthy();
    });

    it('does not set data-collapsed when expanded', () => {
        const { container } = render(<PdfBlockView {...makeCollapseProps({ collapsed: false })} />);
        expect(container.querySelector('.pdf-node-view[data-collapsed]')).toBeNull();
    });

    it('toggles collapsed on from an expanded block', () => {
        const updateAttributes = vi.fn();
        render(<PdfBlockView {...makeCollapseProps({ collapsed: false, updateAttributes })} />);
        screen.getByTestId('pdf-node-view-toggle').click();
        expect(updateAttributes).toHaveBeenCalledWith({ collapsed: true });
    });

    it('toggles collapsed off from a collapsed block', () => {
        const updateAttributes = vi.fn();
        render(<PdfBlockView {...makeCollapseProps({ collapsed: true, updateAttributes })} />);
        screen.getByTestId('pdf-node-view-toggle').click();
        expect(updateAttributes).toHaveBeenCalledWith({ collapsed: false });
    });
});
