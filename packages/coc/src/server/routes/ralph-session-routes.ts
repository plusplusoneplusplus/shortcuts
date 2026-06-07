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
import { recoverIterationPaths } from './ralph-route-utils';

export interface RalphSessionRouteContext {
    /** Repo-scoped data root (`~/.coc` or override). */
    dataDir: string;
    /** Optional process store used to recover transient Resume AI defaults. */
    store?: ProcessStore;
}

export function registerRalphSessionRoutes(routes: Route[], ctx: RalphSessionRouteContext): void {
    const { dataDir, store: processStore } = ctx;

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

            sendJSON(res, 200, {
                record,
                sections,
                files,
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
