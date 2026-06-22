/**
 * Ralph session journal read routes.
 *
 * GET /api/workspaces/:workspaceId/ralph-sessions/:sessionId
 *   Returns the per-session record (`session.json`) plus the parsed
 *   `progress.md` sections and raw session-folder files for SPA rendering.
 *
 * 404 when the session directory does not yet exist.
 */

import { sendJSON, sendError } from '../core/api-handler';
import type { Route } from '../types';
import { RalphSessionStore } from '../ralph/ralph-session-store';
import type { ProcessStore } from '@plusplusoneplusplus/forge';
import type { MultiRepoQueueRouter } from '../queue/multi-repo-queue-router';
import { findInFlightRalphTask, recoverIterationPaths } from './ralph-route-utils';

export interface RalphSessionRouteContext {
    /** Repo-scoped data root (`~/.coc` or override). */
    dataDir: string;
    /** Optional process store used to recover transient Resume AI defaults. */
    store?: ProcessStore;
    /** Queue router used to detect whether a Ralph task is still in flight. */
    bridge: MultiRepoQueueRouter;
}

export function registerRalphSessionRoutes(routes: Route[], ctx: RalphSessionRouteContext): void {
    const { dataDir, store: processStore, bridge } = ctx;

    routes.push({
        method: 'GET',
        pattern: /^\/api\/workspaces\/([^/]+)\/ralph-sessions\/([^/]+)$/,
        handler: async (_req, res, match) => {
            const workspaceId = match?.[1] ? decodeURIComponent(match[1]) : undefined;
            const sessionId = match?.[2] ? decodeURIComponent(match[2]) : undefined;
            if (!workspaceId || !sessionId) {
                return sendError(res, 400, 'Missing workspaceId or sessionId');
            }

            const store = new RalphSessionStore({ dataDir });

            const record = await store.readSessionRecord(workspaceId, sessionId);
            if (!record) {
                return sendError(res, 404, 'Ralph session not found');
            }

            const progressMd = await store.readProgress(workspaceId, sessionId);
            const sections = progressMd ? RalphSessionStore.parseProgressSections(progressMd) : [];
            const files = await store.readSessionFiles(workspaceId, sessionId);
            const resumeDefaults = processStore
                ? compactResumeDefaults(await recoverIterationPaths(record, processStore, workspaceId))
                : undefined;
            // Authoritative "is the loop actually live" signal. The session
            // record alone cannot tell a healthy in-progress session from one
            // wedged in phase=executing, because iterations are only persisted
            // on completion: a running first iteration looks identical to a
            // cancelled one (currentIteration=0, iterations=[]). The SPA gates
            // the stuck-session Resume control on this instead of the iteration
            // counter.
            const hasInFlightTask = !!findInFlightRalphTask(bridge, sessionId);

            sendJSON(res, 200, {
                record,
                sections,
                files,
                hasInFlightTask,
                ...(resumeDefaults ? { resumeDefaults } : {}),
            });
        },
    });
}

function compactResumeDefaults(recovered: Awaited<ReturnType<typeof recoverIterationPaths>>) {
    const result = {
        ...(recovered.provider ? { provider: recovered.provider } : {}),
        ...(recovered.model ? { model: recovered.model } : {}),
        ...(recovered.reasoningEffort ? { reasoningEffort: recovered.reasoningEffort } : {}),
    };
    return Object.keys(result).length > 0 ? result : undefined;
}
