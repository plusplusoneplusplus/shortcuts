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

/** The exact addon slice required to run git. */
export interface NativeGitAddon {
    execGit: typeof Bindings.execGit;
}

/** Whether the loaded module actually exposes the git capability. */
function isGitAddon(addon: unknown): addon is NativeGitAddon {
    return typeof (addon as NativeGitAddon | null)?.execGit === 'function';
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
            'The binary predates the git capability — rebuild it with ' +
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
