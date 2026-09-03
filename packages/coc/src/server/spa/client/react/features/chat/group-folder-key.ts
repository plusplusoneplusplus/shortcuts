/**
 * group-folder-key — resolve the storage key and the member process ids of a
 * rendered chat *group* row (AC-02).
 *
 * Folder membership for a group is keyed on `"<type>:<groupId>"` in the
 * server-side sidecar (`group-folder-store.ts`), never on the individual
 * children, so everything the renderer needs is: which key does this rendered
 * group entry map to, and which chats live inside it.
 *
 * This mirrors `group-pinning.ts` deliberately — same key grammar, same
 * "resolve a target off the entry" shape — but covers four group types rather
 * than three: `spawned-tree` is filable even though it is not pinnable.
 *
 * Pure utility: no React, no side effects.
 */

import type { ProcessGroupFolder, ProcessGroupFolderType } from '@plusplusoneplusplus/coc-client';
import { getTaskIds } from './task-group-grouping';

export interface GroupFolderTarget {
    type: ProcessGroupFolderType;
    groupId: string;
}

/** The key a group is filed under. Must match `getGroupFolderKey` on the server. */
export function getGroupFolderKey(type: ProcessGroupFolderType, groupId: string): string {
    return `${type}:${groupId}`;
}

function nonEmpty(value: unknown): string | undefined {
    return typeof value === 'string' && value.trim() ? value : undefined;
}

/**
 * Resolve the `{ type, groupId }` a rendered list entry files under, or `null`
 * for a plain chat row (and for a group whose id is missing, which would
 * otherwise file under a key nothing can ever resolve back).
 */
export function getGroupFolderTarget(entry: any): GroupFolderTarget | null {
    const kind = entry?.kind;
    if (kind === 'ralph-session') {
        const groupId = nonEmpty(entry.sessionId);
        return groupId ? { type: 'ralph-session', groupId } : null;
    }
    if (kind === 'spawned-tree') {
        const groupId = nonEmpty(entry.rootProcessId);
        return groupId ? { type: 'spawned-tree', groupId } : null;
    }
    if (kind === 'for-each-run' || kind === 'map-reduce-run') {
        const groupId = nonEmpty(entry.runId);
        return groupId ? { type: kind, groupId } : null;
    }
    return null;
}

/** Convenience: {@link getGroupFolderTarget} collapsed to its key. */
export function getGroupFolderKeyForEntry(entry: any): string | null {
    const target = getGroupFolderTarget(entry);
    return target ? getGroupFolderKey(target.type, target.groupId) : null;
}

/** True when this list entry is a group row that can be filed as a unit. */
export function isGroupFolderEntry(entry: any): boolean {
    return getGroupFolderTarget(entry) !== null;
}

function collectSpawnedNodeIds(node: any, into: string[]): void {
    if (!node) {return;}
    into.push(...getTaskIds(node.task));
    for (const child of node.children ?? []) {
        collectSpawnedNodeIds(child, into);
    }
}

/**
 * Every process id rendered *inside* a group row, including the group's own
 * root chat for a spawned tree. Used to keep a filed group's children out of
 * the per-chat folder counts and out of the loose folder-member list.
 */
export function collectGroupProcessIds(entry: any): string[] {
    const kind = entry?.kind;
    const ids: string[] = [];
    if (kind === 'ralph-session') {
        ids.push(...getTaskIds(entry.grillingProcess));
        for (const iteration of entry.iterations ?? []) {
            ids.push(...getTaskIds(iteration));
        }
    } else if (kind === 'spawned-tree') {
        collectSpawnedNodeIds(entry.root, ids);
    } else if (kind === 'for-each-run' || kind === 'map-reduce-run') {
        for (const child of entry.children ?? []) {
            ids.push(...getTaskIds(child));
        }
    }
    return ids;
}

/**
 * Normalize whatever `GET /api/workspaces/:ws/group-folders` handed back into
 * the `key -> folderId` lookup the view model reads. Accepts either half of the
 * response so callers do not have to care which one they cached.
 */
export function buildGroupFolderMap(
    source: Readonly<Record<string, string>> | readonly ProcessGroupFolder[] | undefined,
): Map<string, string> {
    const map = new Map<string, string>();
    if (!source) {return map;}
    if (Array.isArray(source)) {
        for (const assignment of source) {
            const folderId = nonEmpty(assignment?.folderId);
            const groupId = nonEmpty(assignment?.groupId);
            if (!folderId || !groupId || !assignment?.type) {continue;}
            map.set(getGroupFolderKey(assignment.type, groupId), folderId);
        }
        return map;
    }
    for (const [key, folderId] of Object.entries(source)) {
        if (nonEmpty(folderId)) {map.set(key, folderId as string);}
    }
    return map;
}
