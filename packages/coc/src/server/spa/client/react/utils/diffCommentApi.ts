/**
 * diffCommentApi — shared, pure (non-React) API utilities for diff comments.
 *
 * Extracted from useDiffComments so that hooks operating over multiple contexts
 * (e.g. useAllCommitComments) can derive storage keys and call the REST API
 * without depending on a single DiffCommentContext at hook construction time.
 */

import { getApiBase } from './config';
import type { DiffComment, DiffCommentContext } from '../../comments/diff-comment-types';
import type { UpdateDiffCommentRequest } from '../features/git/hooks/useDiffComments';
import { getCocClientForWorkspace } from '../repos/cloneRegistry';

// ============================================================================
// Storage key
// ============================================================================

/**
 * Compute SHA-256 storage key for a diff context.
 * Mirrors DiffCommentsManager.hashContext on the server:
 *   working-tree → sha256(repositoryId + filePath + 'working-tree')
 *   normal diff  → sha256(repositoryId + oldRef + newRef + filePath)
 */
export async function computeStorageKey(ctx: DiffCommentContext): Promise<string> {
    const input =
        ctx.newRef === 'working-tree'
            ? ctx.repositoryId + ctx.filePath + 'working-tree'
            : ctx.repositoryId + ctx.oldRef + ctx.newRef + ctx.filePath;
    const data = new TextEncoder().encode(input);
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    return Array.from(new Uint8Array(hashBuffer))
        .map(b => b.toString(16).padStart(2, '0'))
        .join('');
}

// ============================================================================
// URL builders
// ============================================================================

/** Per-comment URL for PATCH / DELETE / ask-ai. */
export function buildDiffCommentUrl(wsId: string, storageKey: string, commentId: string): string {
    return `${getApiBase()}/diff-comments/${encodeURIComponent(wsId)}/${storageKey}/${encodeURIComponent(commentId)}`;
}

// ============================================================================
// Fetch helpers
// ============================================================================

/** PATCH a diff comment. Returns the updated DiffComment. */
export async function patchDiffComment(
    wsId: string,
    storageKey: string,
    id: string,
    updates: UpdateDiffCommentRequest,
): Promise<DiffComment> {
    // Route to the workspace's clone (AC-07): remote clones hit their own server,
    // local/unknown ids resolve to the default origin (unchanged).
    const data = await getCocClientForWorkspace(wsId).git.updateDiffComment(wsId, storageKey, id, updates);
    return data.comment as DiffComment;
}

/** DELETE a diff comment. */
export async function deleteDiffCommentById(
    wsId: string,
    storageKey: string,
    id: string,
): Promise<void> {
    await getCocClientForWorkspace(wsId).git.deleteDiffComment(wsId, storageKey, id);
}
