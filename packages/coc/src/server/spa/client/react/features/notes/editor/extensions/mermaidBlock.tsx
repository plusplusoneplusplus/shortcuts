/**
 * MermaidBlock — TipTap node extension that renders Mermaid diagrams inline.
 *
 * Parses `<pre><code class="language-mermaid">` HTML (as emitted by marked)
 * into an atom block node with a React NodeView that supports preview/source toggle.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import type { MouseEvent as ReactMouseEvent, WheelEvent as ReactWheelEvent } from 'react';
import { Node } from '@tiptap/core';
import { NodeViewWrapper, ReactNodeViewRenderer } from '@tiptap/react';
import type { NodeViewProps } from '@tiptap/react';
import { ensureMermaid } from '../../../../hooks/ui/useMermaid';
import { createIndentAttribute, renderIndentAttr } from './indentShared';

declare const mermaid: {
    run(opts: { nodes: NodeListOf<Element> | Element[] }): Promise<void>;
};

const MIN_ZOOM = 0.25;
const MAX_ZOOM = 4;
const ZOOM_STEP = 0.25;

function escapeHtmlForMermaid(str: string): string {
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function clampZoom(value: number): number {
    return Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, value));
}

function formatZoomLabel(value: number): string {
    return `${Math.round(value * 100)}%`;
}

// ── React NodeView Component ────────────────────────────────────────────────

export function MermaidBlockView({ node }: NodeViewProps) {
    const [mode, setMode] = useState<'preview' | 'source'>('preview');
    const [error, setError] = useState<string | null>(null);
    const [zoom, setZoom] = useState(1);
    const [pan, setPan] = useState({ x: 0, y: 0 });
    const preRef = useRef<HTMLPreElement>(null);
    const previewRef = useRef<HTMLDivElement>(null);
    const dragRef = useRef<{
        active: boolean;
        startX: number;
        startY: number;
        originX: number;
        originY: number;
    }>({ active: false, startX: 0, startY: 0, originX: 0, originY: 0 });

    useEffect(() => {
        if (mode !== 'preview') return;
        const el = preRef.current;
        if (!el) return;

        // Reset so mermaid re-renders on code change
        el.removeAttribute('data-processed');
        el.innerHTML = escapeHtmlForMermaid(node.attrs.code);

        ensureMermaid()
            .then(() => mermaid.run({ nodes: [el] }))
            .catch((err) => setError(err instanceof Error ? err.message : 'Render error'));
    }, [node.attrs.code, mode]);

    const setZoomAtPoint = useCallback((nextZoom: number, anchorX: number, anchorY: number) => {
        const clamped = clampZoom(nextZoom);
        if (clamped === zoom) return;

        setPan((currentPan) => ({
            x: anchorX - ((anchorX - currentPan.x) / zoom) * clamped,
            y: anchorY - ((anchorY - currentPan.y) / zoom) * clamped,
        }));
        setZoom(clamped);
    }, [zoom]);

    const zoomBy = useCallback((delta: number) => {
        const preview = previewRef.current;
        if (!preview) {
            setZoom(clampZoom(zoom + delta));
            return;
        }

        const rect = preview.getBoundingClientRect();
        setZoomAtPoint(zoom + delta, rect.width / 2, rect.height / 2);
    }, [setZoomAtPoint, zoom]);

    const resetZoom = useCallback(() => {
        setZoom(1);
        setPan({ x: 0, y: 0 });
    }, []);

    const handleWheel = useCallback((event: ReactWheelEvent<HTMLDivElement>) => {
        if (!event.ctrlKey && !event.metaKey) return;
        event.preventDefault();
        event.stopPropagation();

        const rect = event.currentTarget.getBoundingClientRect();
        setZoomAtPoint(
            zoom + (event.deltaY > 0 ? -ZOOM_STEP : ZOOM_STEP),
            event.clientX - rect.left,
            event.clientY - rect.top,
        );
    }, [setZoomAtPoint, zoom]);

    const handleMouseDown = useCallback((event: ReactMouseEvent<HTMLDivElement>) => {
        if (event.button !== 0) return;
        event.preventDefault();
        event.stopPropagation();
        dragRef.current = {
            active: true,
            startX: event.clientX,
            startY: event.clientY,
            originX: pan.x,
            originY: pan.y,
        };
        previewRef.current?.classList.add('mermaid-node-view-dragging');
    }, [pan]);

    useEffect(() => {
        const handleMouseMove = (event: MouseEvent) => {
            const drag = dragRef.current;
            if (!drag.active) return;
            setPan({
                x: drag.originX + (event.clientX - drag.startX),
                y: drag.originY + (event.clientY - drag.startY),
            });
        };

        const handleMouseUp = () => {
            if (!dragRef.current.active) return;
            dragRef.current.active = false;
            previewRef.current?.classList.remove('mermaid-node-view-dragging');
        };

        document.addEventListener('mousemove', handleMouseMove);
        document.addEventListener('mouseup', handleMouseUp);
        return () => {
            document.removeEventListener('mousemove', handleMouseMove);
            document.removeEventListener('mouseup', handleMouseUp);
        };
    }, []);

    const zoomLabel = formatZoomLabel(zoom);
    const indent = Number(node.attrs.indent || 0);

    return (
        <NodeViewWrapper
            className="mermaid-node-view"
            data-drag-handle=""
            data-indent={indent > 0 ? indent : undefined}
        >
            <div className="mermaid-node-view-toolbar">
                <button
                    type="button"
                    onClick={() => setMode((m) => (m === 'preview' ? 'source' : 'preview'))}
                >
                    {mode === 'preview' ? '</> Source' : '▶ Preview'}
                </button>
                {mode === 'preview' && (
                    <div className="mermaid-node-view-zoom-controls" aria-label="Mermaid zoom controls">
                        <button
                            type="button"
                            aria-label="Zoom out"
                            title="Zoom out"
                            disabled={zoom <= MIN_ZOOM}
                            onClick={() => zoomBy(-ZOOM_STEP)}
                        >
                            -
                        </button>
                        <span className="mermaid-node-view-zoom-level" aria-live="polite">
                            {zoomLabel}
                        </span>
                        <button
                            type="button"
                            aria-label="Zoom in"
                            title="Zoom in"
                            disabled={zoom >= MAX_ZOOM}
                            onClick={() => zoomBy(ZOOM_STEP)}
                        >
                            +
                        </button>
                        <button
                            type="button"
                            aria-label="Reset zoom"
                            title="Reset zoom"
                            onClick={resetZoom}
                        >
                            Reset
                        </button>
                    </div>
                )}
            </div>

            {error && <div className="mermaid-node-view-error">{error}</div>}

            {mode === 'preview' ? (
                <div
                    ref={previewRef}
                    className="mermaid-node-view-preview"
                    onWheel={handleWheel}
                    onMouseDown={handleMouseDown}
                >
                    <div
                        className="mermaid-node-view-canvas"
                        style={{
                            transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
                        }}
                    >
                        <pre ref={preRef} className="mermaid" />
                    </div>
                </div>
            ) : (
                <pre className="mermaid-node-view-source">
                    <code>{node.attrs.code}</code>
                </pre>
            )}
        </NodeViewWrapper>
    );
}

// ── TipTap Extension ────────────────────────────────────────────────────────

export const MermaidBlock = Node.create({
    name: 'mermaidBlock',
    group: 'block',
    atom: true,
    draggable: true,

    addAttributes() {
        return {
            code: { default: '' },
            indent: createIndentAttribute(),
        };
    },

    parseHTML() {
        return [
            {
                tag: 'pre',
                getAttrs: (node: HTMLElement) => {
                    const code = node.querySelector('code.language-mermaid');
                    if (!code) return false;
                    return { code: code.textContent ?? '' };
                },
            },
        ];
    },

    renderHTML({ node }) {
        return ['pre', renderIndentAttr(node.attrs.indent), ['code', { class: 'language-mermaid' }, node.attrs.code]];
    },

    addNodeView() {
        return ReactNodeViewRenderer(MermaidBlockView);
    },
});
