/**
 * Seen State API — client-side fetch helpers for read/unread tracking.
 */

import { fetchApi } from './useApi';

/**
 * Fetch the full seen map (processId → seenAt) for a workspace.
 */
export async function fetchSeenMap(workspaceId: string): Promise<Record<string, string>> {
    return fetchApi(`/workspaces/${encodeURIComponent(workspaceId)}/seen-state`);
}

/**
 * Batch-update seen entries. Returns the updated full map.
 */
export async function patchSeenState(
    workspaceId: string,
    entries: Array<{ processId: string; seenAt: string }>,
): Promise<Record<string, string>> {
    return fetchApi(`/workspaces/${encodeURIComponent(workspaceId)}/seen-state`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ entries }),
    });
}

/**
 * Mark a single process as unseen (delete its seen_at).
 */
export async function deleteSeenEntry(workspaceId: string, processId: string): Promise<void> {
    await fetchApi(
        `/workspaces/${encodeURIComponent(workspaceId)}/seen-state/${encodeURIComponent(processId)}`,
        { method: 'DELETE' },
    );
}

/**
 * Fetch the server-computed unseen count for a workspace.
 */
export async function fetchUnseenCount(workspaceId: string): Promise<number> {
    const res = await fetchApi(`/workspaces/${encodeURIComponent(workspaceId)}/seen-state/count`);
    return res.unseenCount;
}
