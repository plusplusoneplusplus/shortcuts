/**
 * POST /api/workspaces/:workspaceId/ralph-sessions/:sessionId/new-loop
 *
 * Starts a new goal-loop inside an existing Ralph session that reached
 * `RALPH_COMPLETE`. The session's `progress.md` (and therefore the full
 * iteration history) is inherited by the new loop — the agent resumes
 * with complete prior context at no extra cost.
 *
 * Contrast with `/continue`, which extends the budget for the *same* goal
 * when the session hit its iteration cap.
 */

import { sendJSON, sendError, parseBody } from '../core/api-handler';
import type { Route } from '../types';
import type { MultiRepoQueueRouter } from '../queue/multi-repo-queue-router';
import type { ProcessStore, QueuedTask } from '@plusplusoneplusplus/forge';
import { getLogger, LogCategory } from '@plusplusoneplusplus/forge';
import { RalphSessionStore } from '../ralph/ralph-session-store';
import { buildRalphIterationTask } from '../ralph/enqueue-iteration';
import { RALPH_DEFAULT_MAX_ITERATIONS, readRepoPreferences } from '../preferences-handler';

/** Hard cap on the resulting maxIterations after new-loop (shared with continue). */
export const RALPH_NEW_LOOP_HARD_CAP = 500;
/** Inclusive upper bound on a single `additionalIterations` request. */
export const RALPH_NEW_LOOP_ADDITIONAL_LIMIT = 200;

export interface RalphNewLoopRouteContext {
    bridge: MultiRepoQueueRouter;
    store: ProcessStore;
    /** Repo-scoped data root (`~/.coc` or override). */
    dataDir: string;
}

export function registerRalphNewLoopRoutes(routes: Route[], ctx: RalphNewLoopRouteContext): void {
    const { bridge, store, dataDir } = ctx;

    routes.push({
        method: 'POST',
        pattern: /^\/api\/workspaces\/([^/]+)\/ralph-sessions\/([^/]+)\/new-loop$/,
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

            // Validate required newGoal
            if (!body || typeof body.newGoal !== 'string' || body.newGoal.trim() === '') {
                return sendError(res, 400, 'Missing or empty field: newGoal');
            }
            const newGoal: string = body.newGoal;

            // Validate optional additionalIterations override
            let additionalIterations: number | undefined;
            if (body && Object.prototype.hasOwnProperty.call(body, 'additionalIterations')) {
                const raw = body.additionalIterations;
                if (typeof raw !== 'number'
                    || !Number.isFinite(raw)
                    || !Number.isInteger(raw)
                    || raw < 1
                    || raw > RALPH_NEW_LOOP_ADDITIONAL_LIMIT) {
                    return sendError(
                        res,
                        400,
                        `additionalIterations must be an integer between 1 and ${RALPH_NEW_LOOP_ADDITIONAL_LIMIT}`,
                    );
                }
                additionalIterations = raw;
            }

            const journal = new RalphSessionStore({ dataDir });
            const record = await journal.readSessionRecord(workspaceId, sessionId);
            if (!record) {
                return sendError(res, 404, 'Ralph session not found');
            }

            // Validate: only RALPH_COMPLETE sessions are eligible for a new loop.
            if (record.phase !== 'complete' || record.terminalReason !== 'RALPH_COMPLETE') {
                let detail: string;
                if (record.phase !== 'complete') {
                    detail = `Session phase is "${record.phase}"; new-loop requires RALPH_COMPLETE`;
                } else {
                    detail = 'Session was not marked RALPH_COMPLETE; use /continue or start a new session';
                }
                return sendError(res, 409, detail);
            }

            // Defensive guard: refuse if a task with this sessionId is still queued/running.
            const inFlight = findInFlightRalphTask(bridge, sessionId);
            if (inFlight) {
                return sendError(res, 409, `A Ralph task for this session is still ${inFlight.status}`);
            }

            // Resolve additional iterations: explicit body > per-repo pref > default
            let resolvedAdd = additionalIterations;
            if (resolvedAdd === undefined) {
                let prefMax: number | undefined;
                try {
                    prefMax = readRepoPreferences(dataDir, workspaceId).maxRalphIterations;
                } catch {
                    // Preferences are optional
                }
                resolvedAdd = prefMax ?? RALPH_DEFAULT_MAX_ITERATIONS;
            }

            const prospectiveMax = record.maxIterations + resolvedAdd;
            if (prospectiveMax > RALPH_NEW_LOOP_HARD_CAP) {
                return sendError(
                    res,
                    400,
                    `Resulting maxIterations (${prospectiveMax}) exceeds hard cap of ${RALPH_NEW_LOOP_HARD_CAP}`,
                );
            }

            // Atomically reset the session for the new loop. startNewLoop throws
            // with a .statusCode if ineligible (race guard — another caller may
            // have beaten us between our guard and this call).
            const nowIso = new Date().toISOString();
            let updated;
            try {
                updated = await journal.startNewLoop(workspaceId, sessionId, newGoal, resolvedAdd, nowIso);
            } catch (err: any) {
                const code: number = err?.statusCode ?? 500;
                const msg: string = err instanceof Error ? err.message : String(err);
                if (code === 404) return sendError(res, 404, msg);
                if (code === 409) return sendError(res, 409, msg);
                getLogger().warn(
                    LogCategory.AI,
                    `[Ralph] startNewLoop failed for ${sessionId}: ${msg}`,
                );
                return sendError(res, 500, 'Failed to start new loop');
            }

            // Determine the new loop index (last entry in loops[]).
            const loopIndex = updated.loops?.[updated.loops.length - 1]?.loopIndex ?? 2;
            const nextIteration = updated.currentIteration + 1;

            // Best-effort: recover workingDirectory / folderPath from the most
            // recent iteration's process, same as the continue route.
            let workingDirectory: string | undefined;
            let folderPath: string | undefined;
            const lastIter = [...record.iterations].sort((a, b) => b.iteration - a.iteration)[0];
            if (lastIter?.processId) {
                try {
                    const proc = await store.getProcess(lastIter.processId, workspaceId);
                    const procPayload = (proc as any)?.payload as Record<string, any> | undefined;
                    workingDirectory = procPayload?.workingDirectory
                        ?? procPayload?.folderPath
                        ?? (proc as any)?.workingDirectory;
                    folderPath = procPayload?.folderPath;
                } catch {
                    // Non-fatal
                }
            }

            const taskInput = buildRalphIterationTask({
                workspaceId,
                workingDirectory,
                folderPath,
                sessionId,
                originalGoal: newGoal,
                iteration: nextIteration,
                maxIterations: updated.maxIterations,
                dataDir,
            });

            let taskId: string;
            try {
                taskId = await bridge.enqueue(taskInput as any);
            } catch (err) {
                getLogger().warn(
                    LogCategory.AI,
                    `[Ralph] new-loop enqueue failed for ${sessionId}: ${err instanceof Error ? err.message : String(err)}`,
                );
                return sendError(res, 500, 'Failed to enqueue next iteration');
            }

            sendJSON(res, 200, {
                resumed: true,
                sessionId,
                workspaceId,
                loopIndex,
                taskId,
                nextIteration,
                newMaxIterations: updated.maxIterations,
            });
        },
    });
}

function findInFlightRalphTask(
    bridge: MultiRepoQueueRouter,
    sessionId: string,
): { id: string; status: string } | undefined {
    const queues = (bridge as any).registry?.getAllQueues?.() as Map<string, { getAll(): QueuedTask[] }> | undefined;
    if (!queues) return undefined;
    for (const manager of queues.values()) {
        for (const task of manager.getAll()) {
            const ralph = (task.payload as any)?.context?.ralph;
            if (ralph?.sessionId !== sessionId) continue;
            if (task.status === 'queued' || task.status === 'running') {
                return { id: task.id, status: task.status };
            }
        }
    }
    return undefined;
}
