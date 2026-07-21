/**
 * Aggregated workspace and process-summary routes, plus the workspace-registered
 * notification that seeds the aggregation cache from out-of-band registrations.
 */

import type { RemoteWorkspace } from '../../proxy/workspaces';
import type { ContainerRuntime } from '../runtime';
import { type RouteTable, sendJson, readBody } from '../http-util';

export function installWorkspaceAggregationRoutes(table: RouteTable, runtime: ContainerRuntime): void {
    const { agentStore, workspaces, proxyClient } = runtime;

    // Aggregated workspaces from all agents
    table.on('GET', '/api/workspaces', async ({ res }) => {
        const result = await workspaces.aggregate(agentStore.list());
        sendJson(res, { workspaces: result });
    });

    // Aggregated process summaries from all agents
    table.on('GET', '/api/processes/summaries', async ({ res, url }) => {
        const allAgents = agentStore.list().filter(a => a.status !== 'offline');
        const results = await Promise.all(
            allAgents.map(async (agent) => {
                try {
                    const resp = await proxyClient.proxy(agent, 'GET', `/api/processes/summaries${url.search}`);
                    if (resp.status !== 200) return [];
                    const data = JSON.parse(resp.body);
                    const summaries = data?.summaries || data?.processes || (Array.isArray(data) ? data : []);
                    return summaries.map((p: any) => ({ ...p, agentId: agent.id, agentName: agent.name }));
                } catch { return []; }
            })
        );
        sendJson(res, { summaries: results.flat() });
    });

    // Notify container that a workspace was registered on a remote agent
    // (bypassing the proxy, e.g. via browse-helper). Updates the workspace cache
    // so the aggregated list includes the new workspace immediately.
    table.on('POST', '/api/container/workspace-registered', async ({ req, res }) => {
        const body = await readBody(req) as { agentId?: string; workspace?: RemoteWorkspace };
        if (body?.agentId && body?.workspace) {
            const agent = agentStore.get(body.agentId);
            if (agent) {
                workspaces.addCachedWorkspace(agent.address, {
                    ...body.workspace,
                    agentId: agent.id,
                    agentName: agent.name,
                    agentAddress: agent.address,
                });
            }
        }
        sendJson(res, { ok: true });
    });
}
