/**
 * Schedule REST API Handler
 *
 * HTTP API routes for cron schedule management: CRUD, trigger, history.
 * Mirrors the queue-handler.ts pattern.
 *
 * Pure Node.js; uses only built-in modules.
 * Cross-platform compatible (Linux/Mac/Windows).
 */

import type { ISDKService } from '@plusplusoneplusplus/forge';
import { denyAllPermissions } from '@plusplusoneplusplus/forge';
import { sendJSON, sendError } from '../core/api-handler';
import { parseBodyOrReject } from '../shared/handler-utils';
import { getErrorMessage } from '../shared/fs-utils';
import type { Route } from '../types';
import { ScheduleManager, describeCron, nextCronTime, parseCron } from './schedule-manager';
import type { ScheduleEntry, ScheduleOnFailure, ScheduleStatus } from './schedule-manager';
import type { TargetType, ChatMode } from '../tasks/task-types';
import { normalizeChatMode } from '../tasks/task-types';

// ============================================================================
// AI instruction refinement
// ============================================================================

/** Pure text generation, no tool use — give it a generous 2 min budget. */
const INSTRUCTION_REFINE_TIMEOUT_MS = 120_000;

const INSTRUCTION_REFINE_SYSTEM_PROMPT = `You refine the instructions for a scheduled AI prompt routine. The user wrote rough notes; rewrite them into a single, clear, well-structured prompt the AI can follow each time the schedule runs.

Rules:
- Preserve the original intent and scope. Do NOT invent new tasks, tools, or requirements.
- Make the instructions specific, actionable, and unambiguous.
- Keep it concise. Use short sentences or bullet points where they help.
- Output ONLY the refined instructions. Do NOT wrap them in markdown code fences. Do NOT add any commentary before or after.`;

/** Strip a wrapping markdown code fence from an AI response, else return trimmed text. */
function extractRefinedInstructions(response: string): string {
    const fenced = response.match(/```[a-zA-Z]*\s*\n([\s\S]*?)```/);
    if (fenced) return fenced[1].trim();
    return response.trim();
}

// ============================================================================
// Validation
// ============================================================================

const VALID_STATUSES: Set<string> = new Set(['active', 'paused', 'stopped']);
const VALID_ON_FAILURE: Set<string> = new Set(['notify', 'stop']);
const VALID_TARGET_TYPES: Set<string> = new Set(['prompt', 'script']);
function normalizeScheduleMode(mode: unknown): ChatMode | undefined {
    const normalized = normalizeChatMode(mode);
    if (normalized === 'ask' || normalized === 'autopilot') return normalized;
    return undefined;
}

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
    if (body.mode !== undefined && !normalizeScheduleMode(body.mode)) {
        return { valid: false, error: `Invalid mode: ${body.mode}. Valid values: ask, autopilot` };
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
        mode: normalizeScheduleMode(entry.mode) ?? entry.mode ?? 'autopilot',
        source: entry.source ?? 'user',
    };
}

// ============================================================================
// Route Registration
// ============================================================================

/**
 * Register all schedule API routes on the given route table.
 *
 * @param getWorkspacePath - Optional callback to resolve a workspace root path
 *   from a repoId. Used to load repo-defined schedules from .github/schedules/.
 */
export function registerScheduleRoutes(
    routes: Route[],
    manager: ScheduleManager,
    getWorkspacePath?: (repoId: string) => Promise<string | undefined>,
    aiService?: ISDKService,
): void {

    /** Lazily register workspace path with the manager on first request for a repo. */
    async function ensureWorkspaceLoaded(repoId: string): Promise<void> {
        if (!getWorkspacePath) return;
        const rootPath = await getWorkspacePath(repoId);
        if (rootPath) {
            manager.registerWorkspacePath(repoId, rootPath);
        }
    }

    // ------------------------------------------------------------------
    // GET /api/workspaces/:id/schedules — List schedules for a repo
    // ------------------------------------------------------------------
    routes.push({
        method: 'GET',
        pattern: /^\/api\/workspaces\/([^/]+)\/schedules$/,
        handler: async (_req, res, match) => {
            const repoId = decodeURIComponent(match![1]);
            await ensureWorkspaceLoaded(repoId);
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
                    mode: normalizeScheduleMode(body.mode) || 'autopilot',
                });
                sendJSON(res, 201, { schedule: serializeSchedule(schedule, manager) });
            } catch (err) {
                return sendError(res, 400, getErrorMessage(err, 'Failed to create schedule'));
            }
        },
    });

    // ------------------------------------------------------------------
    // POST /api/workspaces/:id/schedules/refine — AI-assisted instruction refinement
    //
    // Rewrites a prompt routine's free-text instructions into a clearer,
    // well-structured prompt. Scoped per workspace and routed to the workspace's
    // working directory so it is multi-repo safe.
    // ------------------------------------------------------------------
    routes.push({
        method: 'POST',
        pattern: /^\/api\/workspaces\/([^/]+)\/schedules\/refine$/,
        handler: async (req, res, match) => {
            const repoId = decodeURIComponent(match![1]);
            const body = await parseBodyOrReject(req, res);
            if (body === null) return;

            const instructions = typeof body.instructions === 'string' ? body.instructions : '';
            if (!instructions.trim()) {
                return sendError(res, 400, 'Missing required field: instructions');
            }
            const hint = typeof body.hint === 'string' ? body.hint.trim() : '';
            const model = typeof body.model === 'string' && body.model.trim() ? body.model.trim() : undefined;

            if (!aiService) {
                return sendError(res, 503, 'AI service not configured');
            }

            let available: { available: boolean };
            try {
                available = await aiService.isAvailable();
            } catch {
                available = { available: false };
            }
            if (!available.available) {
                return sendError(res, 503, 'AI service unavailable');
            }

            await ensureWorkspaceLoaded(repoId);
            const workingDirectory = getWorkspacePath ? await getWorkspacePath(repoId) : undefined;

            const userPrompt = `Current instructions:\n\n${instructions.trim()}\n\n${hint ? `Additional guidance from the user:\n\n${hint}\n\n` : ''}Return the improved instructions.`;

            try {
                const result = await aiService.sendMessage({
                    prompt: INSTRUCTION_REFINE_SYSTEM_PROMPT + '\n\n' + userPrompt,
                    model,
                    workingDirectory,
                    timeoutMs: INSTRUCTION_REFINE_TIMEOUT_MS,
                    onPermissionRequest: denyAllPermissions,
                });

                if (!result.success) {
                    return sendError(res, 500, 'Instruction refinement failed: ' + (result.error || 'Unknown error'));
                }

                const raw = result.response || '';
                const refined = extractRefinedInstructions(raw);
                if (!refined) {
                    return sendError(res, 500, 'Instruction refinement returned an empty result');
                }

                sendJSON(res, 200, { refined, raw });
            } catch (error) {
                const message = error instanceof Error ? error.message : String(error);
                if (message.toLowerCase().includes('timeout')) {
                    return sendError(res, 504, 'Instruction refinement timed out');
                }
                return sendError(res, 500, 'Instruction refinement failed: ' + message);
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
            if (body.mode !== undefined && !normalizeScheduleMode(body.mode)) {
                return sendError(res, 400, `Invalid mode: ${body.mode}. Valid values: ask, autopilot`);
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
            if (body.mode !== undefined) updates.mode = normalizeScheduleMode(body.mode);

            const schedule = await manager.updateSchedule(repoId, scheduleId, updates);
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

            await ensureWorkspaceLoaded(repoId);

            const existing = manager.getSchedule(repoId, scheduleId);
            if (!existing) {
                return sendError(res, 404, 'Schedule not found');
            }

            if (existing.source === 'repo') {
                try {
                    await manager.removeRepoSchedule(repoId, scheduleId);
                } catch (err) {
                    const msg = getErrorMessage(err, 'Failed to delete repo schedule');
                    const status = msg.includes('not found') || msg.includes('not available') ? 404 : 500;
                    return sendError(res, status, msg);
                }
            } else {
                const removed = manager.removeSchedule(repoId, scheduleId);
                if (!removed) {
                    return sendError(res, 404, 'Schedule not found');
                }
            }

            sendJSON(res, 200, { deleted: true });
        },
    });

    // ------------------------------------------------------------------
    // POST /api/workspaces/:id/schedules/:scheduleId/move — Move between user/repo
    // ------------------------------------------------------------------
    routes.push({
        method: 'POST',
        pattern: /^\/api\/workspaces\/([^/]+)\/schedules\/([^/]+)\/move$/,
        handler: async (req, res, match) => {
            const repoId = decodeURIComponent(match![1]);
            const scheduleId = decodeURIComponent(match![2]);

            const body = await parseBodyOrReject(req, res);
            if (body === null) return;

            const destination = body.destination;
            if (destination !== 'user' && destination !== 'repo') {
                return sendError(res, 400, 'Invalid destination. Must be "user" or "repo".');
            }

            try {
                const schedule = await manager.moveSchedule(repoId, scheduleId, destination);
                sendJSON(res, 200, { schedule: serializeSchedule(schedule, manager) });
            } catch (err) {
                return sendError(res, 400, getErrorMessage(err, 'Failed to move schedule'));
            }
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
                return sendError(res, 404, getErrorMessage(err, 'Failed to trigger run'));
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
