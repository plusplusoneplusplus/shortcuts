/**
 * CommitDetail — right-panel view for a selected commit.
 *
 * Shows the unified diff for the full commit (commit-overview mode).
 */

import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { copyToClipboard } from '../../../utils/format';
import { useCachedDiff } from '../hooks/useCommitDiffCache';
import { Spinner, Button } from '../../../ui';
import { UnifiedDiffViewer, HunkNavButtons, parseDiffFileList } from '../diff/UnifiedDiffViewer';
import type { UnifiedDiffViewerHandle, DiffLine } from '../diff/UnifiedDiffViewer';
import { SideBySideDiffViewer } from '../diff/SideBySideDiffViewer';
import { useDiffViewMode } from '../hooks/useDiffViewMode';
import { DiffViewToggle } from '../diff/DiffViewToggle';
import { DiffMiniMap } from '../diff/DiffMiniMap';
import { useAllCommitComments } from '../hooks/useAllCommitComments';
import { CommentSidebar } from '../../../tasks/comments/CommentSidebar';
import { CommitChatPanel } from './CommitChatPanel';
import { CommitChatPlacementFrame } from './CommitChatPlacementFrame';
import { useResizablePanel } from '../../../hooks/ui/useResizablePanel';
import { useCommitChatPresentation } from '../hooks/useCommitChatPresentation';
import { shouldSkipResolveDialog } from '../../../shared/ResolveContextDialog';
import { useQueue } from '../../../contexts/QueueContext';
import { useGitReviewPopOut, gitReviewPopOutKey } from '../../../contexts/GitReviewPopOutContext';
import { buildGitReviewPopOutUrl } from '../../../layout/Router';
import { getSpaCocClient } from '../../../api/cocClient';
import { useClassification } from '../diff/useClassification';
import { useModalJobAiSelection } from '../../../shared/ModalJobAiControls';
import { ClassifyDiffAiControls } from '../diff/ClassifyDiffAiControls';
import { usePrReviewProgress } from '../diff/usePrReviewProgress';
import { pickPriorityFile } from '../diff/prPopoutPriority';
import type { ClassificationKey } from '../diff/diffSource';
import type { HunkCategory } from '../../pull-requests/classification-types';
import { HUNK_CATEGORIES, CATEGORY_LABELS } from '../../pull-requests/classification-types';
import type { DiffComment } from '../../../../comments/diff-comment-types';
import type { AnyComment } from '../../../../comments/shared-comment-types';
import type { GitCommitItem } from './CommitList';

export interface CommitDetailProps {
    workspaceId: string;
    hash?: string;
    commit?: GitCommitItem;
    isPopOut?: boolean;
    /** When set, the viewer scrolls to the given file's diff section. */
    scrollToFilePath?: string | null;
    /** Called when a classification result becomes available for this commit. */
    onClassified?: () => void;
}

export function CommitDetail({ workspaceId, hash, commit, isPopOut, scrollToFilePath, onClassified }: CommitDetailProps) {
    const [sidebarOpen, setSidebarOpen] = useState(false);
    const {
        chatOpen,
        toggleChat,
        closeChat,
        minimizeChat,
        restoreChat,
        pinChat,
        unpinChat,
        isPinned: chatPinned,
        isMinimized: chatMinimized,
        presentation: chatPresentation,
        lensEnabled: chatLensEnabled,
    } = useCommitChatPresentation({ workspaceId, commitHash: hash });
    // Track currently-navigated file (for priority nav within the unified diff)
    const [navFilePath, setNavFilePath] = useState<string | null>(null);

    const chatResize = useResizablePanel({
        initialWidth: 360,
        minWidth: 200,
        maxWidth: 600,
        storageKey: 'coc.commitChatPanel.width',
        direction: 'right',
    });
    const viewerRef = useRef<UnifiedDiffViewerHandle>(null);
    const scrollContainerRef = useRef<HTMLDivElement>(null);
    const [diffLines, setDiffLines] = useState<DiffLine[]>([]);
    const [hashCopied, setHashCopied] = useState(false);
    const [viewMode, setViewMode] = useDiffViewMode();
    const [headerCollapsed, setHeaderCollapsed] = useState(false);

    const diffUrl = hash
        ? getSpaCocClient().git.commitDiffPath(workspaceId, hash)
        : null;

    const { diff, loading: diffLoading, error: diffError, retry: handleRetryDiff } = useCachedDiff(diffUrl, workspaceId, hash);

    // File list from diff for classification + priority navigation
    const fileList = useMemo(() => diff ? parseDiffFileList(diff) : [], [diff]);

    // Classification — session-scoped, mirrors commit popout
    const classificationKey: ClassificationKey = useMemo(
        () => ({ type: 'commit', repoId: workspaceId, identifier: hash ?? '' }),
        [workspaceId, hash],
    );
    const aiSelection = useModalJobAiSelection({ workspaceId, mode: 'ask' });
    const classification = useClassification(classificationKey, aiSelection.resolved, { workspaceId });

    // Notify parent when a classification result becomes available.
    const onClassifiedRef = useRef(onClassified);
    onClassifiedRef.current = onClassified;
    useEffect(() => {
        if (classification.state.status === 'ready') {
            onClassifiedRef.current?.();
        }
    }, [classification.state.status]);

    // Review progress — session-local only (no server persistence)
    const reviewProgress = usePrReviewProgress(hash ?? '');

    // Priority navigation (next/prev unreviewed or high-priority file)
    const classifyStatusForNav = classification.state.status;
    const priorityNav = useMemo(() => {
        const ctx = {
            getFileBadge: classifyStatusForNav === 'ready' ? classification.getFileBadge : () => undefined,
            reviewedFiles: reviewProgress.state.reviewedFiles,
        };
        const filters = classifyStatusForNav === 'ready' ? classification.state.activeFilters : undefined;
        const next = pickPriorityFile(fileList, ctx, {
            currentPath: navFilePath,
            direction: 'next',
            activeFilters: filters,
        });
        const prev = pickPriorityFile(fileList, ctx, {
            currentPath: navFilePath,
            direction: 'prev',
            activeFilters: filters,
        });
        return { prevPath: prev.path, nextPath: next.path };
    }, [
        classifyStatusForNav,
        classification.getFileBadge,
        classification.state.activeFilters,
        reviewProgress.state.reviewedFiles,
        fileList,
        navFilePath,
    ]);

    const handleNextPriority = useCallback(() => {
        if (priorityNav.nextPath) {
            setNavFilePath(priorityNav.nextPath);
            reviewProgress.markVisited(priorityNav.nextPath);
            viewerRef.current?.scrollToFile(priorityNav.nextPath);
        }
    }, [priorityNav.nextPath, reviewProgress]);

    const handlePrevPriority = useCallback(() => {
        if (priorityNav.prevPath) {
            setNavFilePath(priorityNav.prevPath);
            reviewProgress.markVisited(priorityNav.prevPath);
            viewerRef.current?.scrollToFile(priorityNav.prevPath);
        }
    }, [priorityNav.prevPath, reviewProgress]);

    // Commit-level comments (only active when !rangeMode)
    const {
        comments: allCommitComments,
        loading: allCommentsLoading,
        resolveComment: resolveCommitComment,
        unresolveComment: unresolveCommitComment,
        deleteComment: deleteCommitComment,
        updateComment: updateCommitComment,
        copyAllCommentsAsPrompt: copyAllCommitCommentsAsPrompt,
        resolveWithAI: commitResolveWithAI,
        fixWithAI: commitFixWithAI,
        aiLoadingIds: commitAiLoadingIds,
        aiErrors: commitAiErrors,
        clearAiError: clearCommitAiError,
    } = useAllCommitComments(workspaceId, hash ?? '');

    const { dispatch: queueDispatch } = useQueue();
    const { markPoppedOut } = useGitReviewPopOut();

    const handlePopOut = useCallback(() => {
        if (!hash) return;
        const url = buildGitReviewPopOutUrl(workspaceId, hash);
        const win = window.open(url, `coc-git-review-${hash}`, 'width=1200,height=800');
        if (win) {
            markPoppedOut(gitReviewPopOutKey(workspaceId, hash));
        }
    }, [workspaceId, hash, markPoppedOut]);

    const handleResolveAllCommitWithAI = useCallback(() => {
        if (shouldSkipResolveDialog()) {
            void commitResolveWithAI();
            return;
        }
        const openCount = allCommitComments.filter(c => c.status === 'open').length;
        queueDispatch({
            type: 'OPEN_DIALOG',
            workspaceId,
            mode: 'resolve',
            resolveContext: {
                title: 'Resolve with AI',
                commentCount: openCount,
                onSubmit: (ctx: string, sk: string[]) => {
                    void commitResolveWithAI(ctx || undefined, sk.length > 0 ? sk : undefined);
                },
            },
        });
    }, [commitResolveWithAI, allCommitComments, queueDispatch, workspaceId]);

    const handleFixCommitWithAI = useCallback((id: string) => {
        if (shouldSkipResolveDialog()) {
            void commitFixWithAI(id);
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
                    void commitFixWithAI(id, ctx || undefined, sk.length > 0 ? sk : undefined);
                },
            },
        });
    }, [commitFixWithAI, queueDispatch, workspaceId]);

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

    // Reset collapse state on commit change
    useEffect(() => {
        setHeaderCollapsed(false);
    }, [hash]);

    // Auto-collapse on scroll
    useEffect(() => {
        const el = scrollContainerRef.current;
        if (!el) return;
        const handleScroll = () => {
            if (el.scrollTop > 24) {
                setHeaderCollapsed(true);
            }
        };
        el.addEventListener('scroll', handleScroll);
        return () => el.removeEventListener('scroll', handleScroll);
    }, []);

    // Scroll to file when requested via prop
    useEffect(() => {
        if (!scrollToFilePath) return;
        const timer = setTimeout(() => {
            viewerRef.current?.scrollToFile(scrollToFilePath);
        }, 50);
        return () => clearTimeout(timer);
    }, [scrollToFilePath]);

    const handleToggleHeader = useCallback(() => {
        setHeaderCollapsed(c => !c);
    }, []);

    const handleCopyHash = useCallback(() => {
        copyToClipboard(commit?.hash ?? hash ?? '').then(() => {
            setHashCopied(true);
            setTimeout(() => setHashCopied(false), 2000);
        });
    }, [commit, hash]);

    const formattedDate = (() => {
        if (!commit?.date) return '';
        try { return new Date(commit.date).toLocaleString(); } catch { return commit.date; }
    })();

    return (
        <div className="commit-detail flex flex-col h-full overflow-hidden" data-testid="commit-detail">
            {/* Commit info header */}
            {commit && (
                <>
                    {/* Summary bar — visible when collapsed */}
                    {headerCollapsed && (
                        <div
                            data-testid="commit-info-summary"
                            className="flex items-center gap-2 px-4 py-1.5 border-b border-[#e0e0e0] dark:border-[#3c3c3c] bg-[#fafafa] dark:bg-[#252526] cursor-pointer"
                            onClick={handleToggleHeader}
                        >
                            <span className="text-[10px] text-[#848484]">▶</span>
                            <span className="text-[11px] text-[#1e1e1e] dark:text-[#ccc] truncate flex-1">{commit.subject}</span>
                            <span className="font-mono text-[10px] text-blue-600 dark:text-blue-400">{commit.hash.slice(0, 7)}</span>
                        </div>
                    )}
                    {/* Full header — collapsible */}
                    <div
                        style={{
                            maxHeight: headerCollapsed ? 0 : 600,
                            opacity: headerCollapsed ? 0 : 1,
                            overflow: headerCollapsed ? 'hidden' : 'auto',
                            transition: 'max-height 180ms ease-in-out, opacity 180ms ease-in-out',
                        }}
                    >
                        <div className="px-4 py-3 border-b border-[#e0e0e0] dark:border-[#3c3c3c] bg-[#fafafa] dark:bg-[#252526] relative" data-testid="commit-info-header">
                            <button
                                data-testid="commit-info-collapse-btn"
                                onClick={handleToggleHeader}
                                className="absolute top-2 right-2 text-[10px] text-[#848484] px-1 py-0.5 rounded hover:bg-black/[0.06] dark:hover:bg-white/[0.08]"
                                title="Collapse"
                            >▼</button>
                            <div className="text-sm font-semibold text-[#1e1e1e] dark:text-[#ccc] mb-1.5 break-words" data-testid="commit-info-subject">
                                {commit.subject}
                            </div>
                            <div className="flex flex-col gap-0.5 text-[11px] text-[#616161] dark:text-[#999]">
                                <div data-testid="commit-info-author">
                                    <span className="font-semibold text-[#1e1e1e] dark:text-[#ccc]">{commit.author}</span>
                                    {commit.authorEmail && <span className="ml-1">&lt;{commit.authorEmail}&gt;</span>}
                                </div>
                                <div data-testid="commit-info-date">{formattedDate}</div>
                                <div className="flex items-center gap-1" data-testid="commit-info-hash">
                                    <span className="font-mono text-[#0078d4] dark:text-[#3794ff]">{commit.hash.substring(0, 8)}</span>
                                    <button
                                        onClick={handleCopyHash}
                                        className="text-[10px] px-1.5 py-0 rounded hover:bg-black/[0.06] dark:hover:bg-white/[0.08] text-[#616161] dark:text-[#999]"
                                        data-testid="commit-info-copy-hash"
                                    >
                                        {hashCopied ? 'Copied!' : 'Copy'}
                                    </button>
                                </div>
                                {commit.parentHashes.length > 0 && (
                                    <div className="font-mono text-[10px]" data-testid="commit-info-parents">
                                        Parents: {commit.parentHashes.map(p => p.substring(0, 7)).join(', ')}
                                    </div>
                                )}
                            </div>
                            {commit.body && (
                                <div className="border-t border-[#e0e0e0] dark:border-[#3c3c3c] pt-1.5 mt-1.5" data-testid="commit-info-body">
                                    <pre className="text-[11px] text-[#1e1e1e] dark:text-[#ccc] whitespace-pre-wrap font-sans leading-relaxed m-0">{commit.body}</pre>
                                </div>
                            )}
                        </div>
                    </div>
                </>
            )}
            {/* Classification toolbar — mirrors commit popout layout */}
            <div className="flex items-center gap-2 px-3 py-1.5 border-b border-[#e0e0e0] dark:border-[#3c3c3c] bg-[#fafafa] dark:bg-[#2a2a2a]" data-testid="commit-classify-bar">
                <ClassifyDiffAiControls
                    selection={aiSelection}
                    disabled={classification.state.status === 'loading'}
                    testIdPrefix="commit-classify"
                />
                <button
                    type="button"
                    onClick={classification.classify}
                    disabled={classification.state.status === 'loading'}
                    className={
                        classification.state.status === 'loading'
                            ? 'inline-flex h-6 items-center gap-1 rounded border border-gray-300 bg-gray-100 px-2 text-[11px] font-medium text-gray-400 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-500 cursor-wait'
                            : 'inline-flex h-6 items-center gap-1 rounded border border-indigo-400 bg-indigo-50 px-2 text-[11px] font-medium text-indigo-700 hover:bg-indigo-100 dark:border-indigo-500 dark:bg-indigo-900/30 dark:text-indigo-200 dark:hover:bg-indigo-900/50'
                    }
                    data-testid="commit-classify-button"
                >
                    {classification.state.status === 'loading' ? (
                        <>
                            <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-current border-t-transparent" />
                            Classifying…
                        </>
                    ) : classification.state.status === 'ready' ? 'Re-classify' : 'Classify'}
                </button>
                {/* Priority file navigation — available after classification */}
                {classification.state.status === 'ready' && (
                    <>
                        <button
                            type="button"
                            onClick={handlePrevPriority}
                            disabled={priorityNav.prevPath === null}
                            className="inline-flex h-6 items-center gap-1 rounded border border-gray-300 bg-white px-2 text-[11px] text-gray-600 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed dark:border-gray-600 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700"
                            title="Previous priority file"
                            data-testid="commit-prev-priority-btn"
                        >
                            ↑ Prev
                        </button>
                        <button
                            type="button"
                            onClick={handleNextPriority}
                            disabled={priorityNav.nextPath === null}
                            className="inline-flex h-6 items-center gap-1 rounded border border-gray-300 bg-white px-2 text-[11px] text-gray-600 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed dark:border-gray-600 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700"
                            title="Next priority file"
                            data-testid="commit-next-priority-btn"
                        >
                            ↓ Next
                        </button>
                    </>
                )}
                {/* Reviewed count — session-local */}
                {fileList.length > 0 && (
                    <span
                        className="ml-auto text-[10px] text-[#848484] dark:text-[#666] tabular-nums"
                        data-testid="commit-reviewed-count"
                    >
                        {reviewProgress.state.reviewedFiles.size}/{fileList.length} reviewed
                    </span>
                )}
                {classification.state.error && (
                    <span className="text-[10px] text-red-600 dark:text-red-400">
                        {classification.state.error}
                    </span>
                )}
            </div>
            {/* Classification filter bar — visible when classification results are ready */}
            {classification.state.status === 'ready' && (
                <div className="flex items-center gap-3 px-3 py-1 border-b border-[#e0e0e0] dark:border-[#3c3c3c] bg-[#f5f5f5] dark:bg-[#262626]" data-testid="commit-filter-bar">
                    <span className="text-[10px] text-[#616161] dark:text-[#999] font-medium">Filter:</span>
                    {HUNK_CATEGORIES.map(cat => {
                        const active = classification.state.activeFilters.has(cat);
                        return (
                            <label
                                key={cat}
                                className="flex items-center gap-1 text-[11px] cursor-pointer select-none"
                                data-testid={`commit-filter-${cat}`}
                            >
                                <input
                                    type="checkbox"
                                    checked={active}
                                    onChange={() => classification.toggleFilter(cat as HunkCategory)}
                                    className="h-3 w-3 rounded"
                                />
                                <span className={active ? 'text-[#1e1e1e] dark:text-[#ccc]' : 'text-[#848484]'}>
                                    {CATEGORY_LABELS[cat]}
                                </span>
                            </label>
                        );
                    })}
                </div>
            )}
            {/* Toolbar for hunk nav + toggle */}
            <div className="sticky top-0 z-10 px-4 py-1.5 border-b border-[#e0e0e0] dark:border-[#3c3c3c] bg-[#fafafa] dark:bg-[#252526] flex items-center justify-end">
                <HunkNavButtons onPrev={() => viewerRef.current?.scrollToPrevHunk()} onNext={() => viewerRef.current?.scrollToNextHunk()} />
                <DiffViewToggle mode={viewMode} onChange={setViewMode} />
                <button
                    onClick={() => setSidebarOpen(o => !o)}
                    title="Toggle comments"
                    className="text-xs px-2 py-0.5 rounded hover:bg-black/[0.06] dark:hover:bg-white/[0.08]"
                    data-testid="toggle-comments-btn"
                >
                    💬 {allCommitComments.length > 0 ? allCommitComments.length : ''}
                </button>
                <button
                    onClick={toggleChat}
                    title="Toggle AI chat"
                    className="text-xs px-2 py-0.5 rounded hover:bg-black/[0.06] dark:hover:bg-white/[0.08]"
                    data-testid="toggle-chat-btn"
                >
                    🤖
                </button>
                {!isPopOut && hash && (
                    <button
                        onClick={handlePopOut}
                        title="Open in new window"
                        className="text-xs px-2 py-0.5 rounded hover:bg-black/[0.06] dark:hover:bg-white/[0.08]"
                        data-testid="commit-popout-btn"
                    >
                        ↗️
                    </button>
                )}
            </div>

            {/* Diff view + sidebar */}
            <div className="relative flex flex-1 min-h-0">
                <div ref={scrollContainerRef} className="flex-1 overflow-auto px-1 py-1" data-testid="diff-section">
                    {diffLoading ? (
                        <div className="flex items-center gap-2 text-xs text-[#848484]" data-testid="diff-loading">
                            <Spinner size="sm" /> Loading diff...
                        </div>
                    ) : diffError ? (
                        <div className="flex items-center gap-2" data-testid="diff-error">
                            <span className="text-xs text-[#d32f2f] dark:text-[#f48771]">{diffError}</span>
                            <Button variant="secondary" size="sm" onClick={handleRetryDiff} data-testid="retry-diff-btn">Retry</Button>
                        </div>
                    ) : diff ? (
                        viewMode === 'split' ? (
                            <SideBySideDiffViewer
                                ref={viewerRef}
                                diff={diff}
                                onLinesReady={setDiffLines}
                                data-testid="diff-content"
                            />
                        ) : (
                            <UnifiedDiffViewer
                                ref={viewerRef}
                                diff={diff}
                                onLinesReady={setDiffLines}
                                data-testid="diff-content"
                            />
                        )
                    ) : (
                        <div className="text-xs text-[#848484]" data-testid="diff-empty">(empty diff)</div>
                    )}
                </div>
                {diff && !diffLoading && !diffError && (
                    <DiffMiniMap diffLines={diffLines} scrollContainerRef={scrollContainerRef} />
                )}

                {sidebarOpen && (
                    <CommentSidebar
                        comments={allCommitComments}
                        loading={allCommentsLoading}
                        showFilePath
                        onResolve={(id) => {
                            const c = allCommitComments.find(x => x.id === id);
                            if (c) void resolveCommitComment(c);
                        }}
                        onUnresolve={(id) => {
                            const c = allCommitComments.find(x => x.id === id);
                            if (c) void unresolveCommitComment(c);
                        }}
                        onDelete={(id) => {
                            const c = allCommitComments.find(x => x.id === id);
                            if (c) void deleteCommitComment(c);
                        }}
                        onEdit={(id, text) => {
                            const c = allCommitComments.find(x => x.id === id);
                            if (c) void updateCommitComment(c, { comment: text });
                        }}
                        onAskAI={() => undefined}
                        onResolveAllWithAI={handleResolveAllCommitWithAI}
                        onFixWithAI={handleFixCommitWithAI}
                        aiLoadingIds={commitAiLoadingIds}
                        aiErrors={commitAiErrors}
                        onClearAiError={clearCommitAiError}
                        onCommentClick={handleSidebarCommentClick}
                        onCopyPrompt={copyAllCommitCommentsAsPrompt}
                        onClose={() => setSidebarOpen(false)}
                        data-testid="diff-comment-sidebar"
                    />
                )}

                {chatOpen && hash && chatPresentation === 'lens' && (
                    <CommitChatPlacementFrame
                        workspaceId={workspaceId}
                        commitHash={hash}
                        commitMessage={commit?.subject}
                        presentation="lens"
                        onClose={closeChat}
                        isMinimized={chatMinimized}
                        onMinimize={minimizeChat}
                        onRestore={restoreChat}
                        onPin={pinChat}
                    />
                )}

                {chatOpen && hash && chatPresentation === 'side-panel' && (
                    <>
                        <div
                            className="hidden lg:flex items-center justify-center w-1 cursor-col-resize hover:bg-[#007acc]/30 active:bg-[#007acc]/50 bg-[#e0e0e0] dark:bg-[#3c3c3c] shrink-0"
                            onMouseDown={chatResize.handleMouseDown}
                            onTouchStart={chatResize.handleTouchStart}
                            role="separator"
                            aria-label="Resize chat panel"
                        />
                        <div style={{ width: chatResize.width }} className="shrink-0 h-full">
                            {chatLensEnabled && chatPinned ? (
                                <CommitChatPlacementFrame
                                    workspaceId={workspaceId}
                                    commitHash={hash}
                                    commitMessage={commit?.subject}
                                    presentation="side-panel"
                                    onClose={closeChat}
                                    onUnpin={unpinChat}
                                />
                            ) : (
                                <CommitChatPanel
                                    workspaceId={workspaceId}
                                    commitHash={hash}
                                    commitMessage={commit?.subject}
                                    onClose={toggleChat}
                                />
                            )}
                        </div>
                    </>
                )}
            </div>
        </div>
    );
}
