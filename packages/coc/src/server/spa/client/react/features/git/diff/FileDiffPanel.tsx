/**
 * FileDiffPanel — unified single-file diff viewer.
 *
 * Replaces the duplicated rendering logic in BranchFileDiff and CommitDetail's
 * per-file view. Driven by a DiffSource strategy that encapsulates all
 * mode-specific behavior (URL building, comment context, AI chat support).
 */

import { useState, useEffect, useCallback, useRef, useMemo, type RefObject } from 'react';
import type { GitFileDiffContentResponse } from '@plusplusoneplusplus/coc-client';
import { Spinner, Button, TruncatedPath } from '../../../ui';
import { UnifiedDiffViewer, HunkNavButtons } from './UnifiedDiffViewer';
import type { UnifiedDiffViewerHandle, DiffLine } from './UnifiedDiffViewer';
import { SideBySideDiffViewer } from './SideBySideDiffViewer';
import { useDiffViewMode } from '../hooks/useDiffViewMode';
import { useDiffEngine } from '../hooks/useDiffEngine';
import { DiffEngineToggle, DiffViewToggle, DiffWordWrapToggle } from './DiffViewToggle';
import { DiffMiniMap } from './DiffMiniMap';
import { DiffFindWidget } from './DiffFindWidget';
import { useDiffFind } from './useDiffFind';
import { useDiffFindShortcut } from './useDiffFindShortcut';
import { useDiffComments } from '../hooks/useDiffComments';
import { CommentSidebar } from '../../../tasks/comments/CommentSidebar';
import { CommentCard } from '../../../tasks/comments/CommentCard';
import { formatDiffCommentPrompt } from '../../../utils/diffCommentPrompt';
import { CommentPopover } from '../../../tasks/comments/CommentPopover';
import { InlineCommentPopup } from '../../../tasks/comments/InlineCommentPopup';
import { useQueue } from '../../../contexts/QueueContext';
import { useCrossFileNav } from '../hooks/useCrossFileNav';
import type { HunkNavigationHandle } from '../hooks/useCrossFileNav';
import { shouldSkipResolveDialog } from '../../../shared/ResolveContextDialog';
import { buildDiffContext } from '../../../../comments/diff-context-utils';
import { copyToClipboard } from '../../../utils/format';
import { CommitReviewChat } from '../commits/CommitReviewChat';
import { useFileDiff } from '../hooks/useFileDiff';
import { useCommitChatPresentation, type UseCommitChatPresentationReturn } from '../hooks/useCommitChatPresentation';
import type { DiffSource } from './diffSource';
import type { DiffSelectionDragSource } from './diffSelectionContext';
import type { DiffCommentSelection, DiffComment } from '../../../../comments/diff-comment-types';
import type { AnyComment } from '../../../../comments/shared-comment-types';
import type { TaskCommentCategory } from '../../../../comments/task-comments-types';
import { MonacoFileDiffViewer, type MonacoFileDiffViewerHandle } from './MonacoFileDiffViewer';
import type { DiffEditorFactory } from './monacoDiffEditorAdapter';
import { resolveDiffEngineSelection, type DiffContentLoadState, type DiffEngineResolution } from './diffEngineResolution';
import { DiffEngineFallbackBanner } from './DiffEngineFallbackBanner';
import { useUnifiedPanelHost } from '../../repo-detail/unified-right-panel/unifiedPanelHost';
import { useCurrentChatInsertDraft } from '../../repo-detail/unified-right-panel/unifiedChatCanvasActions';
import { openUnifiedPanelTab } from '../../repo-detail/unified-right-panel/unifiedPanelOpen';
import { explorerFileTabInput } from '../../repo-detail/unified-right-panel/unifiedExplorerFiles';

export interface FileDiffPanelProps {
    workspaceId: string;
    /** Concrete repo owner for selection attachments. */
    attachmentDestinationId?: string;
    /** Commit-level host keeps chat mounted across overview and file navigation. */
    reviewChat?: UseCommitChatPresentationReturn;
    filePath: string;
    source: DiffSource;
    /** Called when cross-file nav requests switching to a different file. */
    onNavigateToFile?: (filePath: string, hunkTarget: 'first' | 'last') => void;
    /** Auto-scroll to first or last hunk after diff loads. */
    initialHunkTarget?: 'first' | 'last';
    /** Optional local return action for embedded file-review surfaces. */
    onBack?: () => void;
    backLabel?: string;
    backTestId?: string;
    /** Whether to display source.label in the toolbar. Defaults to true. */
    showSourceLabel?: boolean;
    /** When provided, render a Mark reviewed toggle in the toolbar. */
    isReviewed?: boolean;
    onToggleReviewed?: () => void;
    /**
     * Optional classification props (AC-02). Forwarded to the unified diff
     * viewer so filtered-out hunks render as compact summary rows instead
     * of disappearing.
     */
    getHunkClassification?: (filePath: string, hunkIndex: number) => import('../../pull-requests/classification-types').HunkClassification | undefined;
    hunkActiveFilters?: Set<import('../../pull-requests/classification-types').HunkCategory>;
    /**
     * Extra controls rendered in the right-hand button group of the sticky
     * header (e.g. the inline PR Files tab's "Pop out" button). Omitting it
     * leaves the header markup unchanged.
     */
    headerActions?: React.ReactNode;
    /** Monaco diff editor factory; wiring tests pass an owned adapter. */
    createDiffEditor?: DiffEditorFactory;
    onDiffEngineChange?: (engine: DiffEngineResolution['engine']) => void;
}

type PopupState = {
    position: { top: number; left: number };
    selection: DiffCommentSelection;
    selectedText: string;
} | null;

type EditorContentState =
    | { key: string; status: 'loading' }
    | { key: string; status: 'loaded'; content: GitFileDiffContentResponse; workspaceId: string;
        filePath: string; cacheKey: string; supportsWorkingCopyLanguage: boolean }
    | { key: string; status: 'failed' };

export function FileDiffPanel({
    workspaceId,
    attachmentDestinationId,
    filePath,
    source,
    onNavigateToFile,
    initialHunkTarget,
    onBack,
    backLabel = 'All files',
    backTestId = 'file-diff-back-btn',
    showSourceLabel = true,
    isReviewed,
    onToggleReviewed,
    getHunkClassification,
    hunkActiveFilters,
    headerActions,
    createDiffEditor,
    onDiffEngineChange,
    reviewChat,
}: FileDiffPanelProps) {
    const { dispatch: queueDispatch } = useQueue();

    const diffSelectionRef = source.diffSelectionRef;
    const diffSelectionDragSource = useMemo<DiffSelectionDragSource | undefined>(
        () => (diffSelectionRef ? { workspaceId, destinationId: attachmentDestinationId, ref: diffSelectionRef, filePath } : undefined),
        [workspaceId, attachmentDestinationId, diffSelectionRef, filePath],
    );

    // ── Diff fetching ──
    const [fullContextMode, setFullContextMode] = useState(false);

    // Reset full-context mode when navigating to a different file
    useEffect(() => {
        setFullContextMode(false);
    }, [filePath]);

    const diffUrl = fullContextMode && source.fullContextFileDiffUrl
        ? source.fullContextFileDiffUrl(filePath)
        : source.fileDiffUrl(filePath);
    const fullDiffUrl = source.supportsTruncation ? source.fileDiffUrl(filePath, true) : null;
    const { diff, loading, error, retry, truncated, totalLines, requestFullDiff, fullContextUnavailable } =
        useFileDiff(diffUrl, fullDiffUrl, workspaceId);

    // ── View mode ──
    const [viewMode, setViewMode] = useDiffViewMode();
    const [diffEngine, setDiffEngine] = useDiffEngine();
    const [editorContent, setEditorContent] = useState<EditorContentState | null>(null);
    const [editorAttempt, setEditorAttempt] = useState(0);
    const [editorFailedKey, setEditorFailedKey] = useState<string | null>(null);
    const wantsEditor = diffEngine === 'monaco' && source.fetchFileContent !== undefined;
    const editorContentKey = `${workspaceId}\u0000${source.cacheKey}\u0000${filePath}\u0000${editorAttempt}`;
    const sourceRef = useRef(source);
    sourceRef.current = source;

    useEffect(() => {
        const requestedSource = sourceRef.current;
        const fetchFileContent = requestedSource.fetchFileContent;
        if (!wantsEditor || !fetchFileContent) return;
        let cancelled = false;
        // Retain the last editor models while the next file loads.
        setEditorContent(previous => previous?.status === 'loaded' ? previous : { key: editorContentKey, status: 'loading' });
        Promise.resolve().then(() => fetchFileContent(filePath))
            .then(content => {
                if (!content || typeof content.binary !== 'boolean' || typeof content.tooLarge !== 'boolean'
                    || typeof content.base?.content !== 'string' || typeof content.head?.content !== 'string') {
                    throw new Error('Invalid file diff content response');
                }
                if (!cancelled) setEditorContent({
                    key: editorContentKey, status: 'loaded', content, workspaceId, filePath,
                    cacheKey: requestedSource.cacheKey, supportsWorkingCopyLanguage: requestedSource.supportsWorkingCopyLanguage === true,
                });
            })
            .catch(() => { if (!cancelled) setEditorContent({ key: editorContentKey, status: 'failed' }); });
        return () => { cancelled = true; };
    }, [wantsEditor, filePath, editorContentKey]);

    const currentEditorContent = editorContent?.key === editorContentKey ? editorContent : null;
    const contentLoadState: DiffContentLoadState | null = !currentEditorContent ? null
        : currentEditorContent.status === 'loaded'
            ? { status: 'loaded', binary: currentEditorContent.content.binary, tooLarge: currentEditorContent.content.tooLarge }
            : { status: currentEditorContent.status };
    const engineSelection = resolveDiffEngineSelection({
        preference: wantsEditor ? diffEngine : 'legacy',
        content: contentLoadState,
        editorFailed: editorFailedKey === editorContentKey,
    });
    const editorSides = engineSelection.engine === 'monaco' && currentEditorContent?.status === 'loaded'
        ? currentEditorContent.content
        : null;
    const showEditor = editorSides !== null;
    const editorLoading = engineSelection.engine === 'loading';
    const displayedEditor = (showEditor || editorLoading) && editorContent?.status === 'loaded'
        && editorContent.workspaceId === workspaceId && editorFailedKey !== editorContent.key
        && !editorContent.content.binary && !editorContent.content.tooLarge ? editorContent : null;
    const classicActive = engineSelection.engine === 'legacy';
    const fallbackReason = classicActive ? engineSelection.fallback : null;
    const handleEditorError = useCallback(() => setEditorFailedKey(editorContentKey), [editorContentKey]);
    const retryEditor = useCallback(() => setEditorAttempt(attempt => attempt + 1), []);
    useEffect(() => {
        onDiffEngineChange?.(engineSelection.engine);
    }, [onDiffEngineChange, engineSelection.engine]);

    // ── UI state ──
    const [sidebarOpen, setSidebarOpen] = useState(false);
    const [popupState, setPopupState] = useState<PopupState>(null);
    const [activePopoverComment, setActivePopoverComment] = useState<AnyComment | null>(null);
    const [popoverPos, setPopoverPos] = useState<{ top: number; left: number } | null>(null);
    const viewerRef = useRef<UnifiedDiffViewerHandle>(null);
    const monacoViewerRef = useRef<MonacoFileDiffViewerHandle>(null);
    const scrollContainerRef = useRef<HTMLDivElement>(null);
    const [diffLines, setDiffLines] = useState<DiffLine[]>([]);

    useEffect(() => {
        setPopupState(null);
        setActivePopoverComment(null);
        setPopoverPos(null);
        setDiffLines([]);
    }, [workspaceId, source.cacheKey, filePath]);

    // ── In-diff find (Ctrl/Cmd+F) ──
    // Searches the FULL diff model so off-screen matches in virtualized files
    // (>500 lines) are reachable; the viewer's scrollLineIntoView handle drives
    // the virtualizer to bring the active match into view.
    const scrollActiveMatchIntoView = useCallback((lineIndex: number) => {
        viewerRef.current?.scrollLineIntoView(lineIndex);
    }, []);
    const find = useDiffFind(diffLines, scrollActiveMatchIntoView);
    useDiffFindShortcut(scrollContainerRef, find.openFind);

    // ── Comments ──
    const diffContext = source.commentContext(filePath);
    const {
        comments, loading: commentsLoading, addComment, deleteComment, updateComment,
        resolveComment, unresolveComment, runRelocation, askAI, aiLoadingIds, aiErrors,
        clearAiError, resolvingIds, deletingIds, copyAllCommentsAsPrompt,
        resolveWithAI, fixWithAI,
    } = useDiffComments(workspaceId, diffContext);

    // ── Cross-file navigation ──
    const [fetchedFiles, setFetchedFiles] = useState<string[]>([]);
    const sourceFiles = source.files;

    useEffect(() => {
        if (sourceFiles.length > 0 || !source.fetchFileList) return;
        let cancelled = false;
        source.fetchFileList()
            .then(files => { if (!cancelled) setFetchedFiles(files); })
            .catch(() => { if (!cancelled) setFetchedFiles([]); });
        return () => { cancelled = true; };
    }, [sourceFiles, source]);

    const allFiles = useMemo(
        () => sourceFiles.length > 0 ? sourceFiles : fetchedFiles,
        [sourceFiles, fetchedFiles],
    );
    const hunkNavRef: RefObject<HunkNavigationHandle | null> = showEditor ? monacoViewerRef : viewerRef;
    const { handleNext, handlePrev } = useCrossFileNav({
        filePath,
        files: allFiles,
        viewerRef: hunkNavRef,
        onNavigateToFile,
    });

    // ── AI chat (conditional on source) ──
    const showChat = source.chat !== null;
    const localChat = useCommitChatPresentation({
        workspaceId, commitHash: source.chat?.commitHash, supportsChat: showChat && !reviewChat,
    });
    const chat = reviewChat ?? localChat;
    const { chatOpen, toggleChat } = chat;

    // ── Auto-scroll to target hunk ──
    const hasScrolledRef = useRef(false);

    // Reset scroll guard on filePath change
    useEffect(() => {
        hasScrolledRef.current = false;
    }, [filePath]);

    useEffect(() => {
        if (!classicActive || !initialHunkTarget || !diff || loading || hasScrolledRef.current) return;
        hasScrolledRef.current = true;
        const timer = setTimeout(() => {
            const viewer = viewerRef.current;
            if (!viewer) return;
            const count = viewer.getHunkCount();
            if (count === 0) return;
            if (initialHunkTarget === 'first') {
                viewer.scrollToHunk(0);
            } else {
                viewer.scrollToHunk(count - 1);
            }
        }, 50);
        return () => clearTimeout(timer);
    }, [initialHunkTarget, diff, loading, classicActive]);

    // ── Handlers ──

    const handleAddComment = useCallback(
        (selection: DiffCommentSelection, selectedText: string, position: { top: number; left: number }) => {
            setPopupState({ position, selection, selectedText });
        },
        [],
    );

    const handleCommentClick = useCallback((comment: DiffComment, event: React.MouseEvent) => {
        const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
        setPopoverPos({ top: rect.bottom + 8, left: Math.max(8, rect.left) });
        setActivePopoverComment(comment);
    }, []);

    const handlePopupSubmit = useCallback(
        async (text: string, category: TaskCommentCategory) => {
            if (!popupState) return;
            await addComment(popupState.selection, popupState.selectedText, text, category);
            setPopupState(null);
        },
        [popupState, addComment],
    );

    const handleAskAI = useCallback(
        (id: string, commandId: string, customQuestion?: string) => {
            void askAI(id, { commandId, customQuestion });
        },
        [askAI],
    );

    const handleResolveAllWithAI = useCallback(() => {
        if (shouldSkipResolveDialog()) {
            void resolveWithAI();
            return;
        }
        const openCount = comments.filter(c => c.status === 'open').length;
        queueDispatch({
            type: 'OPEN_DIALOG',
            workspaceId,
            mode: 'resolve',
            resolveContext: {
                title: 'Resolve with AI',
                commentCount: openCount,
                onSubmit: (ctx: string, sk: string[]) => {
                    void resolveWithAI(ctx || undefined, sk.length > 0 ? sk : undefined);
                },
            },
        });
    }, [resolveWithAI, comments, queueDispatch, workspaceId]);

    const handleFixWithAI = useCallback((id: string) => {
        if (shouldSkipResolveDialog()) {
            void fixWithAI(id);
            return;
        }
        queueDispatch({
            type: 'OPEN_DIALOG',
            workspaceId,
            mode: 'resolve',
            resolveContext: {
                title: 'Fix with AI',
                commentCount: 1,
                onSubmit: (ctx: string, sk: string[]) => {
                    void fixWithAI(id, ctx || undefined, sk.length > 0 ? sk : undefined);
                },
            },
        });
    }, [fixWithAI, queueDispatch, workspaceId]);

    const handleAskAIDiff = useCallback(
        (selection: DiffCommentSelection, selectedText: string) => {
            const commitHash = source.chat?.commitHash;
            const contextStr = buildDiffContext({ selectedText, selection, commitHash, filePath });
            queueDispatch({
                type: 'OPEN_DIALOG',
                workspaceId,
                mode: 'ask',
                initialPrompt: contextStr,
                // When no embedded chat panel, use floating chat
                ...(showChat ? {} : { launchMode: 'floating-chat' }),
            });
        },
        [filePath, workspaceId, queueDispatch, source, showChat],
    );

    const handleCopyAsContext = useCallback(
        (selection: DiffCommentSelection, selectedText: string) => {
            const commitHash = source.chat?.commitHash;
            const contextStr = buildDiffContext({ selectedText, selection, commitHash, filePath });
            void copyToClipboard(contextStr);
        },
        [filePath, source],
    );

    const handleSidebarCommentClick = useCallback((comment: AnyComment) => {
        if (showEditor) {
            monacoViewerRef.current?.revealComment(comment.id);
            return;
        }
        const dc = comment as DiffComment;
        const lineIdx = dc.selection?.diffLineStart;
        if (lineIdx == null) return;
        const el = scrollContainerRef.current?.querySelector<HTMLElement>(
            `[data-diff-line-index="${lineIdx}"]`,
        );
        if (!el) return;
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        el.classList.add('ring-2', 'ring-yellow-400');
        setTimeout(() => el.classList.remove('ring-2', 'ring-yellow-400'), 1500);
    }, [showEditor]);

    const insertDraftIntoCurrentChat = useCurrentChatInsertDraft();
    const renderCommentThread = useCallback((comment: DiffComment) => (
        <CommentCard
            comment={comment}
            onResolve={() => { void resolveComment(comment.id); }}
            onUnresolve={() => { void unresolveComment(comment.id); }}
            onEdit={(text) => { void updateComment(comment.id, { comment: text }); }}
            onDelete={() => { void deleteComment(comment.id); }}
            onAskAI={(commandId, question) => handleAskAI(comment.id, commandId, question)}
            onFixWithAI={() => handleFixWithAI(comment.id)}
            onClick={() => undefined}
            aiLoading={aiLoadingIds.has(comment.id)}
            aiError={aiErrors.get(comment.id) ?? null}
            onClearAiError={() => clearAiError(comment.id)}
            isResolving={resolvingIds.has(comment.id)}
            isDeleting={deletingIds.has(comment.id)}
            getResolvePrompt={() => formatDiffCommentPrompt(comment)}
            onSendResolvePrompt={insertDraftIntoCurrentChat}
        />
    ), [resolveComment, unresolveComment, updateComment, deleteComment, handleAskAI, handleFixWithAI, aiLoadingIds, aiErrors, clearAiError, resolvingIds, deletingIds, insertDraftIntoCurrentChat]);

    // ── Ctrl/Cmd+click the path: open the file in its own right-panel tab ──
    const panelHost = useUnifiedPanelHost();
    const handlePathClick = useCallback((e: React.MouseEvent) => {
        if (!panelHost || !(e.ctrlKey || e.metaKey)) return;
        const input = explorerFileTabInput({ path: filePath }, {
            ownerWorkspaceId: workspaceId,
            scopeWorkspaceId: panelHost.workspaceId,
            chatId: panelHost.chatId,
        });
        if (!input) return;
        e.preventDefault();
        openUnifiedPanelTab(panelHost.workspaceId, input);
    }, [panelHost, filePath, workspaceId]);

    // ── Render ──

    return (
        <div className="file-diff-panel flex flex-col h-full overflow-hidden" data-testid="file-diff-panel">
            {/* ── Sticky header ── */}
            <div
                className="sticky top-0 z-10 px-4 py-2 border-b border-[#e0e0e0] dark:border-[#3c3c3c] bg-[#fafafa] dark:bg-[#252526] flex items-center justify-between"
                data-testid="file-diff-header"
            >
                <div className="flex items-center gap-2 min-w-0">
                    {onBack && (
                        <button
                            onClick={onBack}
                            className="text-xs text-[#0078d4] dark:text-[#3794ff] hover:underline flex-shrink-0"
                            data-testid={backTestId}
                        >
                            ← {backLabel}
                        </button>
                    )}
                    <span className="flex min-w-0" onClick={handlePathClick} data-testid="file-diff-path">
                        <TruncatedPath
                            path={filePath}
                            title={panelHost ? `${filePath}\nCtrl+click to open file` : undefined}
                            className="text-xs font-mono text-[#1e1e1e] dark:text-[#ccc] truncate"
                        />
                    </span>
                    {allFiles.length > 1 && (
                        <span
                            className="text-[10px] text-[#848484] flex-shrink-0"
                            data-testid="file-position-indicator"
                        >
                            {allFiles.indexOf(filePath) + 1}/{allFiles.length}
                        </span>
                    )}
                </div>
                <div className="flex items-center gap-2">
                    <HunkNavButtons onPrev={handlePrev} onNext={handleNext} />
                    <DiffEngineToggle engine={diffEngine} onChange={setDiffEngine} />
                    <DiffViewToggle mode={viewMode} onChange={setViewMode} />
                    {editorSides && <DiffWordWrapToggle />}
                    {classicActive && source.fullContextFileDiffUrl && (
                        <button
                            onClick={() => setFullContextMode(m => !m)}
                            title={fullContextMode ? 'Switch to hunk-only diff' : 'Show full-file context'}
                            className={
                                fullContextMode
                                    ? 'inline-flex h-6 items-center gap-1 rounded border border-[#0078d4] bg-[#ddeeff] px-2 text-[11px] font-medium text-[#005a9e] hover:bg-[#cce0ff] dark:border-[#3794ff] dark:bg-[#1e3a5f] dark:text-[#79c0ff] dark:hover:bg-[#1e4a7a]'
                                    : 'inline-flex h-6 items-center gap-1 rounded border border-gray-300 bg-white px-2 text-[11px] font-medium text-gray-600 hover:bg-gray-50 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700'
                            }
                            data-testid="full-context-toggle-btn"
                            aria-pressed={fullContextMode}
                        >
                            {fullContextMode ? '⊟ Full context' : '⊞ Full context'}
                        </button>
                    )}
                    {showSourceLabel && source.label && (
                        <span className="text-xs text-[#616161] dark:text-[#999] flex-shrink-0">
                            {source.label}
                        </span>
                    )}
                    {onToggleReviewed && (
                        <button
                            onClick={onToggleReviewed}
                            title={isReviewed ? 'Unmark reviewed' : 'Mark reviewed'}
                            className={
                                isReviewed
                                    ? 'inline-flex h-6 items-center gap-1 rounded border border-green-500 bg-green-50 px-2 text-[11px] font-medium text-green-700 hover:bg-green-100 dark:border-green-500 dark:bg-green-900/30 dark:text-green-200 dark:hover:bg-green-900/50'
                                    : 'inline-flex h-6 items-center gap-1 rounded border border-gray-300 bg-white px-2 text-[11px] font-medium text-gray-600 hover:bg-gray-50 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700'
                            }
                            data-testid="mark-reviewed-btn"
                            aria-pressed={!!isReviewed}
                        >
                            {isReviewed ? '✓ Reviewed' : 'Mark reviewed'}
                        </button>
                    )}
                    <button
                        onClick={() => setSidebarOpen(o => !o)}
                        title="Toggle comments"
                        className="text-xs px-2 py-0.5 rounded hover:bg-black/[0.06] dark:hover:bg-white/[0.08]"
                        data-testid="toggle-comments-btn"
                    >
                        💬 {comments.length > 0 ? comments.length : ''}
                    </button>
                    {showChat && (
                        <button
                            onClick={toggleChat}
                            title="Toggle AI chat"
                            className="text-xs px-2 py-0.5 rounded hover:bg-black/[0.06] dark:hover:bg-white/[0.08]"
                            aria-pressed={chatOpen}
                            data-testid="toggle-chat-btn"
                        >
                            🤖
                        </button>
                    )}
                    {headerActions}
                </div>
            </div>

            {/* ── Main content area ── */}
            <div className="relative flex flex-1 min-h-0">
                {/* ── In-diff find widget (Ctrl/Cmd+F) ── */}
                {classicActive && find.open && diff && !loading && !error && (
                    <DiffFindWidget
                        query={find.query}
                        caseSensitive={find.caseSensitive}
                        matchCount={find.matchCount}
                        activeIndex={find.activeIndex}
                        onQueryChange={find.setQuery}
                        onToggleCaseSensitive={find.toggleCaseSensitive}
                        onNext={find.goToNext}
                        onPrev={find.goToPrev}
                        onClose={find.closeFind}
                    />
                )}
                {/* ── Diff scroll container ── */}
                <div
                    ref={scrollContainerRef}
                    className="flex-1 overflow-auto px-1 py-1 outline-none"
                    data-testid="file-diff-section"
                    tabIndex={-1}
                >
                    {fallbackReason && (
                        <DiffEngineFallbackBanner reason={fallbackReason} onRetry={retryEditor} />
                    )}
                    {displayedEditor && (
                        <div hidden={!showEditor} className="h-full" aria-hidden={!showEditor}>
                            <MonacoFileDiffViewer
                                key={editorAttempt}
                                ref={monacoViewerRef}
                                workspaceId={workspaceId}
                                relativePath={displayedEditor.filePath}
                                stage={displayedEditor.supportsWorkingCopyLanguage ? 'branch-range' : 'staged'}
                                modelIdentity={`${displayedEditor.cacheKey}\u0000${displayedEditor.content.base.ref}\u0000${displayedEditor.content.head.ref}`}
                                modifiedMatchesWorkingCopy={displayedEditor.content.modifiedMatchesWorkingCopy}
                                original={displayedEditor.content.base.content}
                                modified={displayedEditor.content.head.content}
                                viewMode={viewMode}
                                initialHunkTarget={initialHunkTarget}
                                onLinesReady={showEditor ? (lines) => { setDiffLines(lines); runRelocation(lines); } : undefined}
                                comments={showEditor ? comments : []}
                                renderCommentThread={renderCommentThread}
                                onAddComment={handleAddComment}
                                onAskAI={handleAskAIDiff}
                                onCopyAsContext={handleCopyAsContext}
                                diffSelectionDragSource={showEditor ? diffSelectionDragSource : undefined}
                                languageFeatures={showEditor && displayedEditor.supportsWorkingCopyLanguage === true && displayedEditor.content.modifiedMatchesWorkingCopy === true}
                                onEditorError={handleEditorError}
                                createEditor={createDiffEditor}
                                data-testid="file-diff-editor"
                            />

                        </div>
                    )}
                    {showEditor ? null : editorLoading ? (
                        <div className="flex items-center gap-2 text-xs text-[#848484]" data-testid="file-diff-editor-loading">
                            <Spinner size="sm" /> Loading file content...
                        </div>
                    ) : loading ? (
                        <div className="flex items-center gap-2 text-xs text-[#848484]" data-testid="file-diff-loading">
                            <Spinner size="sm" /> Loading diff...
                        </div>
                    ) : error ? (
                        <div className="flex items-center gap-2" data-testid="file-diff-error">
                            <span className="text-xs text-[#d32f2f] dark:text-[#f48771]">{error}</span>
                            <Button
                                variant="secondary"
                                size="sm"
                                onClick={retry}
                                data-testid="file-diff-retry-btn"
                            >
                                Retry
                            </Button>
                        </div>
                    ) : diff ? (
                        <>
                            {viewMode === 'split' ? (
                                <SideBySideDiffViewer
                                    ref={viewerRef}
                                    diff={diff}
                                    fileName={filePath}
                                    enableComments
                                    showLineNumbers
                                    comments={comments}
                                    onLinesReady={(lines) => { setDiffLines(lines); runRelocation(lines); }}
                                    onAddComment={handleAddComment}
                                    onAskAI={handleAskAIDiff}
                                    onCopyAsContext={handleCopyAsContext}
                                    onCommentClick={handleCommentClick}
                                    matchRangesByLine={find.matchRangesByLine}
                                    diffSelectionDragSource={diffSelectionDragSource}
                                    data-testid="file-diff-content"
                                />
                            ) : (
                                <UnifiedDiffViewer
                                    ref={viewerRef}
                                    diff={diff}
                                    fileName={filePath}
                                    enableComments
                                    showLineNumbers
                                    /* The header already names the file, so the
                                       raw git preamble is dropped (split mode
                                       drops it too). */
                                    hideFileHeaders
                                    comments={comments}
                                    onLinesReady={(lines) => { setDiffLines(lines); runRelocation(lines); }}
                                    onAddComment={handleAddComment}
                                    onAskAI={handleAskAIDiff}
                                    onCopyAsContext={handleCopyAsContext}
                                    onCommentClick={handleCommentClick}
                                    filePath={filePath}
                                    getHunkClassification={getHunkClassification}
                                    activeFilters={hunkActiveFilters}
                                    matchRangesByLine={find.matchRangesByLine}
                                    diffSelectionDragSource={diffSelectionDragSource}
                                    data-testid="file-diff-content"
                                />
                            )}
                            {truncated && classicActive && (
                                <div
                                    className="flex items-center gap-2 px-4 py-2 text-xs bg-[#fff3cd] dark:bg-[#3a3000] border-t border-[#e0e0e0] dark:border-[#3c3c3c]"
                                    data-testid="diff-truncation-banner"
                                >
                                    <span>
                                        Diff truncated (showing first 5,000 of{' '}
                                        {totalLines.toLocaleString()} lines).
                                    </span>
                                    <button
                                        className="text-[#0366d6] dark:text-[#58a6ff] underline hover:no-underline font-medium"
                                        onClick={requestFullDiff}
                                        data-testid="load-full-diff-btn"
                                    >
                                        Load full diff
                                    </button>
                                </div>
                            )}
                            {fullContextUnavailable && classicActive && (
                                <div
                                    className="flex items-center gap-2 px-4 py-2 text-xs bg-[#fff3cd] dark:bg-[#3a3000] border-t border-[#e0e0e0] dark:border-[#3c3c3c]"
                                    data-testid="full-context-unavailable-banner"
                                >
                                    <span>
                                        Full-file context unavailable for this file after trying to load the PR commits. Showing hunk diff instead.
                                    </span>
                                </div>
                            )}
                        </>
                    ) : (
                        <div className="text-xs text-[#848484]" data-testid="file-diff-empty">
                            (empty diff)
                        </div>
                    )}
                </div>

                {/* ── DiffMiniMap ── */}
                {diff && !loading && !error && classicActive && (
                    <DiffMiniMap diffLines={diffLines} scrollContainerRef={scrollContainerRef} />
                )}

                {/* ── Comment sidebar ── */}
                {sidebarOpen && (
                    <CommentSidebar
                        taskId={workspaceId}
                        filePath={filePath}
                        comments={comments}
                        loading={commentsLoading}
                        onResolve={(id) => { void resolveComment(id); }}
                        onUnresolve={(id) => { void unresolveComment(id); }}
                        onDelete={(id) => { void deleteComment(id); }}
                        onEdit={(id, text) => { void updateComment(id, { comment: text }); }}
                        onAskAI={handleAskAI}
                        onResolveAllWithAI={handleResolveAllWithAI}
                        onFixWithAI={handleFixWithAI}
                        onCommentClick={handleSidebarCommentClick}
                        aiLoadingIds={aiLoadingIds}
                        aiErrors={aiErrors}
                        onClearAiError={clearAiError}
                        resolvingIds={resolvingIds}
                        deletingIds={deletingIds}
                        onCopyPrompt={copyAllCommentsAsPrompt}
                        onClose={() => setSidebarOpen(false)}
                        data-testid="diff-comment-sidebar"
                    />
                )}

                {!reviewChat && source.chat && <CommitReviewChat
                    workspaceId={source.chat.workspaceId}
                    hash={source.chat.commitHash}
                    commitMessage={source.chat.commitMessage}
                    chat={chat}
                />}

            </div>

            {/* ── Overlays ── */}
            {popupState && (
                <InlineCommentPopup
                    position={popupState.position}
                    onSubmit={handlePopupSubmit}
                    onCancel={() => setPopupState(null)}
                />
            )}
            {activePopoverComment && popoverPos && (
                <CommentPopover
                    comment={activePopoverComment}
                    position={popoverPos}
                    onClose={() => setActivePopoverComment(null)}
                    onResolve={(id) => { void resolveComment(id); }}
                    onUnresolve={(id) => { void unresolveComment(id); }}
                    onDelete={(id) => { void deleteComment(id); setActivePopoverComment(null); }}
                    onEdit={(id, text) => { void updateComment(id, { comment: text }); }}
                    onAskAI={handleAskAI}
                    aiLoading={aiLoadingIds.has(activePopoverComment.id)}
                    aiError={aiErrors.get(activePopoverComment.id) ?? null}
                    onClearAiError={clearAiError}
                    isResolving={resolvingIds.has(activePopoverComment.id)}
                    isDeleting={deletingIds.has(activePopoverComment.id)}
                />
            )}
        </div>
    );
}
