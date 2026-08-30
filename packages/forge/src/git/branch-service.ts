/**
 * BranchService: branch listing, switching, creating, deleting, merging,
 * push/pull/fetch, stash, and status queries.
 *
 * The read half runs in the native addon. Which branch is checked out, what it
 * tracks, how far it has drifted, and what the branch list holds are all `gix`
 * reads now — one opened repository in place of the four to six children the
 * Git tab used to spawn per render, and no `git branch | grep | tail | head`
 * shell pipeline that had to be spelled twice, once with `findstr`.
 *
 * The write half shells out, and always will: create, delete, merge, rebase,
 * push, pull and fetch go through the `git` CLI so credential helpers, SSH
 * agents and 2FA keep working. What changed is who spawns it — the addon does,
 * from Rust, on a worker thread, taking an argv array rather than a command
 * string assembled with hand-rolled shell quoting.
 *
 * Repositories inside a WSL distro never reach the addon. They keep the
 * `wsl.exe` path in TypeScript, and hand their output to Rust's parser rather
 * than to a second one.
 *
 * Extracted from `src/shortcuts/git/branch-service.ts`.
 */

import * as fs from 'fs';
import * as path from 'path';
import { loadNativeGit } from '@plusplusoneplusplus/coc-native';
import type {
    NativeGitAddon,
    NativeGitBranchEntry,
    NativeGitRepositoryStatus,
} from '@plusplusoneplusplus/coc-native';
import { execFileAsync } from '../utils/exec-utils';
import { getLogger } from '../logger';
import { createGitExecError, runGitViaWsl, translateWslArgs } from './exec';
import { ensureGitSafeDirectoryAsync } from './safe-directory';
import {
    buildWslCommandArgs,
    getWslExecutablePath,
    resolveWorkspaceExecutionContext,
} from '../utils/workspace-execution';
import type { WslExecutionContext } from '../utils/workspace-execution';
import {
    BranchStatus,
    GitRepositoryStatus,
    GitBranch,
    BranchListOptions,
    PaginatedBranchResult,
    GitOperationResult,
    GitCherryPickOptions,
    GitCherryPickResult,
    GitPatchApplyOptions,
    GitPatchApplyResult,
    GitPatchExportPayload,
    GitPatchExportResult,
    GitPatchMultiExportResult,
    RepoState,
} from './types';

/**
 * Clamp a caller's paging argument to what the native boundary accepts.
 *
 * "Everything" is spelled as a very large number by more than one caller, and
 * a `u32` that overflows rejects at the boundary rather than returning a page.
 */
function toUint32(value: number): number {
    if (!Number.isFinite(value) || value < 0) {
        return 0;
    }
    return Math.min(Math.floor(value), 0xffffffff);
}

/** Every branch, for the callers that do not paginate. */
const NO_LIMIT = 0xffffffff;

/** Timeout for one git command when the caller does not pick one. */
const DEFAULT_TIMEOUT_MS = 30_000;

/**
 * Timeout for the operations that can legitimately run for minutes: merge,
 * rebase, `am`, and everything that touches the network. Carried over from the
 * TypeScript implementation unchanged — a rebase of a long branch over a slow
 * link is a slow command, not a hung one.
 */
const LONG_OPERATION_TIMEOUT_MS = 600_000;

/**
 * Write a script for git to run as `GIT_EDITOR` or `GIT_SEQUENCE_EDITOR`, and
 * return the command line that reaches it on every platform.
 *
 * Git hands an editor to a shell — its own bundled `sh` on Windows — and that
 * is what rules out passing a bare path there: `C:\Users\...\seq-editor.cmd`
 * arrives with its separators read as escapes, as `C:UsersRUNNER~1...`, and
 * the rebase dies on `command not found`. Forward slashes survive the shell,
 * and naming the interpreter rather than relying on a shebang or on the file
 * being marked executable means one spelling works for all three platforms —
 * so the body below is plain POSIX, not a `.cmd` on Windows and a shell script
 * everywhere else.
 */
function writeGitEditorScript(dir: string, name: string, body: string): string {
    const scriptPath = path.join(dir, name);
    fs.writeFileSync(scriptPath, `#!/bin/sh\n${body}\n`, { mode: 0o755 });
    return `sh '${scriptPath.replace(/\\/g, '/')}'`;
}

/**
 * Rewrite one `pick <hash>` line in a rebase todo list.
 *
 * Not `sed -i`: GNU sed takes the backup suffix as an optional attached
 * argument and BSD sed takes it as the next word, so the one spelling that
 * edits in place on Linux eats the file name on macOS — `invalid command code`,
 * and the rebase never runs. Rewriting through a temp file is the same edit in
 * a spelling both accept.
 */
function todoRewriteScript(shortHash: string, verb: string): string {
    return (
        `sed "s/^pick ${shortHash}/${verb} ${shortHash}/" "$1" > "$1.todo.tmp" && ` +
        `mv "$1.todo.tmp" "$1"`
    );
}

/**
 * Rebuild the exported shape from what crossed the N-API boundary.
 *
 * napi omits an absent `Option<String>` inside an object rather than sending
 * `null`, so the guard here is about keeping `trackingBranch` absent rather
 * than present-and-undefined — which is what the TypeScript parser produced.
 */
function toGitRepositoryStatus(status: NativeGitRepositoryStatus): GitRepositoryStatus {
    return {
        branch: status.branch,
        isDetached: status.isDetached,
        dirty: status.dirty,
        ahead: status.ahead,
        behind: status.behind,
        ...(status.trackingBranch ? { trackingBranch: status.trackingBranch } : {}),
        unborn: status.unborn,
    };
}

/**
 * Parse `git status --porcelain=v2 --branch` output without inspecting file names.
 *
 * The parser itself is Rust's — this is the entry point for text that some
 * other process produced, which is what the WSL path hands it. Async because
 * native git is async-only; the parse runs on a worker thread, since a large
 * repository's status output runs to megabytes.
 */
export async function parsePorcelainV2BranchStatus(output: string): Promise<GitRepositoryStatus> {
    return toGitRepositoryStatus(await loadNativeGit().parseGitBranchStatus(output));
}

/**
 * Per-call overrides for one git command (internal).
 */
interface RunGitOptions {
    /** Milliseconds before the command is killed. Defaults to 30 000. */
    timeout?: number;
    /** Environment overrides layered on top of the inherited environment. */
    env?: Record<string, string>;
}

/**
 * Service for branch-related git operations.
 * Handles branch listing, switching, creating, and deleting.
 */
export class BranchService {

    /**
     * Run one git command against this repository.
     *
     * Native host → the addon's runner, which spawns git from Rust on a libuv
     * worker. WSL → `wsl.exe` from Node, the way it always has. Both paths take
     * an argv array rather than a command string, both layer the same
     * environment onto the one this process already has, and both reject with
     * `git <args> failed: <stderr>`, so a caller cannot tell which one served
     * it.
     *
     * `GIT_TERMINAL_PROMPT=0` is set for every command, exactly as the
     * TypeScript implementation set it: a push whose credentials are missing
     * has to fail rather than block a request thread on a prompt nobody can
     * answer. Everything else — `PATH`, `HOME`, `SSH_AUTH_SOCK`, the
     * credential helper's own configuration — is inherited, which is what
     * keeps push, pull and fetch working against a remote that asks for 2FA.
     */
    private async runGit(repoRoot: string, args: string[], options: RunGitOptions = {}): Promise<string> {
        // Deliberately outside every caller's try/catch, the way the read half
        // does it: a stale binary is a NativeAddonLoadError naming the rebuild,
        // and reporting it as a failed git operation would hide that.
        const { addon, wsl } = this.native(repoRoot);
        await ensureGitSafeDirectoryAsync(repoRoot);
        const timeout = options.timeout ?? DEFAULT_TIMEOUT_MS;
        const env = { GIT_TERMINAL_PROMPT: '0', ...options.env };
        if (wsl) {
            // The temporary patch and commit-message files this service writes
            // are created by Node at a Windows path that git inside the distro
            // cannot open, so path-shaped arguments are translated first.
            const executionContext = this.wslContext(repoRoot);
            return runGitViaWsl(
                executionContext,
                translateWslArgs(args, executionContext),
                { timeout, env, errorArgs: args },
            );
        }
        return addon.execGit(args, repoRoot, { timeout: toUint32(timeout), env });
    }

    /**
     * Run a shell pipeline inside the distro.
     *
     * The one command left that is not an argv array: the branch-listing
     * pipeline the WSL path still spells as `git branch | grep | tail | head`.
     * Native repositories answer that question in Rust and run no shell at all.
     */
    private async runShellViaWsl(repoRoot: string, command: string, timeout: number): Promise<string> {
        const executionContext = this.wslContext(repoRoot);
        try {
            const { stdout } = await execFileAsync(
                getWslExecutablePath(),
                buildWslCommandArgs(executionContext, ['sh', '-lc', command]),
                {
                    timeout,
                    windowsHide: true,
                    env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
                },
            );
            return stdout.replace(/\r?\n$/, '');
        } catch (error) {
            throw createGitExecError([command], error);
        }
    }

    /**
     * The native git capability, and whether this repository has to take the
     * WSL path to reach git.
     *
     * Called outside the try/catch of every method below, the way
     * `GitRangeService` does it: a stale binary is a `NativeAddonLoadError`
     * naming the rebuild, and catching it as "no branches" would hide it behind
     * an empty Git tab. The addon is loaded on the WSL path too — the commands
     * run through `wsl.exe`, but the parsers are still Rust's.
     */
    private native(repoRoot: string): { addon: NativeGitAddon; wsl: boolean } {
        return {
            addon: loadNativeGit(),
            wsl: resolveWorkspaceExecutionContext(repoRoot).kind === 'wsl',
        };
    }

    /**
     * Re-resolve a repository's execution context, narrowed to the WSL one.
     *
     * Only the two `*ViaWsl` runners call this, and only after {@link native}
     * has already reported `wsl: true`, so the throw is unreachable — it exists
     * to keep the narrowing honest rather than cast it away.
     */
    private wslContext(repoRoot: string): WslExecutionContext {
        const executionContext = resolveWorkspaceExecutionContext(repoRoot);
        if (executionContext.kind !== 'wsl') {
            throw new Error(`${repoRoot} is not a WSL repository`);
        }
        return executionContext;
    }

    private async getResolvedGitDir(repoRoot: string): Promise<string> {
        const gitDir = (await this.runGit(repoRoot, ['rev-parse', '--git-dir'])).trim();
        return path.isAbsolute(gitDir) ? gitDir : path.join(repoRoot, gitDir);
    }

    /**
     * Read branch, tracking, and working-tree metadata with one Git subprocess.
     * Returns null when the path is not a Git repository or Git cannot read it.
     */
    async getRepositoryStatus(repoRoot: string): Promise<GitRepositoryStatus | null> {
        const { addon, wsl } = this.native(repoRoot);
        try {
            await ensureGitSafeDirectoryAsync(repoRoot);
            if (!wsl) {
                return toGitRepositoryStatus(await addon.gitRepositoryStatus(repoRoot));
            }
            const output = await this.runGit(
                repoRoot,
                ['status', '--porcelain=v2', '--branch', '--untracked-files=all'],
                { timeout: 15_000 },
            );
            return toGitRepositoryStatus(await addon.parseGitBranchStatus(output));
        } catch {
            return null;
        }
    }

    /**
     * Get the current branch status.
     * @param repoRoot Repository root path
     * @param hasUncommittedChanges Whether there are uncommitted changes
     */
    async getBranchStatus(repoRoot: string, hasUncommittedChanges: boolean): Promise<BranchStatus | null> {
        const { addon, wsl } = this.native(repoRoot);
        if (wsl) {
            return this.branchStatusViaCli(repoRoot, hasUncommittedChanges);
        }

        try {
            await ensureGitSafeDirectoryAsync(repoRoot);
            const status = await addon.gitBranchStatus(repoRoot);
            if (!status) {
                return null;
            }
            return {
                name: status.name,
                isDetached: status.isDetached,
                ...(status.detachedHash ? { detachedHash: status.detachedHash } : {}),
                ahead: status.ahead,
                behind: status.behind,
                ...(status.trackingBranch ? { trackingBranch: status.trackingBranch } : {}),
                hasUncommittedChanges,
            };
        } catch (error) {
            getLogger().error('Git', 'Failed to get branch status', error instanceof Error ? error : undefined);
            return null;
        }
    }

    /**
     * Ask the four HEAD-and-upstream questions through `wsl.exe`.
     *
     * The WSL twin of the addon's `gitBranchStatus`, kept as the body it always
     * was — four child processes, in the same order, degrading to the same
     * values. Rust's tests pin the semantics both paths follow.
     */
    private async branchStatusViaCli(repoRoot: string, hasUncommittedChanges: boolean): Promise<BranchStatus | null> {
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
            const output = await this.runGit(repoRoot, ['symbolic-ref', '-q', 'HEAD']);
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
            return (await this.runGit(repoRoot, ['rev-parse', 'HEAD'])).trim();
        } catch {
            return '';
        }
    }

    /**
     * Get the current branch name.
     */
    private async getCurrentBranchName(repoRoot: string): Promise<string | null> {
        try {
            const output = await this.runGit(repoRoot, ['rev-parse', '--abbrev-ref', 'HEAD']);
            const name = output.trim();
            return name === 'HEAD' ? null : name;
        } catch {
            return null;
        }
    }

    /**
     * Resolve the checked-out branch's configured upstream without relying on
     * remote-name parsing. Local and upstream branch names may differ.
     */
    private async getCurrentBranchUpstream(repoRoot: string): Promise<{
        remote: string;
        remoteRef: string;
    }> {
        let branchName = '';
        try {
            branchName = (await this.runGit(
                repoRoot,
                ['symbolic-ref', '--quiet', '--short', 'HEAD'],
            )).trim();
        } catch {
            throw new Error('Cannot fetch or pull while HEAD is detached');
        }

        if (!branchName) {
            throw new Error('Cannot fetch or pull while HEAD is detached');
        }

        const configValues = async (key: string): Promise<string[]> => {
            try {
                const output = await this.runGit(repoRoot, ['config', '--get-all', key]);
                return output.split(/\r?\n/).map(value => value.trim()).filter(Boolean);
            } catch {
                return [];
            }
        };
        const remotes = await configValues(`branch.${branchName}.remote`);
        const remoteRefs = await configValues(`branch.${branchName}.merge`);
        if (remotes.length === 0 || remoteRefs.length === 0) {
            throw new Error(`Current branch "${branchName}" has no upstream configured`);
        }
        if (remotes.length !== 1 || remoteRefs.length !== 1) {
            throw new Error(`Current branch "${branchName}" has multiple upstream branches; fetch and pull require exactly one`);
        }

        const remoteRef = remoteRefs[0];
        if (!remoteRef.startsWith('refs/heads/')) {
            throw new Error(`Current branch "${branchName}" upstream must be one exact branch ref`);
        }
        try {
            await this.runGit(repoRoot, ['check-ref-format', remoteRef]);
        } catch {
            throw new Error(`Current branch "${branchName}" upstream must be one exact branch ref`);
        }

        return { remote: remotes[0], remoteRef };
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
            let trackingBranch: string | undefined;

            try {
                trackingBranch = (await this.runGit(
                    repoRoot,
                    ['rev-parse', '--abbrev-ref', `${branchName}@{upstream}`],
                )).trim();
            } catch {
                return { ahead: 0, behind: 0 };
            }

            // A single symmetric-difference rev-list yields both counts in one process.
            // `--left-right --count "<upstream>...<branch>"` prints "<behind>\t<ahead>":
            // the left side counts commits the upstream has that we lack (behind), the
            // right side counts commits we have that the upstream lacks (ahead).
            const output = (await this.runGit(
                repoRoot,
                ['rev-list', '--left-right', '--count', `${trackingBranch}...${branchName}`],
            )).trim();
            const [behindStr = '', aheadStr = ''] = output.split(/\s+/);

            const ahead = parseInt(aheadStr, 10) || 0;
            const behind = parseInt(behindStr, 10) || 0;

            return { trackingBranch, ahead, behind };
        } catch (error) {
            getLogger().error('Git', 'Failed to get tracking info', error instanceof Error ? error : undefined);
            return { ahead: 0, behind: 0 };
        }
    }

    /**
     * Rebuild the exported shape from what crossed the N-API boundary.
     *
     * `remoteName` is guarded rather than assigned for the same reason
     * `trackingBranch` is: napi omits an absent `Option<String>` inside an
     * object, and a local branch has never carried the property at all.
     */
    private toGitBranch(branch: NativeGitBranchEntry): GitBranch {
        return {
            name: branch.name,
            isCurrent: branch.isCurrent,
            isRemote: branch.isRemote,
            ...(branch.remoteName ? { remoteName: branch.remoteName } : {}),
            lastCommitSubject: branch.lastCommitSubject,
            lastCommitDate: branch.lastCommitDate,
        };
    }

    /**
     * Read a page of one branch namespace.
     *
     * The single entry point every public listing method goes through, native
     * or WSL. A `limit` of zero answers a count-only question: the total comes
     * back with no rows, which is how {@link getLocalBranchCount} and its
     * remote twin ask theirs without also paying to describe every branch.
     */
    private async listBranches(
        repoRoot: string,
        remote: boolean,
        options: BranchListOptions,
    ): Promise<PaginatedBranchResult> {
        const limit = toUint32(options.limit ?? 100);
        const offset = toUint32(options.offset ?? 0);
        const searchPattern = options.searchPattern || undefined;
        const { addon, wsl } = this.native(repoRoot);

        try {
            await ensureGitSafeDirectoryAsync(repoRoot);
            if (wsl) {
                return await this.listBranchesViaCli(repoRoot, remote, limit, offset, searchPattern);
            }
            const page = await addon.gitListBranches(repoRoot, {
                remote,
                limit,
                offset,
                search: searchPattern,
            });
            return {
                branches: page.branches.map(branch => this.toGitBranch(branch)),
                totalCount: page.totalCount,
                hasMore: page.hasMore,
            };
        } catch (error) {
            getLogger().error('Git', 'Failed to list branches', error instanceof Error ? error : undefined);
            return { branches: [], totalCount: 0, hasMore: false };
        }
    }

    /**
     * Read a page of one branch namespace through `wsl.exe`.
     *
     * The WSL twin of the addon's `gitListBranches`, and the `git branch |
     * grep | tail | head` pipeline this service always ran on a POSIX shell.
     * The `findstr` half of that pipeline is gone with the native path: a
     * Windows repository that is not in a distro no longer runs a shell at all.
     */
    private async listBranchesViaCli(
        repoRoot: string,
        remote: boolean,
        limit: number,
        offset: number,
        searchPattern?: string,
    ): Promise<PaginatedBranchResult> {
        const escapedPattern = searchPattern?.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const nameFilter = escapedPattern ? ` | grep -i "${escapedPattern}"` : '';

        const countArgs = remote ? ['branch', '-r', '--list'] : ['branch', '--list'];
        const countOutput = await this.runGit(repoRoot, countArgs);
        const totalCount = countOutput
            .trim()
            .split('\n')
            .filter(line => line.trim() && !(remote && line.includes('HEAD')))
            .filter(line => {
                if (!searchPattern) return true;
                const name = remote ? line.trim() : line.substring(2).trim();
                return name.toLowerCase().includes(searchPattern.toLowerCase());
            }).length;

        if (totalCount === 0) {
            return { branches: [], totalCount: 0, hasMore: false };
        }

        const format = remote
            ? '%(refname:short)|%(subject)|%(committerdate:relative)'
            : '%(if)%(HEAD)%(then)*%(else) %(end)|%(refname:short)|%(subject)|%(committerdate:relative)';
        let command = `git branch ${remote ? '-r ' : ''}--format="${format}"`;
        if (remote) {
            command += ' | grep -v "HEAD"';
        }
        command += nameFilter;
        if (offset > 0) {
            command += ` | tail -n +${offset + 1}`;
        }
        command += ` | head -n ${limit}`;

        const output = await this.runShellViaWsl(repoRoot, command, DEFAULT_TIMEOUT_MS);
        if (!output.trim()) {
            return { branches: [], totalCount, hasMore: offset + limit < totalCount };
        }

        const branches = output.trim().split('\n').map(line => {
            const parts = line.split('|');
            const name = (remote ? parts[0] : parts[1]) || '';
            const slashIndex = name.indexOf('/');
            return {
                name,
                isCurrent: remote ? false : parts[0] === '*',
                isRemote: remote,
                ...(remote && slashIndex > 0 ? { remoteName: name.substring(0, slashIndex) } : {}),
                lastCommitSubject: (remote ? parts[1] : parts[2]) || '',
                lastCommitDate: (remote ? parts[2] : parts[3]) || '',
            };
        }).filter(branch => branch.name);

        return { branches, totalCount, hasMore: offset + branches.length < totalCount };
    }

    /**
     * Get all local branches.
     */
    async getLocalBranches(repoRoot: string): Promise<GitBranch[]> {
        return (await this.listBranches(repoRoot, false, { limit: NO_LIMIT })).branches;
    }

    /**
     * Get remote branches.
     */
    async getRemoteBranches(repoRoot: string): Promise<GitBranch[]> {
        return (await this.listBranches(repoRoot, true, { limit: NO_LIMIT })).branches;
    }

    /**
     * Get all branches (local and remote).
     */
    async getAllBranches(repoRoot: string): Promise<{ local: GitBranch[]; remote: GitBranch[] }> {
        const [local, remote] = await Promise.all([
            this.getLocalBranches(repoRoot),
            this.getRemoteBranches(repoRoot),
        ]);
        return { local, remote };
    }

    /**
     * Get local branch count (fast operation).
     */
    async getLocalBranchCount(repoRoot: string, searchPattern?: string): Promise<number> {
        return (await this.listBranches(repoRoot, false, { limit: 0, searchPattern })).totalCount;
    }

    /**
     * Get remote branch count (fast operation).
     */
    async getRemoteBranchCount(repoRoot: string, searchPattern?: string): Promise<number> {
        return (await this.listBranches(repoRoot, true, { limit: 0, searchPattern })).totalCount;
    }

    /**
     * Get local branches with pagination and search support.
     */
    async getLocalBranchesPaginated(repoRoot: string, options: BranchListOptions = {}): Promise<PaginatedBranchResult> {
        return this.listBranches(repoRoot, false, options);
    }

    /**
     * Get remote branches with pagination and search support.
     */
    async getRemoteBranchesPaginated(repoRoot: string, options: BranchListOptions = {}): Promise<PaginatedBranchResult> {
        return this.listBranches(repoRoot, true, options);
    }

    /**
     * Search branches by name (combines local and remote).
     */
    async searchBranches(repoRoot: string, searchPattern: string, limit: number = 50): Promise<{ local: GitBranch[]; remote: GitBranch[] }> {
        const [local, remote] = await Promise.all([
            this.getLocalBranchesPaginated(repoRoot, { searchPattern, limit }),
            this.getRemoteBranchesPaginated(repoRoot, { searchPattern, limit }),
        ]);
        return { local: local.branches, remote: remote.branches };
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
            const args = ['checkout'];
            if (options?.create) {
                args.push('-b');
            }
            if (options?.force) {
                args.push('-f');
            }
            args.push(branchName);

            await this.runGit(repoRoot, args);
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
                await this.runGit(repoRoot, ['checkout', '-b', branchName]);
            } else {
                await this.runGit(repoRoot, ['branch', branchName]);
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
            await this.runGit(repoRoot, ['branch', flag, branchName]);
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
            await this.runGit(repoRoot, ['branch', '-m', oldName, newName]);
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
            await this.runGit(repoRoot, ['merge', branchName], { timeout: LONG_OPERATION_TIMEOUT_MS });
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
            let args = ['push'];
            if (setUpstream) {
                const branchName = await this.getCurrentBranchName(repoRoot);
                if (branchName) {
                    args = ['push', '-u', 'origin', branchName];
                }
            }
            await this.runGit(repoRoot, args, { timeout: LONG_OPERATION_TIMEOUT_MS });
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
            const refspec = `${commitHash}:refs/heads/${branchName}`;
            await this.runGit(repoRoot, ['push', 'origin', refspec], { timeout: LONG_OPERATION_TIMEOUT_MS });
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
            const args = rebase ? ['pull', '--rebase'] : ['pull'];
            await this.runGit(repoRoot, args, { timeout: LONG_OPERATION_TIMEOUT_MS });
            return { success: true };
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';
            getLogger().error('Git', 'Failed to pull', error instanceof Error ? error : undefined);
            return { success: false, error: errorMessage };
        }
    }

    /**
     * Pull only the checked-out branch's configured upstream.
     */
    async pullCurrentBranch(repoRoot: string, rebase: boolean = false): Promise<GitOperationResult> {
        try {
            const { remote, remoteRef } = await this.getCurrentBranchUpstream(repoRoot);
            const args = ['pull'];
            if (rebase) {
                args.push('--rebase');
            }
            args.push('--no-tags', '--', remote, remoteRef);
            await this.runGit(repoRoot, args, { timeout: LONG_OPERATION_TIMEOUT_MS });
            return { success: true };
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';
            getLogger().error('Git', 'Failed to pull current branch', error instanceof Error ? error : undefined);
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
            await this.runGit(repoRoot, ['rebase', '-i', '--autosquash', '@{upstream}'], {
                timeout: LONG_OPERATION_TIMEOUT_MS,
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
            const args = remote ? ['fetch', remote] : ['fetch', '--all'];
            await this.runGit(repoRoot, args, { timeout: LONG_OPERATION_TIMEOUT_MS });
            return { success: true };
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';
            getLogger().error('Git', 'Failed to fetch', error instanceof Error ? error : undefined);
            return { success: false, error: errorMessage };
        }
    }

    /**
     * Fetch only the checked-out branch's configured upstream.
     */
    async fetchCurrentBranch(repoRoot: string): Promise<GitOperationResult> {
        try {
            const { remote, remoteRef } = await this.getCurrentBranchUpstream(repoRoot);
            await this.runGit(
                repoRoot,
                ['fetch', '--no-tags', '--', remote, remoteRef],
                { timeout: LONG_OPERATION_TIMEOUT_MS },
            );
            return { success: true };
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';
            getLogger().error('Git', 'Failed to fetch current branch', error instanceof Error ? error : undefined);
            return { success: false, error: errorMessage };
        }
    }

    /**
     * Stash changes.
     */
    async stashChanges(repoRoot: string, message?: string): Promise<GitOperationResult> {
        try {
            const args = message ? ['stash', 'push', '-m', message] : ['stash', 'push'];
            await this.runGit(repoRoot, args);
            return { success: true };
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';
            getLogger().error('Git', 'Failed to stash changes', error instanceof Error ? error : undefined);
            return { success: false, error: errorMessage };
        }
    }

    /**
     * Cherry-pick commit(s). Existing callers that omit options keep the plain
     * "onto current HEAD" behavior, while branch-targeted calls are atomic.
     */
    async cherryPick(repoRoot: string, hash: string, options?: GitCherryPickOptions): Promise<GitCherryPickResult> {
        const hashes = options?.hashes?.length ? options.hashes : [hash];
        const targetBranch = options?.targetBranch?.trim();
        if (!options || (!targetBranch && hashes.length === 1)) {
            return this.cherryPickOntoCurrentHead(repoRoot, hash);
        }

        const originalBranch = await this.getCurrentBranchName(repoRoot);
        if (targetBranch && !originalBranch) {
            return {
                success: false,
                conflicts: false,
                message: 'Cannot determine current branch (detached HEAD?)',
                targetBranch,
                originalBranch,
            };
        }
        const shouldSwitch = Boolean(targetBranch && originalBranch && targetBranch !== originalBranch);
        const shouldRollbackToStartingHead = shouldSwitch || hashes.length > 1;
        const appliedHashes: string[] = [];
        let targetStartingHead: string | null = null;

        if (shouldRollbackToStartingHead && await this.hasUncommittedChanges(repoRoot)) {
            return {
                success: false,
                conflicts: false,
                dirty: true,
                message: 'Working tree must be clean before atomic cherry-picking. Please commit or stash your changes.',
                targetBranch,
                originalBranch,
            };
        }

        try {
            if (shouldSwitch) {
                await this.runGit(repoRoot, ['checkout', targetBranch!]);
            }
            if (shouldRollbackToStartingHead) {
                targetStartingHead = (await this.runGit(repoRoot, ['rev-parse', 'HEAD'])).trim();
            }

            for (const commitHash of hashes) {
                await this.runGit(repoRoot, ['cherry-pick', commitHash]);
                appliedHashes.push(commitHash);
            }

            return {
                success: true,
                conflicts: false,
                message: hashes.length === 1 ? 'Cherry-pick applied successfully' : 'Cherry-picks applied successfully',
                targetBranch: targetBranch || originalBranch || undefined,
                originalBranch,
                appliedHashes,
            };
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';
            const isConflict = this.isCherryPickConflict(errorMessage);

            await this.abortCherryPickAndRestoreBranch(repoRoot);
            if (targetStartingHead) {
                try {
                    await this.runGit(repoRoot, ['reset', '--hard', targetStartingHead]);
                } catch (resetError) {
                    getLogger().error('Git', `Failed to reset cherry-pick target branch to ${targetStartingHead}`, resetError instanceof Error ? resetError : undefined);
                }
            }
            await this.switchBackToOriginalBranch(repoRoot, originalBranch);

            if (isConflict) {
                return {
                    success: false,
                    conflicts: true,
                    message: errorMessage,
                    targetBranch,
                    originalBranch,
                    appliedHashes,
                };
            }
            getLogger().error('Git', `Failed to cherry-pick ${hashes.join(', ')}`, error instanceof Error ? error : undefined);
            return {
                success: false,
                conflicts: false,
                message: errorMessage,
                targetBranch,
                originalBranch,
                appliedHashes,
            };
        } finally {
            if (shouldSwitch) {
                await this.switchBackToOriginalBranch(repoRoot, originalBranch);
            }
        }
    }

    private async cherryPickOntoCurrentHead(repoRoot: string, hash: string): Promise<GitCherryPickResult> {
        try {
            await this.runGit(repoRoot, ['cherry-pick', hash]);
            return { success: true, conflicts: false, message: 'Cherry-pick applied successfully' };
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';
            if (this.isCherryPickConflict(errorMessage)) {
                return { success: false, conflicts: true, message: errorMessage };
            }
            getLogger().error('Git', `Failed to cherry-pick ${hash}`, error instanceof Error ? error : undefined);
            return { success: false, conflicts: false, message: errorMessage };
        }
    }

    private isCherryPickConflict(errorMessage: string): boolean {
        return /CONFLICT|conflict/i.test(errorMessage) || /cherry-pick.*conflict/i.test(errorMessage) || /Merge conflict/i.test(errorMessage);
    }

    private async abortCherryPickAndRestoreBranch(repoRoot: string): Promise<void> {
        try {
            await this.runGit(repoRoot, ['cherry-pick', '--abort']);
        } catch {
            // No cherry-pick may be in progress for non-conflict failures.
        }
    }

    private async switchBackToOriginalBranch(repoRoot: string, originalBranch: string | null): Promise<void> {
        if (!originalBranch) return;
        const currentBranch = await this.getCurrentBranchName(repoRoot);
        if (currentBranch === originalBranch) return;
        try {
            await this.runGit(repoRoot, ['checkout', originalBranch]);
        } catch (error) {
            getLogger().error('Git', `Failed to switch back to branch ${originalBranch}`, error instanceof Error ? error : undefined);
        }
    }

    /**
     * Resolve one commit and build its format-patch payload (metadata + patch).
     * Throws on an invalid hash, an unresolvable commit, or unreadable metadata.
     */
    private async exportPatchPayload(repoRoot: string, hash: string): Promise<GitPatchExportPayload> {
        const trimmedHash = hash.trim();
        if (!/^[a-fA-F0-9]{4,40}$/.test(trimmedHash)) {
            throw new Error('Invalid commit hash');
        }
        const commitHash = (await this.runGit(
            repoRoot,
            ['rev-parse', '--verify', `${trimmedHash}^{commit}`],
        )).trim();
        const metadata = await this.runGit(
            repoRoot,
            ['show', '-s', '--format=%H%x00%s%x00%an%x00%ae%x00%aI', commitHash],
        );
        const [fullHash, subject, authorName, authorEmail, authorDate] = metadata.replace(/\n$/, '').split('\0');
        if (!fullHash || !subject || !authorName || !authorEmail || !authorDate) {
            throw new Error('Failed to read commit metadata');
        }
        // One trailing newline, always: the runner strips the blank line
        // `format-patch` ends with, and `git am` wants each mailbox entry to end
        // in exactly one. {@link exportCommitPatches} then separates entries
        // with the blank line that produces.
        const patch = await this.runGit(
            repoRoot,
            ['format-patch', '-1', '--stdout', '--no-stat', commitHash],
            { timeout: LONG_OPERATION_TIMEOUT_MS },
        );
        return {
            commitHash: fullHash,
            subject,
            authorName,
            authorEmail,
            authorDate,
            patch: patch.endsWith('\n') ? patch : `${patch}\n`,
        };
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
            const payload = await this.exportPatchPayload(repoRoot, trimmedHash);
            return { success: true, ...payload };
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';
            getLogger().error('Git', `Failed to export commit patch ${trimmedHash}`, error instanceof Error ? error : undefined);
            return { success: false, error: errorMessage };
        }
    }

    /**
     * Export several commits (given oldest-first) as a single concatenated
     * format-patch mailbox that `git am` applies in order. Two round-trips
     * (export + apply) regardless of range size.
     */
    async exportCommitPatches(repoRoot: string, hashes: string[]): Promise<GitPatchMultiExportResult> {
        const list = Array.isArray(hashes)
            ? hashes.map(value => (typeof value === 'string' ? value.trim() : '')).filter(value => value.length > 0)
            : [];
        if (list.length === 0) {
            return { success: false, error: 'No commits to export' };
        }

        try {
            const commits: GitPatchExportPayload[] = [];
            const bodies: string[] = [];
            for (const hash of list) {
                const payload = await this.exportPatchPayload(repoRoot, hash);
                commits.push(payload);
                bodies.push(payload.patch.endsWith('\n') ? payload.patch : `${payload.patch}\n`);
            }
            // Blank-line separation between mailbox entries keeps `git am` happy.
            return { success: true, patch: bodies.join('\n'), commits };
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';
            getLogger().error('Git', `Failed to export commit patches ${list.join(', ')}`, error instanceof Error ? error : undefined);
            return { success: false, error: errorMessage };
        }
    }

    /** Best-effort `git rev-parse HEAD`, undefined on an unborn/unreadable HEAD. */
    private async revParseHeadSafe(repoRoot: string): Promise<string | undefined> {
        try {
            return (await this.runGit(repoRoot, ['rev-parse', 'HEAD'])).trim();
        } catch {
            return undefined;
        }
    }

    /**
     * Count commits applied since `baseHead`. With no base (unborn branch) the
     * whole HEAD history is the applied set. Best-effort — undefined on failure.
     */
    private async countAppliedCommits(repoRoot: string, baseHead: string | undefined): Promise<number | undefined> {
        try {
            const range = baseHead ? `${baseHead}..HEAD` : 'HEAD';
            const output = (await this.runGit(repoRoot, ['rev-list', '--count', range])).trim();
            const parsed = Number.parseInt(output, 10);
            return Number.isFinite(parsed) ? parsed : undefined;
        } catch {
            return undefined;
        }
    }

    /**
     * Apply a format-patch payload with git am --3way. The mailbox may contain
     * several patches; they are applied in order within a single `am` session.
     */
    async applyCommitPatch(repoRoot: string, patchBody: string, options: GitPatchApplyOptions = {}): Promise<GitPatchApplyResult> {
        if (!patchBody || !patchBody.trim()) {
            return { success: false, conflicts: false, message: 'Patch body must not be empty' };
        }

        const repoState = await this.getRepoState(repoRoot);
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
        let preApplyHead: string | undefined;
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
                await this.runGit(repoRoot, ['stash', 'push', '-u', '-m', stashMessage]);
                stashed = true;
            }

            const gitDir = await this.getResolvedGitDir(repoRoot);
            tmpDir = fs.mkdtempSync(path.join(gitDir, 'tmp-patch-apply-'));
            const patchPath = path.join(tmpDir, 'commit.patch');
            fs.writeFileSync(patchPath, patchBody.endsWith('\n') ? patchBody : `${patchBody}\n`, 'utf-8');

            preApplyHead = await this.revParseHeadSafe(repoRoot);
            await this.runGit(repoRoot, ['am', '--3way', patchPath], {
                timeout: LONG_OPERATION_TIMEOUT_MS,
                env: { GIT_EDITOR: 'true' },
            });
            const headHash = (await this.runGit(repoRoot, ['rev-parse', 'HEAD'])).trim();
            const appliedCount = await this.countAppliedCommits(repoRoot, preApplyHead);
            return {
                success: true,
                conflicts: false,
                message: 'Patch applied successfully',
                headHash,
                stashed,
                ...(appliedCount !== undefined ? { appliedCount } : {}),
            };
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';
            const gitState = await this.getRepoState(repoRoot);
            const isConflict = gitState.gitOperation === 'am'
                || /CONFLICT|conflict|Patch failed|patch does not apply|git am --continue|Resolve all conflicts/i.test(errorMessage);
            if (isConflict) {
                // HEAD has advanced by however many patches landed before the failing one.
                const appliedCount = await this.countAppliedCommits(repoRoot, preApplyHead);
                return {
                    success: false,
                    conflicts: true,
                    message: errorMessage,
                    stashed,
                    gitState,
                    ...(appliedCount !== undefined ? { appliedCount } : {}),
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
            await this.runGit(repoRoot, ['stash', 'pop']);
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
            await this.runGit(repoRoot, ['commit', '--amend', '--only', '-F', msgPath]);
            const hash = (await this.runGit(repoRoot, ['rev-parse', 'HEAD'])).trim();
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
        // Outside the try, like the read half: this method answers any failure
        // with `false`, and "nothing to commit" is a plausible enough answer
        // that a stale binary would disappear behind it.
        this.native(repoRoot);
        try {
            const output = await this.runGit(repoRoot, ['status', '--porcelain']);
            return output.trim().length > 0;
        } catch {
            return false;
        }
    }

    /**
     * Detect the current repository state (merge/rebase/cherry-pick in progress).
     * Checks git sentinel files to determine the active operation.
     */
    async getRepoState(repoRoot: string): Promise<RepoState> {
        // Outside the try for the same reason: "no operation in progress" is
        // what this returns for a directory that is not a repository, and a
        // stale binary must not arrive looking like a clean repository.
        this.native(repoRoot);
        try {
            const resolvedGitDir = await this.getResolvedGitDir(repoRoot);

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
                    const output = await this.runGit(repoRoot, ['diff', '--name-only', '--diff-filter=U']);
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
            await this.runGit(repoRoot, ['rebase', '--continue'], {
                timeout: LONG_OPERATION_TIMEOUT_MS,
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
            await this.runGit(repoRoot, ['rebase', '--abort']);
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
            await this.runGit(repoRoot, ['merge', '--continue'], {
                timeout: LONG_OPERATION_TIMEOUT_MS,
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
            await this.runGit(repoRoot, ['merge', '--abort']);
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
            const fullHash = (await this.runGit(repoRoot, ['rev-parse', hash])).trim();
            const parentHash = (await this.runGit(repoRoot, ['rev-parse', `${fullHash}~1`])).trim();

            tmpDir = fs.mkdtempSync(path.join(repoRoot, '.git', 'tmp-reword-'));
            const msgPath = path.join(tmpDir, 'message');
            fs.writeFileSync(msgPath, title.trim(), 'utf-8');

            // Sequence editor: replace `pick <hash>` with `reword <hash>` in the todo
            const shortHash = fullHash.slice(0, 7);
            const seqEditor = writeGitEditorScript(
                tmpDir,
                'seq-editor.sh',
                todoRewriteScript(shortHash, 'reword'),
            );
            const msgEditor = writeGitEditorScript(
                tmpDir,
                'msg-editor.sh',
                `cp "${msgPath.replace(/\\/g, '/')}" "$1"`,
            );

            await this.runGit(repoRoot, ['rebase', '-i', parentHash], {
                timeout: LONG_OPERATION_TIMEOUT_MS,
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
            const fullHash = (await this.runGit(repoRoot, ['rev-parse', hash])).trim();
            const parentHash = (await this.runGit(repoRoot, ['rev-parse', `${fullHash}~1`])).trim();

            tmpDir = fs.mkdtempSync(path.join(repoRoot, '.git', 'tmp-drop-'));

            const shortHash = fullHash.slice(0, 7);
            const seqEditor = writeGitEditorScript(
                tmpDir,
                'seq-editor.sh',
                todoRewriteScript(shortHash, 'drop'),
            );

            await this.runGit(repoRoot, ['rebase', '-i', parentHash], {
                timeout: LONG_OPERATION_TIMEOUT_MS,
                env: { GIT_SEQUENCE_EDITOR: seqEditor },
            });

            return { success: true };
        } catch (error) {
            try { await this.runGit(repoRoot, ['rebase', '--abort']); } catch { /* best effort */ }
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
