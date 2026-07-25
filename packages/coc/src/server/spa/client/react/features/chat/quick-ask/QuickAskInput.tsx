/**
 * QuickAskInput — inline single-line question box shown in place of the ✨ Ask AI
 * pill once it's triggered (click or Cmd/Ctrl+J). The user types a custom
 * question about the selected text; Enter submits, Escape cancels. Submitting
 * with empty/whitespace text still submits (the default "Briefly explain"
 * behavior), so the one-click fast path is never regressed.
 *
 * Portals to document.body and reuses the pill's floating placement so it sits
 * exactly where the pill did.
 */

import { useEffect, useRef, useState } from 'react';
import ReactDOM from 'react-dom';
import { clampToViewport } from '../../../tasks/comments/viewportUtils';

export interface QuickAskInputProps {
    /** Viewport rect of the selection (same anchor the pill used). */
    rect: { top: number; left: number; bottom: number; right: number };
    /** Submit the (possibly empty) question. */
    onSubmit: (question: string) => void;
    /** Cancel / dismiss without asking. */
    onCancel: () => void;
}

const INPUT_WIDTH = 280;
const INPUT_HEIGHT = 32;
const GAP = 8;
/** Max chars a custom question may be (single line). */
export const QUICK_ASK_MAX_LEN = 200;

export function QuickAskInput({ rect, onSubmit, onCancel }: QuickAskInputProps) {
    const inputRef = useRef<HTMLInputElement>(null);
    const [mounted, setMounted] = useState(false);
    const [value, setValue] = useState('');

    // Prefer above the selection; clampToViewport nudges it back on-screen.
    const [pos, setPos] = useState(() =>
        clampToViewport({ top: rect.top - INPUT_HEIGHT - GAP, left: rect.left }, INPUT_WIDTH, INPUT_HEIGHT));

    useEffect(() => {
        setPos(clampToViewport({ top: rect.top - INPUT_HEIGHT - GAP, left: rect.left }, INPUT_WIDTH, INPUT_HEIGHT));
    }, [rect.top, rect.left]);

    // Fade/scale in and autofocus the field.
    useEffect(() => {
        const id = requestAnimationFrame(() => {
            setMounted(true);
            inputRef.current?.focus();
        });
        return () => cancelAnimationFrame(id);
    }, []);

    const submit = () => onSubmit(value);

    return ReactDOM.createPortal(
        <div
            data-testid="quick-ask-input"
            // Prevent this pointer-down from being treated as an outside click.
            onMouseDown={e => e.stopPropagation()}
            className="fixed z-[10004] flex items-center gap-1 pl-2.5 pr-1 h-8 rounded-full bg-[#252526] border border-[#3c3c3c] shadow-xl"
            style={{
                top: pos.top,
                left: pos.left,
                width: INPUT_WIDTH,
                opacity: mounted ? 1 : 0,
                transform: mounted ? 'scale(1)' : 'scale(0.95)',
                transition: 'opacity 150ms ease-out, transform 150ms ease-out',
            }}
        >
            <span aria-hidden="true" className="text-[12px] select-none">✨</span>
            <input
                ref={inputRef}
                type="text"
                maxLength={QUICK_ASK_MAX_LEN}
                value={value}
                onChange={e => setValue(e.target.value)}
                onKeyDown={e => {
                    if (e.key === 'Enter') {
                        e.preventDefault();
                        submit();
                    } else if (e.key === 'Escape') {
                        e.preventDefault();
                        onCancel();
                    }
                }}
                placeholder="Ask about this…"
                data-testid="quick-ask-input-field"
                className="flex-1 min-w-0 bg-transparent outline-none text-[12px] text-[#cccccc] placeholder:text-[#6b6b6b]"
            />
            <button
                type="button"
                data-testid="quick-ask-input-submit"
                // Keep focus in the field; don't collapse anything before submit.
                onMouseDown={e => e.preventDefault()}
                onClick={submit}
                className="shrink-0 inline-flex items-center justify-center w-6 h-6 rounded-full text-[#3794ff] hover:bg-[#2d2d2e] transition-colors"
                title="Ask (Enter)"
                aria-label="Ask"
            >
                ↵
            </button>
        </div>,
        document.body,
    );
}
