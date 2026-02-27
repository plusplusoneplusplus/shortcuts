/**
 * CommentCard — renders a single comment with quote, body, badges, replies, actions.
 *
 * Action buttons use a compact icon-only style (similar to Word/Google Docs)
 * with tooltip titles for discoverability.
 */

import { useState } from 'react';
import { cn, Button, Spinner } from '../../shared';
import { CommentReply } from './CommentReply';
import { MarkdownView } from '../../processes/MarkdownView';
import { renderMarkdownToHtml } from '../../../markdown-renderer';
import { AICommandMenu } from './AICommandMenu';
import type { TaskComment, TaskCommentCategory } from '../../../task-comments-types';
import { CATEGORY_INFO, getCommentCategory } from '../../../task-comments-types';

const ACTION_BTN = 'inline-flex items-center justify-center w-6 h-6 rounded transition-colors text-[#848484] hover:text-[#1e1e1e] dark:hover:text-[#cccccc] hover:bg-black/[0.06] dark:hover:bg-white/[0.08]';

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
    onAskAI: (commandId: string, customQuestion?: string) => void;
    onClick: () => void;
    aiLoading?: boolean;
    aiError?: string | null;
    onClearAiError?: () => void;
    onFixWithAI?: () => void;
    fixLoading?: boolean;
}

export function CommentCard({
    comment,
    onResolve,
    onUnresolve,
    onEdit,
    onDelete,
    onAskAI,
    onClick,
    aiLoading,
    aiError,
    onClearAiError,
    onFixWithAI,
    fixLoading,
}: CommentCardProps) {
    const [editing, setEditing] = useState(false);
    const [editText, setEditText] = useState(comment.comment);
    const [confirmDelete, setConfirmDelete] = useState(false);
    const [showAllReplies, setShowAllReplies] = useState(false);
    const [aiExpanded, setAiExpanded] = useState(false);

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
                'group/card flex flex-col gap-1.5 p-2.5 rounded-md border border-[#e0e0e0] dark:border-[#3c3c3c] bg-white dark:bg-[#1e1e1e] text-xs cursor-pointer transition-colors',
                'hover:border-[#0078d4]/40 dark:hover:border-[#3794ff]/40',
                isResolved && 'opacity-70',
            )}
            onClick={onClick}
            data-testid={`comment-card-${comment.id}`}
            role="article"
            aria-label={`Comment by ${comment.author || 'Anonymous'}`}
        >
            {/* Header: status dot + category + author + time + actions */}
            <div className="flex items-center gap-1.5">
                <span className={cn('w-2 h-2 rounded-full shrink-0', isResolved ? 'bg-green-500' : 'bg-[#0078d4]')}
                    title={isResolved ? 'Resolved' : 'Open'} />
                <span className="text-[10px] text-[#848484]" title={info.label}>{info.icon}</span>
                <span className="text-[10px] text-[#848484] truncate">{comment.author || 'Anonymous'}</span>
                <span className="text-[10px] text-[#a0a0a0] ml-auto shrink-0">{formatRelative(comment.createdAt)}</span>
            </div>

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
                <div className="text-[#1e1e1e] dark:text-[#cccccc] line-clamp-3">{comment.comment}</div>
            )}

            {/* AI response */}
            {comment.aiResponse && (
                <div
                    className="p-1.5 rounded bg-[#0078d4]/5 dark:bg-[#3794ff]/5 border-l-2 border-[#0078d4] dark:border-[#3794ff]"
                    data-testid="ai-response"
                    onClick={e => e.stopPropagation()}
                >
                    <div className="flex items-center justify-between mb-0.5">
                        <span className="text-[10px] text-[#0078d4] dark:text-[#3794ff] font-medium">🤖 AI</span>
                        <div className="flex gap-1">
                            <button
                                className="text-[10px] text-[#848484] hover:text-[#1e1e1e] dark:hover:text-[#cccccc]"
                                onClick={() => navigator.clipboard.writeText(comment.aiResponse!)}
                                title="Copy response"
                                aria-label="Copy AI response"
                                data-testid="ai-response-copy"
                            >⧉</button>
                            <button
                                className="text-[10px] text-[#848484] hover:text-[#1e1e1e] dark:hover:text-[#cccccc]"
                                onClick={() => setAiExpanded(prev => !prev)}
                                title={aiExpanded ? 'Collapse' : 'Expand'}
                                aria-label={aiExpanded ? 'Collapse AI response' : 'Expand AI response'}
                                data-testid="ai-response-expand"
                            >{aiExpanded ? '▲' : '▼'}</button>
                        </div>
                    </div>
                    <div className={cn(!aiExpanded && 'line-clamp-3')}>
                        <MarkdownView html={renderMarkdownToHtml(comment.aiResponse)} />
                    </div>
                </div>
            )}

            {/* Replies */}
            {replies.length > 0 && (
                <div className="flex flex-col gap-1">
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

            {/* Compact icon-only action row */}
            <div className="flex items-center gap-0.5 pt-1 border-t border-[#e0e0e0] dark:border-[#3c3c3c]" onClick={e => e.stopPropagation()}>
                {!isResolved && onFixWithAI && (
                    <button
                        className={ACTION_BTN}
                        onClick={onFixWithAI}
                        disabled={fixLoading}
                        title="Fix with AI"
                        aria-label="Fix with AI"
                        data-testid="fix-with-ai"
                    >
                        {fixLoading ? <Spinner size="xs" /> : '🔧'}
                    </button>
                )}
                <AICommandMenu
                    onCommand={(cmdId, q) => q !== undefined ? onAskAI(cmdId, q) : onAskAI(cmdId)}
                    loading={aiLoading}
                    triggerClassName={ACTION_BTN}
                />
                {isResolved ? (
                    <button className={ACTION_BTN} onClick={onUnresolve} title="Reopen" aria-label="Reopen">🔓</button>
                ) : (
                    <button className={ACTION_BTN} onClick={onResolve} disabled={fixLoading} title="Resolve" aria-label="Resolve">✅</button>
                )}
                <button className={ACTION_BTN} onClick={() => { setEditing(true); setEditText(comment.comment); }} title="Edit" aria-label="Edit">✏️</button>
                {confirmDelete ? (
                    <>
                        <Button size="sm" variant="danger" onClick={onDelete} className="!px-1.5 !py-0.5 !text-[10px]">Confirm</Button>
                        <Button size="sm" variant="secondary" onClick={() => setConfirmDelete(false)} className="!px-1.5 !py-0.5 !text-[10px]">Cancel</Button>
                    </>
                ) : (
                    <button className={ACTION_BTN} onClick={() => setConfirmDelete(true)} title="Delete" aria-label="Delete">🗑️</button>
                )}
            </div>

            {/* AI error banner */}
            {aiError && (
                <div
                    className="flex items-start gap-1.5 p-1.5 rounded bg-red-500/10 border border-red-500/20 text-[11px] text-red-600 dark:text-red-400"
                    data-testid="ai-error-banner"
                    onClick={e => e.stopPropagation()}
                >
                    <span className="flex-1">{aiError}</span>
                    {onClearAiError && (
                        <button className="shrink-0 hover:opacity-70" onClick={onClearAiError} aria-label="Dismiss error">×</button>
                    )}
                </div>
            )}
        </div>
    );
}
