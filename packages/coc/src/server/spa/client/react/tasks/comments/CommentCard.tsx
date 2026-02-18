/**
 * CommentCard — renders a single comment with quote, body, badges, replies, actions.
 */

import { useState } from 'react';
import { cn, Badge, Button } from '../../shared';
import { CommentReply } from './CommentReply';
import type { TaskComment, TaskCommentCategory } from '../../../task-comments-types';
import { CATEGORY_INFO, getCommentCategory } from '../../../task-comments-types';

function formatRelative(dateStr: string | null | undefined): string {
    if (!dateStr) return '';
    const d = new Date(dateStr);
    const diff = Date.now() - d.getTime();
    if (diff < 60000) return 'just now';
    const mins = Math.floor(diff / 60000);
    if (mins < 60) return mins + 'm ago';
    const hours = Math.floor(mins / 60);
    if (hours < 24) return hours + 'h ago';
    const days = Math.floor(hours / 24);
    if (days === 1) return 'yesterday';
    if (days < 7) return days + 'd ago';
    return d.toLocaleDateString();
}

export interface CommentCardProps {
    comment: TaskComment;
    onResolve: () => void;
    onUnresolve: () => void;
    onEdit: (text: string) => void;
    onDelete: () => void;
    onAskAI: () => void;
    onClick: () => void;
}

export function CommentCard({
    comment,
    onResolve,
    onUnresolve,
    onEdit,
    onDelete,
    onAskAI,
    onClick,
}: CommentCardProps) {
    const [editing, setEditing] = useState(false);
    const [editText, setEditText] = useState(comment.comment);
    const [confirmDelete, setConfirmDelete] = useState(false);
    const [showAllReplies, setShowAllReplies] = useState(false);

    const category: TaskCommentCategory = getCommentCategory(comment);
    const info = CATEGORY_INFO[category];
    const isResolved = comment.status === 'resolved';
    const replies = comment.replies || [];
    const visibleReplies = showAllReplies || replies.length <= 2 ? replies : replies.slice(-2);

    const handleSave = () => {
        const trimmed = editText.trim();
        if (trimmed && trimmed !== comment.comment) {
            onEdit(trimmed);
        }
        setEditing(false);
    };

    return (
        <div
            className={cn(
                'flex flex-col gap-2 p-3 rounded-md border border-[#e0e0e0] dark:border-[#3c3c3c] bg-white dark:bg-[#1e1e1e] text-xs cursor-pointer transition-colors',
                'hover:border-[#0078d4]/40 dark:hover:border-[#3794ff]/40',
                isResolved && 'opacity-70',
            )}
            onClick={onClick}
            data-testid={`comment-card-${comment.id}`}
            role="article"
            aria-label={`Comment by ${comment.author || 'Anonymous'}`}
        >
            {/* Selected text blockquote */}
            {comment.selectedText && (
                <blockquote className="border-l-2 border-[#0078d4] dark:border-[#3794ff] pl-2 text-[11px] text-[#848484] italic truncate max-w-full">
                    {comment.selectedText.length > 120
                        ? comment.selectedText.substring(0, 120) + '…'
                        : comment.selectedText}
                </blockquote>
            )}

            {/* Comment body */}
            {editing ? (
                <div className="flex flex-col gap-1" onClick={e => e.stopPropagation()}>
                    <textarea
                        className="w-full p-1.5 text-xs rounded border border-[#e0e0e0] dark:border-[#3c3c3c] bg-white dark:bg-[#252526] text-[#1e1e1e] dark:text-[#cccccc] resize-y min-h-[60px]"
                        value={editText}
                        onChange={e => setEditText(e.target.value)}
                        rows={3}
                        data-testid="comment-edit-textarea"
                    />
                    <div className="flex gap-1 justify-end">
                        <Button size="sm" variant="secondary" onClick={() => setEditing(false)}>Cancel</Button>
                        <Button size="sm" onClick={handleSave}>Save</Button>
                    </div>
                </div>
            ) : (
                <div className="text-[#1e1e1e] dark:text-[#cccccc]">{comment.comment}</div>
            )}

            {/* Badges row */}
            <div className="flex items-center gap-1.5 flex-wrap">
                <Badge status={isResolved ? 'completed' : 'running'}>
                    {isResolved ? '✅ Resolved' : '🟢 Open'}
                </Badge>
                <Badge status="queued">
                    {info.icon} {info.label}
                </Badge>
            </div>

            {/* Author + timestamp */}
            <div className="flex items-center gap-2 text-[10px] text-[#848484]">
                <span>{comment.author || 'Anonymous'}</span>
                <span>{formatRelative(comment.createdAt)}</span>
            </div>

            {/* AI response */}
            {comment.aiResponse && (
                <div className="mt-1 p-2 rounded bg-[#0078d4]/5 dark:bg-[#3794ff]/5 border-l-2 border-[#0078d4] dark:border-[#3794ff]" data-testid="ai-response">
                    <div className="text-[10px] text-[#0078d4] dark:text-[#3794ff] font-medium mb-1">🤖 AI Response</div>
                    <div className="text-[#1e1e1e] dark:text-[#cccccc]">{comment.aiResponse}</div>
                </div>
            )}

            {/* Replies */}
            {replies.length > 0 && (
                <div className="flex flex-col gap-1 mt-1">
                    {replies.length > 2 && !showAllReplies && (
                        <button
                            className="text-[10px] text-[#0078d4] dark:text-[#3794ff] text-left hover:underline"
                            onClick={e => { e.stopPropagation(); setShowAllReplies(true); }}
                            data-testid="show-all-replies"
                        >
                            Show all {replies.length} replies
                        </button>
                    )}
                    {visibleReplies.map(r => (
                        <CommentReply key={r.id} reply={r} />
                    ))}
                </div>
            )}

            {/* Action row */}
            <div className="flex gap-1 flex-wrap pt-1 border-t border-[#e0e0e0] dark:border-[#3c3c3c]" onClick={e => e.stopPropagation()}>
                {isResolved ? (
                    <Button size="sm" variant="ghost" onClick={onUnresolve}>🔓 Reopen</Button>
                ) : (
                    <Button size="sm" variant="ghost" onClick={onResolve}>✅ Resolve</Button>
                )}
                <Button size="sm" variant="ghost" onClick={() => { setEditing(true); setEditText(comment.comment); }}>
                    ✏️ Edit
                </Button>
                {confirmDelete ? (
                    <>
                        <Button size="sm" variant="danger" onClick={onDelete}>Confirm</Button>
                        <Button size="sm" variant="secondary" onClick={() => setConfirmDelete(false)}>Cancel</Button>
                    </>
                ) : (
                    <Button size="sm" variant="ghost" onClick={() => setConfirmDelete(true)}>🗑️ Delete</Button>
                )}
                <Button size="sm" variant="ghost" onClick={onAskAI}>🤖 Ask AI</Button>
            </div>
        </div>
    );
}
