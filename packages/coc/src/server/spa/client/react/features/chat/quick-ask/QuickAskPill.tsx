/**
 * QuickAskPill — floating "✨ Ask AI" pill shown just above a text selection
 * inside an assistant turn. Portals to document.body with a high z-index and a
 * quick fade/scale-in.
 */

import { useEffect, useRef, useState } from 'react';
import ReactDOM from 'react-dom';
import { clampToViewport } from '../../../tasks/comments/viewportUtils';

export interface QuickAskPillProps {
    /** Viewport rect of the selection. */
    rect: { top: number; left: number; bottom: number; right: number };
    /** Fire the lookup. */
    onAsk: () => void;
    /** Dismiss without asking. */
    onDismiss: () => void;
}

const PILL_WIDTH = 92;
const PILL_HEIGHT = 28;
const GAP = 8;

export function QuickAskPill({ rect, onAsk, onDismiss }: QuickAskPillProps) {
    const ref = useRef<HTMLButtonElement>(null);
    const [mounted, setMounted] = useState(false);

    // Prefer above the selection; clampToViewport nudges it back on-screen.
    const desired = { top: rect.top - PILL_HEIGHT - GAP, left: rect.left };
    const [pos, setPos] = useState(() => clampToViewport(desired, PILL_WIDTH, PILL_HEIGHT));

    useEffect(() => {
        setPos(clampToViewport({ top: rect.top - PILL_HEIGHT - GAP, left: rect.left }, PILL_WIDTH, PILL_HEIGHT));
    }, [rect.top, rect.left]);

    useEffect(() => {
        const id = requestAnimationFrame(() => setMounted(true));
        return () => cancelAnimationFrame(id);
    }, []);

    // Dismiss on Escape.
    useEffect(() => {
        const handler = (e: KeyboardEvent) => {
            if (e.key === 'Escape') {onDismiss();}
        };
        document.addEventListener('keydown', handler);
        return () => document.removeEventListener('keydown', handler);
    }, [onDismiss]);

    return ReactDOM.createPortal(
        <button
            ref={ref}
            type="button"
            data-testid="quick-ask-pill"
            // Prevent the click from collapsing/altering the selection before onAsk.
            onMouseDown={e => e.preventDefault()}
            onClick={onAsk}
            className="fixed z-[10004] inline-flex items-center gap-1 px-2.5 h-7 rounded-full bg-[#252526] border border-[#3c3c3c] shadow-xl text-[12px] font-medium text-[#3794ff] hover:bg-[#2d2d2e] transition-all duration-150 ease-out"
            style={{
                top: pos.top,
                left: pos.left,
                opacity: mounted ? 1 : 0,
                transform: mounted ? 'scale(1)' : 'scale(0.9)',
            }}
            title="Ask AI about the selected text (Cmd/Ctrl+J)"
        >
            <span aria-hidden="true">✨</span>
            <span>Ask AI</span>
        </button>,
        document.body,
    );
}
