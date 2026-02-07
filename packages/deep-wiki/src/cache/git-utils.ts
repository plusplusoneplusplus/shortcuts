/**
 * Cache Layer — Git Utilities
 *
 * Provides git-related utilities for cache invalidation.
 * Uses `git rev-parse HEAD` for hash detection and
 * `git diff --name-only` for change detection.
 *
 * Cross-platform compatible (Linux/Mac/Windows).
 */

import { execAsync } from '@plusplusoneplusplus/pipeline-core';

// ============================================================================
// Git Hash Detection
// ============================================================================

/**
 * Get the current HEAD hash for a git repository.
 *
 * @param repoPath - Path to the git repository
 * @returns The HEAD hash string, or null if not a git repo
 */
export async function getRepoHeadHash(repoPath: string): Promise<string | null> {
    try {
        const result = await execAsync('git rev-parse HEAD', { cwd: repoPath });
        const hash = result.stdout.trim();
        // Validate it looks like a git hash
        if (/^[0-9a-f]{40}$/.test(hash)) {
            return hash;
        }
        return null;
    } catch {
        return null;
    }
}

// ============================================================================
// Change Detection
// ============================================================================

/**
 * Get the list of files that changed since a given git hash.
 *
 * @param repoPath - Path to the git repository
 * @param sinceHash - Git hash to compare against
 * @returns Array of changed file paths (relative to repo root), or null on error
 */
export async function getChangedFiles(repoPath: string, sinceHash: string): Promise<string[] | null> {
    try {
        const result = await execAsync(`git diff --name-only ${sinceHash} HEAD`, { cwd: repoPath });
        const files = result.stdout
            .trim()
            .split('\n')
            .filter(line => line.length > 0);
        return files;
    } catch {
        return null;
    }
}

/**
 * Check if a repository has any changes since a given hash.
 *
 * @param repoPath - Path to the git repository
 * @param sinceHash - Git hash to compare against
 * @returns True if there are changes, false if unchanged, null on error
 */
export async function hasChanges(repoPath: string, sinceHash: string): Promise<boolean | null> {
    const files = await getChangedFiles(repoPath, sinceHash);
    if (files === null) {
        return null;
    }
    return files.length > 0;
}

/**
 * Check if git is available in the system PATH.
 *
 * @returns True if git command is available
 */
export async function isGitAvailable(): Promise<boolean> {
    try {
        await execAsync('git --version');
        return true;
    } catch {
        return false;
    }
}

/**
 * Check if a path is inside a git repository.
 *
 * @param dirPath - Path to check
 * @returns True if inside a git repo
 */
export async function isGitRepo(dirPath: string): Promise<boolean> {
    try {
        const result = await execAsync('git rev-parse --is-inside-work-tree', { cwd: dirPath });
        return result.stdout.trim() === 'true';
    } catch {
        return false;
    }
}
