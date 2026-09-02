/**
 * POST /api/workspaces/:workspaceId/ralph-sessions/:sessionId/max-iterations
 *
 * Sets a live Ralph session's total iteration cap to an absolute value.
 *
 * Unlike `/continue` this:
 *   - takes an absolute total, not a delta;
 *   - works while an iteration is queued or running (that is the point);
 *   - enqueues nothing and leaves `phase` / `completedAt` / `terminalReason`
 *     alone.
 *
 * Terminal sessions (`phase === 'complete'`) are rejected with 409 — they keep
 * the existing `/continue` semantics.
 */

import { sendJSON, sendError, parseBody } from '../core/api-handler';
import type { Route } from '../types';
import { getLogger, LogCategory } from '@plusplusoneplusplus/forge';
import { RalphSessionStore } from '../ralph/ralph-session-store';
import type { RalphSessionRecord } from '../ralph/types';
import { RALPH_RESUME_HARD_CAP } from './ralph-route-utils';

export interface RalphMaxIterationsRouteContext {
    /** Repo-scoped data root (`~/.coc` or override). */
    dataDir: string;
}

export type ParseMaxIterationsResult = { value: number } | { error: string };

/**
 * Validate the `maxIterations` body field: an integer in [1, hard cap].
 */
export function parseMaxIterations(body: unknown, hardCap: number): ParseMaxIterationsResult {
    const raw = (body && typeof body === 'object')
        ? (body as Record<string, unknown>).maxIterations
        : undefined;
    if (typeof raw !== 'number'
        || !Number.isFinite(raw)
        || !Number.isInteger(raw)
        || raw < 1
        || raw > hardCap) {
        return { error: `maxIterations must be an integer between 1 and ${hardCap}` };
    }
    return { value: raw };
}

export function registerRalphMaxIterationsRoutes(
    routes: Route[],
    ctx: RalphMaxIterationsRouteContext,
): void {
    const { dataDir } = ctx;

    routes.push({
        method: 'POST',
        pattern: /^\/api\/workspaces\/([^/]+)\/ralph-sessions\/([^/]+)\/max-iterations$/,
        handler: async (req, res, match) => {
            const workspaceId = match?.[1] ? decodeURIComponent(match[1]) : undefined;
            const sessionId = match?.[2] ? decodeURIComponent(match[2]) : undefined;
            if (!workspaceId || !sessionId) {
                return sendError(res, 400, 'Missing workspaceId or sessionId');
            }

            let body: any = {};
            try {
                body = await parseBody(req);
            } catch {
                body = {};
            }

            const parsed = parseMaxIterations(body, RALPH_RESUME_HARD_CAP);
            if ('error' in parsed) {
                return sendError(res, 400, parsed.error);
            }
            const maxIterations = parsed.value;

            const journal = new RalphSessionStore({ dataDir });
            const record = await journal.readSessionRecord(workspaceId, sessionId);
            if (!record) {
                return sendError(res, 404, 'Ralph session not found');
            }

            if (record.phase === 'complete') {
                return sendError(
                    res,
                    409,
                    'Session is already complete; use the continue action to add iterations',
                );
            }

            const previousMax = record.maxIterations;
            const nowIso = new Date().toISOString();
            let updated: RalphSessionRecord;
            try {
                updated = await journal.setMaxIterations(workspaceId, sessionId, maxIterations, nowIso);
            } catch (err) {
                getLogger().warn(
                    LogCategory.AI,
                    `[Ralph] setMaxIterations failed for ${sessionId}: ${err instanceof Error ? err.message : String(err)}`,
                );
                return sendError(res, 500, 'Failed to update Ralph session iteration cap');
            }

            try {
                await journal.appendMaxIterationsMarker(
                    workspaceId,
                    sessionId,
                    previousMax,
                    maxIterations,
                    nowIso,
                );
            } catch (err) {
                getLogger().debug(
                    LogCategory.AI,
                    `[Ralph] appendMaxIterationsMarker failed for ${sessionId}: ${err instanceof Error ? err.message : String(err)}`,
                );
            }

            sendJSON(res, 200, {
                updated: true,
                sessionId,
                workspaceId,
                previousMaxIterations: previousMax,
                maxIterations: updated.maxIterations,
                currentIteration: updated.currentIteration,
                phase: updated.phase,
            });
        },
    });
}
