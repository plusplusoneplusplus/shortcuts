/**
 * MarkdownReviewEditor — shared markdown review surface with inline comments.
 *
 * Used by the Tasks tab preview and process-conversation markdown dialog
 * so both surfaces share the same commenting and rendering behavior.
 */

import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { fetchApi } from '../hooks/useApi';
import { useMarkdownPreview } from '../hooks/useMarkdownPreview';
import type { RenderCommentInfo } from '../../markdown-renderer';
import { useTaskComments } from '../hooks/useTaskComments';
import { Spinner } from './Spinner';
import { SourceEditor } from './SourceEditor';
import { CommentSidebar } from '../tasks/comments/CommentSidebar';
import { ContextMenu } from '../tasks/comments/ContextMenu';
import { InlineCommentPopup } from '../tasks/comments/InlineCommentPopup';
import { CommentPopover } from '../tasks/comments/CommentPopover';
import type { TaskComment, TaskCommentCategory, CommentSelection } from '../../task-comments-types';
import {
    createAnchorData,
    DEFAULT_ANCHOR_MATCH_CONFIG,
} from '@plusplusoneplusplus/pipeline-core/editor/anchor';
import { DASHBOARD_AI_COMMANDS } from './ai-commands';
import { extractDocumentContext } from '../utils/document-context';
import { getApiBase } from '../utils/config';
import { useGlobalToast } from '../context/ToastContext';
import { selectionToSourcePosition } from '../utils/selection-position';

export interface MarkdownReviewEditorProps {
    wsId: string;
    filePath: string;
    fetchMode?: 'tasks' | 'auto';
    /** Extra content rendered at the right end of the toolbar (e.g. a close button). */
    toolbarRight?: React.ReactNode;
    /** Initial view mode. Defaults to 'review'. */
    initialViewMode?: 'review' | 'source';
    /** Called when the user switches view mode. */
    onViewModeChange?: (mode: 'review' | 'source') => void;
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
    toolbarRight,
    initialViewMode = 'review',
    onViewModeChange,
}: MarkdownReviewEditorProps) {
    const [rawContent, setRawContent] = useState('');
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const previewRef = useRef<HTMLDivElement>(null);
    const [viewMode, setViewModeRaw] = useState<'review' | 'source'>(initialViewMode);
    const [editedContent, setEditedContent] = useState('');
    const [saving, setSaving] = useState(false);

    const setViewMode = useCallback((mode: 'review' | 'source') => {
        setViewModeRaw(mode);
        onViewModeChange?.(mode);
    }, [onViewModeChange]);

    const isDirty = viewMode === 'source' && editedContent !== rawContent;

    // Ref mirror so the content-fetch useEffect can read dirty state without depending on it
    const isDirtyRef = useRef(false);
    isDirtyRef.current = isDirty;

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
        aiLoadingIds,
        aiErrors,
        clearAiError,
        resolveWithAI,
        fixWithAI,
        copyResolvePrompt,
        resolving,
        resolvingCommentId,
        refresh,
    } = useTaskComments(wsId, filePath);

    // Map TaskComment[] → RenderCommentInfo[] for build-time highlight injection
    const renderComments: RenderCommentInfo[] = useMemo(
        () => comments.map(c => ({
            id: c.id,
            selection: c.selection,
            status: c.status,
        })),
        [comments]
    );

    // Shared markdown rendering (render + hljs + mermaid)
    const { html } = useMarkdownPreview({
        content: rawContent,
        containerRef: previewRef,
        loading,
        stripFrontmatter: true,
        viewMode,
        comments: renderComments,
    });

    const { addToast } = useGlobalToast();

    const showCommentListPanel = comments.length > 0;

    useEffect(() => {
        let cancelled = false;

        // Guard: warn if switching files while dirty
        if (isDirtyRef.current) {
            if (!window.confirm('You have unsaved changes to the current file. Discard and load the new file?')) {
                cancelled = true;
                return;
            }
        }

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

    // Sync editedContent when switching to source mode or when rawContent changes
    useEffect(() => {
        if (viewMode === 'source') {
            setEditedContent(rawContent);
        }
    }, [viewMode, rawContent]);

    const saveContent = useCallback(async () => {
        if (!isDirty || saving) return;
        setSaving(true);
        try {
            const res = await fetch(getApiBase() + `/workspaces/${encodeURIComponent(wsId)}/tasks/content`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ path: filePath, content: editedContent }),
            });
            if (!res.ok) {
                const errBody = await res.text();
                throw new Error(errBody || `Save failed (${res.status})`);
            }
            setRawContent(editedContent);
            window.dispatchEvent(new CustomEvent('tasks-changed', { detail: { wsId } }));
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to save');
        } finally {
            setSaving(false);
        }
    }, [isDirty, saving, wsId, filePath, editedContent]);

    // Ctrl/Cmd+S keyboard shortcut for saving in source mode
    useEffect(() => {
        if (viewMode !== 'source' || !isDirty) return;
        const handler = (e: KeyboardEvent) => {
            if ((e.ctrlKey || e.metaKey) && e.key === 's') {
                e.preventDefault();
                saveContent();
            }
        };
        document.addEventListener('keydown', handler);
        return () => document.removeEventListener('keydown', handler);
    }, [viewMode, isDirty, saveContent]);

    // Warn before closing tab with unsaved changes
    useEffect(() => {
        if (!isDirty) return;
        const handler = (e: BeforeUnloadEvent) => { e.preventDefault(); };
        window.addEventListener('beforeunload', handler);
        return () => window.removeEventListener('beforeunload', handler);
    }, [isDirty]);

    // Save selection silently on mouseup
    useEffect(() => {
        const handleMouseUp = () => {
            const sel = window.getSelection();
            if (
                viewMode !== 'source' &&
                sel && !sel.isCollapsed && sel.rangeCount && sel.toString().trim().length >= MIN_SELECTION_LENGTH
            ) {
                if (previewRef.current?.contains(sel.anchorNode)) {
                    const range = sel.getRangeAt(0);
                    const text = sel.toString().trim();

                    // Use DOM-aware position mapping via data-line attributes
                    const sourcePos = selectionToSourcePosition(rawContent, previewRef.current, range);
                    if (sourcePos) {
                        setSavedSelection({
                            text,
                            range: range.cloneRange(),
                            ...sourcePos,
                        });
                        return;
                    }

                    // Fallback for selections inside block elements (code blocks, tables)
                    console.warn('Selection is not inside an md-line element; using rendered-text fallback');
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
    }, [viewMode, rawContent]);

    const handleContextMenu = useCallback((e: React.MouseEvent) => {
        if (viewMode === 'source') return;
        e.preventDefault();
        setContextMenuPos({ x: e.clientX, y: e.clientY });
        setContextMenuVisible(true);
    }, [viewMode]);

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

        const span = previewRef.current.querySelector(`[data-comment-id="${comment.id}"]`);
        if (!span) return;

        const scrollContainer = span.closest('.overflow-y-auto') ?? previewRef.current.parentElement;
        if (scrollContainer) {
            const containerRect = scrollContainer.getBoundingClientRect();
            const spanRect = span.getBoundingClientRect();
            const scrollTop = scrollContainer.scrollTop + (spanRect.top - containerRect.top) - containerRect.height / 2 + spanRect.height / 2;
            scrollContainer.scrollTo({ top: Math.max(0, scrollTop), behavior: 'smooth' });
        }

        const rect = span.getBoundingClientRect();
        setPopoverPos({ top: rect.bottom + 8, left: Math.max(8, rect.left) });
        setActivePopoverComment(comment);
    }, []);

    const handleAskAIFromSelection = useCallback(async (commandId: string) => {
        if (!savedSelection) return;
        setContextMenuVisible(false);

        const selection: CommentSelection = {
            startLine: savedSelection.startLine,
            startColumn: savedSelection.startColumn,
            endLine: savedSelection.endLine,
            endColumn: savedSelection.endColumn,
        };

        let anchor;
        try {
            anchor = createAnchorData(
                rawContent,
                savedSelection.startLine,
                savedSelection.endLine,
                savedSelection.startColumn,
                savedSelection.endColumn,
                DEFAULT_ANCHOR_MATCH_CONFIG
            );
        } catch {
            // proceed without anchor
        }

        const cmd = DASHBOARD_AI_COMMANDS.find(c => c.id === commandId);
        const commentText = cmd?.label ?? commandId;

        const newComment = await addComment({
            filePath,
            selection,
            selectedText: savedSelection.text,
            comment: commentText,
            category: 'question',
            anchor,
        });

        const context = extractDocumentContext(rawContent, newComment);
        await askAI(newComment.id, { commandId, documentContext: context });
    }, [savedSelection, rawContent, filePath, addComment, askAI]);

    const handleCustomAskAIFromSelection = useCallback(async () => {
        if (!savedSelection) return;
        setContextMenuVisible(false);

        const question = window.prompt('Ask AI a custom question about the selection:');
        if (!question?.trim()) return;

        const selection: CommentSelection = {
            startLine: savedSelection.startLine,
            startColumn: savedSelection.startColumn,
            endLine: savedSelection.endLine,
            endColumn: savedSelection.endColumn,
        };

        let anchor;
        try {
            anchor = createAnchorData(
                rawContent,
                savedSelection.startLine,
                savedSelection.endLine,
                savedSelection.startColumn,
                savedSelection.endColumn,
                DEFAULT_ANCHOR_MATCH_CONFIG
            );
        } catch { /* proceed without anchor */ }

        const newComment = await addComment({
            filePath,
            selection,
            selectedText: savedSelection.text,
            comment: question.trim(),
            category: 'question',
            anchor,
        });

        const context = extractDocumentContext(rawContent, newComment);
        await askAI(newComment.id, { customQuestion: question.trim(), documentContext: context });
    }, [savedSelection, rawContent, filePath, addComment, askAI]);

    const handleResolveAllWithAI = useCallback(async () => {
        try {
            const result = await resolveWithAI(rawContent, filePath);
            setRawContent(result.revisedContent);
            if (result.resolvedCount === result.totalCount) {
                addToast(`All ${result.resolvedCount} comments resolved. Document updated.`, 'success');
            } else if (result.resolvedCount === 0) {
                addToast(`AI could not resolve any of the ${result.totalCount} comments. Document may still have been updated.`, 'warning');
            } else {
                addToast(`${result.resolvedCount} of ${result.totalCount} comments resolved. Document updated.`, 'success');
            }
        } catch (err) {
            addToast(`Batch resolve failed: ${err instanceof Error ? err.message : String(err)}`, 'error');
        }
    }, [resolveWithAI, rawContent, filePath, addToast]);

    const handleFixWithAI = useCallback(async (id: string) => {
        try {
            const result = await fixWithAI(id, rawContent, filePath);
            setRawContent(result.revisedContent);
            if (result.resolved) {
                addToast('Comment fixed and resolved. Document updated.', 'success');
            } else {
                addToast('AI updated the document but did not resolve the comment (it may need clarification).', 'info');
            }
        } catch (err) {
            addToast(`Fix failed: ${err instanceof Error ? err.message : String(err)}`, 'error');
        }
    }, [fixWithAI, rawContent, filePath, addToast]);

    const handleCopyPrompt = useCallback(() => {
        copyResolvePrompt(rawContent, filePath);
        addToast('Resolve prompt copied to clipboard.', 'success');
    }, [copyResolvePrompt, rawContent, filePath, addToast]);

    const handleCopyWithContext = useCallback(async () => {
        const text = savedSelection?.text || rawContent;
        const pathLabel = filePath || '(unknown file)';
        const formatted = `${pathLabel}\n\`\`\`\n${text}\n\`\`\``;
        try {
            await navigator.clipboard.writeText(formatted);
            addToast('Copied with context', 'success');
        } catch {
            addToast('Failed to copy — clipboard access denied', 'error');
        }
    }, [savedSelection, rawContent, filePath, addToast]);

    const handleSwitchToReview = useCallback(() => {
        if (isDirty) {
            if (!window.confirm('You have unsaved changes. Discard and switch to Preview?')) return;
            setEditedContent(rawContent);
        }
        setViewMode('review');
    }, [isDirty, rawContent, setViewMode]);

    // Event delegation for build-time highlight click
    const handleHighlightClick = useCallback((e: React.MouseEvent) => {
        const span = (e.target as HTMLElement).closest('[data-comment-id]');
        if (!span) return;
        const id = span.getAttribute('data-comment-id');
        const comment = comments.find(c => c.id === id);
        if (comment) handleCommentClick(comment);
    }, [comments, handleCommentClick]);

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
        <div className="flex h-full flex-1 overflow-hidden min-h-0 min-w-0">
            <div className="flex h-full flex-1 overflow-hidden min-h-0 min-w-0 bg-white dark:bg-[#1e1e1e]">
                <div className="flex min-h-0 min-w-0 flex-1 flex-col">
                    {/* ── Mode toggle toolbar ── */}
                    <div className="mode-toggle">
                        <button
                            className={`mode-btn${viewMode === 'review' ? ' active' : ''}`}
                            onClick={handleSwitchToReview}
                        >Preview</button>
                        <button
                            className={`mode-btn${viewMode === 'source' ? ' active' : ''}`}
                            onClick={() => setViewMode('source')}
                            aria-label={isDirty ? 'Source (modified)' : undefined}
                        >{isDirty ? 'Source ●' : 'Source'}</button>
                        {viewMode === 'source' && isDirty && (
                            <button className="save-btn" onClick={saveContent} disabled={saving}>
                                {saving ? 'Saving…' : 'Save'}
                            </button>
                        )}
                        {toolbarRight && <div className="ml-auto flex items-center">{toolbarRight}</div>}
                    </div>

                    {viewMode === 'source' ? (
                        <div className="flex-1 overflow-y-auto min-h-0 min-w-0">
                            <SourceEditor
                                content={editedContent}
                                onChange={setEditedContent}
                            />
                        </div>
                    ) : (
                        <div className="flex-1 overflow-y-auto p-4 min-h-0 min-w-0">
                            <div
                                ref={previewRef}
                                id="task-preview-body"
                                className="markdown-body text-sm text-[#1e1e1e] dark:text-[#cccccc]"
                                data-source-file={filePath}
                                dangerouslySetInnerHTML={{ __html: html }}
                                onContextMenu={handleContextMenu}
                                onClick={handleHighlightClick}
                            />
                        </div>
                    )}
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
                        onAskAI={(id, commandId, customQuestion) => {
                            const comment = comments.find(c => c.id === id);
                            const context = extractDocumentContext(rawContent, comment);
                            askAI(id, { commandId, customQuestion, documentContext: context });
                        }}
                        onCommentClick={handleCommentClick}
                        aiLoadingIds={aiLoadingIds}
                        aiErrors={aiErrors}
                        onClearAiError={clearAiError}
                        onResolveAllWithAI={handleResolveAllWithAI}
                        onCopyPrompt={handleCopyPrompt}
                        resolving={resolving}
                        onFixWithAI={handleFixWithAI}
                        resolvingCommentId={resolvingCommentId}
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
                        {
                            label: 'Copy with Context',
                            icon: '📋',
                            disabled: !rawContent,
                            onClick: handleCopyWithContext,
                        },
                        { label: '', separator: true, onClick: () => {} },
                        {
                            label: 'Ask AI',
                            icon: '🤖',
                            disabled: !savedSelection,
                            children: DASHBOARD_AI_COMMANDS.filter(c => !c.isCustomInput).map(cmd => ({
                                label: `${cmd.icon ?? ''} ${cmd.label}`.trim(),
                                onClick: () => handleAskAIFromSelection(cmd.id),
                            })).concat([{
                                label: '💬 Custom...',
                                onClick: () => handleCustomAskAIFromSelection(),
                            }]),
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
                    onAskAI={(id, commandId, customQuestion) => {
                        const context = extractDocumentContext(rawContent, activePopoverComment);
                        askAI(id, { commandId, customQuestion, documentContext: context });
                    }}
                    aiLoading={aiLoadingIds.has(activePopoverComment.id)}
                    aiError={aiErrors.get(activePopoverComment.id) ?? null}
                    onClearAiError={(id) => clearAiError(id)}
                    onFixWithAI={handleFixWithAI}
                    fixLoading={resolvingCommentId === activePopoverComment.id}
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

/**
 * @deprecated Use `selectionToSourcePosition` from `../utils/selection-position` instead.
 * Kept as fallback for selections inside block elements without `data-line` ancestors.
 */
function offsetToPosition(text: string, offset: number): { line: number; column: number } {
    const clamped = Math.max(0, Math.min(offset, text.length));
    const before = text.substring(0, clamped);
    const lines = before.split('\n');
    return { line: lines.length, column: (lines[lines.length - 1]?.length || 0) + 1 };
}
