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

/** The exact addon slice required to run git. */
export interface NativeGitAddon {
    execGit: typeof Bindings.execGit;
    gitStatusEntries: typeof Bindings.gitStatusEntries;
    parseGitStatusPorcelain: typeof Bindings.parseGitStatusPorcelain;
    gitLogCommits: typeof Bindings.gitLogCommits;
    gitLogCommit: typeof Bindings.gitLogCommit;
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
