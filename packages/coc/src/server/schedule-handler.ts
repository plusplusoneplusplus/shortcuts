/**
 * Schedule REST API Handler
 *
 * HTTP API routes for cron schedule management: CRUD, trigger, history.
 * Mirrors the queue-handler.ts pattern.
 *
 * No VS Code dependencies — uses only Node.js built-in modules.
 * Cross-platform compatible (Linux/Mac/Windows).
 */

import { sendJSON, sendError, parseBodyOrReject } from '@plusplusoneplusplus/coc-server';
import type { Route } from '@plusplusoneplusplus/coc-server';
import { ScheduleManager, describeCron, nextCronTime, parseCron } from './schedule-manager';
import type { ScheduleEntry, ScheduleOnFailure, ScheduleStatus } from './schedule-manager';
import type { TargetType, ChatMode } from '@plusplusoneplusplus/coc-server';

// ============================================================================
// Validation
// ============================================================================

const VALID_STATUSES: Set<string> = new Set(['active', 'paused', 'stopped']);
const VALID_ON_FAILURE: Set<string> = new Set(['notify', 'stop']);
const VALID_TARGET_TYPES: Set<string> = new Set(['prompt', 'script']);
const VALID_MODES: Set<string> = new Set(['ask', 'plan', 'autopilot']);

function validateScheduleInput(body: any): { valid: boolean; error?: string } {
    if (!body.name || typeof body.name !== 'string' || !body.name.trim()) {
        return { valid: false, error: 'Missing required field: name' };
    }
    if (!body.target || typeof body.target !== 'string' || !body.target.trim()) {
        return { valid: false, error: 'Missing required field: target' };
    }
    if (!body.cron || typeof body.cron !== 'string' || !body.cron.trim()) {
        return { valid: false, error: 'Missing required field: cron' };
    }
    try {
        parseCron(body.cron);
    } catch {
        return { valid: false, error: `Invalid cron expression: ${body.cron}` };
    }
    if (body.onFailure && !VALID_ON_FAILURE.has(body.onFailure)) {
        return { valid: false, error: `Invalid onFailure: ${body.onFailure}. Valid values: notify, stop` };
    }
    if (body.status && !VALID_STATUSES.has(body.status)) {
        return { valid: false, error: `Invalid status: ${body.status}. Valid values: active, paused, stopped` };
    }
    if (body.targetType !== undefined && !VALID_TARGET_TYPES.has(body.targetType)) {
        return { valid: false, error: `Invalid targetType: ${body.targetType}. Valid values: prompt, script` };
    }
    if (body.mode !== undefined && !VALID_MODES.has(body.mode)) {
        return { valid: false, error: `Invalid mode: ${body.mode}. Valid values: ask, plan, autopilot` };
    }
    return { valid: true };
}

function serializeSchedule(entry: ScheduleEntry, manager: ScheduleManager): Record<string, unknown> {
    const next = entry.status === 'active' ? nextCronTime(entry.cron) : null;
    return {
        id: entry.id,
        name: entry.name,
        target: entry.target,
        targetType: entry.targetType ?? 'prompt',
        cron: entry.cron,
        cronDescription: describeCron(entry.cron),
        params: entry.params,
        onFailure: entry.onFailure,
        status: entry.status,
        isRunning: manager.isRunning(entry.id),
        nextRun: next ? next.toISOString() : null,
        createdAt: entry.createdAt,
        outputFolder: entry.outputFolder,
        model: entry.model,
        mode: entry.mode ?? 'autopilot',
    };
}

// ============================================================================
// Route Registration
// ============================================================================

/**
 * Register all schedule API routes on the given route table.
 */
export function registerScheduleRoutes(routes: Route[], manager: ScheduleManager): void {

    // ------------------------------------------------------------------
    // GET /api/workspaces/:id/schedules — List schedules for a repo
    // ------------------------------------------------------------------
    routes.push({
        method: 'GET',
        pattern: /^\/api\/workspaces\/([^/]+)\/schedules$/,
        handler: async (_req, res, match) => {
            const repoId = decodeURIComponent(match![1]);
            const schedules = manager.getSchedules(repoId).map(s => serializeSchedule(s, manager));
            sendJSON(res, 200, { schedules });
        },
    });

    // ------------------------------------------------------------------
    // POST /api/workspaces/:id/schedules — Create a schedule
    // ------------------------------------------------------------------
    routes.push({
        method: 'POST',
        pattern: /^\/api\/workspaces\/([^/]+)\/schedules$/,
        handler: async (req, res, match) => {
            const repoId = decodeURIComponent(match![1]);
            const body = await parseBodyOrReject(req, res);
            if (body === null) return;

            const validation = validateScheduleInput(body);
            if (!validation.valid) {
                return sendError(res, 400, validation.error!);
            }

            try {
                const schedule = manager.addSchedule(repoId, {
                    name: body.name.trim(),
                    target: body.target.trim(),
                    cron: body.cron.trim(),
                    params: body.params || {},
                    onFailure: (body.onFailure as ScheduleOnFailure) || 'notify',
                    status: (body.status as ScheduleStatus) || 'active',
                    targetType: (body.targetType as TargetType) || 'prompt',
                    outputFolder: body.outputFolder ? String(body.outputFolder).trim() : undefined,
                    model: body.model ? String(body.model).trim() : undefined,
                    mode: (body.mode as ChatMode) || 'autopilot',
                });
                sendJSON(res, 201, { schedule: serializeSchedule(schedule, manager) });
            } catch (err) {
                const message = err instanceof Error ? err.message : 'Failed to create schedule';
                return sendError(res, 400, message);
            }
        },
    });

    // ------------------------------------------------------------------
    // PATCH /api/workspaces/:id/schedules/:scheduleId — Update
    // ------------------------------------------------------------------
    routes.push({
        method: 'PATCH',
        pattern: /^\/api\/workspaces\/([^/]+)\/schedules\/([^/]+)$/,
        handler: async (req, res, match) => {
            const repoId = decodeURIComponent(match![1]);
            const scheduleId = decodeURIComponent(match![2]);

            const body = await parseBodyOrReject(req, res);
            if (body === null) return;

            if (body.cron) {
                try {
                    parseCron(body.cron);
                } catch {
                    return sendError(res, 400, `Invalid cron expression: ${body.cron}`);
                }
            }
            if (body.onFailure && !VALID_ON_FAILURE.has(body.onFailure)) {
                return sendError(res, 400, `Invalid onFailure: ${body.onFailure}`);
            }
            if (body.status && !VALID_STATUSES.has(body.status)) {
                return sendError(res, 400, `Invalid status: ${body.status}`);
            }
            if (body.targetType !== undefined && !VALID_TARGET_TYPES.has(body.targetType)) {
                return sendError(res, 400, `Invalid targetType: ${body.targetType}. Valid values: prompt, script`);
            }
            if (body.mode !== undefined && !VALID_MODES.has(body.mode)) {
                return sendError(res, 400, `Invalid mode: ${body.mode}. Valid values: ask, plan, autopilot`);
            }

            const updates: any = {};
            if (body.name) updates.name = body.name.trim();
            if (body.target) updates.target = body.target.trim();
            if (body.cron) updates.cron = body.cron.trim();
            if (body.params !== undefined) updates.params = body.params;
            if (body.onFailure) updates.onFailure = body.onFailure;
            if (body.status) updates.status = body.status;
            if (body.targetType !== undefined) updates.targetType = body.targetType;
            if (body.outputFolder !== undefined) updates.outputFolder = body.outputFolder ? String(body.outputFolder).trim() : undefined;
            if (body.model !== undefined) updates.model = body.model ? String(body.model).trim() : undefined;
            if (body.mode !== undefined) updates.mode = body.mode;

            const schedule = manager.updateSchedule(repoId, scheduleId, updates);
            if (!schedule) {
                return sendError(res, 404, 'Schedule not found');
            }

            sendJSON(res, 200, { schedule: serializeSchedule(schedule, manager) });
        },
    });

    // ------------------------------------------------------------------
    // DELETE /api/workspaces/:id/schedules/:scheduleId — Delete
    // ------------------------------------------------------------------
    routes.push({
        method: 'DELETE',
        pattern: /^\/api\/workspaces\/([^/]+)\/schedules\/([^/]+)$/,
        handler: async (_req, res, match) => {
            const repoId = decodeURIComponent(match![1]);
            const scheduleId = decodeURIComponent(match![2]);

            const removed = manager.removeSchedule(repoId, scheduleId);
            if (!removed) {
                return sendError(res, 404, 'Schedule not found');
            }

            sendJSON(res, 200, { deleted: true });
        },
    });

    // ------------------------------------------------------------------
    // POST /api/workspaces/:id/schedules/:scheduleId/run — Trigger
    // ------------------------------------------------------------------
    routes.push({
        method: 'POST',
        pattern: /^\/api\/workspaces\/([^/]+)\/schedules\/([^/]+)\/run$/,
        handler: async (_req, res, match) => {
            const repoId = decodeURIComponent(match![1]);
            const scheduleId = decodeURIComponent(match![2]);

            try {
                const run = await manager.triggerRun(repoId, scheduleId);
                process.stderr.write(`[Schedule] manual-run scheduleId=${scheduleId} repoId=${repoId}\n`);
                sendJSON(res, 200, { run });
            } catch (err) {
                const message = err instanceof Error ? err.message : 'Failed to trigger run';
                return sendError(res, 404, message);
            }
        },
    });

    // ------------------------------------------------------------------
    // GET /api/workspaces/:id/schedules/:scheduleId/history — History
    // ------------------------------------------------------------------
    routes.push({
        method: 'GET',
        pattern: /^\/api\/workspaces\/([^/]+)\/schedules\/([^/]+)\/history$/,
        handler: async (_req, res, match) => {
            const _repoId = decodeURIComponent(match![1]);
            const scheduleId = decodeURIComponent(match![2]);

            const history = manager.getRunHistory(scheduleId);
            sendJSON(res, 200, { history });
        },
    });
}
