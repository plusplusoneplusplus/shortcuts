/**
 * Last-active LOCAL workspace persistence (AC-03).
 *
 * The scope switcher's workspace segment must keep showing — and be able to
 * switch back to — the last-active workspace while a virtual scope
 * (My Work / My Life) is active, and that must survive a full page reload /
 * app restart. REMOTE clones already persist their stable
 * `{ serverId, workspaceId }` pair via `remoteSelectionPersistence.ts`; this
 * module is the LOCAL counterpart, persisting a LOCAL workspace's own id.
 *
 * The persisted value is the workspace's own id STRING — never a composite /
 * encoded id (IMMUTABLE decision: no composite workspace IDs). On load it is
 * resolved against the freshly-aggregated repos; a value that no longer matches
 * any present workspace resolves to `null`.
 *
 * Remote and local last-active selections are kept MUTUALLY EXCLUSIVE by the
 * caller (ReposContext): selecting a local clears the remote pair and writes the
 * local id; selecting a remote clears the local id and writes the remote pair.
 * So exactly one "last workspace" is ever persisted.
 */

import { findRepoBySelectionId, getRepoSelectionId, type RepoSelectionLike } from './cloneIdentity';

const STORAGE_KEY = 'coc-last-local-workspace';

/**
 * Persist the last-active LOCAL workspace's plain id. No-op (silent swallow) when
 * storage is unavailable (SSR / quota) or the id is empty.
 */
export function persistLocalWorkspaceSelection(workspaceId: string): void {
    if (!workspaceId) return;
    try {
        localStorage.setItem(STORAGE_KEY, workspaceId);
    } catch {
        // SSR / test / quota — nothing to persist.
    }
}

/** Clear any persisted last-active LOCAL workspace id. */
export function clearPersistedLocalWorkspaceSelection(): void {
    try {
        localStorage.removeItem(STORAGE_KEY);
    } catch {
        // SSR / test / quota — ignore.
    }
}

/** Read the persisted last-active LOCAL workspace id, or `null` when none. */
export function loadPersistedLocalWorkspaceSelection(): string | null {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        return raw && raw.length > 0 ? raw : null;
    } catch {
        return null;
    }
}

/**
 * Resolve a persisted LOCAL workspace id against the freshly-aggregated repos,
 * returning the workspace's CURRENT selection id when it is still present, else
 * `null` (e.g. the folder was removed). The write side only ever stores local
 * (non-remote) ids, and `findRepoBySelectionId` prefers the non-remote match for
 * a plain id, so this stays a local workspace.
 */
export function resolvePersistedLocalWorkspace(
    localId: string | null,
    repos: readonly RepoSelectionLike[],
): string | null {
    if (!localId) return null;
    const repo = findRepoBySelectionId(repos, localId);
    if (!repo) return null;
    return getRepoSelectionId(repo);
}

/** Test-only: clear the persisted selection between cases. @internal */
export function _resetLocalWorkspaceForTests(): void {
    clearPersistedLocalWorkspaceSelection();
}
