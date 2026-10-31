import type { DiffCommentContext } from '../../../../comments/diff-comment-types';

/** Comment context of one working-tree file; untracked files have none. */
export function workingTreeCommentContext(workspaceId: string, filePath: string, stage: 'staged' | 'unstaged' | 'untracked'): DiffCommentContext | null {
    return stage !== 'untracked'
        ? { repositoryId: workspaceId, filePath, oldRef: stage === 'staged' ? 'HEAD' : 'INDEX', newRef: 'working-tree' }
        : null;
}
