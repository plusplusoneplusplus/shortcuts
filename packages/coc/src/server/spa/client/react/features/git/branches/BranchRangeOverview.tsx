import { useState, useEffect, useMemo, useCallback } from 'react';
import { listDiffCommentsForRange } from '../../../utils/diffCommentApi';
import type { BranchRangeFile } from './BranchAllFilesDiff';
import type { GitCommitItem } from '../commits/CommitList';
import type { BranchRangeInfo } from './BranchChanges';
import { useGitReviewPopOut, gitReviewBranchPopOutKey } from '../../../contexts/GitReviewPopOutContext';
import { buildGitBranchRangePopOutUrl } from '../../../layout/Router';
import { createGitRangeContextDragPayload, writePointerContextDragData } from '../../chat/sessionContextDrag';
import { lookupCloneBaseUrl, resolveCloneRoute } from '../../../repos/cloneRegistry';
import { useCloneBaseUrl } from '../../../repos/cloneRouting';
import { getGitReviewClient } from '../diff/diffSource';
import { isSessionContextAttachmentsEnabled } from '../../../utils/config';
import type { GitRangeBaseMode } from '@plusplusoneplusplus/coc-client';
import { popOutOpened } from '../../../utils/popOutWindow';
import { GitFileReview } from '../diff/GitFileReview';
import { createBranchRangeDiffSource } from '../diff/diffSource';
import { CommitDetail } from '../commits/CommitDetail';

export interface BranchRangeOverviewProps {
    workspaceId: string;
    attachmentDestinationId?: string;
    range: BranchRangeInfo;
    commits?: GitCommitItem[];
    files?: BranchRangeFile[];
    unpushedCount?: number;
    onFileSelect?: (filePath: string) => void;
    onNavigateToFile?: (filePath: string, target: 'first' | 'last') => void;
    onAllCommentsClick?: () => void;
    onAskAI?: () => void;
    onQueueTask?: () => void;
    isPopOut?: boolean;
    scrollToFilePath?: string | null;
    initialHunkTarget?: 'first' | 'last';
    baseMode?: GitRangeBaseMode;
    onBaseModeChange?: (mode: GitRangeBaseMode) => void;
}

export function BranchRangeOverview(props: BranchRangeOverviewProps) {
    const owner = props.attachmentDestinationId;
    const endpoint = useCloneBaseUrl(owner === props.workspaceId ? undefined : owner ?? props.workspaceId);
    if (owner && owner !== props.workspaceId && resolveCloneRoute(owner).kind === 'unresolved-remote') {
        return <div role="alert" className="p-2 text-xs">Git review owner is unavailable</div>;
    }
    // Resolved commit identities, not mutable HEAD/ref labels, scope review state.
    const identity = JSON.stringify([props.attachmentDestinationId ?? props.workspaceId, props.workspaceId,
        endpoint, props.baseMode, props.range.mergeBase, props.range.baseRef, props.range.headRef,
        props.range.baseSha, props.range.headSha, props.range.commits?.map(commit => commit.hash), props.files]);
    return <BranchReview key={identity} {...props} comparisonKey={identity} />;
}
function BranchReview({ workspaceId, attachmentDestinationId, range, files = [], onFileSelect, onNavigateToFile,
    onAllCommentsClick, onAskAI, onQueueTask, isPopOut, scrollToFilePath, initialHunkTarget,
    baseMode = 'default-branch', onBaseModeChange, comparisonKey }: BranchRangeOverviewProps & { comparisonKey: string }) {
    const [scope, setScope] = useState('');
    const [branchCommentCount, setBranchCommentCount] = useState(0);
    const { markPoppedOut } = useGitReviewPopOut();
    // Only server-provided range commits are eligible; the history page may be filtered or incomplete.
    const commits = range.commits ?? [];
    const selectedCommit = commits.find(commit => commit.hash === scope);
    const sessionContextPayload = isSessionContextAttachmentsEnabled()
        ? createGitRangeContextDragPayload(range, { activeWorkspaceId: workspaceId }) : null;
    const revision = JSON.stringify([range.baseSha ?? range.mergeBase, range.headSha ?? commits[0]?.hash, range.baseRef]);
    const source = useMemo(() => createBranchRangeDiffSource(workspaceId, {
        files: files.map(file => file.path), baseMode, range, revision,
        routingTarget: attachmentDestinationId === workspaceId ? null : attachmentDestinationId,
    }), [workspaceId, files, baseMode, range, revision, attachmentDestinationId]);
    useEffect(() => {
        let cancelled = false;
        Promise.resolve().then(() => listDiffCommentsForRange(workspaceId, range.baseRef, range.headRef, getGitReviewClient(workspaceId, attachmentDestinationId === workspaceId ? null : attachmentDestinationId)))
            .then(comments => { if (!cancelled) setBranchCommentCount(comments.length); })
            .catch(() => { if (!cancelled) setBranchCommentCount(0); });
        return () => { cancelled = true; };
    }, [workspaceId, attachmentDestinationId, range.baseRef, range.headRef]);
    const handlePopOut = useCallback(() => {
        const cloneBaseUrl = attachmentDestinationId === workspaceId ? undefined : lookupCloneBaseUrl(attachmentDestinationId ?? workspaceId);
        const url = buildGitBranchRangePopOutUrl(workspaceId, cloneBaseUrl, baseMode, attachmentDestinationId);
        if (popOutOpened(window.open(url, `coc-git-review-branch-${workspaceId}`, 'width=1200,height=800'))) markPoppedOut(gitReviewBranchPopOutKey(workspaceId));
    }, [workspaceId, attachmentDestinationId, baseMode, markPoppedOut]);
    return <div className="commit-detail flex flex-col h-full min-w-0 overflow-hidden" data-testid="branch-range-review">
        <div className="flex shrink-0 flex-wrap items-center gap-1 px-2 py-1 text-[11px] border-b border-[#e0e0e0] dark:border-[#3c3c3c] bg-[#fafafa] dark:bg-[#252526]" data-testid="branch-commit-strip-header">
            <span className="truncate max-w-[180px] font-medium" draggable={!!sessionContextPayload}
                data-session-context-source={sessionContextPayload ? 'true' : undefined} data-session-context-kind={sessionContextPayload ? 'range' : undefined}
                onDragStart={sessionContextPayload ? event => writePointerContextDragData(event.dataTransfer, sessionContextPayload) : undefined}
                title={sessionContextPayload ? `${sessionContextPayload.label} - drag to attach as range context` : range.headRef}>{range.branchName || range.headRef}</span>
            {onBaseModeChange ? <select className="bg-transparent min-h-7 max-w-[190px]" aria-label="Comparison base" value={baseMode} onChange={event => onBaseModeChange(event.target.value as GitRangeBaseMode)}>
                <option value="default-branch">vs {baseMode === 'default-branch' ? range.baseRef : 'default branch'}</option><option value="upstream">Unpushed{baseMode === 'upstream' ? ` · ${range.baseRef}` : ''}</option>
            </select> : <span className="text-[#848484]">vs {range.baseRef}</span>}
            <select className="bg-transparent min-h-7 max-w-[260px]" aria-label="Commit scope" value={scope} onChange={event => setScope(event.target.value)}>
                <option value="">All {range.commitCount} commits</option>{!commits.length && range.commitCount > 0 && <option disabled>Commit scope unavailable</option>}{range.commitCount > commits.length && commits.length > 0 && <option disabled>Showing newest {commits.length} commits</option>}{commits.map(commit => <option key={commit.hash} value={commit.hash}>{commit.shortHash} {commit.subject}</option>)}
            </select>
            <span className="text-[#16825d]">+{range.additions}</span><span className="text-[#d32f2f]">−{range.deletions}</span>
            {range.baseModeFallback && <span className="text-[#848484]" data-testid="branch-range-base-fallback">no upstream — showing vs {range.baseRef}</span>}
            <span className="flex-1" />
            {onAskAI && <button type="button" className="min-h-7 px-1" aria-label="Ask AI about branch changes" onClick={onAskAI} data-testid="branch-range-ask-ai-btn">Ask AI</button>}
            {onQueueTask && <button type="button" className="min-h-7 px-1" onClick={onQueueTask}>Task</button>}
            {onAllCommentsClick && <button type="button" className="min-h-7 px-1" aria-label="Show all branch comments" onClick={onAllCommentsClick}>Comments{branchCommentCount ? ` · ${branchCommentCount}` : ''}</button>}
            {!isPopOut && <button type="button" className="min-h-7 px-1" aria-label="Open in new window" title="Open in new window" onClick={handlePopOut} data-testid="branch-range-popout-btn">↗</button>}
        </div>
        {selectedCommit ? <CommitDetail key={selectedCommit.hash} workspaceId={workspaceId} attachmentDestinationId={attachmentDestinationId} hash={selectedCommit.hash} commit={selectedCommit} isPopOut={isPopOut} />
            : <GitFileReview workspaceId={workspaceId} attachmentDestinationId={attachmentDestinationId} comparisonKey={comparisonKey}
                files={files} source={source} selectedPath={scrollToFilePath} initialHunkTarget={initialHunkTarget}
                onSelect={onNavigateToFile ?? (onFileSelect ? path => onFileSelect(path) : undefined)} />}
    </div>;
}
