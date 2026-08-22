/**
 * Client wrappers for the repo-group REST endpoints (`/api/repo-groups`).
 *
 * A repo group is a virtual workspace referencing already-registered repo
 * workspaces; membership is validated server-side against the workspace
 * registry, so these wrappers only ever send workspace IDs — never paths.
 */
import type { WorkspaceInfo } from '@plusplusoneplusplus/coc-client';
import { getSpaCocClient } from '../api/cocClient';

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
}

export interface RepoGroupDetails {
    id: string;
    name: string;
    members: RepoGroupMember[];
}

export function createRepoGroup(request: { name: string; members: string[] }): Promise<{ workspace: WorkspaceInfo; members: RepoGroupMember[] }> {
    return getSpaCocClient().request('/repo-groups', { method: 'POST', body: request });
}

export function getRepoGroup(groupId: string): Promise<RepoGroupDetails> {
    return getSpaCocClient().request(`/repo-groups/${encodeURIComponent(groupId)}`);
}

export function updateRepoGroup(groupId: string, updates: { name?: string; members?: string[] }): Promise<RepoGroupDetails> {
    return getSpaCocClient().request(`/repo-groups/${encodeURIComponent(groupId)}`, { method: 'PATCH', body: updates });
}

export function deleteRepoGroup(groupId: string): Promise<void> {
    return getSpaCocClient().request<void>(`/repo-groups/${encodeURIComponent(groupId)}`, { method: 'DELETE' });
}
