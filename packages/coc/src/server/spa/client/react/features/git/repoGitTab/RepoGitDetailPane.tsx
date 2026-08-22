/**
 * RepoGitDetailPane — the Git tab's right-hand detail surface.
 *
 * A pure switch over `RightPanelView`: commit detail, a commit's file diff, the
 * branch-range overview, a branch-range file diff, a working-tree file diff,
 * either all-comments view, a multi-commit summary, or the empty state.
 *
 * Presentational only — it holds no state and issues no requests, so the same
 * subtree renders identically inline (standalone layout) and portaled into the
 * shared detail region (split-workspace layout).
 */

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
    onAllBranchCommentsClick: () => void;
    onBranchAskAI: (mode: 'ask' | 'task') => void;
    onCommitClassified: () => void;
}

export function RepoGitDetailPane({
    workspaceId, view, commits, unpushedCount, branchRangeData, branchRangeFiles,
    baseMode, onBaseModeChange, repoRoot, hunkTarget, onBranchFileSelect,
    onNavigateToBranchFile, onNavigateToCommitFile, onNavigateToWorkingTreeFile,
    onAllBranchCommentsClick, onBranchAskAI, onCommitClassified,
}: RepoGitDetailPaneProps) {
    if (view?.type === 'commit') {
        return (
            <CommitDetail
                key={view.commit.hash}
                workspaceId={workspaceId}
                hash={view.commit.hash}
                commit={view.commit}
                onClassified={onCommitClassified}
            />
        );
    }

    if (view?.type === 'commit-file') {
        return (
            <FileDiffPanel
                key={`${view.hash}-${view.filePath}`}
                source={createCommitDiffSource(workspaceId, view.hash, {
                    commit: commits.find(c => c.hash === view.hash),
                })}
                workspaceId={workspaceId}
                filePath={view.filePath}
                onNavigateToFile={(fp, target) => onNavigateToCommitFile(view.hash, fp, target)}
                initialHunkTarget={hunkTarget}
            />
        );
    }

    if (view?.type === 'branch-range') {
        return (
            <BranchRangeOverview
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
                key={view.filePath}
                source={createBranchRangeDiffSource(workspaceId, {
                    files: (branchRangeFiles ?? []).map((f: { path: string }) => f.path).sort(),
                    baseMode,
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
                key={`${view.filePath}:${view.stage}`}
                workspaceId={workspaceId}
                filePath={view.filePath}
                stage={view.stage}
                repoRoot={repoRoot}
                onNavigateToFile={onNavigateToWorkingTreeFile}
                initialHunkTarget={hunkTarget}
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
