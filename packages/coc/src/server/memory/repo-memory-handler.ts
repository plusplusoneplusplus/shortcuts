/**
 * Repo Memory Handler
 *
 * Registers repo-scoped /api/repos/:repoId/memory/* REST endpoints.
 * Provides bounded MEMORY.md CRUD for per-repo memory.
 *
 * No VS Code dependencies — pure Node.js.
 * Cross-platform compatible (Linux/Mac/Windows).
 */

import * as fs from 'fs';
import * as path from 'path';
import * as url from 'url';
import Database from 'better-sqlite3';
import type { ProcessStore, TaskQueueManager } from '@plusplusoneplusplus/forge';
import { DEFAULT_CHAR_LIMIT, scanMemoryContent, RawMemoryRecordStore } from '@plusplusoneplusplus/forge';
import type { Route } from '../types';
import { sendJson, readJsonBody, send400, send404, send500 } from '../router';
import { getRepoDataPath } from '../paths';
import { TaskDefs } from '../task-types';

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
    /** Task queue manager for aggregate-task status and manual trigger. */
    queueManager?: TaskQueueManager;
}

// ============================================================================
// Private helpers
// ============================================================================

async function getRepoRootPath(store: ProcessStore, workspaceId: string): Promise<string | undefined> {
    const workspaces = await store.getWorkspaces();
    return workspaces.find(w => w.id === workspaceId)?.rootPath;
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
 *   GET  /api/repos/:repoId/memory/overview   — bounded MEMORY.md stats
 *   GET  /api/repos/:repoId/memory/bounded    — read MEMORY.md content
 *   PUT  /api/repos/:repoId/memory/bounded    — write MEMORY.md content (security scanned)
 */
export function registerRepoMemoryRoutes(
    routes: Route[],
    dataDir: string,
    options: RepoMemoryRouteOptions,
): void {
    const { store, queueManager } = options;

    /**
     * Find the most recent memory-aggregate task for a workspace from the queue.
     * Returns undefined if no queueManager or no matching task.
     */
    function findAggregateTask(workspaceId: string, target: string): {
        status: 'idle' | 'queued' | 'running';
        taskId?: string;
        processId?: string;
        lastAggregatedAt?: string;
        lastAggregateError?: string;
    } {
        if (!queueManager) return { status: 'idle' };

        const tasks = queueManager.getAll()
            .filter(t =>
                t.type === TaskDefs.memoryAggregate.kind
                && (t.payload as any)?.workspaceId === workspaceId
                && (t.payload as any)?.target === target,
            )
            .sort((a, b) => b.createdAt - a.createdAt);

        // Check for active (queued/running) task
        const active = tasks.find(t => t.status === 'queued' || t.status === 'running');
        if (active) {
            return {
                status: active.status === 'running' ? 'running' : 'queued',
                taskId: active.id,
                processId: active.processId,
            };
        }

        // Check for most recent completed/failed task
        const completed = tasks.find(t => t.status === 'completed');
        const failed = tasks.find(t => t.status === 'failed');

        return {
            status: 'idle',
            lastAggregatedAt: completed?.completedAt ? new Date(completed.completedAt).toISOString() : undefined,
            lastAggregateError: failed?.error,
        };
    }

    /**
     * Get raw-record counts from RawMemoryRecordStore, handling missing DB gracefully.
     */
    async function getRawRecordCounts(workspaceId: string): Promise<{ pendingRawCount: number; claimedRawCount: number }> {
        const rawDbPath = getRepoDataPath(dataDir, workspaceId, path.join('memory', 'raw-memory.db'));
        if (!fs.existsSync(rawDbPath)) {
            return { pendingRawCount: 0, claimedRawCount: 0 };
        }
        let rawStore: RawMemoryRecordStore | undefined;
        try {
            rawStore = new RawMemoryRecordStore({ dbPath: rawDbPath });
            const stats = await rawStore.getStats();
            return { pendingRawCount: stats.pending, claimedRawCount: stats.claimed };
        } catch {
            return { pendingRawCount: 0, claimedRawCount: 0 };
        } finally {
            try { rawStore?.close(); } catch { /* already closed */ }
        }
    }

    // -- GET /api/repos/:repoId/memory/overview (with raw-record + aggregate status) --

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

                // Read bounded MEMORY.md stats
                const memoryPath = getRepoDataPath(dataDir, workspaceId, path.join('memory', 'MEMORY.md'));
                let charCount = 0;
                let lastModified: string | null = null;
                try {
                    const content = fs.readFileSync(memoryPath, 'utf-8');
                    charCount = content.length;
                    const stat = fs.statSync(memoryPath);
                    lastModified = stat.mtime.toISOString();
                } catch {
                    // File doesn't exist yet
                }

                // Raw-record counts
                const rawCounts = await getRawRecordCounts(workspaceId);

                // Aggregate task status
                const aggregateInfo = findAggregateTask(workspaceId, 'memory');

                sendJson(res, {
                    charCount,
                    charLimit: DEFAULT_CHAR_LIMIT,
                    lastModified,
                    pendingRawCount: rawCounts.pendingRawCount,
                    claimedRawCount: rawCounts.claimedRawCount,
                    consolidationStatus: aggregateInfo.status,
                    consolidationTaskId: aggregateInfo.taskId,
                    consolidationProcessId: aggregateInfo.processId,
                    lastAggregatedAt: aggregateInfo.lastAggregatedAt ?? null,
                    lastAggregateError: aggregateInfo.lastAggregateError ?? null,
                });
            } catch (err) {
                send500(res, err instanceof Error ? err.message : String(err));
            }
        },
    });

    // -- GET /api/repos/:repoId/memory/bounded --------------------------------

    routes.push({
        method: 'GET',
        pattern: /^\/api\/repos\/([^/]+)\/memory\/bounded$/,
        handler: async (_req, res, match) => {
            try {
                const workspaceId = decodeURIComponent(match![1]);
                const memoryPath = getRepoDataPath(dataDir, workspaceId, path.join('memory', 'MEMORY.md'));

                let content = '';
                try {
                    content = fs.readFileSync(memoryPath, 'utf-8');
                } catch {
                    // File doesn't exist yet — return empty
                }

                let lastModified: string | null = null;
                try {
                    const stat = fs.statSync(memoryPath);
                    lastModified = stat.mtime.toISOString();
                } catch {
                    // File doesn't exist
                }

                sendJson(res, {
                    content,
                    charCount: content.length,
                    charLimit: DEFAULT_CHAR_LIMIT,
                    lastModified,
                });
            } catch (err) {
                send500(res, err instanceof Error ? err.message : String(err));
            }
        },
    });

    // -- PUT /api/repos/:repoId/memory/bounded --------------------------------

    routes.push({
        method: 'PUT',
        pattern: /^\/api\/repos\/([^/]+)\/memory\/bounded$/,
        handler: async (req, res, match) => {
            try {
                const workspaceId = decodeURIComponent(match![1]);
                const body = await readJsonBody<{ content?: string }>(req);

                if (typeof body.content !== 'string') {
                    send400(res, 'Missing required field: content');
                    return;
                }

                const content = body.content;

                // Security scan
                const scan = scanMemoryContent(content);
                if (scan.blocked) {
                    sendJson(res, {
                        error: 'Security violation',
                        violations: [scan.reason],
                        patternId: scan.patternId,
                    }, 422);
                    return;
                }

                // Char limit check
                if (content.length > DEFAULT_CHAR_LIMIT) {
                    sendJson(res, {
                        error: 'Content exceeds character limit',
                        charCount: content.length,
                        charLimit: DEFAULT_CHAR_LIMIT,
                    }, 413);
                    return;
                }

                const memoryPath = getRepoDataPath(dataDir, workspaceId, path.join('memory', 'MEMORY.md'));
                fs.mkdirSync(path.dirname(memoryPath), { recursive: true });
                fs.writeFileSync(memoryPath, content, 'utf-8');

                let lastModified: string | null = null;
                try {
                    const stat = fs.statSync(memoryPath);
                    lastModified = stat.mtime.toISOString();
                } catch {
                    // Should not happen
                }

                sendJson(res, {
                    charCount: content.length,
                    charLimit: DEFAULT_CHAR_LIMIT,
                    lastModified,
                });
            } catch (err) {
                send500(res, err instanceof Error ? err.message : String(err));
            }
        },
    });

    // -- POST /api/repos/:repoId/memory/aggregate (manual trigger) ------------

    routes.push({
        method: 'POST',
        pattern: /^\/api\/repos\/([^/]+)\/memory\/aggregate$/,
        handler: async (req, res, match) => {
            try {
                const workspaceId = decodeURIComponent(match![1]);

                if (!queueManager) {
                    send500(res, 'Queue manager not available');
                    return;
                }

                const repoPath = await getRepoRootPath(store, workspaceId);
                if (!repoPath) {
                    send404(res, `Repo not found: ${workspaceId}`);
                    return;
                }

                const body = await readJsonBody<{ model?: string; target?: string }>(req);
                const target = (body.target === 'system' ? 'system' : 'memory') as 'memory' | 'system';

                // Dedupe check: is there already a queued or running task?
                const existing = queueManager.getAll()
                    .find(t =>
                        t.type === TaskDefs.memoryAggregate.kind
                        && (t.payload as any)?.workspaceId === workspaceId
                        && (t.payload as any)?.target === target
                        && (t.status === 'queued' || t.status === 'running'),
                    );

                if (existing) {
                    sendJson(res, {
                        taskId: existing.id,
                        processId: existing.processId ?? null,
                        status: existing.status === 'running' ? 'already-running' : 'already-queued',
                    }, 409);
                    return;
                }

                // Enqueue new task
                const taskId = queueManager.enqueue({
                    type: TaskDefs.memoryAggregate.kind,
                    repoId: workspaceId,
                    priority: 'low',
                    payload: {
                        kind: 'memory-aggregate' as const,
                        workspaceId,
                        target,
                        trigger: 'manual',
                        ...(body.model ? { model: body.model } : {}),
                    },
                    config: {},
                    displayName: `Memory aggregate (${target})`,
                });

                sendJson(res, {
                    taskId,
                    processId: null,
                    status: 'queued',
                });
            } catch (err) {
                send500(res, err instanceof Error ? err.message : String(err));
            }
        },
    });

    // -- GET /api/repos/:repoId/memory/raw-db/tables ---------------------------

    routes.push({
        method: 'GET',
        pattern: /^\/api\/repos\/([^/]+)\/memory\/raw-db\/tables$/,
        handler: async (_req, res, match) => {
            try {
                const workspaceId = decodeURIComponent(match![1]);
                const rawDbPath = getRepoDataPath(dataDir, workspaceId, path.join('memory', 'raw-memory.db'));

                if (!fs.existsSync(rawDbPath)) {
                    sendJson(res, { tables: [] });
                    return;
                }

                let db;
                try {
                    db = new Database(rawDbPath, { readonly: true });
                    const rows = db.prepare(
                        `SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name`,
                    ).all() as { name: string }[];

                    const tables = rows.map(row => {
                        const count = db!.prepare(`SELECT COUNT(*) AS cnt FROM "${row.name}"`).get() as { cnt: number };
                        return { name: row.name, rowCount: count.cnt };
                    });

                    sendJson(res, { tables });
                } finally {
                    try { db?.close(); } catch { /* already closed */ }
                }
            } catch (err) {
                send500(res, err instanceof Error ? err.message : String(err));
            }
        },
    });

    // -- GET /api/repos/:repoId/memory/raw-db/tables/:name ---------------------

    routes.push({
        method: 'GET',
        pattern: /^\/api\/repos\/([^/]+)\/memory\/raw-db\/tables\/([a-zA-Z_][a-zA-Z0-9_]*)$/,
        handler: async (req, res, match) => {
            try {
                const workspaceId = decodeURIComponent(match![1]);
                const tableName = decodeURIComponent(match![2]);
                const rawDbPath = getRepoDataPath(dataDir, workspaceId, path.join('memory', 'raw-memory.db'));

                if (!fs.existsSync(rawDbPath)) {
                    send404(res, 'Raw memory database does not exist for this repo');
                    return;
                }

                let db;
                try {
                    db = new Database(rawDbPath, { readonly: true });

                    // Validate table exists
                    const tableExists = db.prepare(
                        `SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?`,
                    ).get(tableName) as { name: string } | undefined;

                    if (!tableExists) {
                        send400(res, `Table not found: ${tableName}`);
                        return;
                    }

                    // Column metadata
                    const columns = db.prepare(`PRAGMA table_info("${tableName}")`).all() as {
                        cid: number; name: string; type: string; notnull: number; dflt_value: unknown; pk: number;
                    }[];
                    const columnNames = new Set(columns.map(c => c.name));

                    // Parse pagination params
                    const parsed = url.parse(req.url || '/', true);
                    const page = Math.max(1, parseInt(parsed.query.page as string, 10) || 1);
                    const pageSize = Math.min(200, Math.max(1, parseInt(parsed.query.pageSize as string, 10) || 50));
                    const offset = (page - 1) * pageSize;

                    // Parse sort params
                    const sortColumn = parsed.query.sort as string | undefined;
                    const sortOrderRaw = (parsed.query.order as string || '').toLowerCase();
                    const sortOrder = sortOrderRaw === 'asc' ? 'ASC' : 'DESC';
                    const hasValidSort = sortColumn !== undefined && sortColumn !== '' && columnNames.has(sortColumn);

                    // Row count
                    const total = (db.prepare(`SELECT COUNT(*) AS cnt FROM "${tableName}"`).get() as { cnt: number }).cnt;
                    const totalPages = Math.max(1, Math.ceil(total / pageSize));

                    // Row data
                    const orderClause = hasValidSort ? ` ORDER BY "${sortColumn}" ${sortOrder}` : '';
                    const rows = db.prepare(`SELECT * FROM "${tableName}"${orderClause} LIMIT ? OFFSET ?`).all(pageSize, offset);

                    sendJson(res, {
                        table: tableName,
                        columns: columns.map(c => ({ name: c.name, type: c.type, notnull: !!c.notnull, pk: !!c.pk })),
                        rows,
                        total,
                        page,
                        pageSize,
                        totalPages,
                    });
                } finally {
                    try { db?.close(); } catch { /* already closed */ }
                }
            } catch (err) {
                send500(res, err instanceof Error ? err.message : String(err));
            }
        },
    });
}