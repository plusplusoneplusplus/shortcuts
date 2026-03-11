/**
 * TaskSearchResults — flat scrollable list of search-matched task items.
 * Replaces the Miller columns when the search query is non-empty.
 */

import type { ReactNode } from 'react';
import { cn } from '../shared';
import { isTaskDocument, isTaskDocumentGroup } from '../hooks/useTaskTree';
import type { TaskDocument, TaskDocumentGroup } from '../hooks/useTaskTree';

export function highlightMatch(text: string, query: string): ReactNode {
    if (!query) return text;
    const idx = text.toLowerCase().indexOf(query.toLowerCase());
    if (idx === -1) return text;
    return (
        <>
            {text.slice(0, idx)}
            <strong className="text-[#0078d4] dark:text-[#3794ff]">
                {text.slice(idx, idx + query.length)}
            </strong>
            {text.slice(idx + query.length)}
        </>
    );
}

export interface TaskSearchResultsProps {
    results: (TaskDocument | TaskDocumentGroup)[];
    query: string;
    commentCounts: Record<string, number>;
    wsId: string;
    onFileClick: (path: string) => void;
    onContextMenu?: (item: TaskDocument | TaskDocumentGroup, x: number, y: number) => void;
}

function getStatusIcon(status?: string): string {
    switch (status) {
        case 'done': return '✅';
        case 'in-progress': return '🔄';
        case 'pending': return '⏳';
        case 'future': return '📋';
        default: return '';
    }
}

function getItemPath(item: TaskDocument | TaskDocumentGroup): string | null {
    if (isTaskDocument(item)) {
        const rel = (item.relativePath || '').replace(/\\/g, '/');
        return rel ? rel + '/' + item.fileName : item.fileName;
    }
    if (isTaskDocumentGroup(item)) {
        const firstDoc = item.documents[0];
        if (firstDoc) {
            const rel = (firstDoc.relativePath || '').replace(/\\/g, '/');
            return rel ? rel + '/' + firstDoc.fileName : firstDoc.fileName;
        }
    }
    return null;
}

export function TaskSearchResults({ results, query, commentCounts, onFileClick, onContextMenu }: TaskSearchResultsProps) {
    if (results.length === 0) {
        return (
            <div className="px-4 py-8 text-center text-xs text-[#848484]" data-testid="search-empty-state">
                No tasks match &lsquo;{query}&rsquo;
            </div>
        );
    }

    return (
        <div className="flex-1 overflow-y-auto" data-testid="search-results-list">
            <ul>
                {results.map((item) => {
                    const isDoc = isTaskDocument(item);
                    const isGroup = isTaskDocumentGroup(item);
                    const displayName = isDoc
                        ? (item as TaskDocument).baseName || (item as TaskDocument).fileName
                        : (item as TaskDocumentGroup).baseName;
                    const status = isDoc ? (item as TaskDocument).status : undefined;
                    const statusIcon = getStatusIcon(status);
                    const itemPath = getItemPath(item);
                    const relativePath = isDoc
                        ? (item as TaskDocument).relativePath
                        : (item as TaskDocumentGroup).documents[0]?.relativePath;
                    const commentKey = itemPath || '';
                    const commentCount = commentCounts[commentKey] ?? 0;

                    return (
                        <li
                            key={itemPath ?? displayName}
                            className={cn(
                                'flex items-center gap-2 px-2 py-1.5 cursor-pointer text-xs transition-colors',
                                'hover:bg-black/[0.04] dark:hover:bg-white/[0.04]',
                                item.isArchived && 'opacity-60 italic',
                                status === 'future' && 'opacity-60 italic',
                            )}
                            onClick={() => itemPath && onFileClick(itemPath)}
                            onContextMenu={(e) => {
                                if (onContextMenu) {
                                    if (e.shiftKey) return;
                                    e.preventDefault();
                                    onContextMenu(item, e.clientX, e.clientY);
                                }
                            }}
                            title={itemPath ?? undefined}
                            data-testid={`search-result-${displayName}`}
                        >
                            {/* Icon */}
                            <span className="flex-shrink-0 text-[11px]">
                                {isGroup ? '📄' : '📝'}
                            </span>

                            {/* Status */}
                            {status && statusIcon && (
                                <span className="flex-shrink-0 text-[10px]" data-status={status}>
                                    {statusIcon}
                                </span>
                            )}

                            {/* Display name */}
                            <span className="truncate text-[#1e1e1e] dark:text-[#cccccc]">
                                {highlightMatch(displayName, query)}
                            </span>

                            {/* Breadcrumb path */}
                            {relativePath && (
                                <span className="truncate text-[10px] text-[#848484]">
                                    {highlightMatch(relativePath, query)}
                                </span>
                            )}

                            {/* Comment count badge */}
                            {commentCount > 0 && (
                                <span className="flex-shrink-0 text-[10px] bg-[#0078d4] text-white px-1 py-px rounded-full min-w-[16px] text-center">
                                    {commentCount}
                                </span>
                            )}
                        </li>
                    );
                })}
            </ul>
        </div>
    );
}
