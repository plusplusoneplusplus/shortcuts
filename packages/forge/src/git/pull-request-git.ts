import { execGitAsync, type ExecGitOptions } from './exec';
import { resolveWorkspaceExecutionContext, translatePathForExecution, translatePathForHostFilesystem } from '../utils/workspace-execution';

const LOCAL_TIMEOUT = 30_000;
const LONG_RUNNING_TIMEOUT = 600_000;
const PROBE_TIMEOUT = 15_000;
const NO_PROMPT = { GIT_TERMINAL_PROMPT: '0' };

/** Runs `git <args>` for `repoRoot` and resolves with trimmed stdout. */
export type PullRequestGitRunner = (repoRoot: string, args: string[], options?: ExecGitOptions) => Promise<string>;

/** All operations retain an explicit repository root, including linked worktrees. */
async function runNative(repoRoot: string, args: string[], options?: ExecGitOptions): Promise<string> {
    return (await execGitAsync(args, repoRoot, {
        maxBuffer: 10 * 1024 * 1024,
        timeout: LOCAL_TIMEOUT,
        ...options,
    })).trim();
}

function worktreePath(repoRoot: string, filePath: string): string {
    const context = resolveWorkspaceExecutionContext(repoRoot);
    return context.kind === 'wsl' ? translatePathForExecution(filePath, context) : filePath;
}

/**
 * Typed Git operations for PR submission. Host execution uses Rust's execGit;
 * WSL routing and path translation stay in Forge. CLI authentication stays with
 * the caller. Range-service default-branch heuristics deliberately differ.
 * Callers that inject their own git runner keep these exact commands.
 */
export function createPullRequestGit(run: PullRequestGitRunner = runNative) {
    return {
        remoteUrl: (repoRoot: string): Promise<string> => run(repoRoot, ['config', '--get', 'remote.origin.url']),
        async defaultBranch(repoRoot: string): Promise<string> {
            try {
                const head = await run(repoRoot, ['symbolic-ref', '--quiet', '--short', 'refs/remotes/origin/HEAD']);
                if (head.startsWith('origin/')) return head.slice('origin/'.length);
            } catch { /* Ask the remote when the local symbolic ref is absent. */ }
            try {
                const output = await run(repoRoot, ['ls-remote', '--symref', 'origin', 'HEAD'], {
                    timeout: PROBE_TIMEOUT, env: NO_PROMPT,
                });
                const match = output.match(/^ref:\s+refs\/heads\/(\S+)\s+HEAD/m);
                if (match) return match[1];
            } catch { /* An offline or inaccessible remote uses the common default. */ }
            return 'main';
        },
        async commitsInRange(repoRoot: string, range: string): Promise<string[]> {
            return (await run(repoRoot, ['rev-list', '--reverse', range])).split(/\s+/).filter(Boolean);
        },
        resolveCommit: (repoRoot: string, ref: string): Promise<string> => run(repoRoot, ['rev-parse', '--verify', `${ref}^{commit}`]),
        async orderCommits(repoRoot: string, shas: string[]): Promise<string[]> {
            const wanted = new Set(shas);
            return (await run(repoRoot, ['rev-list', '--reverse', '--topo-order', ...shas]))
                .split(/\s+/).filter(sha => wanted.has(sha));
        },
        async refExists(repoRoot: string, ref: string): Promise<boolean> {
            try {
                await run(repoRoot, ['rev-parse', '--verify', '--quiet', ref]);
                return true;
            } catch { return false; }
        },
        fetchBranch: (repoRoot: string, base: string): Promise<string> => run(repoRoot, ['fetch', 'origin', base], {
            timeout: LONG_RUNNING_TIMEOUT, env: NO_PROMPT,
        }),
        shortSha: (repoRoot: string, sha: string): Promise<string> => run(repoRoot, ['rev-parse', '--short', sha]),
        commitSubject: (repoRoot: string, sha: string): Promise<string> => run(repoRoot, ['log', '-1', '--pretty=%s', sha]),
        async addWorktree(repoRoot: string, branch: string, filePath: string, base: string): Promise<string> {
            const executionPath = worktreePath(repoRoot, filePath);
            const hostPath = translatePathForHostFilesystem(executionPath, resolveWorkspaceExecutionContext(repoRoot));
            await run(repoRoot, ['worktree', 'add', '-b', branch, executionPath, `origin/${base}`], { timeout: LONG_RUNNING_TIMEOUT });
            // A Windows temp directory still belongs to this distro's Git worktree.
            // Its UNC alias keeps all subsequent operations on the WSL path.
            return hostPath;
        },
        removeWorktree: (repoRoot: string, filePath: string): Promise<string> =>
            run(repoRoot, ['worktree', 'remove', '--force', worktreePath(repoRoot, filePath)]),
        deleteBranch: (repoRoot: string, branch: string): Promise<string> => run(repoRoot, ['branch', '-D', branch]),
        cherryPick: (repoRoot: string, sha: string): Promise<string> => run(repoRoot, ['cherry-pick', sha], { timeout: LONG_RUNNING_TIMEOUT }),
        skipCherryPick: (repoRoot: string): Promise<string> => run(repoRoot, ['cherry-pick', '--skip'], { timeout: LONG_RUNNING_TIMEOUT }),
        abortCherryPick: (repoRoot: string): Promise<string> => run(repoRoot, ['cherry-pick', '--abort']),
        status: (repoRoot: string): Promise<string> => run(repoRoot, ['status', '--porcelain']),
        rebase: (repoRoot: string, base: string): Promise<string> => run(repoRoot, ['rebase', `origin/${base}`], { timeout: LONG_RUNNING_TIMEOUT }),
        abortRebase: (repoRoot: string): Promise<string> => run(repoRoot, ['rebase', '--abort']),
        pushBranch: (repoRoot: string, branch: string): Promise<string> => run(repoRoot, ['push', '-u', 'origin', branch], {
            timeout: LONG_RUNNING_TIMEOUT, env: NO_PROMPT,
        }),
        currentBranch: (repoRoot: string): Promise<string> => run(repoRoot, ['rev-parse', '--abbrev-ref', 'HEAD']),
        headSha: (repoRoot: string): Promise<string> => run(repoRoot, ['rev-parse', 'HEAD']),
        async remoteBranchSha(repoRoot: string, branch: string): Promise<string> {
            const line = await run(repoRoot, ['ls-remote', '--heads', 'origin', `refs/heads/${branch}`], {
                timeout: PROBE_TIMEOUT, env: NO_PROMPT,
            });
            return line.split(/\s+/)[0] ?? '';
        },
    };
}

export const pullRequestGit = createPullRequestGit();

export type PullRequestGit = typeof pullRequestGit;
