/**
 * CommitDetail — right-panel view for a selected commit.
 *
 * Shows only the unified diff for the full commit or a single file.
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { fetchApi } from '../hooks/useApi';
import { Spinner, Button } from '../shared';
import { UnifiedDiffViewer, HunkNavButtons } from './UnifiedDiffViewer';
import type { UnifiedDiffViewerHandle, DiffLine } from './UnifiedDiffViewer';
import { DiffMiniMap } from './DiffMiniMap';
import { useDiffComments } from '../hooks/useDiffComments';
import { CommentSidebar } from '../tasks/comments/CommentSidebar';
import { InlineCommentPopup } from '../tasks/comments/InlineCommentPopup';
import type { DiffCommentSelection, DiffComment } from '../../diff-comment-types';
import type { TaskCommentCategory } from '../../task-comments-types';

type PopupState = {
    position: { top: number; left: number };
    selection: DiffCommentSelection;
    selectedText: string;
} | null;

export interface CommitDetailProps {
    workspaceId: string;
    hash: string;
    filePath?: string;
}

export function CommitDetail({ workspaceId, hash, filePath }: CommitDetailProps) {
    const [diff, setDiff] = useState<string | null>(null);
    const [diffLoading, setDiffLoading] = useState(true);
    const [diffError, setDiffError] = useState<string | null>(null);
    const [sidebarOpen, setSidebarOpen] = useState(false);
    const [popupState, setPopupState] = useState<PopupState>(null);
    const viewerRef = useRef<UnifiedDiffViewerHandle>(null);
    const scrollContainerRef = useRef<HTMLDivElement>(null);
    const [diffLines, setDiffLines] = useState<DiffLine[]>([]);

    const diffUrl = filePath
        ? `/workspaces/${encodeURIComponent(workspaceId)}/git/commits/${hash}/files/${encodeURIComponent(filePath)}/diff`
        : `/workspaces/${encodeURIComponent(workspaceId)}/git/commits/${hash}/diff`;

    const diffContext = filePath
        ? { repositoryId: workspaceId, filePath, oldRef: `${hash}^`, newRef: hash }
        : null;

    const { comments, loading: commentsLoading, addComment, deleteComment, updateComment,
            resolveComment, unresolveComment, runRelocation } = useDiffComments(workspaceId, diffContext);

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
        <div className="commit-detail flex flex-col h-full overflow-hidden" data-testid="commit-detail">
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
                        comments={comments as any}
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
