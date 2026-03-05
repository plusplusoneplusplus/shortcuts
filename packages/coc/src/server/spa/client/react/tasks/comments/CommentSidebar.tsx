/**
 * CommentSidebar — right-panel listing all comments with status/category filters.
 */

import { useState, useMemo, useEffect } from 'react';
import { cn, Spinner } from '../../shared';
import { CommentCard } from './CommentCard';
import type { TaskComment } from '../../../task-comments-types';

type StatusFilter = 'all' | 'open' | 'resolved';

export interface CommentSidebarProps {
    taskId: string;
    filePath: string;
    comments: TaskComment[];
    filteredComments?: TaskComment[];
    loading: boolean;
    className?: string;
    compact?: boolean;
    /** When true, fills the full available width (used for mobile drawer). */
    fullWidth?: boolean;
    showHeader?: boolean;
    showFilters?: boolean;
    onResolve: (id: string) => void;
    onUnresolve: (id: string) => void;
    onDelete: (id: string) => void;
    onEdit: (id: string, text: string) => void;
    onAskAI: (id: string, commandId: string, customQuestion?: string) => void;
    onCommentClick: (comment: TaskComment) => void;
    aiLoadingIds?: Set<string>;
    aiErrors?: Map<string, string>;
    onClearAiError?: (id: string) => void;
    onFixWithAI?: (id: string) => void;
    resolvingCommentId?: string | null;
    onResolveAllWithAI?: () => void;
    onCopyPrompt?: () => void;
    resolving?: boolean;
}

export function CommentSidebar({
    comments,
    filteredComments,
    loading,
    className,
    compact = false,
    fullWidth = false,
    showHeader = true,
    showFilters = true,
    onResolve,
    onUnresolve,
    onDelete,
    onEdit,
    onAskAI,
    onCommentClick,
    aiLoadingIds,
    aiErrors,
    onClearAiError,
    onFixWithAI,
    resolvingCommentId,
    onResolveAllWithAI,
    onCopyPrompt,
    resolving = false,
}: CommentSidebarProps) {
    const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
    const [copied, setCopied] = useState(false);

    const openCount = useMemo(
        () => comments.filter(c => c.status === 'open').length,
        [comments],
    );

    useEffect(() => {
        if (!copied) return;
        const timer = setTimeout(() => setCopied(false), 2000);
        return () => clearTimeout(timer);
    }, [copied]);

    const filtered = (filteredComments ?? comments.filter(c => {
        if (statusFilter !== 'all' && c.status !== statusFilter) return false;
        return true;
    }));

    const statusTabs: { key: StatusFilter; label: string }[] = [
        { key: 'all', label: 'All' },
        { key: 'open', label: 'Open' },
        { key: 'resolved', label: 'Resolved' },
    ];

    return (
        <div
            className={cn(
                'flex flex-col border-l border-[#e0e0e0] dark:border-[#3c3c3c] bg-[#f8f8f8] dark:bg-[#1e1e1e] overflow-hidden',
                !fullWidth && 'w-[280px] min-w-[220px]',
                !fullWidth && compact && 'w-[240px] min-w-[200px]',
                fullWidth && 'w-full min-w-0',
                className,
            )}
            data-testid="comment-sidebar"
            role="complementary"
            aria-label="Comments"
        >
            {showHeader && (
                <div className="flex items-center justify-between px-3 py-2 border-b border-[#e0e0e0] dark:border-[#3c3c3c]">
                    <span className="text-xs font-semibold text-[#1e1e1e] dark:text-[#cccccc]">
                        Comments ({comments.length})
                    </span>
                    {openCount > 0 && (
                        <div className="flex items-center gap-1">
                            {onCopyPrompt && (
                                <button
                                    onClick={() => {
                                        onCopyPrompt();
                                        setCopied(true);
                                    }}
                                    title="Copy resolve prompt"
                                    aria-label="Copy resolve prompt"
                                    data-testid="copy-prompt-btn"
                                    className="inline-flex items-center justify-center w-6 h-6 rounded transition-colors text-[#848484] hover:text-[#1e1e1e] dark:hover:text-[#cccccc] hover:bg-black/[0.06] dark:hover:bg-white/[0.08]"
                                >
                                    {copied ? '✓' : '📋'}
                                </button>
                            )}
                            {onResolveAllWithAI && (
                                <button
                                    onClick={onResolveAllWithAI}
                                    disabled={resolving}
                                    title="Resolve all open comments with AI"
                                    aria-label="Resolve all with AI"
                                    data-testid="resolve-all-ai-btn"
                                    className={cn(
                                        'inline-flex items-center gap-1 px-1.5 py-0.5 text-[11px] rounded transition-colors',
                                        resolving
                                            ? 'opacity-50 cursor-not-allowed text-[#848484]'
                                            : 'text-[#848484] hover:text-[#1e1e1e] dark:hover:text-[#cccccc] hover:bg-black/[0.06] dark:hover:bg-white/[0.08]',
                                    )}
                                >
                                    {resolving ? <Spinner size="sm" /> : '🤖'} Resolve All
                                </button>
                            )}
                        </div>
                    )}
                </div>
            )}

            {showFilters && (
                <div className="flex gap-1 px-2 py-1.5 border-b border-[#e0e0e0] dark:border-[#3c3c3c]">
                    {statusTabs.map(tab => (
                        <button
                            key={tab.key}
                            onClick={() => setStatusFilter(tab.key)}
                            className={cn(
                                'px-2 py-0.5 text-[11px] rounded transition-colors',
                                statusFilter === tab.key
                                    ? 'bg-[#0078d4] text-white'
                                    : 'text-[#848484] hover:bg-black/[0.04] dark:hover:bg-white/[0.04]',
                            )}
                            data-testid={`status-filter-${tab.key}`}
                        >
                            {tab.label}
                        </button>
                    ))}
                </div>
            )}

            {/* Comment list */}
            <div
                className={cn(
                    'flex-1 overflow-y-auto p-2 flex flex-col gap-2',
                    compact && 'p-1.5 gap-1.5',
                )}
                role="list"
                data-testid="comment-list"
            >
                {loading && (
                    <div className="text-center text-xs text-[#848484] py-4">Loading comments…</div>
                )}
                {!loading && filtered.length === 0 && (
                    <div className="text-center text-xs text-[#848484] py-4" data-testid="empty-comments">
                        No comments match the current filter.
                    </div>
                )}
                {filtered.map(comment => (
                    <div key={comment.id} className={cn((comment as any).status === 'orphaned' && 'opacity-50 italic')}>
                        {(comment as any).status === 'orphaned' && (
                            <span
                                className="flex items-center gap-1 text-[11px] text-amber-600 dark:text-amber-400 px-2 py-0.5"
                                data-testid="orphaned-badge"
                            >
                                ⚠️ Location lost
                            </span>
                        )}
                        <CommentCard
                        comment={comment}
                        onResolve={() => onResolve(comment.id)}
                        onUnresolve={() => onUnresolve(comment.id)}
                        onEdit={(text) => onEdit(comment.id, text)}
                        onDelete={() => onDelete(comment.id)}
                        onAskAI={(commandId, question) => onAskAI(comment.id, commandId, question)}
                        onClick={() => onCommentClick(comment)}
                        aiLoading={aiLoadingIds?.has(comment.id)}
                        aiError={aiErrors?.get(comment.id) ?? null}
                        onClearAiError={onClearAiError ? () => onClearAiError(comment.id) : undefined}
                        onFixWithAI={onFixWithAI ? () => onFixWithAI(comment.id) : undefined}
                        fixLoading={resolvingCommentId === comment.id}
                        disabled={resolving}
                    />
                    </div>
                ))}
            </div>
        </div>
    );
}
