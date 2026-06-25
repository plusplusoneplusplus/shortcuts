const REMOTE_CLONE_KEY_PREFIX = 'remote:';

export interface RemoteCloneKeyParts {
    serverId: string;
    workspaceId: string;
}

export interface WorkspaceSelectionLike {
    id?: unknown;
    remote?: {
        serverId?: unknown;
        cloneKey?: unknown;
    } | null;
}

export interface RepoSelectionLike {
    workspace: WorkspaceSelectionLike;
}

export function buildRemoteCloneKey(serverId: string, workspaceId: string): string {
    return `${REMOTE_CLONE_KEY_PREFIX}${encodeURIComponent(serverId)}:${encodeURIComponent(workspaceId)}`;
}

export function parseRemoteCloneKey(value: string | null | undefined): RemoteCloneKeyParts | null {
    if (!value?.startsWith(REMOTE_CLONE_KEY_PREFIX)) return null;
    const encoded = value.slice(REMOTE_CLONE_KEY_PREFIX.length);
    const separator = encoded.indexOf(':');
    if (separator <= 0 || separator === encoded.length - 1) return null;
    try {
        const serverId = decodeURIComponent(encoded.slice(0, separator));
        const workspaceId = decodeURIComponent(encoded.slice(separator + 1));
        if (!serverId || !workspaceId) return null;
        return { serverId, workspaceId };
    } catch {
        return null;
    }
}

export function getWorkspaceIdFromSelectionId(selectionId: string): string {
    return parseRemoteCloneKey(selectionId)?.workspaceId ?? selectionId;
}

export function getRemoteCloneKey(workspace: WorkspaceSelectionLike | null | undefined): string | null {
    if (!workspace || typeof workspace.id !== 'string') return null;
    const remote = workspace.remote;
    if (!remote || typeof remote !== 'object') return null;
    if (typeof remote.cloneKey === 'string' && parseRemoteCloneKey(remote.cloneKey)) {
        return remote.cloneKey;
    }
    if (typeof remote.serverId === 'string' && remote.serverId.length > 0) {
        return buildRemoteCloneKey(remote.serverId, workspace.id);
    }
    return null;
}

export function getWorkspaceSelectionId(workspace: WorkspaceSelectionLike): string {
    const remoteKey = getRemoteCloneKey(workspace);
    if (remoteKey) return remoteKey;
    return typeof workspace.id === 'string' ? workspace.id : '';
}

export function getRepoSelectionId(repo: RepoSelectionLike): string {
    return getWorkspaceSelectionId(repo.workspace);
}

export function findRepoBySelectionId<T extends RepoSelectionLike>(
    repos: readonly T[],
    selectionId: string | null | undefined,
): T | null {
    if (!selectionId) return null;
    const parsed = parseRemoteCloneKey(selectionId);
    if (parsed) {
        return repos.find(repo => {
            const workspace = repo.workspace;
            if (getRemoteCloneKey(workspace) === selectionId) return true;
            return (
                typeof workspace.id === 'string' &&
                workspace.id === parsed.workspaceId &&
                typeof workspace.remote?.serverId === 'string' &&
                workspace.remote.serverId === parsed.serverId
            );
        }) ?? null;
    }

    const matches = repos.filter(repo => repo.workspace.id === selectionId);
    if (matches.length === 0) return null;
    return matches.find(repo => !getRemoteCloneKey(repo.workspace)) ?? matches[0];
}

export function isRepoSelected<T extends RepoSelectionLike>(
    repo: T,
    repos: readonly T[],
    selectionId: string | null | undefined,
): boolean {
    return findRepoBySelectionId(repos, selectionId) === repo;
}
