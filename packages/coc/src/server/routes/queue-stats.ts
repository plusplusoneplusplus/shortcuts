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

import { sendJSON, sendError } from '../api-handler';
import type { Route } from '../types';
import * as url from 'url';
import * as fs from 'fs';
import type { QueueStats } from '@plusplusoneplusplus/forge';
import {
    serializeTask,
    serializeQueueItem,
    enrichChatTasks,
    getAggregateStats,
    getManagerByRepoIdentifier,
    VALID_TASK_TYPES,
    type QueueRouteContext,
} from './queue-shared';

export function registerQueueStatsRoutes(routes: Route[], ctx: QueueRouteContext): void {
    const { bridge, store, globalWorkspaceRootPath, state } = ctx;

    // ------------------------------------------------------------------
    // GET /api/queue — List all queued tasks
    // ------------------------------------------------------------------
    routes.push({
        method: 'GET',
        pattern: '/api/queue',
        handler: async (req, res) => {
            const parsed = url.parse(req.url || '/', true);
            const repoId = typeof parsed.query.repoId === 'string' && parsed.query.repoId
                ? parsed.query.repoId
                : undefined;
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
                    queued = mgr.getQueueItems().map(serializeQueueItem);
                    running = mgr.getRunning().map(serializeTask);
                    stats = mgr.getStats();
                } else {
                    queued = [];
                    running = [];
                    stats = { queued: 0, running: 0, completed: 0, failed: 0, cancelled: 0, total: 0, isPaused: false, isDraining: false, isAutopilotPaused: false };
                }
            } else {
                const globalPath = globalWorkspaceRootPath ?? process.cwd();
                const globalMgr = bridge.registry.getQueueForRepo(globalPath);
                queued = globalMgr.getQueueItems().map(serializeQueueItem);
                running = globalMgr.getRunning().map(serializeTask);
                stats = globalMgr.getStats();
            }

            if (typeFilter) {
                queued = queued.filter(t => t.kind === 'pause-marker' || t.type === typeFilter);
                running = running.filter(t => t.type === typeFilter);
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
            const repoId = typeof parsed.query.repoId === 'string' && parsed.query.repoId
                ? parsed.query.repoId
                : undefined;

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
    // GET /api/queue/history — Queue task history
    // ------------------------------------------------------------------
    routes.push({
        method: 'GET',
        pattern: '/api/queue/history',
        handler: async (req, res) => {
            const parsed = url.parse(req.url || '/', true);
            const repoId = typeof parsed.query.repoId === 'string' && parsed.query.repoId
                ? parsed.query.repoId
                : undefined;
            const typeFilter = typeof parsed.query.type === 'string' && parsed.query.type
                ? parsed.query.type
                : undefined;

            if (typeFilter && !VALID_TASK_TYPES.has(typeFilter)) {
                return sendError(res, 400, `Invalid type filter: ${typeFilter}. Valid types: ${Array.from(VALID_TASK_TYPES).join(', ')}`);
            }

            let history: Record<string, unknown>[];
            if (repoId) {
                const mgr = await getManagerByRepoIdentifier(repoId, bridge, store);
                history = mgr
                    ? mgr.getHistory().map(serializeTask)
                    : [];
            } else {
                const globalPath = globalWorkspaceRootPath ?? process.cwd();
                const globalMgr = bridge.registry.getQueueForRepo(globalPath);
                history = globalMgr.getHistory().map(serializeTask);
            }

            if (typeFilter) {
                history = history.filter(t => t.type === typeFilter);
            }

            if (typeFilter === 'chat') {
                const seenIds = new Set(history.map(t => t.id as string));
                const collectActive = (mgr: import('@plusplusoneplusplus/forge').TaskQueueManager) => {
                    for (const task of [...mgr.getRunning(), ...mgr.getQueued()]) {
                        if (
                            (task.type as string) === 'chat' &&
                            !seenIds.has(task.id)
                        ) {
                            seenIds.add(task.id);
                            history.push(serializeTask(task));
                        }
                    }
                };
                if (repoId) {
                    const mgr = await getManagerByRepoIdentifier(repoId, bridge, store);
                    if (mgr) collectActive(mgr);
                } else {
                    const globalPath = globalWorkspaceRootPath ?? process.cwd();
                    const globalMgr = bridge.registry.getQueueForRepo(globalPath);
                    collectActive(globalMgr);
                }
                history.sort((a, b) => {
                    const ta = (a.createdAt as number) ?? 0;
                    const tb = (b.createdAt as number) ?? 0;
                    return tb - ta;
                });
            }

            const pipelineName = typeof parsed.query.pipelineName === 'string' && parsed.query.pipelineName
                ? parsed.query.pipelineName
                : undefined;
            if (pipelineName) {
                history = history.filter(t =>
                    (t as any).metadata?.pipelineName === pipelineName ||
                    (t as any).displayName?.includes(pipelineName)
                );
            }

            if (typeFilter === 'chat') {
                await enrichChatTasks(history, store);
                history.sort((a, b) => {
                    const ta = ((a as any).chatMeta?.lastActivityAt as number) ?? (a.createdAt as number) ?? 0;
                    const tb = ((b as any).chatMeta?.lastActivityAt as number) ?? (b.createdAt as number) ?? 0;
                    return tb - ta;
                });
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
            if (!task) {
                return sendError(res, 404, 'Task not found');
            }
            sendJSON(res, 200, { task: serializeTask(task) });
        },
    });
}
