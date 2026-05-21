/**
 * Queue stats and list routes (read-only GET operations).
 *
 * GET /api/queue           — List queued/running tasks
 * GET /api/queue/stats     — Queue statistics
 * GET /api/queue/history   — Task history
 * GET /api/queue/repos     — Repos with queue states
 * GET /api/queue/:id       — Get single task
 * GET /api/queue/:id/resolved-prompt — Resolved prompt for a task
 */

import { sendJSON, sendError } from '../core/api-handler';
import { toQueueProcessId } from '@plusplusoneplusplus/forge';
import type { Route } from '../types';
import * as url from 'url';
import * as fs from 'fs';
import type { QueueStats, ProcessFilter } from '@plusplusoneplusplus/forge';
import {
    serializeTask,
    serializeTaskSummary,
    serializeQueueItemSummary,
    getAggregateStats,
    getManagerByRepoIdentifier,
    getRepoIdentifierFromQuery,
    VALID_TASK_TYPES,
    type QueueRouteContext,
} from './queue-shared';
import { processToHistorySummary, processToTaskDetail } from '../shared/process-history-mapper';

export function registerQueueStatsRoutes(routes: Route[], ctx: QueueRouteContext): void {
    const { bridge, store, state } = ctx;

    // ------------------------------------------------------------------
    // GET /api/queue — List all queued tasks
    // ------------------------------------------------------------------
    routes.push({
        method: 'GET',
        pattern: '/api/queue',
        handler: async (req, res) => {
            const parsed = url.parse(req.url || '/', true);
            const repoId = getRepoIdentifierFromQuery(parsed.query);
            const typeFilter = typeof parsed.query.type === 'string' && parsed.query.type
                ? parsed.query.type
                : undefined;

            if (typeFilter && !VALID_TASK_TYPES.has(typeFilter)) {
                return sendError(res, 400, `Invalid type filter: ${typeFilter}. Valid types: ${Array.from(VALID_TASK_TYPES).join(', ')}`);
            }

            let queued: Record<string, unknown>[];
            let running: Record<string, unknown>[];
            let stats: QueueStats;

            if (repoId) {
                const mgr = await getManagerByRepoIdentifier(repoId, bridge, store);
                if (mgr) {
                    queued = mgr.getQueueItems().map(serializeQueueItemSummary);
                    running = mgr.getRunning().map(serializeTaskSummary);
                    stats = mgr.getStats();
                } else {
                    queued = [];
                    running = [];
                    stats = { queued: 0, running: 0, completed: 0, failed: 0, cancelled: 0, total: 0, isPaused: false, isDraining: false, isAutopilotPaused: false };
                }
            } else {
                queued = [];
                running = [];
                for (const manager of bridge.registry.getAllQueues().values()) {
                    queued.push(...manager.getQueueItems().map(serializeQueueItemSummary));
                    running.push(...manager.getRunning().map(serializeTaskSummary));
                }
                stats = getAggregateStats(bridge, state);
            }

            if (typeFilter) {
                queued = queued.filter(t => t.kind === 'pause-marker' || t.type === typeFilter);
                running = running.filter(t => t.type === typeFilter);
            }

            // Enrich running tasks with `pendingAskUserCount` so the activity list can
            // immediately surface tasks that are waiting on the user for input (before
            // the WebSocket `process-updated` stream has had a chance to populate the
            // global process index on the client). Use the narrow batch lookup so we
            // don't load full process rows + all conversation turns just to read a
            // single JSON-array length out of `metadata`.
            if (store && running.length > 0) {
                const storeWithCounts = store as unknown as {
                    getPendingAskUserCounts?: (ids: readonly string[]) => Map<string, number>;
                };
                const ids: string[] = [];
                for (const task of running) {
                    if (typeof task.processId === 'string') ids.push(task.processId);
                }
                if (ids.length > 0 && typeof storeWithCounts.getPendingAskUserCounts === 'function') {
                    try {
                        const counts = storeWithCounts.getPendingAskUserCounts(ids);
                        for (const task of running) {
                            const pid = typeof task.processId === 'string' ? task.processId : undefined;
                            if (!pid) continue;
                            const n = counts.get(pid);
                            if (n && n > 0) task.pendingAskUserCount = n;
                        }
                    } catch {
                        // Best-effort enrichment — never fail the list response over it.
                    }
                } else if (ids.length > 0) {
                    // Fallback path for stores without the batch helper (e.g. file store).
                    await Promise.all(running.map(async (task) => {
                        const processId = typeof task.processId === 'string' ? task.processId : undefined;
                        if (!processId) return;
                        try {
                            const proc = await store.getProcess(processId);
                            const count = Array.isArray(proc?.pendingAskUser) ? proc!.pendingAskUser!.length : 0;
                            if (count > 0) task.pendingAskUserCount = count;
                        } catch {
                            // Best-effort enrichment — never fail the list response over it.
                        }
                    }));
                }
            }

            sendJSON(res, 200, { queued, running, stats });
        },
    });

    // ------------------------------------------------------------------
    // GET /api/queue/stats — Queue statistics
    // ------------------------------------------------------------------
    routes.push({
        method: 'GET',
        pattern: '/api/queue/stats',
        handler: async (req, res) => {
            const parsed = url.parse(req.url || '/', true);
            const repoId = getRepoIdentifierFromQuery(parsed.query);

            if (repoId) {
                const mgr = await getManagerByRepoIdentifier(repoId, bridge, store);
                if (!mgr) {
                    return sendError(res, 404, `No queue found for repoId: ${repoId}`);
                }
                sendJSON(res, 200, { stats: mgr.getStats() });
            } else {
                sendJSON(res, 200, { stats: getAggregateStats(bridge, state) });
            }
        },
    });

    // ------------------------------------------------------------------
    // GET /api/queue/history — Queue task history (store + in-memory merge)
    // ------------------------------------------------------------------
    routes.push({
        method: 'GET',
        pattern: '/api/queue/history',
        handler: async (req, res) => {
            const parsed = url.parse(req.url || '/', true);
            const repoId = getRepoIdentifierFromQuery(parsed.query);
            const typeFilter = typeof parsed.query.type === 'string' && parsed.query.type
                ? parsed.query.type
                : undefined;

            if (typeFilter && !VALID_TASK_TYPES.has(typeFilter)) {
                return sendError(res, 400, `Invalid type filter: ${typeFilter}. Valid types: ${Array.from(VALID_TASK_TYPES).join(', ')}`);
            }

            // 1. Collect in-memory queue history (catches tasks cancelled before execution)
            let inMemoryHistory: Record<string, unknown>[];
            if (repoId) {
                const mgr = await getManagerByRepoIdentifier(repoId, bridge, store);
                inMemoryHistory = mgr
                    ? mgr.getHistory().map(serializeTaskSummary)
                    : [];
            } else {
                inMemoryHistory = [];
                for (const m of bridge.registry.getAllQueues().values()) {
                    inMemoryHistory.push(...m.getHistory().map(serializeTaskSummary));
                }
            }

            // 2. Merge with durable process store entries (survives server restart)
            const seenIds = new Set(inMemoryHistory.map(t => t.id as string));
            let history = [...inMemoryHistory];

            if (store) {
                const filter: ProcessFilter = {
                    status: ['completed', 'failed', 'cancelled'],
                    exclude: ['conversation', 'toolCalls'],
                };
                if (repoId) {
                    const workspaces = await store.getWorkspaces();
                    const ws = workspaces.find(w => w.id === repoId);
                    filter.workspaceId = ws ? ws.id : repoId;
                }
                if (typeFilter) {
                    filter.type = typeFilter;
                }
                filter.limit = 200;

                const processes = await store.getAllProcesses(filter);
                for (const proc of processes) {
                    const summary = processToHistorySummary(proc);
                    if (!seenIds.has(summary.id)) {
                        seenIds.add(summary.id);
                        history.push(summary as unknown as Record<string, unknown>);
                    }
                }
            }

            if (typeFilter) {
                history = history.filter(t => t.type === typeFilter);
            }

            // Sort by completedAt/createdAt descending (newest first)
            history.sort((a, b) => {
                const ta = (a.completedAt as number) ?? (a.createdAt as number) ?? 0;
                const tb = (b.completedAt as number) ?? (b.createdAt as number) ?? 0;
                return tb - ta;
            });

            // NOTE: chat type no longer has special handling here;
            // the activity tab uses GET /api/workspaces/:id/history instead.

            const pipelineName = typeof parsed.query.pipelineName === 'string' && parsed.query.pipelineName
                ? parsed.query.pipelineName
                : undefined;
            if (pipelineName) {
                history = history.filter(t =>
                    (t as any).payload?.pipelineName === pipelineName ||
                    (t as any).metadata?.pipelineName === pipelineName ||
                    (t as any).displayName?.includes(pipelineName)
                );
            }

            sendJSON(res, 200, { history });
        },
    });

    // ------------------------------------------------------------------
    // GET /api/queue/repos — List repos with pause states and task counts
    // ------------------------------------------------------------------
    routes.push({
        method: 'GET',
        pattern: '/api/queue/repos',
        handler: async (_req, res) => {
            const repos: Array<{ repoId: string; rootPath: string; isPaused: boolean; taskCount: number; queuedCount: number; runningCount: number }> = [];

            for (const [rootPath, m] of bridge.registry.getAllQueues()) {
                const repoId = bridge.getRepoIdForPath(rootPath);
                const queuedCount = m.getQueued().length;
                const runningCount = m.getRunning().length;
                repos.push({
                    repoId,
                    rootPath,
                    isPaused: m.isPaused(),
                    taskCount: queuedCount + runningCount,
                    queuedCount,
                    runningCount,
                });
            }

            sendJSON(res, 200, { repos });
        },
    });

    // ------------------------------------------------------------------
    // GET /api/queue/:id/resolved-prompt — Resolve full prompt with plan file content
    // ------------------------------------------------------------------
    routes.push({
        method: 'GET',
        pattern: /^\/api\/queue\/([^/]+)\/resolved-prompt$/,
        handler: async (_req, res, match) => {
            const id = decodeURIComponent(match![1]);
            const task = bridge.findManagerForTask(id)?.getTask(id);
            if (!task) {
                return sendError(res, 404, 'Task not found');
            }

            const payload = task.payload as any;
            const result: Record<string, unknown> = { taskId: id, type: task.type };

            const planFilePath: string | undefined =
                payload?.planFilePath ??
                (Array.isArray(payload?.context?.files) && typeof payload.context.files[0] === 'string'
                    ? payload.context.files[0]
                    : undefined);
            if (planFilePath) {
                result.planFilePath = planFilePath;
                try {
                    if (fs.existsSync(planFilePath)) {
                        result.planFileContent = fs.readFileSync(planFilePath, 'utf-8');
                    }
                } catch {
                    // Non-fatal: plan file may be inaccessible
                }
            }

            if (payload?.promptFilePath) {
                result.promptFilePath = payload.promptFilePath;
                try {
                    if (fs.existsSync(payload.promptFilePath)) {
                        result.promptFileContent = fs.readFileSync(payload.promptFilePath, 'utf-8');
                    }
                } catch {
                    // Non-fatal
                }
            }

            const parts: string[] = [];
            if (result.planFileContent) {
                parts.push('=== Plan File ===\n' + result.planFileContent);
            }
            if (payload?.additionalContext) {
                parts.push('=== Additional Context ===\n' + payload.additionalContext);
            }
            if (payload?.promptContent) {
                parts.push('=== Prompt Content ===\n' + payload.promptContent);
            } else if (payload?.prompt) {
                parts.push('=== Prompt ===\n' + payload.prompt);
            } else if (payload?.promptTemplate) {
                parts.push('=== Prompt ===\n' + payload.promptTemplate);
            }
            if (parts.length > 0) {
                result.resolvedPrompt = parts.join('\n\n');
            }

            sendJSON(res, 200, result);
        },
    });

    // ------------------------------------------------------------------
    // GET /api/queue/:id — Get a single task by ID
    // ------------------------------------------------------------------
    routes.push({
        method: 'GET',
        pattern: /^\/api\/queue\/([^/]+)$/,
        handler: async (_req, res, match) => {
            const id = decodeURIComponent(match![1]);

            // Skip known sub-routes
            if (['stats', 'history', 'pause', 'resume', 'pause-autopilot', 'resume-autopilot', 'force-fail-running', 'bulk', 'repos', 'pause-marker', 'summarize'].includes(id)) {
                return sendError(res, 404, 'Task not found');
            }

            const task = bridge.findManagerForTask(id)?.getTask(id);
            if (task) {
                return sendJSON(res, 200, { task: serializeTask(task) });
            }

            // Fallback: check process store for completed/historical tasks
            if (store) {
                const processId = toQueueProcessId(id);
                const proc = await store.getProcess(processId) ?? await store.getProcess(id);
                if (proc) {
                    const reconstructed = processToTaskDetail(proc);
                    return sendJSON(res, 200, { task: serializeTask(reconstructed as import('@plusplusoneplusplus/forge').QueuedTask) });
                }
            }

            return sendError(res, 404, 'Task not found');
        },
    });
}
