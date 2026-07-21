import { Node } from '@tiptap/core';
import { NodeViewWrapper, ReactNodeViewRenderer } from '@tiptap/react';
import type { NodeViewProps } from '@tiptap/react';

function PdfBlockView({ node }: NodeViewProps) {
    const url = String(node.attrs.url || '');
    const label = String(node.attrs.label || 'PDF');
    const hasUrl = url.length > 0;

    return (
        <NodeViewWrapper
            className="pdf-node-view"
            data-drag-handle=""
            data-testid="pdf-node-view"
        >
            <div className="md-pdf-embed-shell" contentEditable={false}>
                <div className="md-pdf-embed-toolbar">
                    <span className="md-pdf-embed-title" title={url}>{label}</span>
                    <span className="md-pdf-embed-actions">
                        <button
                            type="button"
                            onClick={() => window.open(url, '_blank', 'noopener,noreferrer')}
                            disabled={!hasUrl}
                        >
                            Open in new tab
                        </button>
                    </span>
                </div>
                {hasUrl ? (
                    <div className="md-pdf-embed-frame-wrap pdf-node-view-frame-wrap">
                        <iframe
                            className="md-pdf-embed-frame"
                            data-testid="pdf-node-view-frame"
                            src={url}
                            title={label}
                            sandbox="allow-same-origin allow-scripts"
                            loading="lazy"
                        />
                        <div className="pdf-node-view-fallback">
                            If the PDF does not display,{' '}
                            <a href={url} target="_blank" rel="noopener noreferrer">open it in a new tab</a>.
                        </div>
                    </div>
                ) : (
                    <div className="pdf-node-view-error">Missing PDF attachment</div>
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
            },
        ];
    },

    addNodeView() {
        return ReactNodeViewRenderer(PdfBlockView);
    },
});
