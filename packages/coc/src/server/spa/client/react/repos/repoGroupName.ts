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

/** Anything with an id/name pair; both workspace shapes qualify. */
type NamedWorkspace = { id?: unknown; name?: unknown };

/**
 * The group's registered name, searching the local workspace list first and the
 * remote groups second. Falls back to the workspace id while lists are loading
 * or when the owning server is unknown.
 */
export function resolveRepoGroupName(
    workspaceId: string,
    localWorkspaces: readonly NamedWorkspace[] | null | undefined,
    remoteGroupWorkspaces: readonly NamedWorkspace[] | null | undefined
): string {
    for (const list of [localWorkspaces, remoteGroupWorkspaces]) {
        const match = (list ?? []).find(ws => String(ws?.id ?? '') === workspaceId);
        const name = match?.name;
        if (typeof name === 'string' && name.length > 0) return name;
    }
    return workspaceId;
}
