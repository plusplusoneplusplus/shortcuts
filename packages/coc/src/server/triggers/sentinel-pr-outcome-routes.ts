import type { Route } from '../shared/router';
import { sendError, sendJSON } from '../core/api-handler';
import { parseBodyOrReject } from '../shared/handler-utils';
import { SentinelPrOutcomeError, type SentinelPrOutcomeService } from './sentinel-pr-outcome-service';

const OUTCOMES = /^\/api\/workspaces\/([^/]+)\/sentinel-todos\/([^/]+)\/items\/([^/]+)\/pr-outcomes$/;
const CONTROL = /^\/api\/workspaces\/([^/]+)\/sentinel-todos\/([^/]+)\/items\/([^/]+)\/pr-outcomes\/(pause|resume|check)$/;

export function registerSentinelPrOutcomeRoutes(
    routes: Route[], service: SentinelPrOutcomeService | undefined, enabled: () => boolean,
): void {
    for (const method of ['GET', 'POST'] as const) routes.push({
        method, pattern: method === 'GET' ? OUTCOMES : CONTROL,
        handler: async (req, res, match) => {
            if (!enabled()) return sendError(res, 404, 'Sentinel PR outcome wake is disabled');
            if (!service) return sendError(res, 503, 'Native PR outcome monitoring is unavailable; enable triggers');
            const owner = { workspaceId: decodeURIComponent(match![1]), processId: decodeURIComponent(match![2]) };
            const itemId = decodeURIComponent(match![3]);
            try {
                if (method === 'GET') return sendJSON(res, 200, await service.list(owner, itemId));
                const body = await parseBodyOrReject(req, res);
                if (body === null) return;
                sendJSON(res, 200, await service.control(owner, itemId, match![4] as 'pause' | 'resume' | 'check', body));
            } catch (error) {
                if (error instanceof SentinelPrOutcomeError) return sendError(res, error.statusCode, error.message);
                // Owner service uses the ledger's not_found error for foreign or missing chats.
                if ((error as { code?: string })?.code === 'not_found') return sendError(res, 404, 'Owner-scoped Sentinel item not found');
                sendError(res, 500, 'PR outcome operation failed');
            }
        },
    });
}
