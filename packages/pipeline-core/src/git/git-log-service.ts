/**
 * Pure Node.js GitLogService — no VS Code dependencies.
 *
 * Provides git commit history, branch management, diff retrieval,
 * and file content queries using `child_process.execSync`.
 *
 * Extracted from `src/shortcuts/git/git-log-service.ts`.
 */

import { execSync } from 'child_process';
import * as path from 'path';
import { getLogger, LogCategory } from '../logger';
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
 * All methods are synchronous (using `execSync`) except `getBranchesAsync`.
 */
export class GitLogService {
    private branchCache: Map<string, BranchCacheEntry> = new Map();
    private static readonly BRANCH_CACHE_TTL = 180_000; // 3 minutes
    private static readonly EMPTY_TREE_HASH = '4b825dc642cb6eb9a060e54bf8d69288fbee4904';

    /**
     * Get commits from a repository.
     */
    getCommits(repoRoot: string, options: CommitLoadOptions): CommitLoadResult {
        try {
            const { maxCount, skip } = options;

            // Request one extra commit to determine if there are more
            const requestCount = maxCount + 1;

            // Format: hash|shortHash|subject|authorName|authorEmail|date|relativeDate|parentHashes|refs
            const format = '%H|%h|%s|%an|%ae|%aI|%ar|%P|%D';

            const command = `git log --pretty=format:"${format}" -n ${requestCount} --skip ${skip}`;

            const output = execSync(command, {
                cwd: repoRoot,
                encoding: 'utf-8',
                maxBuffer: 10 * 1024 * 1024,
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
            const aheadCommits = this.getAheadOfRemoteCommits(repoRoot);

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
    getCommit(repoRoot: string, hash: string): GitCommit | undefined {
        try {
            const format = '%H|%h|%s|%an|%ae|%aI|%ar|%P|%D';
            const command = `git log --pretty=format:"${format}" -n 1 ${hash}`;

            const output = execSync(command, {
                cwd: repoRoot,
                encoding: 'utf-8',
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
    getCommitFiles(repoRoot: string, commitHash: string): GitCommitFile[] {
        try {
            const parentHash = this.getParentHash(repoRoot, commitHash);

            const command = `git diff-tree --no-commit-id --name-status -r -M -C ${commitHash}`;

            const output = execSync(command, {
                cwd: repoRoot,
                encoding: 'utf-8',
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

            return files;
        } catch (error) {
            getLogger().error(LogCategory.GIT, `Failed to get commit files for ${commitHash} from ${repoRoot}`, error instanceof Error ? error : undefined);
            return [];
        }
    }

    /**
     * Get the diff for a specific commit.
     */
    getCommitDiff(repoRoot: string, commitHash: string): string {
        try {
            const parentHash = this.getParentHash(repoRoot, commitHash);

            const command = `git diff ${parentHash} ${commitHash}`;
            const output = execSync(command, {
                cwd: repoRoot,
                encoding: 'utf-8',
                maxBuffer: 10 * 1024 * 1024,
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
    getPendingChangesDiff(repoRoot: string): string {
        try {
            const unstaged = execSync('git diff', {
                cwd: repoRoot,
                encoding: 'utf-8',
                maxBuffer: 10 * 1024 * 1024,
                timeout: 30000,
            });

            const staged = execSync('git diff --cached', {
                cwd: repoRoot,
                encoding: 'utf-8',
                maxBuffer: 10 * 1024 * 1024,
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
    getStagedChangesDiff(repoRoot: string): string {
        try {
            const command = 'git diff --cached';
            const output = execSync(command, {
                cwd: repoRoot,
                encoding: 'utf-8',
                maxBuffer: 10 * 1024 * 1024,
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
    hasPendingChanges(repoRoot: string): boolean {
        try {
            const command = 'git status --porcelain';
            const output = execSync(command, {
                cwd: repoRoot,
                encoding: 'utf-8',
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
    hasStagedChanges(repoRoot: string): boolean {
        try {
            const command = 'git diff --cached --quiet';
            execSync(command, {
                cwd: repoRoot,
                encoding: 'utf-8',
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
    hasMoreCommits(repoRoot: string, currentCount: number): boolean {
        try {
            const command = 'git rev-list --count HEAD';
            const output = execSync(command, {
                cwd: repoRoot,
                encoding: 'utf-8',
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
    getFileContentAtCommit(repoRoot: string, commitHash: string, filePath: string): string | undefined {
        try {
            const normalizedPath = toForwardSlashes(filePath);

            const command = `git show "${commitHash}:${normalizedPath}"`;
            const output = execSync(command, {
                cwd: repoRoot,
                encoding: 'utf-8',
                maxBuffer: 10 * 1024 * 1024,
                timeout: 30000,
            });

            return output;
        } catch (error) {
            getLogger().error(
                LogCategory.GIT,
                `Failed to get file content for ${filePath} at commit ${commitHash}`,
                error instanceof Error ? error : undefined,
            );
            return undefined;
        }
    }

    /**
     * Check if a file exists at a specific commit.
     */
    fileExistsAtCommit(repoRoot: string, commitHash: string, filePath: string): boolean {
        try {
            const normalizedPath = toForwardSlashes(filePath);
            execSync(`git cat-file -e "${commitHash}:${normalizedPath}"`, {
                cwd: repoRoot,
                encoding: 'utf-8',
                timeout: 5000,
                stdio: ['pipe', 'pipe', 'pipe'],
            });
            return true;
        } catch {
            return false;
        }
    }

    /**
     * Validate a git ref and return the resolved commit hash.
     */
    validateRef(repoRoot: string, ref: string): string | undefined {
        try {
            const command = `git rev-parse --verify "${ref}"`;
            const output = execSync(command, {
                cwd: repoRoot,
                encoding: 'utf-8',
                timeout: 5000,
                stdio: ['pipe', 'pipe', 'pipe'],
            });
            const hash = output.trim();

            const typeCommand = `git cat-file -t "${hash}"`;
            const typeOutput = execSync(typeCommand, {
                cwd: repoRoot,
                encoding: 'utf-8',
                timeout: 5000,
                stdio: ['pipe', 'pipe', 'pipe'],
            });

            if (typeOutput.trim() === 'commit') {
                return hash;
            }
            return undefined;
        } catch {
            return undefined;
        }
    }

    /**
     * Get branch names (cached, local branches only).
     */
    getBranches(repoRoot: string, forceRefresh = false): string[] {
        if (!forceRefresh) {
            const cached = this.branchCache.get(repoRoot);
            if (cached && Date.now() - cached.timestamp < GitLogService.BRANCH_CACHE_TTL) {
                return cached.branches;
            }
        }

        try {
            const output = execSync('git branch --format="%(refname:short)"', {
                cwd: repoRoot,
                encoding: 'utf-8',
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
     */
    async getBranchesAsync(repoRoot: string): Promise<string[]> {
        const cached = this.branchCache.get(repoRoot);
        if (cached && Date.now() - cached.timestamp < GitLogService.BRANCH_CACHE_TTL) {
            return cached.branches;
        }

        return new Promise((resolve) => {
            setImmediate(() => {
                resolve(this.getBranches(repoRoot, true));
            });
        });
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

    private getAheadOfRemoteCommits(repoRoot: string): Set<string> {
        try {
            const upstreamCommand = 'git rev-parse --abbrev-ref @{upstream}';
            let upstream: string;
            try {
                upstream = execSync(upstreamCommand, {
                    cwd: repoRoot,
                    encoding: 'utf-8',
                    timeout: 5000,
                }).trim();
            } catch {
                return new Set();
            }

            const aheadCommand = `git log ${upstream}..HEAD --pretty=format:"%H"`;
            const output = execSync(aheadCommand, {
                cwd: repoRoot,
                encoding: 'utf-8',
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

    private getParentHash(repoRoot: string, commitHash: string): string {
        try {
            const command = `git rev-parse ${commitHash}~1`;
            const output = execSync(command, {
                cwd: repoRoot,
                encoding: 'utf-8',
                timeout: 5000,
            });
            return output.trim();
        } catch {
            return GitLogService.EMPTY_TREE_HASH;
        }
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
