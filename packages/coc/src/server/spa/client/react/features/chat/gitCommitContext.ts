import { parseRemoteCloneKey } from '../../repos/cloneIdentity';
import { resolveCloneRoute } from '../../repos/cloneRegistry';
import { useWorkspaceOwner } from '../../repos/workspaceOwnerContext';

type CommitSource = { sourceWorkspaceId: string; sourceRoutingRef?: string | null };

export function useCommitContextOwner(workspaceId?: string, selectionId?: string): string | null | undefined {
    const owner = useWorkspaceOwner(workspaceId);
    const ref = owner?.selectionId ?? selectionId;
    return ref === workspaceId && ref !== undefined ? null : ref;
}

export function gitCommitContextKey(source: CommitSource & { commitHash: string }): string {
    const remote = parseRemoteCloneKey(source.sourceRoutingRef ?? '');
    return `commit\0${remote?.serverId ?? ''}\0${source.sourceWorkspaceId}\0${source.commitHash}`;
}

/** Pointer retrieval runs on the chat's server, but always against the source repo. */
export function gitCommitContextScopeError(source: CommitSource, ownerRoutingRef?: string | null): string | null {
    const sourceClone = parseRemoteCloneKey(source.sourceRoutingRef ?? '');
    const ownerClone = parseRemoteCloneKey(ownerRoutingRef ?? '');
    if (source.sourceRoutingRef != null && (!sourceClone || sourceClone.workspaceId !== source.sourceWorkspaceId)) {
        return 'Select the concrete source repository before attaching this commit.';
    }
    const sourceRoute = resolveCloneRoute(source.sourceRoutingRef ?? null);
    const ownerRoute = resolveCloneRoute(ownerRoutingRef);
    if (sourceRoute.kind === 'unresolved-remote' || ownerRoute.kind === 'unresolved-remote') {
        return 'The commit owning server is unavailable. Reconnect it before attaching or sending.';
    }
    if (sourceRoute.kind !== ownerRoute.kind
        || (sourceClone && ownerClone && sourceClone.serverId !== ownerClone.serverId)
        || (sourceRoute.kind === 'remote' && ownerRoute.kind === 'remote' && sourceRoute.baseUrl !== ownerRoute.baseUrl)) {
        return 'Attach this commit only to a chat on its owning server.';
    }
    return null;
}
