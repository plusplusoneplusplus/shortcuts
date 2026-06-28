/**
 * Token Usage Stats REST API Handler
 *
 * Provides GET /api/stats/token-usage, which aggregates per-day per-model
 * token consumption across all persisted processes.
 *
 * Pure Node.js; uses only built-ins.
 * Cross-platform compatible (Linux/Mac/Windows).
 */

import { aggregateTokenUsageStats, serializeProcess } from '@plusplusoneplusplus/forge';
import type { TokenUsageStatsResponse } from '@plusplusoneplusplus/forge';
import type { ProcessStore } from '@plusplusoneplusplus/forge';
import { sendJson } from '../shared/router';
import type { Route } from '../types';

/**
 * Register token-usage stats routes on the given route table.
 * Mutates the `routes` array in-place.
 *
 * @param routes - Shared route table
 * @param store  - Process store to read process history from
 */
export function registerStatsRoutes(routes: Route[], store: ProcessStore): void {
    // ------------------------------------------------------------------
    // GET /api/stats/token-usage — Return aggregated token usage stats
    // ------------------------------------------------------------------
    routes.push({
        method: 'GET',
        pattern: '/api/stats/token-usage',
        handler: async (req, res) => {
            try {
                const params = new URL(req.url!, 'http://localhost').searchParams;
                const rawDays = params.get('days');
                const days = rawDays !== null && /^\d+$/.test(rawDays) ? Number(rawDays) : undefined;

                const processes = await store.getAllProcesses({ exclude: ['conversation'] });
                const serialized = processes.map(serializeProcess);
                const result: TokenUsageStatsResponse = aggregateTokenUsageStats(
                    serialized,
                    days !== undefined ? { days } : {}
                );
                sendJson(res, result);
            } catch (e) {
                sendJson(res, { error: (e as Error).message }, 500);
            }
        },
    });
}
