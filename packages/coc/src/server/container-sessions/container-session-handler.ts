/**
 * Container Session Handler
 *
 * REST API routes for container sessions:
 *   POST   /api/container/sessions          — Create a new container session
 *   GET    /api/container/sessions           — List container sessions
 *   GET    /api/container/sessions/:id       — Get session detail with turns
 *   POST   /api/container/sessions/:id/message — Send a message (triggers routing)
 *   PATCH  /api/container/sessions/:id/routing — Set/clear routing override
 *   DELETE /api/container/sessions/:id       — Delete a container session
 */

import { randomBytes } from 'crypto';
import type { Route } from '../types';
import { sendJson, readBody, sendError } from '../shared/router';
import type { ContainerSessionStore } from './container-session-store';
import type { RoutingClassifierDeps } from './routing-classifier';
import type { ContainerAgentInfo, RoutingDecision } from './container-session-types';
import { classifyRouting } from './routing-classifier';

// ============================================================================
// Types
// ============================================================================

export interface ContainerSessionRouteOptions {
    store: ContainerSessionStore;
    classifierDeps: RoutingClassifierDeps;
    /** Returns available agents and their workspaces for routing. */
    getAgents: () => Promise<ContainerAgentInfo[]>;
    /** Forwards a message to a specific agent's queue. Returns downstream process ID. */
    forwardMessage: (agentId: string, workspaceId: string, message: string, existingProcessId?: string | null) => Promise<string>;
}

// ============================================================================
// Route Registration
// ============================================================================

export function registerContainerSessionRoutes(
    routes: Route[],
    options: ContainerSessionRouteOptions,
): void {
    const { store, classifierDeps, getAgents, forwardMessage } = options;

    // POST /api/container/sessions — create session
    routes.push({
        method: 'POST',
        pattern: '/api/container/sessions',
        handler: (_req, res) => {
            const id = `csess_${randomBytes(8).toString('hex')}`;
            const session = store.create(id);
            sendJson(res, session, 201);
        },
    });

    // GET /api/container/sessions — list sessions
    routes.push({
        method: 'GET',
        pattern: '/api/container/sessions',
        handler: (req, res) => {
            const url = new URL(req.url ?? '', 'http://localhost');
            const limit = parseInt(url.searchParams.get('limit') ?? '50', 10);
            const offset = parseInt(url.searchParams.get('offset') ?? '0', 10);
            const sessions = store.list(limit, offset);
            sendJson(res, sessions);
        },
    });

    // GET /api/container/sessions/:id — get session detail
    routes.push({
        method: 'GET',
        pattern: /^\/api\/container\/sessions\/([^/]+)$/,
        handler: (_req, res, match) => {
            const id = decodeURIComponent(match![1]);
            const session = store.get(id);
            if (!session) return sendError(res, 404, 'Session not found');
            sendJson(res, session);
        },
    });

    // POST /api/container/sessions/:id/message — send message
    routes.push({
        method: 'POST',
        pattern: /^\/api\/container\/sessions\/([^/]+)\/message$/,
        handler: async (req, res, match) => {
            try {
                const id = decodeURIComponent(match![1]);
                const session = store.get(id);
                if (!session) return sendError(res, 404, 'Session not found');
                if (session.status === 'closed') return sendError(res, 400, 'Session is closed');

                const body = await readBody(req);
                const { content } = JSON.parse(body);
                if (!content || typeof content !== 'string') {
                    return sendError(res, 400, 'content is required');
                }

                // Classify routing
                const agents = await getAgents();
                const routing: RoutingDecision = await classifyRouting(
                    {
                        agents,
                        history: session.turns,
                        message: content,
                        override: session.routingOverride,
                    },
                    classifierDeps,
                );

                // Find existing downstream process for this agent:workspace
                const existingProcessId = findExistingDownstreamProcess(session.turns, routing);

                // Forward message to target agent
                const downstreamProcessId = await forwardMessage(
                    routing.agentId,
                    routing.workspaceId,
                    content,
                    existingProcessId,
                );

                // Record user turn
                const turnIndex = session.turns.length;
                const userTurn = {
                    index: turnIndex,
                    role: 'user' as const,
                    content,
                    routing,
                    downstreamProcessId,
                    timestamp: new Date().toISOString(),
                };
                store.addTurn(id, userTurn);

                sendJson(res, {
                    turn: userTurn,
                    routing,
                    downstreamProcessId,
                });
            } catch (err: any) {
                sendError(res, 500, err.message ?? 'Internal error');
            }
        },
    });

    // PATCH /api/container/sessions/:id/routing — set/clear override
    routes.push({
        method: 'PATCH',
        pattern: /^\/api\/container\/sessions\/([^/]+)\/routing$/,
        handler: async (req, res, match) => {
            try {
                const id = decodeURIComponent(match![1]);
                const session = store.get(id);
                if (!session) return sendError(res, 404, 'Session not found');

                const body = await readBody(req);
                const { agentId, workspaceId } = JSON.parse(body);

                const override = agentId && workspaceId
                    ? { agentId, workspaceId }
                    : null;

                store.setRoutingOverride(id, override);
                sendJson(res, { routingOverride: override });
            } catch (err: any) {
                sendError(res, 500, err.message ?? 'Internal error');
            }
        },
    });

    // DELETE /api/container/sessions/:id — delete session
    routes.push({
        method: 'DELETE',
        pattern: /^\/api\/container\/sessions\/([^/]+)$/,
        handler: (_req, res, match) => {
            const id = decodeURIComponent(match![1]);
            const deleted = store.delete(id);
            if (!deleted) return sendError(res, 404, 'Session not found');
            res.writeHead(204);
            res.end();
        },
    });
}

// ============================================================================
// Helpers
// ============================================================================

function findExistingDownstreamProcess(
    turns: Array<{ routing: RoutingDecision; downstreamProcessId: string | null }>,
    routing: RoutingDecision,
): string | null {
    for (let i = turns.length - 1; i >= 0; i--) {
        const t = turns[i];
        if (t.routing.agentId === routing.agentId && t.routing.workspaceId === routing.workspaceId && t.downstreamProcessId) {
            return t.downstreamProcessId;
        }
    }
    return null;
}
