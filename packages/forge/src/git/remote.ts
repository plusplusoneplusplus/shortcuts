import { createHash } from 'crypto';
import { loadNativeGit, type NativeGitAddon } from '@plusplusoneplusplus/coc-native';
import { resolveWorkspaceExecutionContext } from '../utils/workspace-execution';
import { execGitAsync } from './exec';
import { normalizeRemoteUrlForHash } from './origin-id';
import { ensureGitSafeDirectoryAsync } from './safe-directory';

export {
    resolveCanonicalOrigin,
    resolveCanonicalOriginId,
    type CanonicalOriginInput,
    type CanonicalOriginIdentity,
    type CanonicalOriginProvider,
} from './origin-id';

/**
 * The addon, plus whether this repository has to take the WSL path instead.
 *
 * Loading is deliberately separate from the call it serves: every reader here
 * answers failure with a plausible-looking absence — `null`, `undefined`, "no
 * remote" — which is exactly the shape a missing or capability-stale binary
 * must not be able to hide behind. Calling this outside the try/catch lets a
 * `NativeAddonLoadError` naming the rebuild reach the caller instead.
 */
function native(repoRoot: string): { addon: NativeGitAddon; wsl: boolean } {
    return {
        addon: loadNativeGit(),
        wsl: resolveWorkspaceExecutionContext(repoRoot).kind === 'wsl',
    };
}

/**
 * Normalise a remote URL for hashing purposes.
 *
 * Historical protocol-sensitive normalisation, kept under its existing export
 * name. The implementation is shared with canonical origin hashing via
 * `./origin-id`; see {@link normalizeRemoteUrlForHash} for the rules.
 */
export const normalizeRemoteUrl = normalizeRemoteUrlForHash;

/**
 * The URL configured for `remote`, or `null` when it does not exist.
 *
 * Reading a remote is a configuration lookup, so the native path answers it out
 * of the repository it opens and spawns nothing. Repos inside a WSL distro keep
 * asking `git remote get-url` through `wsl.exe`.
 *
 * @param repoRoot Absolute path to the repository root.
 * @param remote   Remote name (default: `'origin'`).
 */
export async function getRemoteUrl(repoRoot: string, remote = 'origin'): Promise<string | null> {
    const { addon, wsl } = native(repoRoot);
    try {
        if (wsl) {
            return await execGitAsync(['remote', 'get-url', remote], repoRoot);
        }
        await ensureGitSafeDirectoryAsync(repoRoot);
        return await addon.gitRemoteUrl(repoRoot, remote);
    } catch {
        return null;
    }
}

/**
 * Compute a stable 16-char hex hash from a remote URL.
 * The URL is normalised before hashing so that equivalent URLs (different
 * credentials, with/without `.git` suffix) produce the same hash.
 *
 * @param remoteUrl Raw or already-normalised remote URL.
 * @returns 16-character lowercase hex string.
 */
export function computeRemoteHash(remoteUrl: string): string {
    const normalized = normalizeRemoteUrl(remoteUrl);
    return createHash('sha256').update(normalized).digest('hex').slice(0, 16);
}

/**
 * Detect the primary git remote URL for a repository root.
 *
 * Tries `origin` first; falls back to the first available remote if `origin`
 * is not configured.  Returns `undefined` when the directory is not a git
 * repository or has no remotes.
 *
 * The native path asks all of that of one opened repository, where the CLI
 * needed between one and three children to answer the same question — and this
 * runs on workspace discovery, on every batch git-info refresh, and on every
 * patch transfer, so those children added up.
 *
 * @param repoRoot Absolute path to the repository root.
 */
export async function detectRemoteUrl(repoRoot: string): Promise<string | undefined> {
    const { addon, wsl } = native(repoRoot);
    if (wsl) {
        return detectRemoteUrlViaCli(repoRoot);
    }
    try {
        await ensureGitSafeDirectoryAsync(repoRoot);
        return (await addon.gitDetectRemoteUrl(repoRoot)) ?? undefined;
    } catch {
        return undefined;
    }
}

/**
 * Ask the same two questions through `wsl.exe`, in the same order.
 *
 * The WSL twin of the addon's `gitDetectRemoteUrl`. The nesting matters: the
 * fallback to the first remote only runs when `get-url origin` *fails*, so a
 * configured `origin` with an empty URL answers `undefined` rather than sending
 * the lookup on to a second remote.
 */
async function detectRemoteUrlViaCli(repoRoot: string): Promise<string | undefined> {
    try {
        const url = await execGitAsync(['remote', 'get-url', 'origin'], repoRoot);
        return url || undefined;
    } catch {
        try {
            const remotesOut = await execGitAsync(['remote'], repoRoot);
            const firstRemote = remotesOut.trim().split('\n').filter(Boolean)[0];
            if (firstRemote) {
                const url = await execGitAsync(['remote', 'get-url', firstRemote], repoRoot);
                return url || undefined;
            }
        } catch { /* not a git repo or no remotes configured */ }
        return undefined;
    }
}
