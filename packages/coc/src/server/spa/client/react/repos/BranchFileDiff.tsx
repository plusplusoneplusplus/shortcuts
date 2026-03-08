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
import { DiffMiniMap } from './DiffMiniMap';
import { useDiffComments } from '../hooks/useDiffComments';
import { CommentSidebar } from '../tasks/comments/CommentSidebar';
import { InlineCommentPopup } from '../tasks/comments/InlineCommentPopup';
import type { DiffCommentSelection, DiffComment } from '../../diff-comment-types';
import type { TaskCommentCategory } from '../../task-comments-types';

export interface BranchFileDiffProps {
    workspaceId: string;
    filePath: string;
}

type PopupState = {
    position: { top: number; left: number };
    selection: DiffCommentSelection;
    selectedText: string;
} | null;

export function BranchFileDiff({ workspaceId, filePath }: BranchFileDiffProps) {
    const [diff, setDiff] = useState<string | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [sidebarOpen, setSidebarOpen] = useState(false);
    const [popupState, setPopupState] = useState<PopupState>(null);
    const viewerRef = useRef<UnifiedDiffViewerHandle>(null);
    const scrollContainerRef = useRef<HTMLDivElement>(null);
    const [diffLines, setDiffLines] = useState<DiffLine[]>([]);

    const diffContext = { repositoryId: workspaceId, filePath, oldRef: 'branch-base', newRef: 'branch-head' };

    const { comments, loading: commentsLoading, addComment, deleteComment, updateComment,
            resolveComment, unresolveComment, runRelocation } = useDiffComments(workspaceId, diffContext);

    const fetchDiff = useCallback(() => {
        setLoading(true);
        setError(null);
        setDiff(null);
        fetchApi(
            `/workspaces/${encodeURIComponent(workspaceId)}/git/branch-range/files/${encodeURIComponent(filePath)}/diff`
        )
            .then(data => setDiff(data.diff ?? ''))
            .catch(err => setError(err.message || 'Failed to load diff'))
            .finally(() => setLoading(false));
    }, [workspaceId, filePath]);

    useEffect(() => {
        fetchDiff();
    }, [fetchDiff]);

    const handleRetry = useCallback(() => {
        fetchDiff();
    }, [fetchDiff]);

    const handleAddComment = useCallback(
        (selection: DiffCommentSelection, selectedText: string, position: { top: number; left: number }) => {
            setPopupState({ position, selection, selectedText });
        },
        [],
    );

    const handleCommentClick = useCallback((_comment: DiffComment) => {
        setSidebarOpen(true);
    }, []);

    const handlePopupSubmit = useCallback(
        async (text: string, category: TaskCommentCategory) => {
            if (!popupState) return;
            await addComment(popupState.selection, popupState.selectedText, text, category);
            setPopupState(null);
        },
        [popupState, addComment],
    );

    return (
        <div className="branch-file-diff flex flex-col h-full overflow-hidden" data-testid="branch-file-diff">
            {/* Header bar */}
            <div className="px-4 py-3 border-b border-[#e0e0e0] dark:border-[#3c3c3c] bg-[#fafafa] dark:bg-[#252526]" data-testid="branch-file-diff-header">
                <div className="flex items-center gap-2">
                    <TruncatedPath path={filePath} className="text-sm font-semibold text-[#1e1e1e] dark:text-[#ccc] flex-1" />
                    <HunkNavButtons onPrev={() => viewerRef.current?.scrollToPrevHunk()} onNext={() => viewerRef.current?.scrollToNextHunk()} />
                    <span className="text-xs text-[#616161] dark:text-[#999] flex-shrink-0">Branch diff</span>
                    <button
                        onClick={() => setSidebarOpen(o => !o)}
                        title="Toggle comments"
                        className="ml-auto text-xs px-2 py-0.5 rounded hover:bg-black/[0.06] dark:hover:bg-white/[0.08]"
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
                        <UnifiedDiffViewer
                            ref={viewerRef}
                            diff={diff}
                            fileName={filePath}
                            enableComments
                            showLineNumbers
                            comments={comments}
                            onLinesReady={(lines) => { setDiffLines(lines); runRelocation(lines); }}
                            onAddComment={handleAddComment}
                            onCommentClick={handleCommentClick}
                            data-testid="branch-file-diff-content"
                        />
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
                        onAskAI={() => {}}
                        onCommentClick={() => {}}
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
        </div>
    );
}
