/**
 * ToolResultPopover — hover popover that shows a preview of a tool call's result.
 * Rendered via React Portal to avoid clipping by parent overflow.
 */

import React, { useEffect, useRef, useState } from 'react';
import ReactDOM from 'react-dom';

const MAX_PREVIEW_LENGTH = 2000;

interface ToolResultPopoverProps {
    result: string;
    anchorRect: DOMRect;
    onMouseEnter: () => void;
    onMouseLeave: () => void;
}

export function ToolResultPopover({ result, anchorRect, onMouseEnter, onMouseLeave }: ToolResultPopoverProps) {
    const popoverRef = useRef<HTMLDivElement | null>(null);
    const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

    const truncated = result.length > MAX_PREVIEW_LENGTH;
    const visibleText = truncated ? result.slice(0, MAX_PREVIEW_LENGTH) + '\n… (truncated — click to see full)' : result;

    useEffect(() => {
        if (!popoverRef.current) return;
        const popRect = popoverRef.current.getBoundingClientRect();
        const gap = 4;

        let top = anchorRect.bottom + gap;
        let left = anchorRect.left;

        // Flip above if it would overflow the bottom
        if (top + popRect.height > window.innerHeight - 8) {
            top = anchorRect.top - popRect.height - gap;
        }
        if (top < 8) top = 8;

        // Clamp horizontal
        if (left + popRect.width > window.innerWidth - 8) {
            left = window.innerWidth - popRect.width - 8;
        }
        if (left < 8) left = 8;

        setPos({ top, left });
    }, [anchorRect]);

    return ReactDOM.createPortal(
        <div
            ref={popoverRef}
            data-testid="tool-result-popover"
            className="fixed z-50 w-[600px] max-w-[calc(100vw-16px)] max-h-[300px] overflow-y-auto rounded-md border border-[#e0e0e0] dark:border-[#3c3c3c] bg-white dark:bg-[#252526] p-3 shadow-lg"
            style={pos ? { top: pos.top, left: pos.left } : { top: anchorRect.bottom + 4, left: anchorRect.left, visibility: 'hidden' }}
            onMouseEnter={onMouseEnter}
            onMouseLeave={onMouseLeave}
        >
            <div className="text-[10px] uppercase text-[#848484] mb-1">Result Preview</div>
            <pre className="text-[11px] whitespace-pre-wrap break-words font-mono text-[#1e1e1e] dark:text-[#cccccc]">
                <code>{visibleText}</code>
            </pre>
        </div>,
        document.body
    );
}
