/**
 * Pure Node.js GitRangeService — no VS Code dependencies.
 *
 * Provides commit range calculations:
 * - Detecting the default remote branch (origin/main or origin/master)
 * - Counting commits ahead of the base branch
 * - Getting changed files in a commit range
 * - Calculating diff statistics
 *
 * Extracted from `src/shortcuts/git/git-range-service.ts`.
 */

import * as path from 'path';
import { getLogger, LogCategory } from '../logger';
import { execGit } from './exec';
import { GitChangeStatus, GitCommitRange, GitCommitRangeFile, GitRangeConfig } from './types';

/**
 * Internal resolved config with all defaults applied.
 */
interface ResolvedGitRangeConfig {
    maxFiles: number;
    showOnDefaultBranch: boolean;
}

const DEFAULT_CONFIG: ResolvedGitRangeConfig = {
    maxFiles: 100,
    showOnDefaultBranch: false,
};

/**
 * Service for calculating and managing commit ranges.
 */
export class GitRangeService {
    private config: ResolvedGitRangeConfig;

    /** Cache for default branch detection */
    private defaultBranchCache: Map<string, { branch: string; timestamp: number }> = new Map();
    private static readonly DEFAULT_BRANCH_CACHE_TTL = 60000; // 1 minute

    constructor(config?: GitRangeConfig) {
        this.config = {
            maxFiles: config?.maxFiles ?? DEFAULT_CONFIG.maxFiles,
            showOnDefaultBranch: config?.showOnDefaultBranch ?? DEFAULT_CONFIG.showOnDefaultBranch,
        };
    }

    /**
     * Execute a git command via the shared exec helper,
     * preserving the original behaviour of returning partial stdout on failure.
     */
    private execGitCommand(args: string[], repoRoot: string): string {
        return execGit(args, repoRoot);
    }

    /**
     * Get the current branch name.
     * @returns Current branch name or 'HEAD' if detached
     */
    getCurrentBranch(repoRoot: string): string {
        try {
            const branch = this.execGitCommand(['rev-parse', '--abbrev-ref', 'HEAD'], repoRoot);
            return branch || 'HEAD';
        } catch (error) {
            getLogger().error(LogCategory.GIT, 'Failed to get current branch', error instanceof Error ? error : undefined);
            return 'HEAD';
        }
    }

    /**
     * Detect the default remote branch (origin/main or origin/master).
     * @returns Default remote branch name or null if not found
     */
    getDefaultRemoteBranch(repoRoot: string): string | null {
        // Check cache first
        const cached = this.defaultBranchCache.get(repoRoot);
        if (cached && Date.now() - cached.timestamp < GitRangeService.DEFAULT_BRANCH_CACHE_TTL) {
            return cached.branch;
        }

        try {
            // Try origin/main first
            try {
                this.execGitCommand(['rev-parse', '--verify', 'origin/main'], repoRoot);
                this.defaultBranchCache.set(repoRoot, { branch: 'origin/main', timestamp: Date.now() });
                return 'origin/main';
            } catch {
                // origin/main doesn't exist
            }

            // Try origin/master
            try {
                this.execGitCommand(['rev-parse', '--verify', 'origin/master'], repoRoot);
                this.defaultBranchCache.set(repoRoot, { branch: 'origin/master', timestamp: Date.now() });
                return 'origin/master';
            } catch {
                // origin/master doesn't exist
            }

            // Try to get the default branch from remote HEAD
            try {
                const remoteHead = this.execGitCommand(['symbolic-ref', 'refs/remotes/origin/HEAD'], repoRoot);
                if (remoteHead) {
                    const branch = remoteHead.replace('refs/remotes/', '');
                    this.defaultBranchCache.set(repoRoot, { branch, timestamp: Date.now() });
                    return branch;
                }
            } catch {
                // No remote HEAD
            }

            // Fall back to local main/master
            try {
                this.execGitCommand(['rev-parse', '--verify', 'main'], repoRoot);
                return 'main';
            } catch {
                // main doesn't exist
            }

            try {
                this.execGitCommand(['rev-parse', '--verify', 'master'], repoRoot);
                return 'master';
            } catch {
                // master doesn't exist
            }

            return null;
        } catch (error) {
            getLogger().error(LogCategory.GIT, 'Failed to detect default branch', error instanceof Error ? error : undefined);
            return null;
        }
    }

    /**
     * Get the merge base between two refs.
     */
    getMergeBase(repoRoot: string, ref1: string, ref2: string): string | null {
        try {
            return this.execGitCommand(['merge-base', ref1, ref2], repoRoot);
        } catch (error) {
            getLogger().error(LogCategory.GIT, `Failed to get merge base for ${ref1}..${ref2}`, error instanceof Error ? error : undefined);
            return null;
        }
    }

    /**
     * Count commits ahead of the base ref.
     */
    countCommitsAhead(repoRoot: string, baseRef: string, headRef: string): number {
        try {
            const count = this.execGitCommand(['rev-list', '--count', `${baseRef}..${headRef}`], repoRoot);
            return parseInt(count, 10) || 0;
        } catch (error) {
            getLogger().error(LogCategory.GIT, `Failed to count commits ahead for ${baseRef}..${headRef}`, error instanceof Error ? error : undefined);
            return 0;
        }
    }

    /**
     * Get files changed in a commit range.
     */
    getChangedFiles(repoRoot: string, baseRef: string, headRef: string): GitCommitRangeFile[] {
        try {
            const numstatOutput = this.execGitCommand(
                ['diff', '--numstat', `${baseRef}...${headRef}`],
                repoRoot
            );
            const nameStatusOutput = this.execGitCommand(
                ['diff', '--name-status', '-M', '-C', `${baseRef}...${headRef}`],
                repoRoot
            );

            if (!nameStatusOutput) {
                return [];
            }

            // Parse name-status output to get status and paths
            const statusMap = new Map<string, { status: GitChangeStatus; oldPath?: string }>();
            const nameStatusLines = nameStatusOutput.split('\n').filter(line => line.trim());

            for (const line of nameStatusLines) {
                const parts = line.split('\t');
                if (parts.length < 2) continue;

                const statusCode = parts[0];
                const status = this.parseStatusCode(statusCode);

                if (statusCode.startsWith('R') || statusCode.startsWith('C')) {
                    if (parts.length >= 3) {
                        statusMap.set(parts[2], { status, oldPath: parts[1] });
                    }
                } else {
                    statusMap.set(parts[1], { status });
                }
            }

            // Parse numstat output to get additions/deletions
            const files: GitCommitRangeFile[] = [];
            const numstatLines = numstatOutput.split('\n').filter(line => line.trim());

            for (const line of numstatLines) {
                const parts = line.split('\t');
                if (parts.length < 3) continue;

                const additions = parts[0] === '-' ? 0 : parseInt(parts[0], 10) || 0;
                const deletions = parts[1] === '-' ? 0 : parseInt(parts[1], 10) || 0;

                // Handle renames (format: old => new or {old => new})
                let filePath = parts[2];
                if (filePath.includes(' => ')) {
                    const match = filePath.match(/(?:{[^}]*? => ([^}]+)}|.* => (.+))/);
                    if (match) {
                        filePath = match[1] || match[2];
                    }
                }

                const statusInfo = statusMap.get(filePath) || { status: 'modified' as GitChangeStatus };

                files.push({
                    path: filePath,
                    status: statusInfo.status,
                    additions,
                    deletions,
                    oldPath: statusInfo.oldPath,
                    repositoryRoot: repoRoot
                });
            }

            files.sort((a, b) => a.path.localeCompare(b.path));
            return files;
        } catch (error) {
            getLogger().error(LogCategory.GIT, `Failed to get changed files for ${baseRef}...${headRef}`, error instanceof Error ? error : undefined);
            return [];
        }
    }

    /**
     * Get diff statistics for a commit range.
     */
    getDiffStats(repoRoot: string, baseRef: string, headRef: string): { additions: number; deletions: number } {
        try {
            const output = this.execGitCommand(
                ['diff', '--shortstat', `${baseRef}...${headRef}`],
                repoRoot
            );

            if (!output) {
                return { additions: 0, deletions: 0 };
            }

            const insertionsMatch = output.match(/(\d+) insertion/);
            const deletionsMatch = output.match(/(\d+) deletion/);

            return {
                additions: insertionsMatch ? parseInt(insertionsMatch[1], 10) : 0,
                deletions: deletionsMatch ? parseInt(deletionsMatch[1], 10) : 0
            };
        } catch (error) {
            getLogger().error(LogCategory.GIT, `Failed to get diff stats for ${baseRef}...${headRef}`, error instanceof Error ? error : undefined);
            return { additions: 0, deletions: 0 };
        }
    }

    /**
     * Parse git status code to GitChangeStatus.
     */
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

    /**
     * Detect and return the commit range for the current branch.
     * @returns GitCommitRange or null if no range detected
     */
    detectCommitRange(repoRoot: string): GitCommitRange | null {
        try {
            const currentBranch = this.getCurrentBranch(repoRoot);

            const defaultBranch = this.getDefaultRemoteBranch(repoRoot);
            if (!defaultBranch) {
                return null;
            }

            const mergeBase = this.getMergeBase(repoRoot, 'HEAD', defaultBranch);
            if (!mergeBase) {
                return null;
            }

            const commitCount = this.countCommitsAhead(repoRoot, defaultBranch, 'HEAD');

            // If no commits ahead and not showing on default branch, return null
            if (commitCount === 0 && !this.config.showOnDefaultBranch) {
                return null;
            }

            // If no commits ahead, don't show the range
            if (commitCount === 0) {
                return null;
            }

            let files = this.getChangedFiles(repoRoot, defaultBranch, 'HEAD');

            if (files.length > this.config.maxFiles) {
                files = files.slice(0, this.config.maxFiles);
            }

            const { additions, deletions } = this.getDiffStats(repoRoot, defaultBranch, 'HEAD');

            const repoName = path.basename(repoRoot);

            return {
                baseRef: defaultBranch,
                headRef: 'HEAD',
                commitCount,
                files,
                additions,
                deletions,
                mergeBase,
                branchName: currentBranch !== 'HEAD' ? currentBranch : undefined,
                repositoryRoot: repoRoot,
                repositoryName: repoName
            };
        } catch (error) {
            getLogger().error(LogCategory.GIT, 'Failed to detect commit range', error instanceof Error ? error : undefined);
            return null;
        }
    }

    /**
     * Get the diff content for a specific file in a commit range.
     */
    getFileDiff(repoRoot: string, baseRef: string, headRef: string, filePath: string): string {
        try {
            const gitPath = filePath.replace(/\\/g, '/');
            return this.execGitCommand(
                ['diff', `${baseRef}...${headRef}`, '--', gitPath],
                repoRoot
            );
        } catch (error) {
            getLogger().error(LogCategory.GIT, `Failed to get file diff for ${filePath}`, error instanceof Error ? error : undefined);
            return '';
        }
    }

    /**
     * Get file content at a specific ref.
     */
    getFileAtRef(repoRoot: string, ref: string, filePath: string): string {
        try {
            const gitPath = filePath.replace(/\\/g, '/');
            return this.execGitCommand(['show', `${ref}:${gitPath}`], repoRoot);
        } catch {
            return '';
        }
    }

    /**
     * Get the full diff for a commit range.
     */
    getRangeDiff(repoRoot: string, baseRef: string, headRef: string): string {
        try {
            return this.execGitCommand(['diff', `${baseRef}...${headRef}`], repoRoot);
        } catch (error) {
            getLogger().error(LogCategory.GIT, `Failed to get range diff for ${baseRef}...${headRef}`, error instanceof Error ? error : undefined);
            return '';
        }
    }

    /**
     * Invalidate the default branch cache.
     * @param repoRoot If provided, clears only that repo; otherwise clears all.
     */
    invalidateCache(repoRoot?: string): void {
        if (repoRoot) {
            this.defaultBranchCache.delete(repoRoot);
        } else {
            this.defaultBranchCache.clear();
        }
    }

    /**
     * Dispose of resources.
     */
    dispose(): void {
        this.defaultBranchCache.clear();
    }
}
