/**
 * InlineCommentPopup — portal-based floating popup for composing a new comment.
 */

import { useState, useEffect, useRef } from 'react';
import ReactDOM from 'react-dom';
import { Button } from '../../ui';
import type { TaskCommentCategory } from '../../../comments/task-comments-types';
import { ALL_CATEGORIES, CATEGORY_INFO } from '../../../comments/task-comments-types';
import { useBreakpoint } from '../../hooks/ui/useBreakpoint';
import { BottomSheet } from '../../ui/BottomSheet';
import { useDraggable } from '../../hooks/ui/useDraggable';

// Re-export for backward compatibility (tests and other consumers import from here).
export { clampToViewport } from './viewportUtils';

export interface InlineCommentPopupProps {
    position: { top: number; left: number };
    onSubmit: (text: string, category: TaskCommentCategory) => void;
    onCancel: () => void;
}

export function InlineCommentPopup({ position, onSubmit, onCancel }: InlineCommentPopupProps) {
    const [text, setText] = useState('');
    const [selectedCategory, setSelectedCategory] = useState<TaskCommentCategory>('general');
    const textareaRef = useRef<HTMLTextAreaElement>(null);
    const popupRef = useRef<HTMLDivElement>(null);
    const { isMobile } = useBreakpoint();
    const { position: clampedPos, handleMouseDown: handleDragStart } = useDraggable(position, popupRef);

    useEffect(() => {
        setText('');
        setSelectedCategory('general');
        textareaRef.current?.focus();
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


    const handleSubmit = () => {
        const trimmed = text.trim();
        if (!trimmed) return;
        onSubmit(trimmed, selectedCategory);
    };

    const popupContent = (
        <>
            {/* Textarea */}
            <textarea
                ref={textareaRef}
                className="w-full p-2 text-xs rounded border border-[#e0e0e0] dark:border-[#3c3c3c] bg-white dark:bg-[#1e1e1e] text-[#1e1e1e] dark:text-[#cccccc] resize-none flex-1 min-h-[60px]"
                placeholder="Add your comment…"
                value={text}
                onChange={e => setText(e.target.value)}
                rows={3}
                data-testid="comment-textarea"
            />

            {/* Category picker */}
            <div className="flex flex-wrap gap-1" data-testid="category-picker">
                {ALL_CATEGORIES.map(cat => {
                    const info = CATEGORY_INFO[cat];
                    const isSelected = cat === selectedCategory;
                    return (
                        <button
                            key={cat}
                            type="button"
                            title={info.label}
                            data-testid={`category-chip-${cat}`}
                            className={`inline-flex items-center gap-0.5 px-2 py-0.5 rounded-full text-[11px] leading-tight transition-colors ${
                                isSelected
                                    ? 'bg-[#0078d4] text-white'
                                    : 'text-[#848484] hover:bg-black/[0.04] dark:hover:bg-white/[0.06]'
                            }`}
                            onClick={() => setSelectedCategory(cat)}
                        >
                            <span>{info.icon}</span>
                            <span>{info.label}</span>
                        </button>
                    );
                })}
            </div>

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
            className="fixed z-[10003] min-w-[300px] rounded-lg bg-white dark:bg-[#252526] border border-[#e0e0e0] dark:border-[#3c3c3c] shadow-xl flex flex-col overflow-hidden resize"
            style={{ top: clampedPos.top, left: clampedPos.left }}
            data-testid="inline-comment-popup"
        >
            {/* Drag handle */}
            <div
                className="flex items-center justify-center h-5 cursor-move select-none bg-[#f3f3f3] dark:bg-[#2d2d2d] border-b border-[#e0e0e0] dark:border-[#3c3c3c] rounded-t-lg flex-shrink-0"
                onMouseDown={handleDragStart}
                data-testid="drag-handle"
                title="Drag to move"
                aria-label="Drag to move"
            >
                <span className="text-[#848484] dark:text-[#6e6e6e] text-xs tracking-widest pointer-events-none">⠿</span>
            </div>
            <div className="p-3 flex flex-col gap-2">
                {popupContent}
            </div>
        </div>,
        document.body
    );
}
