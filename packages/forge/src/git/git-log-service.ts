/**
 * Pure Node.js GitLogService — no VS Code dependencies.
 *
 * Provides git commit history, branch management, diff retrieval,
 * and file content queries using the async `execAsync` helper so that
 * git I/O never blocks the Node event loop.
 *
 * Extracted from `src/shortcuts/git/git-log-service.ts`.
 */

import * as path from 'path';
import { getLogger, LogCategory } from '../logger';
import { execAsync } from '../utils/exec-utils';
import { toForwardSlashes } from '../utils/path-utils';
import { GitCommit, GitCommitFile, GitChangeStatus, CommitLoadOptions, CommitLoadResult } from './types';

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
 * All public methods are asynchronous (using `execAsync`) so the single-threaded
 * Node event loop is never blocked by synchronous git I/O.
 */
export class GitLogService {
    private branchCache: Map<string, BranchCacheEntry> = new Map();
    private static readonly BRANCH_CACHE_TTL = 180_000; // 3 minutes
    private static readonly EMPTY_TREE_HASH = '4b825dc642cb6eb9a060e54bf8d69288fbee4904';

    /**
     * Get commits from a repository.
     */
    async getCommits(repoRoot: string, options: CommitLoadOptions): Promise<CommitLoadResult> {
        try {
            const { maxCount, skip, search } = options;

            // Request one extra commit to determine if there are more
            const requestCount = maxCount + 1;

            // Format: hash|shortHash|subject|authorName|authorEmail|date|relativeDate|parentHashes|refs
            const format = '%H|%h|%s|%an|%ae|%aI|%ar|%P|%D';

            const searchFlags = search
                ? ` --grep=${JSON.stringify(search)} --regexp-ignore-case`
                : '';
            const command = `git log --pretty=format:"${format}" -n ${requestCount} --skip ${skip}${searchFlags}`;

            const { stdout: output } = await execAsync(command, {
                cwd: repoRoot,
                maxBuffer: 50 * 1024 * 1024,
                timeout: 30000,
            });

            if (!output.trim()) {
                return { commits: [], hasMore: false };
            }

            const lines = output.trim().split('\n');
            const repoName = path.basename(repoRoot);

            const hasMore = lines.length > maxCount;
            const commitLines = hasMore ? lines.slice(0, maxCount) : lines;

            // Get the set of commits that are ahead of remote
            const aheadCommits = await this.getAheadOfRemoteCommits(repoRoot);

            const commits = commitLines.map(line => {
                const commit = this.parseCommitLine(line, repoRoot, repoName);
                commit.isAheadOfRemote = aheadCommits.has(commit.hash);
                return commit;
            });

            return { commits, hasMore };
        } catch (error) {
            getLogger().error(LogCategory.GIT, `Failed to get commits for ${repoRoot}`, error instanceof Error ? error : undefined);
            return { commits: [], hasMore: false };
        }
    }

    /**
     * Get a single commit by hash.
     */
    async getCommit(repoRoot: string, hash: string): Promise<GitCommit | undefined> {
        try {
            const format = '%H|%h|%s|%an|%ae|%aI|%ar|%P|%D';
            const command = `git log --pretty=format:"${format}" -n 1 ${hash}`;

            const { stdout: output } = await execAsync(command, {
                cwd: repoRoot,
                timeout: 5000,
            });

            if (!output.trim()) {
                return undefined;
            }

            const repoName = path.basename(repoRoot);
            return this.parseCommitLine(output.trim(), repoRoot, repoName);
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
                timeout: 10000,
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
                timeout: 30000,
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
                timeout: 30000,
            });

            const { stdout: staged } = await execAsync('git diff --cached', {
                cwd: repoRoot,
                maxBuffer: 50 * 1024 * 1024,
                timeout: 30000,
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
                timeout: 30000,
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
                timeout: 5000,
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
                timeout: 5000,
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
                timeout: 5000,
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
                timeout: 30000,
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
                timeout: 5000,
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
                timeout: 5000,
            });
            const hash = output.trim();

            const typeCommand = `git cat-file -t "${hash}"`;
            const { stdout: typeOutput } = await execAsync(typeCommand, {
                cwd: repoRoot,
                timeout: 5000,
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
                timeout: 5000,
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

    private async getAheadOfRemoteCommits(repoRoot: string): Promise<Set<string>> {
        try {
            const upstreamCommand = 'git rev-parse --abbrev-ref @{upstream}';
            let upstream: string;
            try {
                const { stdout } = await execAsync(upstreamCommand, {
                    cwd: repoRoot,
                    timeout: 5000,
                });
                upstream = stdout.trim();
            } catch {
                return new Set();
            }

            const aheadCommand = `git log ${upstream}..HEAD --pretty=format:"%H"`;
            const { stdout: output } = await execAsync(aheadCommand, {
                cwd: repoRoot,
                timeout: 5000,
            });

            if (!output.trim()) {
                return new Set();
            }

            return new Set(output.trim().split('\n').filter(h => h));
        } catch {
            return new Set();
        }
    }

    private async getParentHash(repoRoot: string, commitHash: string): Promise<string> {
        try {
            const command = `git rev-parse ${commitHash}~1`;
            const { stdout: output } = await execAsync(command, {
                cwd: repoRoot,
                timeout: 5000,
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
                timeout: 10000,
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

    private parseCommitLine(line: string, repoRoot: string, repoName: string): GitCommit {
        const parts = line.split('|');

        const refsString = parts[8] || '';
        const refs = refsString
            .split(',')
            .map(ref => ref.trim())
            .filter(ref => ref.length > 0);

        return {
            hash: parts[0] || '',
            shortHash: parts[1] || '',
            subject: parts[2] || '',
            authorName: parts[3] || '',
            authorEmail: parts[4] || '',
            date: parts[5] || '',
            relativeDate: parts[6] || '',
            parentHashes: parts[7] || '',
            refs,
            repositoryRoot: repoRoot,
            repositoryName: repoName,
        };
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
