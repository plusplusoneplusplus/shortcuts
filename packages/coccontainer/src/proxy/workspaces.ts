/**
 * Fetch and aggregate workspaces from remote CoC agents.
 */

import { proxyRequest } from './http';

export interface RemoteWorkspace {
    id: string;
    rootPath: string;
    name?: string;
    color?: string;
    remoteUrl?: string;
    /** The agent this workspace belongs to */
    agentId?: string;
    agentName?: string;
    agentAddress?: string;
}

/** Cache of last known workspaces per agent address (survives transient fetch failures). */
const workspaceCache = new Map<string, RemoteWorkspace[]>();

/**
 * Fetch the workspace list from a single agent.
 * On success, caches the result. On failure (including auth redirects),
 * returns the cached list (if any).
 */
export async function fetchAgentWorkspaces(agentAddress: string): Promise<RemoteWorkspace[]> {
    try {
        const result = await proxyRequest(agentAddress, 'GET', '/api/workspaces');
        let workspaces: RemoteWorkspace[] = [];
        if (Array.isArray(result)) {
            workspaces = result as RemoteWorkspace[];
        } else if (result && typeof result === 'object' && 'workspaces' in result) {
            workspaces = (result as { workspaces: RemoteWorkspace[] }).workspaces;
        } else {
            // Non-JSON response (e.g. redirect HTML from devtunnel auth) — treat as failure
            return workspaceCache.get(agentAddress) || [];
        }
        // Merge: keep any cached workspaces that aren't in the fresh list
        // (e.g. just-registered via browse-helper but not yet persisted on agent restart)
        const cached = workspaceCache.get(agentAddress) || [];
        const freshIds = new Set(workspaces.map(w => w.id));
        const extraCached = cached.filter(w => !freshIds.has(w.id));
        const merged = [...workspaces, ...extraCached];
        workspaceCache.set(agentAddress, merged);
        return merged;
    } catch {
        // Return cached workspaces on failure (e.g., devtunnel auth redirect)
        return workspaceCache.get(agentAddress) || [];
    }
}

/**
 * Add a workspace to the cache for an agent. Used when a workspace is registered
 * via the browse-helper (bypassing the proxy).
 */
export function addCachedWorkspace(agentAddress: string, workspace: RemoteWorkspace): void {
    const cached = workspaceCache.get(agentAddress) || [];
    // Replace if same ID exists, otherwise append
    const idx = cached.findIndex(w => w.id === workspace.id);
    if (idx >= 0) {
        cached[idx] = workspace;
    } else {
        cached.push(workspace);
    }
    workspaceCache.set(agentAddress, cached);
}
