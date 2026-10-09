/**
 * RepoGitDetailPane — the Git tab's right-hand detail surface.
 *
 * A pure switch over `RightPanelView`: commit detail, a commit's file diff, the
 * branch-range overview, a branch-range file diff, a working-tree file diff,
 * either all-comments view, a multi-commit summary, or the empty state.
 *
 * Commit review keeps one chat host across overview/file navigation. The same
 * subtree renders inline and portaled into the split-workspace detail region.
 */

import { useMemo } from 'react';
import { CommitReviewChat } from '../commits/CommitReviewChat';
import { useCommitChatPresentation } from '../hooks/useCommitChatPresentation';
import type { GitCommitItem } from '../commits/CommitList';
import { CommitDetail } from '../commits/CommitDetail';
import { BranchRangeOverview } from '../branches/BranchRangeOverview';
import { BranchRangeAllComments } from '../branches/BranchRangeAllComments';
import { FileDiffPanel } from '../diff/FileDiffPanel';
import { createCommitDiffSource, createBranchRangeDiffSource } from '../diff/diffSource';
import { WorkingTreeFileDiff } from '../working-tree/WorkingTreeFileDiff';
import { WorkingTreeAllComments } from '../working-tree/WorkingTreeAllComments';
import type { BranchRangeInfo } from '../branches/BranchChanges';
import type { GitRangeBaseMode } from '@plusplusoneplusplus/coc-client';
import type { HunkTarget, RightPanelView } from './types';

export interface RepoGitDetailPaneProps {
    workspaceId: string;
    attachmentDestinationId?: string;
    view: RightPanelView | null;
    commits: GitCommitItem[];
    unpushedCount: number;
    branchRangeData: BranchRangeInfo | null;
    branchRangeFiles: any[];
    baseMode: GitRangeBaseMode;
    onBaseModeChange: (mode: GitRangeBaseMode) => void;
    repoRoot: string | undefined;
    hunkTarget: HunkTarget;
    onBranchFileSelect: (filePath: string) => void;
    onNavigateToBranchFile: (filePath: string, target: 'first' | 'last') => void;
    onNavigateToCommitFile: (hash: string, filePath: string, target: 'first' | 'last') => void;
    onNavigateToWorkingTreeFile: (filePath: string, target: 'first' | 'last') => void;
    /** Refreshes the working-tree list when a selected untracked file no longer exists on disk. */
    onWorkingTreeFileMissing?: () => void;
    /** An edited working-tree diff reports unsaved edits and its save function here. */
    onDetailDirtyChange?: (isDirty: boolean) => void;
    onDetailRegisterSave?: (save: (() => Promise<boolean>) | null) => void;
    /** Bumped by every working-tree refresh; re-reads the shown working-tree diff. */
    workingChangesRefreshKey?: number;
    /** Refreshes the working-tree list and diff after an edited working-tree diff is saved. */
    onWorkingTreeFileSaved?: () => void;
    onAllBranchCommentsClick: () => void;
    onBranchAskAI: (mode: 'ask' | 'task') => void;
    onCommitClassified: () => void;
}

export function RepoGitDetailPane({
    workspaceId, attachmentDestinationId, view, commits, unpushedCount, branchRangeData, branchRangeFiles,
    baseMode, onBaseModeChange, repoRoot, hunkTarget, onBranchFileSelect,
    onNavigateToBranchFile, onNavigateToCommitFile, onNavigateToWorkingTreeFile,
    onWorkingTreeFileMissing, onDetailDirtyChange, onDetailRegisterSave, workingChangesRefreshKey, onWorkingTreeFileSaved, onAllBranchCommentsClick, onBranchAskAI, onCommitClassified,
}: RepoGitDetailPaneProps) {
    if (view?.type === 'commit' || view?.type === 'commit-file') {
        const hash = view.type === 'commit' ? view.commit.hash : view.hash;
        return <CommitReviewDetail
            key={`${attachmentDestinationId ?? workspaceId}:${hash}`}
            workspaceId={workspaceId}
            attachmentDestinationId={attachmentDestinationId}
            hash={hash}
            commit={view.type === 'commit' ? view.commit : commits.find(c => c.hash === hash)}
            filePath={view.type === 'commit-file' ? view.filePath : undefined}
            hunkTarget={hunkTarget}
            onNavigateToCommitFile={onNavigateToCommitFile}
            onCommitClassified={onCommitClassified}
        />;
    }

    // A restored branch view can outlive its branch range (the user has since
    // switched to the default branch): say so instead of rendering a range
    // that is not there.
    if ((view?.type === 'branch-range' || view?.type === 'branch-range-comments') && !branchRangeData) {
        return (
            <div className="flex-1 flex items-center justify-center text-sm text-[#848484]" data-testid="git-detail-no-branch-range">
                No branch changes to show
            </div>
        );
    }

    if (view?.type === 'branch-range') {
        return (
            <BranchRangeOverview
                attachmentDestinationId={attachmentDestinationId}
                workspaceId={workspaceId}
                range={branchRangeData!}
                commits={commits}
                unpushedCount={unpushedCount}
                files={branchRangeFiles}
                onFileSelect={onBranchFileSelect}
                onAllCommentsClick={onAllBranchCommentsClick}
                onAskAI={() => { void onBranchAskAI('ask'); }}
                onQueueTask={() => { void onBranchAskAI('task'); }}
                baseMode={baseMode}
                onBaseModeChange={onBaseModeChange}
            />
        );
    }

    if (view?.type === 'branch-file') {
        return (
            <FileDiffPanel
                attachmentDestinationId={attachmentDestinationId}
                key={view.filePath}
                source={createBranchRangeDiffSource(workspaceId, {
                    files: (branchRangeFiles ?? []).map((f: { path: string }) => f.path).sort(),
                    baseMode,
                    range: branchRangeData ?? undefined,
                })}
                workspaceId={workspaceId}
                filePath={view.filePath}
                onNavigateToFile={onNavigateToBranchFile}
                initialHunkTarget={hunkTarget}
            />
        );
    }

    if (view?.type === 'working-tree-file') {
        return (
            <WorkingTreeFileDiff
                attachmentDestinationId={attachmentDestinationId}
                key={`${view.filePath}:${view.stage}`}
                workspaceId={workspaceId}
                filePath={view.filePath}
                stage={view.stage}
                repoRoot={repoRoot}
                onNavigateToFile={onNavigateToWorkingTreeFile}
                initialHunkTarget={hunkTarget}
                onFileMissing={onWorkingTreeFileMissing}
                onDirtyChange={onDetailDirtyChange}
                onRegisterSave={onDetailRegisterSave}
                refreshKey={workingChangesRefreshKey}
                onSaved={onWorkingTreeFileSaved}
            />
        );
    }

    if (view?.type === 'working-tree-comments') {
        return <WorkingTreeAllComments workspaceId={workspaceId} />;
    }

    if (view?.type === 'branch-range-comments') {
        return (
            <BranchRangeAllComments
                workspaceId={workspaceId}
                baseRef={branchRangeData!.baseRef}
                headRef={branchRangeData!.headRef}
                branchLabel={branchRangeData!.branchName || branchRangeData!.headRef}
            />
        );
    }

    if (view?.type === 'multi-commit') {
        return (
            <div className="flex flex-col h-full p-4 gap-3" data-testid="git-multi-commit-panel">
                <div className="text-sm font-semibold text-[#1e1e1e] dark:text-[#ccc]">
                    {view.commits.length} commits selected
                </div>
                <div className="flex flex-col gap-1 overflow-y-auto">
                    {view.commits.map(c => (
                        <div key={c.hash} className="flex items-center gap-2 text-xs py-1 border-b border-[#e0e0e0] dark:border-[#3c3c3c]">
                            <span className="font-mono text-[#0078d4] dark:text-[#3794ff] flex-shrink-0">{c.shortHash}</span>
                            <span className="text-[#1e1e1e] dark:text-[#ccc] truncate">{c.subject}</span>
                        </div>
                    ))}
                </div>
            </div>
        );
    }

    return (
        <div className="flex-1 flex items-center justify-center text-sm text-[#848484]" data-testid="git-detail-empty">
            Select a commit to view details
        </div>
    );
}

/** Only workspace/commit changes replace the host and its conversation. */
function CommitReviewDetail({ workspaceId, attachmentDestinationId, hash, commit, filePath,
    hunkTarget, onNavigateToCommitFile, onCommitClassified }: {
    workspaceId: string;
    attachmentDestinationId?: string;
    hash: string;
    commit?: GitCommitItem;
    filePath?: string;
    hunkTarget?: HunkTarget;
    onNavigateToCommitFile: RepoGitDetailPaneProps['onNavigateToCommitFile'];
    onCommitClassified: RepoGitDetailPaneProps['onCommitClassified'];
}) {
    const chat = useCommitChatPresentation({ workspaceId, commitHash: hash });
    const source = useMemo(() => createCommitDiffSource(workspaceId, hash, { commit }), [workspaceId, hash, commit]);
    return <div className="relative flex h-full min-h-0 flex-1">
        <div className="flex min-w-0 flex-1 flex-col">
            {filePath ? <FileDiffPanel
                workspaceId={workspaceId} attachmentDestinationId={attachmentDestinationId}
                source={source} filePath={filePath} reviewChat={chat}
                onNavigateToFile={(fp, target) => onNavigateToCommitFile(hash, fp, target)}
                initialHunkTarget={hunkTarget}
            /> : <CommitDetail
                workspaceId={workspaceId} attachmentDestinationId={attachmentDestinationId}
                hash={hash} commit={commit} reviewChat={chat} onClassified={onCommitClassified}
            />}
        </div>
        <CommitReviewChat workspaceId={workspaceId} sourceSelectionId={attachmentDestinationId} hash={hash} commitMessage={commit?.subject} chat={chat} />
    </div>;
}
