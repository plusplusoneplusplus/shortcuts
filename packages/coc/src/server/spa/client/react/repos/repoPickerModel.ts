/**
 * repoPickerModel — pure, presentation-facing helpers shared by the two remote
 * repo-picker dropdowns (RemoteScopeCluster's remote picker and the virtual
 * workspace header's repo picker). Kept dependency-light (no React) so both the
 * headless hook and the presentational rows can reuse one source of truth.
 */

import type { RepoData } from './repoGrouping';

/**
 * Resolve a remote repo's server display name from its AC-01 `remote` marker,
 * falling back to the aggregated `baseUrl` and finally the literal "remote".
 * Only meaningful for remote checkouts (see `isRemoteRepo`).
 */
export function getServerName(repo: RepoData): string {
    const remote = (repo.workspace as any).remote as { serverLabel?: string; serverId?: string } | null;
    return String(remote?.serverLabel ?? remote?.serverId ?? (repo.workspace as any).baseUrl ?? 'remote');
}

/**
 * True when a remote repo's connection is `offline`/`failed`. Local repos have
 * no `remote` marker and are never offline.
 */
export function isRepoOffline(repo: RepoData): boolean {
    const remote = (repo.workspace as any).remote as { connection?: string } | null;
    if (!remote) return false;
    const connection = remote.connection ?? 'offline';
    return connection === 'offline' || connection === 'failed';
}

/** Trailing two segments of a filesystem path, normalized to forward slashes. */
export function shortPath(fullPath: string): string {
    if (!fullPath) return '';
    const parts = fullPath.replace(/\\/g, '/').split('/').filter(Boolean);
    return parts.slice(-2).join('/');
}
