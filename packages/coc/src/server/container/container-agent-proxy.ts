/**
 * Container Agent Proxy — forwards API requests to remote agents.
 *
 * Matches `/api/agent/:agentId/*` and proxies to the agent's address.
 * For devtunnel agents with a tunnelId, adds the X-Tunnel-Authorization header.
 * Streams responses to support SSE.
 */

import type { IncomingMessage, ServerResponse } from 'http';
import type { ContainerAgentStore } from './container-agent-store';
import type { DevTunnelTokenService } from './devtunnel-token-service';
import type { Route } from '../types';

export interface ContainerAgentProxyOptions {
    store: ContainerAgentStore;
    tokenService: DevTunnelTokenService;
}

const TUNNEL_AUTH_HEADER = 'X-Tunnel-Authorization';

/**
 * Registers the catch-all agent proxy route.
 * Must be registered AFTER more specific routes so it only catches
 * requests that don't match other handlers.
 */
export function registerContainerAgentProxyRoute(
    routes: Route[],
    options: ContainerAgentProxyOptions,
): void {
    const { store, tokenService } = options;

    routes.push({
        method: '*',
        pattern: /^\/api\/agent\/([^/]+)(\/.*)?$/,
        handler: async (req: IncomingMessage, res: ServerResponse, match) => {
            const agentId = decodeURIComponent(match![1]);
            const pathSuffix = match![2] || '/';

            const agent = store.get(agentId);
            if (!agent) {
                res.writeHead(404, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: `Agent not found: ${agentId}` }));
                return;
            }

            // Build target URL
            const targetUrl = `${agent.address}/api${pathSuffix}`;
            const targetUrlWithQuery = req.url?.includes('?')
                ? `${targetUrl}?${req.url.split('?')[1]}`
                : targetUrl;

            // Build headers — forward most original headers
            const headers: Record<string, string> = {};
            for (const [key, value] of Object.entries(req.headers)) {
                if (!value) continue;
                const lower = key.toLowerCase();
                // Skip hop-by-hop and host headers
                if (['host', 'connection', 'keep-alive', 'transfer-encoding', 'upgrade'].includes(lower)) {
                    continue;
                }
                headers[key] = Array.isArray(value) ? value.join(', ') : value;
            }

            // Add tunnel auth if available
            if (agent.tunnelId) {
                const tokenResult = await tokenService.getToken(agent.tunnelId);
                if (tokenResult) {
                    headers[TUNNEL_AUTH_HEADER] = `TunnelAccessToken ${tokenResult.token}`;
                }
            }

            // Read request body (for POST/PUT/PATCH)
            let body: Buffer | undefined;
            if (req.method && !['GET', 'HEAD', 'OPTIONS'].includes(req.method.toUpperCase())) {
                body = await readBody(req);
            }

            try {
                const response = await fetch(targetUrlWithQuery, {
                    method: req.method || 'GET',
                    headers,
                    body,
                });

                // Forward status and headers
                const responseHeaders: Record<string, string> = {};
                response.headers.forEach((value, key) => {
                    const lower = key.toLowerCase();
                    if (['transfer-encoding', 'connection'].includes(lower)) return;
                    responseHeaders[key] = value;
                });

                res.writeHead(response.status, responseHeaders);

                // Stream response body
                if (response.body) {
                    const reader = response.body.getReader();
                    try {
                        while (true) {
                            const { done, value } = await reader.read();
                            if (done) break;
                            res.write(value);
                        }
                    } catch {
                        // Client may have disconnected
                    } finally {
                        reader.releaseLock();
                    }
                }
                res.end();
            } catch (error) {
                // If we get a 401 from the agent, invalidate the token
                if (agent.tunnelId) {
                    tokenService.invalidate(agent.tunnelId);
                }
                if (!res.headersSent) {
                    res.writeHead(502, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({
                        error: 'Failed to reach agent',
                        detail: error instanceof Error ? error.message : String(error),
                    }));
                } else {
                    res.end();
                }
            }
        },
    });
}

function readBody(req: IncomingMessage): Promise<Buffer> {
    return new Promise((resolve, reject) => {
        const chunks: Buffer[] = [];
        req.on('data', (chunk: Buffer) => chunks.push(chunk));
        req.on('end', () => resolve(Buffer.concat(chunks)));
        req.on('error', reject);
    });
}
