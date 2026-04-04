/**
 * Repo Memory Handler
 *
 * Registers repo-scoped /api/repos/:repoId/memory/* REST endpoints.
 * Provides a unified feed of pipeline observations + user notes,
 * CRUD for user notes, stats, and AI-powered aggregation with SSE streaming.
 *
 * No VS Code dependencies — pure Node.js.
 * Cross-platform compatible (Linux/Mac/Windows).
 */

import * as fs from 'fs';
import * as path from 'path';
import * as url from 'url';
import type { ProcessStore, AIInvoker, TaskQueueManager } from '@plusplusoneplusplus/forge';
import { FileMemoryStore as PipelineMemoryStore } from '@plusplusoneplusplus/forge';
import type { Route } from '../types';
import { sendJson, readJsonBody, send400, send404, send500 } from '../router';
import { readMemoryConfig } from './memory-config-handler';
import { FileMemoryStore } from './memory-store';
import { getRepoDataPath } from '../paths';

// ============================================================================
// Types
// ============================================================================

/** Unified feed entry merging pipeline observations and user notes. */
export interface FeedItem {
    /** Filename (for observations) or entry id (for notes). */
    id: string;
    type: 'observation' | 'note';
    /** Pipeline name (observation) or 'manual' (note). */
    source: string;
    content: string;
    /** Empty for observations. */
    tags: string[];
    /** ISO-8601 creation timestamp. */
    createdAt: string;
}

/** Single line in a text diff. */
export interface DiffLine {
    type: 'add' | 'remove' | 'unchanged';
    text: string;
}

export interface RepoMemoryRouteOptions {
    /** Process store used to resolve workspace rootPath from workspaceId. */
    store: ProcessStore;
    /** AI invoker for the aggregate endpoint. When absent the endpoint returns 503. */
    aiInvoker?: AIInvoker;
    /** Queue facade for enqueuing memory-aggregate tasks. When absent aggregate returns 503. */
    queueFacade?: TaskQueueManager;
}

// ============================================================================
// Private helpers
// ============================================================================

function getNoteStore(dataDir: string, workspaceId: string): FileMemoryStore {
    const noteDir = getRepoDataPath(dataDir, workspaceId, path.join('memory', 'notes'));
    return new FileMemoryStore(noteDir);
}

function getPipelineStore(dataDir: string, workspaceId: string): PipelineMemoryStore {
    const config = readMemoryConfig(dataDir);
    const repoDir = getRepoDataPath(dataDir, workspaceId, path.join('memory', 'pipeline'));
    return new PipelineMemoryStore({ dataDir: config.storageDir, repoDir });
}

async function getRepoRootPath(store: ProcessStore, workspaceId: string): Promise<string | undefined> {
    const workspaces = await store.getWorkspaces();
    return workspaces.find(w => w.id === workspaceId)?.rootPath;
}

/** Backup path for consolidated.md before aggregation (enables revert). */
function consolidatedPrevPath(dataDir: string, workspaceId: string): string {
    return path.join(getRepoDataPath(dataDir, workspaceId, path.join('memory', 'pipeline')), 'consolidated.prev.md');
}

/**
 * Compute a line-by-line diff using LCS (Myers-style traceback).
 * For large inputs the diff is truncated to avoid memory pressure.
 */
export function computeDiff(prev: string, next: string): DiffLine[] {
    const prevLines = prev === '' ? [] : prev.split('\n');
    const nextLines = next === '' ? [] : next.split('\n');
    const m = prevLines.length;
    const n = nextLines.length;

    // Build LCS table
    const dp: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
    for (let i = 1; i <= m; i++) {
        for (let j = 1; j <= n; j++) {
            if (prevLines[i - 1] === nextLines[j - 1]) {
                dp[i][j] = dp[i - 1][j - 1] + 1;
            } else {
                dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
            }
        }
    }

    // Traceback
    const result: DiffLine[] = [];
    let i = m, j = n;
    while (i > 0 || j > 0) {
        if (i > 0 && j > 0 && prevLines[i - 1] === nextLines[j - 1]) {
            result.unshift({ type: 'unchanged', text: prevLines[i - 1] });
            i--; j--;
        } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
            result.unshift({ type: 'add', text: nextLines[j - 1] });
            j--;
        } else {
            result.unshift({ type: 'remove', text: prevLines[i - 1] });
            i--;
        }
    }

    return result;
}

// ============================================================================
// Route registration
// ============================================================================

/**
 * Register all repo-scoped memory endpoints on the given route table.
 * Mutates the `routes` array in-place.
 *
 * Routes registered:
 *   GET  /api/repos/:repoId/memory/overview          — merged feed + stats in one response
 *   POST /api/repos/:repoId/memory/notes             — create user note
 *   DELETE /api/repos/:repoId/memory/feed/:id        — delete observation or note
 *   GET  /api/repos/:repoId/memory/consolidated      — read consolidated.md content
 *   POST /api/repos/:repoId/memory/aggregate/accept  — accept aggregation (clean backup)
 *   POST /api/repos/:repoId/memory/aggregate/revert  — revert to pre-aggregation state
 *   POST /api/repos/:repoId/memory/aggregate         — enqueue AI aggregation (returns taskId/processId)
 */
export function registerRepoMemoryRoutes(
    routes: Route[],
    dataDir: string,
    options: RepoMemoryRouteOptions,
): void {
    const { store, queueFacade } = options;

    // -- GET /api/repos/:repoId/memory/overview ------------------------------

    routes.push({
        method: 'GET',
        pattern: /^\/api\/repos\/([^/]+)\/memory\/overview$/,
        handler: async (_req, res, match) => {
            try {
                const workspaceId = decodeURIComponent(match![1]);
                const repoPath = await getRepoRootPath(store, workspaceId);
                if (!repoPath) {
                    send404(res, `Repo not found: ${workspaceId}`);
                    return;
                }

                const pipelineStore = getPipelineStore(dataDir, workspaceId);
                const noteStore = getNoteStore(dataDir, workspaceId);

                const [obsFilenames, noteResult, pipelineStats] = await Promise.all([
                    pipelineStore.listRaw('repo', undefined),
                    Promise.resolve(noteStore.list({ pageSize: 10000 })),
                    pipelineStore.getStats('repo'),
                ]);

                const obsItems = await Promise.all(
                    obsFilenames.map(async (filename): Promise<FeedItem | null> => {
                        const obs = await pipelineStore.readRaw('repo', undefined, filename);
                        if (!obs) return null;
                        return {
                            id: filename,
                            type: 'observation',
                            source: obs.metadata.pipeline,
                            content: obs.content,
                            tags: [],
                            createdAt: obs.metadata.timestamp,
                        };
                    }),
                );

                const noteItems: FeedItem[] = noteResult.entries.map(entry => {
                    const full = noteStore.get(entry.id);
                    return {
                        id: entry.id,
                        type: 'note' as const,
                        source: entry.source,
                        content: full?.content ?? '',
                        tags: entry.tags,
                        createdAt: entry.createdAt,
                    };
                });

                const items: FeedItem[] = [
                    ...obsItems.filter((item): item is FeedItem => item !== null),
                    ...noteItems,
                ].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

                // Consolidation status from queue
                let consolidationStatus: 'idle' | 'queued' | 'running' = 'idle';
                let consolidationTaskId: string | undefined;
                let consolidationProcessId: string | undefined;
                if (queueFacade) {
                    const queued = queueFacade.getQueued();
                    const running = queueFacade.getRunning();
                    const all = [...queued, ...running];
                    const active = all.find(
                        t => t.type === 'memory-aggregate' && (t.payload as any).repoId === workspaceId,
                    );
                    if (active) {
                        consolidationStatus = active.status === 'running' ? 'running' : 'queued';
                        consolidationTaskId = active.id;
                        consolidationProcessId = active.processId ?? `queue_${active.id}`;
                    }
                }

                sendJson(res, {
                    observationCount: pipelineStats.rawCount,
                    noteCount: noteResult.total,
                    consolidatedAt: pipelineStats.lastAggregation,
                    consolidationStatus,
                    consolidationTaskId,
                    consolidationProcessId,
                    items,
                    totalCount: items.length,
                });
            } catch (err) {
                send500(res, err instanceof Error ? err.message : String(err));
            }
        },
    });

    // -- POST /api/repos/:repoId/memory/notes --------------------------------

    routes.push({
        method: 'POST',
        pattern: /^\/api\/repos\/([^/]+)\/memory\/notes$/,
        handler: async (req, res, match) => {
            try {
                const workspaceId = decodeURIComponent(match![1]);
                const body = await readJsonBody<{ content?: string; tags?: string[] }>(req);

                if (!body.content || typeof body.content !== 'string' || body.content.trim() === '') {
                    send400(res, 'Missing required field: content');
                    return;
                }

                const noteStore = getNoteStore(dataDir, workspaceId);
                const entry = noteStore.create({
                    content: body.content.trim(),
                    tags: Array.isArray(body.tags) ? body.tags.filter(t => typeof t === 'string') : [],
                    source: 'manual',
                });

                const item: FeedItem = {
                    id: entry.id,
                    type: 'note',
                    source: entry.source,
                    content: entry.content,
                    tags: entry.tags,
                    createdAt: entry.createdAt,
                };

                sendJson(res, item, 201);
            } catch (err) {
                send500(res, err instanceof Error ? err.message : String(err));
            }
        },
    });

    // -- DELETE /api/repos/:repoId/memory/feed/:id ---------------------------

    routes.push({
        method: 'DELETE',
        pattern: /^\/api\/repos\/([^/]+)\/memory\/feed\/([^/]+)$/,
        handler: async (req, res, match) => {
            try {
                const workspaceId = decodeURIComponent(match![1]);
                const id = decodeURIComponent(match![2]);
                const parsedUrl = url.parse(req.url ?? '', true);
                const type = typeof parsedUrl.query.type === 'string' ? parsedUrl.query.type : undefined;

                if (!type || (type !== 'observation' && type !== 'note')) {
                    send400(res, 'Query parameter "type" must be "observation" or "note"');
                    return;
                }

                if (type === 'observation') {
                    const repoPath = await getRepoRootPath(store, workspaceId);
                    if (!repoPath) {
                        send404(res, `Repo not found: ${workspaceId}`);
                        return;
                    }
                    const pipelineStore = getPipelineStore(dataDir, workspaceId);
                    const deleted = await pipelineStore.deleteRaw('repo', undefined, id);
                    if (!deleted) {
                        send404(res, `Observation not found: ${id}`);
                        return;
                    }
                } else {
                    const noteStore = getNoteStore(dataDir, workspaceId);
                    const deleted = noteStore.delete(id);
                    if (!deleted) {
                        send404(res, `Note not found: ${id}`);
                        return;
                    }
                }

                sendJson(res, { success: true });
            } catch (err) {
                send500(res, err instanceof Error ? err.message : String(err));
            }
        },
    });

    // -- GET /api/repos/:repoId/memory/consolidated ---------------------------

    routes.push({
        method: 'GET',
        pattern: /^\/api\/repos\/([^/]+)\/memory\/consolidated$/,
        handler: async (_req, res, match) => {
            try {
                const workspaceId = decodeURIComponent(match![1]);
                const repoPath = await getRepoRootPath(store, workspaceId);
                if (!repoPath) {
                    send404(res, `Repo not found: ${workspaceId}`);
                    return;
                }

                const pipelineStore = getPipelineStore(dataDir, workspaceId);
                const content = await pipelineStore.readConsolidated('repo');
                if (content === null) {
                    send404(res, 'No consolidated memory yet');
                    return;
                }

                sendJson(res, { content });
            } catch (err) {
                send500(res, err instanceof Error ? err.message : String(err));
            }
        },
    });

    // -- POST /api/repos/:repoId/memory/aggregate/accept ---------------------
    // Registered before the aggregate route to avoid ambiguity

    routes.push({
        method: 'POST',
        pattern: /^\/api\/repos\/([^/]+)\/memory\/aggregate\/accept$/,
        handler: async (_req, res, match) => {
            try {
                const workspaceId = decodeURIComponent(match![1]);
                const prevPath = consolidatedPrevPath(dataDir, workspaceId);
                try {
                    fs.unlinkSync(prevPath);
                } catch {
                    // File may not exist — that is fine, accept is idempotent
                }
                sendJson(res, { success: true });
            } catch (err) {
                send500(res, err instanceof Error ? err.message : String(err));
            }
        },
    });

    // -- POST /api/repos/:repoId/memory/aggregate/revert ---------------------

    routes.push({
        method: 'POST',
        pattern: /^\/api\/repos\/([^/]+)\/memory\/aggregate\/revert$/,
        handler: async (_req, res, match) => {
            try {
                const workspaceId = decodeURIComponent(match![1]);
                const repoPath = await getRepoRootPath(store, workspaceId);
                if (!repoPath) {
                    send404(res, `Repo not found: ${workspaceId}`);
                    return;
                }

                const prevPath = consolidatedPrevPath(dataDir, workspaceId);
                if (!fs.existsSync(prevPath)) {
                    send404(res, 'No backup found; run aggregate first');
                    return;
                }

                const prevContent = fs.readFileSync(prevPath, 'utf-8');
                const pipelineStore = getPipelineStore(dataDir, workspaceId);
                await pipelineStore.writeConsolidated('repo', prevContent);

                try {
                    fs.unlinkSync(prevPath);
                } catch {
                    // Ignore cleanup error
                }

                sendJson(res, { success: true });
            } catch (err) {
                send500(res, err instanceof Error ? err.message : String(err));
            }
        },
    });

    // -- POST /api/repos/:repoId/memory/aggregate -----------------------------
    // Enqueues a memory-aggregate task. Returns 202 with { taskId, processId }.
    // Returns 409 if a consolidation is already queued/running for this repo.

    routes.push({
        method: 'POST',
        pattern: /^\/api\/repos\/([^/]+)\/memory\/aggregate$/,
        handler: async (req, res, match) => {
            const workspaceId = decodeURIComponent(match![1]);

            try {
                if (!queueFacade) {
                    send500(res, 'Queue not configured');
                    return;
                }

                const repoPath = await getRepoRootPath(store, workspaceId);
                if (!repoPath) {
                    send404(res, `Repo not found: ${workspaceId}`);
                    return;
                }

                // Check for existing active task
                const queued = queueFacade.getQueued();
                const running = queueFacade.getRunning();
                const active = [...queued, ...running].find(
                    t => t.type === 'memory-aggregate' && (t.payload as any).repoId === workspaceId,
                );
                if (active) {
                    sendJson(res, {
                        status: 'already-running',
                        taskId: active.id,
                        processId: active.processId ?? `queue_${active.id}`,
                    }, 409);
                    return;
                }

                const body = await readJsonBody<{
                    sources?: string[];
                    model?: string;
                }>(req);

                // Map client-facing aliases to internal names
                const rawSources = Array.isArray(body.sources) && body.sources.length > 0
                    ? body.sources
                    : ['user', 'ai'];
                const sources = rawSources.map(s =>
                    s === 'user' ? 'notes' : s === 'ai' ? 'observations' : s,
                ) as ('notes' | 'observations')[];

                const taskId = queueFacade.enqueue({
                    type: 'memory-aggregate',
                    repoId: workspaceId,
                    payload: {
                        kind: 'memory-aggregate' as const,
                        repoId: workspaceId,
                        sources,
                        model: body.model,
                    },
                    priority: 'normal' as const,
                    config: {},
                    concurrencyMode: 'exclusive' as const,
                    displayName: 'Memory Consolidation',
                });

                sendJson(res, { taskId, processId: `queue_${taskId}` }, 202);
            } catch (err) {
                send500(res, err instanceof Error ? err.message : String(err));
            }
        },
    });
}
