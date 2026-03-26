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

import * as http from 'http';
import * as fs from 'fs';
import * as path from 'path';
import * as url from 'url';
import type { ProcessStore, AIInvoker } from '@plusplusoneplusplus/forge';
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
}

// ============================================================================
// Private helpers
// ============================================================================

function getNoteStore(dataDir: string, workspaceId: string): FileMemoryStore {
    const noteDir = getRepoDataPath(dataDir, workspaceId, 'memory');
    return new FileMemoryStore(noteDir);
}

function getPipelineStore(dataDir: string): PipelineMemoryStore {
    const config = readMemoryConfig(dataDir);
    return new PipelineMemoryStore({ dataDir: config.storageDir });
}

async function getRepoRootPath(store: ProcessStore, workspaceId: string): Promise<string | undefined> {
    const workspaces = await store.getWorkspaces();
    return workspaces.find(w => w.id === workspaceId)?.rootPath;
}

function sendSseEvent(res: http.ServerResponse, event: string, data: unknown): void {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

/** Backup path for consolidated.md before aggregation (enables revert). */
function consolidatedPrevPath(dataDir: string, workspaceId: string): string {
    return path.join(getRepoDataPath(dataDir, workspaceId, 'memory'), 'consolidated.prev.md');
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
 *   GET  /api/repos/:repoId/memory/feed              — merged observation + note feed
 *   POST /api/repos/:repoId/memory/notes             — create user note
 *   DELETE /api/repos/:repoId/memory/feed/:id        — delete observation or note
 *   GET  /api/repos/:repoId/memory/stats             — counts + consolidatedAt
 *   GET  /api/repos/:repoId/memory/consolidated      — read consolidated.md content
 *   POST /api/repos/:repoId/memory/aggregate/accept  — accept aggregation (clean backup)
 *   POST /api/repos/:repoId/memory/aggregate/revert  — revert to pre-aggregation state
 *   POST /api/repos/:repoId/memory/aggregate         — run AI aggregation (SSE)
 */
export function registerRepoMemoryRoutes(
    routes: Route[],
    dataDir: string,
    options: RepoMemoryRouteOptions,
): void {
    const { store, aiInvoker } = options;

    // -- GET /api/repos/:repoId/memory/feed ----------------------------------

    routes.push({
        method: 'GET',
        pattern: /^\/api\/repos\/([^/]+)\/memory\/feed$/,
        handler: async (req, res, match) => {
            try {
                const workspaceId = decodeURIComponent(match![1]);
                const repoPath = await getRepoRootPath(store, workspaceId);
                if (!repoPath) {
                    send404(res, `Repo not found: ${workspaceId}`);
                    return;
                }

                const pipelineStore = getPipelineStore(dataDir);
                const repoHash = pipelineStore.computeRepoHash(repoPath);
                const noteStore = getNoteStore(dataDir, workspaceId);

                const [obsFilenames, noteResult, stats] = await Promise.all([
                    pipelineStore.listRaw('repo', repoHash),
                    Promise.resolve(noteStore.list({ pageSize: 10000 })),
                    pipelineStore.getStats('repo', repoHash),
                ]);

                const obsItems = await Promise.all(
                    obsFilenames.map(async (filename): Promise<FeedItem | null> => {
                        const obs = await pipelineStore.readRaw('repo', repoHash, filename);
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

                sendJson(res, {
                    items,
                    consolidatedAt: stats.lastAggregation,
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
                    const pipelineStore = getPipelineStore(dataDir);
                    const repoHash = pipelineStore.computeRepoHash(repoPath);
                    const deleted = await pipelineStore.deleteRaw('repo', repoHash, id);
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

    // -- GET /api/repos/:repoId/memory/stats ---------------------------------

    routes.push({
        method: 'GET',
        pattern: /^\/api\/repos\/([^/]+)\/memory\/stats$/,
        handler: async (_req, res, match) => {
            try {
                const workspaceId = decodeURIComponent(match![1]);
                const repoPath = await getRepoRootPath(store, workspaceId);

                let observationCount = 0;
                let consolidatedAt: string | null = null;
                if (repoPath) {
                    const pipelineStore = getPipelineStore(dataDir);
                    const repoHash = pipelineStore.computeRepoHash(repoPath);
                    const stats = await pipelineStore.getStats('repo', repoHash);
                    observationCount = stats.rawCount;
                    consolidatedAt = stats.lastAggregation;
                }

                const noteStore = getNoteStore(dataDir, workspaceId);
                const { total: noteCount } = noteStore.list({ pageSize: 1 });

                sendJson(res, { observationCount, noteCount, consolidatedAt });
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

                const pipelineStore = getPipelineStore(dataDir);
                const repoHash = pipelineStore.computeRepoHash(repoPath);
                const content = await pipelineStore.readConsolidated('repo', repoHash);
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
                const pipelineStore = getPipelineStore(dataDir);
                const repoHash = pipelineStore.computeRepoHash(repoPath);
                await pipelineStore.writeConsolidated('repo', prevContent, repoHash);

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

    // -- GET /api/repos/:repoId/memory/aggregate ----------------------------
    // Uses GET so browsers can open it via EventSource (which only supports GET).
    // Sources and model are passed as query params: ?sources=user,ai&model=...
    // Source aliases: 'user' → notes, 'ai' → observations.
    // SSE events emitted: chunk (raw text), diff (unified-diff text), done, error.

    routes.push({
        method: 'GET',
        pattern: /^\/api\/repos\/([^/]+)\/memory\/aggregate$/,
        handler: async (req, res, match) => {
            const workspaceId = decodeURIComponent(match![1]);

            // Set SSE headers
            res.setHeader('Content-Type', 'text/event-stream');
            res.setHeader('Cache-Control', 'no-cache');
            res.setHeader('Connection', 'keep-alive');
            res.setHeader('X-Accel-Buffering', 'no');
            res.flushHeaders();

            // Raw SSE sender — data written as-is (no JSON encoding) so that
            // EventSource clients receive plain text in e.data.
            const sendSseRaw = (event: string, data: string): void => {
                const dataLines = data === ''
                    ? 'data: '
                    : data.split('\n').map(l => `data: ${l}`).join('\n');
                res.write(`event: ${event}\n${dataLines}\n\n`);
            };

            try {
                if (!aiInvoker) {
                    sendSseRaw('error', 'AI invoker not configured');
                    res.end();
                    return;
                }

                // Parse sources and model from query string
                const parsedUrl = url.parse(req.url ?? '', true);
                const sourcesParam = typeof parsedUrl.query.sources === 'string'
                    ? parsedUrl.query.sources
                    : 'user,ai';
                const model: string | undefined = typeof parsedUrl.query.model === 'string'
                    ? parsedUrl.query.model
                    : undefined;

                // Map client-facing aliases to internal names
                const sources = sourcesParam
                    .split(',')
                    .map(s => s.trim())
                    .filter(Boolean)
                    .map(s => (s === 'user' ? 'notes' : s === 'ai' ? 'observations' : s));

                const repoPath = await getRepoRootPath(store, workspaceId);
                if (!repoPath) {
                    sendSseRaw('error', `Repo not found: ${workspaceId}`);
                    res.end();
                    return;
                }

                sendSseRaw('chunk', 'Loading memory data...\n');

                const pipelineStore = getPipelineStore(dataDir);
                const repoHash = pipelineStore.computeRepoHash(repoPath);

                // Load observations
                let observations: Array<{ pipeline: string; content: string }> = [];
                if (sources.includes('observations')) {
                    const filenames = await pipelineStore.listRaw('repo', repoHash);
                    const rawObs = await Promise.all(
                        filenames.map(f => pipelineStore.readRaw('repo', repoHash, f)),
                    );
                    observations = rawObs
                        .filter((o): o is NonNullable<typeof o> => o !== undefined)
                        .map(o => ({ pipeline: o.metadata.pipeline, content: o.content }));
                }

                // Load user notes
                let notes: Array<{ content: string; tags: string[] }> = [];
                if (sources.includes('notes')) {
                    const noteStore = getNoteStore(dataDir, workspaceId);
                    const { entries } = noteStore.list({ pageSize: 10000 });
                    notes = entries
                        .map(e => ({ content: noteStore.get(e.id)?.content ?? '', tags: e.tags }))
                        .filter(n => n.content !== '');
                }

                if (observations.length === 0 && notes.length === 0) {
                    sendSseRaw('chunk', '');
                    sendSseRaw('diff', '');
                    sendSseRaw('done', '');
                    res.end();
                    return;
                }

                // Read existing consolidated and save backup
                const previous = await pipelineStore.readConsolidated('repo', repoHash);
                if (previous !== null) {
                    const prevPath = consolidatedPrevPath(dataDir, workspaceId);
                    fs.mkdirSync(path.dirname(prevPath), { recursive: true });
                    fs.writeFileSync(prevPath, previous, 'utf-8');
                }

                // Build prompt
                const promptParts: string[] = [];
                if (previous) {
                    promptParts.push('## Existing Memory\n' + previous);
                }
                if (notes.length > 0) {
                    const noteLines = notes
                        .map(n => `- ${n.content}${n.tags.length > 0 ? ` [tags: ${n.tags.join(', ')}]` : ''}`)
                        .join('\n');
                    promptParts.push('## User Notes (treat as authoritative)\n' + noteLines);
                }
                if (observations.length > 0) {
                    const obsLines = observations.map(o => `- ${o.pipeline}: ${o.content}`).join('\n');
                    promptParts.push('## AI Observations\n' + obsLines);
                }
                promptParts.push(
                    'Produce an updated memory document following these rules:\n' +
                    '- Deduplicate: merge similar or redundant facts\n' +
                    '- Resolve conflicts: user notes override AI observations\n' +
                    '- Prune: drop facts no longer relevant\n' +
                    '- Categorize: group by topic (conventions, architecture, patterns, tools, gotchas)\n' +
                    '- Keep it concise: target <100 facts total\n' +
                    '- Use markdown with clear section headers',
                );

                const prompt = promptParts.join('\n\n');

                sendSseRaw('chunk', 'Running AI consolidation...\n');

                const result = await aiInvoker(prompt, { model });
                if (!result.success) {
                    sendSseRaw('error', result.error ?? 'AI call failed');
                    res.end();
                    return;
                }

                const newConsolidated = result.response ?? '';

                // Write new consolidated.md
                await pipelineStore.writeConsolidated('repo', newConsolidated, repoHash);
                await pipelineStore.updateIndex('repo', repoHash, {
                    lastAggregation: new Date().toISOString(),
                });

                // Format diff as unified-diff text for client-side parseDiff()
                const diffLines = computeDiff(previous ?? '', newConsolidated);
                const diffText = diffLines
                    .map(l => (l.type === 'add' ? '+' : l.type === 'remove' ? '-' : ' ') + l.text)
                    .join('\n');

                sendSseRaw('chunk', newConsolidated);
                sendSseRaw('diff', diffText);
                sendSseRaw('done', '');
                res.end();
            } catch (err) {
                sendSseRaw('error', err instanceof Error ? err.message : String(err));
                res.end();
            }
        },
    });
}
