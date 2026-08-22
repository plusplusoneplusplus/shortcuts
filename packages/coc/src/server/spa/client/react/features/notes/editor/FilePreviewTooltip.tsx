/**
 * FilePreviewTooltip — floating tooltip for file-path hover preview.
 *
 * Shows file path, first ~10 lines of content, and an "Open" button.
 * Rendered as a React portal anchored to the hovered element.
 * Handles file-not-found state gracefully.
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { notesApi } from '../notesApi';

export interface FilePreviewTooltipProps {
    /** The file path being previewed. */
    filePath: string;
    /** The workspace ID for API calls. */
    workspaceId: string;
    /** The DOM element to anchor the tooltip to. */
    anchorEl: HTMLElement;
    /** Called when the user clicks the path chip or Open button. */
    onOpen?: (filePath: string, type: string) => void;
    /** Called when the mouse leaves the tooltip area. */
    onMouseLeave?: () => void;
}

interface PreviewData {
    content: string;
    exists: boolean;
    type: 'note' | 'file';
}

const MAX_PREVIEW_LINES = 10;

// Matches .file-preview-tooltip-card width in noteEditor.css.
const CARD_WIDTH = 360;
// Rough card height (header + 10 preview lines + footer) used to decide
// whether to flip above the anchor near the bottom of the viewport.
const CARD_ESTIMATED_HEIGHT = 280;
const VIEWPORT_MARGIN = 8;

export function FilePreviewTooltip({
    filePath,
    workspaceId,
    anchorEl,
    onOpen,
    onMouseLeave,
}: FilePreviewTooltipProps) {
    const [preview, setPreview] = useState<PreviewData | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(false);
    const tooltipRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        let cancelled = false;
        setLoading(true);
        setError(false);
        setPreview(null);

        notesApi.getFilePreview(workspaceId, filePath)
            .then((data: PreviewData) => {
                if (!cancelled) {
                    setPreview(data);
                    setLoading(false);
                }
            })
            .catch(() => {
                if (!cancelled) {
                    setError(true);
                    setLoading(false);
                }
            });

        return () => { cancelled = true; };
    }, [filePath, workspaceId]);

    // Position tooltip below the anchor element
    const [pos, setPos] = useState({ top: 0, left: 0 });
    useEffect(() => {
        // The anchor can be replaced under the cursor (e.g. a ProseMirror
        // redraw recreates the hovered element) before the hover timer fires.
        // Measuring a detached element yields an all-zero rect, which would
        // pin the tooltip to the top-left corner — dismiss instead.
        const rect = anchorEl.getBoundingClientRect();
        const zeroRect = rect.top === 0 && rect.left === 0
            && rect.width === 0 && rect.height === 0;
        if (!anchorEl.isConnected || zeroRect) {
            onMouseLeave?.();
            return;
        }
        let top = rect.bottom + 4;
        if (top + CARD_ESTIMATED_HEIGHT > window.innerHeight) {
            top = Math.max(VIEWPORT_MARGIN, rect.top - 4 - CARD_ESTIMATED_HEIGHT);
        }
        const left = Math.min(
            Math.max(rect.left, VIEWPORT_MARGIN),
            Math.max(VIEWPORT_MARGIN, window.innerWidth - CARD_WIDTH - VIEWPORT_MARGIN),
        );
        setPos({
            top: top + window.scrollY,
            left: left + window.scrollX,
        });
    }, [anchorEl, onMouseLeave]);

    const handleOpen = useCallback(() => {
        if (preview) {
            onOpen?.(filePath, preview.type);
        }
    }, [filePath, preview, onOpen]);

    const truncatedContent = preview?.content
        ? preview.content.split('\n').slice(0, MAX_PREVIEW_LINES).join('\n')
        : '';
    const totalLines = preview?.content?.split('\n').length ?? 0;
    const isTruncated = totalLines > MAX_PREVIEW_LINES;

    return createPortal(
        <div
            ref={tooltipRef}
            className="file-preview-tooltip-card"
            style={{
                position: 'absolute',
                top: pos.top,
                left: pos.left,
                zIndex: 9999,
            }}
            onMouseLeave={onMouseLeave}
            data-testid="file-preview-tooltip"
        >
            {/* Header: file path */}
            <div className="file-preview-tooltip-header">
                <span className="file-preview-tooltip-path" title={filePath}>
                    📄 {filePath}
                </span>
            </div>

            {/* Body */}
            <div className="file-preview-tooltip-body">
                {loading && (
                    <div className="file-preview-tooltip-loading">Loading…</div>
                )}
                {!loading && (error || !preview?.exists) && (
                    <div className="file-preview-tooltip-not-found">File not found</div>
                )}
                {!loading && preview?.exists && (
                    <>
                        <pre className="file-preview-tooltip-content">
                            <code>{truncatedContent}</code>
                        </pre>
                        {isTruncated && (
                            <div className="file-preview-tooltip-truncated">
                                … {totalLines - MAX_PREVIEW_LINES} more lines
                            </div>
                        )}
                    </>
                )}
            </div>

            {/* Footer: Open button */}
            {!loading && preview?.exists && (
                <div className="file-preview-tooltip-footer">
                    <button
                        type="button"
                        className="file-preview-tooltip-open-btn"
                        onClick={handleOpen}
                        data-testid="file-preview-open-btn"
                    >
                        Open
                    </button>
                </div>
            )}
        </div>,
        document.body,
    );
}
