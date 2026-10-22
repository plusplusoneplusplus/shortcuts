/**
 * BranchRangeAllComments — right-panel view showing all comments across all
 * branch-range files, grouped by file. Range file comments are stored under
 * the `branch-base`/`branch-head` refs (see `createBranchRangeDiffSource`).
 */

import { ReviewAllComments } from '../diff/ReviewAllComments';

export interface BranchRangeAllCommentsProps {
    workspaceId: string;
    /** Concrete review owner; omitted uses the workspace's own clone route. */
    attachmentDestinationId?: string;
    branchLabel: string;
}

export function BranchRangeAllComments({ workspaceId, attachmentDestinationId, branchLabel }: BranchRangeAllCommentsProps) {
    return <ReviewAllComments workspaceId={workspaceId} attachmentDestinationId={attachmentDestinationId}
        scope={{ kind: 'branch-range', label: branchLabel }} title={`Branch Changes: ${branchLabel} — All Comments`} testId="branch-range-all-comments" />;
}
