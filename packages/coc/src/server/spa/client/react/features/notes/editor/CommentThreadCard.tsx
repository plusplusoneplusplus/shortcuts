import { useState } from 'react';
import { cn } from '../../../shared/cn';
import type { CommentThread } from '../notesApi';

export interface CommentThreadCardProps {
    thread: CommentThread;
    isSelected: boolean;
    onSelect: () => void;
    onResolve: () => void;
    onReopen: () => void;
    onDelete: () => void;
    onAddComment: (content: string) => void;
    onEditComment: (commentId: string, content: string) => void;
    onDeleteComment: (commentId: string) => void;
}

function formatRelativeTime(date: string | Date): string {
    const now = Date.now();
    const then = new Date(date).getTime();
    const diffMs = now - then;
    const diffMin = Math.floor(diffMs / 60_000);
    const diffHr = Math.floor(diffMs / 3_600_000);
    const diffDay = Math.floor(diffMs / 86_400_000);

    if (diffMin < 1) return 'Just now';
    if (diffMin < 60) return `${diffMin} min ago`;
    if (diffHr < 24) return `${diffHr} hr ago`;
    if (diffDay < 7) return `${diffDay} days ago`;
    return new Date(date).toLocaleDateString();
}

function truncateText(text: string, maxLen: number = 80): string {
    if (text.length <= maxLen) return text;
    return text.slice(0, maxLen) + '…';
}

const actionBtnClass = 'text-[10px] px-1.5 py-0.5 rounded hover:bg-[#e0e0e0] dark:hover:bg-[#505050] text-[#616161] dark:text-[#999]';

export function CommentThreadCard({
    thread,
    isSelected,
    onSelect,
    onResolve,
    onReopen,
    onDelete,
    onAddComment,
    onEditComment,
    onDeleteComment,
}: CommentThreadCardProps) {
    const [replyText, setReplyText] = useState('');
    const [editingCommentId, setEditingCommentId] = useState<string | null>(null);
    const [editText, setEditText] = useState('');
    const isResolved = thread.status === 'resolved';

    const handleReplyKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
        if (e.key === 'Enter' && replyText.trim()) {
            e.preventDefault();
            onAddComment(replyText.trim());
            setReplyText('');
        } else if (e.key === 'Escape') {
            (e.target as HTMLInputElement).blur();
        }
    };

    const handleReplySubmit = (e: React.MouseEvent) => {
        e.preventDefault();
        e.stopPropagation();
        if (replyText.trim()) {
            onAddComment(replyText.trim());
            setReplyText('');
        }
    };

    const handleEditKeyDown = (e: React.KeyboardEvent<HTMLInputElement>, commentId: string) => {
        if (e.key === 'Enter' && editText.trim()) {
            e.preventDefault();
            onEditComment(commentId, editText.trim());
            setEditingCommentId(null);
        } else if (e.key === 'Escape') {
            setEditingCommentId(null);
        }
    };

    const startEditing = (commentId: string, currentContent: string) => {
        setEditingCommentId(commentId);
        setEditText(currentContent);
    };

    return (
        <div
            role="article"
            data-testid={`comment-thread-${thread.id}`}
            className={cn(
                'cursor-pointer rounded border transition-colors p-2',
                isResolved && 'opacity-60',
                isSelected
                    ? 'border-l-2 border-l-[#0078d4] bg-[#0078d4]/5 dark:bg-[#3794ff]/5 border-[#e0e0e0] dark:border-[#333]'
                    : 'border-[#e0e0e0] dark:border-[#333] bg-white dark:bg-[#1e1e1e]',
            )}
            onClick={onSelect}
        >
            {/* Anchor quote */}
            <div
                data-testid={`thread-anchor-${thread.id}`}
                className={cn(
                    'text-xs italic text-[#616161] dark:text-[#999] truncate mb-1',
                    isResolved && 'line-through',
                )}
            >
                {isResolved ? '✓ ' : ''}{truncateText(thread.anchor.quotedText)}
            </div>

            {/* Comments list */}
            <div className="flex flex-col gap-1">
                {thread.comments.map(comment => (
                    <div key={comment.id} data-testid={`comment-${comment.id}`} className="text-xs text-[#1e1e1e] dark:text-[#cccccc] group">
                        {editingCommentId === comment.id ? (
                            <input
                                type="text"
                                data-testid={`edit-input-${comment.id}`}
                                value={editText}
                                onChange={e => setEditText(e.target.value)}
                                onKeyDown={e => handleEditKeyDown(e, comment.id)}
                                className="w-full text-xs px-2 py-1 rounded border border-[#e0e0e0] dark:border-[#3c3c3c] bg-white dark:bg-[#2d2d2d] text-[#1e1e1e] dark:text-[#cccccc]"
                                autoFocus
                            />
                        ) : (
                            <>
                                <div>{comment.content}</div>
                                <div className="flex items-center gap-1">
                                    <span
                                        data-testid={`comment-time-${comment.id}`}
                                        className="text-[10px] text-[#848484] dark:text-[#666]"
                                    >
                                        {formatRelativeTime(comment.createdAt)}
                                    </span>
                                    <span className="opacity-0 group-hover:opacity-100 flex items-center gap-0.5 ml-1">
                                        <button
                                            data-testid={`edit-comment-${comment.id}`}
                                            className={actionBtnClass}
                                            onMouseDown={e => {
                                                e.preventDefault();
                                                e.stopPropagation();
                                                startEditing(comment.id, comment.content);
                                            }}
                                        >
                                            ✏️
                                        </button>
                                        <button
                                            data-testid={`delete-comment-${comment.id}`}
                                            className={actionBtnClass}
                                            onMouseDown={e => {
                                                e.preventDefault();
                                                e.stopPropagation();
                                                onDeleteComment(comment.id);
                                            }}
                                        >
                                            🗑
                                        </button>
                                    </span>
                                </div>
                            </>
                        )}
                    </div>
                ))}
            </div>

            {/* Reply input */}
            <div data-testid={`reply-input-${thread.id}`} className="flex items-center gap-1 mt-1">
                <input
                    type="text"
                    placeholder="Reply..."
                    value={replyText}
                    onChange={e => setReplyText(e.target.value)}
                    onKeyDown={handleReplyKeyDown}
                    onClick={e => e.stopPropagation()}
                    className="comment-reply-input w-full text-xs px-2 py-1 rounded border border-[#e0e0e0] dark:border-[#3c3c3c] bg-white dark:bg-[#2d2d2d] text-[#1e1e1e] dark:text-[#cccccc] placeholder:text-[#848484] dark:placeholder:text-[#666]"
                />
                <button
                    data-testid={`reply-submit-${thread.id}`}
                    className={actionBtnClass}
                    onMouseDown={handleReplySubmit}
                >
                    ↵
                </button>
            </div>

            {/* Action bar */}
            <div
                data-testid={`thread-actions-${thread.id}`}
                className="flex items-center gap-1 pt-1 mt-1 border-t border-[#e0e0e0] dark:border-[#3c3c3c]"
            >
                {isResolved ? (
                    <button
                        data-testid={`reopen-thread-${thread.id}`}
                        className={actionBtnClass}
                        onMouseDown={e => { e.preventDefault(); e.stopPropagation(); onReopen(); }}
                    >
                        ↩ Reopen
                    </button>
                ) : (
                    <button
                        data-testid={`resolve-thread-${thread.id}`}
                        className={actionBtnClass}
                        onMouseDown={e => { e.preventDefault(); e.stopPropagation(); onResolve(); }}
                    >
                        ✓ Resolve
                    </button>
                )}
                <button
                    data-testid={`delete-thread-${thread.id}`}
                    className={actionBtnClass}
                    onMouseDown={e => { e.preventDefault(); e.stopPropagation(); onDelete(); }}
                >
                    🗑 Delete
                </button>
            </div>
        </div>
    );
}
