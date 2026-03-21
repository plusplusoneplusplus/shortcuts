/**
 * CommitDetail — right-panel view for a selected commit.
 *
 * Shows only the unified diff for the full commit or a single file.
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { fetchApi } from '../hooks/useApi';
import { copyToClipboard } from '../utils/format';
import { useCachedDiff } from './useCommitDiffCache';
import { Spinner, Button } from '../shared';
import { UnifiedDiffViewer, HunkNavButtons } from './UnifiedDiffViewer';
import type { UnifiedDiffViewerHandle, DiffLine } from './UnifiedDiffViewer';
import { SideBySideDiffViewer } from './SideBySideDiffViewer';
import { useDiffViewMode } from '../hooks/useDiffViewMode';
import { DiffViewToggle } from './DiffViewToggle';
import { DiffMiniMap } from './DiffMiniMap';
import { useDiffComments } from '../hooks/useDiffComments';
import { useAllCommitComments } from '../hooks/useAllCommitComments';
import { CommentSidebar } from '../tasks/comments/CommentSidebar';
import { CommentPopover } from '../tasks/comments/CommentPopover';
import { InlineCommentPopup } from '../tasks/comments/InlineCommentPopup';
import { useQueue } from '../context/QueueContext';
import { BranchCommitStrip } from './BranchCommitStrip';
import { BranchAllFilesDiff } from './BranchAllFilesDiff';
import type { BranchRangeFile } from './BranchAllFilesDiff';
import type { DiffCommentSelection, DiffComment } from '../../diff-comment-types';
import type { AnyComment } from '../../shared-comment-types';
import type { TaskCommentCategory } from '../../task-comments-types';
import type { GitCommitItem } from './CommitList';
import type { BranchRangeInfo } from './BranchChanges';
type PopupState = {
    position: { top: number; left: number };
    selection: DiffCommentSelection;
    selectedText: string;
} | null;

const RANGE_STORAGE_KEY = 'coc.branchRangeOverview.upperHeight';
const DEFAULT_UPPER_HEIGHT = 160;
const MIN_UPPER_HEIGHT = 80;

function loadUpperHeight(): number {
    try {
        const stored = localStorage.getItem(RANGE_STORAGE_KEY);
        if (stored !== null) {
            const parsed = Number(stored);
            if (Number.isFinite(parsed) && parsed >= MIN_UPPER_HEIGHT) return parsed;
        }
    } catch { /* ignore */ }
    return DEFAULT_UPPER_HEIGHT;
}

export interface CommitDetailProps {
    workspaceId: string;
    // Single-commit mode
    hash?: string;
    filePath?: string;
    commit?: GitCommitItem;
    // Range mode (mutually exclusive with hash)
    range?: BranchRangeInfo;
    commits?: GitCommitItem[];
    files?: BranchRangeFile[];
    unpushedCount?: number;
    onFileSelect?: (filePath: string) => void;
    onAllCommentsClick?: () => void;
    onAskAI?: () => void;
    onQueueTask?: () => void;
}

export function CommitDetail({ workspaceId, hash, filePath, commit, range, commits: rangeCommits, files: rangeFiles, unpushedCount, onFileSelect, onAllCommentsClick, onAskAI, onQueueTask }: CommitDetailProps) {
    const isRangeMode = !!range;
    const { dispatch: queueDispatch } = useQueue();
    const [sidebarOpen, setSidebarOpen] = useState(false);
    const [popupState, setPopupState] = useState<PopupState>(null);
    const [activePopoverComment, setActivePopoverComment] = useState<AnyComment | null>(null);
    const [popoverPos, setPopoverPos] = useState<{ top: number; left: number } | null>(null);
    const viewerRef = useRef<UnifiedDiffViewerHandle>(null);
    const scrollContainerRef = useRef<HTMLDivElement>(null);
    const [diffLines, setDiffLines] = useState<DiffLine[]>([]);
    const [hashCopied, setHashCopied] = useState(false);
    const [viewMode, setViewMode] = useDiffViewMode();
    const [headerCollapsed, setHeaderCollapsed] = useState(false);
    const [manualOverride, setManualOverride] = useState(false);

    // Range-mode state (draggable split panel + branch comment count)
    const [upperHeight, setUpperHeight] = useState(loadUpperHeight);
    const [isDragging, setIsDragging] = useState(false);
    const [branchCommentCount, setBranchCommentCount] = useState(0);
    const rangeContainerRef = useRef<HTMLDivElement>(null);
    const startYRef = useRef(0);
    const startHeightRef = useRef(0);

    const diffUrl = (!isRangeMode && hash)
        ? (filePath
            ? `/workspaces/${encodeURIComponent(workspaceId)}/git/commits/${hash}/files/${encodeURIComponent(filePath)}/diff`
            : `/workspaces/${encodeURIComponent(workspaceId)}/git/commits/${hash}/diff`)
        : null;

    const { diff, loading: diffLoading, error: diffError, retry: handleRetryDiff } = useCachedDiff(diffUrl, workspaceId, hash);

    const diffContext = (!isRangeMode && filePath && hash)
        ? { repositoryId: workspaceId, filePath, oldRef: `${hash}^`, newRef: hash }
        : null;

    const { comments, loading: commentsLoading, addComment, deleteComment, updateComment,
            resolveComment, unresolveComment, runRelocation, askAI, aiLoadingIds, aiErrors,
            clearAiError, copyAllCommentsAsPrompt } = useDiffComments(workspaceId, diffContext);

    // Commit-level comments (only active when !filePath and !rangeMode)
    const {
        comments: allCommitComments,
        loading: allCommentsLoading,
        resolveComment: resolveCommitComment,
        unresolveComment: unresolveCommitComment,
        deleteComment: deleteCommitComment,
        updateComment: updateCommitComment,
    } = useAllCommitComments((!isRangeMode && !filePath) ? workspaceId : '', (!isRangeMode && !filePath && hash) ? hash : '');

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
            const lineRange = (selection.newLineStart && selection.newLineEnd)
                ? `${selection.newLineStart}-${selection.newLineEnd}`
                : `${selection.diffLineStart}-${selection.diffLineEnd}`;
            const contextStr = [
                'Context from code review:',
                `- Commit: ${hash}`,
                ...(filePath ? [`- File: ${filePath}`] : []),
                `- Lines ${lineRange}:`,
                '```',
                selectedText,
                '```',
                '',
                '',
            ].join('\n');
            queueDispatch({ type: 'OPEN_DIALOG', workspaceId, mode: 'ask', initialPrompt: contextStr });
        },
        [hash, filePath, workspaceId, queueDispatch],
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

    // Reset collapse state on commit change
    useEffect(() => {
        setHeaderCollapsed(false);
        setManualOverride(false);
    }, [hash]);

    // Auto-collapse on scroll (only in full-commit view)
    useEffect(() => {
        if (filePath) return;
        const el = scrollContainerRef.current;
        if (!el) return;
        const handleScroll = () => {
            if (el.scrollTop > 24) {
                if (!manualOverride) setHeaderCollapsed(true);
            } else {
                setManualOverride(false);
                setHeaderCollapsed(false);
            }
        };
        el.addEventListener('scroll', handleScroll);
        return () => el.removeEventListener('scroll', handleScroll);
    }, [filePath, manualOverride]);

    const handleToggleHeader = useCallback(() => {
        setManualOverride(true);
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

    // --- Range-mode helpers ---
    const getMaxUpperHeight = useCallback(() => {
        if (!rangeContainerRef.current) return 400;
        return Math.floor(rangeContainerRef.current.clientHeight * 0.5);
    }, []);

    const onDragMove = useCallback((clientY: number) => {
        const delta = clientY - startYRef.current;
        const maxHeight = getMaxUpperHeight();
        const newHeight = Math.min(Math.max(startHeightRef.current + delta, MIN_UPPER_HEIGHT), maxHeight);
        setUpperHeight(newHeight);
    }, [getMaxUpperHeight]);

    const onDragEnd = useCallback(() => {
        setIsDragging(false);
    }, []);

    // Persist height when drag ends
    useEffect(() => {
        if (isRangeMode && !isDragging) {
            try { localStorage.setItem(RANGE_STORAGE_KEY, String(upperHeight)); } catch { /* ignore */ }
        }
    }, [isRangeMode, isDragging, upperHeight]);

    // Fetch branch-range comment count
    useEffect(() => {
        if (!isRangeMode || !range) return;
        fetchApi(
            `/diff-comments/${encodeURIComponent(workspaceId)}` +
            `?oldRef=${encodeURIComponent(range.baseRef)}&newRef=${encodeURIComponent(range.headRef)}`
        )
            .then((data: { comments?: DiffComment[] }) => setBranchCommentCount((data.comments ?? []).length))
            .catch(() => setBranchCommentCount(0));
    }, [isRangeMode, workspaceId, range?.baseRef, range?.headRef]);

    // Global mouse/touch listeners while dragging
    useEffect(() => {
        if (!isDragging) return;
        const handleMouseMove = (e: MouseEvent) => { e.preventDefault(); onDragMove(e.clientY); };
        const handleMouseUp = () => onDragEnd();
        const handleTouchMove = (e: TouchEvent) => {
            if (e.touches.length === 1) { e.preventDefault(); onDragMove(e.touches[0].clientY); }
        };
        const handleTouchEnd = () => onDragEnd();

        document.addEventListener('mousemove', handleMouseMove);
        document.addEventListener('mouseup', handleMouseUp);
        document.addEventListener('touchmove', handleTouchMove, { passive: false });
        document.addEventListener('touchend', handleTouchEnd);

        return () => {
            document.removeEventListener('mousemove', handleMouseMove);
            document.removeEventListener('mouseup', handleMouseUp);
            document.removeEventListener('touchmove', handleTouchMove);
            document.removeEventListener('touchend', handleTouchEnd);
        };
    }, [isDragging, onDragMove, onDragEnd]);

    const handleDividerMouseDown = useCallback((e: React.MouseEvent) => {
        e.preventDefault();
        startYRef.current = e.clientY;
        startHeightRef.current = upperHeight;
        setIsDragging(true);
    }, [upperHeight]);

    const handleDividerTouchStart = useCallback((e: React.TouchEvent) => {
        if (e.touches.length !== 1) return;
        startYRef.current = e.touches[0].clientY;
        startHeightRef.current = upperHeight;
        setIsDragging(true);
    }, [upperHeight]);

    // --- Range mode rendering ---
    if (isRangeMode && range) {
        return (
            <div
                ref={rangeContainerRef}
                className={`commit-detail flex flex-col h-full overflow-hidden${isDragging ? ' select-none' : ''}`}
                data-testid="commit-detail"
            >
                {/* Upper panel — commit strip */}
                <div
                    style={{ height: upperHeight, minHeight: MIN_UPPER_HEIGHT }}
                    className="flex-shrink-0 overflow-hidden border-b border-[#e0e0e0] dark:border-[#3c3c3c]"
                    data-testid="branch-range-overview-upper"
                >
                    <BranchCommitStrip
                        commits={(rangeCommits ?? []).slice(0, unpushedCount ?? 0)}
                        branchRangeData={range}
                        onAllCommentsClick={onAllCommentsClick}
                        commentCount={branchCommentCount}
                        onAskAI={onAskAI}
                        onQueueTask={onQueueTask}
                    />
                </div>

                {/* Draggable horizontal divider */}
                <div
                    className="h-1 flex-shrink-0 cursor-row-resize bg-[#e0e0e0] dark:bg-[#3c3c3c] hover:bg-[#007acc]/40 active:bg-[#007acc]/60 transition-colors"
                    onMouseDown={handleDividerMouseDown}
                    onTouchStart={handleDividerTouchStart}
                    data-testid="branch-range-overview-divider"
                    role="separator"
                    aria-orientation="horizontal"
                    aria-label="Resize panels"
                    tabIndex={0}
                />

                {/* Lower panel — all files diff */}
                <div
                    className="flex-1 min-h-0 overflow-y-auto"
                    data-testid="branch-range-overview-lower"
                >
                    <BranchAllFilesDiff
                        workspaceId={workspaceId}
                        files={rangeFiles ?? []}
                        onFileSelect={onFileSelect ?? (() => {})}
                    />
                </div>
            </div>
        );
    }

    return (
        <div className="commit-detail flex flex-col h-full overflow-hidden" data-testid="commit-detail">
            {/* Commit info header — only for full-commit view, not per-file view */}
            {commit && !filePath && (
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
            {/* Diff label with comment toggle */}
            {filePath && (
                <div className="sticky top-0 z-10 px-4 py-2 border-b border-[#e0e0e0] dark:border-[#3c3c3c] bg-[#fafafa] dark:bg-[#252526] flex items-center justify-between" data-testid="diff-file-path">
                    <span className="text-xs font-mono text-[#616161] dark:text-[#999]">{filePath}</span>
                    <div className="flex items-center gap-2">
                        <HunkNavButtons onPrev={() => viewerRef.current?.scrollToPrevHunk()} onNext={() => viewerRef.current?.scrollToNextHunk()} />
                        <DiffViewToggle mode={viewMode} onChange={setViewMode} />
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
            )}

            {/* No-filePath companion toolbar for hunk nav + toggle */}
            {!filePath && (
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
                </div>
            )}

            {/* Diff view + sidebar */}
            <div className="flex flex-1 min-h-0">
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
                                fileName={filePath}
                                enableComments={!!filePath}
                                showLineNumbers={!!filePath}
                                comments={comments}
                                onLinesReady={(lines) => { setDiffLines(lines); if (filePath) runRelocation(lines); }}
                                onAddComment={filePath ? handleAddComment : undefined}
                                onAskAI={filePath ? handleAskAIDiff : undefined}
                                onCommentClick={filePath ? handleCommentClick : undefined}
                                data-testid="diff-content"
                            />
                        ) : (
                            <UnifiedDiffViewer
                                ref={viewerRef}
                                diff={diff}
                                fileName={filePath}
                                enableComments={!!filePath}
                                showLineNumbers={!!filePath}
                                comments={comments}
                                onLinesReady={(lines) => { setDiffLines(lines); if (filePath) runRelocation(lines); }}
                                onAddComment={filePath ? handleAddComment : undefined}
                                onAskAI={filePath ? handleAskAIDiff : undefined}
                                onCommentClick={filePath ? handleCommentClick : undefined}
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

                {sidebarOpen && filePath && (
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
                        onCopyPrompt={copyAllCommentsAsPrompt}
                        data-testid="diff-comment-sidebar"
                    />
                )}
                {sidebarOpen && !filePath && (
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
                        onCommentClick={handleSidebarCommentClick}
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
                />
            )}
        </div>
    );
}
