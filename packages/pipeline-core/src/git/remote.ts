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
 * Normalise a remote URL before hashing:
 * 1. Lowercase
 * 2. Strip auth credentials (`https://user:pass@host` → `https://host`)
 * 3. Strip trailing `.git`
 * 4. Strip trailing `/`
 *
 * @param url Raw remote URL (e.g. `https://github.com/owner/repo.git`).
 * @returns Normalised URL string.
 */
export function normalizeRemoteUrl(url: string): string {
    let normalized = url.toLowerCase();
    // Strip auth: https://user:pass@host → https://host
    normalized = normalized.replace(/^(https?:\/\/)([^@]+@)/, '$1');
    // Strip trailing / (must come before .git so .git/ is handled correctly)
    normalized = normalized.replace(/\/$/, '');
    // Strip trailing .git
    normalized = normalized.replace(/\.git$/, '');
    // Strip any remaining trailing /
    normalized = normalized.replace(/\/$/, '');
    return normalized;
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
