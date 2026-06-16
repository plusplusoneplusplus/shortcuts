/**
 * Remote-clone selection persistence (AC-08).
 *
 * A REMOTE clone selection must survive a full page reload — and survive
 * devtunnel PORT REASSIGNMENT, where the server's `baseUrl` (the routing key)
 * changes between sessions. So the persisted key is the STABLE pair
 * `{ serverId, workspaceId }`, never the volatile `baseUrl` and never a
 * composite/encoded id (IMMUTABLE decision: no composite workspace IDs).
 *
 * On load, once `aggregateRemoteWorkspaces` has repopulated `ReposContext.repos`,
 * `resolvePersistedRemoteSelection` matches the persisted pair against the
 * CURRENT remote workspaces by `remote.serverId === serverId && id === workspaceId`.
 * Because the match is on the stable `serverId` (not `baseUrl`), a changed
 * port/baseUrl still resolves to the same clone. The resolved value is the
 * workspace's CURRENT id, which the caller restores as the active selection.
 *
 * LOCAL clones are NOT persisted here: they keep riding the existing
 * `#repos/{id}` hash mechanism unchanged. This module is purely additive on top
 * of that — it only ever writes/reads a remote pair, so local-clone
 * persistence/behavior is byte-for-byte unchanged.
 */

import { isRemoteWorkspace, type RemoteWorkspaceInfo } from './remoteWorkspaceAggregation';

const STORAGE_KEY = 'coc-remote-clone-selection';

/** The stable pair persisted for a selected remote clone. */
export interface PersistedRemoteSelection {
    /** Stable registry id of the contributing server (survives port reassignment). */
    serverId: string;
    /** The remote workspace's own id (stable; NOT composite). */
    workspaceId: string;
}

function isPersistedRemoteSelection(value: unknown): value is PersistedRemoteSelection {
    return (
        typeof value === 'object' &&
        value !== null &&
        typeof (value as PersistedRemoteSelection).serverId === 'string' &&
        (value as PersistedRemoteSelection).serverId.length > 0 &&
        typeof (value as PersistedRemoteSelection).workspaceId === 'string' &&
        (value as PersistedRemoteSelection).workspaceId.length > 0
    );
}

/**
 * Persist the selected remote clone's stable `{ serverId, workspaceId }` pair.
 * No-op (and a console-free swallow) when storage is unavailable (SSR / quota).
 */
export function persistRemoteSelection(selection: PersistedRemoteSelection): void {
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(selection));
    } catch {
        // SSR / test / quota — nothing to persist; the hash still carries the id
        // for the current session.
    }
}

/**
 * Clear any persisted remote-clone selection. Called when the active selection
 * becomes a LOCAL clone (or is cleared), so a stale remote pair never fights the
 * hash-restored local selection on the next reload.
 */
export function clearPersistedRemoteSelection(): void {
    try {
        localStorage.removeItem(STORAGE_KEY);
    } catch {
        // SSR / test / quota — ignore.
    }
}

/** Read the persisted remote-clone selection, or `null` when none / malformed. */
export function loadPersistedRemoteSelection(): PersistedRemoteSelection | null {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (!raw) return null;
        const parsed = JSON.parse(raw) as unknown;
        return isPersistedRemoteSelection(parsed) ? parsed : null;
    } catch {
        return null;
    }
}

/**
 * Resolve a persisted `{ serverId, workspaceId }` pair to the CURRENT matching
 * remote workspace's id, scanning the freshly-aggregated remote workspaces.
 *
 * Match is on the stable `remote.serverId` plus the workspace `id` — so a clone
 * whose `baseUrl`/port changed (devtunnel reassignment) still resolves, and a
 * workspace id that collides ACROSS two servers disambiguates by serverId.
 * Returns the matching workspace id (its current id) or `null` when no remote
 * workspace matches (e.g. the server was removed and nothing is cached).
 */
export function resolvePersistedRemoteSelection(
    selection: PersistedRemoteSelection | null,
    workspaces: ReadonlyArray<{ id: string } & Partial<RemoteWorkspaceInfo>>,
): string | null {
    if (!selection) return null;
    for (const workspace of workspaces) {
        if (
            isRemoteWorkspace(workspace) &&
            workspace.remote.serverId === selection.serverId &&
            workspace.id === selection.workspaceId
        ) {
            return workspace.id;
        }
    }
    return null;
}

/** Test-only: clear the persisted selection between cases. @internal */
export function _resetRemoteSelectionForTests(): void {
    clearPersistedRemoteSelection();
}
