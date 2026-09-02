/**
 * Cache Layer — Git Utilities
 *
 * Provides git-related utilities for cache invalidation.
 *
 * Nothing here spawns a child process from Node. Repository discovery reads the
 * repository with `gix` in the native addon; the three commands that stay on the
 * git CLI (`rev-parse HEAD`, `log -1 --format=%H -- <folder>`,
 * `diff --name-only`) run it from Rust on a libuv worker, addressed with an
 * argv array rather than the shell string this module used to build. That last
 * part is not only a spawn move: `sinceHash` and the folder path used to be
 * interpolated into a command line the shell then re-split.
 *
 * A missing or capability-stale addon binary is *not* treated as "no git here".
 * Every function below answers failure with `null`/`false`, and the four caches
 * read that as "the repository changed" — so a broken install would silently
 * re-run the whole wiki instead of naming the rebuild. `NativeAddonLoadError`
 * is rethrown out of every catch for that reason.
 *
 * Cross-platform compatible (Linux/Mac/Windows).
 */

import * as path from 'path';
import { execGitAsync } from '@plusplusoneplusplus/forge';
import { loadNativeGit, NativeAddonLoadError } from '@plusplusoneplusplus/coc-native';

/**
 * Let a broken addon binary out of a catch that otherwise swallows everything.
 *
 * Every function in this module reports a git failure as an absent answer, and
 * an absent answer here means "invalidate the cache". Without this, a binary
 * that failed to load would rebuild every article on every run and never say
 * why.
 */
function rethrowIfAddonUnavailable(err: unknown): void {
    if (err instanceof NativeAddonLoadError) {
        throw err;
    }
}

// ============================================================================
// Git Root Detection
// ============================================================================

/**
 * Get the git root directory for a path.
 *
 * Reads the repository with `gix` — no child process, and the answer is the
 * path discovery walked rather than the physical path `rev-parse --show-toplevel`
 * printed. That difference is a fix, not a regression: both callers below
 * compare this root against the caller's own spelling of the path, so a
 * repository reached through a symlink (`os.tmpdir()` on macOS is the everyday
 * one) used to produce a relative path that pointed outside the repository.
 *
 * @returns The absolute path to the git root, or null if not inside a git repo
 */
export async function getGitRoot(repoPath: string): Promise<string | null> {
    try {
        const root = await loadNativeGit().gitDiscoverRepoRoot(path.resolve(repoPath));
        if (root && root.length > 0) {
            return root;
        }
        return null;
    } catch (err: unknown) {
        rethrowIfAddonUnavailable(err);
        return null;
    }
}

// ============================================================================
// Git Hash Detection
// ============================================================================

/**
 * Get the current HEAD hash for a git repository.
 *
 * Stays on `git rev-parse HEAD` rather than moving to the addon's `gix`-backed
 * commit reader: that reader builds a `%D` decoration map over every ref, which
 * costs more on a real repository than the one child process it would remove.
 *
 * @returns The HEAD hash string, or null if not a git repo
 */
export async function getRepoHeadHash(repoPath: string): Promise<string | null> {
    try {
        const stdout = await execGitAsync(['rev-parse', 'HEAD'], repoPath);
        const hash = stdout.trim();
        // Validate it looks like a git hash
        if (/^[0-9a-f]{40}$/.test(hash)) {
            return hash;
        }
        return null;
    } catch (err: unknown) {
        rethrowIfAddonUnavailable(err);
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
        // The pathspec is an argv entry now, so a folder holding a space or a
        // quote reaches git as itself instead of as whatever the shell made of
        // the `"…"` this used to wrap it in.
        const stdout = await execGitAsync(
            ['log', '-1', '--format=%H', '--', relativePath],
            resolvedRoot,
        );
        const hash = stdout.trim();

        // Validate it looks like a git hash
        if (/^[0-9a-f]{40}$/.test(hash)) {
            return hash;
        }

        // No commits touching this folder — fall back to repo HEAD
        return getRepoHeadHash(repoPath);
    } catch (err: unknown) {
        rethrowIfAddonUnavailable(err);
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
        // `sinceHash` is an argv entry rather than a word in a command line, so
        // a caller's stored hash can no longer be re-read by a shell.
        const stdout = await execGitAsync(
            ['diff', '--name-only', sinceHash, 'HEAD'],
            repoPath,
        );
        let files = stdout
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
    } catch (err: unknown) {
        rethrowIfAddonUnavailable(err);
        return null;
    }
}

/**
 * Check if a repository has any changes since a given hash.
 *
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
 * `git --version` has no repository to be pointed at, so it is addressed with
 * `-C <cwd>` — which is where the shell command this replaced ran it anyway.
 * (Spelling the old command line out here would put a git shell string back
 * into the inventory grep that has to stay empty.)
 */
export async function isGitAvailable(): Promise<boolean> {
    try {
        await execGitAsync(['--version'], process.cwd());
        return true;
    } catch (err: unknown) {
        rethrowIfAddonUnavailable(err);
        return false;
    }
}

/**
 * Check if a path is inside a git repository.
 *
 * One divergence from the `git rev-parse --is-inside-work-tree` this replaces:
 * inside a repository's own `.git` directory git answered `false` and discovery
 * answers `true`. Nothing asks that question — the callers pass a repository or
 * a source subfolder — and the alternative is teaching this module where a git
 * directory lives.
 */
export async function isGitRepo(dirPath: string): Promise<boolean> {
    return (await getGitRoot(dirPath)) !== null;
}
