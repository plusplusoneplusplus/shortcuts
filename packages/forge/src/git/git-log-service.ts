/**
 * GitLogService: commit history, diffs, and file content queries.
 *
 * Reading history — `getCommits` and `getCommit` — runs in the native addon on
 * a libuv worker, backed by `gix`. That path spawns nothing at all, where the
 * TypeScript it replaced spawned three children for a single page: `git log`,
 * `git rev-parse --abbrev-ref @{upstream}`, and a second `git log` for the
 * unpushed set. Everything else here still shells out through `execAsync` and
 * moves in a later slice.
 *
 * Unlike the rest of forge's git code this service never had a WSL branch — it
 * called `execAsync` directly rather than going through `execGitAsync` — so
 * there is no routing split to preserve, and every repository takes one path.
 *
 * Extracted from `src/shortcuts/git/git-log-service.ts`.
 */

import * as path from 'path';
import { loadNativeGit } from '@plusplusoneplusplus/coc-native';
import type { NativeGitLogCommit } from '@plusplusoneplusplus/coc-native';
import { getLogger, LogCategory } from '../logger';
import { execAsync } from '../utils/exec-utils';
import { toForwardSlashes } from '../utils/path-utils';
import { GitCommit, GitCommitFile, GitChangeStatus, CommitLoadOptions, CommitLoadResult } from './types';

/**
 * Timeout (ms) applied to every git command spawned by this service.
 *
 * Now that git I/O runs asynchronously, many git processes can
 * be spawned concurrently (e.g. across parallel test workers). Under that
 * contention the wall-clock time of an individual command can exceed a tight
 * per-call timeout even when the command itself is fast, which would surface as
 * spurious ETIMEDOUT failures. A single generous timeout keeps behaviour
 * consistent and robust under load.
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

/**
 * Branch cache entry with timestamp.
 */
interface BranchCacheEntry {
    branches: string[];
    timestamp: number;
}

/**
 * Service for retrieving git commit history, diffs, and branch information.
 *
 * All public methods are asynchronous, so the single-threaded Node event loop
 * is never blocked by git I/O — whether the work happens in the addon or in a
 * child process.
 */
export class GitLogService {
    private branchCache: Map<string, BranchCacheEntry> = new Map();
    private static readonly BRANCH_CACHE_TTL = 180_000; // 3 minutes
    private static readonly EMPTY_TREE_HASH = '4b825dc642cb6eb9a060e54bf8d69288fbee4904';

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
     */
    async getCommitFiles(repoRoot: string, commitHash: string): Promise<GitCommitFile[]> {
        try {
            const parentHash = await this.getParentHash(repoRoot, commitHash);

            const command = `git diff-tree --no-commit-id --name-status -r -M -C ${commitHash}`;

            const { stdout: output } = await execAsync(command, {
                cwd: repoRoot,
                timeout: GIT_COMMAND_TIMEOUT_MS,
            });

            if (!output.trim()) {
                return [];
            }

            const files: GitCommitFile[] = [];
            const lines = output.trim().split('\n');

            for (const line of lines) {
                const file = this.parseFileLine(line, commitHash, parentHash, repoRoot);
                if (file) {
                    files.push(file);
                }
            }

            // Fetch per-file line stats via --numstat and merge into results
            const numstatMap = await this.getNumstatMap(repoRoot, commitHash);
            for (const file of files) {
                const stats = numstatMap.get(file.path);
                if (stats) {
                    file.additions = stats.additions;
                    file.deletions = stats.deletions;
                }
            }

            return files;
        } catch (error) {
            getLogger().error(LogCategory.GIT, `Failed to get commit files for ${commitHash} from ${repoRoot}`, error instanceof Error ? error : undefined);
            return [];
        }
    }

    /**
     * Get the diff for a specific commit.
     */
    async getCommitDiff(repoRoot: string, commitHash: string): Promise<string> {
        try {
            const parentHash = await this.getParentHash(repoRoot, commitHash);

            const command = `git diff ${parentHash} ${commitHash}`;
            const { stdout: output } = await execAsync(command, {
                cwd: repoRoot,
                maxBuffer: 50 * 1024 * 1024,
                timeout: GIT_COMMAND_TIMEOUT_MS,
            });

            return output;
        } catch (error) {
            getLogger().error(LogCategory.GIT, `Failed to get diff for commit ${commitHash}`, error instanceof Error ? error : undefined);
            return '';
        }
    }

    /**
     * Get the diff for pending changes (staged + unstaged).
     */
    async getPendingChangesDiff(repoRoot: string): Promise<string> {
        try {
            const { stdout: unstaged } = await execAsync('git diff', {
                cwd: repoRoot,
                maxBuffer: 50 * 1024 * 1024,
                timeout: GIT_COMMAND_TIMEOUT_MS,
            });

            const { stdout: staged } = await execAsync('git diff --cached', {
                cwd: repoRoot,
                maxBuffer: 50 * 1024 * 1024,
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
        try {
            const command = 'git diff --cached';
            const { stdout: output } = await execAsync(command, {
                cwd: repoRoot,
                maxBuffer: 50 * 1024 * 1024,
                timeout: GIT_COMMAND_TIMEOUT_MS,
            });

            return output;
        } catch (error) {
            getLogger().error(LogCategory.GIT, 'Failed to get staged changes diff', error instanceof Error ? error : undefined);
            return '';
        }
    }

    /**
     * Check if there are any pending changes.
     */
    async hasPendingChanges(repoRoot: string): Promise<boolean> {
        try {
            const command = 'git status --porcelain';
            const { stdout: output } = await execAsync(command, {
                cwd: repoRoot,
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
     */
    async hasStagedChanges(repoRoot: string): Promise<boolean> {
        try {
            const command = 'git diff --cached --quiet';
            await execAsync(command, {
                cwd: repoRoot,
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
        try {
            const command = 'git rev-list --count HEAD';
            const { stdout: output } = await execAsync(command, {
                cwd: repoRoot,
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
     */
    async getFileContentAtCommit(repoRoot: string, commitHash: string, filePath: string): Promise<string | undefined> {
        try {
            const normalizedPath = toForwardSlashes(filePath);

            const command = `git show "${commitHash}:${normalizedPath}"`;
            const { stdout: output } = await execAsync(command, {
                cwd: repoRoot,
                maxBuffer: 50 * 1024 * 1024,
                timeout: GIT_COMMAND_TIMEOUT_MS,
            });

            return output;
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
        try {
            const normalizedPath = toForwardSlashes(filePath);
            await execAsync(`git cat-file -e "${commitHash}:${normalizedPath}"`, {
                cwd: repoRoot,
                timeout: GIT_COMMAND_TIMEOUT_MS,
            });
            return true;
        } catch {
            return false;
        }
    }

    /**
     * Validate a git ref and return the resolved commit hash.
     */
    async validateRef(repoRoot: string, ref: string): Promise<string | undefined> {
        try {
            const command = `git rev-parse --verify "${ref}"`;
            const { stdout: output } = await execAsync(command, {
                cwd: repoRoot,
                timeout: GIT_COMMAND_TIMEOUT_MS,
            });
            const hash = output.trim();

            const typeCommand = `git cat-file -t "${hash}"`;
            const { stdout: typeOutput } = await execAsync(typeCommand, {
                cwd: repoRoot,
                timeout: GIT_COMMAND_TIMEOUT_MS,
            });

            if (typeOutput.trim() === 'commit') {
                return hash;
            }
            return undefined;
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
     */
    async getBranches(repoRoot: string, forceRefresh = false): Promise<string[]> {
        if (!forceRefresh) {
            const cached = this.branchCache.get(repoRoot);
            if (cached && Date.now() - cached.timestamp < GitLogService.BRANCH_CACHE_TTL) {
                return cached.branches;
            }
        }

        try {
            const { stdout: output } = await execAsync('git branch --format="%(refname:short)"', {
                cwd: repoRoot,
                timeout: GIT_COMMAND_TIMEOUT_MS,
            });
            const branches = output.trim().split('\n')
                .filter(b => b && !b.includes('HEAD'))
                .slice(0, 10);

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

    private async getParentHash(repoRoot: string, commitHash: string): Promise<string> {
        try {
            const command = `git rev-parse ${commitHash}~1`;
            const { stdout: output } = await execAsync(command, {
                cwd: repoRoot,
                timeout: GIT_COMMAND_TIMEOUT_MS,
            });
            return output.trim();
        } catch {
            return GitLogService.EMPTY_TREE_HASH;
        }
    }

    /**
     * Get per-file additions/deletions from --numstat for a commit.
     */
    private async getNumstatMap(repoRoot: string, commitHash: string): Promise<Map<string, { additions: number; deletions: number }>> {
        const map = new Map<string, { additions: number; deletions: number }>();
        try {
            const command = `git diff-tree --no-commit-id --numstat -r -M -C ${commitHash}`;
            const { stdout: output } = await execAsync(command, {
                cwd: repoRoot,
                timeout: GIT_COMMAND_TIMEOUT_MS,
            });

            if (!output.trim()) {
                return map;
            }

            for (const line of output.trim().split('\n')) {
                if (!line.trim()) { continue; }
                // Format: "additions\tdeletions\tpath" or for renames "additions\tdeletions\toldpath => newpath"
                const parts = line.split('\t');
                if (parts.length < 3) { continue; }

                const addStr = parts[0];
                const delStr = parts[1];

                // Binary files show '-' for additions/deletions
                if (addStr === '-' || delStr === '-') { continue; }

                const additions = parseInt(addStr, 10);
                const deletions = parseInt(delStr, 10);
                if (isNaN(additions) || isNaN(deletions)) { continue; }

                // For renames/copies, the path column may be "old => new" or "{prefix/old => new}/suffix"
                // The last tab-separated field is the path; for renames with -M/-C, it shows the new path
                let filePath = parts.slice(2).join('\t');
                // Handle rename format: "{old => new}" or "old => new"
                const renameMatch = filePath.match(/^(.*)\{.* => (.*)\}(.*)$/) || filePath.match(/^.* => (.*)$/);
                if (renameMatch) {
                    if (renameMatch.length === 4) {
                        // "{prefix/old => new}/suffix" format
                        filePath = renameMatch[1] + renameMatch[2] + renameMatch[3];
                    } else {
                        // "old => new" format
                        filePath = renameMatch[1];
                    }
                }

                map.set(filePath, { additions, deletions });
            }
        } catch {
            // Non-critical: stats are optional decoration
        }
        return map;
    }

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

    private parseFileLine(
        line: string,
        commitHash: string,
        parentHash: string,
        repoRoot: string,
    ): GitCommitFile | null {
        if (!line.trim()) {
            return null;
        }

        const parts = line.split('\t');
        if (parts.length < 2) {
            return null;
        }

        const statusCode = parts[0];
        const status = this.parseStatusCode(statusCode);

        if (statusCode.startsWith('R') || statusCode.startsWith('C')) {
            if (parts.length >= 3) {
                return {
                    path: parts[2],
                    originalPath: parts[1],
                    status,
                    commitHash,
                    parentHash,
                    repositoryRoot: repoRoot,
                };
            }
        }

        return {
            path: parts[1],
            status,
            commitHash,
            parentHash,
            repositoryRoot: repoRoot,
        };
    }

    private parseStatusCode(code: string): GitChangeStatus {
        const firstChar = code.charAt(0).toUpperCase();
        switch (firstChar) {
            case 'M': return 'modified';
            case 'A': return 'added';
            case 'D': return 'deleted';
            case 'R': return 'renamed';
            case 'C': return 'copied';
            case 'U': return 'conflict';
            default: return 'modified';
        }
    }
}
