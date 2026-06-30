/**
 * Queue control routes (mutations: pause/resume/cancel/reorder/clear).
 *
 * POST   /api/queue/pause                     — Pause (global or per-repo)
 * POST   /api/queue/resume                    — Resume (global or per-repo)
 * POST   /api/queue/pause-autopilot           — Pause autopilot
 * POST   /api/queue/resume-autopilot          — Resume autopilot
 * POST   /api/queue/pause-marker              — Insert pause marker
 * DELETE /api/queue/pause-marker/:markerId    — Remove pause marker
 * POST   /api/queue/force-fail-running        — Force-fail all stale running tasks
 * DELETE /api/queue                           — Clear queued tasks
 * DELETE /api/queue/history                   — Clear task history
 * DELETE /api/queue/history/:taskId           — Delete single history entry
 * POST   /api/queue/:id/force-fail            — Force-fail single task
 * DELETE /api/queue/:id                       — Cancel task
 * POST   /api/queue/:id/move-to-top           — Move to top
 * POST   /api/queue/:id/move-up               — Move up one position
 * POST   /api/queue/:id/move-down             — Move down one position
 * POST   /api/queue/:id/move-to/:position     — Move to arbitrary position
 * POST   /api/queue/:id/freeze                — Freeze task
 * POST   /api/queue/:id/unfreeze              — Unfreeze task
 * POST   /api/queue/:id/admit                 — Admit held task
 * POST   /api/queue/:id/unadmit              — Unadmit task
 */

import { sendJSON, sendError, parseBody } from '../core/api-handler';
import { toQueueProcessId } from '@plusplusoneplusplus/forge';
import type { PauseDurationHours } from '@plusplusoneplusplus/forge';
import { finalizeOrphanedProcess } from '../processes/finalize-orphaned-turn';
import { collectDescendantProcessIds } from './process-subtree';
import type { Route } from '../types';
import * as url from 'url';
import {
    getAggregateStats,
    getManagerByRepoIdentifier,
    getOrCreateManagerByRepoIdentifier,
    getRepoIdentifierFromQuery,
    type QueueRouteContext,
} from './queue-shared';

const ALLOWED_TIMED_PAUSE_HOURS = new Set<PauseDurationHours>([1, 2, 3, 4, 8]);

function parseDurationHours(value: unknown): { durationHours?: PauseDurationHours; error?: string } {
    if (value === undefined) return {};
    if (!Number.isInteger(value) || !ALLOWED_TIMED_PAUSE_HOURS.has(value as PauseDurationHours)) {
        return { error: 'durationHours must be one of: 1, 2, 3, 4, 8' };
    }
    return { durationHours: value as PauseDurationHours };
}

async function parsePauseUntil(req: import('http').IncomingMessage): Promise<{ until?: number; error?: string }> {
    let body: any;
    try {
        body = await parseBody(req);
    } catch {
        return { error: 'Invalid JSON' };
    }

    const hasDuration = body?.durationHours !== undefined;
    const hasUntil = body?.until !== undefined;
    if (hasDuration && hasUntil) {
        return { error: 'Specify either durationHours or until, not both' };
    }
    if (!hasDuration && !hasUntil) {
        return {};
    }

    if (hasDuration) {
        const { durationHours, error } = parseDurationHours(body.durationHours);
        if (error) return { error };
        if (durationHours === undefined) {
            return { error: 'durationHours must be one of: 1, 2, 3, 4, 8' };
        }
        return { until: Date.now() + durationHours * 60 * 60 * 1000 };
    }

    const until = typeof body.until === 'number' ? body.until : Date.parse(String(body.until));
    if (!Number.isFinite(until) || until <= Date.now()) {
        return { error: 'until must be a future timestamp' };
    }
    return { until };
}

export function registerQueueControlRoutes(routes: Route[], ctx: QueueRouteContext): void {
    const { bridge, store, globalWorkspaceRootPath, state } = ctx;

    // ------------------------------------------------------------------
    // POST /api/queue/pause — Pause queue processing (global or per-repo)
    // ------------------------------------------------------------------
    routes.push({
        method: 'POST',
        pattern: '/api/queue/pause',
        handler: async (req, res) => {
            const parsed = url.parse(req.url || '/', true);
            const repoId = getRepoIdentifierFromQuery(parsed.query);
            const pause = await parsePauseUntil(req);
            if (pause.error) {
                return sendError(res, 400, pause.error);
            }

            if (repoId) {
                const mgr = await getOrCreateManagerByRepoIdentifier(repoId, bridge, store, state);
                if (!mgr) {
                    return sendError(res, 404, `No queue found for repoId: ${repoId}`);
                }
                mgr.pause(pause.until);
                process.stderr.write(`[Queue] pause repoId=${repoId}\n`);
                const stats = mgr.getStats();
                sendJSON(res, 200, { repoId, paused: true, pausedUntil: stats.pausedUntil, stats });
            } else {
                state.globalPaused = true;
                state.globalPausedUntil = pause.until;
                for (const m of bridge.registry.getAllQueues().values()) {
                    m.pause(pause.until);
                }
                process.stderr.write(`[Queue] pause repoId=global\n`);
                const stats = getAggregateStats(bridge, state);
                sendJSON(res, 200, { paused: true, pausedUntil: stats.pausedUntil, stats });
            }
        },
    });

    // ------------------------------------------------------------------
    // POST /api/queue/resume — Resume queue processing (global or per-repo)
    // ------------------------------------------------------------------
    routes.push({
        method: 'POST',
        pattern: '/api/queue/resume',
        handler: async (req, res) => {
            const parsed = url.parse(req.url || '/', true);
            const repoId = getRepoIdentifierFromQuery(parsed.query);

            if (repoId) {
                const mgr = await getOrCreateManagerByRepoIdentifier(repoId, bridge, store, state);
                if (!mgr) {
                    return sendError(res, 404, `No queue found for repoId: ${repoId}`);
                }
                mgr.resume();
                process.stderr.write(`[Queue] resume repoId=${repoId}\n`);
                sendJSON(res, 200, { repoId, paused: false, stats: mgr.getStats() });
            } else {
                state.globalPaused = false;
                state.globalPausedUntil = undefined;
                for (const m of bridge.registry.getAllQueues().values()) {
                    m.resume();
                }
                process.stderr.write(`[Queue] resume repoId=global\n`);
                sendJSON(res, 200, { paused: false, stats: getAggregateStats(bridge, state) });
            }
        },
    });

    // ------------------------------------------------------------------
    // POST /api/queue/pause-autopilot — Pause autopilot task execution
    // ------------------------------------------------------------------
    routes.push({
        method: 'POST',
        pattern: '/api/queue/pause-autopilot',
        handler: async (req, res) => {
            const parsed = url.parse(req.url || '/', true);
            const repoId = getRepoIdentifierFromQuery(parsed.query);
            const pause = await parsePauseUntil(req);
            if (pause.error) {
                return sendError(res, 400, pause.error);
            }

            if (repoId) {
                const mgr = await getOrCreateManagerByRepoIdentifier(repoId, bridge, store, state);
                if (!mgr) {
                    return sendError(res, 404, `No queue found for repoId: ${repoId}`);
                }
                mgr.pauseAutopilot(pause.until);
                process.stderr.write(`[Queue] pause-autopilot repoId=${repoId}\n`);
                const stats = mgr.getStats();
                sendJSON(res, 200, { repoId, isAutopilotPaused: true, autopilotPausedUntil: stats.autopilotPausedUntil, stats });
            } else {
                state.globalAutopilotPaused = true;
                state.globalAutopilotPausedUntil = pause.until;
                for (const m of bridge.registry.getAllQueues().values()) {
                    m.pauseAutopilot(pause.until);
                }
                process.stderr.write(`[Queue] pause-autopilot repoId=global\n`);
                const stats = getAggregateStats(bridge, state);
                sendJSON(res, 200, { isAutopilotPaused: true, autopilotPausedUntil: stats.autopilotPausedUntil, stats });
            }
        },
    });

    // ------------------------------------------------------------------
    // POST /api/queue/resume-autopilot — Resume autopilot task execution
    // ------------------------------------------------------------------
    routes.push({
        method: 'POST',
        pattern: '/api/queue/resume-autopilot',
        handler: async (req, res) => {
            const parsed = url.parse(req.url || '/', true);
            const repoId = getRepoIdentifierFromQuery(parsed.query);

            if (repoId) {
                const mgr = await getOrCreateManagerByRepoIdentifier(repoId, bridge, store, state);
                if (!mgr) {
                    return sendError(res, 404, `No queue found for repoId: ${repoId}`);
                }
                mgr.resumeAutopilot();
                process.stderr.write(`[Queue] resume-autopilot repoId=${repoId}\n`);
                sendJSON(res, 200, { repoId, isAutopilotPaused: false, stats: mgr.getStats() });
            } else {
                state.globalAutopilotPaused = false;
                state.globalAutopilotPausedUntil = undefined;
                for (const m of bridge.registry.getAllQueues().values()) {
                    m.resumeAutopilot();
                }
                process.stderr.write(`[Queue] resume-autopilot repoId=global\n`);
                sendJSON(res, 200, { isAutopilotPaused: false, stats: getAggregateStats(bridge, state) });
            }
        },
    });

    // ------------------------------------------------------------------
    // POST /api/queue/pause-marker — Insert a pause marker at a position
    // Body: { afterIndex: number, repoId?: string, durationHours?: 1|2|3|4|8 }
    // ------------------------------------------------------------------
    routes.push({
        method: 'POST',
        pattern: '/api/queue/pause-marker',
        handler: async (req, res) => {
            let body: any;
            try {
                body = await parseBody(req);
            } catch {
                return sendError(res, 400, 'Invalid JSON');
            }

            const afterIndex = typeof body?.afterIndex === 'number' ? body.afterIndex : -1;
            const repoId = typeof body?.repoId === 'string' && body.repoId
                ? body.repoId
                : undefined;
            const duration = parseDurationHours(body?.durationHours);
            if (duration.error) {
                return sendError(res, 400, duration.error);
            }

            let mgr: import('@plusplusoneplusplus/forge').TaskQueueManager | undefined;
            if (repoId) {
                mgr = await getManagerByRepoIdentifier(repoId, bridge, store);
                if (!mgr) {
                    return sendError(res, 404, `No queue found for repoId: ${repoId}`);
                }
            } else {
                const allQueues = bridge.registry.getAllQueues();
                if (allQueues.size === 0) {
                    return sendError(res, 400, 'No queue available — provide repoId');
                }
                mgr = allQueues.values().next().value as import('@plusplusoneplusplus/forge').TaskQueueManager;
            }

            const markerId = mgr.insertPauseMarker(afterIndex, duration.durationHours);
            process.stderr.write(`[Queue] pause-marker inserted markerId=${markerId} afterIndex=${afterIndex} repoId=${repoId || '-'}\n`);
            sendJSON(res, 201, {
                markerId,
                afterIndex,
                ...(duration.durationHours !== undefined ? { durationHours: duration.durationHours } : {}),
            });
        },
    });

    // ------------------------------------------------------------------
    // DELETE /api/queue/pause-marker/:markerId — Remove a pause marker
    // ------------------------------------------------------------------
    routes.push({
        method: 'DELETE',
        pattern: /^\/api\/queue\/pause-marker\/([^/]+)$/,
        handler: async (req, res, match) => {
            const markerId = decodeURIComponent(match![1]);

            let removed = false;
            for (const m of bridge.registry.getAllQueues().values()) {
                if (m.removePauseMarker(markerId)) {
                    removed = true;
                    break;
                }
            }

            if (!removed) {
                return sendError(res, 404, 'Pause marker not found');
            }

            process.stderr.write(`[Queue] pause-marker removed markerId=${markerId}\n`);
            sendJSON(res, 200, { removed: true, markerId });
        },
    });

    // ------------------------------------------------------------------
    // POST /api/queue/force-fail-running — Force-fail all stale running tasks
    // ------------------------------------------------------------------
    routes.push({
        method: 'POST',
        pattern: '/api/queue/force-fail-running',
        handler: async (req, res) => {
            let body: any = {};
            try {
                body = await parseBody(req);
            } catch {
                // Use defaults
            }
            const error = (typeof body.error === 'string' && body.error.trim())
                ? body.error.trim()
                : 'Task was force-failed (assumed stale)';

            const processIds: string[] = [];
            let count = 0;
            for (const m of bridge.registry.getAllQueues().values()) {
                const runningTasks = m.getRunning();
                processIds.push(
                    ...runningTasks.map(t => t.processId).filter((pid): pid is string => !!pid)
                );
                count += m.forceFailRunning(error);
            }

            process.stderr.write(`[Queue] force-fail-running count=${count}\n`);
            if (store && processIds.length > 0) {
                for (const pid of processIds) {
                    await finalizeOrphanedProcess(store, pid, error);
                }
            }

            sendJSON(res, 200, { forceFailed: count, stats: getAggregateStats(bridge, state) });
        },
    });

    // ------------------------------------------------------------------
    // DELETE /api/queue — Clear all queued tasks
    // ------------------------------------------------------------------
    routes.push({
        method: 'DELETE',
        pattern: '/api/queue',
        handler: async (req, res) => {
            const parsed = url.parse(req.url || '/', true);
            const repoId = getRepoIdentifierFromQuery(parsed.query);

            let count = 0;
            if (repoId) {
                const mgr = await getManagerByRepoIdentifier(repoId, bridge, store);
                if (mgr) {
                    count = mgr.getQueued().length;
                    mgr.clear();
                }
            } else {
                for (const m of bridge.registry.getAllQueues().values()) {
                    count += m.getQueued().length;
                    m.clear();
                }
            }
            sendJSON(res, 200, { cleared: count, stats: getAggregateStats(bridge, state) });
        },
    });

    // ------------------------------------------------------------------
    // DELETE /api/queue/history — Clear queue history (store-backed)
    // ------------------------------------------------------------------
    routes.push({
        method: 'DELETE',
        pattern: '/api/queue/history',
        handler: async (req, res) => {
            const parsed = url.parse(req.url || '/', true);
            const repoId = getRepoIdentifierFromQuery(parsed.query);

            // Also clear in-memory history for backward compat
            for (const m of bridge.registry.getAllQueues().values()) {
                m.clearHistory();
            }

            if (store) {
                const filter: import('@plusplusoneplusplus/forge').ProcessFilter = {
                    status: ['completed', 'failed', 'cancelled'],
                };
                if (repoId) {
                    filter.workspaceId = repoId;
                }
                const cleared = await store.clearProcesses(filter);
                sendJSON(res, 200, { cleared });
            } else {
                sendJSON(res, 200, { cleared: true });
            }
        },
    });

    // ------------------------------------------------------------------
    // DELETE /api/queue/history/:taskId — Delete a single history entry
    // @deprecated — prefer DELETE /api/workspaces/:id/history/:processId
    // ------------------------------------------------------------------
    routes.push({
        method: 'DELETE',
        pattern: /^\/api\/queue\/history\/([^/]+)$/,
        handler: async (_req, res, match) => {
            const taskId = decodeURIComponent(match![1]);

            // Check in-memory queue first (task may still be tracked there)
            const mgr = bridge.findManagerForTask(taskId);
            if (mgr) {
                const task = mgr.getTask(taskId);
                if (task) {
                    const historyStatuses = new Set(['completed', 'failed', 'cancelled']);
                    if (!historyStatuses.has(task.status)) {
                        return sendError(res, 409, 'Task is still running or queued; cannot delete');
                    }
                    mgr.removeHistoryEntry(taskId);
                }
            }

            // The taskId is now treated as a processId (they are the same after 001-003 migration).
            // Try both queue_<taskId> (the processId format) and taskId directly.
            const processId = toQueueProcessId(taskId);

            if (store) {
                let found = false;
                for (const pid of [processId, taskId]) {
                    try {
                        const proc = await store.getProcess(pid);
                        if (proc) {
                            // Recursively remove the entire spawned subtree (all
                            // descendants), then the root, so no grandchild is
                            // orphaned pointing at a deleted parent.
                            const descendants = await collectDescendantProcessIds(store, pid);
                            for (const id of descendants) {
                                await store.removeProcess(id);
                            }
                            await store.removeProcess(pid);
                            found = true;
                            break;
                        }
                    } catch {
                        // Non-fatal
                    }
                }
                if (!found && !mgr) {
                    return sendError(res, 404, 'History entry not found');
                }
            } else if (!mgr) {
                return sendError(res, 404, 'History entry not found');
            }

            process.stderr.write(`[Queue] history entry deleted taskId=${taskId}\n`);
            sendJSON(res, 200, { deleted: true, taskId });
        },
    });

    // ------------------------------------------------------------------
    // POST /api/queue/:id/force-fail — Force-fail a single running task
    // ------------------------------------------------------------------
    routes.push({
        method: 'POST',
        pattern: /^\/api\/queue\/([^/]+)\/force-fail$/,
        handler: async (req, res, match) => {
            const id = decodeURIComponent(match![1]);
            let body: any = {};
            try {
                body = await parseBody(req);
            } catch {
                // Use defaults
            }
            const error = (typeof body.error === 'string' && body.error.trim())
                ? body.error.trim()
                : 'Task was force-failed (assumed stale)';

            const mgr = bridge.findManagerForTask(id);
            const task = mgr?.getTask(id);
            const processId = task?.processId;

            const success = mgr?.forceFailTask(id, error) ?? false;
            if (!success) {
                return sendError(res, 404, 'Task not found or not running');
            }

            process.stderr.write(`[Queue] force-fail task=${id}\n`);
            if (store && processId) {
                await finalizeOrphanedProcess(store, processId, error);
            }

            sendJSON(res, 200, { forceFailed: true, stats: getAggregateStats(bridge, state) });
        },
    });

    // ------------------------------------------------------------------
    // DELETE /api/queue/:id — Cancel a task
    // ------------------------------------------------------------------
    routes.push({
        method: 'DELETE',
        pattern: /^\/api\/queue\/([^/]+)$/,
        handler: async (_req, res, match) => {
            const id = decodeURIComponent(match![1]);

            // Skip known sub-routes
            if (['history'].includes(id)) {
                return sendError(res, 404, 'Task not found');
            }

            // Try routing through QueueExecutor for proper slot release + SDK abort
            const executor = bridge.findExecutorForTask(id);
            if (executor) {
                executor.cancelTask(id);
                sendJSON(res, 200, { cancelled: true });
                return;
            }
            // Fallback: task may be queued but no executor bridge exists yet
            const mgr = bridge.findManagerForTask(id);
            const cancelled = mgr?.cancelTask(id) ?? false;
            if (!cancelled) {
                return sendError(res, 404, 'Task not found or not cancellable');
            }
            sendJSON(res, 200, { cancelled: true });
        },
    });

    // ------------------------------------------------------------------
    // POST /api/queue/:id/move-to-top — Move task to top of queue
    // ------------------------------------------------------------------
    routes.push({
        method: 'POST',
        pattern: /^\/api\/queue\/([^/]+)\/move-to-top$/,
        handler: async (_req, res, match) => {
            const id = decodeURIComponent(match![1]);
            const moved = bridge.findManagerForTask(id)?.moveToTop(id) ?? false;
            if (!moved) {
                return sendError(res, 404, 'Task not found in queue');
            }
            process.stderr.write(`[Queue] move-to-top task=${id}\n`);
            sendJSON(res, 200, { moved: true, position: 1 });
        },
    });

    // ------------------------------------------------------------------
    // POST /api/queue/:id/move-up — Move task up one position
    // ------------------------------------------------------------------
    routes.push({
        method: 'POST',
        pattern: /^\/api\/queue\/([^/]+)\/move-up$/,
        handler: async (_req, res, match) => {
            const id = decodeURIComponent(match![1]);
            const moved = bridge.findManagerForTask(id)?.moveUp(id) ?? false;
            if (!moved) {
                return sendError(res, 404, 'Task not found or already at top');
            }
            const position = bridge.findManagerForTask(id)?.getPosition(id);
            process.stderr.write(`[Queue] move-up task=${id}\n`);
            sendJSON(res, 200, { moved: true, position });
        },
    });

    // ------------------------------------------------------------------
    // POST /api/queue/:id/move-down — Move task down one position
    // ------------------------------------------------------------------
    routes.push({
        method: 'POST',
        pattern: /^\/api\/queue\/([^/]+)\/move-down$/,
        handler: async (_req, res, match) => {
            const id = decodeURIComponent(match![1]);
            const moved = bridge.findManagerForTask(id)?.moveDown(id) ?? false;
            if (!moved) {
                return sendError(res, 404, 'Task not found or already at bottom');
            }
            const position = bridge.findManagerForTask(id)?.getPosition(id);
            process.stderr.write(`[Queue] move-down task=${id}\n`);
            sendJSON(res, 200, { moved: true, position });
        },
    });

    // ------------------------------------------------------------------
    // POST /api/queue/:id/move-to/:position — Move task to arbitrary position
    // ------------------------------------------------------------------
    routes.push({
        method: 'POST',
        pattern: /^\/api\/queue\/([^/]+)\/move-to\/(\d+)$/,
        handler: async (_req, res, match) => {
            const id = decodeURIComponent(match![1]);
            const position = parseInt(match![2], 10);
            const moved = bridge.findManagerForTask(id)?.moveToPosition(id, position) ?? false;
            if (!moved) {
                return sendError(res, 404, 'Task not found in queue');
            }
            const finalPos = bridge.findManagerForTask(id)?.getPosition(id);
            process.stderr.write(`[Queue] move-to-position task=${id} position=${position}\n`);
            sendJSON(res, 200, { moved: true, position: finalPos });
        },
    });

    // ------------------------------------------------------------------
    // POST /api/queue/:id/freeze — Freeze a queued task
    // ------------------------------------------------------------------
    routes.push({
        method: 'POST',
        pattern: /^\/api\/queue\/([^/]+)\/freeze$/,
        handler: async (_req, res, match) => {
            const id = decodeURIComponent(match![1]);
            const frozen = bridge.findManagerForTask(id)?.freezeTask(id) ?? false;
            if (!frozen) {
                return sendError(res, 404, 'Task not found in queue');
            }
            process.stderr.write(`[Queue] freeze task=${id}\n`);
            const task = bridge.findManagerForTask(id)?.getTask(id);
            sendJSON(res, 200, { frozen: true, task });
        },
    });

    // ------------------------------------------------------------------
    // POST /api/queue/:id/unfreeze — Unfreeze a frozen queued task
    // ------------------------------------------------------------------
    routes.push({
        method: 'POST',
        pattern: /^\/api\/queue\/([^/]+)\/unfreeze$/,
        handler: async (_req, res, match) => {
            const id = decodeURIComponent(match![1]);
            const unfrozen = bridge.findManagerForTask(id)?.unfreezeTask(id) ?? false;
            if (!unfrozen) {
                return sendError(res, 404, 'Task not found in queue or not frozen');
            }
            process.stderr.write(`[Queue] unfreeze task=${id}\n`);
            const task = bridge.findManagerForTask(id)?.getTask(id);
            sendJSON(res, 200, { unfrozen: true, task });
        },
    });

    // ------------------------------------------------------------------
    // POST /api/queue/:id/admit — Admit a held autopilot task to run immediately
    // ------------------------------------------------------------------
    routes.push({
        method: 'POST',
        pattern: /^\/api\/queue\/([^/]+)\/admit$/,
        handler: async (_req, res, match) => {
            const id = decodeURIComponent(match![1]);
            const admitted = bridge.findManagerForTask(id)?.admitTask(id) ?? false;
            if (!admitted) {
                return sendError(res, 404, 'Task not found in queue');
            }
            process.stderr.write(`[Queue] admit task=${id}\n`);
            const task = bridge.findManagerForTask(id)?.getTask(id);
            sendJSON(res, 200, { admitted: true, task });
        },
    });

    // ------------------------------------------------------------------
    // POST /api/queue/:id/unadmit — Unadmit a previously admitted task
    // ------------------------------------------------------------------
    routes.push({
        method: 'POST',
        pattern: /^\/api\/queue\/([^/]+)\/unadmit$/,
        handler: async (_req, res, match) => {
            const id = decodeURIComponent(match![1]);
            const unadmitted = bridge.findManagerForTask(id)?.unadmitTask(id) ?? false;
            if (!unadmitted) {
                return sendError(res, 404, 'Task not found in queue or not admitted');
            }
            process.stderr.write(`[Queue] unadmit task=${id}\n`);
            const task = bridge.findManagerForTask(id)?.getTask(id);
            sendJSON(res, 200, { unadmitted: true, task });
        },
    });
}
