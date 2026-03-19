/**
 * Utilities for working with git refs (commit hashes, branch names, etc.)
 */

import { execSync } from 'child_process';
import { DiffGitContext } from './types';

/**
 * Check if a string is a full git commit hash (40 hex characters)
 */
export function isFullCommitHash(ref: string): boolean {
    return /^[a-f0-9]{40}$/i.test(ref);
}

/**
 * Shorten a git ref for display using git's auto abbreviation.
 * Only shortens full commit hashes (40 hex chars), leaves special refs unchanged.
 *
 * @param ref - The git ref to shorten (commit hash, HEAD, WORKING_TREE, etc.)
 * @param repoRoot - The repository root path for running git commands
 * @returns The shortened ref or the original ref if not a full commit hash
 */
export async function shortenGitRef(ref: string, repoRoot: string): Promise<string> {
    // Only shorten full commit hashes
    if (!isFullCommitHash(ref)) {
        return ref;
    }

    try {
        const result = execSync(
            `git -c core.abbrev=auto rev-parse --short ${ref}`,
            { cwd: repoRoot, encoding: 'utf8', timeout: 5000 }
        );
        return result.trim();
    } catch {
        // Fallback to 7 chars if git command fails
        return ref.substring(0, 7);
    }
}

/**
 * Synchronous version of shortenGitRef for cases where async is not possible.
 * Uses git's auto abbreviation.
 *
 * @param ref - The git ref to shorten
 * @param repoRoot - The repository root path
 * @returns The shortened ref or the original ref if not a full commit hash
 */
export function shortenGitRefSync(ref: string, repoRoot: string): string {
    if (!isFullCommitHash(ref)) {
        return ref;
    }

    try {
        const result = execSync(
            `git -c core.abbrev=auto rev-parse --short ${ref}`,
            { cwd: repoRoot, encoding: 'utf8', timeout: 5000 }
        );
        return result.trim();
    } catch {
        return ref.substring(0, 7);
    }
}

/**
 * Get shortened display refs for a git context.
 * Shortens both oldRef and newRef in parallel for efficiency.
 *
 * @param gitContext - The git context containing refs to shorten
 * @returns Object with shortened oldRef and newRef
 */
export async function getDisplayRefs(gitContext: DiffGitContext): Promise<{ oldRef: string; newRef: string }> {
    const [oldRef, newRef] = await Promise.all([
        shortenGitRef(gitContext.oldRef, gitContext.repositoryRoot),
        shortenGitRef(gitContext.newRef, gitContext.repositoryRoot)
    ]);
    return { oldRef, newRef };
}
