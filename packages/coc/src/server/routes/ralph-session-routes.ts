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

export interface RalphSessionRouteContext {
    /** Repo-scoped data root (`~/.coc` or override). */
    dataDir: string;
}

export function registerRalphSessionRoutes(routes: Route[], ctx: RalphSessionRouteContext): void {
    const { dataDir } = ctx;

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

            sendJSON(res, 200, { record, sections, files });
        },
    });
}
