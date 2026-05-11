/**
 * CommitDetail — right-panel view for a selected commit.
 *
 * Shows the unified diff for the full commit (commit-overview mode).
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { copyToClipboard } from '../../../utils/format';
import { useCachedDiff } from '../hooks/useCommitDiffCache';
import { Spinner, Button } from '../../../ui';
import { UnifiedDiffViewer, HunkNavButtons } from '../diff/UnifiedDiffViewer';
import type { UnifiedDiffViewerHandle, DiffLine } from '../diff/UnifiedDiffViewer';
import { SideBySideDiffViewer } from '../diff/SideBySideDiffViewer';
import { useDiffViewMode } from '../hooks/useDiffViewMode';
import { DiffViewToggle } from '../diff/DiffViewToggle';
import { DiffMiniMap } from '../diff/DiffMiniMap';
import { useAllCommitComments } from '../hooks/useAllCommitComments';
import { CommentSidebar } from '../../../tasks/comments/CommentSidebar';
import { CommitChatPanel } from './CommitChatPanel';
import { useResizablePanel } from '../../../hooks/ui/useResizablePanel';
import { shouldSkipResolveDialog } from '../../../shared/ResolveContextDialog';
import { useQueue } from '../../../contexts/QueueContext';
import { useGitReviewPopOut, gitReviewPopOutKey } from '../../../contexts/GitReviewPopOutContext';
import { buildGitReviewPopOutUrl } from '../../../layout/Router';
import { getSpaCocClient } from '../../../api/cocClient';
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
}

export function CommitDetail({ workspaceId, hash, commit, isPopOut, scrollToFilePath }: CommitDetailProps) {
    const [sidebarOpen, setSidebarOpen] = useState(false);
    const [chatOpen, setChatOpen] = useState(() => {
        try {
            return localStorage.getItem('coc.commitChat.open') === 'true';
        } catch { return false; }
    });

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

                {chatOpen && hash && (
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
                                workspaceId={workspaceId}
                                commitHash={hash}
                                commitMessage={commit?.subject}
                                onClose={toggleChat}
                            />
                        </div>
                    </>
                )}
            </div>
        </div>
    );
}
