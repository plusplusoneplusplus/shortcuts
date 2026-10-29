/**
 * GET /api/workspaces/:id/history — paginated list of completed/failed/cancelled
 * processes mapped to the canonical ProcessHistoryItem shape. `unseen=true`
 * restricts the list to unread rows.
 */

import { URL } from 'url';
import type { ProcessFilter, ProcessStore } from '@plusplusoneplusplus/forge';
import { sendJSON } from '../core/api-handler';
import { toProcessHistoryItem } from '../shared/process-history-item';
import type { Route } from '../types';

const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 200;

export function registerProcessHistoryRoutes(
    routes: Route[],
    store: ProcessStore & { getSeenMap?: (workspaceId: string) => Record<string, string> },
    botManagedConversationsEnabled?: () => boolean,
): void {
    routes.push({
        method: 'GET',
        pattern: /^\/api\/workspaces\/([^/]+)\/history$/,
        handler: async (req, res, match) => {
            const workspaceId = decodeURIComponent(match![1]);
            const botControlEnabled = botManagedConversationsEnabled?.() === true;

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
            // `unseen=true` pages over unread rows only: completed rows whose seen
            // stamp differs from their completion time, matching the SPA's rule.
            // Bulk read uses it instead of walking the full history page by page.
            const unseenOnly = url.searchParams.get('unseen') === 'true';
            const seenMap = store.getSeenMap?.(workspaceId) ?? {};

            // Exclude conversation turns entirely — the history list view does
            // not display per-turn data. Loading turns for every history entry
            // (N+1 queries) is the dominant cost when scrolling history.
            const filter: ProcessFilter = {
                workspaceId,
                status: ['completed', 'failed', 'cancelled'],
                exclude: ['conversation'],
                type: typeFilter as ProcessFilter['type'],
            };
            const processes = unseenOnly
                ? (await store.getAllProcesses(filter))
                    .filter(proc => proc.endTime && seenMap[proc.id] !== new Date(proc.endTime).toISOString())
                    .slice(parsedOffset, parsedOffset + limit + 1)
                : await store.getAllProcesses({ ...filter, limit: limit + 1, offset: parsedOffset });

            const hasMore = processes.length > limit;
            const page = processes.slice(0, limit);

            const history = page.map(proc => toProcessHistoryItem(proc, seenMap[proc.id], botControlEnabled));

            sendJSON(res, 200, { history, hasMore, offset: parsedOffset, limit });
        },
    });
}
