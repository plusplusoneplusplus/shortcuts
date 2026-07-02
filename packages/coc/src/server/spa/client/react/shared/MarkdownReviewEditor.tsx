/**
 * MarkdownReviewEditor — shared markdown review surface with inline comments.
 *
 * Used by the Tasks tab preview and process-conversation markdown dialog
 * so both surfaces share the same commenting and rendering behavior.
 */

import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useMarkdownPreview } from '../hooks/ui/useMarkdownPreview';
import type { RenderCommentInfo } from '../../diff/markdown-renderer';
import { useTaskComments } from '../tasks/hooks/useTaskComments';
import { Spinner } from '../ui/Spinner';
import { SourceEditor } from './SourceEditor';
import { ModeToggleToolbar } from '../ui/ModeToggleToolbar';
import type { ModeOption } from '../ui/ModeToggleToolbar';
import { Button } from '../ui/Button';
import { UpdateDocumentDialog } from './UpdateDocumentDialog';
import { ResolveContextDialog, shouldSkipResolveDialog } from './ResolveContextDialog';
import { CommentSidebar } from '../tasks/comments/CommentSidebar';
import { ContextMenu } from '../tasks/comments/ContextMenu';
import { InlineCommentPopup } from '../tasks/comments/InlineCommentPopup';
import { CommentPopover } from '../tasks/comments/CommentPopover';
import { ResponsiveSidebar } from '../ui/ResponsiveSidebar';
import type { TaskComment, TaskCommentCategory, CommentSelection } from '../../comments/task-comments-types';
import { DASHBOARD_AI_COMMANDS } from './ai-commands';
import { extractDocumentContext } from '../utils/document-context';
import { useGlobalToast } from '../contexts/ToastContext';
import { useBreakpoint } from '../hooks/ui/useBreakpoint';
import { getLanguageFromFileName } from '../features/git/hooks/useSyntaxHighlight';
import { useApp } from '../contexts/AppContext';
import { useQueue } from '../contexts/QueueContext';
import { toForwardSlashes } from '@plusplusoneplusplus/forge/utils/path-utils';
import { isAbsolutePath } from '../utils/path-resolution';
import { RichEditorCore } from '../features/notes/editor/RichEditorCore';
import { markdownToHtml, htmlToMarkdown } from '../features/notes/editor/noteMarkdown';
import type { Editor } from '@tiptap/core';
import { getSpaCocClient, getSpaCocClientErrorMessage } from '../api/cocClient';
import { createTasksNoteEditorIO } from '../tasks/TasksNoteEditorIO';
import { createWorkspaceFileNoteEditorIO } from '../tasks/WorkspaceFileNoteEditorIO';
import type { MarkdownDocumentIO } from './markdown-document/MarkdownDocumentIO';
import {
    useMarkdownDocumentKeyboardShortcuts,
    useMarkdownDocumentSession,
} from './markdown-document/useMarkdownDocumentSession';
import {
    buildMarkdownCommentAnchor,
    resolveMarkdownReviewSelection,
} from './markdown-document/markdownReviewSelection';

const MARKDOWN_EXTENSIONS = new Set(['md', 'markdown', 'mdx']);

type ReviewViewMode = 'review' | 'rich' | 'source';

const REVIEW_MODE_OPTIONS: readonly ModeOption<ReviewViewMode>[] = [
    { value: 'review', label: 'Preview' },
    { value: 'source', label: 'Source' },
] as const;

const RICH_MODE_OPTIONS: readonly ModeOption<ReviewViewMode>[] = [
    { value: 'review', label: 'Preview' },
    { value: 'rich', label: 'Rich', testId: 'review-mode-rich' },
    { value: 'source', label: 'Source' },
] as const;

const TASK_STATUS_OPTIONS = [
    { value: 'pending', label: '⏳ Pending' },
    { value: 'in-progress', label: '🔄 In Progress' },
    { value: 'done', label: '✅ Done' },
    { value: 'future', label: '📋 Future' },
] as const;

export function parseFrontmatterStatus(content: string): string | undefined {
    const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
    if (!match) return undefined;
    const statusMatch = match[1].match(/^status:\s*(.+)$/m);
    return statusMatch?.[1]?.trim();
}

export interface MarkdownReviewEditorProps {
    wsId: string;
    filePath: string;
    /** Absolute task-root path for constructing correct absolute paths (multi-root safe). */
    taskRootPath?: string | null;
    fetchMode?: 'tasks' | 'auto';
    /** Extra content rendered at the right end of the toolbar (e.g. a close button). */
    toolbarRight?: React.ReactNode;
    /** Initial view mode. Defaults to 'review'. */
    initialViewMode?: 'review' | 'source';
    /** Called when the user switches view mode. */
    onViewModeChange?: (mode: 'review' | 'source') => void;
    /** When true, renders Run Skill + Update Document AI buttons in the toolbar. */
    showAiButtons?: boolean;
    /** When true, adds a Rich mode button (Tiptap WYSIWYG) between Preview and Source. */
    showRichMode?: boolean;
    /** Scroll position to restore after content loads (used for minimize/restore). */
    initialScrollTop?: number;
    /** Called whenever the preview scroll position changes. */
    onScrollTopChange?: (scrollTop: number) => void;
}

/** Minimum selection length to trigger toolbar. */
const MIN_SELECTION_LENGTH = 3;

function createMarkdownReviewIO(fetchMode: 'tasks' | 'auto'): MarkdownDocumentIO {
    const taskIo = createTasksNoteEditorIO();
    if (fetchMode === 'tasks') return taskIo;

    const workspaceFileIo = createWorkspaceFileNoteEditorIO();
    return {
        ...taskIo,
        async loadContent(workspaceId, path, root) {
            try {
                return await taskIo.loadContent(workspaceId, path, root);
            } catch {
                return workspaceFileIo.loadContent(workspaceId, path, root);
            }
        },
    };
}

export function MarkdownReviewEditor({
    wsId,
    filePath,
    taskRootPath,
    fetchMode = 'tasks',
    toolbarRight,
    initialViewMode = 'review',
    onViewModeChange,
    showAiButtons = false,
    showRichMode = false,
    initialScrollTop,
    onScrollTopChange,
}: MarkdownReviewEditorProps) {
    const { state: appState } = useApp();
    const { dispatch: queueDispatch } = useQueue();
    const workspaceRootPath = useMemo(() => {
        const ws = appState.workspaces.find((w: any) => w.id === wsId);
        return ws?.rootPath ? toForwardSlashes(ws.rootPath).replace(/\/+$/, '') : '';
    }, [appState.workspaces, wsId]);

    /** Resolve absolute path from a relative filePath using taskRootPath or workspaceRootPath. */
    const resolveAbsolutePath = useCallback((fp: string): string => {
        if (isAbsolutePath(fp)) return toForwardSlashes(fp);
        if (taskRootPath) return toForwardSlashes(taskRootPath + '/' + fp);
        if (workspaceRootPath) return toForwardSlashes(workspaceRootPath + '/' + fp);
        return fp;
    }, [taskRootPath, workspaceRootPath]);

    const previewRef = useRef<HTMLDivElement>(null);
    const scrollContainerRef = useRef<HTMLDivElement>(null);
    const [viewMode, setViewModeRaw] = useState<ReviewViewMode>(initialViewMode);
    const [editedContent, setEditedContent] = useState('');
    const [saveError, setSaveError] = useState<string | null>(null);
    const [aiDialogType, setAiDialogType] = useState<'update-document' | null>(null);
    const [resolveDialogState, setResolveDialogState] = useState<{
        open: boolean;
        mode: 'custom-ask';
        commentId?: string;
        title?: string;
    }>({ open: false, mode: 'custom-ask' });
    const [taskStatus, setTaskStatus] = useState<string | undefined>(undefined);
    const taskName = filePath.split('/').pop()?.replace(/\.[^.]+$/, '') ?? filePath;

    // Rich-mode state
    const [richEditor, setRichEditor] = useState<Editor | null>(null);
    const [richDirty, setRichDirty] = useState(false);
    const richContentRef = useRef<string>('');
    const rawContentRef = useRef('');
    const reviewIo = useMemo(() => createMarkdownReviewIO(fetchMode), [fetchMode]);
    const documentSession = useMarkdownDocumentSession({
        workspaceId: wsId,
        documentPath: filePath,
        io: reviewIo,
        confirmBeforeLoadMessage: 'You have unsaved changes to the current file. Discard and load the new file?',
        confirmRefreshMessage: 'You have unsaved changes. Discard and refresh?',
        onDiscardDirty: () => {
            setEditedContent(rawContentRef.current);
            setRichDirty(false);
            richContentRef.current = '';
        },
        onLoaded: (result) => {
            setEditedContent(result.content);
            setRichDirty(false);
            richContentRef.current = '';
            setSaveError(null);
        },
        onSaveError: (err) => {
            setSaveError(getSpaCocClientErrorMessage(err, 'Failed to save'));
        },
    });
    const rawContent = documentSession.content;
    rawContentRef.current = rawContent;
    const loading = documentSession.loading;
    const error = documentSession.loadError ?? saveError;
    const saving = documentSession.saveState === 'saving';

    const handleRichEditorReady = useCallback((ed: Editor) => { setRichEditor(ed); }, []);
    const handleRichChange = useCallback((ed: Editor) => {
        richContentRef.current = ed.getHTML();
        setRichDirty(true);
        documentSession.setDirty(true);
    }, [documentSession]);

    const modeOptions = showRichMode ? RICH_MODE_OPTIONS : REVIEW_MODE_OPTIONS;

    const setViewMode = useCallback((mode: ReviewViewMode) => {
        setViewModeRaw(mode);
        if (mode !== 'rich') onViewModeChange?.(mode as 'review' | 'source');
    }, [onViewModeChange]);

    const isDirty = documentSession.dirty;

    const handleSourceChange = useCallback((content: string) => {
        setEditedContent(content);
        documentSession.setDirty(content !== rawContentRef.current);
    }, [documentSession]);

    const { addToast } = useGlobalToast();

    // Sync task status from frontmatter whenever content loads/reloads
    useEffect(() => { setTaskStatus(parseFrontmatterStatus(rawContent)); }, [rawContent]);

    const handleStatusChange = useCallback(async (newStatus: string) => {
        const prev = taskStatus;
        setTaskStatus(newStatus);
        try {
            await getSpaCocClient().tasks.updateStatus(wsId, filePath, newStatus);
            window.dispatchEvent(new CustomEvent('tasks-changed', { detail: { wsId } }));
        } catch {
            setTaskStatus(prev);
            addToast('Failed to update status', 'error');
        }
    }, [wsId, filePath, taskStatus, addToast]);

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

    // Mobile state
    const { isMobile } = useBreakpoint();
    const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
    const [mobileActionBarVisible, setMobileActionBarVisible] = useState(false);
    const [mobileActionBarPos, setMobileActionBarPos] = useState({ top: 0, left: 0 });

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
        resolvingIds,
        deletingIds,
        resolveWithAI,
        fixWithAI,
        copyResolvePrompt,
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

    // For non-markdown code files, wrap content in a fenced code block so the
    // markdown renderer applies syntax highlighting via highlight.js.
    const previewContent = useMemo(() => {
        if (!rawContent) return rawContent;
        const ext = filePath.split('.').pop()?.toLowerCase();
        if (!ext || MARKDOWN_EXTENSIONS.has(ext)) return rawContent;
        const lang = getLanguageFromFileName(filePath);
        if (!lang) return rawContent;
        return `\`\`\`${lang}\n${rawContent}\n\`\`\``;
    }, [rawContent, filePath]);

    // Shared markdown rendering (render + hljs + mermaid)
    const { html } = useMarkdownPreview({
        content: previewContent,
        containerRef: previewRef,
        loading,
        stripFrontmatter: true,
        viewMode,
        comments: renderComments,
    });

    const showCommentListPanel = comments.length > 0;

    // Restore scroll position after content finishes loading (for minimize/restore)
    useEffect(() => {
        if (!loading && initialScrollTop && scrollContainerRef.current) {
            scrollContainerRef.current.scrollTop = initialScrollTop;
        }
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [loading]); // intentionally run only when loading state changes

    // Sync editedContent when switching to source mode or when rawContent changes
    useEffect(() => {
        if (viewMode === 'source') {
            setEditedContent(rawContent);
        }
    }, [viewMode, rawContent]);

    // Load content into rich editor when switching to rich mode or when rawContent changes
    useEffect(() => {
        if (viewMode === 'rich' && richEditor && rawContent) {
            const html = markdownToHtml(rawContent);
            richEditor.commands.setContent(html);
            setRichDirty(false);
        }
    }, [viewMode, richEditor, rawContent]);

    const saveContent = useCallback(async () => {
        if (!isDirty || saving) return;
        try {
            const contentToSave = viewMode === 'rich'
                ? htmlToMarkdown(richContentRef.current)
                : editedContent;
            await documentSession.saveNow(contentToSave);
            setEditedContent(contentToSave);
            if (viewMode === 'rich') setRichDirty(false);
            window.dispatchEvent(new CustomEvent('tasks-changed', { detail: { wsId } }));
        } catch (err) {
            setSaveError(getSpaCocClientErrorMessage(err, 'Failed to save'));
        }
    }, [isDirty, saving, editedContent, viewMode, documentSession, wsId]);

    const handleRefresh = useCallback(() => {
        documentSession.refresh();
    }, [documentSession]);

    useMarkdownDocumentKeyboardShortcuts({
        onRefresh: handleRefresh,
        onSave: saveContent,
        saveEnabled: (viewMode === 'source' || viewMode === 'rich') && isDirty,
    });

    // Save selection silently on mouseup
    useEffect(() => {
        const handleMouseUp = () => {
            const sel = window.getSelection();
            if (
                viewMode !== 'source' &&
                sel && !sel.isCollapsed && sel.rangeCount && sel.toString().trim().length >= MIN_SELECTION_LENGTH &&
                previewRef.current?.contains(sel.anchorNode)
            ) {
                const range = sel.getRangeAt(0);
                const resolved = resolveMarkdownReviewSelection(rawContent, previewRef.current!, range, sel.toString().trim());
                setSavedSelection(resolved);
                return;
            }
            setSavedSelection(null);
        };

        document.addEventListener('mouseup', handleMouseUp);
        return () => document.removeEventListener('mouseup', handleMouseUp);
    }, [viewMode, rawContent]);

    // Touch selection handler for mobile (touchend fires after the browser finalizes selection)
    useEffect(() => {
        const handleTouchEnd = () => {
            setTimeout(() => {
                const sel = window.getSelection();
                if (
                    viewMode !== 'source' &&
                    sel && !sel.isCollapsed && sel.rangeCount && sel.toString().trim().length >= MIN_SELECTION_LENGTH &&
                    previewRef.current?.contains(sel.anchorNode)
                ) {
                    const range = sel.getRangeAt(0);
                    const resolved = resolveMarkdownReviewSelection(rawContent, previewRef.current!, range, sel.toString().trim());
                    setSavedSelection(resolved);
                    if (resolved) {
                        const rect = range.getBoundingClientRect();
                        setMobileActionBarPos({
                            top: Math.max(8, rect.top - 52),
                            left: Math.max(8, Math.min(rect.left, window.innerWidth - 180)),
                        });
                        setMobileActionBarVisible(true);
                        return;
                    }
                }
                setSavedSelection(null);
                setMobileActionBarVisible(false);
            }, 100);
        };

        document.addEventListener('touchend', handleTouchEnd);
        return () => document.removeEventListener('touchend', handleTouchEnd);
    }, [viewMode, rawContent]);

    const handleContextMenu = useCallback((e: React.MouseEvent) => {
        if (viewMode === 'source' || viewMode === 'rich') return;
        if (e.shiftKey) return;
        e.preventDefault();
        setContextMenuPos({ x: e.clientX, y: e.clientY });
        setContextMenuVisible(true);
    }, [viewMode]);

    const dismissMobileActionBar = useCallback(() => {
        setMobileActionBarVisible(false);
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
        setMobileActionBarVisible(false);
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

        const anchor = buildMarkdownCommentAnchor(
            rawContent,
            pendingSelection.startLine,
            pendingSelection.endLine,
            pendingSelection.startColumn,
            pendingSelection.endColumn,
        );

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

        const anchor = buildMarkdownCommentAnchor(
            rawContent,
            savedSelection.startLine,
            savedSelection.endLine,
            savedSelection.startColumn,
            savedSelection.endColumn,
        );

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
        setResolveDialogState({ open: true, mode: 'custom-ask', title: 'Ask AI about Selection' });
    }, [savedSelection]);

    const handleCustomAskSubmit = useCallback(async (question: string, skills: string[]) => {
        setResolveDialogState(s => ({ ...s, open: false }));
        if (!savedSelection || !question?.trim()) return;

        const selection: CommentSelection = {
            startLine: savedSelection.startLine,
            startColumn: savedSelection.startColumn,
            endLine: savedSelection.endLine,
            endColumn: savedSelection.endColumn,
        };

        const anchor = buildMarkdownCommentAnchor(
            rawContent,
            savedSelection.startLine,
            savedSelection.endLine,
            savedSelection.startColumn,
            savedSelection.endColumn,
        );

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
        const openCount = comments.filter(c => c.status === 'open').length;
        if (openCount === 0) return;
        if (shouldSkipResolveDialog()) {
            try {
                const result = await resolveWithAI(rawContent, filePath);
                addToast(`Batch resolve queued for ${result.totalCount} open comment(s).`, 'info');
            } catch (err) {
                addToast(`Batch resolve failed: ${err instanceof Error ? err.message : String(err)}`, 'error');
            }
            return;
        }
        queueDispatch({
            type: 'OPEN_DIALOG',
            workspaceId: wsId,
            mode: 'resolve',
            resolveContext: {
                title: 'Resolve with AI',
                commentCount: openCount,
                onSubmit: async (ctx: string, sk: string[]) => {
                    try {
                        const result = await resolveWithAI(rawContent, filePath, ctx || undefined, sk.length > 0 ? sk : undefined);
                        addToast(`Batch resolve queued for ${result.totalCount} open comment(s).`, 'info');
                    } catch (err) {
                        addToast(`Batch resolve failed: ${err instanceof Error ? err.message : String(err)}`, 'error');
                    }
                },
            },
        });
    }, [comments, resolveWithAI, rawContent, filePath, addToast, queueDispatch, wsId]);

    const handleFixWithAI = useCallback(async (id: string) => {
        if (shouldSkipResolveDialog()) {
            try {
                await fixWithAI(id, rawContent, filePath);
                addToast('Fix with AI queued.', 'info');
            } catch (err) {
                addToast(`Fix failed: ${err instanceof Error ? err.message : String(err)}`, 'error');
            }
            return;
        }
        queueDispatch({
            type: 'OPEN_DIALOG',
            workspaceId: wsId,
            mode: 'resolve',
            resolveContext: {
                title: 'Fix with AI',
                commentCount: 1,
                onSubmit: async (ctx: string, sk: string[]) => {
                    try {
                        await fixWithAI(id, rawContent, filePath, ctx || undefined, sk.length > 0 ? sk : undefined);
                        addToast('Fix with AI queued.', 'info');
                    } catch (err) {
                        addToast(`Fix failed: ${err instanceof Error ? err.message : String(err)}`, 'error');
                    }
                },
            },
        });
    }, [fixWithAI, rawContent, filePath, addToast, queueDispatch, wsId]);

    const handleCopyPrompt = useCallback(() => {
        copyResolvePrompt(rawContent, filePath);
        addToast('Resolve prompt copied to clipboard.', 'success');
    }, [copyResolvePrompt, rawContent, filePath, addToast]);

    const handleResolveDialogSubmit = useCallback(async (userContext: string, skills: string[]) => {
        setResolveDialogState(s => ({ ...s, open: false }));
        await handleCustomAskSubmit(userContext, skills);
    }, [handleCustomAskSubmit]);

    const handleCopyWithContext = useCallback(async () => {
        const text = savedSelection?.text || rawContent;
        const absolutePath = resolveAbsolutePath(filePath) || '(unknown file)';
        const pathLabel = absolutePath || '(unknown file)';
        const formatted = `${pathLabel}\n\`\`\`\n${text}\n\`\`\``;
        try {
            await navigator.clipboard.writeText(formatted);
            addToast('Copied with context', 'success');
        } catch {
            addToast('Failed to copy — clipboard access denied', 'error');
        }
    }, [savedSelection, rawContent, filePath, resolveAbsolutePath, addToast]);

    const handleSwitchToReview = useCallback(() => {
        if (isDirty) {
            if (!window.confirm('You have unsaved changes. Discard and switch to Preview?')) return;
            if (viewMode === 'source') setEditedContent(rawContent);
            if (viewMode === 'rich') setRichDirty(false);
            documentSession.setDirty(false);
        }
        setViewMode('review');
    }, [isDirty, rawContent, setViewMode, viewMode, documentSession]);

    const handleSwitchToRich = useCallback(() => {
        if (viewMode === 'source' && isDirty) {
            if (!window.confirm('You have unsaved changes. Discard and switch to Rich?')) return;
            setEditedContent(rawContent);
            documentSession.setDirty(false);
        }
        setViewMode('rich');
    }, [viewMode, isDirty, rawContent, setViewMode, documentSession]);

    const handleSwitchToSource = useCallback(() => {
        if (viewMode === 'rich' && richDirty) {
            if (!window.confirm('You have unsaved changes. Discard and switch to Source?')) return;
            setRichDirty(false);
            documentSession.setDirty(false);
        }
        setViewMode('source');
    }, [viewMode, richDirty, setViewMode, documentSession]);

    // Event delegation for build-time highlight click
    const handleHighlightClick = useCallback((e: React.MouseEvent) => {
        const span = (e.target as HTMLElement).closest('[data-comment-id]');
        if (!span) return;
        const id = span.getAttribute('data-comment-id');
        const comment = comments.find(c => c.id === id);
        if (comment) handleCommentClick(comment);
    }, [comments, handleCommentClick]);

    if (loading && !documentSession.hasLoaded && !rawContent) {
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

    // Shared props for both desktop inline and mobile drawer CommentSidebar instances.
    const sharedCommentSidebarProps = {
        taskId: filePath,
        filePath,
        comments,
        loading: commentsLoading,
        compact: true as const,
        onResolve: resolveComment,
        onUnresolve: unresolveComment,
        onDelete: deleteComment,
        onEdit: (id: string, text: string) => updateComment(id, { comment: text }),
        onAskAI: (id: string, commandId?: string, customQuestion?: string) => {
            const comment = comments.find(c => c.id === id);
            const context = extractDocumentContext(rawContent, comment);
            askAI(id, { commandId, customQuestion, documentContext: context });
        },
        aiLoadingIds,
        aiErrors,
        onClearAiError: clearAiError,
        resolvingIds,
        deletingIds,
        onResolveAllWithAI: handleResolveAllWithAI,
        onCopyPrompt: handleCopyPrompt,
        onFixWithAI: handleFixWithAI,
    };

    return (
        <div className="flex h-full flex-1 overflow-hidden min-h-0 min-w-0">
            <div className="flex h-full flex-1 overflow-hidden min-h-0 min-w-0 bg-white dark:bg-[#1e1e1e]">
                <div className="flex min-h-0 min-w-0 flex-1 flex-col">
                    {/* ── Mode toggle toolbar ── */}
                    <ModeToggleToolbar<ReviewViewMode>
                        modes={modeOptions}
                        activeMode={viewMode}
                        onModeChange={(mode) => {
                            if (mode === 'review') handleSwitchToReview();
                            else if (mode === 'rich') handleSwitchToRich();
                            else handleSwitchToSource();
                        }}
                        dirty={isDirty}
                        showSave={viewMode === 'source' || viewMode === 'rich'}
                        onSave={saveContent}
                        saving={saving}
                        right={<>
                            <button
                                className="refresh-btn"
                                onClick={handleRefresh}
                                disabled={loading}
                                data-testid="markdown-review-refresh-btn"
                                aria-label="Refresh"
                                title="Refresh (Ctrl+Shift+R)"
                            >{loading ? '⏳' : '↻'}</button>
                            {(filePath.endsWith('.md') || filePath.endsWith('.markdown')) && (
                                <select
                                    value={taskStatus ?? ''}
                                    onChange={e => handleStatusChange(e.target.value)}
                                    className="task-status-select"
                                    aria-label="Task status"
                                    data-testid="task-status-select"
                                >
                                    <option value="" disabled>— Status —</option>
                                    {TASK_STATUS_OPTIONS.map(o => (
                                        <option key={o.value} value={o.value}>{o.label}</option>
                                    ))}
                                </select>
                            )}
                            {(showAiButtons || toolbarRight) && (
                                <div className="ml-auto flex items-center">
                                    {showAiButtons && (
                                        <>
                                            <Button
                                                variant="ghost"
                                                size="sm"
                                                data-testid="task-preview-follow-prompt"
                                                title="Run Skill"
                                                onClick={() => {
                                                    const absPath = resolveAbsolutePath(filePath);
                                                    queueDispatch({
                                                        type: 'OPEN_DIALOG',
                                                        workspaceId: wsId,
                                                        contextFiles: [absPath],
                                                        contextTaskName: taskName,
                                                    });
                                                }}
                                            >⚡</Button>
                                            <Button
                                                variant="ghost"
                                                size="sm"
                                                data-testid="task-preview-update-document"
                                                title="Update Document"
                                                onClick={() => setAiDialogType('update-document')}
                                            >✏️</Button>
                                            <span className="w-px h-4 bg-[#e0e0e0] dark:bg-[#3c3c3c] mx-1 self-center" aria-hidden="true" />
                                        </>
                                    )}
                                    {toolbarRight}
                                </div>
                            )}
                        </>}
                    />

                    {viewMode === 'source' ? (
                        <div className="flex-1 overflow-y-auto min-h-0 min-w-0">
                            <SourceEditor
                                content={editedContent}
                                onChange={handleSourceChange}
                            />
                        </div>
                    ) : viewMode === 'rich' ? (
                        <div className="flex-1 overflow-y-auto min-h-0 min-w-0 p-4" data-testid="rich-editor-wrapper">
                            <RichEditorCore
                                onEditorReady={handleRichEditorReady}
                                onChange={handleRichChange}
                            />
                        </div>
                    ) : (
                        <div
                            ref={scrollContainerRef}
                            className="flex-1 overflow-y-auto p-4 min-h-0 min-w-0"
                            onScroll={onScrollTopChange ? (e) => onScrollTopChange((e.currentTarget as HTMLDivElement).scrollTop) : undefined}
                        >
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

                {/* Desktop inline sidebar */}
                {!isMobile && showCommentListPanel && (
                    <CommentSidebar
                        {...sharedCommentSidebarProps}
                        onCommentClick={handleCommentClick}
                    />
                )}
            </div>

            {/* Mobile sidebar drawer */}
            {isMobile && showCommentListPanel && (
                <ResponsiveSidebar
                    isOpen={mobileSidebarOpen}
                    onClose={() => setMobileSidebarOpen(false)}
                >
                    <CommentSidebar
                        {...sharedCommentSidebarProps}
                        fullWidth
                        onCommentClick={(comment) => { handleCommentClick(comment); setMobileSidebarOpen(false); }}
                    />
                </ResponsiveSidebar>
            )}

            {/* Mobile: floating Comments toggle button */}
            {isMobile && showCommentListPanel && (
                <button
                    className="fixed bottom-20 right-4 z-[9000] flex items-center gap-1.5 bg-[#0078d4] text-white text-sm font-medium px-3 py-2 rounded-full shadow-lg"
                    onClick={() => setMobileSidebarOpen(o => !o)}
                    aria-label={`Comments (${comments.length})`}
                    data-testid="mobile-comments-toggle"
                >
                    💬 <span>{comments.length}</span>
                </button>
            )}

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

            {/* Mobile selection action bar */}
            {mobileActionBarVisible && savedSelection && (
                <div
                    className="fixed z-[10004] flex items-center gap-1 bg-white dark:bg-[#252526] border border-[#e0e0e0] dark:border-[#3c3c3c] shadow-lg rounded-lg px-2 py-1.5"
                    style={{ top: mobileActionBarPos.top, left: mobileActionBarPos.left }}
                    data-testid="mobile-selection-action-bar"
                >
                    <button
                        className="flex items-center gap-1 px-2 py-1 text-sm text-[#1e1e1e] dark:text-[#cccccc] rounded hover:bg-[#0078d4]/10 dark:hover:bg-[#3794ff]/10 whitespace-nowrap"
                        onClick={handleAddCommentFromMenu}
                    >
                        💬 Comment
                    </button>
                    <div className="w-px h-4 bg-[#e0e0e0] dark:bg-[#3c3c3c]" />
                    <button
                        className="flex items-center gap-1 px-2 py-1 text-sm text-[#1e1e1e] dark:text-[#cccccc] rounded hover:bg-[#0078d4]/10 dark:hover:bg-[#3794ff]/10 whitespace-nowrap"
                        onClick={() => { dismissMobileActionBar(); handleAskAIFromSelection(DASHBOARD_AI_COMMANDS[0]?.id ?? ''); }}
                    >
                        🤖 Ask AI
                    </button>
                    <button
                        className="ml-1 p-1 text-[#848484] hover:text-[#1e1e1e] dark:hover:text-[#cccccc]"
                        onClick={dismissMobileActionBar}
                        aria-label="Dismiss"
                    >
                        ✕
                    </button>
                </div>
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
                    isResolving={resolvingIds.has(activePopoverComment.id)}
                    isDeleting={deletingIds.has(activePopoverComment.id)}
                />
            )}
            {showAiButtons && aiDialogType === 'update-document' && (
                <UpdateDocumentDialog
                    wsId={wsId}
                    taskPath={filePath}
                    taskName={taskName}
                    onClose={() => setAiDialogType(null)}
                />
            )}
            <ResolveContextDialog
                open={resolveDialogState.open}
                onClose={() => setResolveDialogState(s => ({ ...s, open: false }))}
                onSubmit={handleResolveDialogSubmit}
                commentCount={0}
                title={resolveDialogState.title}
                wsId={wsId}
            />
        </div>
    );
}
