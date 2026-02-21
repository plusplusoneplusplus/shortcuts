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
import { CommentSidebar } from '../tasks/comments/CommentSidebar';
import { ContextMenu } from '../tasks/comments/ContextMenu';
import { InlineCommentPopup } from '../tasks/comments/InlineCommentPopup';
import { CommentHighlight } from '../tasks/comments/CommentHighlight';
import { CommentPopover } from '../tasks/comments/CommentPopover';
import type { TaskComment, TaskCommentCategory, CommentSelection } from '../../task-comments-types';
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
    const [contextMenuVisible, setContextMenuVisible] = useState(false);
    const [contextMenuPos, setContextMenuPos] = useState({ x: 0, y: 0 });
    const [savedSelection, setSavedSelection] = useState<{
        text: string;
        range: Range;
        startLine: number;
        startColumn: number;
        endLine: number;
        endColumn: number;
    } | null>(null);
    const [popupVisible, setPopupVisible] = useState(false);
    const [popupPos, setPopupPos] = useState({ top: 0, left: 0 });
    const [pendingSelection, setPendingSelection] = useState<{
        text: string;
        startLine: number;
        startColumn: number;
        endLine: number;
        endColumn: number;
    } | null>(null);
    const [activePopoverComment, setActivePopoverComment] = useState<TaskComment | null>(null);
    const [popoverPos, setPopoverPos] = useState({ top: 0, left: 0 });

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

    // Save selection silently on mouseup
    useEffect(() => {
        const handleMouseUp = () => {
            const sel = window.getSelection();
            if (sel && !sel.isCollapsed && sel.rangeCount && sel.toString().trim().length >= MIN_SELECTION_LENGTH) {
                if (previewRef.current?.contains(sel.anchorNode)) {
                    const range = sel.getRangeAt(0);
                    const text = sel.toString().trim();
                    const previewText = previewRef.current.textContent || '';
                    const startOffset = getTextOffset(previewRef.current, range.startContainer, range.startOffset);
                    const endOffset = getTextOffset(previewRef.current, range.endContainer, range.endOffset);
                    const startPos = offsetToPosition(previewText, startOffset);
                    const endPos = offsetToPosition(previewText, endOffset);
                    setSavedSelection({
                        text,
                        range: range.cloneRange(),
                        startLine: startPos.line,
                        startColumn: startPos.column,
                        endLine: endPos.line,
                        endColumn: endPos.column,
                    });
                    return;
                }
            }
            setSavedSelection(null);
        };

        document.addEventListener('mouseup', handleMouseUp);
        return () => document.removeEventListener('mouseup', handleMouseUp);
    }, []);

    const handleContextMenu = useCallback((e: React.MouseEvent) => {
        e.preventDefault();
        setContextMenuPos({ x: e.clientX, y: e.clientY });
        setContextMenuVisible(true);
    }, []);

    const handleAddCommentFromMenu = useCallback(() => {
        if (!savedSelection) return;

        const rect = savedSelection.range.getBoundingClientRect();
        setPopupPos({ top: rect.bottom + 8, left: Math.max(8, rect.left) });

        setPendingSelection({
            text: savedSelection.text,
            startLine: savedSelection.startLine,
            startColumn: savedSelection.startColumn,
            endLine: savedSelection.endLine,
            endColumn: savedSelection.endColumn,
        });

        setContextMenuVisible(false);
        setPopupVisible(true);
    }, [savedSelection]);

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
        if (!previewRef.current) return;

        const mark = previewRef.current.querySelector(`mark[data-comment-id="${comment.id}"]`);
        if (!mark) return;

        const scrollContainer = mark.closest('.overflow-y-auto') ?? previewRef.current.parentElement;
        if (scrollContainer) {
            const containerRect = scrollContainer.getBoundingClientRect();
            const markRect = mark.getBoundingClientRect();
            const scrollTop = scrollContainer.scrollTop + (markRect.top - containerRect.top) - containerRect.height / 2 + markRect.height / 2;
            scrollContainer.scrollTo({ top: Math.max(0, scrollTop), behavior: 'smooth' });
        }

        const rect = mark.getBoundingClientRect();
        setPopoverPos({ top: rect.bottom + 8, left: Math.max(8, rect.left) });
        setActivePopoverComment(comment);
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
                    <div className="flex-1 overflow-y-auto p-4 min-h-0 min-w-0">
                        <div
                            ref={previewRef}
                            id="task-preview-body"
                            className="markdown-body text-sm text-[#1e1e1e] dark:text-[#cccccc]"
                            dangerouslySetInnerHTML={{ __html: html }}
                            onContextMenu={handleContextMenu}
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
                        loading={commentsLoading}
                        compact
                        onResolve={(id) => resolveComment(id)}
                        onUnresolve={(id) => unresolveComment(id)}
                        onDelete={(id) => deleteComment(id)}
                        onEdit={(id, text) => updateComment(id, { comment: text })}
                        onAskAI={(id) => askAI(id)}
                        onCommentClick={handleCommentClick}
                    />
                )}
            </div>

            {contextMenuVisible && (
                <ContextMenu
                    position={contextMenuPos}
                    items={[
                        {
                            label: 'Add comment',
                            icon: '💬',
                            disabled: !savedSelection,
                            onClick: handleAddCommentFromMenu,
                        },
                    ]}
                    onClose={() => setContextMenuVisible(false)}
                />
            )}

            {popupVisible && (
                <InlineCommentPopup
                    position={popupPos}
                    onSubmit={handlePopupSubmit}
                    onCancel={handlePopupCancel}
                />
            )}

            {activePopoverComment && (
                <CommentPopover
                    comment={activePopoverComment}
                    position={popoverPos}
                    onClose={() => setActivePopoverComment(null)}
                    onResolve={(id) => { resolveComment(id); setActivePopoverComment(null); }}
                    onUnresolve={(id) => { unresolveComment(id); setActivePopoverComment(null); }}
                    onDelete={(id) => { deleteComment(id); setActivePopoverComment(null); }}
                    onEdit={(id, text) => updateComment(id, { comment: text })}
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
