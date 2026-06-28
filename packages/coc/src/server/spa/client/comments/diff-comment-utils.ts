/**
 * Diff Comment Utilities
 *
 * Browser-compatible helpers for diff comments.
 * Browser-compatible with no platform dependencies.
 */

/**
 * Compute the SHA-256 storage key for a diff context.
 *
 * Mirrors DiffCommentsManager.hashContext on the server:
 *   working-tree → sha256(repositoryId + filePath + 'working-tree')
 *   normal diff  → sha256(repositoryId + oldRef + newRef + filePath)
 */
export async function computeDiffCommentKey(
    repositoryId: string,
    oldRef: string,
    newRef: string,
    filePath: string,
): Promise<string> {
    const input = newRef === 'working-tree'
        ? repositoryId + filePath + 'working-tree'
        : repositoryId + oldRef + newRef + filePath;
    const data = new TextEncoder().encode(input);
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    return Array.from(new Uint8Array(hashBuffer))
        .map(b => b.toString(16).padStart(2, '0'))
        .join('');
}
