import { URL } from 'url';
import type { ProcessStore } from '@plusplusoneplusplus/forge';
import { sendJSON } from './api-handler';
import { toProcessHistoryItem } from './shared/process-history-item';
import type { Route } from './types';

const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 200;

export function registerProcessHistoryRoutes(
    routes: Route[],
    store: ProcessStore & {
        getSeenMap?: (workspaceId: string) => Record<string, string>;
        getProcessTurnStats?: (ids: string[]) => Map<string, { turnCount: number; lastTimestamp: string | null }>;
    },
): void {
    routes.push({
        method: 'GET',
        pattern: /^\/api\/workspaces\/([^/]+)\/history$/,
        handler: async (req, res, match) => {
            const workspaceId = decodeURIComponent(match![1]);

            // Parse query parameters
            const url = new URL(req.url!, `http://${req.headers.host ?? 'localhost'}`);
            const typeFilter = url.searchParams.get('type') ?? undefined;

            const rawLimit = url.searchParams.get('limit');
            const rawOffset = url.searchParams.get('offset');

            const parsedLimit = rawLimit != null ? Number(rawLimit) : DEFAULT_LIMIT;
            const parsedOffset = rawOffset != null ? Number(rawOffset) : 0;

            if (!Number.isFinite(parsedLimit) || parsedLimit < 0) {
                sendJSON(res, 400, { error: 'Invalid "limit" parameter' });
                return;
            }
            if (!Number.isFinite(parsedOffset) || parsedOffset < 0) {
                sendJSON(res, 400, { error: 'Invalid "offset" parameter' });
                return;
            }

            const limit = Math.min(parsedLimit, MAX_LIMIT);

            const processes = await store.getAllProcesses({
                workspaceId,
                status: ['completed', 'failed', 'cancelled'],
                exclude: ['toolCalls', 'conversation'],
                type: typeFilter as any,
                limit: limit + 1,
                offset: parsedOffset,
            });

            const hasMore = processes.length > limit;
            const page = processes.slice(0, limit);

            // Fetch turn stats in one aggregated query instead of N per-process queries
            const turnStatsMap = store.getProcessTurnStats?.(page.map(p => p.id));

            const seenMap = store.getSeenMap?.(workspaceId) ?? {};
            const history = page.map(proc => toProcessHistoryItem(
                proc,
                seenMap[proc.id],
                turnStatsMap?.get(proc.id),
            ));

            sendJSON(res, 200, { history, hasMore, offset: parsedOffset, limit });
        },
    });
}
