/**
 * Pure Node.js BranchService — no VS Code dependencies.
 *
 * Provides branch listing, switching, creating, deleting, merging,
 * push/pull/fetch, stash, and status queries using git CLI.
 *
 * Extracted from `src/shortcuts/git/branch-service.ts`.
 */

import { execSync } from 'child_process';
import { execAsync } from '../utils/exec-utils';
import { getLogger } from '../logger';
import {
    BranchStatus,
    GitBranch,
    BranchListOptions,
    PaginatedBranchResult,
    GitOperationResult,
} from './types';

/**
 * Options for git command execution (internal).
 */
interface GitExecOptions {
    cwd: string;
    timeout?: number;
    encoding?: BufferEncoding;
}

/**
 * Service for branch-related git operations.
 * Handles branch listing, switching, creating, and deleting.
 */
export class BranchService {

    /**
     * Execute a git command synchronously.
     * Uses cross-platform compatible options.
     */
    private execGitSync(command: string, options: GitExecOptions): string {
        return execSync(command, {
            cwd: options.cwd,
            encoding: options.encoding || 'utf-8',
            timeout: options.timeout || 10000,
            shell: process.platform === 'win32' ? 'cmd.exe' : '/bin/sh',
            stdio: ['pipe', 'pipe', 'pipe']
        });
    }

    /**
     * Execute a git command asynchronously via execAsync.
     */
    private async execGitAsync(command: string, options: GitExecOptions): Promise<string> {
        const { stdout } = await execAsync(command, {
            cwd: options.cwd,
            timeout: options.timeout || 30000,
            shell: process.platform === 'win32' ? 'cmd.exe' : '/bin/sh',
        });
        return stdout;
    }

    /**
     * Get the current branch status.
     * @param repoRoot Repository root path
     * @param hasUncommittedChanges Whether there are uncommitted changes
     */
    getBranchStatus(repoRoot: string, hasUncommittedChanges: boolean): BranchStatus | null {
        try {
            const headHash = this.getHeadHash(repoRoot);
            if (!headHash) {
                return null;
            }

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

            const branchName = this.getCurrentBranchName(repoRoot);
            if (!branchName) {
                return null;
            }

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
            getLogger().error('Git', 'Failed to get branch status', error instanceof Error ? error : undefined);
            return null;
        }
    }

    /**
     * Check if HEAD is detached.
     */
    private isDetachedHead(repoRoot: string): boolean {
        try {
            const output = this.execGitSync('git symbolic-ref -q HEAD', { cwd: repoRoot });
            return !output.trim();
        } catch {
            return true;
        }
    }

    /**
     * Get the HEAD commit hash.
     */
    private getHeadHash(repoRoot: string): string {
        try {
            return this.execGitSync('git rev-parse HEAD', { cwd: repoRoot }).trim();
        } catch {
            return '';
        }
    }

    /**
     * Get the current branch name.
     */
    private getCurrentBranchName(repoRoot: string): string | null {
        try {
            const output = this.execGitSync('git rev-parse --abbrev-ref HEAD', { cwd: repoRoot });
            const name = output.trim();
            return name === 'HEAD' ? null : name;
        } catch {
            return null;
        }
    }

    /**
     * Get tracking branch information (ahead/behind counts).
     */
    private getTrackingBranchInfo(repoRoot: string, branchName: string): {
        trackingBranch?: string;
        ahead: number;
        behind: number;
    } {
        try {
            const upstreamCmd = `git rev-parse --abbrev-ref "${branchName}@{upstream}"`;
            let trackingBranch: string | undefined;

            try {
                trackingBranch = this.execGitSync(upstreamCmd, { cwd: repoRoot }).trim();
            } catch {
                return { ahead: 0, behind: 0 };
            }

            const aheadCmd = `git rev-list --count "${trackingBranch}..${branchName}"`;
            const behindCmd = `git rev-list --count "${branchName}..${trackingBranch}"`;

            const ahead = parseInt(this.execGitSync(aheadCmd, { cwd: repoRoot }).trim(), 10) || 0;
            const behind = parseInt(this.execGitSync(behindCmd, { cwd: repoRoot }).trim(), 10) || 0;

            return { trackingBranch, ahead, behind };
        } catch (error) {
            getLogger().error('Git', 'Failed to get tracking info', error instanceof Error ? error : undefined);
            return { ahead: 0, behind: 0 };
        }
    }

    /**
     * Get all local branches.
     */
    getLocalBranches(repoRoot: string): GitBranch[] {
        try {
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
            getLogger().error('Git', 'Failed to get local branches', error instanceof Error ? error : undefined);
            return [];
        }
    }

    /**
     * Get remote branches.
     */
    getRemoteBranches(repoRoot: string): GitBranch[] {
        try {
            const format = '%(refname:short)|%(subject)|%(committerdate:relative)';
            const output = this.execGitSync(`git branch -r --format="${format}"`, { cwd: repoRoot });

            if (!output.trim()) {
                return [];
            }

            return output.trim().split('\n')
                .filter(line => !line.includes('HEAD'))
                .map(line => {
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
        } catch (error) {
            getLogger().error('Git', 'Failed to get remote branches', error instanceof Error ? error : undefined);
            return [];
        }
    }

    /**
     * Get all branches (local and remote).
     */
    getAllBranches(repoRoot: string): { local: GitBranch[]; remote: GitBranch[] } {
        return {
            local: this.getLocalBranches(repoRoot),
            remote: this.getRemoteBranches(repoRoot)
        };
    }

    /**
     * Get local branch count (fast operation).
     */
    getLocalBranchCount(repoRoot: string, searchPattern?: string): number {
        try {
            const command = 'git branch --list';
            const output = this.execGitSync(command, { cwd: repoRoot });
            if (!output.trim()) {
                return 0;
            }
            let lines = output.trim().split('\n').filter(line => line.trim());

            if (searchPattern) {
                const lowerPattern = searchPattern.toLowerCase();
                lines = lines.filter(line => {
                    const branchName = line.substring(2).trim();
                    return branchName.toLowerCase().includes(lowerPattern);
                });
            }

            return lines.length;
        } catch (error) {
            getLogger().error('Git', 'Failed to get local branch count', error instanceof Error ? error : undefined);
            return 0;
        }
    }

    /**
     * Get remote branch count (fast operation).
     */
    getRemoteBranchCount(repoRoot: string, searchPattern?: string): number {
        try {
            const command = 'git branch -r --list';
            const output = this.execGitSync(command, { cwd: repoRoot });
            if (!output.trim()) {
                return 0;
            }
            let lines = output.trim().split('\n').filter(line => line.trim() && !line.includes('HEAD'));

            if (searchPattern) {
                const lowerPattern = searchPattern.toLowerCase();
                lines = lines.filter(line => {
                    const branchName = line.trim();
                    return branchName.toLowerCase().includes(lowerPattern);
                });
            }

            return lines.length;
        } catch (error) {
            getLogger().error('Git', 'Failed to get remote branch count', error instanceof Error ? error : undefined);
            return 0;
        }
    }

    /**
     * Get local branches with pagination and search support.
     */
    getLocalBranchesPaginated(repoRoot: string, options: BranchListOptions = {}): PaginatedBranchResult {
        const { limit = 100, offset = 0, searchPattern } = options;

        try {
            const totalCount = this.getLocalBranchCount(repoRoot, searchPattern);

            if (totalCount === 0) {
                return { branches: [], totalCount: 0, hasMore: false };
            }

            const format = '%(if)%(HEAD)%(then)*%(else) %(end)|%(refname:short)|%(subject)|%(committerdate:relative)';
            let command = `git branch --format="${format}"`;

            if (searchPattern) {
                const escapedPattern = searchPattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                if (process.platform === 'win32') {
                    command += ` | findstr /i "${escapedPattern}"`;
                } else {
                    command += ` | grep -i "${escapedPattern}"`;
                }
            }

            if (process.platform !== 'win32') {
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
            getLogger().error('Git', 'Failed to get paginated local branches', error instanceof Error ? error : undefined);
            return { branches: [], totalCount: 0, hasMore: false };
        }
    }

    /**
     * Get remote branches with pagination and search support.
     */
    getRemoteBranchesPaginated(repoRoot: string, options: BranchListOptions = {}): PaginatedBranchResult {
        const { limit = 100, offset = 0, searchPattern } = options;

        try {
            const totalCount = this.getRemoteBranchCount(repoRoot, searchPattern);

            if (totalCount === 0) {
                return { branches: [], totalCount: 0, hasMore: false };
            }

            const format = '%(refname:short)|%(subject)|%(committerdate:relative)';
            let command = `git branch -r --format="${format}"`;

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
            getLogger().error('Git', 'Failed to get paginated remote branches', error instanceof Error ? error : undefined);
            return { branches: [], totalCount: 0, hasMore: false };
        }
    }

    /**
     * Search branches by name (combines local and remote).
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
     * Switch to a branch.
     */
    async switchBranch(
        repoRoot: string,
        branchName: string,
        options?: { create?: boolean; force?: boolean }
    ): Promise<GitOperationResult> {
        try {
            let command = 'git checkout';

            if (options?.create) {
                command += ' -b';
            }
            if (options?.force) {
                command += ' -f';
            }

            command += ` "${branchName}"`;

            await this.execGitAsync(command, { cwd: repoRoot });
            return { success: true };
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';
            getLogger().error('Git', `Failed to switch to branch ${branchName}`, error instanceof Error ? error : undefined);
            return { success: false, error: errorMessage };
        }
    }

    /**
     * Create a new branch from the current HEAD.
     */
    async createBranch(
        repoRoot: string,
        branchName: string,
        checkout: boolean = true
    ): Promise<GitOperationResult> {
        try {
            if (checkout) {
                await this.execGitAsync(`git checkout -b "${branchName}"`, { cwd: repoRoot });
            } else {
                await this.execGitAsync(`git branch "${branchName}"`, { cwd: repoRoot });
            }
            return { success: true };
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';
            getLogger().error('Git', `Failed to create branch ${branchName}`, error instanceof Error ? error : undefined);
            return { success: false, error: errorMessage };
        }
    }

    /**
     * Delete a branch.
     */
    async deleteBranch(
        repoRoot: string,
        branchName: string,
        force: boolean = false
    ): Promise<GitOperationResult> {
        try {
            const flag = force ? '-D' : '-d';
            await this.execGitAsync(`git branch ${flag} "${branchName}"`, { cwd: repoRoot });
            return { success: true };
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';
            getLogger().error('Git', `Failed to delete branch ${branchName}`, error instanceof Error ? error : undefined);
            return { success: false, error: errorMessage };
        }
    }

    /**
     * Rename a branch.
     */
    async renameBranch(
        repoRoot: string,
        oldName: string,
        newName: string
    ): Promise<GitOperationResult> {
        try {
            await this.execGitAsync(`git branch -m "${oldName}" "${newName}"`, { cwd: repoRoot });
            return { success: true };
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';
            getLogger().error('Git', `Failed to rename branch ${oldName} to ${newName}`, error instanceof Error ? error : undefined);
            return { success: false, error: errorMessage };
        }
    }

    /**
     * Merge a branch into the current branch.
     */
    async mergeBranch(repoRoot: string, branchName: string): Promise<GitOperationResult> {
        try {
            await this.execGitAsync(`git merge "${branchName}"`, { cwd: repoRoot, timeout: 60000 });
            return { success: true };
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';
            getLogger().error('Git', `Failed to merge branch ${branchName}`, error instanceof Error ? error : undefined);
            return { success: false, error: errorMessage };
        }
    }

    /**
     * Push to remote.
     */
    async push(repoRoot: string, setUpstream: boolean = false): Promise<GitOperationResult> {
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
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';
            getLogger().error('Git', 'Failed to push', error instanceof Error ? error : undefined);
            return { success: false, error: errorMessage };
        }
    }

    /**
     * Pull from remote.
     */
    async pull(repoRoot: string, rebase: boolean = false): Promise<GitOperationResult> {
        try {
            const cmd = rebase ? 'git pull --rebase' : 'git pull';
            await this.execGitAsync(cmd, { cwd: repoRoot, timeout: 60000 });
            return { success: true };
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';
            getLogger().error('Git', 'Failed to pull', error instanceof Error ? error : undefined);
            return { success: false, error: errorMessage };
        }
    }

    /**
     * Fetch from remote.
     */
    async fetch(repoRoot: string, remote?: string): Promise<GitOperationResult> {
        try {
            const cmd = remote ? `git fetch "${remote}"` : 'git fetch --all';
            await this.execGitAsync(cmd, { cwd: repoRoot, timeout: 60000 });
            return { success: true };
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';
            getLogger().error('Git', 'Failed to fetch', error instanceof Error ? error : undefined);
            return { success: false, error: errorMessage };
        }
    }

    /**
     * Stash changes.
     */
    async stashChanges(repoRoot: string, message?: string): Promise<GitOperationResult> {
        try {
            const cmd = message
                ? `git stash push -m "${message.replace(/"/g, '\\"')}"`
                : 'git stash push';
            await this.execGitAsync(cmd, { cwd: repoRoot });
            return { success: true };
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';
            getLogger().error('Git', 'Failed to stash changes', error instanceof Error ? error : undefined);
            return { success: false, error: errorMessage };
        }
    }

    /**
     * Pop the most recent stash.
     */
    async popStash(repoRoot: string): Promise<GitOperationResult> {
        try {
            await this.execGitAsync('git stash pop', { cwd: repoRoot });
            return { success: true };
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';
            getLogger().error('Git', 'Failed to pop stash', error instanceof Error ? error : undefined);
            return { success: false, error: errorMessage };
        }
    }

    /**
     * Check if there are uncommitted changes (staged or unstaged).
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
     * Dispose of resources (no-op, provided for Disposable interface compatibility).
     */
    dispose(): void {
        // No resources to clean up
    }
}
