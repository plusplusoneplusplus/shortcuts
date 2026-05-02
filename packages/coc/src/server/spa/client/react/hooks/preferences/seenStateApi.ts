/**
 * Seen State API — typed client helpers for read/unread tracking.
 */

import type { SeenStateEntry, SeenStateMap } from '@plusplusoneplusplus/coc-client';
import { getSpaCocClient } from '../../api/cocClient';

/**
 * Fetch the full seen map (processId → seenAt) for a workspace.
 */
export async function fetchSeenMap(workspaceId: string): Promise<SeenStateMap> {
    return getSpaCocClient().seenState.getMap(workspaceId);
}

/**
 * Batch-update seen entries. Returns the updated full map.
 */
export async function patchSeenState(
    workspaceId: string,
    entries: SeenStateEntry[],
): Promise<SeenStateMap> {
    return getSpaCocClient().seenState.updateMany(workspaceId, entries);
}

/**
 * Mark a single process as unseen (delete its seen_at).
 */
export async function deleteSeenEntry(workspaceId: string, processId: string): Promise<void> {
    await getSpaCocClient().seenState.markUnseen(workspaceId, processId);
}

/**
 * Fetch the server-computed unseen count for a workspace.
 */
export async function fetchUnseenCount(workspaceId: string): Promise<number> {
    const res = await getSpaCocClient().seenState.getUnseenCount(workspaceId);
    return res.unseenCount;
}
