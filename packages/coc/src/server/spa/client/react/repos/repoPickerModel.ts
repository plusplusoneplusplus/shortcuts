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

/**
 * Marker the server attaches to a WSL-hosted workspace. Mirrors
 * `WorkspaceWslInfo` in the coc-client contracts; restated here so this
 * presentation helper stays dependency-light.
 */
export interface RepoWslInfo {
    distro: string | null;
}

/**
 * The workspace's WSL marker, or `null` when the checkout is not WSL-hosted.
 * The server owns the decision (`src/server/wsl-workspace.ts`); this only reads
 * the field off the payload — never sniffs the path itself.
 */
export function getRepoWsl(repo: RepoData): RepoWslInfo | null {
    const wsl = (repo.workspace as any)?.wsl as { distro?: unknown } | null | undefined;
    if (!wsl || typeof wsl !== 'object') return null;
    return { distro: typeof wsl.distro === 'string' && wsl.distro ? wsl.distro : null };
}

/**
 * A group's WSL marker under the all-or-nothing rule: a group row shows the
 * `WSL` pill only when it has clones and **every** clone is WSL-hosted. A mixed
 * group (some WSL, some native) shows nothing at the group level — the
 * distinction is visible per clone once the group is expanded — and an empty
 * group shows nothing either.
 *
 * The distro is carried through only when all clones agree on it; clones spread
 * across different distros report `null`, so the label degrades to the generic
 * `Hosted in WSL`.
 */
export function getGroupWsl(group: { repos: RepoData[] }): RepoWslInfo | null {
    const repos = group?.repos ?? [];
    if (repos.length === 0) return null;

    let distro: string | null = null;
    let first = true;
    for (const repo of repos) {
        const wsl = getRepoWsl(repo);
        if (!wsl) return null;
        if (first) {
            distro = wsl.distro;
            first = false;
        } else if (distro !== wsl.distro) {
            distro = null;
        }
    }
    return { distro };
}
