/**
 * POST /api/workspaces/:workspaceId/ralph-sessions/:sessionId/resume
 *
 * Resumes a Ralph session that is stuck in `phase=executing` with no
 * in-flight task (i.e. the last iteration failed, was cancelled, or the
 * server crashed mid-loop). Re-enqueues the next iteration without
 * changing `maxIterations`.
 *
 * Contrast with `/continue` which extends a completed-at-cap session.
 */

import { sendJSON, sendError, parseBody } from '../core/api-handler';
import type { Route } from '../types';
import type { MultiRepoQueueRouter } from '../queue/multi-repo-queue-router';
import type { ProcessStore } from '@plusplusoneplusplus/forge';
import { getLogger, LogCategory } from '@plusplusoneplusplus/forge';
import { RalphSessionStore } from '../ralph/ralph-session-store';
import { buildRalphIterationTask } from '../ralph/enqueue-iteration';
import {
    findInFlightRalphTask,
    recoverIterationPaths,
} from './ralph-route-utils';

export interface RalphResumeRouteContext {
    bridge: MultiRepoQueueRouter;
    store: ProcessStore;
    dataDir: string;
}

export function registerRalphResumeRoutes(routes: Route[], ctx: RalphResumeRouteContext): void {
    const { bridge, store, dataDir } = ctx;

    routes.push({
        method: 'POST',
        pattern: /^\/api\/workspaces\/([^/]+)\/ralph-sessions\/([^/]+)\/resume$/,
        handler: async (req, res, match) => {
            const workspaceId = match?.[1] ? decodeURIComponent(match[1]) : undefined;
            const sessionId = match?.[2] ? decodeURIComponent(match[2]) : undefined;
            if (!workspaceId || !sessionId) {
                return sendError(res, 400, 'Missing workspaceId or sessionId');
            }

            // Accept but ignore an empty body for consistency with /continue.
            try { await parseBody(req); } catch { /* ignore */ }

            const journal = new RalphSessionStore({ dataDir });
            const record = await journal.readSessionRecord(workspaceId, sessionId);
            if (!record) {
                return sendError(res, 404, 'Ralph session not found');
            }

            if (record.phase !== 'executing') {
                return sendError(
                    res,
                    409,
                    `Session phase is "${record.phase}"; resume is only for stuck executing sessions`,
                );
            }

            if (record.currentIteration >= record.maxIterations) {
                return sendError(
                    res,
                    409,
                    'Session has reached its iteration cap; use /continue instead to extend the cap',
                );
            }

            const inFlight = findInFlightRalphTask(bridge, sessionId);
            if (inFlight) {
                return sendError(res, 409, `A Ralph task for this session is still ${inFlight.status}`);
            }

            const { workingDirectory, folderPath, provider, model, reasoningEffort } = await recoverIterationPaths(record, store, workspaceId);

            const nowIso = new Date().toISOString();
            try {
                await journal.appendResumeMarker(workspaceId, sessionId, record.currentIteration, nowIso);
            } catch (err) {
                getLogger().debug(
                    LogCategory.AI,
                    `[Ralph] appendResumeMarker failed for ${sessionId}: ${err instanceof Error ? err.message : String(err)}`,
                );
            }

            const nextIteration = record.currentIteration + 1;
            const loopIndex = record.loops?.[record.loops.length - 1]?.loopIndex
                ?? record.iterations[record.iterations.length - 1]?.loopIndex
                ?? 1;
            const taskInput = buildRalphIterationTask({
                workspaceId,
                workingDirectory,
                folderPath,
                sessionId,
                originalGoal: record.originalGoal,
                iteration: nextIteration,
                maxIterations: record.maxIterations,
                dataDir,
                extraContext: { ralph: { loopIndex } },
                provider,
                model,
                reasoningEffort,
            });

            let taskId: string;
            try {
                taskId = await bridge.enqueue(taskInput as any);
            } catch (err) {
                getLogger().warn(
                    LogCategory.AI,
                    `[Ralph] resume enqueue failed for ${sessionId}: ${err instanceof Error ? err.message : String(err)}`,
                );
                return sendError(res, 500, 'Failed to enqueue next iteration');
            }

            sendJSON(res, 200, {
                resumed: true,
                sessionId,
                workspaceId,
                taskId,
                nextIteration,
                maxIterations: record.maxIterations,
            });
        },
    });
}
