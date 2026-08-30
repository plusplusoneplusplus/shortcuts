/**
 * Client wrappers for the repo-group REST endpoints (`/api/repo-groups`).
 *
 * A repo group is a virtual workspace referencing already-registered repo
 * workspaces; membership is validated server-side against the workspace
 * registry, so these wrappers only ever send workspace IDs — never paths.
 *
 * Every call takes an optional `baseUrl`: omit it for a group that lives in the
 * local server's registry, or pass an online remote server's `effectiveUrl` to
 * create/read/mutate a group in THAT server's registry. There is no dashboard
 * proxy route — the request goes straight to the remote CoC server, the same way
 * remote workspace aggregation and clone routing already talk to it. A group's
 * members are always ids from the one server that owns the group.
 */
import type { RemoteServer, WorkspaceInfo } from '@plusplusoneplusplus/coc-client';
import { getCocClientFor, getSpaCocClient } from '../api/cocClient';

/** A group member as resolved against the live workspace registry. */
export interface RepoGroupMember {
    workspaceId: string;
    /** True when the member cannot currently be used for context injection. */
    stale: boolean;
    /** Why the member is stale; absent for live members. */
    staleReason?: 'workspace-removed' | 'path-missing';
    /** Registry workspace name; absent when the workspace was removed. */
    name?: string;
    /** Registry absolute root path; absent when the workspace was removed. */
    rootPath?: string;
    /**
     * Free-form note about this repo's role in THIS group; absent when unset.
     * Scoped to the membership, so the same repo can read differently in another
     * group. The server appends it to the member listing it injects into chats.
     */
    description?: string;
}

/** Max length of a member description, mirrored from the server. */
export const REPO_GROUP_DESCRIPTION_MAX_LENGTH = 280;

export interface RepoGroupDetails {
    id: string;
    name: string;
    members: RepoGroupMember[];
}

/** Sentinel server id for the dashboard's own (local) registry. */
export const LOCAL_REPO_GROUP_SERVER_ID = 'local';

/** One entry of the dialog's Server dropdown. */
export interface RepoGroupServerOption {
    /** `local`, or the remote server's registry id. */
    id: string;
    label: string;
    /** Absent for local; the remote server's effectiveUrl otherwise. */
    baseUrl?: string;
}

export const LOCAL_REPO_GROUP_SERVER: RepoGroupServerOption = {
    id: LOCAL_REPO_GROUP_SERVER_ID,
    label: 'Local',
};

function isOnline(server: RemoteServer): boolean {
    return server.status === 'online' && typeof server.effectiveUrl === 'string' && server.effectiveUrl.length > 0;
}

/**
 * Servers a group can be created on: Local first, then every remote server the
 * registry currently reports as ONLINE. Offline servers are never offered —
 * their groups stay read-only until they reconnect. A failing `/api/servers`
 * degrades to Local-only rather than blocking group creation.
 */
export async function listRepoGroupServerOptions(): Promise<RepoGroupServerOption[]> {
    let servers: RemoteServer[];
    try {
        servers = await getSpaCocClient().servers.list();
    } catch {
        return [LOCAL_REPO_GROUP_SERVER];
    }
    return [
        LOCAL_REPO_GROUP_SERVER,
        ...servers.filter(isOnline).map(server => ({
            id: server.id,
            label: server.label || server.id,
            baseUrl: server.effectiveUrl as string,
        })),
    ];
}

export function createRepoGroup(request: { name: string; members: string[]; descriptions?: Record<string, string> }, baseUrl?: string): Promise<{ workspace: WorkspaceInfo; members: RepoGroupMember[] }> {
    return getCocClientFor(baseUrl).request('/repo-groups', { method: 'POST', body: request });
}

export function getRepoGroup(groupId: string, baseUrl?: string): Promise<RepoGroupDetails> {
    return getCocClientFor(baseUrl).request(`/repo-groups/${encodeURIComponent(groupId)}`);
}

/**
 * `descriptions` is a PARTIAL patch server-side: only the supplied workspace ids
 * change, an empty string clears one, and members left out keep their text — so
 * a single edited row can be sent on its own.
 */
export function updateRepoGroup(groupId: string, updates: { name?: string; members?: string[]; descriptions?: Record<string, string> }, baseUrl?: string): Promise<RepoGroupDetails> {
    return getCocClientFor(baseUrl).request(`/repo-groups/${encodeURIComponent(groupId)}`, { method: 'PATCH', body: updates });
}

export function deleteRepoGroup(groupId: string, baseUrl?: string): Promise<void> {
    return getCocClientFor(baseUrl).request<void>(`/repo-groups/${encodeURIComponent(groupId)}`, { method: 'DELETE' });
}
