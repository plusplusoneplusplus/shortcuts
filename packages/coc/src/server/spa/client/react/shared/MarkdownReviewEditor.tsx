/**
 * MarkdownReviewEditor — shared markdown review surface with inline comments.
 *
 * Used by the Tasks tab preview and process-conversation markdown dialog
 * so both surfaces share the same commenting and rendering behavior.
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import { fetchApi } from '../hooks/useApi';
import { useMarkdownPreview } from '../hooks/useMarkdownPreview';
import { useTaskComments } from '../hooks/useTaskComments';
import { Spinner } from './Spinner';
import { cn } from './cn';
import { CommentSidebar } from '../tasks/comments/CommentSidebar';
import { SelectionToolbar } from '../tasks/comments/SelectionToolbar';
import { InlineCommentPopup } from '../tasks/comments/InlineCommentPopup';
import { CommentHighlight } from '../tasks/comments/CommentHighlight';
import type { TaskComment, TaskCommentCategory, CommentSelection } from '../../task-comments-types';
import { CATEGORY_INFO, ALL_CATEGORIES, getCommentCategory } from '../../task-comments-types';
import {
    createAnchorData,
    DEFAULT_ANCHOR_MATCH_CONFIG,
} from '@plusplusoneplusplus/pipeline-core/editor/anchor';

export interface MarkdownReviewEditorProps {
    wsId: string;
    filePath: string;
    fetchMode?: 'tasks' | 'auto';
}

/** Minimum selection length to trigger toolbar. */
const MIN_SELECTION_LENGTH = 3;
type StatusFilter = 'all' | 'open' | 'resolved';
type CategoryFilter = 'all' | TaskCommentCategory;

const STATUS_TABS: { key: StatusFilter; label: string }[] = [
    { key: 'all', label: 'All' },
    { key: 'open', label: 'Open' },
    { key: 'resolved', label: 'Resolved' },
];

async function fetchTaskContent(wsId: string, filePath: string): Promise<string> {
    const data = await fetchApi(`/workspaces/${encodeURIComponent(wsId)}/tasks/content?path=${encodeURIComponent(filePath)}`);
    if (typeof data === 'string') return data;
    if (typeof data?.content === 'string') return data.content;
    return '';
}

async function fetchWorkspaceFileContent(wsId: string, filePath: string): Promise<string> {
    const data = await fetchApi(`/workspaces/${encodeURIComponent(wsId)}/files/preview?path=${encodeURIComponent(filePath)}&lines=0`);
    if (typeof data === 'string') return data;
    if (typeof data?.content === 'string') return data.content;
    if (Array.isArray(data?.lines)) return data.lines.join('\n');
    return '';
}

export function MarkdownReviewEditor({
    wsId,
    filePath,
    fetchMode = 'tasks',
}: MarkdownReviewEditorProps) {
    const [rawContent, setRawContent] = useState('');
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const previewRef = useRef<HTMLDivElement>(null);

    // Selection & popup state
    const [toolbarVisible, setToolbarVisible] = useState(false);
    const [toolbarPos, setToolbarPos] = useState({ top: 0, left: 0 });
    const [popupVisible, setPopupVisible] = useState(false);
    const [popupPos, setPopupPos] = useState({ top: 0, left: 0 });
    const [pendingSelection, setPendingSelection] = useState<{
        text: string;
        startLine: number;
        startColumn: number;
        endLine: number;
        endColumn: number;
    } | null>(null);
    const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
    const [categoryFilter, setCategoryFilter] = useState<CategoryFilter>('all');

    // Comments hook
    const {
        comments,
        loading: commentsLoading,
        addComment,
        updateComment,
        deleteComment,
        resolveComment,
        unresolveComment,
        askAI,
    } = useTaskComments(wsId, filePath);

    // Shared markdown rendering (render + hljs + mermaid)
    const { html } = useMarkdownPreview({
        content: rawContent,
        containerRef: previewRef,
        loading,
        stripFrontmatter: true,
    });

    const filteredComments = comments.filter((comment) => {
        if (statusFilter !== 'all' && comment.status !== statusFilter) return false;
        if (categoryFilter !== 'all' && getCommentCategory(comment) !== categoryFilter) return false;
        return true;
    });
    const showCommentListPanel = comments.length > 0;

    useEffect(() => {
        let cancelled = false;
        setLoading(true);
        setError(null);
        setRawContent('');

        const load = async () => {
            try {
                let content = '';
                if (fetchMode === 'tasks') {
                    content = await fetchTaskContent(wsId, filePath);
                } else {
                    try {
                        content = await fetchTaskContent(wsId, filePath);
                    } catch {
                        content = await fetchWorkspaceFileContent(wsId, filePath);
                    }
                }

                if (cancelled) return;
                setRawContent(content);
                setLoading(false);
            } catch (err) {
                if (cancelled) return;
                setError(err instanceof Error ? err.message : 'Failed to load file');
                setLoading(false);
            }
        };

        void load();
        return () => { cancelled = true; };
    }, [wsId, filePath, fetchMode]);

    useEffect(() => {
        setStatusFilter('all');
        setCategoryFilter('all');
    }, [filePath]);

    // Selection change listener
    useEffect(() => {
        const handleSelectionChange = () => {
            const sel = window.getSelection();
            if (!sel || sel.isCollapsed || !sel.rangeCount) {
                setToolbarVisible(false);
                return;
            }
            const range = sel.getRangeAt(0);
            const text = sel.toString().trim();
            if (text.length < MIN_SELECTION_LENGTH) {
                setToolbarVisible(false);
                return;
            }
            // Ensure selection is within preview
            if (!previewRef.current || !previewRef.current.contains(range.startContainer)) {
                setToolbarVisible(false);
                return;
            }
            const rect = range.getBoundingClientRect();
            setToolbarPos({ top: rect.top - 36, left: rect.left + rect.width / 2 - 60 });
            setToolbarVisible(true);
        };

        document.addEventListener('selectionchange', handleSelectionChange);
        return () => document.removeEventListener('selectionchange', handleSelectionChange);
    }, []);

    const handleAddCommentClick = useCallback(() => {
        const sel = window.getSelection();
        if (!sel || sel.isCollapsed || !sel.rangeCount || !previewRef.current) return;

        const range = sel.getRangeAt(0);
        const text = sel.toString().trim();
        if (text.length < MIN_SELECTION_LENGTH) return;

        const rect = range.getBoundingClientRect();
        setPopupPos({ top: rect.bottom + 8, left: Math.max(8, rect.left) });

        // Compute line/column from text offsets
        const previewText = previewRef.current.textContent || '';
        const startOffset = getTextOffset(previewRef.current, range.startContainer, range.startOffset);
        const endOffset = getTextOffset(previewRef.current, range.endContainer, range.endOffset);
        const startPos = offsetToPosition(previewText, startOffset);
        const endPos = offsetToPosition(previewText, endOffset);

        setPendingSelection({
            text,
            startLine: startPos.line,
            startColumn: startPos.column,
            endLine: endPos.line,
            endColumn: endPos.column,
        });

        setToolbarVisible(false);
        setPopupVisible(true);
    }, []);

    const handlePopupSubmit = useCallback(async (text: string, category: TaskCommentCategory) => {
        if (!pendingSelection) return;

        const selection: CommentSelection = {
            startLine: pendingSelection.startLine,
            startColumn: pendingSelection.startColumn,
            endLine: pendingSelection.endLine,
            endColumn: pendingSelection.endColumn,
        };

        let anchor;
        try {
            anchor = createAnchorData(
                rawContent,
                pendingSelection.startLine,
                pendingSelection.endLine,
                pendingSelection.startColumn,
                pendingSelection.endColumn,
                DEFAULT_ANCHOR_MATCH_CONFIG
            );
        } catch {
            // Anchor creation may fail; proceed without it
        }

        await addComment({
            filePath,
            selection,
            selectedText: pendingSelection.text,
            comment: text,
            category,
            anchor,
        });

        setPopupVisible(false);
        setPendingSelection(null);
    }, [pendingSelection, rawContent, filePath, addComment]);

    const handlePopupCancel = useCallback(() => {
        setPopupVisible(false);
        setPendingSelection(null);
    }, []);

    const handleCommentClick = useCallback((comment: TaskComment) => {
        // Scroll the highlight into view
        if (previewRef.current) {
            const mark = previewRef.current.querySelector(`mark[data-comment-id="${comment.id}"]`);
            if (mark) {
                mark.scrollIntoView({ behavior: 'smooth', block: 'center' });
            }
        }
    }, []);

    if (loading) {
        return (
            <div className="flex items-center justify-center h-full">
                <Spinner size="lg" />
            </div>
        );
    }

    if (error) {
        return (
            <div className="p-4 text-sm text-[#f14c4c]">{error}</div>
        );
    }

    return (
        <div className="flex h-full flex-1 overflow-hidden min-h-0 min-w-0 p-2">
            <div className="flex h-full flex-1 overflow-hidden min-h-0 min-w-0 rounded-md border border-[#e0e0e0] dark:border-[#3c3c3c] bg-white dark:bg-[#1e1e1e]">
                <div className="flex min-h-0 min-w-0 flex-1 flex-col">
                    <div
                        className="px-3 py-2 border-b border-[#e0e0e0] dark:border-[#3c3c3c] bg-[#f8f8f8] dark:bg-[#252526]"
                        data-testid="markdown-review-status-bar"
                    >
                        <div className="flex flex-wrap items-center justify-between gap-2">
                            <span className="text-xs font-semibold text-[#1e1e1e] dark:text-[#cccccc]">
                                Comments ({comments.length})
                            </span>
                            <div className="flex flex-wrap gap-1">
                                {STATUS_TABS.map(tab => (
                                    <button
                                        key={tab.key}
                                        onClick={() => setStatusFilter(tab.key)}
                                        className={cn(
                                            'px-2 py-0.5 text-[11px] rounded transition-colors',
                                            statusFilter === tab.key
                                                ? 'bg-[#0078d4] text-white'
                                                : 'text-[#848484] hover:bg-black/[0.04] dark:hover:bg-white/[0.06]',
                                        )}
                                        data-testid={`editor-status-filter-${tab.key}`}
                                    >
                                        {tab.label}
                                    </button>
                                ))}
                            </div>
                        </div>
                        <div className="mt-1 flex flex-wrap gap-1">
                            <button
                                onClick={() => setCategoryFilter('all')}
                                className={cn(
                                    'px-1.5 py-0.5 text-[10px] rounded transition-colors',
                                    categoryFilter === 'all'
                                        ? 'bg-[#0078d4] text-white'
                                        : 'text-[#848484] hover:bg-black/[0.04] dark:hover:bg-white/[0.06]',
                                )}
                                data-testid="editor-category-filter-all"
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
                                                : 'text-[#848484] hover:bg-black/[0.04] dark:hover:bg-white/[0.06]',
                                        )}
                                        title={info.label}
                                        data-testid={`editor-category-filter-${cat}`}
                                    >
                                        {info.icon}
                                    </button>
                                );
                            })}
                        </div>
                    </div>

                    <div className="flex-1 overflow-y-auto p-4 min-h-0 min-w-0">
                        <div
                            ref={previewRef}
                            id="task-preview-body"
                            className="markdown-body text-sm text-[#1e1e1e] dark:text-[#cccccc]"
                            dangerouslySetInnerHTML={{ __html: html }}
                        />
                        <CommentHighlight
                            comments={comments}
                            containerRef={previewRef}
                            onCommentClick={handleCommentClick}
                        />
                    </div>
                </div>

                {showCommentListPanel && (
                    <CommentSidebar
                        taskId={filePath}
                        filePath={filePath}
                        comments={comments}
                        filteredComments={filteredComments}
                        loading={commentsLoading}
                        compact
                        showHeader={false}
                        showFilters={false}
                        onResolve={(id) => resolveComment(id)}
                        onUnresolve={(id) => unresolveComment(id)}
                        onDelete={(id) => deleteComment(id)}
                        onEdit={(id, text) => updateComment(id, { comment: text })}
                        onAskAI={(id) => askAI(id)}
                        onCommentClick={handleCommentClick}
                    />
                )}
            </div>

            <SelectionToolbar
                visible={toolbarVisible}
                position={toolbarPos}
                onAddComment={handleAddCommentClick}
            />

            {popupVisible && (
                <InlineCommentPopup
                    position={popupPos}
                    onSubmit={handlePopupSubmit}
                    onCancel={handlePopupCancel}
                />
            )}
        </div>
    );
}

// ── Helpers (from legacy task-comments-ui.ts) ──

function getTextOffset(container: Node, targetNode: Node, targetOffset: number): number {
    let offset = 0;
    const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
        if (walker.currentNode === targetNode) return offset + targetOffset;
        offset += (walker.currentNode.textContent || '').length;
    }
    return offset + targetOffset;
}

function offsetToPosition(text: string, offset: number): { line: number; column: number } {
    const clamped = Math.max(0, Math.min(offset, text.length));
    const before = text.substring(0, clamped);
    const lines = before.split('\n');
    return { line: lines.length, column: (lines[lines.length - 1]?.length || 0) + 1 };
}
