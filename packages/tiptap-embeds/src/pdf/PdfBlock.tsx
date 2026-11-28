import { useCallback, useRef, useState, type ReactNode, type RefObject } from 'react';
import { Node } from '@tiptap/core';
import { NodeViewWrapper, ReactNodeViewRenderer } from '@tiptap/react';
import type { NodeViewProps } from '@tiptap/react';
import { createIndentAttribute, renderIndentAttr } from '@plusplusoneplusplus/tiptap-kit/indent';
import { clampPdfHeight, createPdfHeightAttribute, renderPdfHeightAttr, DEFAULT_PDF_HEIGHT } from './pdfHeight.js';
import { classifyPdfUrl, type PdfUrlClassification } from './pdfUrl.js';
import { normalizeStoredPdfLabel } from './pdfLabel.js';

/** Payload handed to {@link PdfBlockOptions.onRequestFullWindow}. */
export interface PdfFullWindowRequest {
    url: string;
    label: string;
}

export interface PdfBlockOptions {
    /**
     * The ⛶ full-window button asks the host to open the PDF in an in-app
     * overlay. Undefined disables the button.
     */
    onRequestFullWindow?: (request: PdfFullWindowRequest) => void;
}

/** What the viewer and overlay slots receive for an inline PDF. */
export interface PdfViewerSlotProps<O extends PdfBlockOptions = PdfBlockOptions> {
    /** The stored (raw) URL. */
    url: string;
    /** The classified, normalized URL to load. */
    href: string;
    label: string;
    /** Persisted or in-drag height in px; `null` means the CSS default. */
    height: number | null;
    /** The frame element that wraps the viewer; overlays position against it. */
    containerRef: RefObject<HTMLDivElement | null>;
    /** Call when the viewer cannot render; the block falls back to a native iframe. */
    onError: () => void;
    /** The extension options, including host-specific ones. */
    options: O;
}

/** Context for {@link PdfBlockHost.renderToolbarActions}. */
export interface PdfToolbarSlotProps<O extends PdfBlockOptions = PdfBlockOptions> {
    url: string;
    label: string;
    options: O;
}

/**
 * Host hooks baked into a PDF block by {@link createPdfBlock}. Every hook is
 * optional; the defaults give a self-contained block with a native iframe.
 */
export interface PdfBlockHost<O extends PdfBlockOptions = PdfBlockOptions> {
    /**
     * Decide whether a stored URL renders inline, as a link only, or not at all.
     * Defaults to {@link classifyPdfUrl} against `window.location.origin`.
     */
    classifyUrl?: (url: string) => PdfUrlClassification;
    /** True inside a desktop shell, where `window.open` opens a new window. */
    isDesktopShell?: () => boolean;
    /** Render the inline viewer (e.g. pdf.js). Omitted → a native iframe. */
    renderViewer?: (props: PdfViewerSlotProps<O>) => ReactNode;
    /** Render layers over the viewer. Skipped when the iframe fallback is showing. */
    renderOverlay?: (props: PdfViewerSlotProps<O>) => ReactNode;
    /** Extra toolbar buttons, rendered before the full-window button. */
    renderToolbarActions?: (props: PdfToolbarSlotProps<O>) => ReactNode;
}

function createPdfBlockView<O extends PdfBlockOptions>(host: PdfBlockHost<O>) {
    return function PdfBlockView({ node, updateAttributes, selected, extension }: NodeViewProps) {
        const options = extension.options as O;
        const url = String(node.attrs.url || '');
        const label = String(node.attrs.label || 'PDF');
        const classification = host.classifyUrl
            ? host.classifyUrl(url)
            : classifyPdfUrl(url, window.location.origin);
        const href = classification.kind === 'invalid' ? undefined : classification.href;
        const opensDesktopWindow =
            (host.isDesktopShell?.() ?? false) &&
            href !== undefined &&
            new URL(href).origin === window.location.origin;
        const onRequestFullWindow = options.onRequestFullWindow;
        const indent = Number(node.attrs.indent || 0);
        const collapsed = Boolean(node.attrs.collapsed);

        const attrHeight = node.attrs.height == null ? null : Number(node.attrs.height);
        const frameRef = useRef<HTMLIFrameElement>(null);
        const frameInnerRef = useRef<HTMLDivElement>(null);
        const [dragging, setDragging] = useState(false);
        const [dragHeight, setDragHeight] = useState<number | null>(null);
        // Use the host viewer by default; fall back to the native iframe only if
        // it reports that it cannot render the document.
        const [viewerFailed, setViewerFailed] = useState(false);
        const handleViewerError = useCallback(() => setViewerFailed(true), []);
        const useViewer = Boolean(host.renderViewer) && !viewerFailed;

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
                    frameInnerRef.current?.getBoundingClientRect().height ??
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

        const slotProps: PdfViewerSlotProps<O> | null = classification.kind === 'inline'
            ? {
                url,
                href: classification.href,
                label,
                height: displayHeight,
                containerRef: frameInnerRef,
                onError: handleViewerError,
                options,
            }
            : null;

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
                            {host.renderToolbarActions?.({ url, label, options })}
                            <button
                                type="button"
                                className="md-pdf-embed-fullwindow"
                                data-testid="pdf-node-view-fullwindow"
                                title="Open full window"
                                aria-label="Open full window"
                                onClick={() => {
                                    if (href && onRequestFullWindow) {
                                        onRequestFullWindow({ url: href, label });
                                    }
                                }}
                                disabled={!href || !onRequestFullWindow}
                            >
                                ⛶
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
                                {opensDesktopWindow ? 'Open in new window' : 'Open in new tab'}
                            </button>
                        </span>
                    </div>
                    {!collapsed && (slotProps ? (
                        <div className="md-pdf-embed-frame-wrap pdf-node-view-frame-wrap">
                            <div className="pdf-node-view-frame-inner" ref={frameInnerRef}>
                                {useViewer ? (
                                    host.renderViewer!(slotProps)
                                ) : (
                                    <iframe
                                        ref={frameRef}
                                        className="md-pdf-embed-frame"
                                        data-testid="pdf-node-view-frame"
                                        src={slotProps.href}
                                        title={label}
                                        loading="lazy"
                                        style={displayHeight ? { height: `${displayHeight}px` } : undefined}
                                    />
                                )}
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
                                {useViewer && host.renderOverlay?.(slotProps)}
                            </div>
                            <div className="pdf-node-view-fallback">
                                If the PDF does not display,{' '}
                                <a href={slotProps.href} target="_blank" rel="noopener noreferrer">open it in a new tab</a>.
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
    };
}

/**
 * Create the `pdfBlock` node with host hooks baked in. Hooks live outside the
 * Tiptap options so a later `configure()` cannot drop them.
 */
export function createPdfBlock<O extends PdfBlockOptions = PdfBlockOptions>(host: PdfBlockHost<O> = {}) {
    const PdfBlockView = createPdfBlockView(host);

    return Node.create<O>({
        name: 'pdfBlock',
        group: 'block',
        atom: true,
        draggable: true,

        addOptions() {
            return {
                onRequestFullWindow: undefined,
            } as O;
        },

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
                            // A legacy raw placeholder may have leaked Markdown
                            // escapes into its label (`OSDI\_2026...`). Normalize one
                            // layer so the block shows the literal filename; literal
                            // labels are unchanged.
                            label: normalizeStoredPdfLabel(node.getAttribute('data-pdf-label') || 'PDF'),
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
}

/** A PDF block with no host hooks: native iframe, default URL rules. */
export const PdfBlock = createPdfBlock();
