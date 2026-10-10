import * as fs from 'fs';
import * as path from 'path';
import type { ProcessStore, WorkspaceInfo } from '@plusplusoneplusplus/forge';
import type { RepoGroupAccessResponse, RepoGroupWriterConflict } from '@plusplusoneplusplus/coc-client';
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

export type { RepoGroupWriterConflict } from '@plusplusoneplusplus/coc-client';

interface MembershipMatch {
    workspace: WorkspaceInfo;
    writerWorkspaceId: string | undefined;
    writable: boolean;
    unresolved: boolean;
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

async function membershipSnapshot(dataDir: string, store: ProcessStore) {
    const registry = await store.getWorkspaces();
    const workspaces = new Map(registry.map(workspace => [workspace.id, workspace]));
    const roots = new Map<string, string | undefined>();
    const root = (id: string) => {
        if (!roots.has(id)) roots.set(id, canonicalRoot(workspaces.get(id)));
        return roots.get(id);
    };
    const groups = registry
        .filter(workspace => isRepoGroupWorkspaceId(workspace.id))
        .map(workspace => ({ workspace, file: readRepoGroup(dataDir, workspace.id, { strictMembers: true }) }));
    const matches = (workspaceId: string, excludeGroupId?: string) => {
        const candidateRoot = root(workspaceId);
        return groups.filter(({ workspace }) => workspace.id !== excludeGroupId).flatMap<MembershipMatch>(({ workspace, file }) => {
            if (!file) return [{ workspace, writerWorkspaceId: undefined, writable: true, unresolved: true }];
            return file.members.flatMap(otherId => {
                const otherRoot = root(otherId);
                const sameId = workspaceId === otherId;
                const unresolved = !candidateRoot || !otherRoot;
                if (!sameId && candidateRoot && otherRoot && !repoGroupRootsOverlap(candidateRoot, otherRoot)) return [];
                return [{
                    workspace,
                    writerWorkspaceId: otherId,
                    writable: !file.readOnlyMembers?.includes(otherId),
                    unresolved,
                }];
            });
        });
    };
    return { registry, root, matches };
}

function writerConflict(workspaceId: string, match: MembershipMatch): RepoGroupWriterConflict {
    return {
        workspaceId,
        writerWorkspaceId: match.writerWorkspaceId,
        writerGroupId: match.workspace.id,
        writerGroupName: match.workspace.name,
        writerGroupLink: `#repos/${encodeURIComponent(match.workspace.id)}/settings`,
        reason: match.unresolved ? 'unresolved-membership' : 'writer-exists',
    };
}

/** Advisory snapshot only; admission remains authoritative at save time. */
export async function getRepoGroupAccess(
    dataDir: string, store: ProcessStore, enabled: boolean, groupId?: string,
): Promise<RepoGroupAccessResponse> {
    if (!enabled) return { enabled: false, members: [] };
    const snapshot = await membershipSnapshot(dataDir, store);
    const ids = new Set(snapshot.registry.filter(ws => !ws.virtual).map(ws => ws.id));
    if (groupId) readRepoGroup(dataDir, groupId)?.members.forEach(id => ids.add(id));
    return {
        enabled: true,
        members: [...ids].map(workspaceId => {
            const matches = snapshot.matches(workspaceId);
            return {
                workspaceId,
                shared: matches.some(match => match.workspace.id !== groupId),
                unresolved: !snapshot.root(workspaceId) || matches.some(match => match.unresolved),
                writers: matches.filter(match => match.writable).map(match => writerConflict(workspaceId, match)),
            };
        }),
    };
}

/**
 * Resolve new defaults and reject new writers or incompatible overlapping additions.
 * Saved conflicts remain editable, and revoking access never requires resolved roots.
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
    const { root, matches: matchingMemberships } = await membershipSnapshot(dataDir, store);
    const protectedIds = new Set(readOnlyMembers);
    const conflicts: RepoGroupWriterConflict[] = [];
    const automaticMembers = members.filter(id => !current?.members.includes(id) && explicit?.[id] === undefined);

    for (const id of automaticMembers) {
        if (matchingMemberships(id, groupId).length > 0) protectedIds.add(id);
    }
    // Propagate protection only through omitted new defaults, never saved or explicit writers.
    let changed = true;
    while (changed) {
        changed = false;
        for (const id of automaticMembers) {
            const candidateRoot = root(id);
            if (protectedIds.has(id) || !candidateRoot) continue;
            if ([...protectedIds].some(protectedId => {
                const protectedRoot = root(protectedId);
                return protectedRoot && repoGroupRootsOverlap(candidateRoot, protectedRoot);
            })) {
                protectedIds.add(id);
                changed = true;
            }
        }
    }

    for (const workspaceId of members) {
        const existed = current?.members.includes(workspaceId) ?? false;
        // Preserve saved policies, including stale members, without reassigning a writer.
        if (protectedIds.has(workspaceId) || (existed && !current?.readOnlyMembers?.includes(workspaceId))) continue;
        const candidateRoot = root(workspaceId);
        const matches = matchingMemberships(workspaceId, groupId);
        for (const match of matches.filter(match => match.writable)) {
            conflicts.push(writerConflict(workspaceId, match));
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
    for (const writableId of members.filter(id => !protectedIds.has(id))) {
        const writableRoot = root(writableId);
        if (!writableRoot) continue;
        for (const readOnlyId of protectedIds) {
            const readOnlyRoot = root(readOnlyId);
            if (!readOnlyRoot || !repoGroupRootsOverlap(writableRoot, readOnlyRoot)) continue;
            const savedWriter = current?.members.includes(writableId) && !current.readOnlyMembers?.includes(writableId);
            // Existing-writer revocations can introduce a mixed overlap; they must remain possible.
            if (savedWriter && current?.members.includes(readOnlyId)) continue;
            throw new APIError(409, 'Overlapping repo group members must have compatible read-only settings',
                'REPO_GROUP_ACCESS_POLICY_CONFLICT', { writableWorkspaceId: writableId, readOnlyWorkspaceId: readOnlyId });
        }
    }
    return members.filter(id => protectedIds.has(id));
}
