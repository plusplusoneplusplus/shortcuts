/**
 * Prompt & Skill Discovery REST API Handler
 *
 * HTTP API routes for discovering .prompt.md files and skills
 * available in a workspace. Consumed by the SPA dashboard
 * to populate the "AI Actions" dropdown.
 *
 * No VS Code dependencies — uses only Node.js built-in modules
 * and pipeline-core exports.
 * Cross-platform compatible (Linux/Mac/Windows).
 */

import * as url from 'url';
import type { ProcessStore } from '@plusplusoneplusplus/pipeline-core';
import { findPromptFiles, findSkills } from '@plusplusoneplusplus/pipeline-core';
import { sendJSON, sendError } from './api-handler';
import type { Route } from './types';

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
 * Register prompt and skill discovery API routes on the given route table.
 * Mutates the `routes` array in-place.
 */
export function registerPromptRoutes(routes: Route[], store: ProcessStore): void {

    // ------------------------------------------------------------------
    // GET /api/workspaces/:id/prompts — Discover .prompt.md files
    // ------------------------------------------------------------------
    routes.push({
        method: 'GET',
        pattern: /^\/api\/workspaces\/([^/]+)\/prompts$/,
        handler: async (req, res, match) => {
            const id = decodeURIComponent(match![1]);
            const ws = await resolveWorkspace(store, id);
            if (!ws) {
                return sendError(res, 404, 'Workspace not found');
            }

            // Parse optional ?locations=folder1,folder2
            const parsed = url.parse(req.url || '/', true);
            const locationsParam = typeof parsed.query.locations === 'string'
                ? parsed.query.locations
                : '';
            const locations = locationsParam
                ? locationsParam.split(',').map(s => s.trim()).filter(Boolean)
                : undefined;  // undefined → findPromptFiles uses default ['.github/prompts']

            try {
                const prompts = await findPromptFiles(ws.rootPath, locations);
                sendJSON(res, 200, { prompts });
            } catch (err: any) {
                sendJSON(res, 200, {
                    prompts: [],
                    warning: 'Failed to scan prompts: ' + (err.message || 'Unknown error'),
                });
            }
        },
    });

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
