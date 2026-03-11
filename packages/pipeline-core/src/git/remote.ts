/**
 * Git remote URL helpers.
 *
 * Provides utilities for reading the git remote URL and computing a stable
 * 16-char hash from it.  The hash is used to scope the tool-call cache to all
 * local clones of the same upstream repository.
 *
 * No VS Code dependencies — pure Node.js.
 */

import { createHash } from 'crypto';
import { execGit } from './exec';

/**
 * Normalise a remote URL for hashing purposes:
 * 1. Lowercase the entire URL
 * 2. Strip auth credentials from HTTPS URLs (`https://user:pass@host` → `https://host`)
 * 3. Strip trailing `.git` suffix
 * 4. Strip trailing `/`
 *
 * Unlike the grouping-oriented `normalizeRemoteUrl` in `normalize-url.ts`, this
 * function preserves the protocol and SSH format so that the same upstream repo
 * accessed via different protocols produces a consistent hash per-protocol.
 *
 * @param url Raw remote URL (e.g. `https://github.com/owner/repo.git`).
 * @returns Normalised URL string.
 */
export function normalizeRemoteUrl(url: string): string {
    let normalized = url.toLowerCase();
    // Strip auth credentials from HTTPS URLs: https://user:pass@host → https://host
    normalized = normalized.replace(/^(https?:\/\/)([^@]+@)/, '$1');
    // Strip trailing slash (before .git so .git/ is handled correctly)
    normalized = normalized.replace(/\/$/, '');
    // Strip trailing .git
    normalized = normalized.replace(/\.git$/, '');
    // Strip any remaining trailing slash
    normalized = normalized.replace(/\/$/, '');
    return normalized;
}

/**
 * Run `git remote get-url <remote>` and return the URL.
 * Returns `null` if the remote does not exist or git fails.
 *
 * @param repoRoot Absolute path to the repository root.
 * @param remote   Remote name (default: `'origin'`).
 */
export function getRemoteUrl(repoRoot: string, remote = 'origin'): string | null {
    try {
        return execGit(['remote', 'get-url', remote], repoRoot);
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
 * @param repoRoot Absolute path to the repository root.
 */
export function detectRemoteUrl(repoRoot: string): string | undefined {
    try {
        const url = execGit(['remote', 'get-url', 'origin'], repoRoot);
        return url || undefined;
    } catch {
        // No `origin` remote — try the first available remote.
        try {
            const remotesOut = execGit(['remote'], repoRoot);
            const firstRemote = remotesOut.trim().split('\n').filter(Boolean)[0];
            if (firstRemote) {
                const url = execGit(['remote', 'get-url', firstRemote], repoRoot);
                return url || undefined;
            }
        } catch { /* not a git repo or no remotes configured */ }
        return undefined;
    }
}
