/**
 * Seen State API — typed client helpers for read/unread tracking.
 */

import type { SeenStateEntry, SeenStateMap } from '@plusplusoneplusplus/coc-client';
import { lookupCloneBaseUrl } from '../../repos/cloneRegistry';
import { getCocClientFor } from '../../api/cocClient';

export const SEEN_STATE_CHANGED_EVENT = 'coc-group-chat-seen';
export interface SeenStateRoute {
    /** Omitted baseUrl explicitly selects the local owner. */
    baseUrl?: string;
}
export type SeenStateChange = SeenStateRoute & { workspaceId: string } & (
    { entries: SeenStateEntry[] } | { processId: string }
);

function resolveRoute(workspaceId: string, route?: SeenStateRoute): SeenStateRoute {
    return route ?? { baseUrl: lookupCloneBaseUrl(workspaceId) };
}

/**
 * Fetch the full seen map (processId → seenAt) for a workspace.
 * Routed to the workspace's clone (AC-07): a remote clone's seen-state lives on
 * its own server; local clones use the default origin.
 */
export async function fetchSeenMap(workspaceId: string, route?: SeenStateRoute): Promise<SeenStateMap> {
    return getCocClientFor(resolveRoute(workspaceId, route).baseUrl).seenState.getMap(workspaceId);
}

/**
 * Batch-update seen entries. Returns the updated full map.
 */
export async function patchSeenState(
    workspaceId: string,
    entries: SeenStateEntry[],
    route?: SeenStateRoute,
    options?: { signal?: AbortSignal },
): Promise<SeenStateMap> {
    const { baseUrl } = resolveRoute(workspaceId, route);
    const map = await getCocClientFor(baseUrl).seenState.updateMany(workspaceId, entries, { signal: options?.signal });
    window.dispatchEvent(new CustomEvent<SeenStateChange>(SEEN_STATE_CHANGED_EVENT, {
        detail: { workspaceId, baseUrl, entries },
    }));
    return map;
}

/**
 * Mark a single process as unseen (delete its seen_at).
 */
export async function deleteSeenEntry(workspaceId: string, processId: string, route?: SeenStateRoute): Promise<void> {
    const { baseUrl } = resolveRoute(workspaceId, route);
    await getCocClientFor(baseUrl).seenState.markUnseen(workspaceId, processId);
    window.dispatchEvent(new CustomEvent<SeenStateChange>(SEEN_STATE_CHANGED_EVENT, {
        detail: { workspaceId, baseUrl, processId },
    }));
}

/**
 * Fetch the server-computed unseen count for a workspace.
 */
export async function fetchUnseenCount(workspaceId: string, route?: SeenStateRoute): Promise<number> {
    const res = await getCocClientFor(resolveRoute(workspaceId, route).baseUrl).seenState.getUnseenCount(workspaceId);
    return res.unseenCount;
}
