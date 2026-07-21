/**
 * Agent-scoped proxy route: `/api/agent/:agentId/...` → proxy to the agent.
 * Agent lookup happens here; transport (inbound channel vs HTTP/bridge) is
 * handled by the shared AgentProxyClient.
 */

import type { ContainerRuntime } from '../runtime';
import type { RouteTable } from '../http-util';

const AGENT_PROXY_RE = /^\/api\/agent\/([^/]+)\/(.*)/;

export function installProxyRoutes(table: RouteTable, runtime: ContainerRuntime): void {
    const { agentStore, proxyClient } = runtime;

    table.when((_method, url) => AGENT_PROXY_RE.test(url.pathname), async ({ req, res, url }) => {
        const match = url.pathname.match(AGENT_PROXY_RE)!;
        const [, agentId, rest] = match;
        const agent = agentStore.get(agentId);
        if (!agent) {
            process.stderr.write(`[agent-proxy] Agent not found: ${agentId}\n`);
            res.writeHead(404, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Agent not found' }));
            return;
        }
        await proxyClient.forward(agent, req, res, url, rest);
    });
}
