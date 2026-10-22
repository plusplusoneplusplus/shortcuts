/**
 * CommentSidebar — right-panel listing all comments with status/category filters.
 */

import { useState, useMemo, useEffect } from 'react';
import { cn } from '../../ui';
import { CommentCard } from './CommentCard';
import type { AnyComment } from '../../../comments/shared-comment-types';
import type { DiffComment } from '../../../comments/diff-comment-types';
import { diffCommentLocation, groupDiffCommentsByFile } from '../../utils/diffCommentPrompt';

type StatusFilter = 'all' | 'open' | 'resolved';
type CategoryFilter = string;

export interface CommentSidebarProps {
    taskId?: string;
    filePath?: string;
    comments: AnyComment[];
    filteredComments?: AnyComment[];
    loading: boolean;
    className?: string;
    compact?: boolean;
    /** When true, fills the full available width (used for mobile drawer). */
    fullWidth?: boolean;
    showHeader?: boolean;
    showFilters?: boolean;
    showFilePath?: boolean;
    /**
     * Groups diff comments under per-file headers (full repo-relative path and
     * count) and labels each card with its line location. Used by aggregated
     * commit, branch-range and working-tree comment views.
     */
    groupByFile?: boolean;
    /** Load failure shown in place of the list. */
    error?: string | null;
    onResolve: (id: string) => void;
    onUnresolve: (id: string) => void;
    onDelete: (id: string) => void;
    onEdit: (id: string, text: string) => void;
    onAskAI: (id: string, commandId: string, customQuestion?: string) => void;
    onCommentClick: (comment: AnyComment) => void;
    aiLoadingIds?: Set<string>;
    aiErrors?: Map<string, string>;
    onClearAiError?: (id: string) => void;
    onFixWithAI?: (id: string) => void;
    resolvingIds?: Set<string>;
    deletingIds?: Set<string>;
    onResolveAllWithAI?: () => void;
    /** Copies all comments as one prompt; a returned rejection shows copy failure. */
    onCopyPrompt?: () => void | Promise<unknown>;
    /** When provided, renders a ✕ close button in the sidebar header. */
    onClose?: () => void;
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
    showFilePath = false,
    groupByFile = false,
    error = null,
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
    resolvingIds,
    deletingIds,
    onResolveAllWithAI,
    onCopyPrompt,
    onClose,
}: CommentSidebarProps) {
    const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
    const [categoryFilter, setCategoryFilter] = useState<CategoryFilter>('all');
    const [copyState, setCopyState] = useState<'idle' | 'copied' | 'failed'>('idle');

    const openCount = useMemo(
        () => comments.filter(c => c.status === 'open').length,
        [comments],
    );

    const categories = useMemo(() => {
        const cats = new Set<string>();
        for (const c of comments) {
            if (c.category) cats.add(c.category);
        }
        return Array.from(cats).sort();
    }, [comments]);

    useEffect(() => {
        if (copyState === 'idle') return;
        const timer = setTimeout(() => setCopyState('idle'), 2000);
        return () => clearTimeout(timer);
    }, [copyState]);

    const handleCopy = () => {
        if (!onCopyPrompt) return;
        let result: void | Promise<unknown>;
        try {
            result = onCopyPrompt();
        } catch {
            setCopyState('failed');
            return;
        }
        if (result && typeof (result as Promise<unknown>).then === 'function') {
            (result as Promise<unknown>).then(() => setCopyState('copied'), () => setCopyState('failed'));
        } else {
            setCopyState('copied');
        }
    };

    const filtered = (filteredComments ?? comments.filter(c => {
        if (statusFilter !== 'all' && c.status !== statusFilter) return false;
        if (categoryFilter !== 'all' && c.category !== categoryFilter) return false;
        return true;
    }));

    const groups = groupByFile ? groupDiffCommentsByFile(filtered as DiffComment[]) : null;
    const fileCount = groupByFile ? new Set(comments.map(c => (c as DiffComment).context?.filePath)).size : 0;

    const renderCard = (comment: AnyComment) => (
        <div key={comment.id} className={cn(comment.status === 'orphaned' && 'opacity-50 italic')}>
            {comment.status === 'orphaned' && (
                <span
                    className="flex items-center gap-1 text-[11px] text-amber-600 dark:text-amber-400 px-2 py-0.5"
                    data-testid="orphaned-badge"
                >
                    ⚠️ Location lost
                </span>
            )}
            {groupByFile && (
                <span className="block px-1 pb-0.5 text-[10px] font-mono text-[#848484]" data-testid="comment-location">
                    {diffCommentLocation(comment as DiffComment)}
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
                isResolving={resolvingIds?.has(comment.id)}
                isDeleting={deletingIds?.has(comment.id)}
                showFilePath={showFilePath && !groupByFile}
            />
        </div>
    );

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
                <div className="flex flex-wrap items-center justify-between gap-1 px-3 py-2 border-b border-[#e0e0e0] dark:border-[#3c3c3c]">
                    <span className="text-xs font-semibold text-[#1e1e1e] dark:text-[#cccccc]">
                        Comments ({comments.length}{groupByFile && comments.length > 0 ? ` · ${fileCount} file${fileCount === 1 ? '' : 's'}` : ''})
                    </span>
                    {(comments.length > 0 || onClose) && (
                        <div className="flex items-center gap-1">
                            {openCount > 0 && onCopyPrompt && (
                                <button
                                    onClick={handleCopy}
                                    title="Copy all unresolved comments as one prompt"
                                    aria-label="Copy all comments as prompt"
                                    data-testid="copy-prompt-btn"
                                    data-copy-state={copyState}
                                    className={cn(
                                        'inline-flex items-center gap-1 px-1.5 py-0.5 text-[11px] rounded transition-colors hover:bg-black/[0.06] dark:hover:bg-white/[0.08]',
                                        copyState === 'failed'
                                            ? 'text-[#d32f2f] dark:text-[#f48771]'
                                            : 'text-[#848484] hover:text-[#1e1e1e] dark:hover:text-[#cccccc]',
                                    )}
                                >
                                    {copyState === 'copied' ? '✓ Copied' : copyState === 'failed' ? 'Copy failed' : '📋 Copy as prompt'}
                                </button>
                            )}
                            {openCount > 0 && onResolveAllWithAI && (
                                <button
                                    onClick={onResolveAllWithAI}
                                    title="Resolve all open comments with AI"
                                    aria-label="Resolve all with AI"
                                    data-testid="resolve-all-ai-btn"
                                    className="inline-flex items-center gap-1 px-1.5 py-0.5 text-[11px] rounded transition-colors text-[#848484] hover:text-[#1e1e1e] dark:hover:text-[#cccccc] hover:bg-black/[0.06] dark:hover:bg-white/[0.08]"
                                >
                                    🤖 Resolve All
                                </button>
                            )}
                            {onClose && (
                                <button
                                    onClick={onClose}
                                    title="Close comments"
                                    aria-label="Close comments"
                                    data-testid="close-sidebar-btn"
                                    className="inline-flex items-center justify-center w-6 h-6 rounded transition-colors text-[#848484] hover:text-[#1e1e1e] dark:hover:text-[#cccccc] hover:bg-black/[0.06] dark:hover:bg-white/[0.08] text-xs"
                                >
                                    ✕
                                </button>
                            )}
                        </div>
                    )}
                </div>
            )}

            {showFilters && (
                <div className="flex flex-col border-b border-[#e0e0e0] dark:border-[#3c3c3c]">
                    <div className="flex gap-1 px-2 py-1.5">
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
                    {categories.length > 0 && (
                        <div className="flex gap-1 px-2 pb-1.5 flex-wrap">
                            <button
                                onClick={() => setCategoryFilter('all')}
                                className={cn(
                                    'px-2 py-0.5 text-[11px] rounded transition-colors',
                                    categoryFilter === 'all'
                                        ? 'bg-[#0078d4] text-white'
                                        : 'text-[#848484] hover:bg-black/[0.04] dark:hover:bg-white/[0.04]',
                                )}
                                data-testid="category-filter-all"
                            >
                                All
                            </button>
                            {categories.map(cat => (
                                <button
                                    key={cat}
                                    onClick={() => setCategoryFilter(cat)}
                                    className={cn(
                                        'px-2 py-0.5 text-[11px] rounded transition-colors capitalize',
                                        categoryFilter === cat
                                            ? 'bg-[#0078d4] text-white'
                                            : 'text-[#848484] hover:bg-black/[0.04] dark:hover:bg-white/[0.04]',
                                    )}
                                    data-testid={`category-filter-${cat}`}
                                >
                                    {cat}
                                </button>
                            ))}
                        </div>
                    )}
                </div>
            )}

            {/* Comment list */}
            <div
                className={cn(
                    'flex-1 overflow-y-auto p-2 flex flex-col gap-2',
                    compact && 'p-1.5 gap-1.5',
                )}
                role={groups ? undefined : 'list'}
                data-testid="comment-list"
            >
                {loading && (
                    <div className="text-center text-xs text-[#848484] py-4">Loading comments…</div>
                )}
                {!loading && error && (
                    <div role="alert" className="text-center text-xs text-[#d32f2f] dark:text-[#f48771] py-4" data-testid="comments-error">
                        {error}
                    </div>
                )}
                {!loading && !error && filtered.length === 0 && (
                    <div className="text-center text-xs text-[#848484] py-4" data-testid="empty-comments">
                        {groupByFile && comments.length === 0
                            ? 'No comments yet. Comments you add in any file of this review appear here.'
                            : 'No comments match the current filter.'}
                    </div>
                )}
                {!loading && !error && groups && groups.map(([filePath, list]) => (
                    <div key={filePath} className="flex flex-col gap-1.5" role="group" aria-label={`${filePath}, ${list.length} comment(s)`} data-testid="comment-file-group">
                        <div className="flex items-center gap-1 px-1 text-[11px] font-mono text-[#616161] dark:text-[#999]" title={filePath}>
                            <span className="truncate" dir="rtl"><bdi>{filePath}</bdi></span>
                            <span className="ml-auto shrink-0 text-[10px] text-[#848484]">{list.length}</span>
                        </div>
                        {list.map(renderCard)}
                    </div>
                ))}
                {!groups && filtered.map(renderCard)}
            </div>
        </div>
    );
}
