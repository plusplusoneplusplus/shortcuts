/**
 * TaskPreview — right-panel markdown preview with mermaid support and comment system.
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import { fetchApi } from '../hooks/useApi';
import { useMarkdownPreview } from '../hooks/useMarkdownPreview';
import { useTaskComments } from '../hooks/useTaskComments';
import { Spinner } from '../shared';
import { CommentSidebar } from './comments/CommentSidebar';
import { SelectionToolbar } from './comments/SelectionToolbar';
import { InlineCommentPopup } from './comments/InlineCommentPopup';
import { CommentHighlight } from './comments/CommentHighlight';
import type { TaskComment, TaskCommentCategory, CommentSelection } from '../../task-comments-types';
import {
    createAnchorData,
    DEFAULT_ANCHOR_MATCH_CONFIG,
} from '@plusplusoneplusplus/pipeline-core/editor/anchor';

interface TaskPreviewProps {
    wsId: string;
    filePath: string;
}

/** Minimum selection length to trigger toolbar. */
const MIN_SELECTION_LENGTH = 3;

export function TaskPreview({ wsId, filePath }: TaskPreviewProps) {
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

    useEffect(() => {
        setLoading(true);
        setError(null);

        fetchApi(`/workspaces/${encodeURIComponent(wsId)}/tasks/content?path=${encodeURIComponent(filePath)}`)
            .then((data) => {
                const content = typeof data === 'string' ? data : (data?.content || '');
                setRawContent(content);
                setLoading(false);
            })
            .catch((err) => {
                setError(err instanceof Error ? err.message : 'Failed to load file');
                setLoading(false);
            });
    }, [wsId, filePath]);

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
        <div className="flex flex-1 overflow-hidden">
            <div className="flex-1 overflow-y-auto p-4">
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

            <CommentSidebar
                taskId={filePath}
                filePath={filePath}
                comments={comments}
                loading={commentsLoading}
                onResolve={(id) => resolveComment(id)}
                onUnresolve={(id) => unresolveComment(id)}
                onDelete={(id) => deleteComment(id)}
                onEdit={(id, text) => updateComment(id, { comment: text })}
                onAskAI={(id) => askAI(id)}
                onCommentClick={handleCommentClick}
            />

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
