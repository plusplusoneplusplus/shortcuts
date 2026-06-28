/**
 * Skill Discovery REST API Handler
 *
 * HTTP API route for discovering skills available in a workspace.
 * Consumed by the SPA dashboard to populate the skill selection dialogs.
 *
 * Pure Node.js — uses only Node.js built-in modules
 * and pipeline-core exports.
 * Cross-platform compatible (Linux/Mac/Windows).
 */

import type { ProcessStore } from '@plusplusoneplusplus/forge';
import { findSkills } from '@plusplusoneplusplus/forge';
import { sendJSON } from '../core/api-handler';
import { resolveWorkspaceOrFail } from '../shared/handler-utils';
import type { Route } from '../types';

// ============================================================================
// Route Registration
// ============================================================================

/**
 * Register skill discovery API routes on the given route table.
 * Mutates the `routes` array in-place.
 */
export function registerPromptRoutes(routes: Route[], store: ProcessStore): void {

    // ------------------------------------------------------------------
    // GET /api/workspaces/:id/skills — Discover skills
    // ------------------------------------------------------------------
    routes.push({
        method: 'GET',
        pattern: /^\/api\/workspaces\/([^/]+)\/skills$/,
        handler: async (_req, res, match) => {
            const ws = await resolveWorkspaceOrFail(store, match!, res);
            if (!ws) return;

            try {
                const skills = await findSkills(ws.rootPath);
                sendJSON(res, 200, { skills });
            } catch (err: any) {
                sendJSON(res, 200, {
                    skills: [],
                    warning: 'Failed to discover skills: ' + (err.message || 'Unknown error'),
                });
            }
        },
    });
}
