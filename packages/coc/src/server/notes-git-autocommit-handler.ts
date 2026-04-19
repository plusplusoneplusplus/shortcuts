/**
 * Notes Git Auto-Commit REST API Handler
 *
 * Four endpoints for enabling, disabling, updating, and querying
 * the notes auto-commit schedule.
 *
 * Cross-platform compatible (Linux/Mac/Windows).
 */

import * as fs from 'fs';
import type { ProcessStore } from '@plusplusoneplusplus/forge';
import { sendJSON, sendError } from './api-handler';
import { resolveWorkspaceOrFail, parseBodyOrReject } from './shared/handler-utils';
import type { Route } from './types';
import { getRepoDataPath } from './paths';
import type { ScheduleManager } from './schedule-manager';
import { parseCron } from './cron-utils';
import {
    NOTES_AUTOCOMMIT_SCHEDULE_NAME,
    findAutoCommitSchedule,
    writeAutoCommitScript,
    deleteAutoCommitScript,
    buildAutoCommitScheduleTarget,
} from './notes-git-autocommit';

const DEFAULT_CRON = '*/30 * * * *';

/**
 * Register notes git auto-commit API routes on the given route table.
 * Mutates the `routes` array in-place.
 */
export function registerNotesGitAutoCommitRoutes(
    routes: Route[],
    store: ProcessStore,
    dataDir: string,
    scheduleManager: ScheduleManager,
): void {

    // ------------------------------------------------------------------
    // POST /api/workspaces/:id/notes/git/auto-commit — Enable
    // ------------------------------------------------------------------
    routes.push({
        method: 'POST',
        pattern: /^\/api\/workspaces\/([^/]+)\/notes\/git\/auto-commit$/,
        handler: async (req, res, match) => {
            const ws = await resolveWorkspaceOrFail(store, match!, res);
            if (!ws) return;

            const wsId = ws.id;

            // Check for duplicate
            const existing = findAutoCommitSchedule(scheduleManager, wsId);
            if (existing) {
                return sendError(res, 409, 'Auto-commit schedule already exists for this workspace');
            }

            // Parse body (optional)
            const body = await parseBodyOrReject(req, res);
            if (body === null) return;

            const cron = body.cron || DEFAULT_CRON;

            // Validate cron
            try {
                parseCron(cron);
            } catch (err: any) {
                return sendError(res, 400, 'Invalid cron expression: ' + err.message);
            }

            // Resolve notes directory
            const notesDir = getRepoDataPath(dataDir, wsId, 'notes');

            // Write the script
            let scriptPath: string;
            try {
                scriptPath = await writeAutoCommitScript(dataDir, wsId, notesDir);
            } catch (err: any) {
                return sendError(res, 500, 'Failed to write auto-commit script: ' + err.message);
            }

            // Create the schedule
            let schedule;
            try {
                const target = buildAutoCommitScheduleTarget(scriptPath);
                schedule = scheduleManager.addSchedule(wsId, {
                    name: NOTES_AUTOCOMMIT_SCHEDULE_NAME,
                    target,
                    targetType: 'script',
                    cron,
                    params: { workingDirectory: notesDir },
                    onFailure: 'notify',
                    status: 'active',
                    mode: undefined,
                });
            } catch (err: any) {
                // Rollback: delete script if schedule creation failed
                await deleteAutoCommitScript(dataDir, wsId).catch(() => {});
                return sendError(res, 500, 'Failed to create schedule: ' + err.message);
            }

            sendJSON(res, 201, { schedule, scriptPath });
        },
    });

    // ------------------------------------------------------------------
    // DELETE /api/workspaces/:id/notes/git/auto-commit — Disable
    // ------------------------------------------------------------------
    routes.push({
        method: 'DELETE',
        pattern: /^\/api\/workspaces\/([^/]+)\/notes\/git\/auto-commit$/,
        handler: async (_req, res, match) => {
            const ws = await resolveWorkspaceOrFail(store, match!, res);
            if (!ws) return;

            const wsId = ws.id;
            const existing = findAutoCommitSchedule(scheduleManager, wsId);
            if (!existing) {
                return sendError(res, 404, 'No auto-commit schedule found for this workspace');
            }

            scheduleManager.removeSchedule(wsId, existing.id);

            // Delete script files (best-effort)
            await deleteAutoCommitScript(dataDir, wsId).catch((err) => {
                process.stderr.write(`[notes-autocommit] Warning: failed to delete script: ${err.message}\n`);
            });

            sendJSON(res, 200, { deleted: true });
        },
    });

    // ------------------------------------------------------------------
    // PATCH /api/workspaces/:id/notes/git/auto-commit — Update
    // ------------------------------------------------------------------
    routes.push({
        method: 'PATCH',
        pattern: /^\/api\/workspaces\/([^/]+)\/notes\/git\/auto-commit$/,
        handler: async (req, res, match) => {
            const ws = await resolveWorkspaceOrFail(store, match!, res);
            if (!ws) return;

            const wsId = ws.id;
            const existing = findAutoCommitSchedule(scheduleManager, wsId);
            if (!existing) {
                return sendError(res, 404, 'No auto-commit schedule found for this workspace');
            }

            const body = await parseBodyOrReject(req, res);
            if (body === null) return;

            const updates: Record<string, any> = {};

            if (body.cron !== undefined) {
                try {
                    parseCron(body.cron);
                } catch (err: any) {
                    return sendError(res, 400, 'Invalid cron expression: ' + err.message);
                }
                updates.cron = body.cron;
            }

            if (body.status !== undefined) {
                if (body.status !== 'active' && body.status !== 'paused') {
                    return sendError(res, 400, 'Status must be "active" or "paused"');
                }
                updates.status = body.status;
            }

            if (Object.keys(updates).length === 0) {
                return sendError(res, 400, 'No valid update fields provided (allowed: cron, status)');
            }

            const updated = scheduleManager.updateSchedule(wsId, existing.id, updates);
            if (!updated) {
                return sendError(res, 500, 'Failed to update schedule');
            }

            sendJSON(res, 200, { schedule: updated });
        },
    });

    // ------------------------------------------------------------------
    // GET /api/workspaces/:id/notes/git/auto-commit/status — Status
    // ------------------------------------------------------------------
    routes.push({
        method: 'GET',
        pattern: /^\/api\/workspaces\/([^/]+)\/notes\/git\/auto-commit\/status$/,
        handler: async (_req, res, match) => {
            const ws = await resolveWorkspaceOrFail(store, match!, res);
            if (!ws) return;

            const wsId = ws.id;
            const existing = findAutoCommitSchedule(scheduleManager, wsId);

            if (!existing) {
                return sendJSON(res, 200, { enabled: false });
            }

            // Check if notes git is initialized
            const notesDir = getRepoDataPath(dataDir, wsId, 'notes');
            let gitInitialized = false;
            try {
                await fs.promises.access(`${notesDir}/.git`);
                gitInitialized = true;
            } catch {
                // .git not found
            }

            const runHistory = scheduleManager.getRunHistory(existing.id);
            const lastRun = runHistory.length > 0 ? runHistory[0] : null;

            const response: Record<string, any> = {
                enabled: true,
                schedule: existing,
                lastRun,
            };

            if (!gitInitialized) {
                response.warning = 'Notes git repository is not initialized. Auto-commit will fail until git init is run.';
            }

            sendJSON(res, 200, response);
        },
    });
}
