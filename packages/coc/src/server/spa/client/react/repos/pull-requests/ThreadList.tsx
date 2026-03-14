import { useState } from 'react';
import { formatRelativeTime } from './pr-utils';
import type { CommentThread } from './pr-utils';

interface ThreadListProps {
    threads: CommentThread[];
}

export function ThreadList({ threads }: ThreadListProps) {
    const [expanded, setExpanded] = useState<Set<string | number>>(new Set());

    if (threads.length === 0) {
        return (
            <div className="px-4 py-6 text-center text-sm text-gray-500" data-testid="threads-empty">
                No comment threads.
            </div>
        );
    }

    function toggle(id: string | number) {
        setExpanded(prev => {
            const next = new Set(prev);
            if (next.has(id)) {
                next.delete(id);
            } else {
                next.add(id);
            }
            return next;
        });
    }

    return (
        <div className="flex flex-col gap-2 px-4 py-2" data-testid="thread-list">
            {threads.map(thread => {
                const first = thread.comments[0];
                if (!first) return null;
                const isMulti = thread.comments.length > 1;
                const isExpanded = expanded.has(thread.id);
                const preview = first.content.slice(0, 80) + (first.content.length > 80 ? '…' : '');

                return (
                    <div
                        key={thread.id}
                        className="border border-gray-200 dark:border-gray-700 rounded overflow-hidden"
                        data-testid="comment-thread"
                    >
                        {thread.threadContext?.filePath && (
                            <div className="px-3 pt-2 pb-0">
                                <span className="text-xs font-mono text-blue-600 dark:text-blue-400">
                                    {thread.threadContext.filePath}
                                </span>
                            </div>
                        )}
                        <button
                            className="w-full text-left flex items-start gap-2 px-3 py-2 hover:bg-gray-50 dark:hover:bg-gray-800"
                            onClick={() => isMulti && toggle(thread.id)}
                            data-testid="thread-header"
                        >
                            {isMulti && (
                                <span className="text-xs text-gray-400 shrink-0 mt-0.5">
                                    {isExpanded ? '▼' : '▶'}
                                </span>
                            )}
                            <div className="flex-1 min-w-0">
                                <span className="text-xs font-medium text-gray-700 dark:text-gray-300 mr-1">
                                    @{first.author?.displayName ?? first.author?.email ?? 'Unknown'}
                                </span>
                                <span className="text-xs text-gray-500">— &ldquo;{preview}&rdquo;</span>
                            </div>
                            <span className="text-xs text-gray-400 shrink-0">
                                {formatRelativeTime(first.publishedDate ?? first.createdDate)}
                            </span>
                        </button>
                        {(isExpanded || !isMulti) && (
                            <div className="border-t border-gray-100 dark:border-gray-700" data-testid="thread-body">
                                {thread.comments.map((comment, idx) => (
                                    <div
                                        key={comment.id}
                                        className={`flex gap-3 px-3 py-2 ${idx > 0 ? 'border-t border-gray-100 dark:border-gray-700' : ''}`}
                                        data-testid="thread-comment"
                                    >
                                        <div className="w-6 h-6 rounded-full bg-gray-200 dark:bg-gray-700 flex items-center justify-center shrink-0 text-xs font-medium">
                                            {(comment.author?.displayName ?? comment.author?.email ?? '?').charAt(0).toUpperCase()}
                                        </div>
                                        <div className="flex-1 min-w-0">
                                            <div className="flex items-center gap-2">
                                                <span className="text-xs font-medium text-gray-700 dark:text-gray-300">
                                                    @{comment.author?.displayName ?? comment.author?.email ?? 'Unknown'}
                                                </span>
                                                <span className="text-xs text-gray-400">
                                                    {formatRelativeTime(comment.publishedDate ?? comment.createdDate)}
                                                </span>
                                            </div>
                                            <p className="text-sm text-gray-600 dark:text-gray-400 mt-0.5 whitespace-pre-wrap">
                                                {comment.content}
                                            </p>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                );
            })}
        </div>
    );
}
