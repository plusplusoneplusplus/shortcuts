/**
 * Thin hook exposing fetchApi(path) for React components.
 * Delegates transport behavior to @plusplusoneplusplus/coc-client.
 */

import { requestSpaApi } from '../api/cocClient';
import { getApiBase, getRawApiBase, isContainerMode } from '../utils/config';

export async function fetchApi(path: string, options?: RequestInit): Promise<any> {
    return requestSpaApi(path, options);
}

/**
 * In container mode, returns the API base prefixed with the agent proxy path.
 * In normal mode, returns the standard API base.
 * Use this for workspace-scoped API calls that need to be routed to the correct agent.
 */
export function getAgentApiBase(agentId?: string): string {
    if (isContainerMode() && agentId) {
        return getRawApiBase() + '/agent/' + encodeURIComponent(agentId);
    }
    return getApiBase();
}

/**
 * Like fetchApi but routes through the agent proxy in container mode.
 */
export async function fetchAgentApi(agentId: string | undefined, path: string, options?: RequestInit): Promise<any> {
    const base = getAgentApiBase(agentId);
    const url = base + path;
    const res = await fetch(url, options ?? {});
    if (!res.ok) {
        throw new Error(`API error: ${res.status} ${res.statusText}`);
    }
    if (res.status === 204) return undefined;
    return res.json();
}

/**
 * Fetch from container-level API (bypasses agent prefix).
 * Use for container management endpoints like /api/container/agents.
 */
export async function fetchContainerApi(path: string, options?: RequestInit): Promise<any> {
    const url = '/api' + path;
    const res = await fetch(url, options ?? {});
    if (!res.ok) throw new Error(`API error: ${res.status} ${res.statusText}`);
    if (res.status === 204) return undefined;
    return res.json();
}

/**
 * Fetch from raw API base (no agent prefix).
 * Use for aggregated endpoints in container mode.
 */
export async function fetchRawApi(path: string, options?: RequestInit): Promise<any> {
    const url = '/api' + path;
    const res = await fetch(url, options ?? {});
    if (!res.ok) throw new Error(`API error: ${res.status} ${res.statusText}`);
    if (res.status === 204) return undefined;
    return res.json();
}
