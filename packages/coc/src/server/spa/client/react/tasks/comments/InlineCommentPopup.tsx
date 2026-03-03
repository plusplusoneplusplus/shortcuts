/**
 * InlineCommentPopup — portal-based floating popup for composing a new comment.
 */

import { useState, useEffect, useRef } from 'react';
import ReactDOM from 'react-dom';
import { Button } from '../../shared';
import type { TaskCommentCategory } from '../../../task-comments-types';
import { useBreakpoint } from '../../hooks/useBreakpoint';
import { BottomSheet } from '../../shared/BottomSheet';

const VIEWPORT_MARGIN = 8;

/**
 * Clamp a popup rect so it stays fully inside the viewport.
 * Returns adjusted { top, left } values.
 */
export function clampToViewport(
    position: { top: number; left: number },
    popupWidth: number,
    popupHeight: number,
    viewportWidth: number = window.innerWidth,
    viewportHeight: number = window.innerHeight,
    margin: number = VIEWPORT_MARGIN,
): { top: number; left: number } {
    let { top, left } = position;

    if (left + popupWidth + margin > viewportWidth) {
        left = viewportWidth - popupWidth - margin;
    }
    if (left < margin) {
        left = margin;
    }

    if (top + popupHeight + margin > viewportHeight) {
        top = viewportHeight - popupHeight - margin;
    }
    if (top < margin) {
        top = margin;
    }

    return { top, left };
}

export interface InlineCommentPopupProps {
    position: { top: number; left: number };
    onSubmit: (text: string, category: TaskCommentCategory) => void;
    onCancel: () => void;
}

export function InlineCommentPopup({ position, onSubmit, onCancel }: InlineCommentPopupProps) {
    const [text, setText] = useState('');
    const [clampedPos, setClampedPos] = useState(position);
    const textareaRef = useRef<HTMLTextAreaElement>(null);
    const popupRef = useRef<HTMLDivElement>(null);
    const { isMobile } = useBreakpoint();

    useEffect(() => {
        textareaRef.current?.focus();

        if (popupRef.current) {
            const rect = popupRef.current.getBoundingClientRect();
            setClampedPos(clampToViewport(position, rect.width, rect.height));
        }
    }, [position]);

    // Escape key closes
    useEffect(() => {
        const handler = (e: KeyboardEvent) => {
            if (e.key === 'Escape') onCancel();
            if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
                e.preventDefault();
                handleSubmit();
            }
        };
        document.addEventListener('keydown', handler);
        return () => document.removeEventListener('keydown', handler);
    }, [text]);

    // Click outside closes
    useEffect(() => {
        const handler = (e: MouseEvent) => {
            if (popupRef.current && !popupRef.current.contains(e.target as Node)) {
                onCancel();
            }
        };
        // Delay to avoid immediate close from the same click that opened popup
        const timer = setTimeout(() => {
            document.addEventListener('mousedown', handler);
        }, 0);
        return () => {
            clearTimeout(timer);
            document.removeEventListener('mousedown', handler);
        };
    }, [onCancel]);

    const handleSubmit = () => {
        const trimmed = text.trim();
        if (!trimmed) return;
        onSubmit(trimmed, 'general');
    };

    const popupContent = (
        <>
            {/* Textarea */}
            <textarea
                ref={textareaRef}
                className="w-full p-2 text-xs rounded border border-[#e0e0e0] dark:border-[#3c3c3c] bg-white dark:bg-[#1e1e1e] text-[#1e1e1e] dark:text-[#cccccc] resize-y min-h-[60px]"
                placeholder="Add your comment…"
                value={text}
                onChange={e => setText(e.target.value)}
                rows={3}
                data-testid="comment-textarea"
            />

            {/* Actions */}
            <div className="flex justify-end gap-1">
                <Button size="sm" variant="secondary" onClick={onCancel}>Cancel</Button>
                <Button size="sm" onClick={handleSubmit} disabled={!text.trim()}>
                    Submit <kbd className="ml-1 text-[9px] opacity-60">Ctrl+Enter</kbd>
                </Button>
            </div>
        </>
    );

    if (isMobile) {
        return (
            <BottomSheet isOpen={true} onClose={onCancel}>
                <div className="p-4 flex flex-col gap-2" data-testid="inline-comment-popup">
                    {popupContent}
                </div>
            </BottomSheet>
        );
    }

    return ReactDOM.createPortal(
        <div
            ref={popupRef}
            className="fixed z-[10003] w-[300px] rounded-lg bg-white dark:bg-[#252526] border border-[#e0e0e0] dark:border-[#3c3c3c] shadow-xl p-3 flex flex-col gap-2"
            style={{ top: clampedPos.top, left: clampedPos.left }}
            data-testid="inline-comment-popup"
        >
            {popupContent}
        </div>,
        document.body
    );
}
