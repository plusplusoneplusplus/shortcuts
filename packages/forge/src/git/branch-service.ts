/**
 * Pure Node.js BranchService — no VS Code dependencies.
 *
 * Provides branch listing, switching, creating, deleting, merging,
 * push/pull/fetch, stash, and status queries using git CLI.
 *
 * Extracted from `src/shortcuts/git/branch-service.ts`.
 */

import { execFileSync, execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { execAsync, execFileAsync } from '../utils/exec-utils';
import { getLogger } from '../logger';
import { ensureGitSafeDirectoryAsync, ensureGitSafeDirectorySync } from './safe-directory';
import {
    buildWslCommandArgs,
    getWslExecutablePath,
    resolveWorkspaceExecutionContext,
    translatePathForExecution,
} from '../utils/workspace-execution';
import {
    BranchStatus,
    GitBranch,
    BranchListOptions,
    PaginatedBranchResult,
    GitOperationResult,
    GitPatchApplyOptions,
    GitPatchApplyResult,
    GitPatchExportResult,
    RepoState,
} from './types';

/**
 * Options for git command execution (internal).
 */
interface GitExecOptions {
    cwd: string;
    timeout?: number;
    encoding?: BufferEncoding;
    env?: NodeJS.ProcessEnv;
}

/**
 * Service for branch-related git operations.
 * Handles branch listing, switching, creating, and deleting.
 */
export class BranchService {

    /**
     * Execute a git command synchronously.
     * Used by branch management operations (create, switch, delete, etc.).
     */
    private execGitSync(command: string, options: GitExecOptions): string {
        ensureGitSafeDirectorySync(options.cwd);
        const executionContext = resolveWorkspaceExecutionContext(options.cwd);
        if (executionContext.kind === 'wsl') {
            return execFileSync(getWslExecutablePath(), buildWslCommandArgs(executionContext, ['sh', '-lc', command]), {
                encoding: options.encoding || 'utf-8',
                timeout: options.timeout || 10000,
                windowsHide: true,
                stdio: ['pipe', 'pipe', 'pipe'],
            });
        }
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
    private async execGit(command: string, options: GitExecOptions): Promise<string> {
        await ensureGitSafeDirectoryAsync(options.cwd);
        const executionContext = resolveWorkspaceExecutionContext(options.cwd);
        if (executionContext.kind === 'wsl') {
            const { stdout } = await execFileAsync(
                getWslExecutablePath(),
                buildWslCommandArgs(executionContext, ['sh', '-lc', command]),
                {
                    timeout: options.timeout || 30000,
                    windowsHide: true,
                    env: {
                        ...process.env,
                        GIT_TERMINAL_PROMPT: '0',
                        ...options.env,
                    },
                },
            );
            return stdout;
        }

        const { stdout } = await execAsync(command, {
            cwd: options.cwd,
            timeout: options.timeout || 30000,
            shell: process.platform === 'win32' ? 'cmd.exe' : '/bin/sh',
            env: {
                ...process.env,
                GIT_TERMINAL_PROMPT: '0',
                ...options.env,
            },
        });
        return stdout;
    }

    /**
     * Execute git with an explicit argv array (no shell interpolation).
     * Safe for paths with spaces, backslashes, or shell metacharacters on all platforms.
     * For WSL contexts, path arguments are translated from Windows UNC paths to Linux paths.
     */
    private async execGitFileAsync(args: string[], options: GitExecOptions): Promise<string> {
        await ensureGitSafeDirectoryAsync(options.cwd);
        const executionContext = resolveWorkspaceExecutionContext(options.cwd);

        if (executionContext.kind === 'wsl') {
            const translatedArgs = args.map(arg => {
                try {
                    return translatePathForExecution(arg, executionContext);
                } catch {
                    return arg;
                }
            });
            const { stdout } = await execFileAsync(
                getWslExecutablePath(),
                buildWslCommandArgs(executionContext, ['git', ...translatedArgs]),
                {
                    timeout: options.timeout || 30000,
                    windowsHide: true,
                    env: {
                        ...process.env,
                        GIT_TERMINAL_PROMPT: '0',
                        ...options.env,
                    },
                },
            );
            return stdout;
        }

        const { stdout } = await execFileAsync(
            'git',
            args,
            {
                cwd: options.cwd,
                timeout: options.timeout || 30000,
                env: {
                    ...process.env,
                    GIT_TERMINAL_PROMPT: '0',
                    ...options.env,
                },
            },
        );
        return stdout;
    }

    private quoteShellArg(value: string): string {
        if (process.platform === 'win32') {
            return `"${value.replace(/"/g, '\\"')}"`;
        }
        return `'${value.replace(/'/g, `'\\''`)}'`;
    }

    private getResolvedGitDir(repoRoot: string): string {
        const gitDir = this.execGitSync('git rev-parse --git-dir', { cwd: repoRoot }).trim();
        return path.isAbsolute(gitDir) ? gitDir : path.join(repoRoot, gitDir);
    }

    /**
     * Get the current branch status.
     * @param repoRoot Repository root path
     * @param hasUncommittedChanges Whether there are uncommitted changes
     */
    async getBranchStatus(repoRoot: string, hasUncommittedChanges: boolean): Promise<BranchStatus | null> {
        try {
            const headHash = await this.getHeadHash(repoRoot);
            if (!headHash) {
                return null;
            }

            const isDetached = await this.isDetachedHead(repoRoot);

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

            const branchName = await this.getCurrentBranchName(repoRoot);
            if (!branchName) {
                return null;
            }

            const trackingInfo = await this.getTrackingBranchInfo(repoRoot, branchName);

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
    private async isDetachedHead(repoRoot: string): Promise<boolean> {
        try {
            const output = await this.execGit('git symbolic-ref -q HEAD', { cwd: repoRoot });
            return !output.trim();
        } catch {
            return true;
        }
    }

    /**
     * Get the HEAD commit hash.
     */
    private async getHeadHash(repoRoot: string): Promise<string> {
        try {
            return (await this.execGit('git rev-parse HEAD', { cwd: repoRoot })).trim();
        } catch {
            return '';
        }
    }

    /**
     * Get the current branch name.
     */
    private async getCurrentBranchName(repoRoot: string): Promise<string | null> {
        try {
            const output = await this.execGit('git rev-parse --abbrev-ref HEAD', { cwd: repoRoot });
            const name = output.trim();
            return name === 'HEAD' ? null : name;
        } catch {
            return null;
        }
    }

    /**
     * Get tracking branch information (ahead/behind counts).
     */
    private async getTrackingBranchInfo(repoRoot: string, branchName: string): Promise<{
        trackingBranch?: string;
        ahead: number;
        behind: number;
    }> {
        try {
            const upstreamCmd = `git rev-parse --abbrev-ref "${branchName}@{upstream}"`;
            let trackingBranch: string | undefined;

            try {
                trackingBranch = (await this.execGit(upstreamCmd, { cwd: repoRoot })).trim();
            } catch {
                return { ahead: 0, behind: 0 };
            }

            const aheadCmd = `git rev-list --count "${trackingBranch}..${branchName}"`;
            const behindCmd = `git rev-list --count "${branchName}..${trackingBranch}"`;

            const [aheadStr, behindStr] = await Promise.all([
                this.execGit(aheadCmd, { cwd: repoRoot }),
                this.execGit(behindCmd, { cwd: repoRoot }),
            ]);

            const ahead = parseInt(aheadStr.trim(), 10) || 0;
            const behind = parseInt(behindStr.trim(), 10) || 0;

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
        const useWindowsPipeline = process.platform === 'win32' && resolveWorkspaceExecutionContext(repoRoot).kind !== 'wsl';

        try {
            const totalCount = this.getLocalBranchCount(repoRoot, searchPattern);

            if (totalCount === 0) {
                return { branches: [], totalCount: 0, hasMore: false };
            }

            const format = '%(if)%(HEAD)%(then)*%(else) %(end)|%(refname:short)|%(subject)|%(committerdate:relative)';
            let command = `git branch --format="${format}"`;

            if (searchPattern) {
                const escapedPattern = searchPattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                if (useWindowsPipeline) {
                    command += ` | findstr /i "${escapedPattern}"`;
                } else {
                    command += ` | grep -i "${escapedPattern}"`;
                }
            }

            if (!useWindowsPipeline) {
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

            if (useWindowsPipeline) {
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
        const useWindowsPipeline = process.platform === 'win32' && resolveWorkspaceExecutionContext(repoRoot).kind !== 'wsl';

        try {
            const totalCount = this.getRemoteBranchCount(repoRoot, searchPattern);

            if (totalCount === 0) {
                return { branches: [], totalCount: 0, hasMore: false };
            }

            const format = '%(refname:short)|%(subject)|%(committerdate:relative)';
            let command = `git branch -r --format="${format}"`;

            if (useWindowsPipeline) {
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

            if (useWindowsPipeline) {
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

            await this.execGit(command, { cwd: repoRoot });
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
                await this.execGit(`git checkout -b "${branchName}"`, { cwd: repoRoot });
            } else {
                await this.execGit(`git branch "${branchName}"`, { cwd: repoRoot });
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
            await this.execGit(`git branch ${flag} "${branchName}"`, { cwd: repoRoot });
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
            await this.execGit(`git branch -m "${oldName}" "${newName}"`, { cwd: repoRoot });
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
            await this.execGit(`git merge "${branchName}"`, { cwd: repoRoot, timeout: 600000 });
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
                const branchName = await this.getCurrentBranchName(repoRoot);
                if (branchName) {
                    cmd = `git push -u origin "${branchName}"`;
                }
            }
            await this.execGit(cmd, { cwd: repoRoot, timeout: 600000 });
            return { success: true };
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';
            getLogger().error('Git', 'Failed to push', error instanceof Error ? error : undefined);
            return { success: false, error: errorMessage };
        }
    }

    /**
     * Push commits up to (and including) the given commit hash to the remote.
     * Leaves newer unpushed commits local.
     */
    async pushUpTo(repoRoot: string, commitHash: string): Promise<GitOperationResult> {
        try {
            const branchName = await this.getCurrentBranchName(repoRoot);
            if (!branchName) {
                return { success: false, error: 'Cannot determine current branch (detached HEAD?)' };
            }
            const cmd = `git push origin "${commitHash}":refs/heads/"${branchName}"`;
            await this.execGit(cmd, { cwd: repoRoot, timeout: 600000 });
            return { success: true };
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';
            getLogger().error('Git', 'Failed to push up to commit', error instanceof Error ? error : undefined);
            return { success: false, error: errorMessage };
        }
    }

    /**
     * Pull from remote.
     */
    async pull(repoRoot: string, rebase: boolean = false): Promise<GitOperationResult> {
        try {
            const cmd = rebase ? 'git pull --rebase' : 'git pull';
            await this.execGit(cmd, { cwd: repoRoot, timeout: 600000 });
            return { success: true };
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';
            getLogger().error('Git', 'Failed to pull', error instanceof Error ? error : undefined);
            return { success: false, error: errorMessage };
        }
    }

    /**
     * Run a non-interactive git rebase --autosquash against the upstream branch.
     * GIT_SEQUENCE_EDITOR is set to a no-op so git accepts the pre-generated
     * todo list immediately without opening an editor.
     */
    async rebaseAutosquash(repoRoot: string): Promise<GitOperationResult> {
        try {
            const seqEditor = process.platform === 'win32' ? 'true' : ':';
            await this.execGit('git rebase -i --autosquash @{upstream}', {
                cwd: repoRoot,
                timeout: 600000,
                env: { GIT_SEQUENCE_EDITOR: seqEditor },
            });
            return { success: true };
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';
            getLogger().error('Git', 'Failed to rebase --autosquash', error instanceof Error ? error : undefined);
            return { success: false, error: errorMessage };
        }
    }

    /**
     * Fetch from remote.
     */
    async fetch(repoRoot: string, remote?: string): Promise<GitOperationResult> {
        try {
            const cmd = remote ? `git fetch "${remote}"` : 'git fetch --all';
            await this.execGit(cmd, { cwd: repoRoot, timeout: 600000 });
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
            await this.execGit(cmd, { cwd: repoRoot });
            return { success: true };
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';
            getLogger().error('Git', 'Failed to stash changes', error instanceof Error ? error : undefined);
            return { success: false, error: errorMessage };
        }
    }

    /**
     * Cherry-pick a commit onto the current branch.
     * @returns success: true on clean apply, conflicts: true when merge conflicts occur
     */
    async cherryPick(repoRoot: string, hash: string): Promise<{ success: boolean; conflicts: boolean; message: string }> {
        try {
            await this.execGit(`git cherry-pick ${hash}`, { cwd: repoRoot });
            return { success: true, conflicts: false, message: 'Cherry-pick applied successfully' };
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';
            const isConflict = /CONFLICT|conflict/i.test(errorMessage) || /cherry-pick.*conflict/i.test(errorMessage) || /Merge conflict/i.test(errorMessage);
            if (isConflict) {
                return { success: false, conflicts: true, message: errorMessage };
            }
            getLogger().error('Git', `Failed to cherry-pick ${hash}`, error instanceof Error ? error : undefined);
            return { success: false, conflicts: false, message: errorMessage };
        }
    }

    /**
     * Export one commit as a format-patch payload suitable for git am.
     */
    async exportCommitPatch(repoRoot: string, hash: string): Promise<GitPatchExportResult> {
        const trimmedHash = hash.trim();
        if (!/^[a-fA-F0-9]{4,40}$/.test(trimmedHash)) {
            return { success: false, error: 'Invalid commit hash' };
        }

        try {
            const commitish = this.quoteShellArg(`${trimmedHash}^{commit}`);
            const commitHash = (await this.execGit(`git rev-parse --verify ${commitish}`, { cwd: repoRoot })).trim();
            const metadata = await this.execGit(`git show -s --format=%H%x00%s%x00%an%x00%ae%x00%aI ${commitHash}`, { cwd: repoRoot });
            const [fullHash, subject, authorName, authorEmail, authorDate] = metadata.replace(/\n$/, '').split('\0');
            if (!fullHash || !subject || !authorName || !authorEmail || !authorDate) {
                return { success: false, error: 'Failed to read commit metadata' };
            }

            const patch = await this.execGit(`git format-patch -1 --stdout --no-stat ${commitHash}`, {
                cwd: repoRoot,
                timeout: 600000,
            });
            return {
                success: true,
                commitHash: fullHash,
                subject,
                authorName,
                authorEmail,
                authorDate,
                patch,
            };
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';
            getLogger().error('Git', `Failed to export commit patch ${trimmedHash}`, error instanceof Error ? error : undefined);
            return { success: false, error: errorMessage };
        }
    }

    /**
     * Apply a format-patch payload with git am --3way.
     */
    async applyCommitPatch(repoRoot: string, patchBody: string, options: GitPatchApplyOptions = {}): Promise<GitPatchApplyResult> {
        if (!patchBody || !patchBody.trim()) {
            return { success: false, conflicts: false, message: 'Patch body must not be empty' };
        }

        const repoState = this.getRepoState(repoRoot);
        if (repoState.operation !== 'none') {
            return {
                success: false,
                conflicts: false,
                message: `Repository already has a ${repoState.gitOperation ?? repoState.operation} operation in progress`,
                gitState: repoState,
            };
        }

        let stashed = false;
        let tmpDir: string | undefined;
        try {
            if (await this.hasUncommittedChanges(repoRoot)) {
                if (!options.stashAndContinue) {
                    return {
                        success: false,
                        conflicts: false,
                        dirty: true,
                        stashed: false,
                        message: 'Target workspace has uncommitted changes. Choose stash and continue to proceed explicitly.',
                    };
                }
                const stashMessage = options.stashMessage ?? 'CoC patch-transfer cherry-pick';
                await this.execGit(`git stash push -u -m ${this.quoteShellArg(stashMessage)}`, { cwd: repoRoot });
                stashed = true;
            }

            const gitDir = this.getResolvedGitDir(repoRoot);
            tmpDir = fs.mkdtempSync(path.join(gitDir, 'tmp-patch-apply-'));
            const patchPath = path.join(tmpDir, 'commit.patch');
            fs.writeFileSync(patchPath, patchBody.endsWith('\n') ? patchBody : `${patchBody}\n`, 'utf-8');

            await this.execGit(`git am --3way ${this.quoteShellArg(patchPath)}`, {
                cwd: repoRoot,
                timeout: 600000,
                env: { GIT_EDITOR: 'true' },
            });
            const headHash = this.execGitSync('git rev-parse HEAD', { cwd: repoRoot }).trim();
            return {
                success: true,
                conflicts: false,
                message: 'Patch applied successfully',
                headHash,
                stashed,
            };
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';
            const gitState = this.getRepoState(repoRoot);
            const isConflict = gitState.gitOperation === 'am'
                || /CONFLICT|conflict|Patch failed|patch does not apply|git am --continue|Resolve all conflicts/i.test(errorMessage);
            if (isConflict) {
                return {
                    success: false,
                    conflicts: true,
                    message: errorMessage,
                    stashed,
                    gitState,
                };
            }
            getLogger().error('Git', 'Failed to apply patch', error instanceof Error ? error : undefined);
            return {
                success: false,
                conflicts: false,
                message: errorMessage,
                stashed,
                gitState,
            };
        } finally {
            if (tmpDir) {
                try { fs.rmSync(tmpDir, { recursive: true }); } catch { /* best effort */ }
            }
        }
    }

    /**
     * Pop the most recent stash.
     */
    async popStash(repoRoot: string): Promise<GitOperationResult> {
        try {
            await this.execGit('git stash pop', { cwd: repoRoot });
            return { success: true };
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';
            getLogger().error('Git', 'Failed to pop stash', error instanceof Error ? error : undefined);
            return { success: false, error: errorMessage };
        }
    }

    /**
     * Amend the HEAD commit message (title + optional body).
     * Runs `git commit --amend --no-edit` variant that only changes the message.
     * Returns the new HEAD hash on success.
     */
    async amendCommitMessage(repoRoot: string, title: string, body?: string): Promise<{ success: boolean; hash?: string; error?: string }> {
        if (!title || !title.trim()) {
            return { success: false, error: 'Commit title must not be empty' };
        }
        const message = body ? `${title}\n\n${body}` : title;
        const tmpDir = fs.mkdtempSync(path.join(repoRoot, '.git', 'tmp-amend-'));
        const msgPath = path.join(tmpDir, 'COMMIT_MSG');
        try {
            fs.writeFileSync(msgPath, message, 'utf-8');
            await this.execGitFileAsync(['commit', '--amend', '--only', '-F', msgPath], { cwd: repoRoot });
            const hash = this.execGitSync('git rev-parse HEAD', { cwd: repoRoot }).trim();
            return { success: true, hash };
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';
            getLogger().error('Git', 'Failed to amend commit message', error instanceof Error ? error : undefined);
            return { success: false, error: errorMessage };
        } finally {
            try { fs.rmSync(tmpDir, { recursive: true }); } catch { /* best effort */ }
        }
    }

    /**
     * Check if there are uncommitted changes (staged or unstaged).
     */
    async hasUncommittedChanges(repoRoot: string): Promise<boolean> {
        try {
            const output = await this.execGit('git status --porcelain', { cwd: repoRoot });
            return output.trim().length > 0;
        } catch {
            return false;
        }
    }

    /**
     * Detect the current repository state (merge/rebase/cherry-pick in progress).
     * Checks git sentinel files to determine the active operation.
     */
    getRepoState(repoRoot: string): RepoState {
        try {
            const resolvedGitDir = this.getResolvedGitDir(repoRoot);

            let operation: RepoState['operation'] = 'none';
            let gitOperation: RepoState['gitOperation'];
            const rebaseApplyDir = path.join(resolvedGitDir, 'rebase-apply');
            if (fs.existsSync(path.join(resolvedGitDir, 'rebase-merge'))) {
                operation = 'rebase';
            } else if (fs.existsSync(rebaseApplyDir)) {
                if (fs.existsSync(path.join(rebaseApplyDir, 'applying'))) {
                    operation = 'cherry-pick';
                    gitOperation = 'am';
                } else {
                    operation = 'rebase';
                }
            } else if (fs.existsSync(path.join(resolvedGitDir, 'MERGE_HEAD'))) {
                operation = 'merge';
            } else if (fs.existsSync(path.join(resolvedGitDir, 'CHERRY_PICK_HEAD'))) {
                operation = 'cherry-pick';
            }

            let conflictFiles: string[] = [];
            if (operation !== 'none') {
                try {
                    const output = this.execGitSync('git diff --name-only --diff-filter=U', { cwd: repoRoot });
                    conflictFiles = output.trim().split('\n').filter(Boolean);
                } catch {
                    // Ignore — no conflicts
                }
            }

            return gitOperation ? { operation, gitOperation, conflictFiles } : { operation, conflictFiles };
        } catch {
            return { operation: 'none', conflictFiles: [] };
        }
    }

    /**
     * Continue an in-progress rebase.
     */
    async rebaseContinue(repoRoot: string): Promise<GitOperationResult> {
        try {
            await this.execGit('git rebase --continue', {
                cwd: repoRoot,
                timeout: 600000,
                env: { GIT_EDITOR: 'true' },
            });
            return { success: true };
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';
            getLogger().error('Git', 'Failed to continue rebase', error instanceof Error ? error : undefined);
            return { success: false, error: errorMessage };
        }
    }

    /**
     * Abort an in-progress rebase.
     */
    async rebaseAbort(repoRoot: string): Promise<GitOperationResult> {
        try {
            await this.execGit('git rebase --abort', { cwd: repoRoot });
            return { success: true };
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';
            getLogger().error('Git', 'Failed to abort rebase', error instanceof Error ? error : undefined);
            return { success: false, error: errorMessage };
        }
    }

    /**
     * Continue an in-progress merge (commits the merge).
     */
    async mergeContinue(repoRoot: string): Promise<GitOperationResult> {
        try {
            await this.execGit('git merge --continue', {
                cwd: repoRoot,
                timeout: 600000,
                env: { GIT_EDITOR: 'true' },
            });
            return { success: true };
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';
            getLogger().error('Git', 'Failed to continue merge', error instanceof Error ? error : undefined);
            return { success: false, error: errorMessage };
        }
    }

    /**
     * Abort an in-progress merge.
     */
    async mergeAbort(repoRoot: string): Promise<GitOperationResult> {
        try {
            await this.execGit('git merge --abort', { cwd: repoRoot });
            return { success: true };
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';
            getLogger().error('Git', 'Failed to abort merge', error instanceof Error ? error : undefined);
            return { success: false, error: errorMessage };
        }
    }

    /**
     * Reword (rename) the title of a non-HEAD commit using interactive rebase.
     * Uses GIT_SEQUENCE_EDITOR to replace `pick <hash>` with `reword <hash>`
     * and GIT_EDITOR to inject the new title as the commit message.
     */
    async rewordCommit(repoRoot: string, hash: string, title: string): Promise<GitOperationResult> {
        if (!hash || !hash.trim()) {
            return { success: false, error: 'Commit hash must not be empty' };
        }
        if (!title || !title.trim()) {
            return { success: false, error: 'Commit title must not be empty' };
        }
        let tmpDir: string | undefined;
        try {
            const fullHash = this.execGitSync(`git rev-parse ${hash}`, { cwd: repoRoot }).trim();
            const parentHash = this.execGitSync(`git rev-parse ${fullHash}~1`, { cwd: repoRoot }).trim();

            tmpDir = fs.mkdtempSync(path.join(repoRoot, '.git', 'tmp-reword-'));
            const msgPath = path.join(tmpDir, 'message');
            fs.writeFileSync(msgPath, title.trim(), 'utf-8');

            // Sequence editor: replace `pick <hash>` with `reword <hash>` in the todo
            let seqEditor: string;
            let msgEditor: string;
            if (process.platform === 'win32') {
                const seqScriptPath = path.join(tmpDir, 'seq-editor.cmd');
                const shortHash = fullHash.slice(0, 7);
                fs.writeFileSync(seqScriptPath,
                    `@echo off\r\n` +
                    `powershell -NoProfile -Command "(Get-Content '%1') -replace '^pick ${shortHash}', 'reword ${shortHash}' | Set-Content '%1'"\r\n`,
                    'utf-8');
                seqEditor = seqScriptPath;

                const msgScriptPath = path.join(tmpDir, 'msg-editor.cmd');
                fs.writeFileSync(msgScriptPath,
                    `@copy /Y "${msgPath}" %1 >nul\r\n`,
                    'utf-8');
                msgEditor = msgScriptPath;
            } else {
                const seqScriptPath = path.join(tmpDir, 'seq-editor.sh');
                const shortHash = fullHash.slice(0, 7);
                fs.writeFileSync(seqScriptPath,
                    `#!/bin/sh\nsed -i "s/^pick ${shortHash}/reword ${shortHash}/" "$1"\n`,
                    { mode: 0o755 });
                seqEditor = seqScriptPath;

                const msgScriptPath = path.join(tmpDir, 'msg-editor.sh');
                fs.writeFileSync(msgScriptPath,
                    `#!/bin/sh\ncp "${msgPath}" "$1"\n`,
                    { mode: 0o755 });
                msgEditor = msgScriptPath;
            }

            await this.execGit(`git rebase -i ${parentHash}`, {
                cwd: repoRoot,
                timeout: 600000,
                env: { GIT_SEQUENCE_EDITOR: seqEditor, GIT_EDITOR: msgEditor },
            });

            return { success: true };
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';
            getLogger().error('Git', 'Failed to reword commit', error instanceof Error ? error : undefined);
            return { success: false, error: errorMessage };
        } finally {
            if (tmpDir) {
                try { fs.rmSync(tmpDir, { recursive: true }); } catch { /* best effort */ }
            }
        }
    }

    /**
     * Drop a single unpushed commit from history via interactive rebase.
     * Uses GIT_SEQUENCE_EDITOR to replace `pick <hash>` with `drop <hash>`.
     * On any error the rebase is automatically aborted to prevent leaving a
     * rebase-in-progress state.
     */
    async dropCommit(repoRoot: string, hash: string): Promise<GitOperationResult> {
        if (!hash || !hash.trim()) {
            return { success: false, error: 'Commit hash must not be empty' };
        }
        let tmpDir: string | undefined;
        try {
            const fullHash = this.execGitSync(`git rev-parse ${hash}`, { cwd: repoRoot }).trim();
            const parentHash = this.execGitSync(`git rev-parse ${fullHash}~1`, { cwd: repoRoot }).trim();

            tmpDir = fs.mkdtempSync(path.join(repoRoot, '.git', 'tmp-drop-'));

            let seqEditor: string;
            if (process.platform === 'win32') {
                const seqScriptPath = path.join(tmpDir, 'seq-editor.cmd');
                const shortHash = fullHash.slice(0, 7);
                fs.writeFileSync(seqScriptPath,
                    `@echo off\r\n` +
                    `powershell -NoProfile -Command "(Get-Content '%1') -replace '^pick ${shortHash}', 'drop ${shortHash}' | Set-Content '%1'"\r\n`,
                    'utf-8');
                seqEditor = seqScriptPath;
            } else {
                const seqScriptPath = path.join(tmpDir, 'seq-editor.sh');
                const shortHash = fullHash.slice(0, 7);
                fs.writeFileSync(seqScriptPath,
                    `#!/bin/sh\nsed -i "s/^pick ${shortHash}/drop ${shortHash}/" "$1"\n`,
                    { mode: 0o755 });
                seqEditor = seqScriptPath;
            }

            await this.execGit(`git rebase -i ${parentHash}`, {
                cwd: repoRoot,
                timeout: 600000,
                env: { GIT_SEQUENCE_EDITOR: seqEditor },
            });

            return { success: true };
        } catch (error) {
            try { this.execGitSync('git rebase --abort', { cwd: repoRoot }); } catch { /* best effort */ }
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';
            getLogger().error('Git', 'Failed to drop commit', error instanceof Error ? error : undefined);
            return { success: false, error: errorMessage };
        } finally {
            if (tmpDir) {
                try { fs.rmSync(tmpDir, { recursive: true }); } catch { /* best effort */ }
            }
        }
    }

    /**
     * Dispose of resources (no-op, provided for Disposable interface compatibility).
     */
    dispose(): void {
        // No resources to clean up
    }
}
