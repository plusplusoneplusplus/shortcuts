/**
 * POST /api/ralph-launch — launch a Ralph execution loop directly from a
 * goal spec (e.g. read from a goal.md file), skipping the grilling/synthesis
 * phase entirely. Thin HTTP adapter over {@link launchRalphSession}.
 */

import { sendJSON, sendError, parseBody } from '../core/api-handler';
import type { Route } from '../types';
import { launchRalphSession, type RalphLaunchDeps } from '../ralph/ralph-launch-service';

export type RalphLaunchRouteContext = RalphLaunchDeps;

function optionalString(value: unknown): string | undefined {
    return typeof value === 'string' && value ? value : undefined;
}

export function registerRalphLaunchRoutes(routes: Route[], ctx: RalphLaunchRouteContext): void {
    routes.push({
        method: 'POST',
        pattern: /^\/api\/ralph-launch$/,
        handler: async (req, res) => {
            let body: any;
            try {
                body = await parseBody(req);
            } catch {
                return sendError(res, 400, 'Invalid JSON');
            }

            const result = await launchRalphSession({
                goalSpec: body.goalSpec,
                workspaceId: optionalString(body.workspaceId),
                folderPath: optionalString(body.folderPath),
                workingDirectory: optionalString(body.workingDirectory),
                aiSelection: body,
                worktree: body.worktree,
            }, ctx);
            if (!result.ok) {
                return sendError(res, 400, result.error);
            }

            const { ok: _ok, ...response } = result;
            sendJSON(res, 200, response);
        },
    });
}
