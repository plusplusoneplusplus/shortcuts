import type * as http from 'http';
import { sendError, sendJSON } from '../core/api-handler';
import type { Route } from '../types';
import type { SentinelCheckNowResult } from './sentinel-cron';

export interface SentinelRouteContext {
    checkNow: (workspaceId: string) => Promise<SentinelCheckNowResult>;
}

export function registerSentinelRoutes(routes: Route[], context: SentinelRouteContext): void {
    routes.push({
        method: 'POST',
        pattern: /^\/api\/workspaces\/([^/]+)\/sentinel\/check-now$/,
        handler: async (_req: http.IncomingMessage, res: http.ServerResponse, match) => {
            const workspaceId = decodeURIComponent(match![1]);
            const result = await context.checkNow(workspaceId);
            if (result.status === 'not-found') {
                return sendError(res, 404, 'No active Sentinel found for this workspace');
            }
            if (result.status === 'not-ready') {
                return sendError(res, 409, 'The Sentinel scan schedule is not active');
            }
            if (result.status === 'busy') {
                return sendError(res, 409, 'The Sentinel is already running');
            }
            sendJSON(res, 202, result);
        },
    });
}
