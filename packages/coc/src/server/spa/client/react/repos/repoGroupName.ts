/**
 * Display-name lookup for a repo-group virtual workspace.
 *
 * A LOCAL group is registered in this server's workspace list (`AppContext.workspaces`),
 * but a group that lives on a remote CoC server never appears there — it arrives
 * through the remote workspace aggregation as a `group-*` row on
 * `ReposContext.remoteGroupWorkspaces`. Both the in-body header
 * (`RepoGroupView`) and the TopBar header need the same answer, so the merge
 * lives here instead of being duplicated (and, before this, getting the remote
 * case wrong by falling back to the raw `group-<slug>` id).
 */

import { getWorkspaceSelectionId } from './cloneIdentity';
import { getHostname } from '../utils/config';

/** Anything with an id/name pair; both workspace shapes qualify. */
type NamedWorkspace = { id?: unknown; name?: unknown; remote?: { serverId?: unknown; serverLabel?: string; cloneKey?: unknown } | null };

export function getRepoGroupServerName(workspace: NamedWorkspace): string {
    if (!workspace.remote) return getHostname() ?? 'Local';
    return workspace.remote.serverLabel || String(workspace.remote.serverId || 'Remote');
}

/**
 * The selected group's registered name. A remote selection includes its server
 * id, so an identically named local or remote group cannot claim its label.
 */
export function resolveRepoGroupName(
    workspaceId: string,
    localWorkspaces: readonly NamedWorkspace[] | null | undefined,
    remoteGroupWorkspaces: readonly NamedWorkspace[] | null | undefined
): string {
    for (const list of [localWorkspaces, remoteGroupWorkspaces]) {
        const match = (list ?? []).find(ws => getWorkspaceSelectionId(ws) === workspaceId);
        const name = match?.name;
        if (typeof name === 'string' && name.length > 0) return name;
    }
    return workspaceId;
}

/** Include the owning machine in identity surfaces, without using its name as a key. */
export function resolveRepoGroupDisplayName(
    selectionId: string,
    localWorkspaces: readonly NamedWorkspace[] | null | undefined,
    remoteGroupWorkspaces: readonly NamedWorkspace[] | null | undefined,
): string {
    const name = resolveRepoGroupName(selectionId, localWorkspaces, remoteGroupWorkspaces);
    const workspace = [...(localWorkspaces ?? []), ...(remoteGroupWorkspaces ?? [])]
        .find(ws => getWorkspaceSelectionId(ws) === selectionId);
    if (!workspace) return name;
    return `${getRepoGroupServerName(workspace)} · ${name}`;
}
