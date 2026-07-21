/**
 * QuickAskSidenotePopover — compact popover showing a side-note's quoted term
 * and AI answer, with Copy / Retry / Dismiss actions. Reuses the CommentPopover
 * shell styling; falls back to a BottomSheet on mobile.
 */

import { useEffect, useRef, useState } from 'react';
import ReactDOM from 'react-dom';
import { Spinner } from '../../../ui';
import { clampToViewport } from '../../../tasks/comments/viewportUtils';
import { MarkdownView } from '../../../shared/MarkdownView';
import { renderMarkdownToHtml } from '../../../../diff/markdown-renderer';
import { useBreakpoint } from '../../../hooks/ui/useBreakpoint';
import { BottomSheet } from '../../../ui/BottomSheet';
import type { ClientSideNote } from './types';

const ACTION_BTN = 'inline-flex items-center justify-center h-6 px-1.5 gap-1 rounded transition-colors text-[11px] text-[#848484] hover:text-[#1e1e1e] dark:hover:text-[#cccccc] hover:bg-black/[0.06] dark:hover:bg-white/[0.08]';

export interface QuickAskSidenotePopoverProps {
    note: ClientSideNote;
    position: { top: number; left: number };
    onClose: () => void;
    onCopy: (note: ClientSideNote) => void;
    onRetry: (id: string) => void;
    onDelete: (id: string) => void;
}

export function QuickAskSidenotePopover({
    note,
    position,
    onClose,
    onCopy,
    onRetry,
    onDelete,
}: QuickAskSidenotePopoverProps) {
    const ref = useRef<HTMLDivElement>(null);
    const [clampedPos, setClampedPos] = useState(position);
    const [copied, setCopied] = useState(false);
    const { isMobile } = useBreakpoint();

    useEffect(() => {
        if (ref.current) {
            const rect = ref.current.getBoundingClientRect();
            setClampedPos(clampToViewport(position, rect.width, rect.height));
        }
    }, [position]);

    useEffect(() => {
        const handler = (e: KeyboardEvent) => {
            if (e.key === 'Escape') {onClose();}
        };
        document.addEventListener('keydown', handler);
        return () => document.removeEventListener('keydown', handler);
    }, [onClose]);

    const handleCopy = () => {
        onCopy(note);
        setCopied(true);
        setTimeout(() => setCopied(false), 1200);
    };

    const content = (
        <>
            {/* Header */}
            <div className="flex items-center gap-1.5">
                <span className="text-[12px]" aria-hidden="true">💡</span>
                <span className="text-[11px] font-medium text-[#3794ff]">Quick answer</span>
                {note.createdAt && note.status === 'ready' && (
                    <span className="text-[10px] text-[#a0a0a0] ml-auto shrink-0">
                        {new Date(note.createdAt).toLocaleString()}
                    </span>
                )}
                {!isMobile && (
                    <button
                        className={`shrink-0 w-5 h-5 inline-flex items-center justify-center rounded text-[#848484] hover:text-[#1e1e1e] dark:hover:text-[#cccccc] hover:bg-black/[0.06] dark:hover:bg-white/[0.08] text-sm leading-none ${note.createdAt && note.status === 'ready' ? '' : 'ml-auto'}`}
                        onClick={onClose}
                        data-testid="quick-ask-popover-close"
                        aria-label="Close"
                    >
                        &times;
                    </button>
                )}
            </div>

            {/* Quoted term */}
            <blockquote className="border-l-2 border-[#3794ff] pl-2 text-[11px] text-[#848484] italic line-clamp-2">
                {note.anchor.selectedText.length > 200
                    ? note.anchor.selectedText.slice(0, 200) + '…'
                    : note.anchor.selectedText}
            </blockquote>

            {/* Body */}
            {note.status === 'asking' && (
                <div className="flex items-center gap-2 text-[11px] text-[#848484]" data-testid="quick-ask-popover-loading">
                    <Spinner size="sm" /> asking…
                </div>
            )}
            {note.status === 'error' && (
                <div
                    className="flex items-center gap-2 p-1.5 rounded bg-red-500/10 border border-red-500/20 text-[11px] text-red-600 dark:text-red-400"
                    data-testid="quick-ask-popover-error"
                >
                    <span className="flex-1">{note.error || 'Lookup failed'}</span>
                    <button className={ACTION_BTN} onClick={() => onRetry(note.id)} data-testid="quick-ask-popover-retry">
                        ↻ Retry
                    </button>
                </div>
            )}
            {note.status === 'ready' && (
                <div className="max-h-[200px] overflow-y-auto text-[12px] text-[#1e1e1e] dark:text-[#cccccc]" data-testid="quick-ask-popover-answer">
                    <MarkdownView html={renderMarkdownToHtml(note.answer)} />
                </div>
            )}

            {/* Actions */}
            <div className="flex items-center gap-1 pt-1 border-t border-[#e0e0e0] dark:border-[#3c3c3c]">
                {note.status === 'ready' && (
                    <button className={ACTION_BTN} onClick={handleCopy} title="Copy answer" data-testid="quick-ask-popover-copy">
                        {copied ? '✓ Copied' : '⧉ Copy'}
                    </button>
                )}
                <button
                    className={`${ACTION_BTN} ml-auto`}
                    onClick={() => { onDelete(note.id); onClose(); }}
                    title="Dismiss side-note"
                    data-testid="quick-ask-popover-dismiss"
                >
                    🗑 Dismiss
                </button>
            </div>
        </>
    );

    if (isMobile) {
        return (
            <BottomSheet isOpen={true} onClose={onClose}>
                <div className="p-4 flex flex-col gap-1.5" data-testid="quick-ask-popover">
                    {content}
                </div>
            </BottomSheet>
        );
    }

    return ReactDOM.createPortal(
        <div
            ref={ref}
            className="fixed z-[10003] min-w-[300px] max-w-[380px] rounded-lg bg-white dark:bg-[#252526] border border-[#e0e0e0] dark:border-[#3c3c3c] shadow-xl p-2.5 flex flex-col gap-1.5 overflow-hidden"
            style={{ top: clampedPos.top, left: clampedPos.left }}
            data-testid="quick-ask-popover"
        >
            {content}
        </div>,
        document.body,
    );
}
