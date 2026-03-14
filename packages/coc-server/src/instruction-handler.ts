/**
 * Per-Repo Instruction Files REST API Handler
 *
 * CRUD endpoints for managing .github/coc/instructions*.md files
 * inside a workspace repository.
 *
 * Routes:
 *   GET    /api/workspaces/:id/instructions         — list all files with content
 *   GET    /api/workspaces/:id/instructions/:mode   — read one file
 *   PUT    /api/workspaces/:id/instructions/:mode   — create/update file
 *   DELETE /api/workspaces/:id/instructions/:mode   — delete file
 *
 * No VS Code dependencies. Cross-platform (Linux/Mac/Windows).
 */

import * as fs from 'fs';
import * as path from 'path';
import type { ProcessStore } from '@plusplusoneplusplus/pipeline-core';
import { INSTRUCTION_DIR, findInstructionFiles } from '@plusplusoneplusplus/pipeline-core';
import { sendJSON } from './api-handler';
import { handleAPIError, notFound, badRequest } from './errors';
import { resolveWorkspaceOrFail, parseBodyOrReject } from './shared/handler-utils';
import type { Route } from './types';

// ============================================================================
// Constants
// ============================================================================

/** Valid mode values accepted as the :mode URL parameter. */
const VALID_MODES = new Set(['base', 'ask', 'plan', 'autopilot'] as const);
type InstructionMode = 'base' | 'ask' | 'plan' | 'autopilot';

/** Maps mode to file name relative to the instruction dir. */
const MODE_TO_FILE: Record<InstructionMode, string> = {
    base: 'instructions.md',
    ask: 'instructions-ask.md',
    plan: 'instructions-plan.md',
    autopilot: 'instructions-autopilot.md',
};

// ============================================================================
// Helpers
// ============================================================================

function resolveInstructionPath(workspaceRoot: string, mode: InstructionMode): string {
    return path.join(workspaceRoot, INSTRUCTION_DIR, MODE_TO_FILE[mode]);
}

function parseMode(raw: string): InstructionMode | undefined {
    return VALID_MODES.has(raw as InstructionMode) ? (raw as InstructionMode) : undefined;
}

// ============================================================================
// Route registration
// ============================================================================

/**
 * Register CRUD routes for per-repo instruction files.
 * Mutates the routes array in-place (same pattern as other handlers).
 */
export function registerInstructionRoutes(routes: Route[], store: ProcessStore): void {
    // GET /api/workspaces/:id/instructions — list all files
    routes.push({
        method: 'GET',
        pattern: /^\/api\/workspaces\/([^/]+)\/instructions$/,
        handler: async (_req, res, match) => {
            try {
                const workspace = await resolveWorkspaceOrFail(store, match!, res);
                if (!workspace) return;

                const fileSet = findInstructionFiles(workspace.rootPath);
                const result: Record<string, string | null> = {};

                for (const mode of VALID_MODES) {
                    const filePath = fileSet[mode];
                    if (filePath) {
                        try {
                            result[mode] = await fs.promises.readFile(filePath, 'utf-8');
                        } catch {
                            result[mode] = null;
                        }
                    } else {
                        result[mode] = null;
                    }
                }

                sendJSON(res, 200, result);
            } catch (err) {
                handleAPIError(res, err);
            }
        },
    });

    // GET /api/workspaces/:id/instructions/:mode — read one file
    routes.push({
        method: 'GET',
        pattern: /^\/api\/workspaces\/([^/]+)\/instructions\/([^/]+)$/,
        handler: async (_req, res, match) => {
            try {
                const workspace = await resolveWorkspaceOrFail(store, match!, res);
                if (!workspace) return;

                const mode = parseMode(match![2] ?? '');
                if (!mode) {
                    return handleAPIError(res, badRequest(`Invalid mode '${match![2]}'. Valid values: base, ask, plan, autopilot`));
                }

                const filePath = resolveInstructionPath(workspace.rootPath, mode);
                if (!fs.existsSync(filePath)) {
                    return handleAPIError(res, notFound(`Instructions file for mode '${mode}'`));
                }

                const content = await fs.promises.readFile(filePath, 'utf-8');
                sendJSON(res, 200, { mode, content });
            } catch (err) {
                handleAPIError(res, err);
            }
        },
    });

    // PUT /api/workspaces/:id/instructions/:mode — create/update file
    routes.push({
        method: 'PUT',
        pattern: /^\/api\/workspaces\/([^/]+)\/instructions\/([^/]+)$/,
        handler: async (req, res, match) => {
            try {
                const workspace = await resolveWorkspaceOrFail(store, match!, res);
                if (!workspace) return;

                const mode = parseMode(match![2] ?? '');
                if (!mode) {
                    return handleAPIError(res, badRequest(`Invalid mode '${match![2]}'. Valid values: base, ask, plan, autopilot`));
                }

                const body = await parseBodyOrReject(req, res);
                if (body === null) return;

                if (typeof body?.content !== 'string') {
                    return handleAPIError(res, badRequest('Request body must be JSON with a "content" string field'));
                }

                const dir = path.join(workspace.rootPath, INSTRUCTION_DIR);
                await fs.promises.mkdir(dir, { recursive: true });

                const filePath = resolveInstructionPath(workspace.rootPath, mode);
                await fs.promises.writeFile(filePath, body.content, 'utf-8');

                sendJSON(res, 200, { mode, content: body.content });
            } catch (err) {
                handleAPIError(res, err);
            }
        },
    });

    // DELETE /api/workspaces/:id/instructions/:mode — delete file
    routes.push({
        method: 'DELETE',
        pattern: /^\/api\/workspaces\/([^/]+)\/instructions\/([^/]+)$/,
        handler: async (_req, res, match) => {
            try {
                const workspace = await resolveWorkspaceOrFail(store, match!, res);
                if (!workspace) return;

                const mode = parseMode(match![2] ?? '');
                if (!mode) {
                    return handleAPIError(res, badRequest(`Invalid mode '${match![2]}'. Valid values: base, ask, plan, autopilot`));
                }

                const filePath = resolveInstructionPath(workspace.rootPath, mode);
                if (!fs.existsSync(filePath)) {
                    return handleAPIError(res, notFound(`Instructions file for mode '${mode}'`));
                }

                await fs.promises.unlink(filePath);
                sendJSON(res, 200, { success: true });
            } catch (err) {
                handleAPIError(res, err);
            }
        },
    });
}