/**
 * The `git` capability: running git on a libuv worker instead of spawning a
 * child process from Node on every call.
 *
 * The loader resolves the binary; this module narrows the loaded module to the
 * git exports and treats every unavailable state as fatal. There is no
 * TypeScript fallback — a repository operation served by a second, subtly
 * different implementation is worse than a startup failure.
 *
 * Repositories inside a WSL distro never reach here: the caller in
 * `forge/src/git/exec.ts` routes those through `wsl.exe` itself, so the addon
 * only ever runs git on the native host.
 *
 * These shapes alias `native-bindings.ts`, generated from the `#[napi]` items
 * in `rust/napi/src/git.rs`.
 */

import { loadNativeAddon, nativeAddonStatus, NativeAddonLoadError } from './loader';
import type * as Bindings from './native-bindings';
import type { NativeAddonStatus } from './types';

/**
 * Per-call timeout, output cap and working directory.
 *
 * Field-for-field the `ExecGitOptions` that `execGitAsync` has always taken, so
 * a caller passes its options object straight through.
 */
export type NativeGitExecOptions = Bindings.GitExecOptions;

/**
 * One working-tree change as Rust reports it.
 *
 * `status` and `stage` are the `GitChangeStatus` and `GitChangeStage` string
 * unions widened to `string` by the generator; `path` is repository-relative,
 * because turning it absolute is `path.join`'s job and stays in Node.
 */
export type NativeGitStatusEntry = Bindings.GitStatusEntry;

/**
 * One commit as Rust reports it.
 *
 * Field-for-field the `GitCommit` the Git tab renders, minus `repositoryRoot`
 * and `repositoryName`: those are `repoRoot` and `path.basename(repoRoot)`, and
 * building paths stays in Node for the same reason it does for status entries.
 */
export type NativeGitLogCommit = Bindings.GitLogCommit;

/** One page of history, plus whether a next page is worth asking for. */
export type NativeGitLogPage = Bindings.GitLogPage;

/** Which slice of history to read — page size, offset and message filter. */
export type NativeGitLogOptions = Bindings.GitLogOptions;

/**
 * One file a commit touched, as Rust reports it.
 *
 * `commitHash`, `parentHash` and `repositoryRoot` are absent for the reason
 * they are absent on a status entry — they are the caller's own values — and
 * `additions`/`deletions` are absent rather than zero when `--numstat` had
 * nothing to say about the file.
 */
export type NativeGitCommitFile = Bindings.GitCommitFile;

/** A commit's file list, and the parent the list was computed against. */
export type NativeGitCommitFiles = Bindings.GitCommitFiles;

/**
 * The repository's default branch, and whether it came from a remote ref.
 *
 * `fromRemote` is not decoration: `GitRangeService` memoises the three
 * remote-derived answers and deliberately leaves the local `main`/`master`
 * fallbacks uncached, and this flag is the only way to tell them apart.
 */
export type NativeGitRangeDefaultBranch = Bindings.GitRangeDefaultBranch;

/** Which ref a range is measured against, and whether that was the ref asked for. */
export type NativeGitRangeBaseRef = Bindings.GitRangeBaseRef;

/**
 * One file in a commit range as Rust reports it.
 *
 * `repositoryRoot` is absent for the same reason it is on a status entry — it
 * is the caller's own `repoRoot`, not something to rebuild in Rust — and the
 * list arrives in git's order, because sorting it is `localeCompare`'s job.
 */
export type NativeGitRangeFile = Bindings.GitRangeFile;

/** Added and removed line totals across a range. */
export type NativeGitRangeDiffStats = Bindings.GitRangeDiffStats;

/**
 * Repository metadata from one `git status --porcelain=v2 --branch` call.
 *
 * Field-for-field the `GitRepositoryStatus` the workspace list renders.
 */
export type NativeGitRepositoryStatus = Bindings.GitRepositoryStatus;

/**
 * The checked-out branch and its drift from upstream.
 *
 * `hasUncommittedChanges` is absent because the caller already knows it and
 * merges it in; asking git a second time here would be a spawn nobody needs.
 */
export type NativeGitBranchStatus = Bindings.GitBranchStatus;

/** One branch as the branch list renders it. */
export type NativeGitBranchEntry = Bindings.GitBranchEntry;

/** One page of the branch list, plus the total the page was cut from. */
export type NativeGitBranchPage = Bindings.GitBranchPage;

/** Which slice of the branch list to read — namespace, page and name filter. */
export type NativeGitBranchListOptions = Bindings.GitBranchListOptions;

/** The exact addon slice required to run git. */
export interface NativeGitAddon {
    execGit: typeof Bindings.execGit;
    gitStatusEntries: typeof Bindings.gitStatusEntries;
    parseGitStatusPorcelain: typeof Bindings.parseGitStatusPorcelain;
    gitLogCommits: typeof Bindings.gitLogCommits;
    gitLogCommit: typeof Bindings.gitLogCommit;
    gitCommitFiles: typeof Bindings.gitCommitFiles;
    gitCommitDiff: typeof Bindings.gitCommitDiff;
    gitFileContentAtCommit: typeof Bindings.gitFileContentAtCommit;
    gitFileExistsAtCommit: typeof Bindings.gitFileExistsAtCommit;
    gitValidateRef: typeof Bindings.gitValidateRef;
    gitRangeDefaultBranch: typeof Bindings.gitRangeDefaultBranch;
    gitRangeUpstreamBranch: typeof Bindings.gitRangeUpstreamBranch;
    gitRangeResolveBaseRef: typeof Bindings.gitRangeResolveBaseRef;
    gitRangeMergeBase: typeof Bindings.gitRangeMergeBase;
    gitRangeCountAhead: typeof Bindings.gitRangeCountAhead;
    gitRangeChangedFiles: typeof Bindings.gitRangeChangedFiles;
    parseGitRangeChangedFiles: typeof Bindings.parseGitRangeChangedFiles;
    gitRangeDiffStats: typeof Bindings.gitRangeDiffStats;
    parseGitDiffShortstat: typeof Bindings.parseGitDiffShortstat;
    gitRepositoryStatus: typeof Bindings.gitRepositoryStatus;
    parseGitBranchStatus: typeof Bindings.parseGitBranchStatus;
    gitBranchStatus: typeof Bindings.gitBranchStatus;
    gitListBranches: typeof Bindings.gitListBranches;
    gitLocalBranchNames: typeof Bindings.gitLocalBranchNames;
    gitRemoteUrl: typeof Bindings.gitRemoteUrl;
    gitDetectRemoteUrl: typeof Bindings.gitDetectRemoteUrl;
    gitGlobalConfigGetAll: typeof Bindings.gitGlobalConfigGetAll;
    gitGlobalConfigAdd: typeof Bindings.gitGlobalConfigAdd;
    gitDiscoverRepoRoot: typeof Bindings.gitDiscoverRepoRoot;
}

/**
 * Every function the capability is made of.
 *
 * Checking all of them, rather than one as a marker, is what makes a binary
 * built before a later slice fail at load with a rebuild instruction instead of
 * at the first call with `undefined is not a function`.
 */
const GIT_EXPORTS = [
    'execGit',
    'gitStatusEntries',
    'parseGitStatusPorcelain',
    'gitLogCommits',
    'gitLogCommit',
    'gitCommitFiles',
    'gitCommitDiff',
    'gitFileContentAtCommit',
    'gitFileExistsAtCommit',
    'gitValidateRef',
    'gitRangeDefaultBranch',
    'gitRangeUpstreamBranch',
    'gitRangeResolveBaseRef',
    'gitRangeMergeBase',
    'gitRangeCountAhead',
    'gitRangeChangedFiles',
    'parseGitRangeChangedFiles',
    'gitRangeDiffStats',
    'parseGitDiffShortstat',
    'gitRepositoryStatus',
    'parseGitBranchStatus',
    'gitBranchStatus',
    'gitListBranches',
    'gitLocalBranchNames',
    'gitRemoteUrl',
    'gitDetectRemoteUrl',
    'gitGlobalConfigGetAll',
    'gitGlobalConfigAdd',
    'gitDiscoverRepoRoot',
] as const;

/** Whether the loaded module actually exposes the git capability. */
function isGitAddon(addon: unknown): addon is NativeGitAddon {
    const candidate = addon as Record<string, unknown> | null;
    return GIT_EXPORTS.every(name => typeof candidate?.[name] === 'function');
}

/**
 * Load the required git capability.
 *
 * Throws {@link NativeAddonLoadError} for a missing, unloadable, or
 * capability-stale binary.
 */
export function loadNativeGit(): NativeGitAddon {
    const addon = loadNativeAddon();
    if (isGitAddon(addon)) return addon;
    const { binaryPath } = nativeAddonStatus();
    throw new NativeAddonLoadError(
        `@plusplusoneplusplus/coc-native: ${binaryPath} loaded but does not export the git capability.\n` +
            'The binary predates the git capability, or a part of it — rebuild it with ' +
            '`npm run build:native -w packages/coc-native`.',
    );
}

/**
 * Whether git is usable, and why not when it is not.
 *
 * Never throws so startup diagnostics and `/api/health` can describe every
 * unusable state, including a capability-stale binary.
 */
export function nativeGitStatus(): NativeAddonStatus {
    const status = nativeAddonStatus();
    if (!status.loaded) return status;
    if (isGitAddon(loadNativeAddon())) return status;
    return {
        loaded: false,
        binaryPath: status.binaryPath,
        reason: `${status.binaryPath} does not export the git capability`,
    };
}
