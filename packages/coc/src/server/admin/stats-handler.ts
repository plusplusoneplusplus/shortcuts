/**
 * Token Usage Stats REST API Handler
 *
 * Provides GET /api/stats/token-usage, which aggregates per-day per-model
 * token consumption across all persisted processes.
 *
 * Pure Node.js; uses only built-ins.
 * Cross-platform compatible (Linux/Mac/Windows).
 */

import {
    aggregateTokenUsageStats,
    aggregateTurnPerformance,
    isTurnPerformanceGroupBy,
    serializeProcess,
    TURN_PERFORMANCE_GROUP_BY_VALUES,
} from '@plusplusoneplusplus/forge';
import type { TokenUsageStatsResponse, TurnPerformanceGroupBy } from '@plusplusoneplusplus/forge';
import type { ProcessStore } from '@plusplusoneplusplus/forge';
import { sendJson } from '../shared/router';
import type { Route } from '../types';
import type { TurnPerformanceStore } from '../storage/turn-performance-store';

/**
 * Register stats routes (token usage + turn performance) on the given route
 * table. Mutates the `routes` array in-place.
 *
 * @param routes - Shared route table
 * @param store  - Process store to read process history from
 * @param getTurnPerformanceStore - Late-bound accessor for the turn-performance
 *   metric store; when absent or returning undefined, the turn-performance
 *   route serves an empty aggregate instead of erroring.
 */
export function registerStatsRoutes(
    routes: Route[],
    store: ProcessStore,
    getTurnPerformanceStore?: () => TurnPerformanceStore | undefined,
): void {
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

    // ------------------------------------------------------------------
    // GET /api/stats/turn-performance — Aggregated TTFT/TPS statistics
    //
    // Query params:
    //   days=<n>          restrict to events started in the last n days
    //   groupBy=<dim>     repeatable or comma-separated; allowlisted dimensions
    //   firstTurnOnly=1   restrict to turn_index = 0 (new-session TTFT)
    //   processId=<id>    restrict to one process (per-session view)
    // ------------------------------------------------------------------
    routes.push({
        method: 'GET',
        pattern: '/api/stats/turn-performance',
        handler: async (req, res) => {
            try {
                const params = new URL(req.url!, 'http://localhost').searchParams;

                const rawDays = params.get('days');
                const days = rawDays !== null && /^\d+$/.test(rawDays) ? Number(rawDays) : undefined;

                // Repeated params and comma-separated values both work: the
                // coc-client transport joins array query values with commas.
                const rawGroupBy = params
                    .getAll('groupBy')
                    .flatMap((v) => v.split(','))
                    .map((v) => v.trim())
                    .filter((v) => v.length > 0);
                const invalid = rawGroupBy.find((v) => !isTurnPerformanceGroupBy(v));
                if (invalid !== undefined) {
                    sendJson(res, {
                        error: `Invalid groupBy "${invalid}". Valid dimensions: ${TURN_PERFORMANCE_GROUP_BY_VALUES.join(', ')}`,
                    }, 400);
                    return;
                }
                const groupBy = Array.from(new Set(rawGroupBy)) as TurnPerformanceGroupBy[];

                const firstTurnOnlyRaw = params.get('firstTurnOnly');
                const firstTurnOnly = firstTurnOnlyRaw === '1' || firstTurnOnlyRaw === 'true';
                const processId = params.get('processId') ?? undefined;

                const tpStore = getTurnPerformanceStore?.();
                const events = tpStore
                    ? tpStore.queryEvents({ days, processId, firstTurnOnly })
                    : [];
                sendJson(res, aggregateTurnPerformance(events, {
                    ...(groupBy.length > 0 ? { groupBy } : {}),
                    ...(days !== undefined ? { days } : {}),
                }));
            } catch (e) {
                sendJson(res, { error: (e as Error).message }, 500);
            }
        },
    });
}
