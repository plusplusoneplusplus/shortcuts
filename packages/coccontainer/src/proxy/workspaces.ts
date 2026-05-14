/**
 * Fetch and aggregate workspaces from remote CoC agents.
 */

import { proxyRequest } from './http';

export interface RemoteWorkspace {
    id: string;
    rootPath: string;
    name?: string;
    /** The agent this workspace belongs to */
    agentId?: string;
    agentName?: string;
    agentAddress?: string;
}

/**
 * Fetch the workspace list from a single agent.
 */
export async function fetchAgentWorkspaces(agentAddress: string): Promise<RemoteWorkspace[]> {
    try {
        const result = await proxyRequest(agentAddress, 'GET', '/api/workspaces');
        if (Array.isArray(result)) {
            return result as RemoteWorkspace[];
        }
        // Handle CoC response shape: { workspaces: [...] }
        if (result && typeof result === 'object' && 'workspaces' in result) {
            return (result as { workspaces: RemoteWorkspace[] }).workspaces;
        }
        return [];
    } catch {
        return [];
    }
}
