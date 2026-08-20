/**
 * POST /api/workspaces/:workspaceId/ralph-sessions/:sessionId/submit-pr
 *
 * Publishes the commits produced by a completed Ralph session as a GitHub
 * pull request. Appends a new record to `submits[]` in `session.json` and
 * enqueues an autopilot submit job attached to the session (same pattern as
 * final-check). Allowed for ANY `phase === 'complete'` session regardless of
 * `terminalReason`. Multiple submits over a session's lifetime are allowed —
 * each request appends a record with the next `submitIndex`.
 *
 * The job is enqueued with the workspace default provider/model — no
 * AI-selection payload. This route never touches git branches; the only
 * branch manipulation happens inside the submit skill's script, driven by
 * the enqueued agent.
 */

import { sendJSON, sendError } from '../core/api-handler';
import type { Route } from '../types';
import type { MultiRepoQueueRouter } from '../queue/multi-repo-queue-router';
import type { ProcessStore } from '@plusplusoneplusplus/forge';
import { getLogger, LogCategory } from '@plusplusoneplusplus/forge';
import { RalphSessionStore } from '../ralph/ralph-session-store';
import {
    buildSubmitTaskPayload,
    findActiveSubmit,
    markSubmitEnqueued,
    nextSubmitIndex,
    unmarkSubmitEnqueued,
    wasSubmitEnqueued,
} from '../ralph/enqueue-submit';
import { findInFlightRalphTask, recoverIterationPaths } from './ralph-route-utils';

export interface RalphSubmitRouteContext {
    bridge: MultiRepoQueueRouter;
    store: ProcessStore;
    /** Repo-scoped data root (`~/.coc` or override). */
    dataDir: string;
}

export function registerRalphSubmitRoutes(routes: Route[], ctx: RalphSubmitRouteContext): void {
    const { bridge, store, dataDir } = ctx;

    routes.push({
        method: 'POST',
        pattern: /^\/api\/workspaces\/([^/]+)\/ralph-sessions\/([^/]+)\/submit-pr$/,
        handler: async (req, res, match) => {
            const workspaceId = match?.[1] ? decodeURIComponent(match[1]) : undefined;
            const sessionId = match?.[2] ? decodeURIComponent(match[2]) : undefined;
            if (!workspaceId || !sessionId) {
                return sendError(res, 400, 'Missing workspaceId or sessionId');
            }

            const journal = new RalphSessionStore({ dataDir });
            const record = await journal.readSessionRecord(workspaceId, sessionId);
            if (!record) {
                return sendError(res, 404, 'Ralph session not found');
            }

            if (record.phase !== 'complete') {
                return sendError(
                    res,
                    409,
                    `Session phase is "${record.phase}"; can only submit a PR for completed sessions`,
                );
            }

            // Defensive guard: refuse while any task with this sessionId is
            // still queued or running (iterations, final checks, or a prior
            // submit still in the queue).
            const inFlight = findInFlightRalphTask(bridge, sessionId);
            if (inFlight) {
                return sendError(res, 409, `A Ralph task for this session is still ${inFlight.status}`);
            }

            const activeSubmit = findActiveSubmit(record);
            if (activeSubmit) {
                return sendError(
                    res,
                    409,
                    `A PR submit for this session is already ${activeSubmit.status} (submit ${activeSubmit.submitIndex})`,
                );
            }

            const submitIndex = nextSubmitIndex(record);

            // In-memory race guard: two concurrent requests both pass the
            // persisted checks before either writes its queued record.
            if (wasSubmitEnqueued(sessionId, submitIndex)) {
                return sendError(res, 409, `PR submit ${submitIndex} is already being enqueued`);
            }
            markSubmitEnqueued(sessionId, submitIndex);

            const { workingDirectory, folderPath } = await recoverIterationPaths(record, store, workspaceId);

            const taskInput = buildSubmitTaskPayload({
                workspaceId,
                sessionId,
                originalGoal: record.originalGoal,
                submitIndex,
                progressPath: journal.getProgressPath(workspaceId, sessionId),
                baselineSha: record.baselineSha,
                sessionStartedAt: record.startedAt,
                sessionCompletedAt: record.completedAt,
                workingDirectory,
                folderPath,
            });

            let taskId: string;
            try {
                taskId = await bridge.enqueue(taskInput as any);
            } catch (err) {
                unmarkSubmitEnqueued(sessionId, submitIndex);
                getLogger().warn(
                    LogCategory.AI,
                    `[Ralph] submit-pr enqueue failed for ${sessionId}: ${err instanceof Error ? err.message : String(err)}`,
                );
                return sendError(res, 500, 'Failed to enqueue PR submit');
            }

            try {
                await journal.upsertSubmitRecord(workspaceId, sessionId, submitIndex, {
                    status: 'queued',
                    taskId,
                    startedAt: new Date().toISOString(),
                });
            } catch (err) {
                getLogger().warn(
                    LogCategory.AI,
                    `[Ralph] submit-pr record persist failed for ${sessionId}: ${err instanceof Error ? err.message : String(err)}`,
                );
                return sendError(res, 500, 'PR submit enqueued but failed to persist its record');
            }

            sendJSON(res, 200, {
                submitted: true,
                sessionId,
                taskId,
                submitIndex,
            });
        },
    });
}
