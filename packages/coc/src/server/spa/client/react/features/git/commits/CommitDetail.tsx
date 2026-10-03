/**
 * CommitDetail — right-panel view for a selected commit.
 *
 * Shows the unified diff for the full commit (commit-overview mode).
 */

import { useState, useEffect, useCallback, useRef, useMemo, useId } from 'react';
import { copyToClipboard } from '../../../utils/format';
import { useCachedDiff } from '../hooks/useCommitDiffCache';
import { Spinner, Button } from '../../../ui';
import { UnifiedDiffViewer, HunkNavButtons, parseDiffFileList } from '../diff/UnifiedDiffViewer';
import type { UnifiedDiffViewerHandle, DiffLine } from '../diff/UnifiedDiffViewer';
import type { DiffSelectionDragSource } from '../diff/diffSelectionContext';
import { SideBySideDiffViewer } from '../diff/SideBySideDiffViewer';
import { useDiffViewMode } from '../hooks/useDiffViewMode';
import { DiffViewToggle } from '../diff/DiffViewToggle';
import { DIFF_TOOLBAR_NARROW_HIDDEN } from '../diff/diffToolbarClasses';
import { DiffMiniMap } from '../diff/DiffMiniMap';
import { DiffFindWidget } from '../diff/DiffFindWidget';
import { useDiffFind } from '../diff/useDiffFind';
import { useDiffFindShortcut } from '../diff/useDiffFindShortcut';
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
import { getCocClientForWorkspace } from '../../../repos/cloneRegistry';
import { lookupCloneBaseUrl } from '../../../repos/cloneRegistry';
import { useClassification } from '../diff/useClassification';
import { useModalJobAiSelection } from '../../../shared/ModalJobAiControls';
import { ClassifyDiffAiControls } from '../diff/ClassifyDiffAiControls';
import { usePrReviewProgress } from '../diff/usePrReviewProgress';
import { pickPriorityFile } from '../diff/prPopoutPriority';
import type { ClassificationKey } from '../diff/diffSource';
import type { HunkCategory } from '../../pull-requests/classification-types';
import { CommitDetailIcon } from './CommitDetailIcon';
import { HUNK_CATEGORIES, CATEGORY_LABELS } from '../../pull-requests/classification-types';
import type { DiffComment } from '../../../../comments/diff-comment-types';
import type { AnyComment } from '../../../../comments/shared-comment-types';
import type { GitCommitItem } from './CommitList';
import { popOutOpened } from '../../../utils/popOutWindow';

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
    const diffSelectionDragSource = useMemo<DiffSelectionDragSource>(
        () => ({ workspaceId, ref: { type: 'commit', commitHash: hash } }),
        [workspaceId, hash],
    );
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
    const [aiSettingsOpen, setAiSettingsOpen] = useState(false);
    const aiSettingsId = useId();
    const headerId = useId();

    const diffUrl = hash
        ? getCocClientForWorkspace(workspaceId).git.commitDiffPath(workspaceId, hash)
        : null;

    const { diff, loading: diffLoading, error: diffError, retry: handleRetryDiff } = useCachedDiff(diffUrl, workspaceId, hash);

    // ── In-diff find (Ctrl/Cmd+F) ──
    // Same wiring as FileDiffPanel: search the FULL commit diff model so matches
    // in virtualized (>500-line) regions are still counted, and let the viewer's
    // scrollLineIntoView handle drive the virtualizer to the active match.
    const scrollActiveMatchIntoView = useCallback((lineIndex: number) => {
        viewerRef.current?.scrollLineIntoView(lineIndex);
    }, []);
    const find = useDiffFind(diffLines, scrollActiveMatchIntoView);
    useDiffFindShortcut(scrollContainerRef, find.openFind);

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
        const url = buildGitReviewPopOutUrl(workspaceId, hash, lookupCloneBaseUrl(workspaceId));
        const win = window.open(url, `coc-git-review-${hash}`, 'width=1200,height=800');
        if (popOutOpened(win)) {
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
        setAiSettingsOpen(false);
        setHashCopied(false);
    }, [workspaceId, hash]);

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
            {/* Keep the title and SHA available when metadata collapses. */}
            {commit && (
                <>
                    {headerCollapsed && (
                        <div className="flex items-center gap-2 px-4 py-2 border-b border-[#e0e0e0] dark:border-[#3c3c3c] bg-white dark:bg-[#252526]">
                            <button
                                type="button"
                                data-testid="commit-info-summary"
                                className="flex flex-1 min-w-0 items-center gap-2 text-left text-xs text-[#1e1e1e] dark:text-[#ccc] rounded focus-visible:ring-2 focus-visible:ring-[#0078d4]"
                                onClick={handleToggleHeader}
                                aria-expanded={false}
                                aria-controls={headerId}
                                title="Show commit details"
                            >
                                <CommitDetailIcon name="down" />
                                <span className="truncate">{commit.subject}</span>
                                <span className="sr-only">{commit.hash.slice(0, 8)}</span>
                            </button>
                            <button
                                type="button"
                                onClick={handleCopyHash}
                                className="inline-flex shrink-0 items-center gap-2 rounded border border-[#e0e0e0] dark:border-[#3c3c3c] px-2 py-1 font-mono text-[11px] text-[#0078d4] dark:text-[#3794ff] hover:bg-black/[0.04] dark:hover:bg-white/[0.06] focus-visible:ring-2 focus-visible:ring-[#0078d4]"
                                title={hashCopied ? 'Copied!' : 'Copy commit hash'}
                                aria-label={hashCopied ? 'Copied!' : 'Copy commit hash'}
                                data-testid="commit-summary-copy-hash"
                            >
                                {commit.hash.slice(0, 8)}
                                <CommitDetailIcon name={hashCopied ? 'check' : 'copy'} />
                            </button>
                        </div>
                    )}
                    <div
                        id={headerId}
                        hidden={headerCollapsed}
                        style={{ maxHeight: 600, overflow: 'auto' }}
                    >
                        <div className="px-4 py-3 bg-white dark:bg-[#252526]" data-testid="commit-info-header">
                            <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2" data-testid="commit-info-title-row">
                                <div className="min-w-0 flex-1 text-base font-semibold leading-snug text-[#1e1e1e] dark:text-[#ddd] break-words" data-testid="commit-info-subject">
                                    {commit.subject}
                                </div>
                                <div className="flex shrink-0 items-center gap-1">
                                    <button
                                        type="button"
                                        onClick={handleCopyHash}
                                        className="inline-flex items-center gap-2 rounded border border-[#e0e0e0] dark:border-[#3c3c3c] bg-[#f7f8fa] dark:bg-[#2d2d30] px-2 py-1 font-mono text-[11px] text-[#0078d4] dark:text-[#3794ff] hover:bg-black/[0.04] dark:hover:bg-white/[0.06] focus-visible:ring-2 focus-visible:ring-[#0078d4]"
                                        title={hashCopied ? 'Copied!' : 'Copy commit hash'}
                                        aria-label={hashCopied ? 'Copied!' : 'Copy commit hash'}
                                        data-testid="commit-info-copy-hash"
                                    >
                                        <span data-testid="commit-info-hash">{commit.hash.slice(0, 8)}</span>
                                        <CommitDetailIcon name={hashCopied ? 'check' : 'copy'} />
                                        {hashCopied && <span role="status" className="sr-only">Copied!</span>}
                                    </button>
                                    <button
                                        type="button"
                                        data-testid="commit-info-collapse-btn"
                                        onClick={handleToggleHeader}
                                        className="inline-flex h-7 w-7 items-center justify-center rounded text-[#616161] dark:text-[#999] hover:bg-black/[0.06] dark:hover:bg-white/[0.08] focus-visible:ring-2 focus-visible:ring-[#0078d4]"
                                        title="Hide commit details"
                                        aria-label="Hide commit details"
                                        aria-expanded={true}
                                        aria-controls={headerId}
                                    >
                                        <CommitDetailIcon name="up" />
                                    </button>
                                </div>
                            </div>
                            <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-[#616161] dark:text-[#aaa]" data-testid="commit-info-meta-row">
                                <span className="font-medium text-[#1e1e1e] dark:text-[#ccc]" data-testid="commit-info-author">{commit.author}</span>
                                <span data-testid="commit-info-date">{formattedDate}</span>
                                {fileList.length > 0 && <span data-testid="commit-info-file-count">{fileList.length} {fileList.length === 1 ? 'file' : 'files'} changed</span>}
                            </div>
                            {(commit.authorEmail || commit.parentHashes.length > 0 || commit.body) && (
                                <div className="mt-3 border-t border-[#ececec] dark:border-[#3c3c3c] pt-2" data-testid="commit-info-details">
                                    <div className="flex flex-wrap gap-x-5 gap-y-1 text-[11px] text-[#616161] dark:text-[#999]">
                                        {commit.authorEmail && <span className="break-all" data-testid="commit-info-email">Author &lt;{commit.authorEmail}&gt;</span>}
                                        {commit.parentHashes.length > 0 && (
                                            <span data-testid="commit-info-parents">{commit.parentHashes.length === 1 ? 'Parent' : 'Parents'}: <span className="font-mono">{commit.parentHashes.map(p => p.slice(0, 7)).join(', ')}</span></span>
                                        )}
                                    </div>
                                    {commit.body && (
                                        <div className="mt-2" data-testid="commit-info-body">
                                            <pre className="text-[11px] text-[#1e1e1e] dark:text-[#ccc] whitespace-pre-wrap break-words font-sans leading-relaxed m-0">{commit.body}</pre>
                                        </div>
                                    )}
                                </div>
                            )}
                        </div>
                    </div>
                </>
            )}
            {/* Size container: narrow panes hide labels and wrap complete control groups. */}
            <div className="sticky top-0 z-10 [container-type:inline-size] border-y border-[#e0e0e0] dark:border-[#3c3c3c] bg-[#f7f8fa] dark:bg-[#2a2a2a]">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-2" data-testid="commit-classify-bar">
                    <div className="flex flex-nowrap items-center gap-2 min-w-0" data-testid="commit-classify-left">
                        <button
                            type="button"
                            onClick={classification.classify}
                            disabled={classification.state.status === 'loading'}
                            className={
                                classification.state.status === 'loading'
                                    ? 'inline-flex h-6 shrink-0 whitespace-nowrap items-center gap-1 rounded border border-gray-300 bg-gray-100 px-2 text-[11px] font-medium text-gray-400 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-500 cursor-wait'
                                    : 'inline-flex h-7 shrink-0 whitespace-nowrap items-center gap-1.5 rounded border border-[#0078d4] bg-[#0078d4] px-2.5 text-[11px] font-medium text-white hover:bg-[#006cbe] focus-visible:ring-2 focus-visible:ring-[#0078d4]/50'
                            }
                            data-testid="commit-classify-button"
                        >
                            {classification.state.status !== 'loading' && <CommitDetailIcon name="spark" />}
                            {classification.state.status === 'loading' ? (
                                <>
                                    <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-current border-t-transparent" />
                                    Classifying…
                                </>
                            ) : classification.state.status === 'ready' ? 'Re-classify' : 'Classify'}
                        </button>
                        <button
                            type="button"
                            onClick={() => setAiSettingsOpen(open => !open)}
                            className="inline-flex h-7 min-w-0 items-center gap-1.5 rounded px-2 text-[11px] text-[#616161] dark:text-[#bbb] hover:bg-black/[0.06] dark:hover:bg-white/[0.08] focus-visible:ring-2 focus-visible:ring-[#0078d4]"
                            aria-expanded={aiSettingsOpen}
                            aria-controls={aiSettingsId}
                            aria-label="Classification settings"
                            title="Classification settings"
                            data-testid="commit-classify-settings-toggle"
                        >
                            <span className="truncate max-w-[160px]">{aiSelection.agentProviders.find(p => p.id === aiSelection.provider)?.label ?? aiSelection.provider}</span>
                            <span className={`truncate max-w-[160px] ${DIFF_TOOLBAR_NARROW_HIDDEN}`}>
                                · {aiSelection.useEffortTierMode
                                    ? aiSelection.selectedEffortTier.replace(/(^|-)([a-z])/g, (_, separator, letter) => `${separator ? ' ' : ''}${letter.toUpperCase()}`)
                                    : aiSelection.validModelOverride || aiSelection.defaultModelLabel || 'Default model'}
                            </span>
                            <CommitDetailIcon name={aiSettingsOpen ? 'up' : 'down'} />
                        </button>
                        {/* Priority file navigation — available after classification */}
                        {classification.state.status === 'ready' && (
                            <>
                                <button
                                    type="button"
                                    onClick={handlePrevPriority}
                                    disabled={priorityNav.prevPath === null}
                                    className="inline-flex h-6 shrink-0 whitespace-nowrap items-center gap-1 rounded border border-gray-300 bg-white px-2 text-[11px] text-gray-600 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed dark:border-gray-600 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700"
                                    title="Previous priority file"
                                    aria-label="Previous priority file"
                                    data-testid="commit-prev-priority-btn"
                                >
                                    ↑<span className={DIFF_TOOLBAR_NARROW_HIDDEN}>Prev</span>
                                </button>
                                <button
                                    type="button"
                                    onClick={handleNextPriority}
                                    disabled={priorityNav.nextPath === null}
                                    className="inline-flex h-6 shrink-0 whitespace-nowrap items-center gap-1 rounded border border-gray-300 bg-white px-2 text-[11px] text-gray-600 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed dark:border-gray-600 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700"
                                    title="Next priority file"
                                    aria-label="Next priority file"
                                    data-testid="commit-next-priority-btn"
                                >
                                    ↓<span className={DIFF_TOOLBAR_NARROW_HIDDEN}>Next</span>
                                </button>
                            </>
                        )}
                    </div>
                    {/* Right group: reviewed count, hunk nav, view toggle, panel buttons */}
                    <div className="flex flex-wrap items-center gap-2 min-w-0 ml-auto" data-testid="commit-classify-right">
                        <div className="flex flex-nowrap items-center gap-2" data-testid="commit-review-controls">
                            {/* Reviewed count — session-local */}
                            {fileList.length > 0 && (
                                <span
                                    className="shrink-0 whitespace-nowrap text-[10px] text-[#616161] dark:text-[#aaa] tabular-nums"
                                    title={`${reviewProgress.state.reviewedFiles.size} of ${fileList.length} files reviewed`}
                                    data-testid="commit-reviewed-count"
                                >
                                    {reviewProgress.state.reviewedFiles.size}/{fileList.length}<span className={DIFF_TOOLBAR_NARROW_HIDDEN}> reviewed</span>
                                </span>
                            )}
                            {fileList.length > 0 && (
                                <div
                                    role="progressbar"
                                    aria-label="Files reviewed"
                                    aria-valuemin={0}
                                    aria-valuemax={fileList.length}
                                    aria-valuenow={Math.min(reviewProgress.state.reviewedFiles.size, fileList.length)}
                                    className={`h-1 w-10 overflow-hidden rounded bg-[#e0e0e0] dark:bg-[#444] ${DIFF_TOOLBAR_NARROW_HIDDEN}`}
                                >
                                    <div className="h-full bg-[#2d8d65]" style={{ width: `${Math.min(100, reviewProgress.state.reviewedFiles.size / fileList.length * 100)}%` }} />
                                </div>
                            )}
                            <HunkNavButtons onPrev={() => viewerRef.current?.scrollToPrevHunk()} onNext={() => viewerRef.current?.scrollToNextHunk()} />
                        </div>
                        <div className="flex flex-nowrap items-center gap-1" data-testid="commit-view-controls">
                            <DiffViewToggle mode={viewMode} onChange={setViewMode} appearance="quiet" />
                            <span aria-hidden="true" className="mx-1 h-4 w-px bg-[#e0e0e0] dark:bg-[#444]" />
                            <button
                                onClick={() => setSidebarOpen(o => !o)}
                                title="Toggle comments"
                                aria-label="Toggle comments"
                                aria-pressed={sidebarOpen}
                                className="inline-flex h-7 shrink-0 whitespace-nowrap items-center gap-1 text-xs px-2 rounded text-[#616161] dark:text-[#bbb] hover:bg-black/[0.06] dark:hover:bg-white/[0.08] focus-visible:ring-2 focus-visible:ring-[#0078d4]"
                                data-testid="toggle-comments-btn"
                            >
                                <CommitDetailIcon name="chat" />{allCommitComments.length > 0 && <span>{allCommitComments.length}</span>}
                            </button>
                            <button
                                onClick={toggleChat}
                                title="Toggle AI chat"
                                aria-label="Toggle AI chat"
                                aria-pressed={chatOpen}
                                className="inline-flex h-7 shrink-0 whitespace-nowrap items-center gap-1 text-xs px-2 rounded text-[#616161] dark:text-[#bbb] hover:bg-black/[0.06] dark:hover:bg-white/[0.08] focus-visible:ring-2 focus-visible:ring-[#0078d4]"
                                data-testid="toggle-chat-btn"
                            >
                                <CommitDetailIcon name="spark" />
                            </button>
                            {!isPopOut && hash && (
                                <button
                                    onClick={handlePopOut}
                                    title="Open in new window"
                                    aria-label="Open in new window"
                                    className="inline-flex h-7 shrink-0 whitespace-nowrap items-center gap-1 text-xs px-2 rounded text-[#616161] dark:text-[#bbb] hover:bg-black/[0.06] dark:hover:bg-white/[0.08] focus-visible:ring-2 focus-visible:ring-[#0078d4]"
                                    data-testid="commit-popout-btn"
                                >
                                    <CommitDetailIcon name="out" />
                                </button>
                            )}
                        </div>
                    </div>
                </div>
                {classification.state.error && (
                    <div role="alert" className="border-t border-[#e0e0e0] dark:border-[#3c3c3c] px-4 py-2 text-[11px] text-red-600 dark:text-red-400">
                        {classification.state.error}
                    </div>
                )}
                {aiSettingsOpen && (
                    <div id={aiSettingsId} className="border-t border-[#e0e0e0] dark:border-[#3c3c3c] px-4 py-2" data-testid="commit-classify-settings">
                        <ClassifyDiffAiControls selection={aiSelection} disabled={classification.state.status === 'loading'} testIdPrefix="commit-classify" />
                    </div>
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

            {/* Diff view + sidebar */}
            <div className="relative flex flex-1 min-h-0">
                {/* ── In-diff find widget (Ctrl/Cmd+F) ── */}
                {find.open && diff && !diffLoading && !diffError && (
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
                <div ref={scrollContainerRef} className="flex-1 overflow-auto px-1 py-1 outline-none" data-testid="diff-section" tabIndex={-1}>
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
                                matchRangesByLine={find.matchRangesByLine}
                                showFileBanners
                                diffSelectionDragSource={diffSelectionDragSource}
                                data-testid="diff-content"
                            />
                        ) : (
                            <UnifiedDiffViewer
                                ref={viewerRef}
                                diff={diff}
                                onLinesReady={setDiffLines}
                                matchRangesByLine={find.matchRangesByLine}
                                showFileBanners
                                diffSelectionDragSource={diffSelectionDragSource}
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
