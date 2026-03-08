/**
 * CommitDetail — right-panel view for a selected commit.
 *
 * Shows only the unified diff for the full commit or a single file.
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { fetchApi } from '../hooks/useApi';
import { copyToClipboard } from '../utils/format';
import { Spinner, Button } from '../shared';
import { UnifiedDiffViewer, HunkNavButtons } from './UnifiedDiffViewer';
import type { UnifiedDiffViewerHandle, DiffLine } from './UnifiedDiffViewer';
import { DiffMiniMap } from './DiffMiniMap';
import { useDiffComments } from '../hooks/useDiffComments';
import { CommentSidebar } from '../tasks/comments/CommentSidebar';
import { CommentPopover } from '../tasks/comments/CommentPopover';
import { InlineCommentPopup } from '../tasks/comments/InlineCommentPopup';
import type { DiffCommentSelection, DiffComment } from '../../diff-comment-types';
import type { AnyComment } from '../../shared-comment-types';
import type { TaskCommentCategory } from '../../task-comments-types';
import type { GitCommitItem } from './CommitList';

type PopupState = {
    position: { top: number; left: number };
    selection: DiffCommentSelection;
    selectedText: string;
} | null;

export interface CommitDetailProps {
    workspaceId: string;
    hash: string;
    filePath?: string;
    commit?: GitCommitItem;
}

export function CommitDetail({ workspaceId, hash, filePath, commit }: CommitDetailProps) {
    const [diff, setDiff] = useState<string | null>(null);
    const [diffLoading, setDiffLoading] = useState(true);
    const [diffError, setDiffError] = useState<string | null>(null);
    const [sidebarOpen, setSidebarOpen] = useState(false);
    const [popupState, setPopupState] = useState<PopupState>(null);
    const [activePopoverComment, setActivePopoverComment] = useState<AnyComment | null>(null);
    const [popoverPos, setPopoverPos] = useState<{ top: number; left: number } | null>(null);
    const viewerRef = useRef<UnifiedDiffViewerHandle>(null);
    const scrollContainerRef = useRef<HTMLDivElement>(null);
    const [diffLines, setDiffLines] = useState<DiffLine[]>([]);
    const [hashCopied, setHashCopied] = useState(false);

    const diffUrl = filePath
        ? `/workspaces/${encodeURIComponent(workspaceId)}/git/commits/${hash}/files/${encodeURIComponent(filePath)}/diff`
        : `/workspaces/${encodeURIComponent(workspaceId)}/git/commits/${hash}/diff`;

    const diffContext = filePath
        ? { repositoryId: workspaceId, filePath, oldRef: `${hash}^`, newRef: hash }
        : null;

    const { comments, loading: commentsLoading, addComment, deleteComment, updateComment,
            resolveComment, unresolveComment, runRelocation, askAI, aiLoadingIds, aiErrors,
            clearAiError } = useDiffComments(workspaceId, diffContext);

    // Always fetch diff on mount / hash / filePath change
    useEffect(() => {
        setDiffLoading(true);
        setDiffError(null);
        setDiff(null);
        fetchApi(diffUrl)
            .then(data => setDiff(data.diff || ''))
            .catch(err => setDiffError(err.message || 'Failed to load diff'))
            .finally(() => setDiffLoading(false));
    }, [diffUrl]);

    const handleRetryDiff = useCallback(() => {
        setDiffLoading(true);
        setDiffError(null);
        fetchApi(diffUrl)
            .then(data => setDiff(data.diff || ''))
            .catch(err => setDiffError(err.message || 'Failed to load diff'))
            .finally(() => setDiffLoading(false));
    }, [diffUrl]);

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

    const handleCopyHash = useCallback(() => {
        copyToClipboard(commit?.hash ?? hash).then(() => {
            setHashCopied(true);
            setTimeout(() => setHashCopied(false), 2000);
        });
    }, [commit, hash]);

    const formattedDate = (() => {
        if (!commit?.date) return '';
        try { return new Date(commit.date).toLocaleString(); } catch { return commit.date; }
    })();

    return (
        <div ref={scrollContainerRef} className="commit-detail flex flex-col h-full overflow-auto" data-testid="commit-detail">
            {/* Commit info header */}
            {commit && (
                <div className="px-4 py-3 border-b border-[#e0e0e0] dark:border-[#3c3c3c] bg-[#fafafa] dark:bg-[#252526]" data-testid="commit-info-header">
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
            )}
            {/* Diff label with comment toggle */}
            {filePath && (
                <div className="px-4 py-2 border-b border-[#e0e0e0] dark:border-[#3c3c3c] bg-[#fafafa] dark:bg-[#252526] flex items-center justify-between" data-testid="diff-file-path">
                    <span className="text-xs font-mono text-[#616161] dark:text-[#999]">{filePath}</span>
                    <div className="flex items-center gap-2">
                        <HunkNavButtons onPrev={() => viewerRef.current?.scrollToPrevHunk()} onNext={() => viewerRef.current?.scrollToNextHunk()} />
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

            {/* Diff view + sidebar */}
            <div className="flex min-h-0">
                <div className="flex-1 px-1 py-1" data-testid="diff-section">
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
                        <UnifiedDiffViewer
                            ref={viewerRef}
                            diff={diff}
                            fileName={filePath}
                            enableComments={!!filePath}
                            showLineNumbers={!!filePath}
                            comments={comments}
                            onLinesReady={(lines) => { setDiffLines(lines); if (filePath) runRelocation(lines); }}
                            onAddComment={filePath ? handleAddComment : undefined}
                            onCommentClick={filePath ? handleCommentClick : undefined}
                            data-testid="diff-content"
                        />
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
