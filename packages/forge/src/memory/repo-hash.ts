/**
 * Compute a stable 16-char hex hash for a repository root path.
 *
 * @deprecated For repo-level memory, use the `repoDir` option on
 * `MemoryStoreOptions` instead. This function remains for git-remote
 * level hashing and backward compatibility.
 */
import * as crypto from 'crypto';
import * as path from 'path';

export function computeRepoHash(repoPath: string): string {
    return crypto
        .createHash('sha256')
        .update(path.resolve(repoPath))
        .digest('hex')
        .substring(0, 16);
}
