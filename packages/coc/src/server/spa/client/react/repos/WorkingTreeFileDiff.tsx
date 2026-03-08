/**
 * WorkingTreeFileDiff — right-panel detail view for a working-tree file diff.
 *
 * Fetches staged or unstaged diff for a single file via
 * GET /api/workspaces/:id/git/changes/files/<path>/diff?stage=<stage>
 * and renders it in UnifiedDiffViewer. Untracked files show a placeholder.
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { fetchApi } from '../hooks/useApi';
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

export interface WorkingTreeFileDiffProps {
    workspaceId: string;
    filePath: string;
    stage: 'staged' | 'unstaged' | 'untracked';
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

export function WorkingTreeFileDiff({ workspaceId, filePath, stage }: WorkingTreeFileDiffProps) {
    const [diff, setDiff] = useState<string | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [sidebarOpen, setSidebarOpen] = useState(false);
    const [popupState, setPopupState] = useState<PopupState>(null);
    const [activePopoverComment, setActivePopoverComment] = useState<AnyComment | null>(null);
    const [popoverPos, setPopoverPos] = useState<{ top: number; left: number } | null>(null);
    const viewerRef = useRef<UnifiedDiffViewerHandle>(null);
    const scrollContainerRef = useRef<HTMLDivElement>(null);
    const [diffLines, setDiffLines] = useState<DiffLine[]>([]);

    const diffContext = stage !== 'untracked'
        ? { repositoryId: workspaceId, filePath, oldRef: stage === 'staged' ? 'HEAD' : 'INDEX', newRef: 'working-tree' as const }
        : null;

    const { comments, loading: commentsLoading, addComment, deleteComment, updateComment,
            resolveComment, unresolveComment, runRelocation } = useDiffComments(workspaceId, diffContext);

    const fetchDiff = useCallback(() => {
        if (stage === 'untracked') {
            setLoading(false);
            setDiff(null);
            setError(null);
            return;
        }
        setLoading(true);
        setError(null);
        setDiff(null);
        fetchApi(
            `/workspaces/${encodeURIComponent(workspaceId)}/git/changes/files/${encodeURIComponent(filePath)}/diff?stage=${stage}`
        )
            .then(data => setDiff(data.diff ?? ''))
            .catch(err => setError(err.message || 'Failed to load diff'))
            .finally(() => setLoading(false));
    }, [workspaceId, filePath, stage]);

    useEffect(() => {
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

    return (
        <div className="working-tree-file-diff flex flex-col h-full overflow-hidden" data-testid="working-tree-file-diff">
            {/* Header bar */}
            <div className="px-4 py-3 border-b border-[#e0e0e0] dark:border-[#3c3c3c] bg-[#fafafa] dark:bg-[#252526]" data-testid="working-tree-file-diff-header">
                <div className="flex items-center gap-2">
                    <span className="text-sm font-semibold text-[#1e1e1e] dark:text-[#ccc] flex-1 truncate font-mono">{filePath}</span>
                    <HunkNavButtons onPrev={() => viewerRef.current?.scrollToPrevHunk()} onNext={() => viewerRef.current?.scrollToNextHunk()} />
                    <span className="text-xs text-[#616161] dark:text-[#999] flex-shrink-0">{STAGE_LABEL[stage]}</span>
                    {stage !== 'untracked' && (
                        <button
                            onClick={() => setSidebarOpen(o => !o)}
                            title="Toggle comments"
                            className="ml-auto text-xs px-2 py-0.5 rounded hover:bg-black/[0.06] dark:hover:bg-white/[0.08]"
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
                    {stage === 'untracked' ? (
                        <div className="text-xs text-[#848484] italic" data-testid="working-tree-file-diff-untracked">
                            Untracked file – no diff available
                        </div>
                    ) : loading ? (
                        <div className="flex items-center gap-2 text-xs text-[#848484]" data-testid="working-tree-file-diff-loading">
                            <Spinner size="sm" /> Loading diff...
                        </div>
                    ) : error ? (
                        <div className="flex items-center gap-2" data-testid="working-tree-file-diff-error">
                            <span className="text-xs text-[#d32f2f] dark:text-[#f48771]">{error}</span>
                            <Button variant="secondary" size="sm" onClick={fetchDiff} data-testid="working-tree-file-diff-retry-btn">Retry</Button>
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
                            data-testid="working-tree-file-diff-content"
                        />
                    ) : (
                        <div className="text-xs text-[#848484]" data-testid="working-tree-file-diff-empty">(no changes)</div>
                    )}
                </div>
                {diff && !loading && !error && stage !== 'untracked' && (
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

            {activePopoverComment && popoverPos && (
                <CommentPopover
                    comment={activePopoverComment}
                    position={popoverPos}
                    onClose={() => setActivePopoverComment(null)}
                    onResolve={(id) => { void resolveComment(id); }}
                    onUnresolve={(id) => { void unresolveComment(id); }}
                    onDelete={(id) => { void deleteComment(id); setActivePopoverComment(null); }}
                    onEdit={(id, text) => { void updateComment(id, { comment: text }); }}
                    onAskAI={() => {}}
                />
            )}
        </div>
    );
}
