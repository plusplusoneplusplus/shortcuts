/**
 * Repository identity — decides whether two workspaces are clones of the same repo.
 *
 * Pure string utility — no Node.js dependencies (safe for browser bundles), so the
 * SPA and the server can share one implementation of the match rule.
 *
 * The rule (single source of truth for cross-clone cherry-pick targeting):
 *   - Both sides have a normalized origin → same repo iff the origins are equal,
 *     compared case-insensitively. A matching repo name does not rescue an origin
 *     mismatch.
 *   - Either side has no detectable origin → same repo iff the repo names are equal.
 */

import { normalizeRemoteUrl } from './normalize-url';

/** The identity of one clone, derived from its remote URL and local naming. */
export interface RepoIdentity {
    /** `normalizeRemoteUrl` output in its original casing, or null when no remote is known. */
    normalizedOrigin: string | null;
    /** Lowercased repo name, `.git` stripped. Empty when nothing identifiable was available. */
    repoName: string;
}

/** The fields needed to derive a {@link RepoIdentity}. All optional — callers pass what they have. */
export interface RepoIdentityInput {
    remoteUrl?: string | null;
    name?: string | null;
    rootPath?: string | null;
}

/** Last `/` or `\` separated segment of a path-ish string. */
function basename(value: string): string {
    const trimmed = value.replace(/[/\\]+$/, '');
    const idx = Math.max(trimmed.lastIndexOf('/'), trimmed.lastIndexOf('\\'));
    return idx === -1 ? trimmed : trimmed.slice(idx + 1);
}

/** Lowercase and strip a trailing `.git` so `Repo.git` and `repo` compare equal. */
function toRepoName(value: string | null | undefined): string {
    if (typeof value !== 'string') return '';
    return basename(value.trim()).replace(/\.git$/i, '').toLowerCase();
}

/**
 * Derive the identity of a clone.
 *
 * `repoName` comes from the normalized origin when there is one, otherwise from the
 * workspace name, falling back to the basename of `rootPath`.
 */
export function resolveRepoIdentity(input: RepoIdentityInput | null | undefined): RepoIdentity {
    const rawRemote = typeof input?.remoteUrl === 'string' ? input.remoteUrl.trim() : '';
    const normalizedOrigin = rawRemote ? normalizeRemoteUrl(rawRemote) || null : null;

    const repoName = normalizedOrigin
        ? toRepoName(normalizedOrigin)
        : toRepoName(input?.name) || toRepoName(input?.rootPath);

    return { normalizedOrigin, repoName };
}

/** Compare two normalized origins case-insensitively. */
export function isSameNormalizedOrigin(a: string | null | undefined, b: string | null | undefined): boolean {
    if (!a || !b) return false;
    return a.toLowerCase() === b.toLowerCase();
}

/**
 * Whether `target` is a clone of the same repository as `source`.
 *
 * See the module docstring for the rule.
 */
export function isSameRepoClone(source: RepoIdentity, target: RepoIdentity): boolean {
    if (source.normalizedOrigin && target.normalizedOrigin) {
        return isSameNormalizedOrigin(source.normalizedOrigin, target.normalizedOrigin);
    }
    if (!source.repoName || !target.repoName) return false;
    return source.repoName === target.repoName;
}
