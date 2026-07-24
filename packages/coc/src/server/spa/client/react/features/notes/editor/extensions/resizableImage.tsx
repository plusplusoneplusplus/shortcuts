/**
 * ResizableImage — Custom Tiptap image extension with drag-resize handles.
 *
 * Extends @tiptap/extension-image with:
 * - Optional `width` attribute persisted into the document model
 * - React NodeView rendering corner drag handles for resizing
 * - Aspect-ratio lock during drag
 * - Double-click to reset to original size
 * - Minimum width constraint (50px)
 */

import { useRef, useState, useCallback, useEffect } from 'react';
import { Node, mergeAttributes } from '@tiptap/core';
import { NodeViewWrapper, ReactNodeViewRenderer } from '@tiptap/react';
import type { NodeViewProps } from '@tiptap/react';
import { createIndentAttribute } from './indentShared';

const MIN_WIDTH = 50;

// ── React NodeView Component ────────────────────────────────────────────────

function ResizableImageView({ node, updateAttributes, selected }: NodeViewProps) {
    const imgRef = useRef<HTMLImageElement>(null);
    const [dragging, setDragging] = useState(false);
    const [dragWidth, setDragWidth] = useState<number | null>(null);
    const [hovered, setHovered] = useState(false);

    const { src, alt, title, width, indent } = node.attrs;

    const currentWidth = dragging ? dragWidth : width ? Number(width) : null;

    const handleDoubleClick = useCallback(() => {
        updateAttributes({ width: null });
    }, [updateAttributes]);

    const handleDragStart = useCallback(
        (e: React.MouseEvent, corner: string) => {
            e.preventDefault();
            e.stopPropagation();

            const img = imgRef.current;
            if (!img) return;

            const startX = e.clientX;
            const startWidth = img.getBoundingClientRect().width;
            const isLeft = corner === 'top-left' || corner === 'bottom-left';

            setDragging(true);
            setDragWidth(Math.round(startWidth));

            const onMouseMove = (ev: MouseEvent) => {
                const dx = ev.clientX - startX;
                const newWidth = Math.max(MIN_WIDTH, Math.round(startWidth + (isLeft ? -dx : dx)));
                setDragWidth(newWidth);
            };

            const onMouseUp = (ev: MouseEvent) => {
                document.removeEventListener('mousemove', onMouseMove);
                document.removeEventListener('mouseup', onMouseUp);
                const dx = ev.clientX - startX;
                const finalWidth = Math.max(MIN_WIDTH, Math.round(startWidth + (isLeft ? -dx : dx)));
                setDragging(false);
                setDragWidth(null);
                updateAttributes({ width: finalWidth });
            };

            document.addEventListener('mousemove', onMouseMove);
            document.addEventListener('mouseup', onMouseUp);
        },
        [updateAttributes],
    );

    // Compute display height to maintain aspect ratio during drag
    const [naturalAspect, setNaturalAspect] = useState<number | null>(null);
    useEffect(() => {
        const img = imgRef.current;
        if (!img) return;
        const onLoad = () => {
            if (img.naturalWidth && img.naturalHeight) {
                setNaturalAspect(img.naturalHeight / img.naturalWidth);
            }
        };
        if (img.complete && img.naturalWidth) {
            onLoad();
        } else {
            img.addEventListener('load', onLoad);
            return () => img.removeEventListener('load', onLoad);
        }
    }, [src]);

    const displayHeight =
        currentWidth && naturalAspect ? Math.round(currentWidth * naturalAspect) : undefined;

    const showHandles = hovered || selected || dragging;
    const hasCustomWidth = width != null;

    return (
        <NodeViewWrapper
            className={`image-resize-wrapper${dragging ? ' image-resizing' : ''}`}
            data-drag-handle=""
            data-indent={indent && indent > 0 ? indent : undefined}
        >
            <div
                className="image-resize-container"
                style={{ width: currentWidth ? `${currentWidth}px` : undefined }}
                onMouseEnter={() => setHovered(true)}
                onMouseLeave={() => setHovered(false)}
                onDoubleClick={handleDoubleClick}
            >
                <img
                    ref={imgRef}
                    src={src}
                    alt={alt ?? ''}
                    title={title ?? undefined}
                    width={currentWidth ?? undefined}
                    height={displayHeight ?? undefined}
                    className={selected ? 'ProseMirror-selectednode' : ''}
                    draggable={false}
                />

                {showHandles && (
                    <>
                        <div
                            className="image-resize-handle top-left"
                            onMouseDown={(e) => handleDragStart(e, 'top-left')}
                        />
                        <div
                            className="image-resize-handle top-right"
                            onMouseDown={(e) => handleDragStart(e, 'top-right')}
                        />
                        <div
                            className="image-resize-handle bottom-left"
                            onMouseDown={(e) => handleDragStart(e, 'bottom-left')}
                        />
                        <div
                            className="image-resize-handle bottom-right"
                            onMouseDown={(e) => handleDragStart(e, 'bottom-right')}
                        />
                    </>
                )}

                {dragging && currentWidth && displayHeight && (
                    <div className="image-resize-tooltip">
                        {currentWidth} × {displayHeight}
                    </div>
                )}

                {hasCustomWidth && showHandles && !dragging && (
                    <button
                        className="image-resize-reset"
                        onClick={(e) => {
                            e.stopPropagation();
                            updateAttributes({ width: null });
                        }}
                        title="Reset to original size"
                    >
                        ↺
                    </button>
                )}
            </div>
        </NodeViewWrapper>
    );
}

// ── Tiptap Extension ────────────────────────────────────────────────────────

export const ResizableImage = Node.create({
    name: 'image',

    addOptions() {
        return {
            inline: false,
            allowBase64: false,
            HTMLAttributes: {},
        };
    },

    inline() {
        return this.options.inline;
    },

    group() {
        return this.options.inline ? 'inline' : 'block';
    },

    draggable: true,

    addAttributes() {
        return {
            src: { default: null },
            alt: { default: null },
            title: { default: null },
            width: {
                default: null,
                parseHTML: (element: HTMLElement) => {
                    const w = element.getAttribute('width');
                    return w ? Number(w) : null;
                },
                renderHTML: (attributes: Record<string, unknown>) => {
                    if (!attributes.width) return {};
                    return { width: attributes.width };
                },
            },
            indent: createIndentAttribute(),
        };
    },

    parseHTML() {
        return [{ tag: 'img[src]' }];
    },

    renderHTML({ HTMLAttributes }) {
        return ['img', mergeAttributes(this.options.HTMLAttributes, HTMLAttributes)];
    },

    addNodeView() {
        return ReactNodeViewRenderer(ResizableImageView);
    },
});
