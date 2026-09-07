/**
 * The dangerous-command guard: a disallow-list screen over the shell commands
 * an agent asks to run, so ask mode can stop and ask a human before
 * `rm -rf /`, `dd`, `curl … | sh` or `shutdown`.
 *
 * The shapes below are aliases of `native-bindings.ts`, generated from the
 * `#[napi]` items in `rust/napi/src/dangerous_command.rs`. The rule set itself
 * is hardcoded in `rust/core/src/dangerous_command` — there is no config
 * surface for adding or editing patterns.
 *
 * ## This capability fails open, unlike every other one here
 *
 * The rest of the package treats a missing or capability-less binary as a hard
 * failure, because serving a subtly different implementation for the life of
 * the process is worse than not starting. This capability inverts that:
 * {@link tryMatchDangerousCommand} returns `null` when the addon is
 * unavailable, and a caller reads `null` as "not screened, run it". A guard
 * that has never been enabled must not be the thing that breaks a turn on a
 * platform where the addon did not ship. The escalating path
 * ({@link loadNativeDangerousCommandGuard}) is still here for callers that
 * genuinely want the throw, and it is what the status accessor reports on.
 */

import { loadNativeAddon, nativeAddonStatus, NativeAddonLoadError } from './loader';
import type * as Bindings from './native-bindings';
import type { NativeAddonStatus } from './types';

/**
 * The verdict on one shell command.
 *
 * `matched: false` means no built-in rule fired — it is not an assertion that
 * the command is safe. This is a disallow list with no model of safety.
 */
export type NativeDangerousCommandVerdict = Bindings.DangerousCommandVerdict;

/**
 * The slice of the addon this capability needs.
 *
 * A structural slice rather than the whole module: the loader is
 * capability-agnostic, so this is what distinguishes a binary that can screen
 * commands from one that merely loaded.
 */
export interface NativeDangerousCommandGuardAddon {
    matchDangerousCommand: typeof Bindings.matchDangerousCommand;
}

/** Whether the loaded module actually exposes the guard. */
function isDangerousCommandGuardAddon(addon: unknown): addon is NativeDangerousCommandGuardAddon {
    return (
        typeof (addon as NativeDangerousCommandGuardAddon | null)?.matchDangerousCommand ===
        'function'
    );
}

/**
 * The dangerous-command guard, or a throw.
 *
 * Throws {@link NativeAddonLoadError} when no binary could be loaded and when a
 * binary loaded but predates the capability. Most callers want
 * {@link tryMatchDangerousCommand} instead — this exists for a caller that has
 * already decided an unavailable guard is a startup problem.
 */
export function loadNativeDangerousCommandGuard(): NativeDangerousCommandGuardAddon {
    const addon = loadNativeAddon();
    if (isDangerousCommandGuardAddon(addon)) return addon;
    const { binaryPath } = nativeAddonStatus();
    throw new NativeAddonLoadError(
        `@plusplusoneplusplus/coc-native: ${binaryPath} loaded but does not export the dangerous-command guard.\n` +
            'The binary predates the dangerous-command capability — rebuild it with ' +
            '`npm run build:native -w packages/coc-native`.',
    );
}

/**
 * Screen one shell command, or report that it could not be screened.
 *
 * Returns `null` — never throws — when the addon is missing, will not load, or
 * predates the capability. A caller must read that as "run the command as it
 * would have run before this feature existed": the guard defaults off and ships
 * dark, so it may not be the reason a turn fails.
 */
export function tryMatchDangerousCommand(command: string): NativeDangerousCommandVerdict | null {
    try {
        return loadNativeDangerousCommandGuard().matchDangerousCommand(command);
    } catch {
        return null;
    }
}

/**
 * Whether the guard is usable, and why not when it is not.
 *
 * Never throws — `/api/health` reports this verbatim, so it has to survive
 * exactly the failures it needs to describe. `loaded: false` covers no binary,
 * a binary that would not load, and a binary without this capability.
 */
export function nativeDangerousCommandGuardStatus(): NativeAddonStatus {
    const status = nativeAddonStatus();
    if (!status.loaded) return status;
    // The addon resolved, so this cannot throw; it only re-reads the cache.
    if (isDangerousCommandGuardAddon(loadNativeAddon())) return status;
    return {
        loaded: false,
        binaryPath: status.binaryPath,
        reason: `${status.binaryPath} does not export the dangerous-command guard`,
    };
}
