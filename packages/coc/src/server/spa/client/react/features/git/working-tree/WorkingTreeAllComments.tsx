/**
 * WorkingTreeAllComments — right-panel view showing all comments across all
 * working-tree files (staged + unstaged), grouped by file.
 */

import { ReviewAllComments } from '../diff/ReviewAllComments';

export interface WorkingTreeAllCommentsProps {
    workspaceId: string;
    /** Concrete review owner; omitted uses the workspace's own clone route. */
    attachmentDestinationId?: string;
}

const WORKING_TREE_SCOPE = { kind: 'working-tree' } as const;

export function WorkingTreeAllComments({ workspaceId, attachmentDestinationId }: WorkingTreeAllCommentsProps) {
    return <ReviewAllComments workspaceId={workspaceId} attachmentDestinationId={attachmentDestinationId}
        scope={WORKING_TREE_SCOPE} title="Working Changes — All Comments" testId="working-tree-all-comments" />;
}
