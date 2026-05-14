/**
 * Container Agent REST Routes — CRUD for managing agents in container mode.
 *
 * GET    /api/container/agents       — list all agents with status
 * POST   /api/container/agents       — add a new agent
 * PUT    /api/container/agents/:id   — update an agent
 * DELETE /api/container/agents/:id   — remove an agent
 */

import type { Route } from '../types';
import { readJsonBody, send400, send404, sendJson } from '../shared/router';
import type { ContainerAgentStore } from './container-agent-store';
import type { DevTunnelTokenService } from './devtunnel-token-service';
import type { ContainerAgentWithStatus } from './container-agent-types';

export interface ContainerAgentRoutesOptions {
    store: ContainerAgentStore;
    tokenService: DevTunnelTokenService;
}

async function checkAgentHealth(
    address: string,
    tunnelId: string | undefined,
    tokenService: DevTunnelTokenService,
): Promise<{ status: 'online' | 'offline'; lastHealthCheck: number }> {
    const lastHealthCheck = Date.now();
    try {
        const headers: Record<string, string> = {};
        if (tunnelId) {
            const tokenResult = await tokenService.getToken(tunnelId);
            if (tokenResult) {
                headers['X-Tunnel-Authorization'] = `TunnelAccessToken ${tokenResult.token}`;
            }
        }
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 5_000);
        const res = await fetch(`${address}/api/health`, {
            headers,
            signal: controller.signal,
        });
        clearTimeout(timeout);
        return { status: res.ok ? 'online' : 'offline', lastHealthCheck };
    } catch {
        return { status: 'offline', lastHealthCheck };
    }
}

export function registerContainerAgentRoutes(
    routes: Route[],
    options: ContainerAgentRoutesOptions,
): void {
    const { store, tokenService } = options;

    // List all agents with health status
    routes.push({
        method: 'GET',
        pattern: '/api/container/agents',
        handler: async (_req, res) => {
            const agents = store.list();
            const results: ContainerAgentWithStatus[] = await Promise.all(
                agents.map(async (agent) => {
                    const health = await checkAgentHealth(agent.address, agent.tunnelId, tokenService);
                    return { ...agent, ...health };
                }),
            );
            sendJson(res, results);
        },
    });

    // Add agent
    routes.push({
        method: 'POST',
        pattern: '/api/container/agents',
        handler: async (req, res) => {
            try {
                const agent = store.create(await readJsonBody(req));
                sendJson(res, agent, 201);
            } catch (error) {
                send400(res, error instanceof Error ? error.message : String(error));
            }
        },
    });

    // Update agent
    routes.push({
        method: 'PUT',
        pattern: /^\/api\/container\/agents\/([^/]+)$/,
        handler: async (req, res, match) => {
            const id = decodeURIComponent(match![1]);
            try {
                const updated = store.update(id, await readJsonBody(req));
                sendJson(res, updated);
            } catch (error) {
                const msg = error instanceof Error ? error.message : String(error);
                if (msg.includes('not found')) {
                    send404(res, msg);
                } else {
                    send400(res, msg);
                }
            }
        },
    });

    // Delete agent
    routes.push({
        method: 'DELETE',
        pattern: /^\/api\/container\/agents\/([^/]+)$/,
        handler: (_req, res, match) => {
            const id = decodeURIComponent(match![1]);
            const removed = store.remove(id);
            if (!removed) {
                send404(res, `Agent not found: ${id}`);
                return;
            }
            // Invalidate cached token if agent had one
            if (removed.tunnelId) {
                tokenService.invalidate(removed.tunnelId);
            }
            sendJson(res, { ok: true });
        },
    });
}
