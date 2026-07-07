/**
 * Notes Git Auto-Commit REST API Handler
 *
 * Three endpoints for enabling, disabling, and querying the notes auto-commit timer.
 * Auto-commit now runs as a silent in-process `setInterval` — no shell scripts,
 * no Activity-tab entries.
 *
 * Cross-platform compatible (Linux/Mac/Windows).
 */

import * as fs from 'fs';
import type { ProcessStore } from '@plusplusoneplusplus/forge';
import { sendJSON, sendError } from '../../core/api-handler';
import { resolveWorkspaceOrFail, parseBodyOrReject } from '../../shared/handler-utils';
import type { Route } from '../../types';
import { getRepoDataPath } from '../../paths';
import type { ScheduleManager } from '../../schedule/schedule-manager';
import type { NotesGitTimerManager } from './notes-git-timer-manager';
import { DEFAULT_AUTOCOMMIT_INTERVAL_MS } from './notes-git-timer-manager';
import { findAutoCommitSchedule } from './notes-git-autocommit';
import { readRepoPreferences, writeRepoPreferences } from '../../preferences-handler';

/**
 * Register notes git auto-commit API routes on the given route table.
 * Mutates the `routes` array in-place.
 *
 * `scheduleManager` is optional and used only for one-time backward-compat cleanup
 * of stale schedule entries left by the old scheduler-based approach.
 */
export function registerNotesGitAutoCommitRoutes(
    routes: Route[],
    store: ProcessStore,
    dataDir: string,
    timerManager: NotesGitTimerManager,
    scheduleManager?: ScheduleManager,
): void {

    // ------------------------------------------------------------------
    // POST /api/workspaces/:id/notes/git/auto-commit — Enable / update
    // ------------------------------------------------------------------
    routes.push({
        method: 'POST',
        pattern: /^\/api\/workspaces\/([^/]+)\/notes\/git\/auto-commit$/,
        handler: async (req, res, match) => {
            const ws = await resolveWorkspaceOrFail(store, match!, res);
            if (!ws) return;
            const wsId = ws.id;

            const body = await parseBodyOrReject(req, res);
            if (body === null) return;

            const intervalMs =
                typeof body.intervalMs === 'number' && body.intervalMs > 0
                    ? body.intervalMs
                    : DEFAULT_AUTOCOMMIT_INTERVAL_MS;

            // Persist preference
            const prefs = readRepoPreferences(dataDir, wsId);
            writeRepoPreferences(dataDir, wsId, {
                ...prefs,
                notesGit: {
                    ...prefs.notesGit,
                    enabled: prefs.notesGit?.enabled ?? false,
                    autoCommit: { enabled: true, intervalMs },
                },
            });

            // Remove any stale ScheduleManager entry left by the old approach
            if (scheduleManager) {
                const stale = findAutoCommitSchedule(scheduleManager, wsId);
                if (stale) {
                    try { await scheduleManager.removeSchedule(wsId, stale.id); } catch { /* best-effort */ }
                }
            }

            // Start (or restart with new interval)
            const notesDir = getRepoDataPath(dataDir, wsId, 'notes');
            timerManager.startForWorkspace(wsId, notesDir, intervalMs);

            sendJSON(res, 200, { enabled: true, intervalMs });
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

            timerManager.stopForWorkspace(wsId);

            const prefs = readRepoPreferences(dataDir, wsId);
            writeRepoPreferences(dataDir, wsId, {
                ...prefs,
                notesGit: {
                    ...prefs.notesGit,
                    enabled: prefs.notesGit?.enabled ?? false,
                    autoCommit: { enabled: false },
                },
            });

            sendJSON(res, 200, { deleted: true });
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

            const prefs = readRepoPreferences(dataDir, wsId);
            const enabled = prefs.notesGit?.autoCommit?.enabled ?? false;

            if (!enabled) {
                return sendJSON(res, 200, { enabled: false });
            }

            const timer = timerManager.getTimer(wsId);
            const { committedAt, error } = timer?.getLastResult() ?? { committedAt: null, error: null };
            const intervalMs = prefs.notesGit?.autoCommit?.intervalMs ?? DEFAULT_AUTOCOMMIT_INTERVAL_MS;

            const notesDir = getRepoDataPath(dataDir, wsId, 'notes');
            let gitInitialized = false;
            try {
                await fs.promises.access(`${notesDir}/.git`);
                gitInitialized = true;
            } catch {
                // .git not found
            }

            const response: Record<string, any> = {
                enabled: true,
                intervalMs,
                lastCommittedAt: committedAt,
                lastError: error,
            };

            if (!gitInitialized) {
                response.warning = 'Notes git repository is not initialized. Auto-commit will fail until git init is run.';
            }

            sendJSON(res, 200, response);
        },
    });
}
