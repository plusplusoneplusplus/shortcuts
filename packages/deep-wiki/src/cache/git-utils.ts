/**
 * Cache Layer — Git Utilities
 *
 * Provides git-related utilities for cache invalidation.
 * Uses `git rev-parse HEAD` for repo-wide hash detection,
 * `git log -1 --format=%H -- <folder>` for subfolder-scoped hash,
 * and `git diff --name-only` for change detection.
 *
 * Cross-platform compatible (Linux/Mac/Windows).
 */

import * as path from 'path';
import { execAsync } from '@plusplusoneplusplus/pipeline-core';

// ============================================================================
// Git Root Detection
// ============================================================================

/**
 * Get the git root directory for a path.
 *
 * @param repoPath - Path inside a git repository
 * @returns The absolute path to the git root, or null if not inside a git repo
 */
export async function getGitRoot(repoPath: string): Promise<string | null> {
    try {
        const result = await execAsync('git rev-parse --show-toplevel', { cwd: repoPath });
        const root = result.stdout.trim();
        if (root.length > 0) {
            return root;
        }
        return null;
    } catch {
        return null;
    }
}

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

/**
 * Get a folder-scoped HEAD hash for a path.
 *
 * When `repoPath` is a subfolder of a git repo (not the repo root), returns
 * the hash of the last commit that touched files within that subfolder via
 * `git log -1 --format=%H -- <folder>`. This prevents cache invalidation
 * when unrelated parts of the repo change.
 *
 * When `repoPath` IS the git root, falls back to `git rev-parse HEAD`
 * (same as `getRepoHeadHash`).
 *
 * @param repoPath - Path to the git repository or subfolder
 * @returns The scoped hash string, or null if not a git repo
 */
export async function getFolderHeadHash(repoPath: string): Promise<string | null> {
    try {
        const gitRoot = await getGitRoot(repoPath);
        if (!gitRoot) {
            return null;
        }

        const resolvedRepo = path.resolve(repoPath);
        const resolvedRoot = path.resolve(gitRoot);

        // If repoPath IS the git root, fall back to repo-wide HEAD
        if (resolvedRepo === resolvedRoot) {
            return getRepoHeadHash(repoPath);
        }

        // Subfolder: get the last commit that touched this folder
        // Use the relative path from git root to the subfolder
        const relativePath = path.relative(resolvedRoot, resolvedRepo).replace(/\\/g, '/');
        const result = await execAsync(
            `git log -1 --format=%H -- "${relativePath}"`,
            { cwd: resolvedRoot }
        );
        const hash = result.stdout.trim();

        // Validate it looks like a git hash
        if (/^[0-9a-f]{40}$/.test(hash)) {
            return hash;
        }

        // No commits touching this folder — fall back to repo HEAD
        return getRepoHeadHash(repoPath);
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
 * When `scopePath` is provided, the returned file list is filtered to only
 * include files under the scope path, and paths are remapped to be relative
 * to `scopePath` instead of the git root. This is essential for subfolder
 * cache invalidation where module paths in the graph are relative to the
 * subfolder, not the git root.
 *
 * @param repoPath - Path to the git repository
 * @param sinceHash - Git hash to compare against
 * @param scopePath - Optional subfolder to scope results to. When provided,
 *                    only files under this path are returned, with paths
 *                    relative to it.
 * @returns Array of changed file paths, or null on error
 */
export async function getChangedFiles(
    repoPath: string,
    sinceHash: string,
    scopePath?: string
): Promise<string[] | null> {
    try {
        const result = await execAsync(`git diff --name-only ${sinceHash} HEAD`, { cwd: repoPath });
        let files = result.stdout
            .trim()
            .split('\n')
            .filter(line => line.length > 0);

        // If a scope path is specified, filter and remap paths
        if (scopePath) {
            const gitRoot = await getGitRoot(repoPath);
            if (gitRoot) {
                const resolvedScope = path.resolve(scopePath);
                const resolvedRoot = path.resolve(gitRoot);
                // Get the scope's path relative to git root (forward slashes)
                const scopeRelative = path.relative(resolvedRoot, resolvedScope).replace(/\\/g, '/');

                if (scopeRelative && scopeRelative !== '.') {
                    const prefix = scopeRelative + '/';
                    files = files
                        .filter(f => {
                            const normalized = f.replace(/\\/g, '/');
                            return normalized.startsWith(prefix) || normalized === scopeRelative;
                        })
                        .map(f => {
                            const normalized = f.replace(/\\/g, '/');
                            return normalized.startsWith(prefix) ? normalized.slice(prefix.length) : normalized;
                        });
                }
                // If scopeRelative is empty or '.', repoPath IS the git root — no filtering needed
            }
        }

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
