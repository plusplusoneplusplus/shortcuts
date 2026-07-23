import { useState } from 'react';
import { Node } from '@tiptap/core';
import { NodeViewWrapper, ReactNodeViewRenderer } from '@tiptap/react';
import type { NodeViewProps } from '@tiptap/react';
import { isEmbeddableMapUrl } from '@plusplusoneplusplus/forge/editor/rendering';
import { createIndentAttribute, renderIndentAttr } from './indentShared';

function MapBlockView({ node, updateAttributes }: NodeViewProps) {
    const [mode, setMode] = useState<'preview' | 'source'>('preview');
    const [draftUrl, setDraftUrl] = useState(String(node.attrs.url || ''));
    const label = String(node.attrs.label || 'Google Maps');
    const indent = Number(node.attrs.indent || 0);
    const canPreview = isEmbeddableMapUrl(draftUrl);

    const updateUrl = (url: string) => {
        setDraftUrl(url);
        updateAttributes({ url });
    };

    return (
        <NodeViewWrapper
            className="map-node-view"
            data-drag-handle=""
            data-indent={indent > 0 ? indent : undefined}
        >
            <div className="md-map-embed-shell" contentEditable={false}>
                <div className="md-map-embed-toolbar">
                    <span className="md-map-embed-title" title={draftUrl}>{label}</span>
                    <span className="md-map-embed-actions">
                        <button
                            type="button"
                            onClick={() => window.open(draftUrl, '_blank', 'noopener,noreferrer')}
                            disabled={!canPreview}
                        >
                            Open
                        </button>
                        <button type="button" onClick={() => setMode((m) => (m === 'preview' ? 'source' : 'preview'))}>
                            {mode === 'preview' ? 'Source' : 'Preview'}
                        </button>
                    </span>
                </div>
                {mode === 'preview' ? (
                    canPreview ? (
                        <div className="md-map-embed-frame-wrap map-node-view-frame-wrap">
                            <iframe
                                className="md-map-embed-frame"
                                src={draftUrl}
                                title={label}
                                sandbox="allow-scripts allow-same-origin"
                                referrerPolicy="no-referrer-when-downgrade"
                                loading="lazy"
                            />
                        </div>
                    ) : (
                        <div className="map-node-view-error">Unsupported Google Maps embed URL</div>
                    )
                ) : (
                    <input
                        className="map-node-view-source"
                        value={draftUrl}
                        onChange={(event) => updateUrl(event.currentTarget.value)}
                        aria-label="Google Maps embed URL"
                    />
                )}
            </div>
        </NodeViewWrapper>
    );
}

export const MapBlock = Node.create({
    name: 'mapBlock',
    group: 'block',
    atom: true,
    draggable: true,

    addAttributes() {
        return {
            url: { default: '' },
            label: { default: 'Google Maps' },
            indent: createIndentAttribute(),
        };
    },

    parseHTML() {
        return [
            {
                tag: 'div.md-map-embed',
                getAttrs: (node: HTMLElement) => {
                    const url = node.getAttribute('data-map-url') ?? '';
                    if (!isEmbeddableMapUrl(url)) return false;
                    return {
                        url,
                        label: node.getAttribute('data-map-label') || 'Google Maps',
                    };
                },
            },
        ];
    },

    renderHTML({ node }) {
        return [
            'div',
            {
                class: 'md-map-embed',
                'data-map-url': node.attrs.url,
                'data-map-label': node.attrs.label,
                ...renderIndentAttr(node.attrs.indent),
            },
        ];
    },

    addNodeView() {
        return ReactNodeViewRenderer(MapBlockView);
    },
});
