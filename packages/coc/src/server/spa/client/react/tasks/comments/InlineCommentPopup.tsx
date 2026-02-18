/**
 * InlineCommentPopup — portal-based floating popup for composing a new comment.
 */

import { useState, useEffect, useRef } from 'react';
import ReactDOM from 'react-dom';
import { Button } from '../../shared';
import type { TaskCommentCategory } from '../../../task-comments-types';
import { CATEGORY_INFO, ALL_CATEGORIES } from '../../../task-comments-types';

export interface InlineCommentPopupProps {
    position: { top: number; left: number };
    onSubmit: (text: string, category: TaskCommentCategory) => void;
    onCancel: () => void;
}

export function InlineCommentPopup({ position, onSubmit, onCancel }: InlineCommentPopupProps) {
    const [text, setText] = useState('');
    const [category, setCategory] = useState<TaskCommentCategory>('general');
    const textareaRef = useRef<HTMLTextAreaElement>(null);
    const popupRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        textareaRef.current?.focus();
    }, []);

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
    }, [text, category]);

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
        onSubmit(trimmed, category);
    };

    return ReactDOM.createPortal(
        <div
            ref={popupRef}
            className="fixed z-[10003] w-[300px] rounded-lg bg-white dark:bg-[#252526] border border-[#e0e0e0] dark:border-[#3c3c3c] shadow-xl p-3 flex flex-col gap-2"
            style={{ top: position.top, left: position.left }}
            data-testid="inline-comment-popup"
        >
            {/* Category selector */}
            <div className="flex gap-1 flex-wrap">
                {ALL_CATEGORIES.map(cat => {
                    const info = CATEGORY_INFO[cat];
                    return (
                        <button
                            key={cat}
                            onClick={() => setCategory(cat)}
                            className={`px-1.5 py-0.5 text-[10px] rounded transition-colors ${
                                category === cat
                                    ? 'bg-[#0078d4] text-white'
                                    : 'text-[#848484] hover:bg-black/[0.04] dark:hover:bg-white/[0.04]'
                            }`}
                            title={info.label}
                            data-testid={`popup-category-${cat}`}
                        >
                            {info.icon} {info.label}
                        </button>
                    );
                })}
            </div>

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
        </div>,
        document.body
    );
}
