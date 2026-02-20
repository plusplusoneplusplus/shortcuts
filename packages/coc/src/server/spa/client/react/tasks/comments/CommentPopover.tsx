/**
 * CommentPopover — portal-based floating popover that displays a comment's
 * content next to its highlighted text in the editor.
 */

import { useEffect, useRef, useState } from 'react';
import ReactDOM from 'react-dom';
import { Badge, Button } from '../../shared';
import { clampToViewport } from './InlineCommentPopup';
import type { TaskComment, TaskCommentCategory } from '../../../task-comments-types';
import { CATEGORY_INFO, getCommentCategory } from '../../../task-comments-types';

export interface CommentPopoverProps {
    comment: TaskComment;
    position: { top: number; left: number };
    onClose: () => void;
    onResolve: (id: string) => void;
    onUnresolve: (id: string) => void;
    onDelete: (id: string) => void;
    onEdit: (id: string, text: string) => void;
}

export function CommentPopover({
    comment,
    position,
    onClose,
    onResolve,
    onUnresolve,
    onDelete,
    onEdit,
}: CommentPopoverProps) {
    const popoverRef = useRef<HTMLDivElement>(null);
    const [clampedPos, setClampedPos] = useState(position);
    const [editing, setEditing] = useState(false);
    const [editText, setEditText] = useState(comment.comment);

    const category: TaskCommentCategory = getCommentCategory(comment);
    const info = CATEGORY_INFO[category];
    const isResolved = comment.status === 'resolved';

    useEffect(() => {
        if (popoverRef.current) {
            const rect = popoverRef.current.getBoundingClientRect();
            setClampedPos(clampToViewport(position, rect.width, rect.height));
        }
    }, [position]);

    useEffect(() => {
        const handler = (e: KeyboardEvent) => {
            if (e.key === 'Escape') onClose();
        };
        document.addEventListener('keydown', handler);
        return () => document.removeEventListener('keydown', handler);
    }, [onClose]);

    useEffect(() => {
        const handler = (e: MouseEvent) => {
            if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
                onClose();
            }
        };
        const timer = setTimeout(() => {
            document.addEventListener('mousedown', handler);
        }, 0);
        return () => {
            clearTimeout(timer);
            document.removeEventListener('mousedown', handler);
        };
    }, [onClose]);

    const handleSave = () => {
        const trimmed = editText.trim();
        if (trimmed && trimmed !== comment.comment) {
            onEdit(comment.id, trimmed);
        }
        setEditing(false);
    };

    return ReactDOM.createPortal(
        <div
            ref={popoverRef}
            className="fixed z-[10003] w-[320px] rounded-lg bg-white dark:bg-[#252526] border border-[#e0e0e0] dark:border-[#3c3c3c] shadow-xl p-3 flex flex-col gap-2"
            style={{ top: clampedPos.top, left: clampedPos.left }}
            data-testid="comment-popover"
        >
            {/* Header with category + status */}
            <div className="flex items-center gap-1.5 flex-wrap">
                <Badge status={isResolved ? 'completed' : 'running'}>
                    {isResolved ? '✅ Resolved' : '🟢 Open'}
                </Badge>
                <Badge status="queued">
                    {info.icon} {info.label}
                </Badge>
                <button
                    className="ml-auto text-[#848484] hover:text-[#1e1e1e] dark:hover:text-[#cccccc] text-sm leading-none"
                    onClick={onClose}
                    data-testid="popover-close"
                    aria-label="Close"
                >
                    &times;
                </button>
            </div>

            {/* Selected text blockquote */}
            {comment.selectedText && (
                <blockquote className="border-l-2 border-[#0078d4] dark:border-[#3794ff] pl-2 text-[11px] text-[#848484] italic">
                    {comment.selectedText.length > 200
                        ? comment.selectedText.substring(0, 200) + '…'
                        : comment.selectedText}
                </blockquote>
            )}

            {/* Comment body or edit textarea */}
            {editing ? (
                <div className="flex flex-col gap-1">
                    <textarea
                        className="w-full p-1.5 text-xs rounded border border-[#e0e0e0] dark:border-[#3c3c3c] bg-white dark:bg-[#1e1e1e] text-[#1e1e1e] dark:text-[#cccccc] resize-y min-h-[60px]"
                        value={editText}
                        onChange={e => setEditText(e.target.value)}
                        rows={3}
                        data-testid="popover-edit-textarea"
                        autoFocus
                    />
                    <div className="flex gap-1 justify-end">
                        <Button size="sm" variant="secondary" onClick={() => setEditing(false)}>Cancel</Button>
                        <Button size="sm" onClick={handleSave}>Save</Button>
                    </div>
                </div>
            ) : (
                <div className="text-xs text-[#1e1e1e] dark:text-[#cccccc]" data-testid="popover-comment-body">
                    {comment.comment}
                </div>
            )}

            {/* Author + timestamp */}
            <div className="flex items-center gap-2 text-[10px] text-[#848484]">
                <span>{comment.author || 'Anonymous'}</span>
                {comment.createdAt && (
                    <span>{new Date(comment.createdAt).toLocaleString()}</span>
                )}
            </div>

            {/* AI response */}
            {comment.aiResponse && (
                <div className="p-2 rounded bg-[#0078d4]/5 dark:bg-[#3794ff]/5 border-l-2 border-[#0078d4] dark:border-[#3794ff]" data-testid="popover-ai-response">
                    <div className="text-[10px] text-[#0078d4] dark:text-[#3794ff] font-medium mb-1">🤖 AI Response</div>
                    <div className="text-xs text-[#1e1e1e] dark:text-[#cccccc]">{comment.aiResponse}</div>
                </div>
            )}

            {/* Action row */}
            {!editing && (
                <div className="flex gap-1 flex-wrap pt-1 border-t border-[#e0e0e0] dark:border-[#3c3c3c]">
                    {isResolved ? (
                        <Button size="sm" variant="ghost" onClick={() => onUnresolve(comment.id)}>🔓 Reopen</Button>
                    ) : (
                        <Button size="sm" variant="ghost" onClick={() => onResolve(comment.id)}>✅ Resolve</Button>
                    )}
                    <Button size="sm" variant="ghost" onClick={() => { setEditing(true); setEditText(comment.comment); }}>
                        ✏️ Edit
                    </Button>
                    <Button size="sm" variant="danger" onClick={() => { onDelete(comment.id); onClose(); }}>
                        🗑️ Delete
                    </Button>
                </div>
            )}
        </div>,
        document.body,
    );
}
