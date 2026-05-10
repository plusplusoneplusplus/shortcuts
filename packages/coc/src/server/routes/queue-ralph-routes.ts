/**
 * Ralph-specific queue routes.
 *
 * POST /api/processes/:id/ralph-start — validate a completed grilling-phase
 * process and enqueue the first Ralph execution task.
 */

import { sendJSON, sendError, parseBody } from '../core/api-handler';
import type { Route } from '../types';
import type { MultiRepoQueueRouter } from '../queue/multi-repo-queue-router';
import type { ProcessStore } from '@plusplusoneplusplus/forge';
import { toQueueProcessId, isQueueProcessId, toTaskId } from '@plusplusoneplusplus/forge';
import { getRalphContext } from '../tasks/task-types';

export interface QueueRalphRouteContext {
    bridge: MultiRepoQueueRouter;
    store: ProcessStore;
}

export function registerRalphRoutes(routes: Route[], ctx: QueueRalphRouteContext): void {
    const { bridge, store } = ctx;

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

            // Enqueue the first Ralph execution task
            const taskId = await bridge.enqueue({
                type: 'chat',
                priority: 'normal',
                repoId: wsId,
                folderPath,
                payload: {
                    kind: 'chat',
                    mode: 'ralph',
                    prompt: 'Begin Ralph execution loop.',
                    workspaceId: wsId,
                    workingDirectory,
                    folderPath,
                    context: {
                        ralph: {
                            phase: 'executing',
                            sessionId: ralphCtx.sessionId,
                            originalGoal: goalSpec,
                            currentIteration: 1,
                            maxIterations: ralphCtx.maxIterations ?? 10,
                        },
                    },
                },
                config: {},
            });

            sendJSON(res, 200, { processId: toQueueProcessId(taskId) });
        },
    });
}
