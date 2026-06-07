import type { Route } from '../types';
import { sendJSON } from '../core/api-handler';
import { badRequest, handleAPIError, missingFields, notFound } from '../errors';
import { parseBodyOrReject } from '../shared/handler-utils';
import type { ApiRouteContext } from './api-shared';

function readNonEmptyString(value: unknown): string | undefined {
    return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

export function registerDashboardActiveWorkspaceRoutes(ctx: ApiRouteContext): void {
    const { routes, store, activeWorkspaceTracker } = ctx;

    const tracker = activeWorkspaceTracker;
    if (!tracker) {
        throw new Error('activeWorkspaceTracker is required');
    }

    const routeDefinitions: Route[] = [
        {
            method: 'GET',
            pattern: '/api/workspaces/active',
            handler: async (_req, res) => {
                sendJSON(res, 200, tracker.getSnapshot());
            },
        },
        {
            method: 'POST',
            pattern: '/api/workspaces/active',
            handler: async (req, res) => {
                const body = await parseBodyOrReject(req, res);
                if (body === null) return;

                const clientId = readNonEmptyString(body.clientId);
                if (!clientId) {
                    return handleAPIError(res, missingFields(['clientId']));
                }

                if (!Object.prototype.hasOwnProperty.call(body, 'workspaceId')) {
                    return handleAPIError(res, missingFields(['workspaceId']));
                }

                if (body.workspaceId === null) {
                    sendJSON(res, 200, tracker.reportActiveWorkspace({ clientId, workspaceId: null }));
                    return;
                }

                const workspaceId = readNonEmptyString(body.workspaceId);
                if (!workspaceId) {
                    return handleAPIError(res, badRequest('workspaceId must be a non-empty string or null'));
                }

                const workspaces = await store.getWorkspaces();
                if (!workspaces.some(workspace => workspace.id === workspaceId)) {
                    return handleAPIError(res, notFound('Workspace'));
                }

                sendJSON(res, 200, tracker.reportActiveWorkspace({ clientId, workspaceId }));
            },
        },
    ];

    routes.push(...routeDefinitions);
}

