import { Spinner } from '../../../shared/Spinner';
import { CommentThreadCard } from './CommentThreadCard';
import type { UseCommentsReturn, CommentFilter } from './useComments';
import './commentsPanel.css';

export interface CommentsSidebarProps {
    workspaceId: string;
    notePath: string | null;
    selectedThreadId: string | null;
    onThreadSelect: (threadId: string | null) => void;
    comments: UseCommentsReturn;
}

const FILTER_TABS: Array<{ name: CommentFilter; label: string }> = [
    { name: 'all', label: 'All' },
    { name: 'open', label: 'Open' },
    { name: 'resolved', label: 'Resolved' },
];

function getCountForFilter(comments: UseCommentsReturn, name: CommentFilter): number {
    switch (name) {
        case 'all': return comments.totalCount;
        case 'open': return comments.openCount;
        case 'resolved': return comments.resolvedCount;
    }
}

export function CommentsSidebar({ comments, selectedThreadId }: CommentsSidebarProps) {
    return (
        <div className="flex flex-col h-full" data-testid="comments-sidebar">
            {/* Header */}
            <div
                data-testid="comments-header"
                className="flex items-center justify-between px-3 py-2 border-b border-[#e0e0e0] dark:border-[#3c3c3c]"
            >
                <div className="flex items-center">
                    <span className="text-xs font-semibold text-[#1e1e1e] dark:text-[#cccccc]">
                        💬 Comments
                    </span>
                    <span
                        data-testid="comments-count-badge"
                        className="inline-flex ml-1.5 px-1.5 py-0.5 rounded-full text-[10px] bg-[#0078d4]/10 text-[#0078d4]"
                    >
                        {comments.totalCount}
                    </span>
                </div>
            </div>

            {/* Filter tabs */}
            <div
                data-testid="comments-filter"
                className="flex items-center gap-1 px-3 py-1.5 border-b border-[#e0e0e0] dark:border-[#3c3c3c]"
            >
                {FILTER_TABS.map(tab => (
                    <button
                        key={tab.name}
                        data-testid={`filter-${tab.name}`}
                        className={
                            comments.filter === tab.name
                                ? 'text-[10px] px-2 py-0.5 rounded-full transition-colors bg-[#0078d4] text-white'
                                : 'text-[10px] px-2 py-0.5 rounded-full transition-colors text-[#616161] dark:text-[#999] hover:bg-black/[0.04] dark:hover:bg-white/[0.04]'
                        }
                        onMouseDown={e => {
                            e.preventDefault();
                            comments.setFilter(tab.name);
                        }}
                    >
                        {tab.label} ({getCountForFilter(comments, tab.name)})
                    </button>
                ))}
            </div>

            {/* Content area */}
            {comments.loading && (
                <div className="flex items-center justify-center py-8" data-testid="comments-loading">
                    <Spinner size="sm" />
                    <span className="ml-2 text-xs text-[#848484] dark:text-[#666]">Loading comments…</span>
                </div>
            )}

            {comments.error && !comments.loading && (
                <div className="px-3 py-2" data-testid="comments-error">
                    <span className="text-xs text-red-500 dark:text-red-400">{comments.error}</span>
                    <button
                        className="ml-2 text-xs text-[#0078d4] underline"
                        onMouseDown={e => {
                            e.preventDefault();
                            comments.reload();
                        }}
                    >
                        Retry
                    </button>
                </div>
            )}

            {!comments.loading && !comments.error && comments.threads.length === 0 && (
                <div
                    className="flex flex-col items-center justify-center py-8 gap-2 text-xs text-[#848484] dark:text-[#666] italic select-none"
                    data-testid="comments-empty"
                >
                    <span className="text-2xl">💬</span>
                    <span className="text-center">{'No comments yet.\nSelect text and click 💬 to add a comment.'}</span>
                </div>
            )}

            {!comments.loading && !comments.error && comments.threads.length > 0 && (
                <div
                    className="flex-1 overflow-y-auto py-1 px-2 flex flex-col gap-2"
                    data-testid="comments-thread-list"
                >
                    {comments.threads.map(thread => (
                        <CommentThreadCard
                            key={thread.id}
                            thread={thread}
                            isSelected={thread.id === selectedThreadId}
                            onSelect={() => comments.selectThread(thread.id)}
                            onResolve={() => comments.resolveThread(thread.id)}
                            onReopen={() => comments.reopenThread(thread.id)}
                            onDelete={() => comments.deleteThread(thread.id)}
                            onAddComment={(c) => comments.addComment(thread.id, c)}
                            onEditComment={(cid, c) => comments.editComment(thread.id, cid, c)}
                            onDeleteComment={(cid) => comments.deleteComment(thread.id, cid)}
                        />
                    ))}
                </div>
            )}
        </div>
    );
}
