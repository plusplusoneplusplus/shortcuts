/**
 * Container agent CRUD routes: `/api/container/agents`.
 *
 * Registration/removal wires up (and tears down) the tunnel/SSH bridges, SSE
 * relay, and outbound WebSocket connection for each agent.
 */

import { isSshAddress } from '../../proxy/ssh-bridge';
import type { ContainerRuntime } from '../runtime';
import { type RouteTable, sendJson, readBody } from '../http-util';

export function installAgentRoutes(table: RouteTable, runtime: ContainerRuntime): void {
    const { agentStore, tunnelBridge, sshBridge, sseRelay, agentManager } = runtime;

    // Augment agent list with bridge info and workspaces from inbound connections.
    // For offline agents, use cached data from disconnectedAgents.
    table.on('GET', '/api/container/agents', ({ res }) => {
        const list = agentStore.list().map(agent => {
            const inboundId = agent.address.startsWith('inbound://') ? agent.address.replace('inbound://', '') : undefined;
            const inbound = inboundId ? agentManager.getAgent(inboundId) : undefined;
            const disconnected = inboundId ? agentManager.getDisconnectedAgent(inboundId) : undefined;
            return {
                ...agent,
                bridgeUrl: tunnelBridge.getLocalUrl(agent.id) || undefined,
                workspaces: inbound?.workspaces ?? disconnected?.workspaces ?? [],
            };
        });
        sendJson(res, list);
    });

    table.on('POST', '/api/container/agents', async ({ req, res }) => {
        const body = await readBody(req);
        const { address, name, tunnelId } = body as { address: string; name?: string; tunnelId?: string };
        const agent = agentStore.add(address, name, tunnelId);
        // Start tunnel bridge for devtunnel agents
        if (agent.tunnelId) {
            await tunnelBridge.start(agent.id, agent.tunnelId, agent.address).catch(() => {});
        }
        // Start SSH bridge for ssh:// agents
        if (isSshAddress(agent.address)) {
            await sshBridge.connect(agent.id, agent.address).catch(() => {});
        }
        const effectiveAddr = runtime.resolveEffectiveAddress(agent.id, agent.address);
        sseRelay.connect(agent.id, agent.name, effectiveAddr);
        agentManager.connectOutbound(agent.id, agent.name, effectiveAddr);
        const bridgeUrl = tunnelBridge.getLocalUrl(agent.id) || sshBridge.getLocalUrl(agent.id);
        sendJson(res, { ...agent, bridgeUrl: bridgeUrl || undefined }, 201);
    });

    table.onPrefix('DELETE', '/api/container/agents/', ({ res, url }) => {
        const agentId = url.pathname.split('/')[4];
        const agent = agentStore.get(agentId);
        if (agent) {
            tunnelBridge.stop(agent.id);
            sshBridge.disconnect(agent.id);
            sseRelay.disconnect(agent.id);
            agentManager.disconnectOutbound(agent.id);
        }
        const removed = agentStore.remove(agentId);
        sendJson(res, { removed });
    });

    table.onPrefix('PUT', '/api/container/agents/', async ({ req, res, url }) => {
        const agentId = url.pathname.split('/')[4];
        const body = await readBody(req);
        const { name, address, tunnelId } = body as { name?: string; address?: string; tunnelId?: string | null };
        // Use full update if address or tunnelId provided, otherwise simple rename
        const agent = (address !== undefined || tunnelId !== undefined)
            ? agentStore.update(agentId, { name, address, tunnelId })
            : agentStore.rename(agentId, name ?? '');
        if (!agent) {
            sendJson(res, { error: 'Agent not found' }, 404);
            return;
        }
        // Restart bridges — tear down old, start new if applicable
        tunnelBridge.stop(agentId);
        sshBridge.disconnect(agentId);
        if (agent.tunnelId) {
            await tunnelBridge.start(agentId, agent.tunnelId, agent.address).catch(() => {});
        }
        if (isSshAddress(agent.address)) {
            await sshBridge.connect(agentId, agent.address).catch(() => {});
        }
        const bridgeUrl = tunnelBridge.getLocalUrl(agentId) || sshBridge.getLocalUrl(agentId);
        sendJson(res, { ...agent, bridgeUrl: bridgeUrl || undefined });
    });
}
