import { execSync, exec } from 'child_process';
import * as vscode from 'vscode';
import { getExtensionLogger, LogCategory } from '../shared';
import { BranchStatus } from './branch-item';

/**
 * Represents a git branch
 */
export interface GitBranch {
    /** Branch name */
    name: string;
    /** Whether this is the current branch */
    isCurrent: boolean;
    /** Whether this is a remote branch */
    isRemote: boolean;
    /** Remote name for remote branches (e.g., 'origin') */
    remoteName?: string;
    /** Last commit subject */
    lastCommitSubject?: string;
    /** Last commit relative date */
    lastCommitDate?: string;
}

/**
 * Options for paginated branch listing
 */
export interface BranchListOptions {
    /** Maximum number of branches to return */
    limit?: number;
    /** Number of branches to skip */
    offset?: number;
    /** Search pattern to filter branches (case-insensitive substring match) */
    searchPattern?: string;
}

/**
 * Result of paginated branch listing
 */
export interface PaginatedBranchResult {
    /** Branches in this page */
    branches: GitBranch[];
    /** Total count of matching branches */
    totalCount: number;
    /** Whether there are more branches available */
    hasMore: boolean;
}

/**
 * Options for git command execution
 */
interface GitExecOptions {
    cwd: string;
    timeout?: number;
    encoding?: BufferEncoding;
}

/**
 * Service for branch-related git operations
 * Handles branch listing, switching, creating, and deleting
 */
export class BranchService implements vscode.Disposable {
    private disposables: vscode.Disposable[] = [];

    /**
     * Execute a git command synchronously
     * Uses cross-platform compatible options
     */
    private execGitSync(command: string, options: GitExecOptions): string {
        return execSync(command, {
            cwd: options.cwd,
            encoding: options.encoding || 'utf-8',
            timeout: options.timeout || 10000,
            // Use shell option for cross-platform compatibility
            // On Windows, this uses cmd.exe; on Unix, /bin/sh
            shell: process.platform === 'win32' ? 'cmd.exe' : '/bin/sh',
            // Suppress stderr output to prevent noise
            stdio: ['pipe', 'pipe', 'pipe']
        });
    }

    /**
     * Execute a git command asynchronously
     */
    private execGitAsync(command: string, options: GitExecOptions): Promise<string> {
        return new Promise((resolve, reject) => {
            exec(command, {
                cwd: options.cwd,
                encoding: options.encoding || 'utf-8',
                timeout: options.timeout || 30000,
                shell: process.platform === 'win32' ? 'cmd.exe' : '/bin/sh'
            }, (error, stdout, stderr) => {
                if (error) {
                    reject(new Error(stderr || error.message));
                } else {
                    resolve(stdout);
                }
            });
        });
    }

    /**
     * Get the current branch status
     * @param repoRoot Repository root path
     * @param hasUncommittedChanges Whether there are uncommitted changes
     */
    getBranchStatus(repoRoot: string, hasUncommittedChanges: boolean): BranchStatus | null {
        try {
            // First verify this is a valid git repository by checking if we can get HEAD hash
            // This will fail for non-existent paths or non-git directories
            const headHash = this.getHeadHash(repoRoot);
            if (!headHash) {
                return null;
            }

            // Check for detached HEAD
            const isDetached = this.isDetachedHead(repoRoot);

            if (isDetached) {
                return {
                    name: '',
                    isDetached: true,
                    detachedHash: headHash,
                    ahead: 0,
                    behind: 0,
                    hasUncommittedChanges
                };
            }

            // Get current branch name
            const branchName = this.getCurrentBranchName(repoRoot);
            if (!branchName) {
                return null;
            }

            // Get tracking branch info
            const trackingInfo = this.getTrackingBranchInfo(repoRoot, branchName);

            return {
                name: branchName,
                isDetached: false,
                ahead: trackingInfo.ahead,
                behind: trackingInfo.behind,
                trackingBranch: trackingInfo.trackingBranch,
                hasUncommittedChanges
            };
        } catch (error) {
            getExtensionLogger().error(LogCategory.GIT, 'Failed to get branch status', error instanceof Error ? error : undefined);
            return null;
        }
    }

    /**
     * Check if HEAD is detached
     */
    private isDetachedHead(repoRoot: string): boolean {
        try {
            const output = this.execGitSync('git symbolic-ref -q HEAD', { cwd: repoRoot });
            return !output.trim();
        } catch {
            // If symbolic-ref fails, HEAD is detached
            return true;
        }
    }

    /**
     * Get the HEAD commit hash
     */
    private getHeadHash(repoRoot: string): string {
        try {
            return this.execGitSync('git rev-parse HEAD', { cwd: repoRoot }).trim();
        } catch {
            return '';
        }
    }

    /**
     * Get the current branch name
     */
    private getCurrentBranchName(repoRoot: string): string | null {
        try {
            // Use rev-parse which is more reliable across platforms
            const output = this.execGitSync('git rev-parse --abbrev-ref HEAD', { cwd: repoRoot });
            const name = output.trim();
            return name === 'HEAD' ? null : name;
        } catch {
            return null;
        }
    }

    /**
     * Get tracking branch information (ahead/behind counts)
     */
    private getTrackingBranchInfo(repoRoot: string, branchName: string): {
        trackingBranch?: string;
        ahead: number;
        behind: number;
    } {
        try {
            // Get the upstream branch name
            // Using @{upstream} which is cross-platform safe
            const upstreamCmd = `git rev-parse --abbrev-ref "${branchName}@{upstream}"`;
            let trackingBranch: string | undefined;
            
            try {
                trackingBranch = this.execGitSync(upstreamCmd, { cwd: repoRoot }).trim();
            } catch {
                // No upstream configured
                return { ahead: 0, behind: 0 };
            }

            // Get ahead/behind counts using rev-list
            // This avoids the ^ character which is problematic on Windows
            const aheadCmd = `git rev-list --count "${trackingBranch}..${branchName}"`;
            const behindCmd = `git rev-list --count "${branchName}..${trackingBranch}"`;

            const ahead = parseInt(this.execGitSync(aheadCmd, { cwd: repoRoot }).trim(), 10) || 0;
            const behind = parseInt(this.execGitSync(behindCmd, { cwd: repoRoot }).trim(), 10) || 0;

            return { trackingBranch, ahead, behind };
        } catch (error) {
            getExtensionLogger().error(LogCategory.GIT, 'Failed to get tracking info', error instanceof Error ? error : undefined);
            return { ahead: 0, behind: 0 };
        }
    }

    /**
     * Get all local branches
     * @param repoRoot Repository root path
     */
    getLocalBranches(repoRoot: string): GitBranch[] {
        try {
            // Format: current indicator, branch name, commit subject, commit date
            const format = '%(if)%(HEAD)%(then)*%(else) %(end)|%(refname:short)|%(subject)|%(committerdate:relative)';
            const output = this.execGitSync(`git branch --format="${format}"`, { cwd: repoRoot });

            if (!output.trim()) {
                return [];
            }

            return output.trim().split('\n').map(line => {
                const parts = line.split('|');
                const isCurrent = parts[0] === '*';
                return {
                    name: parts[1] || '',
                    isCurrent,
                    isRemote: false,
                    lastCommitSubject: parts[2] || '',
                    lastCommitDate: parts[3] || ''
                };
            }).filter(b => b.name);
        } catch (error) {
            getExtensionLogger().error(LogCategory.GIT, 'Failed to get local branches', error instanceof Error ? error : undefined);
            return [];
        }
    }

    /**
     * Get remote branches
     * @param repoRoot Repository root path
     */
    getRemoteBranches(repoRoot: string): GitBranch[] {
        try {
            const format = '%(refname:short)|%(subject)|%(committerdate:relative)';
            const output = this.execGitSync(`git branch -r --format="${format}"`, { cwd: repoRoot });

            if (!output.trim()) {
                return [];
            }

            return output.trim().split('\n')
                .filter(line => !line.includes('HEAD'))  // Filter out origin/HEAD
                .map(line => {
                    const parts = line.split('|');
                    const fullName = parts[0] || '';
                    // Extract remote name (e.g., 'origin' from 'origin/main')
                    const slashIndex = fullName.indexOf('/');
                    const remoteName = slashIndex > 0 ? fullName.substring(0, slashIndex) : undefined;
                    
                    return {
                        name: fullName,
                        isCurrent: false,
                        isRemote: true,
                        remoteName,
                        lastCommitSubject: parts[1] || '',
                        lastCommitDate: parts[2] || ''
                    };
                }).filter(b => b.name);
        } catch (error) {
            getExtensionLogger().error(LogCategory.GIT, 'Failed to get remote branches', error instanceof Error ? error : undefined);
            return [];
        }
    }

    /**
     * Get all branches (local and remote)
     * @param repoRoot Repository root path
     */
    getAllBranches(repoRoot: string): { local: GitBranch[]; remote: GitBranch[] } {
        return {
            local: this.getLocalBranches(repoRoot),
            remote: this.getRemoteBranches(repoRoot)
        };
    }

    /**
     * Get local branch count (fast operation)
     * @param repoRoot Repository root path
     * @param searchPattern Optional search pattern to filter (case-insensitive)
     */
    getLocalBranchCount(repoRoot: string, searchPattern?: string): number {
        try {
            const command = 'git branch --list';
            const output = this.execGitSync(command, { cwd: repoRoot });
            if (!output.trim()) {
                return 0;
            }
            let lines = output.trim().split('\n').filter(line => line.trim());

            // Apply case-insensitive filtering if search pattern provided
            if (searchPattern) {
                const lowerPattern = searchPattern.toLowerCase();
                lines = lines.filter(line => {
                    // Branch name is after the first 2 characters (current marker + space)
                    const branchName = line.substring(2).trim();
                    return branchName.toLowerCase().includes(lowerPattern);
                });
            }

            return lines.length;
        } catch (error) {
            getExtensionLogger().error(LogCategory.GIT, 'Failed to get local branch count', error instanceof Error ? error : undefined);
            return 0;
        }
    }

    /**
     * Get remote branch count (fast operation)
     * @param repoRoot Repository root path
     * @param searchPattern Optional search pattern to filter (case-insensitive)
     */
    getRemoteBranchCount(repoRoot: string, searchPattern?: string): number {
        try {
            const command = 'git branch -r --list';
            const output = this.execGitSync(command, { cwd: repoRoot });
            if (!output.trim()) {
                return 0;
            }
            // Filter out HEAD entries
            let lines = output.trim().split('\n').filter(line => line.trim() && !line.includes('HEAD'));

            // Apply case-insensitive filtering if search pattern provided
            if (searchPattern) {
                const lowerPattern = searchPattern.toLowerCase();
                lines = lines.filter(line => {
                    const branchName = line.trim();
                    return branchName.toLowerCase().includes(lowerPattern);
                });
            }

            return lines.length;
        } catch (error) {
            getExtensionLogger().error(LogCategory.GIT, 'Failed to get remote branch count', error instanceof Error ? error : undefined);
            return 0;
        }
    }

    /**
     * Get local branches with pagination and search support
     * For repos with many branches, this is more efficient than loading all branches
     * @param repoRoot Repository root path
     * @param options Pagination and search options
     */
    getLocalBranchesPaginated(repoRoot: string, options: BranchListOptions = {}): PaginatedBranchResult {
        const { limit = 100, offset = 0, searchPattern } = options;

        try {
            // Get total count first for pagination info
            const totalCount = this.getLocalBranchCount(repoRoot, searchPattern);

            if (totalCount === 0) {
                return { branches: [], totalCount: 0, hasMore: false };
            }

            // Format: current indicator, branch name, commit subject, commit date
            const format = '%(if)%(HEAD)%(then)*%(else) %(end)|%(refname:short)|%(subject)|%(committerdate:relative)';
            let command = `git branch --format="${format}"`;

            // Git doesn't have built-in pagination, so we use shell utilities
            // But we need to be careful with the pattern matching
            if (searchPattern) {
                // Filter with grep for the search pattern (case-insensitive)
                const escapedPattern = searchPattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                if (process.platform === 'win32') {
                    // Windows: use findstr (case-insensitive with /i)
                    command += ` | findstr /i "${escapedPattern}"`;
                } else {
                    // Unix: use grep -i for case-insensitive
                    command += ` | grep -i "${escapedPattern}"`;
                }
            }

            // Apply pagination using tail and head
            // Skip first 'offset' lines, then take 'limit' lines
            if (process.platform === 'win32') {
                // Windows doesn't have tail/head, we'll process in JS
            } else {
                if (offset > 0) {
                    command += ` | tail -n +${offset + 1}`;
                }
                command += ` | head -n ${limit}`;
            }

            const output = this.execGitSync(command, { cwd: repoRoot, timeout: 30000 });

            if (!output.trim()) {
                return { branches: [], totalCount, hasMore: offset + limit < totalCount };
            }

            let lines = output.trim().split('\n');

            // For Windows, apply pagination in JS
            if (process.platform === 'win32') {
                if (searchPattern) {
                    const lowerPattern = searchPattern.toLowerCase();
                    lines = lines.filter(line => {
                        const parts = line.split('|');
                        const branchName = parts[1] || '';
                        return branchName.toLowerCase().includes(lowerPattern);
                    });
                }
                lines = lines.slice(offset, offset + limit);
            }

            const branches = lines.map(line => {
                const parts = line.split('|');
                const isCurrent = parts[0] === '*';
                return {
                    name: parts[1] || '',
                    isCurrent,
                    isRemote: false,
                    lastCommitSubject: parts[2] || '',
                    lastCommitDate: parts[3] || ''
                };
            }).filter(b => b.name);

            return {
                branches,
                totalCount,
                hasMore: offset + branches.length < totalCount
            };
        } catch (error) {
            getExtensionLogger().error(LogCategory.GIT, 'Failed to get paginated local branches', error instanceof Error ? error : undefined);
            return { branches: [], totalCount: 0, hasMore: false };
        }
    }

    /**
     * Get remote branches with pagination and search support
     * @param repoRoot Repository root path
     * @param options Pagination and search options
     */
    getRemoteBranchesPaginated(repoRoot: string, options: BranchListOptions = {}): PaginatedBranchResult {
        const { limit = 100, offset = 0, searchPattern } = options;

        try {
            // Get total count first
            const totalCount = this.getRemoteBranchCount(repoRoot, searchPattern);

            if (totalCount === 0) {
                return { branches: [], totalCount: 0, hasMore: false };
            }

            const format = '%(refname:short)|%(subject)|%(committerdate:relative)';
            let command = `git branch -r --format="${format}"`;

            // Filter out HEAD and apply search
            if (process.platform === 'win32') {
                command += ' | findstr /v "HEAD"';
                if (searchPattern) {
                    const escapedPattern = searchPattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                    command += ` | findstr /i "${escapedPattern}"`;
                }
            } else {
                command += ' | grep -v "HEAD"';
                if (searchPattern) {
                    const escapedPattern = searchPattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                    command += ` | grep -i "${escapedPattern}"`;
                }
                if (offset > 0) {
                    command += ` | tail -n +${offset + 1}`;
                }
                command += ` | head -n ${limit}`;
            }

            const output = this.execGitSync(command, { cwd: repoRoot, timeout: 30000 });

            if (!output.trim()) {
                return { branches: [], totalCount, hasMore: offset + limit < totalCount };
            }

            let lines = output.trim().split('\n').filter(line => !line.includes('HEAD'));

            // For Windows, apply pagination in JS
            if (process.platform === 'win32') {
                if (searchPattern) {
                    const lowerPattern = searchPattern.toLowerCase();
                    lines = lines.filter(line => {
                        const parts = line.split('|');
                        const branchName = parts[0] || '';
                        return branchName.toLowerCase().includes(lowerPattern);
                    });
                }
                lines = lines.slice(offset, offset + limit);
            }

            const branches = lines.map(line => {
                const parts = line.split('|');
                const fullName = parts[0] || '';
                const slashIndex = fullName.indexOf('/');
                const remoteName = slashIndex > 0 ? fullName.substring(0, slashIndex) : undefined;

                return {
                    name: fullName,
                    isCurrent: false,
                    isRemote: true,
                    remoteName,
                    lastCommitSubject: parts[1] || '',
                    lastCommitDate: parts[2] || ''
                };
            }).filter(b => b.name);

            return {
                branches,
                totalCount,
                hasMore: offset + branches.length < totalCount
            };
        } catch (error) {
            getExtensionLogger().error(LogCategory.GIT, 'Failed to get paginated remote branches', error instanceof Error ? error : undefined);
            return { branches: [], totalCount: 0, hasMore: false };
        }
    }

    /**
     * Search branches by name (combines local and remote)
     * Returns a limited set for quick display, suitable for type-ahead search
     * @param repoRoot Repository root path
     * @param searchPattern Search pattern
     * @param limit Maximum results to return
     */
    searchBranches(repoRoot: string, searchPattern: string, limit: number = 50): { local: GitBranch[]; remote: GitBranch[] } {
        const localResult = this.getLocalBranchesPaginated(repoRoot, { searchPattern, limit });
        const remoteResult = this.getRemoteBranchesPaginated(repoRoot, { searchPattern, limit });

        return {
            local: localResult.branches,
            remote: remoteResult.branches
        };
    }

    /**
     * Switch to a branch
     * @param repoRoot Repository root path
     * @param branchName Branch name to switch to
     * @param options Optional: create new branch, force checkout
     */
    async switchBranch(
        repoRoot: string,
        branchName: string,
        options?: { create?: boolean; force?: boolean }
    ): Promise<{ success: boolean; error?: string }> {
        try {
            let command = 'git checkout';
            
            if (options?.create) {
                command += ' -b';
            }
            if (options?.force) {
                command += ' -f';
            }
            
            // Quote branch name for safety
            command += ` "${branchName}"`;

            await this.execGitAsync(command, { cwd: repoRoot });
            return { success: true };
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Unknown error';
            getExtensionLogger().error(LogCategory.GIT, `Failed to switch to branch ${branchName}`, error instanceof Error ? error : undefined);
            return { success: false, error: message };
        }
    }

    /**
     * Create a new branch from the current HEAD
     * @param repoRoot Repository root path
     * @param branchName New branch name
     * @param checkout Whether to checkout the new branch
     */
    async createBranch(
        repoRoot: string,
        branchName: string,
        checkout: boolean = true
    ): Promise<{ success: boolean; error?: string }> {
        try {
            if (checkout) {
                await this.execGitAsync(`git checkout -b "${branchName}"`, { cwd: repoRoot });
            } else {
                await this.execGitAsync(`git branch "${branchName}"`, { cwd: repoRoot });
            }
            return { success: true };
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Unknown error';
            getExtensionLogger().error(LogCategory.GIT, `Failed to create branch ${branchName}`, error instanceof Error ? error : undefined);
            return { success: false, error: message };
        }
    }

    /**
     * Delete a branch
     * @param repoRoot Repository root path
     * @param branchName Branch name to delete
     * @param force Force delete even if not merged
     */
    async deleteBranch(
        repoRoot: string,
        branchName: string,
        force: boolean = false
    ): Promise<{ success: boolean; error?: string }> {
        try {
            const flag = force ? '-D' : '-d';
            await this.execGitAsync(`git branch ${flag} "${branchName}"`, { cwd: repoRoot });
            return { success: true };
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Unknown error';
            getExtensionLogger().error(LogCategory.GIT, `Failed to delete branch ${branchName}`, error instanceof Error ? error : undefined);
            return { success: false, error: message };
        }
    }

    /**
     * Stash changes
     * @param repoRoot Repository root path
     * @param message Optional stash message
     */
    async stashChanges(repoRoot: string, message?: string): Promise<{ success: boolean; error?: string }> {
        try {
            const cmd = message 
                ? `git stash push -m "${message.replace(/"/g, '\\"')}"` 
                : 'git stash push';
            await this.execGitAsync(cmd, { cwd: repoRoot });
            return { success: true };
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Unknown error';
            getExtensionLogger().error(LogCategory.GIT, 'Failed to stash changes', error instanceof Error ? error : undefined);
            return { success: false, error: message };
        }
    }

    /**
     * Pop the most recent stash
     * @param repoRoot Repository root path
     */
    async popStash(repoRoot: string): Promise<{ success: boolean; error?: string }> {
        try {
            await this.execGitAsync('git stash pop', { cwd: repoRoot });
            return { success: true };
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Unknown error';
            getExtensionLogger().error(LogCategory.GIT, 'Failed to pop stash', error instanceof Error ? error : undefined);
            return { success: false, error: message };
        }
    }

    /**
     * Check if there are uncommitted changes (staged or unstaged)
     * @param repoRoot Repository root path
     */
    hasUncommittedChanges(repoRoot: string): boolean {
        try {
            const output = this.execGitSync('git status --porcelain', { cwd: repoRoot });
            return output.trim().length > 0;
        } catch {
            return false;
        }
    }

    /**
     * Fetch from remote (to update remote branch list)
     * @param repoRoot Repository root path
     * @param remote Remote name (default: all remotes)
     */
    async fetch(repoRoot: string, remote?: string): Promise<{ success: boolean; error?: string }> {
        try {
            const cmd = remote ? `git fetch "${remote}"` : 'git fetch --all';
            await this.execGitAsync(cmd, { cwd: repoRoot, timeout: 60000 });
            return { success: true };
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Unknown error';
            getExtensionLogger().error(LogCategory.GIT, 'Failed to fetch', error instanceof Error ? error : undefined);
            return { success: false, error: message };
        }
    }

    /**
     * Pull from remote
     * @param repoRoot Repository root path
     * @param rebase Use rebase instead of merge
     */
    async pull(repoRoot: string, rebase: boolean = false): Promise<{ success: boolean; error?: string }> {
        try {
            const cmd = rebase ? 'git pull --rebase' : 'git pull';
            await this.execGitAsync(cmd, { cwd: repoRoot, timeout: 60000 });
            return { success: true };
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Unknown error';
            getExtensionLogger().error(LogCategory.GIT, 'Failed to pull', error instanceof Error ? error : undefined);
            return { success: false, error: message };
        }
    }

    /**
     * Push to remote
     * @param repoRoot Repository root path
     * @param setUpstream Set upstream tracking
     */
    async push(repoRoot: string, setUpstream: boolean = false): Promise<{ success: boolean; error?: string }> {
        try {
            let cmd = 'git push';
            if (setUpstream) {
                const branchName = this.getCurrentBranchName(repoRoot);
                if (branchName) {
                    cmd = `git push -u origin "${branchName}"`;
                }
            }
            await this.execGitAsync(cmd, { cwd: repoRoot, timeout: 60000 });
            return { success: true };
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Unknown error';
            getExtensionLogger().error(LogCategory.GIT, 'Failed to push', error instanceof Error ? error : undefined);
            return { success: false, error: message };
        }
    }

    /**
     * Rename a branch
     * @param repoRoot Repository root path
     * @param oldName Current branch name
     * @param newName New branch name
     */
    async renameBranch(
        repoRoot: string,
        oldName: string,
        newName: string
    ): Promise<{ success: boolean; error?: string }> {
        try {
            await this.execGitAsync(`git branch -m "${oldName}" "${newName}"`, { cwd: repoRoot });
            return { success: true };
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Unknown error';
            getExtensionLogger().error(LogCategory.GIT, `Failed to rename branch ${oldName} to ${newName}`, error instanceof Error ? error : undefined);
            return { success: false, error: message };
        }
    }

    /**
     * Merge a branch into the current branch
     * @param repoRoot Repository root path
     * @param branchName Branch to merge
     */
    async mergeBranch(repoRoot: string, branchName: string): Promise<{ success: boolean; error?: string }> {
        try {
            await this.execGitAsync(`git merge "${branchName}"`, { cwd: repoRoot, timeout: 60000 });
            return { success: true };
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Unknown error';
            getExtensionLogger().error(LogCategory.GIT, `Failed to merge branch ${branchName}`, error instanceof Error ? error : undefined);
            return { success: false, error: message };
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
    }
}
