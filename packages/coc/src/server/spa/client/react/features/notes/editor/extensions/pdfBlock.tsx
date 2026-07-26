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
import { normalizeStoredPdfLabel } from '../pdfLabel';
import { PdfJsRenderer } from './PdfJsRenderer';
import { PdfQuickAskLayer } from './PdfQuickAskLayer';
import { PdfRegionAskLayer } from './PdfRegionAskLayer';
import { PdfAnnotationsLayer } from './PdfAnnotationsLayer';
import { paperTextPathFromPdfUrl } from './paperChatGrounding';

/** Payload handed to {@link PdfBlockOptions.onRequestFullWindow} (AC-05). */
export interface PdfFullWindowRequest {
    url: string;
    label: string;
}

export interface PdfBlockOptions {
    /**
     * AC-01/AC-05: the ⛶ full-window button asks the host (RichEditorCore) to
     * open the PDF in an in-app overlay. Undefined hides the button.
     */
    onRequestFullWindow?: (request: PdfFullWindowRequest) => void;
    /**
     * Goal 1: workspace the Quick Ask answer endpoint runs against. Threaded from
     * NoteEditor so a text-layer selection can be asked→answered. Undefined
     * disables the Quick Ask layer (e.g. non-note reuse of RichEditorCore).
     */
    workspaceId?: string;
    /**
     * Goal 2: live getter for the current note path (persistence target for
     * answered paper annotations). A getter, not a value, because the editor
     * instance survives note switches — the path must be read at write time.
     */
    getNotePath?: () => string | null | undefined;
    /** Goal 2: live getter for the current notes root id, if any. */
    getNoteRoot?: () => string | undefined;
    /**
     * Goal 3 (AC-03): the "💬 Chat about this paper" button asks the host to open
     * the Notes chat grounded on the paper's full extracted text. Receives the
     * `.papers/<id>.txt` sidecar relpath. Undefined (or a non-cached-paper embed)
     * hides the button.
     */
    onChatAboutPaper?: (paperTextRelPath: string) => void;
}

function PdfBlockView({ node, updateAttributes, selected, extension }: NodeViewProps) {
    const url = String(node.attrs.url || '');
    const label = String(node.attrs.label || 'PDF');
    const classification = classifyPdfBlockUrl(url, window.location.origin);
    const href = classification.kind === 'invalid' ? undefined : classification.href;
    const onRequestFullWindow = (extension.options as PdfBlockOptions).onRequestFullWindow;
    const quickAskWorkspaceId = (extension.options as PdfBlockOptions).workspaceId;
    const getNotePath = (extension.options as PdfBlockOptions).getNotePath;
    const getNoteRoot = (extension.options as PdfBlockOptions).getNoteRoot;
    const onChatAboutPaper = (extension.options as PdfBlockOptions).onChatAboutPaper;
    // Goal 3 (AC-03): only cached, ingested arXiv papers have an extracted `.txt`
    // sidecar to ground on, so the chat action is offered only for those embeds.
    const paperTextPath = paperTextPathFromPdfUrl(url);
    const indent = Number(node.attrs.indent || 0);
    const collapsed = Boolean(node.attrs.collapsed);

    const attrHeight = node.attrs.height == null ? null : Number(node.attrs.height);
    const frameRef = useRef<HTMLIFrameElement>(null);
    const frameInnerRef = useRef<HTMLDivElement>(null);
    const [dragging, setDragging] = useState(false);
    const [dragHeight, setDragHeight] = useState<number | null>(null);
    // Inline PDFs render via pdf.js (host-selectable text layer) by default;
    // fall back to the native iframe only if pdf.js fails to load the document.
    const [pdfJsFailed, setPdfJsFailed] = useState(false);
    const handlePdfJsError = useCallback(() => setPdfJsFailed(true), []);

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
                        {paperTextPath && onChatAboutPaper && (
                            <button
                                type="button"
                                className="md-pdf-embed-chat"
                                data-testid="pdf-node-view-chat-about-paper"
                                title="Chat about this paper"
                                aria-label="Chat about this paper"
                                onClick={() => onChatAboutPaper(paperTextPath)}
                            >
                                💬
                            </button>
                        )}
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
                            Open in new tab
                        </button>
                    </span>
                </div>
                {!collapsed && (classification.kind === 'inline' ? (
                    <div className="md-pdf-embed-frame-wrap pdf-node-view-frame-wrap">
                        <div className="pdf-node-view-frame-inner" ref={frameInnerRef}>
                            {pdfJsFailed ? (
                                <iframe
                                    ref={frameRef}
                                    className="md-pdf-embed-frame"
                                    data-testid="pdf-node-view-frame"
                                    src={classification.href}
                                    title={label}
                                    loading="lazy"
                                    style={displayHeight ? { height: `${displayHeight}px` } : undefined}
                                />
                            ) : (
                                <PdfJsRenderer
                                    url={classification.href}
                                    label={label}
                                    height={displayHeight}
                                    onError={handlePdfJsError}
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
                            {/* Goal 1: Quick Ask over the pdf.js text layer. No-op
                                on the iframe fallback (no host-selectable text). */}
                            {!pdfJsFailed && (
                                <>
                                    <PdfQuickAskLayer
                                        containerRef={frameInnerRef}
                                        workspaceId={quickAskWorkspaceId}
                                        pdfUrl={url}
                                        getNotePath={getNotePath}
                                        getNoteRoot={getNoteRoot}
                                    />
                                    {/* Goal 4 AC-01: drag-a-box vision ask over a figure. */}
                                    <PdfRegionAskLayer
                                        containerRef={frameInnerRef}
                                        workspaceId={quickAskWorkspaceId}
                                        pdfUrl={url}
                                        getNotePath={getNotePath}
                                        getNoteRoot={getNoteRoot}
                                    />
                                    {/* Goal 2: re-render persisted annotations for this PDF. */}
                                    <PdfAnnotationsLayer
                                        containerRef={frameInnerRef}
                                        workspaceId={quickAskWorkspaceId}
                                        pdfUrl={url}
                                        getNotePath={getNotePath}
                                        getNoteRoot={getNoteRoot}
                                    />
                                </>
                            )}
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

export const PdfBlock = Node.create<PdfBlockOptions>({
    name: 'pdfBlock',
    group: 'block',
    atom: true,
    draggable: true,

    addOptions() {
        return {
            onRequestFullWindow: undefined,
        };
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
                        // A pre-fix raw placeholder may have leaked Markdown
                        // escapes into its label (`OSDI\_2026...`). Normalize one
                        // layer so the block shows the literal filename; new
                        // File.name-derived labels are already literal (no-op).
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
