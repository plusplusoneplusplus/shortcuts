/**
 * Git history/object reads use native capabilities; commit/pending/staged patches use
 * the shared Rust patch backend with TypeScript workspace/WSL transport.
 * Native loading stays outside catches so missing capabilities remain visible.
 */

import * as path from 'path';
import { loadCommitMetadata, loadCommitPatch, loadPendingPatch, loadWorkingTreePatch } from '../diff/local-patch';
import { loadNativeGit } from '@plusplusoneplusplus/coc-native';
import type { NativeGitLogCommit } from '@plusplusoneplusplus/coc-native';
import { getLogger, LogCategory } from '../logger';
import { toForwardSlashes } from '../utils/path-utils';
import { GitCommit, GitCommitFile, CommitLoadOptions, CommitLoadResult } from './types';
import { loadGitHistory } from './git-history';
import { resolveWorkspaceExecutionContext } from '../utils/workspace-execution';
import { execGitAsync } from './exec';

/** Shared budget tolerates concurrent Git workers in large repositories. */
const GIT_COMMAND_TIMEOUT_MS = 30000;

/** Normalize paging values before the unsigned N-API boundary. */
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

export class GitLogService {
    private branchCache: Map<string, BranchCacheEntry> = new Map();
    private static readonly BRANCH_CACHE_TTL = 180_000; // 3 minutes

    /**
     * Get commits from a repository.
     */
    async getCommits(repoRoot: string, options: CommitLoadOptions): Promise<CommitLoadResult> {
        // Capability failures must stay visible rather than become empty history.
        const native = loadNativeGit();
        try {
            if (resolveWorkspaceExecutionContext(repoRoot).kind === 'wsl') {
                const maxCount = toUint32(options.maxCount);
                const commits = await loadGitHistory(repoRoot, {
                    maxCount: Math.min(maxCount + 1, 0xffffffff), skip: toUint32(options.skip),
                    search: options.search || undefined, includeDetails: true,
                }, undefined, true);
                const hasMore = commits.length > maxCount;
                let ahead = new Set<string>();
                try {
                    ahead = new Set((await execGitAsync(['rev-list', '@{upstream}..HEAD'], repoRoot)).split('\n'));
                } catch { /* No upstream means no unpushed decoration. */ }
                return {
                    commits: commits.slice(0, maxCount).map(commit => this.toGitCommit({
                        ...commit, isAheadOfRemote: ahead.has(commit.hash),
                    }, repoRoot)),
                    hasMore,
                };
            }
            const page = await native.gitLogCommits(repoRoot, {
                maxCount: toUint32(options.maxCount),
                skip: toUint32(options.skip),
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
            const commit = resolveWorkspaceExecutionContext(repoRoot).kind === 'wsl'
                ? (await loadGitHistory(repoRoot, { maxCount: 1, skip: 0, includeDetails: true }, hash))[0]
                : await native.gitLogCommit(repoRoot, hash);
            return commit ? this.toGitCommit(commit, repoRoot) : undefined;
        } catch (error) {
            getLogger().error(LogCategory.GIT, `Failed to get commit ${hash} from ${repoRoot}`, error instanceof Error ? error : undefined);
            return undefined;
        }
    }

    /**
     * Get files changed in a specific commit.
     *
     * Rust joins NUL-delimited metadata using the shared first-parent/root
     * patch plan. Binary counts stay absent; paths and Git ordering survive.
     */
    async getCommitFiles(repoRoot: string, commitHash: string): Promise<GitCommitFile[]> {
        loadNativeGit();
        try {
            const { parentHash, files } = await loadCommitMetadata(repoRoot, commitHash, GIT_COMMAND_TIMEOUT_MS);
            // Spread retains omitted counts/source paths exactly as Rust returns them.
            return files.map(file => ({
                ...file,
                commitHash,
                parentHash,
                repositoryRoot: repoRoot,
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
        loadNativeGit();
        try {
            return (await loadCommitPatch(repoRoot, commitHash)).content.raw;
        } catch (error) {
            getLogger().error(LogCategory.GIT, `Failed to get diff for commit ${commitHash}`, error instanceof Error ? error : undefined);
            return '';
        }
    }

    /**
     * Get the diff for pending changes (staged + unstaged).
     */
    async getPendingChangesDiff(repoRoot: string): Promise<string> {
        loadNativeGit();
        try {
            return (await loadPendingPatch(repoRoot)).content.raw;
        } catch (error) {
            getLogger().error(LogCategory.GIT, 'Failed to get pending changes diff', error instanceof Error ? error : undefined);
            return '';
        }
    }

    /**
     * Get the diff for staged changes only.
     */
    async getStagedChangesDiff(repoRoot: string): Promise<string> {
        loadNativeGit();
        try {
            return (await loadWorkingTreePatch(repoRoot, 'staged')).content.raw;
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
            // `dirty` is the same question `status --porcelain` was asked here:
            // did any line come back at all. Reading it off the repository
            // status keeps the porcelain text on Rust's side of the boundary,
            // and the answer does not change — `--untracked-files=all` only
            // splits an untracked directory into its files, which a boolean
            // cannot tell apart from the single entry `normal` reports.
            const { dirty } = await native.gitRepositoryStatus(repoRoot);
            return dirty;
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
            // Still argv: `gitRangeCountAhead` counts `<base>..<head>` and
            // needs both refs to resolve, so it cannot answer "everything
            // reachable from HEAD". A capability for the unbounded count has
            // to exist before this call site can move.
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

    private toGitCommit(commit: NativeGitLogCommit, repoRoot: string): GitCommit {
        return { ...commit, repositoryRoot: repoRoot, repositoryName: path.basename(repoRoot) };
    }
}
