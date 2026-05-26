/**
 * Container Link Config Routes
 *
 * GET  /api/config/container — current container link status + config
 * PUT  /api/config/container — update container URL (connect/disconnect)
 */

import type { Route } from '../types';
import { readJsonBody, sendJson, send400 } from '../shared/router';
import type { ContainerLinkClient, ContainerLinkStatus } from './container-client';

export interface ContainerLinkStatusResponse {
    status: ContainerLinkStatus;
    containerUrl: string | null;
    agentId: string | null;
    agentName: string | null;
}

export interface ContainerLinkUpdateRequest {
    containerUrl?: string | null;
    agentName?: string;
}

export interface ContainerLinkRouteContext {
    getContainerLink: () => ContainerLinkClient | undefined;
    setContainerLink: (url: string, agentName?: string) => void;
    clearContainerLink: () => void;
    getContainerUrl: () => string | undefined;
    getAgentName: () => string | undefined;
}

export function registerContainerLinkRoutes(routes: Route[], ctx: ContainerLinkRouteContext): void {
    // GET /api/config/container
    routes.push({
        method: 'GET',
        pattern: '/api/config/container',
        handler: (_req, res) => {
            const link = ctx.getContainerLink();
            const response: ContainerLinkStatusResponse = {
                status: link?.status ?? 'disconnected',
                containerUrl: ctx.getContainerUrl() ?? null,
                agentId: link?.assignedAgentId ?? null,
                agentName: ctx.getAgentName() ?? null,
            };
            sendJson(res, response);
        },
    });

    // PUT /api/config/container
    routes.push({
        method: 'PUT',
        pattern: '/api/config/container',
        handler: async (req, res) => {
            const body = await readJsonBody(req) as ContainerLinkUpdateRequest | null;
            if (!body) {
                send400(res, 'Invalid JSON body');
                return;
            }

            if (body.containerUrl === null || body.containerUrl === '') {
                // Disconnect
                ctx.clearContainerLink();
                sendJson(res, { status: 'disconnected', containerUrl: null, agentId: null, agentName: null });
                return;
            }

            if (body.containerUrl) {
                ctx.setContainerLink(body.containerUrl, body.agentName);
                const link = ctx.getContainerLink();
                sendJson(res, {
                    status: link?.status ?? 'connecting',
                    containerUrl: body.containerUrl,
                    agentId: link?.assignedAgentId ?? null,
                    agentName: body.agentName ?? ctx.getAgentName() ?? null,
                });
                return;
            }

            // Just return current status
            const link = ctx.getContainerLink();
            sendJson(res, {
                status: link?.status ?? 'disconnected',
                containerUrl: ctx.getContainerUrl() ?? null,
                agentId: link?.assignedAgentId ?? null,
                agentName: ctx.getAgentName() ?? null,
            });
        },
    });
}
