/**
 * Seen State API — typed client helpers for read/unread tracking.
 */

import type { SeenStateEntry, SeenStateMap } from '@plusplusoneplusplus/coc-client';
import { getCocClientForWorkspace } from '../../repos/cloneRegistry';

/**
 * Fetch the full seen map (processId → seenAt) for a workspace.
 * Routed to the workspace's clone (AC-07): a remote clone's seen-state lives on
 * its own server; local clones use the default origin.
 */
export async function fetchSeenMap(workspaceId: string): Promise<SeenStateMap> {
    return getCocClientForWorkspace(workspaceId).seenState.getMap(workspaceId);
}

/**
 * Batch-update seen entries. Returns the updated full map.
 */
export async function patchSeenState(
    workspaceId: string,
    entries: SeenStateEntry[],
): Promise<SeenStateMap> {
    return getCocClientForWorkspace(workspaceId).seenState.updateMany(workspaceId, entries);
}

/**
 * Mark a single process as unseen (delete its seen_at).
 */
export async function deleteSeenEntry(workspaceId: string, processId: string): Promise<void> {
    await getCocClientForWorkspace(workspaceId).seenState.markUnseen(workspaceId, processId);
}

/**
 * Fetch the server-computed unseen count for a workspace.
 */
export async function fetchUnseenCount(workspaceId: string): Promise<number> {
    const res = await getCocClientForWorkspace(workspaceId).seenState.getUnseenCount(workspaceId);
    return res.unseenCount;
}
