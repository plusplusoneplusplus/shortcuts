/**
 * Skill Discovery REST API Handler
 *
 * HTTP API route for discovering skills available in a workspace.
 * Consumed by the SPA dashboard to populate the skill selection dialogs.
 *
 * No VS Code dependencies — uses only Node.js built-in modules
 * and pipeline-core exports.
 * Cross-platform compatible (Linux/Mac/Windows).
 */

import type { ProcessStore } from '@plusplusoneplusplus/pipeline-core';
import { findSkills } from '@plusplusoneplusplus/pipeline-core';
import { sendJSON, sendError } from '@plusplusoneplusplus/coc-server';
import type { Route } from '@plusplusoneplusplus/coc-server';

// ============================================================================
// Workspace resolution helper
// ============================================================================

async function resolveWorkspace(store: ProcessStore, id: string) {
    const workspaces = await store.getWorkspaces();
    return workspaces.find(w => w.id === id);
}

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
            const id = decodeURIComponent(match![1]);
            const ws = await resolveWorkspace(store, id);
            if (!ws) {
                return sendError(res, 404, 'Workspace not found');
            }

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
