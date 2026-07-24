import { useCallback, useRef, useState } from 'react';
import { Node } from '@tiptap/core';
import { NodeViewWrapper, ReactNodeViewRenderer } from '@tiptap/react';
import type { NodeViewProps } from '@tiptap/react';
import { createIndentAttribute, renderIndentAttr } from './indentShared';
import {
    clampPdfHeight,
    createPdfHeightAttribute,
    renderPdfHeightAttr,
    DEFAULT_PDF_HEIGHT,
} from './pdfHeightShared';
import { classifyPdfBlockUrl } from './pdfBlockUrl';

function PdfBlockView({ node, updateAttributes, selected }: NodeViewProps) {
    const url = String(node.attrs.url || '');
    const label = String(node.attrs.label || 'PDF');
    const classification = classifyPdfBlockUrl(url, window.location.origin);
    const href = classification.kind === 'invalid' ? undefined : classification.href;
    const indent = Number(node.attrs.indent || 0);
    const collapsed = Boolean(node.attrs.collapsed);

    const attrHeight = node.attrs.height == null ? null : Number(node.attrs.height);
    const frameRef = useRef<HTMLIFrameElement>(null);
    const [dragging, setDragging] = useState(false);
    const [dragHeight, setDragHeight] = useState<number | null>(null);

    const displayHeight = dragging ? dragHeight : attrHeight;

    const handleDoubleClick = useCallback(() => {
        updateAttributes({ height: null });
    }, [updateAttributes]);

    const handleDragStart = useCallback(
        (e: React.MouseEvent) => {
            // Must not start a node drag (the wrapper carries data-drag-handle).
            e.preventDefault();
            e.stopPropagation();

            const startY = e.clientY;
            const startHeight =
                attrHeight ??
                frameRef.current?.getBoundingClientRect().height ??
                DEFAULT_PDF_HEIGHT;

            setDragging(true);
            setDragHeight(clampPdfHeight(startHeight));

            const onMouseMove = (ev: MouseEvent) => {
                setDragHeight(clampPdfHeight(startHeight + (ev.clientY - startY)));
            };
            const onMouseUp = (ev: MouseEvent) => {
                document.removeEventListener('mousemove', onMouseMove);
                document.removeEventListener('mouseup', onMouseUp);
                setDragging(false);
                setDragHeight(null);
                updateAttributes({ height: clampPdfHeight(startHeight + (ev.clientY - startY)) });
            };

            document.addEventListener('mousemove', onMouseMove);
            document.addEventListener('mouseup', onMouseUp);
        },
        [attrHeight, updateAttributes],
    );

    return (
        <NodeViewWrapper
            className={`pdf-node-view${selected ? ' pdf-selected' : ''}${dragging ? ' pdf-resizing' : ''}`}
            data-drag-handle=""
            data-testid="pdf-node-view"
            data-indent={indent > 0 ? indent : undefined}
            data-collapsed={collapsed ? '' : undefined}
        >
            <div className="md-pdf-embed-shell" contentEditable={false}>
                <div className="md-pdf-embed-toolbar">
                    <span className="md-pdf-embed-title" title={href}>{label}</span>
                    <span className="md-pdf-embed-actions">
                        <button
                            type="button"
                            className="md-pdf-embed-toggle"
                            data-testid="pdf-node-view-toggle"
                            aria-expanded={!collapsed}
                            title={collapsed ? 'Expand' : 'Collapse'}
                            onClick={() => updateAttributes({ collapsed: !collapsed })}
                        >
                            {collapsed ? '▸' : '▾'}
                        </button>
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
                {!collapsed && (classification.kind === 'inline' ? (
                    <div className="md-pdf-embed-frame-wrap pdf-node-view-frame-wrap">
                        <div className="pdf-node-view-frame-inner">
                            <iframe
                                ref={frameRef}
                                className="md-pdf-embed-frame"
                                data-testid="pdf-node-view-frame"
                                src={classification.href}
                                title={label}
                                loading="lazy"
                                style={displayHeight ? { height: `${displayHeight}px` } : undefined}
                            />
                            <div
                                className="pdf-node-view-resize-handle"
                                data-testid="pdf-node-view-resize-handle"
                                onMouseDown={handleDragStart}
                                onDoubleClick={handleDoubleClick}
                                title="Drag to resize · double-click to reset"
                            >
                                {dragging && displayHeight ? (
                                    <span className="pdf-node-view-resize-tooltip">{displayHeight}px</span>
                                ) : null}
                            </div>
                        </div>
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
                ))}
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
            height: createPdfHeightAttribute(),
            collapsed: {
                default: false,
                parseHTML: (el: HTMLElement) => el.getAttribute('data-pdf-collapsed') === 'true',
                renderHTML: (attrs: { collapsed?: boolean }) =>
                    attrs.collapsed ? { 'data-pdf-collapsed': 'true' } : {},
            },
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
                ...renderPdfHeightAttr(node.attrs.height),
                ...(node.attrs.collapsed ? { 'data-pdf-collapsed': 'true' } : {}),
            },
        ];
    },

    addNodeView() {
        return ReactNodeViewRenderer(PdfBlockView);
    },
});
