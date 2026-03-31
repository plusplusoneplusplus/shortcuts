/**
 * BranchFileDiff — right-panel detail view for a single branch file's diff.
 *
 * Mirrors the CommitDetail structure: header bar + unified diff with
 * loading/error/retry states. Fetches the diff for a single file from
 * the branch-range endpoint on mount.
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { fetchApi } from '../hooks/useApi';
import { Spinner, Button, TruncatedPath } from '../shared';
import { UnifiedDiffViewer, HunkNavButtons } from './UnifiedDiffViewer';
import type { UnifiedDiffViewerHandle, DiffLine } from './UnifiedDiffViewer';
import { SideBySideDiffViewer } from './SideBySideDiffViewer';
import { useDiffViewMode } from '../hooks/useDiffViewMode';
import { DiffViewToggle } from './DiffViewToggle';
import { DiffMiniMap } from './DiffMiniMap';
import { useDiffComments } from '../hooks/useDiffComments';
import { CommentSidebar } from '../tasks/comments/CommentSidebar';
import { CommentPopover } from '../tasks/comments/CommentPopover';
import { InlineCommentPopup } from '../tasks/comments/InlineCommentPopup';
import { useQueue } from '../context/QueueContext';
import { useCrossFileNav } from './useCrossFileNav';
import type { DiffCommentSelection, DiffComment } from '../../diff-comment-types';
import type { AnyComment } from '../../shared-comment-types';
import type { TaskCommentCategory } from '../../task-comments-types';

export interface BranchFileDiffProps {
    workspaceId: string;
    filePath: string;
    /** Ordered file paths for the branch range (enables cross-file hunk nav). */
    branchFiles?: string[];
    /** Called when cross-file navigation requests switching to a different file. */
    onNavigateToFile?: (filePath: string, hunkTarget: 'first' | 'last') => void;
    /** When set, auto-scrolls to the first or last hunk after the diff loads. */
    initialHunkTarget?: 'first' | 'last';
}

type PopupState = {
    position: { top: number; left: number };
    selection: DiffCommentSelection;
    selectedText: string;
} | null;

export function BranchFileDiff({ workspaceId, filePath, branchFiles, onNavigateToFile, initialHunkTarget }: BranchFileDiffProps) {
    const { dispatch: queueDispatch } = useQueue();
    const [diff, setDiff] = useState<string | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [truncated, setTruncated] = useState(false);
    const [totalLines, setTotalLines] = useState(0);
    const [fullRequested, setFullRequested] = useState(false);
    const [sidebarOpen, setSidebarOpen] = useState(false);
    const [popupState, setPopupState] = useState<PopupState>(null);
    const [activePopoverComment, setActivePopoverComment] = useState<AnyComment | null>(null);
    const [popoverPos, setPopoverPos] = useState<{ top: number; left: number } | null>(null);
    const viewerRef = useRef<UnifiedDiffViewerHandle>(null);
    const scrollContainerRef = useRef<HTMLDivElement>(null);
    const [diffLines, setDiffLines] = useState<DiffLine[]>([]);
    const [viewMode, setViewMode] = useDiffViewMode();

    const { handleNext, handlePrev } = useCrossFileNav({
        filePath,
        files: branchFiles ?? [],
        viewerRef,
        onNavigateToFile,
    });

    // Auto-scroll to target hunk after diff loads (for cross-file navigation)
    const hasScrolledRef = useRef(false);
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

    const diffContext = { repositoryId: workspaceId, filePath, oldRef: 'branch-base', newRef: 'branch-head' };

    const { comments, loading: commentsLoading, addComment, deleteComment, updateComment,
            resolveComment, unresolveComment, runRelocation, askAI, aiLoadingIds, aiErrors,
            clearAiError, resolvingIds, deletingIds, copyAllCommentsAsPrompt,
            resolveWithAI, fixWithAI } = useDiffComments(workspaceId, diffContext);

    const fetchDiff = useCallback((full = false) => {
        setLoading(true);
        setError(null);
        setDiff(null);
        const suffix = full ? '?full=true' : '';
        fetchApi(
            `/workspaces/${encodeURIComponent(workspaceId)}/git/branch-range/files/${encodeURIComponent(filePath)}/diff${suffix}`
        )
            .then(data => {
                setDiff(data.diff ?? '');
                setTruncated(!!data.truncated);
                setTotalLines(data.totalLines ?? 0);
            })
            .catch(err => setError(err.message || 'Failed to load diff'))
            .finally(() => setLoading(false));
    }, [workspaceId, filePath]);

    useEffect(() => {
        setFullRequested(false);
        fetchDiff();
    }, [fetchDiff]);

    useEffect(() => {
        if (fullRequested) fetchDiff(true);
    }, [fullRequested, fetchDiff]);

    const handleRetry = useCallback(() => {
        fetchDiff();
    }, [fetchDiff]);

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
        void resolveWithAI();
    }, [resolveWithAI]);

    const handleFixWithAI = useCallback((id: string) => {
        void fixWithAI(id);
    }, [fixWithAI]);

    const handleAskAIDiff = useCallback(
        (selection: DiffCommentSelection, selectedText: string) => {
            const lineRange = (selection.newLineStart && selection.newLineEnd)
                ? `${selection.newLineStart}-${selection.newLineEnd}`
                : `${selection.diffLineStart}-${selection.diffLineEnd}`;
            const contextStr = [
                'Context from code review:',
                `- File: ${filePath}`,
                `- Lines ${lineRange}:`,
                '```',
                selectedText,
                '```',
                '',
                '',
            ].join('\n');
            queueDispatch({ type: 'OPEN_DIALOG', workspaceId, mode: 'ask', initialPrompt: contextStr, launchMode: 'floating-chat' });
        },
        [filePath, workspaceId, queueDispatch],
    );

    const handleSidebarCommentClick = useCallback((comment: AnyComment) => {
        const dc = comment as DiffComment;
        const lineIdx = dc.selection?.diffLineStart;
        if (lineIdx == null) return;
        const el = scrollContainerRef.current?.querySelector<HTMLElement>(`[data-diff-line-index="${lineIdx}"]`);
        if (!el) return;
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        el.classList.add('ring-2', 'ring-yellow-400');
        setTimeout(() => el.classList.remove('ring-2', 'ring-yellow-400'), 1500);
    }, []);

    return (
        <div className="branch-file-diff flex flex-col h-full overflow-hidden" data-testid="branch-file-diff">
            {/* Header bar */}
            <div className="px-4 py-3 border-b border-[#e0e0e0] dark:border-[#3c3c3c] bg-[#fafafa] dark:bg-[#252526]" data-testid="branch-file-diff-header">
                <div className="flex items-center gap-2">
                    <TruncatedPath path={filePath} className="text-sm font-semibold text-[#1e1e1e] dark:text-[#ccc] flex-1" />
                    <HunkNavButtons onPrev={handlePrev} onNext={handleNext} />
                    <DiffViewToggle mode={viewMode} onChange={setViewMode} />
                    <span className="text-xs text-[#616161] dark:text-[#999] flex-shrink-0">Branch diff</span>
                    <button
                        onClick={() => setSidebarOpen(o => !o)}
                        title="Toggle comments"
                        className="text-xs px-2 py-0.5 rounded hover:bg-black/[0.06] dark:hover:bg-white/[0.08]"
                        data-testid="toggle-comments-btn"
                    >
                        💬 {comments.length > 0 ? comments.length : ''}
                    </button>
                </div>
            </div>

            {/* Diff view + sidebar */}
            <div className="flex flex-1 min-h-0">
                <div ref={scrollContainerRef} className="flex-1 overflow-auto px-1 py-1" data-testid="branch-file-diff-section">
                    {loading ? (
                        <div className="flex items-center gap-2 text-xs text-[#848484]" data-testid="branch-file-diff-loading">
                            <Spinner size="sm" /> Loading diff...
                        </div>
                    ) : error ? (
                        <div className="flex items-center gap-2" data-testid="branch-file-diff-error">
                            <span className="text-xs text-[#d32f2f] dark:text-[#f48771]">{error}</span>
                            <Button variant="secondary" size="sm" onClick={handleRetry} data-testid="branch-file-diff-retry-btn">Retry</Button>
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
                                    onCommentClick={handleCommentClick}
                                    data-testid="branch-file-diff-content"
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
                                    onCommentClick={handleCommentClick}
                                    data-testid="branch-file-diff-content"
                                />
                            )}
                            {truncated && !fullRequested && (
                                <div className="flex items-center gap-2 px-4 py-2 text-xs bg-[#fff3cd] dark:bg-[#3a3000] border-t border-[#e0e0e0] dark:border-[#3c3c3c]" data-testid="diff-truncation-banner">
                                    <span>Diff truncated (showing first 5,000 of {totalLines.toLocaleString()} lines).</span>
                                    <button
                                        className="text-[#0366d6] dark:text-[#58a6ff] underline hover:no-underline font-medium"
                                        onClick={() => setFullRequested(true)}
                                        data-testid="load-full-diff-btn"
                                    >
                                        Load full diff
                                    </button>
                                </div>
                            )}
                        </>
                    ) : (
                        <div className="text-xs text-[#848484]" data-testid="branch-file-diff-empty">(empty diff)</div>
                    )}
                </div>
                {diff && !loading && !error && (
                    <DiffMiniMap diffLines={diffLines} scrollContainerRef={scrollContainerRef} />
                )}

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
                        data-testid="diff-comment-sidebar"
                    />
                )}
            </div>

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
