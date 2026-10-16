/** Loads the range through its owner and reuses the inline focused review surface. */

import { useEffect, useState } from 'react';
import { Spinner } from '../../ui';
import { getGitReviewClient } from '../../features/git/diff/diffSource';
import { BranchRangeOverview } from '../../features/git/branches/BranchRangeOverview';
import type { BranchRangeInfo } from '../../features/git/branches/BranchChanges';
import type { BranchRangeFile } from '../../features/git/branches/BranchAllFilesDiff';
import type { GitBranchRangeResponse, GitRangeBaseMode } from '@plusplusoneplusplus/coc-client';

export interface BranchRangeReviewContentProps {
    workspaceId: string;
    baseMode?: GitRangeBaseMode;
    attachmentDestinationId?: string;
}

export function BranchRangeReviewContent({ workspaceId, baseMode = 'default-branch', attachmentDestinationId }: BranchRangeReviewContentProps) {
    const [range, setRange] = useState<BranchRangeInfo | null>(null);
    const [files, setFiles] = useState<BranchRangeFile[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        let cancelled = false;
        setLoading(true);
        setError(null);
        setRange(null);
        setFiles([]);

        Promise.resolve().then(() => {
            const client = getGitReviewClient(workspaceId, attachmentDestinationId === workspaceId ? null : attachmentDestinationId);
            return Promise.all([
                client.git.getBranchRange(workspaceId, { base: baseMode }),
                client.git.listBranchRangeFiles(workspaceId, { base: baseMode }),
            ]);
        })
            .then(([rangeData, filesData]) => {
                if (cancelled) return;
                if (isBranchRangeInfo(rangeData)) setRange(rangeData);
                // Counts are optional on the wire; the rail renders them as numbers.
                if (filesData.files) {
                    setFiles(filesData.files.map(file => ({
                        ...file,
                        additions: file.additions ?? 0,
                        deletions: file.deletions ?? 0,
                    })));
                }
            })
            .catch((err: Error) => { if (!cancelled) setError(err.message); })
            .finally(() => { if (!cancelled) setLoading(false); });
        return () => { cancelled = true; };
    }, [workspaceId, baseMode, attachmentDestinationId]);

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
        <BranchRangeOverview workspaceId={workspaceId} attachmentDestinationId={attachmentDestinationId}
            range={range} files={files} isPopOut baseMode={baseMode} />
    );
}

function isBranchRangeInfo(data: GitBranchRangeResponse): data is BranchRangeInfo {
    return !('onDefaultBranch' in data) && typeof data.baseRef === 'string' && typeof data.headRef === 'string';
}
