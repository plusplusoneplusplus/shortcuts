/**
 * Workspace aggregation service.
 *
 * Aggregates workspace lists across all registered agents. Owns a per-server
 * cache (keyed by agent address) so transient fetch failures fall back to the
 * last known workspaces without leaking state across server instances or tests.
 */

import type { Agent } from '../store';
import type { AgentManager } from '../inbound';
import type { RemoteWorkspace } from '../proxy/workspaces';
import type { AgentProxyClient } from './agent-proxy-client';

export class WorkspaceAggregationService {
    /** Per-agent workspace cache (survives transient failures). */
    private readonly cache = new Map<string, RemoteWorkspace[]>();

    constructor(
        private readonly proxyClient: AgentProxyClient,
        private readonly agentManager: AgentManager,
    ) {}

    /**
     * Add a workspace to the cache for an agent. Used when a workspace is
     * registered via the browse-helper (bypassing the proxy), so the aggregated
     * list includes the new workspace immediately.
     */
    addCachedWorkspace(agentAddress: string, workspace: RemoteWorkspace): void {
        const cached = this.cache.get(agentAddress) || [];
        const idx = cached.findIndex(w => w.id === workspace.id);
        if (idx >= 0) {
            cached[idx] = workspace;
        } else {
            cached.push(workspace);
        }
        this.cache.set(agentAddress, cached);
    }

    /** Extract the inbound registration ID from an `inbound://<id>` address. */
    private inboundId(agent: Agent): string | undefined {
        return agent.address.startsWith('inbound://') ? agent.address.replace('inbound://', '') : undefined;
    }

    /** Aggregate workspaces across the given agents, decorating each with agent metadata. */
    async aggregate(agents: Agent[]): Promise<RemoteWorkspace[]> {
        const results = await Promise.all(
            agents.map(async (agent) => {
                // For offline agents, return cached workspace data
                if (agent.status === 'offline') {
                    const cached = this.cache.get(agent.address) || [];
                    if (cached.length > 0) {
                        return cached.map(ws => ({
                            ...ws,
                            agentId: agent.id,
                            agentName: agent.name,
                            agentAddress: agent.address,
                            agentOffline: true,
                        }));
                    }
                    // Fall back to disconnected agent metadata from AgentManager
                    const inboundId = this.inboundId(agent);
                    const disconnected = inboundId ? this.agentManager.getDisconnectedAgent(inboundId) : undefined;
                    if (disconnected?.workspaces?.length) {
                        return disconnected.workspaces.map(ws => ({
                            ...ws,
                            agentId: agent.id,
                            agentName: agent.name,
                            agentAddress: agent.address,
                            agentOffline: true,
                        }));
                    }
                    return [];
                }
                try {
                    const resp = await this.proxyClient.proxy(agent, 'GET', '/api/workspaces');
                    if (resp.status !== 200) return this.cache.get(agent.address) || [];
                    const result = JSON.parse(resp.body);
                    let workspaces: RemoteWorkspace[] = [];
                    if (Array.isArray(result)) {
                        workspaces = result;
                    } else if (result && typeof result === 'object' && 'workspaces' in result) {
                        workspaces = result.workspaces;
                    } else {
                        return this.cache.get(agent.address) || [];
                    }
                    // Merge with cached (preserve just-registered workspaces)
                    const cached = this.cache.get(agent.address) || [];
                    const freshIds = new Set(workspaces.map(w => w.id));
                    const extraCached = cached.filter(w => !freshIds.has(w.id));
                    const merged = [...workspaces, ...extraCached];
                    this.cache.set(agent.address, merged);
                    return merged.map(ws => ({
                        ...ws,
                        agentId: agent.id,
                        agentName: agent.name,
                        agentAddress: agent.address,
                    }));
                } catch {
                    return (this.cache.get(agent.address) || []).map(ws => ({
                        ...ws,
                        agentId: agent.id,
                        agentName: agent.name,
                        agentAddress: agent.address,
                    }));
                }
            })
        );
        return results.flat();
    }
}
