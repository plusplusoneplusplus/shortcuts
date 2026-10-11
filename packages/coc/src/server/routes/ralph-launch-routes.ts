/**
 * POST /api/ralph-launch — create a native interview or direct execution.
 * Omitting entryPoint preserves direct execution. Thin shared launch adapter.
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
        method: 'GET', pattern: /^\/api\/ralph-launch\/capabilities$/,
        handler: async (_req, res) => sendJSON(res, 200, { grilling: ctx.getRalphEnabled?.() === true, version: 1, approvedStart: ctx.getRalphEnabled?.() === true }),
    });
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
            if (body.entryPoint !== undefined && (body.processId !== undefined || body.action === 'cancel')) {
                return sendError(res, 400, 'entryPoint is only valid for creating a Ralph conversation');
            }

            const result = await launchRalphSession({
                goalSpec: body.goalSpec,
                entryPoint: body.entryPoint,
                requestId: body.requestId,
                spawnedFromProcessId: body.requestId ? optionalString(body.spawnedFromProcessId) : undefined,
                workspaceId: optionalString(body.workspaceId),
                folderPath: optionalString(body.folderPath),
                workingDirectory: optionalString(body.workingDirectory),
                aiSelection: body,
                worktree: body.worktree,
                title: optionalString(body.title)?.trim().slice(0, 80) || undefined,
            }, ctx);
            if (!result.ok) {
                return sendError(res, 400, result.error);
            }

            const { ok: _ok, ...response } = result;
            sendJSON(res, 200, response);
        },
    });
}
