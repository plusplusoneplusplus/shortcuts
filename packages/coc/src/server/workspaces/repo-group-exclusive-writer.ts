import * as fs from 'fs';
import * as path from 'path';
import type { ProcessStore, WorkspaceInfo } from '@plusplusoneplusplus/forge';
import { APIError } from '../errors';
import { repoGroupRootsOverlap } from './repo-group-access-policy';
import { isRepoGroupWorkspaceId, readRepoGroup, type RepoGroupFile } from './repo-group-workspace';

// Serialize admission and persistence together, including saves from separate route registrations.
const mutations = new Map<string, Promise<void>>();

export async function withRepoGroupMutation<T>(dataDir: string, operation: () => Promise<T>): Promise<T> {
    const key = path.resolve(dataDir);
    const previous = mutations.get(key) ?? Promise.resolve();
    let release!: () => void;
    const pending = new Promise<void>(resolve => { release = resolve; });
    mutations.set(key, pending);
    await previous;
    try {
        return await operation();
    } finally {
        release();
        if (mutations.get(key) === pending) mutations.delete(key);
    }
}

export interface RepoGroupWriterConflict {
    workspaceId: string;
    writerWorkspaceId?: string;
    writerGroupId: string;
    writerGroupName: string;
    writerGroupLink: string;
    reason: 'writer-exists' | 'unresolved-membership';
}

function canonicalRoot(workspace: WorkspaceInfo | undefined): string | undefined {
    if (!workspace || workspace.virtual) return undefined;
    try {
        return fs.realpathSync.native(workspace.rootPath);
    } catch (error) {
        if (error instanceof Error && 'code' in error && (error.code === 'ENOENT' || error.code === 'ENOTDIR')) {
            return undefined;
        }
        throw error;
    }
}

/**
 * Resolve defaults and reject only newly granted writers. Unchanged conflicting
 * memberships remain editable, and revoking access never requires resolved roots.
 */
export async function admitRepoGroupWriters(
    dataDir: string,
    store: ProcessStore,
    members: readonly string[],
    readOnlyMembers: readonly string[],
    explicit: Record<string, boolean> | undefined,
    groupId?: string,
    current?: RepoGroupFile,
): Promise<string[]> {
    const registry = await store.getWorkspaces();
    const workspaces = new Map(registry.map(workspace => [workspace.id, workspace]));
    const roots = new Map<string, string | undefined>();
    const root = (id: string) => {
        if (!roots.has(id)) roots.set(id, canonicalRoot(workspaces.get(id)));
        return roots.get(id);
    };
    const groups = registry
        .filter(workspace => isRepoGroupWorkspaceId(workspace.id) && workspace.id !== groupId)
        .map(workspace => ({ workspace, file: readRepoGroup(dataDir, workspace.id, { strictMembers: true }) }));
    const protectedIds = new Set(readOnlyMembers);
    const conflicts: RepoGroupWriterConflict[] = [];

    for (const workspaceId of members) {
        const existed = current?.members.includes(workspaceId) ?? false;
        const newMember = !existed;
        // Preserve saved policies, including stale members, without reassigning a writer.
        if (protectedIds.has(workspaceId) || (existed && !current?.readOnlyMembers?.includes(workspaceId))) continue;
        const candidateRoot = root(workspaceId);
        const matches = groups.flatMap<{
            workspace: WorkspaceInfo;
            writerWorkspaceId: string | undefined;
            writable: boolean;
            unresolved: boolean;
        }>(({ workspace, file }) => {
            if (!file) return [{ workspace, writerWorkspaceId: undefined, writable: true, unresolved: true }];
            return file.members.flatMap(otherId => {
                const otherRoot = root(otherId);
                const sameId = workspaceId === otherId;
                const unresolved = !sameId && (!candidateRoot || !otherRoot);
                if (!sameId && candidateRoot && otherRoot && !repoGroupRootsOverlap(candidateRoot, otherRoot)) return [];
                return [{
                    workspace,
                    writerWorkspaceId: otherId,
                    writable: !file.readOnlyMembers?.includes(otherId),
                    unresolved,
                }];
            });
        });
        if (newMember && explicit?.[workspaceId] === undefined && matches.length > 0) {
            protectedIds.add(workspaceId);
            continue;
        }
        for (const match of matches.filter(match => match.writable)) {
            conflicts.push({
                workspaceId,
                writerWorkspaceId: match.writerWorkspaceId,
                writerGroupId: match.workspace.id,
                writerGroupName: match.workspace.name,
                writerGroupLink: `#repos/${encodeURIComponent(match.workspace.id)}/settings`,
                reason: match.unresolved ? 'unresolved-membership' : 'writer-exists',
            });
        }
        // A first writer also needs a resolvable root, even with no other groups.
        if (!candidateRoot && !conflicts.some(conflict => conflict.workspaceId === workspaceId)) {
            throw new APIError(409, `Cannot grant write access to unresolved member "${workspaceId}"`,
                'REPO_GROUP_MEMBER_UNRESOLVED', { workspaceId });
        }
    }
    if (conflicts.length > 0) {
        throw new APIError(409, 'Another repo group has write access; set it read-only first',
            'REPO_GROUP_WRITER_CONFLICT', { conflicts });
    }
    return members.filter(id => protectedIds.has(id));
}
