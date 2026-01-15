/**
 * GitRangeService - Service for commit range calculations
 * 
 * Provides functionality for:
 * - Detecting the default remote branch (origin/main or origin/master)
 * - Counting commits ahead of the base branch
 * - Getting changed files in a commit range
 * - Calculating diff statistics
 */

import { execSync } from 'child_process';
import * as path from 'path';
import * as vscode from 'vscode';
import { getExtensionLogger, LogCategory } from '../shared';
import { GitChangeStatus, GitCommitRange, GitCommitRangeFile } from './types';

/**
 * Service for calculating and managing commit ranges
 */
export class GitRangeService implements vscode.Disposable {
    private disposables: vscode.Disposable[] = [];
    
    /** Cache for default branch detection */
    private defaultBranchCache: Map<string, { branch: string; timestamp: number }> = new Map();
    private static readonly DEFAULT_BRANCH_CACHE_TTL = 60000; // 1 minute

    /**
     * Execute a git command and return the output
     */
    private execGit(args: string[], cwd: string): string {
        try {
            const result = execSync(`git ${args.join(' ')}`, {
                cwd,
                encoding: 'utf8',
                maxBuffer: 10 * 1024 * 1024, // 10MB buffer
                timeout: 30000,
                stdio: ['pipe', 'pipe', 'pipe']
            });
            return result.trim();
        } catch (error: any) {
            // Git returns non-zero exit code for various reasons
            if (error.stdout) {
                return error.stdout.trim();
            }
            throw error;
        }
    }

    /**
     * Get the current branch name
     * @param repoRoot Repository root path
     * @returns Current branch name or 'HEAD' if detached
     */
    getCurrentBranch(repoRoot: string): string {
        try {
            const branch = this.execGit(['rev-parse', '--abbrev-ref', 'HEAD'], repoRoot);
            return branch || 'HEAD';
        } catch (error) {
            getExtensionLogger().error(LogCategory.GIT, 'Failed to get current branch', error instanceof Error ? error : undefined);
            return 'HEAD';
        }
    }

    /**
     * Detect the default remote branch (origin/main or origin/master)
     * @param repoRoot Repository root path
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
                this.execGit(['rev-parse', '--verify', 'origin/main'], repoRoot);
                this.defaultBranchCache.set(repoRoot, { branch: 'origin/main', timestamp: Date.now() });
                return 'origin/main';
            } catch {
                // origin/main doesn't exist
            }

            // Try origin/master
            try {
                this.execGit(['rev-parse', '--verify', 'origin/master'], repoRoot);
                this.defaultBranchCache.set(repoRoot, { branch: 'origin/master', timestamp: Date.now() });
                return 'origin/master';
            } catch {
                // origin/master doesn't exist
            }

            // Try to get the default branch from remote HEAD
            try {
                const remoteHead = this.execGit(['symbolic-ref', 'refs/remotes/origin/HEAD'], repoRoot);
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
                this.execGit(['rev-parse', '--verify', 'main'], repoRoot);
                return 'main';
            } catch {
                // main doesn't exist
            }

            try {
                this.execGit(['rev-parse', '--verify', 'master'], repoRoot);
                return 'master';
            } catch {
                // master doesn't exist
            }

            return null;
        } catch (error) {
            getExtensionLogger().error(LogCategory.GIT, 'Failed to detect default branch', error instanceof Error ? error : undefined);
            return null;
        }
    }

    /**
     * Get the merge base between two refs
     * @param repoRoot Repository root path
     * @param ref1 First ref
     * @param ref2 Second ref
     * @returns Merge base commit hash
     */
    getMergeBase(repoRoot: string, ref1: string, ref2: string): string | null {
        try {
            return this.execGit(['merge-base', ref1, ref2], repoRoot);
        } catch (error) {
            getExtensionLogger().error(LogCategory.GIT, `Failed to get merge base for ${ref1}..${ref2}`, error instanceof Error ? error : undefined);
            return null;
        }
    }

    /**
     * Count commits ahead of the base ref
     * @param repoRoot Repository root path
     * @param baseRef Base reference
     * @param headRef Head reference
     * @returns Number of commits ahead
     */
    countCommitsAhead(repoRoot: string, baseRef: string, headRef: string): number {
        try {
            const count = this.execGit(['rev-list', '--count', `${baseRef}..${headRef}`], repoRoot);
            return parseInt(count, 10) || 0;
        } catch (error) {
            getExtensionLogger().error(LogCategory.GIT, `Failed to count commits ahead for ${baseRef}..${headRef}`, error instanceof Error ? error : undefined);
            return 0;
        }
    }

    /**
     * Get files changed in a commit range
     * @param repoRoot Repository root path
     * @param baseRef Base reference
     * @param headRef Head reference
     * @returns Array of changed files
     */
    getChangedFiles(repoRoot: string, baseRef: string, headRef: string): GitCommitRangeFile[] {
        try {
            // Use three-dot notation for symmetric difference from merge base
            // --numstat gives us additions/deletions
            // --name-status gives us the status
            const numstatOutput = this.execGit(
                ['diff', '--numstat', `${baseRef}...${headRef}`],
                repoRoot
            );
            const nameStatusOutput = this.execGit(
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
                
                // Handle renames and copies (have two paths)
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
                    // Extract the new path from rename notation
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

            // Sort files alphabetically by path
            files.sort((a, b) => a.path.localeCompare(b.path));

            return files;
        } catch (error) {
            getExtensionLogger().error(LogCategory.GIT, `Failed to get changed files for ${baseRef}...${headRef}`, error instanceof Error ? error : undefined);
            return [];
        }
    }

    /**
     * Get diff statistics for a commit range
     * @param repoRoot Repository root path
     * @param baseRef Base reference
     * @param headRef Head reference
     * @returns Total additions and deletions
     */
    getDiffStats(repoRoot: string, baseRef: string, headRef: string): { additions: number; deletions: number } {
        try {
            const output = this.execGit(
                ['diff', '--shortstat', `${baseRef}...${headRef}`],
                repoRoot
            );

            if (!output) {
                return { additions: 0, deletions: 0 };
            }

            // Parse output like: "15 files changed, 450 insertions(+), 120 deletions(-)"
            const insertionsMatch = output.match(/(\d+) insertion/);
            const deletionsMatch = output.match(/(\d+) deletion/);

            return {
                additions: insertionsMatch ? parseInt(insertionsMatch[1], 10) : 0,
                deletions: deletionsMatch ? parseInt(deletionsMatch[1], 10) : 0
            };
        } catch (error) {
            getExtensionLogger().error(LogCategory.GIT, `Failed to get diff stats for ${baseRef}...${headRef}`, error instanceof Error ? error : undefined);
            return { additions: 0, deletions: 0 };
        }
    }

    /**
     * Parse git status code to GitChangeStatus
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
     * Detect and return the commit range for the current branch
     * @param repoRoot Repository root path
     * @returns GitCommitRange or null if no range detected
     */
    detectCommitRange(repoRoot: string): GitCommitRange | null {
        try {
            // Get current branch
            const currentBranch = this.getCurrentBranch(repoRoot);
            
            // Detect default remote branch
            const defaultBranch = this.getDefaultRemoteBranch(repoRoot);
            if (!defaultBranch) {
                return null;
            }

            // Get merge base
            const mergeBase = this.getMergeBase(repoRoot, 'HEAD', defaultBranch);
            if (!mergeBase) {
                return null;
            }

            // Count commits ahead
            const commitCount = this.countCommitsAhead(repoRoot, defaultBranch, 'HEAD');
            
            // Check settings for showing on default branch
            const config = vscode.workspace.getConfiguration('workspaceShortcuts.git.commitRange');
            const showOnDefaultBranch = config.get<boolean>('showOnDefaultBranch', true);
            
            // If no commits ahead and not showing on default branch, return null
            if (commitCount === 0 && !showOnDefaultBranch) {
                return null;
            }

            // If no commits ahead, don't show the range
            if (commitCount === 0) {
                return null;
            }

            // Get changed files
            const maxFiles = config.get<number>('maxFiles', 100);
            let files = this.getChangedFiles(repoRoot, defaultBranch, 'HEAD');
            
            // Limit files if needed
            if (files.length > maxFiles) {
                files = files.slice(0, maxFiles);
            }

            // Get diff stats
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
            getExtensionLogger().error(LogCategory.GIT, 'Failed to detect commit range', error instanceof Error ? error : undefined);
            return null;
        }
    }

    /**
     * Get the diff content for a specific file in a commit range
     * @param repoRoot Repository root path
     * @param baseRef Base reference
     * @param headRef Head reference
     * @param filePath File path relative to repo root
     * @returns Diff content as string
     */
    getFileDiff(repoRoot: string, baseRef: string, headRef: string, filePath: string): string {
        try {
            const gitPath = filePath.replace(/\\/g, '/');
            return this.execGit(
                ['diff', `${baseRef}...${headRef}`, '--', gitPath],
                repoRoot
            );
        } catch (error) {
            getExtensionLogger().error(LogCategory.GIT, `Failed to get file diff for ${filePath}`, error instanceof Error ? error : undefined);
            return '';
        }
    }

    /**
     * Get file content at a specific ref
     * @param repoRoot Repository root path
     * @param ref Git reference
     * @param filePath File path relative to repo root
     * @returns File content or empty string if not found
     */
    getFileAtRef(repoRoot: string, ref: string, filePath: string): string {
        try {
            const gitPath = filePath.replace(/\\/g, '/');
            return this.execGit(['show', `${ref}:${gitPath}`], repoRoot);
        } catch {
            // File might not exist at this ref
            return '';
        }
    }

    /**
     * Get the full diff for a commit range
     * @param repoRoot Repository root path
     * @param baseRef Base reference
     * @param headRef Head reference
     * @returns Full diff content
     */
    getRangeDiff(repoRoot: string, baseRef: string, headRef: string): string {
        try {
            return this.execGit(['diff', `${baseRef}...${headRef}`], repoRoot);
        } catch (error) {
            getExtensionLogger().error(LogCategory.GIT, `Failed to get range diff for ${baseRef}...${headRef}`, error instanceof Error ? error : undefined);
            return '';
        }
    }

    /**
     * Invalidate the default branch cache
     * @param repoRoot Repository root path (optional, clears all if not provided)
     */
    invalidateCache(repoRoot?: string): void {
        if (repoRoot) {
            this.defaultBranchCache.delete(repoRoot);
        } else {
            this.defaultBranchCache.clear();
        }
    }

    /**
     * Dispose of resources
     */
    dispose(): void {
        for (const disposable of this.disposables) {
            disposable.dispose();
        }
        this.disposables = [];
        this.defaultBranchCache.clear();
    }
}
