/**
 * Group → chat-folder membership, stored as a per-workspace JSON sidecar.
 *
 * A chat *group* (a Ralph session, a spawned tree, a for-each run, a
 * map-reduce run) is not a process, so it has no row to hang a
 * `task_group_members` link off. Filing a group by writing one membership row
 * per child would also be wrong twice over: children enqueued after the move
 * would not inherit the folder, and the folder's member count would jump by N
 * instead of 1.
 *
 * So membership is keyed on the group itself — `"<type>:<groupId>" -> folderId`
 * — which makes inheritance a read-time resolution rather than a write. The
 * shape deliberately mirrors `group-pin-store.ts`, the other sidecar that
 * addresses rendered parent rows rather than processes.
 */

import * as fs from 'fs';
import { atomicWriteJson } from '../shared/fs-utils';
import { getRepoDataPath } from '../paths';

/**
 * The group types a folder can hold. Unlike the pin store's open namespace,
 * this set is closed: an unknown type is a client bug, and accepting it would
 * silently strand a folder assignment no renderer can ever resolve.
 */
export const GROUP_FOLDER_TYPES = [
    'ralph-session',
    'spawned-tree',
    'for-each-run',
    'map-reduce-run',
] as const;

export type GroupFolderType = (typeof GROUP_FOLDER_TYPES)[number];

/** One filed group, as it goes over the wire. */
export interface GroupFolderAssignment {
    type: GroupFolderType;
    groupId: string;
    folderId: string;
    updatedAt: string;
}

interface GroupFolderState {
    version: 1;
    workspaceId: string;
    updatedAt: string;
    /** `"<type>:<groupId>" -> folderId`. */
    groups: Record<string, string>;
}

const GROUP_FOLDERS_FILE = 'group-folders.json';

export function getGroupFolderKey(type: GroupFolderType, groupId: string): string {
    return `${type}:${groupId}`;
}

/** Split a stored key back into its parts. `groupId` may itself contain ':'. */
export function parseGroupFolderKey(key: string): { type: GroupFolderType; groupId: string } | undefined {
    const separator = key.indexOf(':');
    if (separator <= 0) return undefined;
    const type = normalizeGroupFolderType(key.slice(0, separator));
    const groupId = normalizeGroupFolderId(key.slice(separator + 1));
    if (!type || !groupId) return undefined;
    return { type, groupId };
}

export function normalizeGroupFolderType(value: unknown): GroupFolderType | undefined {
    if (typeof value !== 'string') return undefined;
    const trimmed = value.trim();
    return (GROUP_FOLDER_TYPES as readonly string[]).includes(trimmed)
        ? (trimmed as GroupFolderType)
        : undefined;
}

export function normalizeGroupFolderId(groupId: unknown): string | undefined {
    if (typeof groupId !== 'string') return undefined;
    const trimmed = groupId.trim();
    return trimmed.length > 0 ? trimmed : undefined;
}

export class GroupFolderStore {
    constructor(private readonly dataDir: string) {}

    /** Every filed group in the workspace, newest assignment first. */
    listAssignments(workspaceId: string): GroupFolderAssignment[] {
        const state = this.readState(workspaceId);
        const assignments: GroupFolderAssignment[] = [];
        for (const [key, folderId] of Object.entries(state.groups)) {
            const parsed = parseGroupFolderKey(key);
            if (!parsed) continue;
            assignments.push({ ...parsed, folderId, updatedAt: state.updatedAt });
        }
        return assignments.sort((a, b) => getGroupFolderKey(a.type, a.groupId).localeCompare(getGroupFolderKey(b.type, b.groupId)));
    }

    /** The raw `"<type>:<groupId>" -> folderId` map, as the SPA consumes it. */
    getFolderMap(workspaceId: string): Record<string, string> {
        return { ...this.readState(workspaceId).groups };
    }

    getFolderId(workspaceId: string, type: GroupFolderType, groupId: string): string | undefined {
        return this.readState(workspaceId).groups[getGroupFolderKey(type, groupId)];
    }

    setFolder(
        workspaceId: string,
        type: GroupFolderType,
        groupId: string,
        folderId: string,
        updatedAt: string,
    ): GroupFolderAssignment {
        const state = this.readState(workspaceId);
        state.groups[getGroupFolderKey(type, groupId)] = folderId;
        this.writeState(workspaceId, { ...state, updatedAt });
        return { type, groupId, folderId, updatedAt };
    }

    clearFolder(workspaceId: string, type: GroupFolderType, groupId: string, updatedAt: string): void {
        const state = this.readState(workspaceId);
        const key = getGroupFolderKey(type, groupId);
        if (!(key in state.groups)) return;
        delete state.groups[key];
        this.writeState(workspaceId, { ...state, updatedAt });
    }

    /**
     * Unfile every group pointing at `folderId` and report their keys. Called
     * when the folder itself is deleted, so a deleted folder never leaves
     * groups stranded in an id that resolves to nothing.
     */
    clearFolderEverywhere(workspaceId: string, folderId: string, updatedAt: string): string[] {
        const state = this.readState(workspaceId);
        const removed = Object.entries(state.groups)
            .filter(([, value]) => value === folderId)
            .map(([key]) => key);
        if (removed.length === 0) return [];
        for (const key of removed) delete state.groups[key];
        this.writeState(workspaceId, { ...state, updatedAt });
        return removed;
    }

    private statePath(workspaceId: string): string {
        return getRepoDataPath(this.dataDir, workspaceId, GROUP_FOLDERS_FILE);
    }

    private readState(workspaceId: string): GroupFolderState {
        const filePath = this.statePath(workspaceId);
        if (!fs.existsSync(filePath)) {
            return emptyState(workspaceId);
        }

        const parsed = JSON.parse(fs.readFileSync(filePath, 'utf-8')) as Partial<GroupFolderState>;
        if (parsed.workspaceId !== workspaceId) {
            throw new Error(`Group folder state workspace mismatch for ${workspaceId}`);
        }
        if (!parsed.groups || typeof parsed.groups !== 'object' || Array.isArray(parsed.groups)) {
            throw new Error(`Invalid group folder state for ${workspaceId}`);
        }

        // Entries whose key or value no longer parses are dropped rather than
        // thrown on: a rename of a group type must not brick the sidebar.
        const groups: Record<string, string> = {};
        for (const [key, value] of Object.entries(parsed.groups)) {
            if (typeof value !== 'string' || value.length === 0) continue;
            if (!parseGroupFolderKey(key)) continue;
            groups[key] = value;
        }

        return {
            version: 1,
            workspaceId,
            updatedAt: typeof parsed.updatedAt === 'string' ? parsed.updatedAt : '',
            groups,
        };
    }

    private writeState(workspaceId: string, state: GroupFolderState): void {
        atomicWriteJson(this.statePath(workspaceId), state);
    }
}

function emptyState(workspaceId: string): GroupFolderState {
    return { version: 1, workspaceId, updatedAt: '', groups: {} };
}
