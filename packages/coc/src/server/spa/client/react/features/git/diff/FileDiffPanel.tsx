/**
 * FileDiffPanel — unified single-file diff viewer.
 *
 * Replaces the duplicated rendering logic in BranchFileDiff and CommitDetail's
 * per-file view. Driven by a DiffSource strategy that encapsulates all
 * mode-specific behavior (URL building, comment context, AI chat support).
 */

import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { Spinner, Button, TruncatedPath } from '../../../ui';
import { UnifiedDiffViewer, HunkNavButtons } from './UnifiedDiffViewer';
import type { UnifiedDiffViewerHandle, DiffLine } from './UnifiedDiffViewer';
import { SideBySideDiffViewer } from './SideBySideDiffViewer';
import { useDiffViewMode } from '../hooks/useDiffViewMode';
import { DiffViewToggle } from './DiffViewToggle';
import { DiffMiniMap } from './DiffMiniMap';
import { useDiffComments } from '../hooks/useDiffComments';
import { CommentSidebar } from '../../../tasks/comments/CommentSidebar';
import { CommentPopover } from '../../../tasks/comments/CommentPopover';
import { InlineCommentPopup } from '../../../tasks/comments/InlineCommentPopup';
import { useQueue } from '../../../contexts/QueueContext';
import { useCrossFileNav } from '../hooks/useCrossFileNav';
import { shouldSkipResolveDialog } from '../../../shared/ResolveContextDialog';
import { buildDiffContext } from '../../../../comments/diff-context-utils';
import { copyToClipboard } from '../../../utils/format';
import { CommitChatPanel } from '../commits/CommitChatPanel';
import { useResizablePanel } from '../../../hooks/ui/useResizablePanel';
import { useFileDiff } from '../hooks/useFileDiff';
import type { DiffSource } from './diffSource';
import type { DiffCommentSelection, DiffComment } from '../../../../comments/diff-comment-types';
import type { AnyComment } from '../../../../comments/shared-comment-types';
import type { TaskCommentCategory } from '../../../../comments/task-comments-types';

export interface FileDiffPanelProps {
    workspaceId: string;
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
}

type PopupState = {
    position: { top: number; left: number };
    selection: DiffCommentSelection;
    selectedText: string;
} | null;

export function FileDiffPanel({
    workspaceId,
    filePath,
    source,
    onNavigateToFile,
    initialHunkTarget,
    onBack,
    backLabel = 'All files',
    backTestId = 'file-diff-back-btn',
    showSourceLabel = true,
}: FileDiffPanelProps) {
    const { dispatch: queueDispatch } = useQueue();

    // ── Diff fetching ──
    const diffUrl = source.fileDiffUrl(filePath);
    const fullDiffUrl = source.supportsTruncation ? source.fileDiffUrl(filePath, true) : null;
    const { diff, loading, error, retry, truncated, totalLines, requestFullDiff } =
        useFileDiff(diffUrl, fullDiffUrl);

    // ── View mode ──
    const [viewMode, setViewMode] = useDiffViewMode();

    // ── UI state ──
    const [sidebarOpen, setSidebarOpen] = useState(false);
    const [popupState, setPopupState] = useState<PopupState>(null);
    const [activePopoverComment, setActivePopoverComment] = useState<AnyComment | null>(null);
    const [popoverPos, setPopoverPos] = useState<{ top: number; left: number } | null>(null);
    const viewerRef = useRef<UnifiedDiffViewerHandle>(null);
    const scrollContainerRef = useRef<HTMLDivElement>(null);
    const [diffLines, setDiffLines] = useState<DiffLine[]>([]);

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
    const { handleNext, handlePrev } = useCrossFileNav({
        filePath,
        files: allFiles,
        viewerRef,
        onNavigateToFile,
    });

    // ── AI chat (conditional on source) ──
    const showChat = source.chat !== null;
    const [chatOpen, setChatOpen] = useState(() =>
        showChat ? localStorage.getItem('coc.commitChat.open') === 'true' : false,
    );
    const toggleChat = useCallback(() => {
        setChatOpen(prev => {
            const next = !prev;
            try { localStorage.setItem('coc.commitChat.open', String(next)); } catch { /* ignore */ }
            return next;
        });
    }, []);
    const chatResize = useResizablePanel({
        initialWidth: 360,
        minWidth: 200,
        maxWidth: 600,
        storageKey: 'coc.commitChatPanel.width',
        direction: 'right',
    });

    // ── Auto-scroll to target hunk ──
    const hasScrolledRef = useRef(false);

    // Reset scroll guard on filePath change
    useEffect(() => {
        hasScrolledRef.current = false;
    }, [filePath]);

    useEffect(() => {
        if (!initialHunkTarget || !diff || loading || hasScrolledRef.current) return;
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
    }, [initialHunkTarget, diff, loading]);

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
    }, []);

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
                    <TruncatedPath
                        path={filePath}
                        className="text-xs font-mono text-[#1e1e1e] dark:text-[#ccc] truncate"
                    />
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
                    <DiffViewToggle mode={viewMode} onChange={setViewMode} />
                    {showSourceLabel && source.label && (
                        <span className="text-xs text-[#616161] dark:text-[#999] flex-shrink-0">
                            {source.label}
                        </span>
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
                            data-testid="toggle-chat-btn"
                        >
                            🤖
                        </button>
                    )}
                </div>
            </div>

            {/* ── Main content area ── */}
            <div className="flex flex-1 min-h-0">
                {/* ── Diff scroll container ── */}
                <div
                    ref={scrollContainerRef}
                    className="flex-1 overflow-auto px-1 py-1"
                    data-testid="file-diff-section"
                >
                    {loading ? (
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
                                    data-testid="file-diff-content"
                                />
                            ) : (
                                <UnifiedDiffViewer
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
                                    data-testid="file-diff-content"
                                />
                            )}
                            {truncated && (
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
                        </>
                    ) : (
                        <div className="text-xs text-[#848484]" data-testid="file-diff-empty">
                            (empty diff)
                        </div>
                    )}
                </div>

                {/* ── DiffMiniMap ── */}
                {diff && !loading && !error && (
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

                {/* ── AI Chat panel (commit mode only) ── */}
                {showChat && chatOpen && (() => {
                    const chat = source.chat;
                    return chat ? (
                        <>
                            <div
                                className="hidden lg:flex items-center justify-center w-1 cursor-col-resize hover:bg-[#007acc]/30 active:bg-[#007acc]/50 bg-[#e0e0e0] dark:bg-[#3c3c3c] shrink-0"
                                onMouseDown={chatResize.handleMouseDown}
                                onTouchStart={chatResize.handleTouchStart}
                                role="separator"
                                aria-label="Resize chat panel"
                            />
                            <div style={{ width: chatResize.width }} className="shrink-0 h-full">
                                <CommitChatPanel
                                    workspaceId={chat.workspaceId}
                                    commitHash={chat.commitHash}
                                    commitMessage={chat.commitMessage}
                                    onClose={toggleChat}
                                />
                            </div>
                        </>
                    ) : null;
                })()}
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
