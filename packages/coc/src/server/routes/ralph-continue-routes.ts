/**
 * POST /api/workspaces/:workspaceId/ralph-sessions/:sessionId/continue
 *
 * Extends a Ralph session that hit its iteration cap (terminalReason
 * `CAP_REACHED`, or `NO_SIGNAL` with `currentIteration === maxIterations`)
 * by N additional iterations. Same `sessionId`, same `progress.md` and
 * `session.json` — appends a continuation banner and enqueues iteration
 * `currentIteration + 1`.
 */

import { sendJSON, sendError, parseBody } from '../core/api-handler';
import type { Route } from '../types';
import type { MultiRepoQueueRouter } from '../queue/multi-repo-queue-router';
import type { ProcessStore } from '@plusplusoneplusplus/forge';
import { getLogger, LogCategory } from '@plusplusoneplusplus/forge';
import { RalphSessionStore } from '../ralph/ralph-session-store';
import type { RalphSessionRecord } from '../ralph/types';
import { buildRalphIterationTask } from '../ralph/enqueue-iteration';
import {
    findInFlightRalphTask,
    parseAdditionalIterations,
    recoverIterationPaths,
    resolveRalphAdditionalIterations,
    RALPH_RESUME_ADDITIONAL_LIMIT,
    RALPH_RESUME_HARD_CAP,
} from './ralph-route-utils';

export interface RalphContinueRouteContext {
    bridge: MultiRepoQueueRouter;
    store: ProcessStore;
    /** Repo-scoped data root (`~/.coc` or override). */
    dataDir: string;
}

export function isResumableTerminalState(record: RalphSessionRecord): boolean {
    if (record.phase !== 'complete') {
        return false;
    }
    if (record.terminalReason === 'CAP_REACHED') {
        return true;
    }
    if (record.terminalReason === 'NO_SIGNAL'
        && record.currentIteration >= record.maxIterations) {
        return true;
    }
    return false;
}

export function registerRalphContinueRoutes(routes: Route[], ctx: RalphContinueRouteContext): void {
    const { bridge, store, dataDir } = ctx;

    routes.push({
        method: 'POST',
        pattern: /^\/api\/workspaces\/([^/]+)\/ralph-sessions\/([^/]+)\/continue$/,
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
                // Empty body is allowed — `additionalIterations` is optional.
                body = {};
            }

            const additionalIterationsResult = parseAdditionalIterations(body, RALPH_RESUME_ADDITIONAL_LIMIT);
            if ('error' in additionalIterationsResult) {
                return sendError(res, 400, additionalIterationsResult.error);
            }
            const additionalIterations = additionalIterationsResult.value;

            const journal = new RalphSessionStore({ dataDir });
            const record = await journal.readSessionRecord(workspaceId, sessionId);
            if (!record) {
                return sendError(res, 404, 'Ralph session not found');
            }

            if (!isResumableTerminalState(record)) {
                let detail = 'Session is not in a resumable terminal state';
                if (record.phase !== 'complete') {
                    detail = `Session phase is "${record.phase}"; can only continue completed sessions`;
                } else if (record.terminalReason === 'RALPH_COMPLETE') {
                    detail = 'Session was marked RALPH_COMPLETE; start a new loop instead';
                } else if (record.terminalReason === 'CANCELLED') {
                    detail = 'Session was cancelled; start a new loop instead';
                } else if (record.terminalReason === 'NO_SIGNAL') {
                    detail = 'NO_SIGNAL session has not yet reached its iteration cap';
                }
                return sendError(res, 409, detail);
            }

            // Defensive guard: refuse if any task with this sessionId is still
            // queued or running (race protection).
            const inFlight = findInFlightRalphTask(bridge, sessionId);
            if (inFlight) {
                return sendError(res, 409, `A Ralph task for this session is still ${inFlight.status}`);
            }

            const resolvedAdd = resolveRalphAdditionalIterations(additionalIterations, dataDir, workspaceId);

            const newMax = record.maxIterations + resolvedAdd;
            if (newMax > RALPH_RESUME_HARD_CAP) {
                return sendError(
                    res,
                    400,
                    `Resulting maxIterations (${newMax}) exceeds hard cap of ${RALPH_RESUME_HARD_CAP}`,
                );
            }

            const { workingDirectory, folderPath } = await recoverIterationPaths(record, store, workspaceId);

            // Mutate session.json + append continuation marker. Order matters:
            // do the atomic record update first so concurrent continues lose
            // the phase guard (they will re-read phase=executing).
            const nowIso = new Date().toISOString();
            let updated: RalphSessionRecord;
            try {
                updated = await journal.extendSession(workspaceId, sessionId, resolvedAdd, nowIso);
            } catch (err) {
                getLogger().warn(
                    LogCategory.AI,
                    `[Ralph] extendSession failed for ${sessionId}: ${err instanceof Error ? err.message : String(err)}`,
                );
                return sendError(res, 500, 'Failed to extend Ralph session');
            }

            try {
                await journal.appendContinuationMarker(workspaceId, sessionId, newMax, nowIso);
            } catch (err) {
                getLogger().debug(
                    LogCategory.AI,
                    `[Ralph] appendContinuationMarker failed for ${sessionId}: ${err instanceof Error ? err.message : String(err)}`,
                );
            }

            const nextIteration = record.currentIteration + 1;
            const taskInput = buildRalphIterationTask({
                workspaceId,
                workingDirectory,
                folderPath,
                sessionId,
                originalGoal: record.originalGoal,
                iteration: nextIteration,
                maxIterations: newMax,
                dataDir,
            });

            let taskId: string;
            try {
                taskId = await bridge.enqueue(taskInput as any);
            } catch (err) {
                getLogger().warn(
                    LogCategory.AI,
                    `[Ralph] continue enqueue failed for ${sessionId}: ${err instanceof Error ? err.message : String(err)}`,
                );
                return sendError(res, 500, 'Failed to enqueue next iteration');
            }

            sendJSON(res, 200, {
                resumed: true,
                sessionId,
                workspaceId,
                taskId,
                nextIteration,
                newMaxIterations: updated.maxIterations,
            });
        },
    });
}
