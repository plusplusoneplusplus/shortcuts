import { createHash } from 'crypto';
import { loadNativeGit, type NativeGitAddon } from '@plusplusoneplusplus/coc-native';
import { resolveWorkspaceExecutionContext } from '../utils/workspace-execution';
import { execGitAsync } from './exec';
import { normalizeRemoteUrl as normalizeRemoteUrlForGrouping } from './normalize-url';
import { ensureGitSafeDirectoryAsync } from './safe-directory';

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

export type CanonicalOriginProvider = 'github' | 'azure-devops' | 'git' | 'local';

export interface CanonicalOriginInput {
    remoteUrl?: string | null;
    workspaceId?: string | null;
}

export interface CanonicalOriginIdentity {
    originId: string;
    provider: CanonicalOriginProvider;
    remoteUrl: string | null;
    normalizedRemoteUrl: string | null;
    workspaceId?: string;
    owner?: string;
    repo?: string;
    org?: string;
    project?: string;
    remoteHash?: string;
}

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

function decodeOriginSegment(segment: string): string {
    try {
        return decodeURIComponent(segment);
    } catch {
        return segment;
    }
}

function encodeOriginSegment(segment: string): string {
    let encoded = '';
    for (const char of decodeOriginSegment(segment).trim().toLowerCase()) {
        if (/^[a-z0-9.-]$/.test(char)) {
            encoded += char;
            continue;
        }
        if (char === '_') {
            encoded += '_u';
            continue;
        }
        for (const byte of Buffer.from(char)) {
            encoded += `_x${byte.toString(16).padStart(2, '0')}`;
        }
    }
    return encoded;
}

function normalizeRemoteUrlForOrigin(remoteUrl: string): string {
    return normalizeRemoteUrlForGrouping(remoteUrl)
        .trim()
        .toLowerCase()
        .split('/')
        .map(decodeOriginSegment)
        .join('/');
}

function splitNormalizedRemote(remoteUrl: string): string[] {
    return remoteUrl.split('/').filter(part => part.length > 0);
}

function computeCanonicalRemoteHash(remoteUrl: string): string {
    const normalized = normalizeRemoteUrlForOrigin(remoteUrl) || normalizeRemoteUrl(remoteUrl);
    return createHash('sha256').update(normalized).digest('hex').slice(0, 16);
}

/**
 * Resolve the canonical origin identity for a workspace remote.
 *
 * Canonical origin IDs are:
 *   - GitHub: `gh_<owner>_<repo>`
 *   - Azure DevOps: `ado_<org>_<project>`
 *   - Other Git remotes: `git_<remoteHash>`
 *   - No remote: `local_<workspaceId>`
 */
export function resolveCanonicalOrigin(input: CanonicalOriginInput): CanonicalOriginIdentity {
    const remoteUrl = typeof input.remoteUrl === 'string' ? input.remoteUrl.trim() : '';
    const workspaceId = typeof input.workspaceId === 'string' ? input.workspaceId.trim() : '';

    if (!remoteUrl) {
        if (!workspaceId) {
            throw new Error('workspaceId is required when resolving a local origin without a remote URL');
        }
        return {
            originId: `local_${encodeOriginSegment(workspaceId)}`,
            provider: 'local',
            remoteUrl: null,
            normalizedRemoteUrl: null,
            workspaceId,
        };
    }

    const normalizedRemoteUrl = normalizeRemoteUrlForOrigin(remoteUrl);
    const parts = splitNormalizedRemote(normalizedRemoteUrl);
    const host = parts[0];

    if (host === 'github.com' && parts[1] && parts[2]) {
        const owner = encodeOriginSegment(parts[1]);
        const repo = encodeOriginSegment(parts[2]);
        return {
            originId: `gh_${owner}_${repo}`,
            provider: 'github',
            remoteUrl,
            normalizedRemoteUrl,
            ...(workspaceId ? { workspaceId } : {}),
            owner,
            repo,
        };
    }

    if (host === 'dev.azure.com' && parts[1] && parts[2]) {
        const org = encodeOriginSegment(parts[1]);
        const project = encodeOriginSegment(parts[2]);
        return {
            originId: `ado_${org}_${project}`,
            provider: 'azure-devops',
            remoteUrl,
            normalizedRemoteUrl,
            ...(workspaceId ? { workspaceId } : {}),
            org,
            project,
            ...(parts[3] ? { repo: encodeOriginSegment(parts[3]) } : {}),
        };
    }

    const remoteHash = computeCanonicalRemoteHash(remoteUrl);
    return {
        originId: `git_${remoteHash}`,
        provider: 'git',
        remoteUrl,
        normalizedRemoteUrl,
        ...(workspaceId ? { workspaceId } : {}),
        remoteHash,
    };
}

export function resolveCanonicalOriginId(input: CanonicalOriginInput): string {
    return resolveCanonicalOrigin(input).originId;
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
