/**
 * CommentSidebar — right-panel listing all comments with status/category filters.
 */

import { useState } from 'react';
import { cn } from '../../shared';
import { CommentCard } from './CommentCard';
import type { TaskComment, TaskCommentCategory } from '../../../task-comments-types';
import { CATEGORY_INFO, ALL_CATEGORIES, getCommentCategory } from '../../../task-comments-types';

type StatusFilter = 'all' | 'open' | 'resolved';
type CategoryFilter = 'all' | TaskCommentCategory;

export interface CommentSidebarProps {
    taskId: string;
    filePath: string;
    comments: TaskComment[];
    filteredComments?: TaskComment[];
    loading: boolean;
    className?: string;
    compact?: boolean;
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
}

export function CommentSidebar({
    comments,
    filteredComments,
    loading,
    className,
    compact = false,
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
}: CommentSidebarProps) {
    const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
    const [categoryFilter, setCategoryFilter] = useState<CategoryFilter>('all');

    const filtered = (filteredComments ?? comments.filter(c => {
        if (statusFilter !== 'all' && c.status !== statusFilter) return false;
        if (categoryFilter !== 'all' && getCommentCategory(c) !== categoryFilter) return false;
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
                'flex flex-col w-[280px] min-w-[220px] border-l border-[#e0e0e0] dark:border-[#3c3c3c] bg-[#f8f8f8] dark:bg-[#1e1e1e] overflow-hidden',
                compact && 'w-[240px] min-w-[200px]',
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

            {showFilters && (
                <div className="flex gap-1 px-2 py-1.5 flex-wrap border-b border-[#e0e0e0] dark:border-[#3c3c3c]">
                    <button
                        onClick={() => setCategoryFilter('all')}
                        className={cn(
                            'px-1.5 py-0.5 text-[10px] rounded transition-colors',
                            categoryFilter === 'all'
                                ? 'bg-[#0078d4] text-white'
                                : 'text-[#848484] hover:bg-black/[0.04] dark:hover:bg-white/[0.04]',
                        )}
                        data-testid="category-filter-all"
                    >
                        All
                    </button>
                    {ALL_CATEGORIES.map(cat => {
                        const info = CATEGORY_INFO[cat];
                        return (
                            <button
                                key={cat}
                                onClick={() => setCategoryFilter(cat)}
                                className={cn(
                                    'px-1.5 py-0.5 text-[10px] rounded transition-colors',
                                    categoryFilter === cat
                                        ? 'bg-[#0078d4] text-white'
                                        : 'text-[#848484] hover:bg-black/[0.04] dark:hover:bg-white/[0.04]',
                                )}
                                title={info.label}
                                data-testid={`category-filter-${cat}`}
                            >
                                {info.icon}
                            </button>
                        );
                    })}
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
                    <CommentCard
                        key={comment.id}
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
                    />
                ))}
            </div>
        </div>
    );
}
