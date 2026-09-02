/**
 * GitLogService: commit history, diffs, and file content queries.
 *
 * Every method runs in the native addon, so nothing in this file starts a child
 * process. The reads that only touch objects and refs — history, a commit's
 * parent, a file's content at a commit, whether a ref names a commit, the
 * branch names — are `gix`-backed and spawn nothing at all; the diffs and the
 * `diff-tree` runs still shell out, from Rust, because their rename detection
 * and line counts follow git's own diff drivers.
 *
 * Unlike the rest of forge's git code this service never had a WSL branch — it
 * called `execAsync` directly rather than going through `execGitAsync` — so
 * there is no routing split to preserve, and every repository takes one path.
 *
 * `loadNativeGit()` sits outside every try/catch here. Every method in this
 * file answers failure with silence — an empty list, an empty string, an
 * `undefined` — and a missing or stale binary must not look like a repository
 * with no history in it.
 *
 * Extracted from `src/shortcuts/git/git-log-service.ts`.
 */

import * as path from 'path';
import { loadNativeGit } from '@plusplusoneplusplus/coc-native';
import type { NativeGitLogCommit } from '@plusplusoneplusplus/coc-native';
import { getLogger, LogCategory } from '../logger';
import { toForwardSlashes } from '../utils/path-utils';
import { GitCommit, GitCommitFile, GitChangeStatus, CommitLoadOptions, CommitLoadResult } from './types';

/**
 * Timeout (ms) applied to every git command this service runs.
 *
 * Many git commands can be in flight at once (e.g. across parallel test
 * workers). Under that contention the wall-clock time of an individual command
 * can exceed a tight per-call timeout even when the command itself is fast,
 * which would surface as spurious timeout failures. A single generous timeout
 * keeps behaviour consistent and robust under load.
 *
 * The 50 MiB output cap the diffs used to ask for is the addon's own default,
 * so it is no longer spelled out per call.
 */
const GIT_COMMAND_TIMEOUT_MS = 30000;

/**
 * Coerce a paging argument to the unsigned 32-bit integer the native boundary
 * takes.
 *
 * `git log -n` shrugged at a float or a negative number; N-API rejects the
 * conversion outright, so clamping keeps a sloppy caller working rather than
 * turning it into a new failure mode.
 */
function toUint32(value: number): number {
    if (!Number.isFinite(value) || value < 0) {
        return 0;
    }
    return Math.min(Math.floor(value), 0xffffffff);
}

interface BranchCacheEntry {
    branches: string[];
    timestamp: number;
}

/**
 * All public methods are asynchronous, so the single-threaded Node event loop
 * is never blocked by git I/O — whether the work happens in the addon or in a
 * child process.
 */
export class GitLogService {
    private branchCache: Map<string, BranchCacheEntry> = new Map();
    private static readonly BRANCH_CACHE_TTL = 180_000; // 3 minutes

    /**
     * Get commits from a repository.
     */
    async getCommits(repoRoot: string, options: CommitLoadOptions): Promise<CommitLoadResult> {
        // Deliberately outside the try: a missing or capability-stale binary is
        // a NativeAddonLoadError naming the rebuild, and an empty commit list
        // for a repository that has history is the one wrong answer here.
        const native = loadNativeGit();
        try {
            const page = await native.gitLogCommits(repoRoot, {
                maxCount: toUint32(options.maxCount),
                skip: toUint32(options.skip),
                // An empty search string has always meant "no filter", because
                // the old command only appended `--grep` when the value was
                // truthy.
                search: options.search || undefined,
            });
            return {
                commits: page.commits.map(commit => this.toGitCommit(commit, repoRoot)),
                hasMore: page.hasMore,
            };
        } catch (error) {
            getLogger().error(LogCategory.GIT, `Failed to get commits for ${repoRoot}`, error instanceof Error ? error : undefined);
            return { commits: [], hasMore: false };
        }
    }

    /**
     * Get a single commit by hash.
     */
    async getCommit(repoRoot: string, hash: string): Promise<GitCommit | undefined> {
        const native = loadNativeGit();
        try {
            const commit = await native.gitLogCommit(repoRoot, hash);
            return commit ? this.toGitCommit(commit, repoRoot) : undefined;
        } catch (error) {
            getLogger().error(LogCategory.GIT, `Failed to get commit ${hash} from ${repoRoot}`, error instanceof Error ? error : undefined);
            return undefined;
        }
    }

    /**
     * Get files changed in a specific commit.
     *
     * One crossing where there were three children: the parent comes from
     * `gix`, and the `--name-status` and `--numstat` runs are joined in Rust
     * rather than crossing the boundary as text.
     */
    async getCommitFiles(repoRoot: string, commitHash: string): Promise<GitCommitFile[]> {
        const native = loadNativeGit();
        try {
            const { parentHash, files } = await native.gitCommitFiles(repoRoot, commitHash, {
                timeout: GIT_COMMAND_TIMEOUT_MS,
            });
            // The three repository-level fields are the caller's own values, so
            // they are attached here rather than rebuilt in Rust. `additions`
            // and `deletions` stay *absent* when numstat had nothing to say —
            // a binary file — because the UI renders a blank column there.
            return files.map(file => ({
                path: file.path,
                ...(file.originalPath !== undefined ? { originalPath: file.originalPath } : {}),
                status: file.status as GitChangeStatus,
                commitHash,
                parentHash,
                repositoryRoot: repoRoot,
                ...(file.additions !== undefined ? { additions: file.additions } : {}),
                ...(file.deletions !== undefined ? { deletions: file.deletions } : {}),
            }));
        } catch (error) {
            getLogger().error(LogCategory.GIT, `Failed to get commit files for ${commitHash} from ${repoRoot}`, error instanceof Error ? error : undefined);
            return [];
        }
    }

    /**
     * Get the diff for a specific commit.
     */
    async getCommitDiff(repoRoot: string, commitHash: string): Promise<string> {
        const native = loadNativeGit();
        try {
            return await native.gitCommitDiff(repoRoot, commitHash, {
                timeout: GIT_COMMAND_TIMEOUT_MS,
            });
        } catch (error) {
            getLogger().error(LogCategory.GIT, `Failed to get diff for commit ${commitHash}`, error instanceof Error ? error : undefined);
            return '';
        }
    }

    /**
     * Get the diff for pending changes (staged + unstaged).
     */
    async getPendingChangesDiff(repoRoot: string): Promise<string> {
        const native = loadNativeGit();
        try {
            const unstaged = await native.execGit(['diff'], repoRoot, {
                timeout: GIT_COMMAND_TIMEOUT_MS,
            });
            const staged = await native.execGit(['diff', '--cached'], repoRoot, {
                timeout: GIT_COMMAND_TIMEOUT_MS,
            });

            let combined = '';
            if (staged.trim()) {
                combined += '# Staged Changes\n\n' + staged;
            }
            if (unstaged.trim()) {
                if (combined) {
                    combined += '\n\n';
                }
                combined += '# Unstaged Changes\n\n' + unstaged;
            }

            return combined;
        } catch (error) {
            getLogger().error(LogCategory.GIT, 'Failed to get pending changes diff', error instanceof Error ? error : undefined);
            return '';
        }
    }

    /**
     * Get the diff for staged changes only.
     */
    async getStagedChangesDiff(repoRoot: string): Promise<string> {
        const native = loadNativeGit();
        try {
            return await native.execGit(['diff', '--cached'], repoRoot, {
                timeout: GIT_COMMAND_TIMEOUT_MS,
            });
        } catch (error) {
            getLogger().error(LogCategory.GIT, 'Failed to get staged changes diff', error instanceof Error ? error : undefined);
            return '';
        }
    }

    /**
     * Check if there are any pending changes.
     */
    async hasPendingChanges(repoRoot: string): Promise<boolean> {
        const native = loadNativeGit();
        try {
            const output = await native.execGit(['status', '--porcelain'], repoRoot, {
                timeout: GIT_COMMAND_TIMEOUT_MS,
            });
            return output.trim().length > 0;
        } catch (error) {
            getLogger().error(LogCategory.GIT, 'Failed to check for pending changes', error instanceof Error ? error : undefined);
            return false;
        }
    }

    /**
     * Check if there are any staged changes.
     *
     * `--quiet` answers through the exit code: zero means nothing is staged,
     * and the non-zero exit that means "something is" reaches here as a
     * rejection.
     */
    async hasStagedChanges(repoRoot: string): Promise<boolean> {
        const native = loadNativeGit();
        try {
            await native.execGit(['diff', '--cached', '--quiet'], repoRoot, {
                timeout: GIT_COMMAND_TIMEOUT_MS,
            });
            return false;
        } catch {
            return true;
        }
    }

    /**
     * Check if there are more commits available.
     */
    async hasMoreCommits(repoRoot: string, currentCount: number): Promise<boolean> {
        const native = loadNativeGit();
        try {
            const output = await native.execGit(['rev-list', '--count', 'HEAD'], repoRoot, {
                timeout: GIT_COMMAND_TIMEOUT_MS,
            });
            const totalCount = parseInt(output.trim(), 10);
            return totalCount > currentCount;
        } catch (error) {
            getLogger().error(LogCategory.GIT, `Failed to check for more commits in ${repoRoot}`, error instanceof Error ? error : undefined);
            return false;
        }
    }

    /**
     * Get file content at a specific commit.
     *
     * The blob is read out of the object database rather than off `git show`'s
     * stdout, so the content keeps its trailing newline — every command that
     * crosses the native boundary loses one, and a file's bytes cannot.
     */
    async getFileContentAtCommit(repoRoot: string, commitHash: string, filePath: string): Promise<string | undefined> {
        const native = loadNativeGit();
        try {
            const content = await native.gitFileContentAtCommit(
                repoRoot,
                commitHash,
                toForwardSlashes(filePath),
            );
            return content ?? undefined;
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            getLogger().debug(
                LogCategory.GIT,
                `Failed to get file content for ${filePath} at commit ${commitHash}: ${message}`,
            );
            return undefined;
        }
    }

    /**
     * Check if a file exists at a specific commit.
     */
    async fileExistsAtCommit(repoRoot: string, commitHash: string, filePath: string): Promise<boolean> {
        const native = loadNativeGit();
        try {
            return await native.gitFileExistsAtCommit(
                repoRoot,
                commitHash,
                toForwardSlashes(filePath),
            );
        } catch {
            return false;
        }
    }

    /**
     * Validate a git ref and return the resolved commit hash.
     *
     * `rev-parse --verify` and `cat-file -t` in one crossing. Neither peeled,
     * so an annotated tag still resolves to a tag object and answers
     * `undefined`; a lightweight tag validates.
     */
    async validateRef(repoRoot: string, ref: string): Promise<string | undefined> {
        const native = loadNativeGit();
        try {
            return (await native.gitValidateRef(repoRoot, ref)) ?? undefined;
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            getLogger().debug(
                LogCategory.GIT,
                `validateRef failed for ref "${ref}" in ${repoRoot}: ${message}`,
            );
            return undefined;
        }
    }

    /**
     * Get branch names (cached, local branches only).
     *
     * The `HEAD` filter and the ten-name cap stay here: they are what this one
     * list chose to show, not what the repository holds.
     */
    async getBranches(repoRoot: string, forceRefresh = false): Promise<string[]> {
        if (!forceRefresh) {
            const cached = this.branchCache.get(repoRoot);
            if (cached && Date.now() - cached.timestamp < GitLogService.BRANCH_CACHE_TTL) {
                return cached.branches;
            }
        }

        // After the cache lookup, so a warm read never depends on the binary.
        const native = loadNativeGit();
        try {
            const names = await native.gitLocalBranchNames(repoRoot);
            const branches = names.filter(name => name && !name.includes('HEAD')).slice(0, 10);

            this.branchCache.set(repoRoot, {
                branches,
                timestamp: Date.now(),
            });

            return branches;
        } catch {
            return [];
        }
    }

    /**
     * Get branch names asynchronously (for non-blocking UI).
     *
     * Retained for backwards compatibility; now that {@link getBranches} is
     * itself non-blocking this simply checks the cache and delegates to it.
     */
    async getBranchesAsync(repoRoot: string): Promise<string[]> {
        const cached = this.branchCache.get(repoRoot);
        if (cached && Date.now() - cached.timestamp < GitLogService.BRANCH_CACHE_TTL) {
            return cached.branches;
        }

        return this.getBranches(repoRoot, true);
    }

    /**
     * Invalidate branch cache for a repository (or all).
     */
    invalidateBranchCache(repoRoot?: string): void {
        if (repoRoot) {
            this.branchCache.delete(repoRoot);
        } else {
            this.branchCache.clear();
        }
    }

    /**
     * Dispose: clear internal caches.
     */
    dispose(): void {
        this.branchCache.clear();
    }

    // -----------------------------------------------------------------------
    // Private helpers
    // -----------------------------------------------------------------------

    /**
     * Attach the two fields Rust does not build.
     *
     * `repositoryRoot` is the caller's own argument and `repositoryName` is
     * `path.basename` of it — Node's path semantics shaped every name the UI
     * has shown, so they stay here rather than being re-derived in Rust.
     */
    private toGitCommit(commit: NativeGitLogCommit, repoRoot: string): GitCommit {
        return { ...commit, repositoryRoot: repoRoot, repositoryName: path.basename(repoRoot) };
    }
}
