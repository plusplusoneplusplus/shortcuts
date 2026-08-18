/**
 * Branch-range adapter for the pop-out review kernel.
 *
 * Loads the range summary and its file list, then reuses the same review model,
 * comment-count mapping, and layout as commit/PR review. It has not opted into
 * classification, review progress, or chat, so those capabilities are simply
 * omitted rather than reimplemented.
 */

import { useEffect, useMemo, useState } from 'react';
import { Spinner } from '../../ui';
import { getCocClientForWorkspace } from '../../repos/cloneRegistry';
import { BranchRangeOverview } from '../../features/git/branches/BranchRangeOverview';
import { FileDiffPanel } from '../../features/git/diff/FileDiffPanel';
import { createBranchRangeDiffSource } from '../../features/git/diff/diffSource';
import { PopOutReviewLayout } from './PopOutReviewLayout';
import { useFileCommentMap } from './useFileCommentMap';
import { popOutDiffPanelProps, usePopOutReviewModel } from './usePopOutReviewModel';
import type { GitCommitItem } from '../../features/git/commits/CommitList';
import type { BranchRangeInfo } from '../../features/git/branches/BranchChanges';
import type { BranchRangeFile } from '../../features/git/branches/BranchAllFilesDiff';
import type { FileChange } from '../../features/git/diff/FileTree';
import type { GitBranchRangeResponse, GitRangeBaseMode } from '@plusplusoneplusplus/coc-client';

export interface BranchRangeReviewContentProps {
    workspaceId: string;
    baseMode?: GitRangeBaseMode;
}

export function BranchRangeReviewContent({ workspaceId, baseMode = 'default-branch' }: BranchRangeReviewContentProps) {
    const [range, setRange] = useState<BranchRangeInfo | null>(null);
    const [commits, setCommits] = useState<GitCommitItem[]>([]);
    const [files, setFiles] = useState<BranchRangeFile[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        setLoading(true);
        setError(null);

        const client = getCocClientForWorkspace(workspaceId);
        Promise.all([
            client.git.getBranchRange(workspaceId, { base: baseMode }),
            client.git.listBranchRangeFiles(workspaceId, { base: baseMode }),
        ])
            .then(([rangeData, filesData]) => {
                if (isBranchRangeInfo(rangeData)) setRange(rangeData);
                if (isBranchRangeInfo(rangeData) && rangeData.commits) setCommits(rangeData.commits);
                // Counts are optional on the wire; the rail renders them as numbers.
                if (filesData.files) {
                    setFiles(filesData.files.map(file => ({
                        ...file,
                        additions: file.additions ?? 0,
                        deletions: file.deletions ?? 0,
                    })));
                }
            })
            .catch((err: Error) => setError(err.message))
            .finally(() => setLoading(false));
    }, [workspaceId, baseMode]);

    // Convert BranchRangeFile[] to FileChange[] for the file panel
    const fileChanges: FileChange[] = useMemo(() => files.map(f => ({
        status: f.status,
        path: f.path,
        additions: f.additions,
        deletions: f.deletions,
        oldPath: f.oldPath,
    })), [files]);

    const model = usePopOutReviewModel({ files: fileChanges });
    // Comment counts for the branch range (uses literal refs like BranchChanges)
    const fileCommentMap = useFileCommentMap(workspaceId, 'branch-base', 'branch-head', fileChanges);

    if (loading) {
        return (
            <div className="flex items-center justify-center flex-1 gap-2 text-xs text-[#848484]">
                <Spinner size="sm" /> Loading branch range…
            </div>
        );
    }

    if (error || !range) {
        return (
            <div className="flex items-center justify-center flex-1 text-xs text-[#d32f2f] dark:text-[#f48771]">
                {error || 'No branch range data available.'}
            </div>
        );
    }

    return (
        <PopOutReviewLayout
            workspaceId={workspaceId}
            files={fileChanges}
            model={model}
            fileCommentMap={fileCommentMap}
            renderDiff={filePath => (
                <FileDiffPanel
                    key={filePath}
                    workspaceId={workspaceId}
                    filePath={filePath}
                    source={createBranchRangeDiffSource(workspaceId, {
                        files: files.map(file => file.path).sort(),
                        baseMode,
                    })}
                    {...popOutDiffPanelProps(model, filePath)}
                />
            )}
            overview={(
                <BranchRangeOverview
                    workspaceId={workspaceId}
                    range={range}
                    commits={commits}
                    files={files}
                    isPopOut
                    baseMode={baseMode}
                />
            )}
        />
    );
}

function isBranchRangeInfo(data: GitBranchRangeResponse): data is BranchRangeInfo {
    return !('onDefaultBranch' in data) && typeof data.baseRef === 'string' && typeof data.headRef === 'string';
}
