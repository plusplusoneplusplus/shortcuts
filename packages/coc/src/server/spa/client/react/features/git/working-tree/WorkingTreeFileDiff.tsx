/**
 * WorkingTreeFileDiff — right-panel detail view for a working-tree file diff.
 *
 * Fetches staged or unstaged diff for a single file via
 * GET /api/workspaces/:id/git/changes/files/<path>/diff?stage=<stage>
 * and renders it in UnifiedDiffViewer. Untracked files show a placeholder.
 *
 * When the diff-engine preference is `monaco`, both full-text sides come from
 * GET .../changes/files/<path>/content?stage=<stage> and render in
 * MonacoFileDiffViewer, with comment threads portalled into editor view zones.
 * Binary, oversized or unloadable content, or an editor
 * that fails to start, falls back to the classic viewer with a visible reason
 * (see diffEngineResolution).
 */

import { useState, useEffect, useCallback, useRef, useMemo, type RefObject } from 'react';
import type { GitWorkingTreeFileContentResponse } from '@plusplusoneplusplus/coc-client';
import { useCocClient } from '../../../repos/cloneRouting';
import { Spinner, Button, TruncatedPath } from '../../../ui';
import { UnifiedDiffViewer, HunkNavButtons } from '../diff/UnifiedDiffViewer';
import type { UnifiedDiffViewerHandle, DiffLine } from '../diff/UnifiedDiffViewer';
import type { DiffSelectionDragSource } from '../diff/diffSelectionContext';
import { SideBySideDiffViewer } from '../diff/SideBySideDiffViewer';
import { useDiffViewMode } from '../hooks/useDiffViewMode';
import { DiffViewToggle, DiffEngineToggle } from '../diff/DiffViewToggle';
import { DiffEngineFallbackBanner } from '../diff/DiffEngineFallbackBanner';
import { resolveDiffEngineSelection, type DiffContentLoadState } from '../diff/diffEngineResolution';
import { useDiffEngine } from '../hooks/useDiffEngine';
import { MonacoFileDiffViewer, type MonacoFileDiffViewerHandle } from '../diff/MonacoFileDiffViewer';
import type { DiffEditorFactory } from '../diff/monacoDiffEditorAdapter';
import { DiffMiniMap } from '../diff/DiffMiniMap';
import { useDiffComments } from '../hooks/useDiffComments';
import { CommentSidebar } from '../../../tasks/comments/CommentSidebar';
import { CommentPopover } from '../../../tasks/comments/CommentPopover';
import { CommentCard } from '../../../tasks/comments/CommentCard';
import { InlineCommentPopup } from '../../../tasks/comments/InlineCommentPopup';
import { useQueue } from '../../../contexts/QueueContext';
import { useCrossFileNav, type HunkNavigationHandle } from '../hooks/useCrossFileNav';
import { PreviewPane } from '../../repo-detail/explorer';
import { repoRelative } from './WorkingTree';
import { buildDiffContext } from '../../../../comments/diff-context-utils';
import { copyToClipboard } from '../../../utils/format';
import type { DiffCommentSelection, DiffComment } from '../../../../comments/diff-comment-types';
import type { AnyComment } from '../../../../comments/shared-comment-types';
import type { TaskCommentCategory } from '../../../../comments/task-comments-types';

export interface WorkingTreeFileDiffProps {
    workspaceId: string;
    filePath: string;
    stage: 'staged' | 'unstaged' | 'untracked';
    /** Workspace repo root; used to convert the absolute `filePath` to a
     * repo-relative path for the untracked-file preview. */
    repoRoot?: string;
    /** Ordered file paths for the working tree (enables cross-file hunk nav). */
    workingTreeFiles?: string[];
    /** Called when cross-file navigation requests switching to a different file. */
    onNavigateToFile?: (filePath: string, hunkTarget: 'first' | 'last') => void;
    /** When set, auto-scrolls to the first or last hunk after the diff loads. */
    initialHunkTarget?: 'first' | 'last';
    /**
     * Called once when the untracked file turns out to no longer exist on disk
     * (the working-tree list was stale). Lets the owner refresh the change list
     * so the ghost entry disappears.
     */
    onFileMissing?: () => void;
    /** Monaco diff editor factory; tests pass an owned adapter. */
    createDiffEditor?: DiffEditorFactory;
}

const STAGE_LABEL: Record<string, string> = {
    staged: 'Staged diff',
    unstaged: 'Unstaged diff',
    untracked: 'Untracked file',
};

type PopupState = {
    position: { top: number; left: number };
    selection: DiffCommentSelection;
    selectedText: string;
} | null;

/** Both file sides for the Monaco engine, keyed by the request that loaded them. */
type EditorContentState =
    | { key: string; status: 'loading' }
    | { key: string; status: 'loaded'; content: GitWorkingTreeFileContentResponse }
    | { key: string; status: 'failed' };

export function WorkingTreeFileDiff({ workspaceId, filePath, stage, repoRoot, workingTreeFiles, onNavigateToFile, initialHunkTarget, onFileMissing, createDiffEditor }: WorkingTreeFileDiffProps) {
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
    const [diffEngine, setDiffEngine] = useDiffEngine();
    const monacoViewerRef = useRef<MonacoFileDiffViewerHandle>(null);
    const [editorContent, setEditorContent] = useState<EditorContentState | null>(null);
    // Bumped by the fallback Retry button: re-fetches content and re-mounts the editor.
    const [editorAttempt, setEditorAttempt] = useState(0);
    // Key of the file + attempt whose editor failed. Sticky, so a failing file
    // stays on the classic viewer instead of re-mounting the editor on every render.
    const [editorFailedKey, setEditorFailedKey] = useState<string | null>(null);
    // The untracked file vanished from disk after the change list was fetched.
    const [fileMissing, setFileMissing] = useState(false);
    const fileMissingNotifiedRef = useRef(false);

    const handlePreviewNotFound = useCallback(() => {
        setFileMissing(true);
        if (fileMissingNotifiedRef.current) return;
        fileMissingNotifiedRef.current = true;
        onFileMissing?.();
    }, [onFileMissing]);

    // Route this file's diff fetch to the selected clone's server (AC-07).
    const cloneClient = useCocClient(workspaceId);

    // Monaco engine: load both full-text sides for this file and stage.
    const wantsEditor = diffEngine === 'monaco' && stage !== 'untracked';
    const contentKey = `${workspaceId}\u0000${stage}\u0000${filePath}\u0000${editorAttempt}`;
    useEffect(() => {
        if (!wantsEditor) return;
        let cancelled = false;
        setEditorContent({ key: contentKey, status: 'loading' });
        cloneClient.git.getWorkingTreeFileContent(workspaceId, filePath, stage as 'staged' | 'unstaged')
            .then(content => { if (!cancelled) setEditorContent({ key: contentKey, status: 'loaded', content }); })
            .catch(() => { if (!cancelled) setEditorContent({ key: contentKey, status: 'failed' }); });
        return () => { cancelled = true; };
    }, [wantsEditor, contentKey, workspaceId, filePath, stage, cloneClient]);

    const currentContent = editorContent?.key === contentKey ? editorContent : null;
    const contentLoadState: DiffContentLoadState | null = !currentContent ? null
        : currentContent.status === 'loaded'
            ? { status: 'loaded', binary: currentContent.content.binary, tooLarge: currentContent.content.tooLarge }
            : { status: currentContent.status };
    const engineSelection = resolveDiffEngineSelection({
        preference: diffEngine,
        stage,
        content: contentLoadState,
        editorFailed: editorFailedKey === contentKey,
    });
    const editorLoading = engineSelection.engine === 'loading';
    const editorSides = engineSelection.engine === 'monaco' && currentContent?.status === 'loaded'
        ? currentContent.content
        : null;
    const showEditor = editorSides !== null;
    // Classic renders for the legacy engine and when the editor cannot show this file.
    const classicActive = engineSelection.engine === 'legacy';
    const fallbackReason = engineSelection.engine === 'legacy' ? engineSelection.fallback : null;

    const handleEditorError = useCallback(() => setEditorFailedKey(contentKey), [contentKey]);
    const retryEditor = useCallback(() => setEditorAttempt(a => a + 1), []);

    const hunkNavRef: RefObject<HunkNavigationHandle | null> = showEditor ? monacoViewerRef : viewerRef;
    const { handleNext, handlePrev } = useCrossFileNav({
        filePath,
        files: workingTreeFiles ?? [],
        viewerRef: hunkNavRef,
        onNavigateToFile,
    });

    // Auto-scroll to target hunk after diff loads (for cross-file navigation)
    const hasScrolledRef = useRef(false);
    useEffect(() => {
        // The Monaco viewer applies initialHunkTarget itself once its diff is computed.
        if (!initialHunkTarget || !diff || loading || !classicActive || hasScrolledRef.current) return;
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

    const diffSelectionDragSource = useMemo<DiffSelectionDragSource>(
        () => ({ workspaceId, filePath, ref: stage === 'staged' ? { type: 'staged' } : { type: 'working-tree' } }),
        [workspaceId, filePath, stage],
    );

    const diffContext = stage !== 'untracked'
        ? { repositoryId: workspaceId, filePath, oldRef: stage === 'staged' ? 'HEAD' : 'INDEX', newRef: 'working-tree' as const }
        : null;

    const { comments, loading: commentsLoading, addComment, deleteComment, updateComment,
            resolveComment, unresolveComment, runRelocation, askAI, aiLoadingIds, aiErrors,
            clearAiError, resolvingIds, deletingIds, copyAllCommentsAsPrompt } = useDiffComments(workspaceId, diffContext);

    const fetchDiff = useCallback((full = false) => {
        if (stage === 'untracked') {
            setLoading(false);
            setDiff(null);
            setError(null);
            return;
        }
        setLoading(true);
        setError(null);
        setDiff(null);
        cloneClient.git.getWorkingTreeFileDiff(workspaceId, filePath, { stage, full })
            .then(data => {
                setDiff(data.diff ?? '');
                setTruncated(!!data.truncated);
                setTotalLines(data.totalLines ?? 0);
            })
            .catch(err => setError(err.message || 'Failed to load diff'))
            .finally(() => setLoading(false));
    }, [workspaceId, filePath, stage, cloneClient]);

    useEffect(() => {
        setFullRequested(false);
        fetchDiff();
    }, [fetchDiff]);

    useEffect(() => {
        if (fullRequested) fetchDiff(true);
    }, [fullRequested, fetchDiff]);

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

    const handleAskAIDiff = useCallback(
        (selection: DiffCommentSelection, selectedText: string) => {
            const contextStr = buildDiffContext({ selectedText, selection, filePath });
            queueDispatch({ type: 'OPEN_DIALOG', workspaceId, mode: 'ask', initialPrompt: contextStr, launchMode: 'floating-chat' });
        },
        [filePath, workspaceId, queueDispatch],
    );

    const handleCopyAsContext = useCallback(
        (selection: DiffCommentSelection, selectedText: string) => {
            const contextStr = buildDiffContext({ selectedText, selection, filePath });
            void copyToClipboard(contextStr);
        },
        [filePath],
    );

    const handleSidebarCommentClick = useCallback((comment: AnyComment) => {
        if (showEditor) {
            monacoViewerRef.current?.revealComment(comment.id);
            return;
        }
        const dc = comment as DiffComment;
        const lineIdx = dc.selection?.diffLineStart;
        if (lineIdx == null) return;
        const el = scrollContainerRef.current?.querySelector<HTMLElement>(`[data-diff-line-index="${lineIdx}"]`);
        if (!el) return;
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        el.classList.add('ring-2', 'ring-yellow-400');
        setTimeout(() => el.classList.remove('ring-2', 'ring-yellow-400'), 1500);
    }, [showEditor]);

    // Editor engine: the same thread card the sidebar shows, inline under the line.
    const renderCommentThread = useCallback((comment: DiffComment) => (
        <CommentCard
            comment={comment}
            onResolve={() => { void resolveComment(comment.id); }}
            onUnresolve={() => { void unresolveComment(comment.id); }}
            onEdit={(text) => { void updateComment(comment.id, { comment: text }); }}
            onDelete={() => { void deleteComment(comment.id); }}
            onAskAI={(commandId, question) => handleAskAI(comment.id, commandId, question)}
            onClick={() => undefined}
            aiLoading={aiLoadingIds.has(comment.id)}
            aiError={aiErrors.get(comment.id) ?? null}
            onClearAiError={() => clearAiError(comment.id)}
            isResolving={resolvingIds.has(comment.id)}
            isDeleting={deletingIds.has(comment.id)}
        />
    ), [resolveComment, unresolveComment, updateComment, deleteComment, handleAskAI, aiLoadingIds, aiErrors, clearAiError, resolvingIds, deletingIds]);

    return (
        <div className="working-tree-file-diff flex flex-col h-full overflow-hidden" data-testid="working-tree-file-diff">
            {/* Header bar */}
            <div className="px-4 py-3 border-b border-[#e0e0e0] dark:border-[#3c3c3c] bg-[#fafafa] dark:bg-[#252526]" data-testid="working-tree-file-diff-header">
                <div className="flex items-center gap-2">
                    <TruncatedPath path={filePath} className="text-sm font-semibold text-[#1e1e1e] dark:text-[#ccc] flex-1" />
                    <HunkNavButtons onPrev={handlePrev} onNext={handleNext} />
                    {stage !== 'untracked' && <DiffEngineToggle engine={diffEngine} onChange={setDiffEngine} />}
                    {stage !== 'untracked' && <DiffViewToggle mode={viewMode} onChange={setViewMode} />}
                    <span className="text-xs text-[#616161] dark:text-[#999] flex-shrink-0">{STAGE_LABEL[stage]}</span>
                    {stage !== 'untracked' && (
                        <button
                            onClick={() => setSidebarOpen(o => !o)}
                            title="Toggle comments"
                            className="text-xs px-2 py-0.5 rounded hover:bg-black/[0.06] dark:hover:bg-white/[0.08]"
                            data-testid="toggle-comments-btn"
                        >
                            💬 {comments.length > 0 ? comments.length : ''}
                        </button>
                    )}
                </div>
            </div>

            {/* Diff view + sidebar */}
            <div className="flex flex-1 min-h-0">
                <div ref={scrollContainerRef} className="flex-1 overflow-auto px-1 py-1" data-testid="working-tree-file-diff-section">
                    {fallbackReason && (
                        <DiffEngineFallbackBanner reason={fallbackReason} onRetry={retryEditor} />
                    )}
                    {stage === 'untracked' && fileMissing ? (
                        <div
                            className="flex flex-col items-start gap-1 px-4 py-4"
                            data-testid="working-tree-file-diff-missing"
                        >
                            <span className="text-xs font-medium text-[#616161] dark:text-[#999]">
                                This file no longer exists on disk.
                            </span>
                            <span className="text-xs text-[#848484]">
                                The change list was out of date and has been refreshed.
                            </span>
                        </div>
                    ) : stage === 'untracked' ? (
                        <div className="h-full w-full" data-testid="working-tree-file-diff-untracked">
                            <PreviewPane
                                repoId={workspaceId}
                                filePath={repoRoot ? repoRelative(filePath, repoRoot) : filePath}
                                fileName={filePath.split('/').pop() ?? filePath}
                                readOnly
                                onNotFound={handlePreviewNotFound}
                            />
                        </div>
                    ) : editorSides ? (
                        <MonacoFileDiffViewer
                            ref={monacoViewerRef}
                            workspaceId={workspaceId}
                            relativePath={repoRoot ? repoRelative(filePath, repoRoot) : filePath}
                            stage={stage as 'staged' | 'unstaged'}
                            original={editorSides.base.content}
                            modified={editorSides.head.content}
                            viewMode={viewMode}
                            initialHunkTarget={initialHunkTarget}
                            onLinesReady={(lines) => { setDiffLines(lines); runRelocation(lines); }}
                            onEditorError={handleEditorError}
                            comments={comments}
                            renderCommentThread={renderCommentThread}
                            onAddComment={handleAddComment}
                            onAskAI={handleAskAIDiff}
                            onCopyAsContext={handleCopyAsContext}
                            createEditor={createDiffEditor}
                            data-testid="working-tree-file-diff-editor"
                        />
                    ) : loading || editorLoading ? (
                        <div className="flex items-center gap-2 text-xs text-[#848484]" data-testid="working-tree-file-diff-loading">
                            <Spinner size="sm" /> Loading diff...
                        </div>
                    ) : error ? (
                        <div className="flex items-center gap-2" data-testid="working-tree-file-diff-error">
                            <span className="text-xs text-[#d32f2f] dark:text-[#f48771]">{error}</span>
                            <Button variant="secondary" size="sm" onClick={fetchDiff} data-testid="working-tree-file-diff-retry-btn">Retry</Button>
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
                                    diffSelectionDragSource={diffSelectionDragSource}
                                    data-testid="working-tree-file-diff-content"
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
                                    diffSelectionDragSource={diffSelectionDragSource}
                                    data-testid="working-tree-file-diff-content"
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
                        <div className="text-xs text-[#848484]" data-testid="working-tree-file-diff-empty">(no changes)</div>
                    )}
                </div>
                {diff && !loading && !error && classicActive && stage !== 'untracked' && (
                    <DiffMiniMap diffLines={diffLines} scrollContainerRef={scrollContainerRef} />
                )}

                {sidebarOpen && stage !== 'untracked' && (
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
