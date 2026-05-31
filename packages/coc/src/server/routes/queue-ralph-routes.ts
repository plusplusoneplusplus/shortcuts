/**
 * Ralph-specific queue routes.
 *
 * POST /api/processes/:id/ralph-start — validate a completed grilling-phase
 * process, initialize the per-session journal, and enqueue the first Ralph
 * execution task.
 */

import { sendJSON, sendError, parseBody } from '../core/api-handler';
import type { Route } from '../types';
import type { MultiRepoQueueRouter } from '../queue/multi-repo-queue-router';
import type { ProcessStore } from '@plusplusoneplusplus/forge';
import { toQueueProcessId, isQueueProcessId, toTaskId, getLogger, LogCategory } from '@plusplusoneplusplus/forge';
import { getRalphContext } from '../tasks/task-types';
import { RalphSessionStore } from '../ralph/ralph-session-store';
import { buildRalphIterationPrompt } from '../ralph/iteration-prompt';
import { RALPH_DEFAULT_MAX_ITERATIONS, readRepoPreferences } from '../preferences-handler';

export interface QueueRalphRouteContext {
    bridge: MultiRepoQueueRouter;
    store: ProcessStore;
    /** Repo-scoped data root (`~/.coc` or override). Used for the per-session journal. */
    dataDir?: string;
}

export function registerRalphRoutes(routes: Route[], ctx: QueueRalphRouteContext): void {
    const { bridge, store, dataDir } = ctx;

    // ------------------------------------------------------------------
    // POST /api/processes/:id/ralph-start
    //
    // Validates that the referenced process is a completed grilling-phase
    // Ralph session, then enqueues the first Ralph execution task.
    // ------------------------------------------------------------------
    routes.push({
        method: 'POST',
        pattern: /^\/api\/processes\/([^/]+)\/ralph-start$/,
        handler: async (req, res, match) => {
            const rawId = match?.[1] ? decodeURIComponent(match[1]) : undefined;
            if (!rawId) return sendError(res, 400, 'Missing process ID');

            let body: any;
            try {
                body = await parseBody(req);
            } catch {
                return sendError(res, 400, 'Invalid JSON');
            }

            // Validate goalSpec
            const goalSpec = typeof body.goalSpec === 'string' ? body.goalSpec.trim() : '';
            if (!goalSpec) {
                return sendError(res, 400, 'Missing or empty field: goalSpec');
            }

            const workspaceId = typeof body.workspaceId === 'string' && body.workspaceId
                ? body.workspaceId
                : undefined;

            // Resolve process (handle queue_ prefix vs bare UUID)
            let proc = await store.getProcess(rawId, workspaceId);
            if (!proc && isQueueProcessId(rawId)) {
                proc = await store.getProcess(toTaskId(rawId), workspaceId);
            }
            if (!proc) {
                return sendError(res, 404, 'Process not found');
            }

            // Validate: must be completed
            if (proc.status !== 'completed') {
                return sendError(res, 400, 'Process is not completed');
            }

            // Validate: must be grilling phase
            const procPayload = (proc as any).payload as Record<string, any> | undefined;
            const ralphCtx = getRalphContext(proc);
            if (!ralphCtx || ralphCtx.phase !== 'grilling') {
                return sendError(res, 400, 'Process is not in grilling phase');
            }

            const wsId: string | undefined = workspaceId
                ?? procPayload?.workspaceId
                ?? (proc.metadata?.workspaceId as string | undefined);

            const workingDirectory: string | undefined =
                procPayload?.workingDirectory
                ?? procPayload?.folderPath
                ?? proc.workingDirectory;
            const folderPath: string | undefined = procPayload?.folderPath;
            // Resolution order: explicit context > per-repo preference > hardcoded default.
            let prefMax: number | undefined;
            if (dataDir && wsId) {
                try {
                    prefMax = readRepoPreferences(dataDir, wsId).maxRalphIterations;
                } catch {
                    // Preferences are optional
                }
            }
            const maxIterations = ralphCtx.maxIterations ?? prefMax ?? RALPH_DEFAULT_MAX_ITERATIONS;

            // Initialise the per-session journal (idempotent). Best-effort:
            // on failure we still enqueue — the bridge will create the file
            // lazily on the first iteration.
            if (dataDir && wsId && ralphCtx.sessionId) {
                try {
                    const journal = new RalphSessionStore({ dataDir });
                    await journal.initSession(wsId, ralphCtx.sessionId, {
                        originalGoal: goalSpec,
                        maxIterations,
                    });
                } catch (err) {
                    getLogger().debug(
                        LogCategory.AI,
                        `[Ralph] initSession failed for ${ralphCtx.sessionId}: ${err instanceof Error ? err.message : String(err)}`,
                    );
                }
            }

            // Enqueue the first Ralph execution task
            const taskId = await bridge.enqueue({
                type: 'chat',
                priority: 'normal',
                repoId: wsId,
                folderPath,
                payload: {
                    kind: 'chat',
                    mode: 'ralph',
                    prompt: buildRalphIterationPrompt({
                        originalGoal: goalSpec,
                        progressPath: (dataDir && wsId && ralphCtx.sessionId)
                            ? new RalphSessionStore({ dataDir }).getProgressPath(wsId, ralphCtx.sessionId)
                            : undefined,
                        currentIteration: 1,
                        maxIterations,
                    }),
                    workspaceId: wsId,
                    workingDirectory,
                    folderPath,
                    context: {
                        ralph: {
                            phase: 'executing',
                            sessionId: ralphCtx.sessionId,
                            originalGoal: goalSpec,
                            currentIteration: 1,
                            maxIterations,
                        },
                    },
                },
                config: {},
            });

            sendJSON(res, 200, { processId: toQueueProcessId(taskId) });
        },
    });
}
