import { Node } from '@tiptap/core';
import { NodeViewWrapper, ReactNodeViewRenderer } from '@tiptap/react';
import type { NodeViewProps } from '@tiptap/react';
import { createIndentAttribute, renderIndentAttr } from './indentShared';
import { classifyPdfBlockUrl } from './pdfBlockUrl';

function PdfBlockView({ node }: NodeViewProps) {
    const url = String(node.attrs.url || '');
    const label = String(node.attrs.label || 'PDF');
    const classification = classifyPdfBlockUrl(url, window.location.origin);
    const href = classification.kind === 'invalid' ? undefined : classification.href;
    const indent = Number(node.attrs.indent || 0);

    return (
        <NodeViewWrapper
            className="pdf-node-view"
            data-drag-handle=""
            data-testid="pdf-node-view"
            data-indent={indent > 0 ? indent : undefined}
        >
            <div className="md-pdf-embed-shell" contentEditable={false}>
                <div className="md-pdf-embed-toolbar">
                    <span className="md-pdf-embed-title" title={href}>{label}</span>
                    <span className="md-pdf-embed-actions">
                        <button
                            type="button"
                            onClick={() => {
                                if (href) {
                                    window.open(href, '_blank', 'noopener,noreferrer');
                                }
                            }}
                            disabled={!href}
                        >
                            Open in new tab
                        </button>
                    </span>
                </div>
                {classification.kind === 'inline' ? (
                    <div className="md-pdf-embed-frame-wrap pdf-node-view-frame-wrap">
                        <iframe
                            className="md-pdf-embed-frame"
                            data-testid="pdf-node-view-frame"
                            src={classification.href}
                            title={label}
                            loading="lazy"
                        />
                        <div className="pdf-node-view-fallback">
                            If the PDF does not display,{' '}
                            <a href={classification.href} target="_blank" rel="noopener noreferrer">open it in a new tab</a>.
                        </div>
                    </div>
                ) : classification.kind === 'link' ? (
                    <div className="pdf-node-view-link-only">
                        <a href={classification.href} target="_blank" rel="noopener noreferrer">
                            Open this PDF in a new tab
                        </a>
                    </div>
                ) : (
                    <div className="pdf-node-view-error">Missing or unsafe PDF attachment</div>
                )}
            </div>
        </NodeViewWrapper>
    );
}

export const PdfBlock = Node.create({
    name: 'pdfBlock',
    group: 'block',
    atom: true,
    draggable: true,

    addAttributes() {
        return {
            url: { default: '' },
            label: { default: 'PDF' },
            indent: createIndentAttribute(),
        };
    },

    parseHTML() {
        return [
            {
                tag: 'div.md-pdf-embed',
                getAttrs: (node: HTMLElement) => {
                    const url = node.getAttribute('data-pdf-url');
                    if (!url) return false;
                    return {
                        url,
                        label: node.getAttribute('data-pdf-label') || 'PDF',
                    };
                },
            },
        ];
    },

    renderHTML({ node }) {
        return [
            'div',
            {
                class: 'md-pdf-embed',
                'data-pdf-url': node.attrs.url,
                'data-pdf-label': node.attrs.label,
                ...renderIndentAttr(node.attrs.indent),
            },
        ];
    },

    addNodeView() {
        return ReactNodeViewRenderer(PdfBlockView);
    },
});
