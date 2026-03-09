/**
 * Memory Routes
 *
 * Registers all /api/memory/* REST endpoints.
 *
 * GET  /api/memory/config          — read config
 * PUT  /api/memory/config          — write config
 * GET  /api/memory/entries         — list/search entries
 * POST /api/memory/entries         — create entry
 * GET  /api/memory/entries/:id     — get single entry
 * PATCH /api/memory/entries/:id    — update tags/content
 * DELETE /api/memory/entries/:id   — delete entry
 * GET  /api/memory/observations/levels    — overview of all 3 memory levels
 * GET  /api/memory/observations           — list files at a level
 * GET  /api/memory/observations/:filename — read a single observation file
 * GET  /api/memory/explore-cache/levels              — overview of all explore-cache levels
 * GET  /api/memory/explore-cache/raw                 — list raw Q&A files at a level
 * GET  /api/memory/explore-cache/raw/:filename       — read a single raw Q&A entry
 * GET  /api/memory/explore-cache/consolidated        — list consolidated index entries at a level
 * GET  /api/memory/explore-cache/consolidated/:id    — read a consolidated entry with its answer
 *
 * Cross-platform compatible (Linux/Mac/Windows).
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import * as url from 'url';
import type { AIInvoker } from '@plusplusoneplusplus/pipeline-core';
import {
    FileMemoryStore as PipelineMemoryStore,
    type MemoryLevel,
    FileToolCallCacheStore,
    resolveToolCallCacheOptions,
    type ToolCallCacheLevel,
} from '@plusplusoneplusplus/pipeline-core';
import type { Route } from '../types';
import { sendJson, readJsonBody, send400, send404, send500 } from '../router';
import { handleGetMemoryConfig, handlePutMemoryConfig, readMemoryConfig } from './memory-config-handler';
import { FileMemoryStore } from './memory-store';
import { handleAggregateToolCalls } from './tool-call-aggregation-handler';

// ============================================================================
// Types
// ============================================================================

export interface MemoryRouteOptions {
    /**
     * AI invoker for the POST /api/memory/aggregate-tool-calls endpoint.
     * When absent the endpoint returns 503 Service Unavailable.
     */
    aggregateToolCallsAIInvoker?: AIInvoker;
    /**
     * Optional working directory for scoping the explore cache.
     * When provided, the cache resolves to git-remote or repo level;
     * when absent, behavior remains system-level.
     */
    workingDirectory?: string;
}

// ============================================================================
// Registration
// ============================================================================

/**
 * Register all memory API routes on the given route table.
 * Mutates the `routes` array in-place.
 *
 * @param routes  - Shared route table
 * @param dataDir - CoC data directory (e.g. ~/.coc)
 * @param options - Optional configuration (e.g. AI invoker for aggregation)
 */
export function registerMemoryRoutes(routes: Route[], dataDir: string, options?: MemoryRouteOptions): void {

    // -- Config endpoints ----------------------------------------------------

    routes.push({
        method: 'GET',
        pattern: '/api/memory/config',
        handler: async (req, res) => {
            handleGetMemoryConfig(req, res, dataDir);
        },
    });

    routes.push({
        method: 'PUT',
        pattern: '/api/memory/config',
        handler: async (req, res) => {
            await handlePutMemoryConfig(req, res, dataDir);
        },
    });

    // -- Entries list/create -------------------------------------------------

    routes.push({
        method: 'GET',
        pattern: '/api/memory/entries',
        handler: async (req, res) => {
            try {
                const config = readMemoryConfig(dataDir);
                const store = new FileMemoryStore(config.storageDir);

                const parsedUrl = url.parse(req.url ?? '', true);
                const q = typeof parsedUrl.query.q === 'string' ? parsedUrl.query.q : undefined;
                const tag = typeof parsedUrl.query.tag === 'string' ? parsedUrl.query.tag : undefined;
                const page = parsedUrl.query.page ? parseInt(String(parsedUrl.query.page), 10) : 1;
                const pageSize = parsedUrl.query.pageSize ? parseInt(String(parsedUrl.query.pageSize), 10) : 20;

                const result = store.list({ q, tag, page, pageSize });
                sendJson(res, result);
            } catch (err) {
                send500(res, err instanceof Error ? err.message : String(err));
            }
        },
    });

    routes.push({
        method: 'POST',
        pattern: '/api/memory/entries',
        handler: async (req, res) => {
            try {
                const body = await readJsonBody<{
                    content?: string;
                    summary?: string;
                    tags?: string[];
                    source?: string;
                }>(req);

                if (!body.content || typeof body.content !== 'string' || body.content.trim() === '') {
                    send400(res, 'Missing required field: content');
                    return;
                }

                const config = readMemoryConfig(dataDir);
                const store = new FileMemoryStore(config.storageDir);

                const entry = store.create({
                    content: body.content,
                    summary: typeof body.summary === 'string' ? body.summary : undefined,
                    tags: Array.isArray(body.tags) ? body.tags.filter(t => typeof t === 'string') : [],
                    source: typeof body.source === 'string' ? body.source : 'manual',
                });

                sendJson(res, entry, 201);
            } catch (err) {
                send500(res, err instanceof Error ? err.message : String(err));
            }
        },
    });

    // -- Single entry endpoints (by ID) --------------------------------------

    routes.push({
        method: 'GET',
        pattern: /^\/api\/memory\/entries\/([^/]+)$/,
        handler: async (_req, res, match) => {
            try {
                const id = decodeURIComponent(match![1]);
                const config = readMemoryConfig(dataDir);
                const store = new FileMemoryStore(config.storageDir);

                const entry = store.get(id);
                if (!entry) {
                    send404(res, `Memory entry not found: ${id}`);
                    return;
                }
                sendJson(res, entry);
            } catch (err) {
                send500(res, err instanceof Error ? err.message : String(err));
            }
        },
    });

    routes.push({
        method: 'PATCH',
        pattern: /^\/api\/memory\/entries\/([^/]+)$/,
        handler: async (req, res, match) => {
            try {
                const id = decodeURIComponent(match![1]);
                const body = await readJsonBody<{
                    tags?: string[];
                    content?: string;
                    summary?: string;
                }>(req);

                const config = readMemoryConfig(dataDir);
                const store = new FileMemoryStore(config.storageDir);

                const patch: { tags?: string[]; content?: string; summary?: string } = {};
                if (Array.isArray(body.tags)) {
                    patch.tags = body.tags.filter(t => typeof t === 'string');
                }
                if (typeof body.content === 'string') {
                    patch.content = body.content;
                }
                if (typeof body.summary === 'string') {
                    patch.summary = body.summary;
                }

                const updated = store.update(id, patch);
                if (!updated) {
                    send404(res, `Memory entry not found: ${id}`);
                    return;
                }
                sendJson(res, updated);
            } catch (err) {
                send500(res, err instanceof Error ? err.message : String(err));
            }
        },
    });

    routes.push({
        method: 'DELETE',
        pattern: /^\/api\/memory\/entries\/([^/]+)$/,
        handler: async (_req, res, match) => {
            try {
                const id = decodeURIComponent(match![1]);
                const config = readMemoryConfig(dataDir);
                const store = new FileMemoryStore(config.storageDir);

                const deleted = store.delete(id);
                if (!deleted) {
                    send404(res, `Memory entry not found: ${id}`);
                    return;
                }
                sendJson(res, { success: true, id });
            } catch (err) {
                send500(res, err instanceof Error ? err.message : String(err));
            }
        },
    });

    // -- Batch aggregation ---------------------------------------------------

    routes.push({
        method: 'GET',
        pattern: '/api/memory/aggregate-tool-calls/stats',
        handler: async (_req, res) => {
            try {
                const config = readMemoryConfig(dataDir);
                const store = new FileToolCallCacheStore(
                    resolveToolCallCacheOptions(options?.workingDirectory, config.storageDir),
                );
                const stats = await store.getStats();
                sendJson(res, stats);
            } catch (err) {
                send500(res, err instanceof Error ? err.message : String(err));
            }
        },
    });

    routes.push({
        method: 'POST',
        pattern: '/api/memory/aggregate-tool-calls',
        handler: async (req, res) => {
            await handleAggregateToolCalls(req, res, dataDir, options?.aggregateToolCallsAIInvoker, options?.workingDirectory);
        },
    });

    // -- Observation browsing (pipeline-core memory files) --------------------

    const getObservationStore = (): PipelineMemoryStore => {
        const config = readMemoryConfig(dataDir);
        return new PipelineMemoryStore({ dataDir: config.storageDir });
    };

    // Overview of all 3 memory levels with stats and metadata
    routes.push({
        method: 'GET',
        pattern: '/api/memory/observations/levels',
        handler: async (_req, res) => {
            try {
                const store = getObservationStore();

                const [globalStats, repoHashes, remoteHashes] = await Promise.all([
                    store.getStats('system'),
                    store.listRepos(),
                    store.listGitRemotes(),
                ]);

                const repos = await Promise.all(
                    repoHashes.map(async (hash: string) => {
                        const [info, stats] = await Promise.all([
                            store.getRepoInfo(hash),
                            store.getStats('repo', hash),
                        ]);
                        return { hash, ...(info ?? {}), ...stats };
                    }),
                );

                const gitRemotes = await Promise.all(
                    remoteHashes.map(async (hash: string) => {
                        const [info, stats] = await Promise.all([
                            store.getGitRemoteInfo(hash),
                            store.getStats('git-remote' as MemoryLevel, hash),
                        ]);
                        return { hash, ...(info ?? {}), ...stats };
                    }),
                );

                sendJson(res, { global: globalStats, repos, gitRemotes });
            } catch (err) {
                send500(res, err instanceof Error ? err.message : String(err));
            }
        },
    });

    // List observation files at a specific level
    routes.push({
        method: 'GET',
        pattern: '/api/memory/observations',
        handler: async (req, res) => {
            try {
                const store = getObservationStore();
                const parsedUrl = url.parse(req.url ?? '', true);
                const level = (parsedUrl.query.level as string) || 'system';
                const hash = typeof parsedUrl.query.hash === 'string' ? parsedUrl.query.hash : undefined;

                if (!['system', 'git-remote', 'repo'].includes(level)) {
                    send400(res, `Invalid level: ${level}. Must be system, git-remote, or repo`);
                    return;
                }

                const mlevel = level as MemoryLevel;
                const [files, consolidated, stats] = await Promise.all([
                    store.listRaw(mlevel, hash),
                    store.readConsolidated(mlevel, hash),
                    store.getStats(mlevel, hash),
                ]);

                sendJson(res, { level, hash, files, consolidatedExists: !!consolidated, stats });
            } catch (err) {
                send500(res, err instanceof Error ? err.message : String(err));
            }
        },
    });

    // Read a single observation file
    routes.push({
        method: 'GET',
        pattern: /^\/api\/memory\/observations\/([^/]+)$/,
        handler: async (req, res, match) => {
            try {
                const store = getObservationStore();
                const filename = decodeURIComponent(match![1]);
                const parsedUrl = url.parse(req.url ?? '', true);
                const level = (parsedUrl.query.level as string) || 'system';
                const hash = typeof parsedUrl.query.hash === 'string' ? parsedUrl.query.hash : undefined;

                if (!['system', 'git-remote', 'repo'].includes(level)) {
                    send400(res, `Invalid level: ${level}. Must be system, git-remote, or repo`);
                    return;
                }

                if (filename === 'consolidated') {
                    const content = await store.readConsolidated(level as MemoryLevel, hash);
                    if (content === null) {
                        send404(res, 'No consolidated memory at this level');
                        return;
                    }
                    sendJson(res, { filename: 'consolidated.md', content });
                    return;
                }

                const obs = await store.readRaw(level as MemoryLevel, hash, filename);
                if (!obs) {
                    send404(res, `Observation not found: ${filename}`);
                    return;
                }
                sendJson(res, obs);
            } catch (err) {
                send500(res, err instanceof Error ? err.message : String(err));
            }
        },
    });

    // -- Explore-cache browsing -----------------------------------------------

    /**
     * Build a FileToolCallCacheStore for the given level+hash, using the
     * current memory config's storageDir as the data root.
     */
    const getExploreCacheStore = (
        storageDir: string,
        level: ToolCallCacheLevel,
        hash?: string,
    ): FileToolCallCacheStore => {
        switch (level) {
            case 'git-remote':
                return new FileToolCallCacheStore({ dataDir: storageDir, level: 'git-remote', remoteHash: hash });
            case 'repo':
                return new FileToolCallCacheStore({ dataDir: storageDir, level: 'repo', repoHash: hash });
            default:
                return new FileToolCallCacheStore({ dataDir: storageDir, level: 'system' });
        }
    };

    /**
     * Scan a parent directory for subdirectories that contain an explore-cache.
     * Returns hashes (subdir names) that have at least the explore-cache dir.
     */
    const findExploreCacheHashes = async (parentDir: string): Promise<string[]> => {
        const hashes: string[] = [];
        try {
            const entries = await fs.readdir(parentDir, { withFileTypes: true });
            for (const entry of entries) {
                if (!entry.isDirectory()) continue;
                try {
                    await fs.access(path.join(parentDir, entry.name, 'explore-cache'));
                    hashes.push(entry.name);
                } catch { /* no explore-cache subdir */ }
            }
        } catch { /* parent dir may not exist */ }
        return hashes;
    };

    // Overview of all explore-cache levels with stats
    routes.push({
        method: 'GET',
        pattern: '/api/memory/explore-cache/levels',
        handler: async (_req, res) => {
            try {
                const config = readMemoryConfig(dataDir);
                const storageDir = config.storageDir;
                const obsStore = new PipelineMemoryStore({ dataDir: storageDir });

                const systemStore = getExploreCacheStore(storageDir, 'system');
                const systemStats = await systemStore.getStats();

                const [remoteHashes, repoHashes] = await Promise.all([
                    findExploreCacheHashes(path.join(storageDir, 'git-remotes')),
                    findExploreCacheHashes(path.join(storageDir, 'repos')),
                ]);

                const gitRemotes = await Promise.all(
                    remoteHashes.map(async (hash) => {
                        const [info, store] = [await obsStore.getGitRemoteInfo(hash), getExploreCacheStore(storageDir, 'git-remote', hash)];
                        const stats = await store.getStats();
                        return { hash, ...(info ?? {}), ...stats };
                    }),
                );

                const repos = await Promise.all(
                    repoHashes.map(async (hash) => {
                        const [info, store] = [await obsStore.getRepoInfo(hash), getExploreCacheStore(storageDir, 'repo', hash)];
                        const stats = await store.getStats();
                        return { hash, ...(info ?? {}), ...stats };
                    }),
                );

                sendJson(res, { system: systemStats, gitRemotes, repos });
            } catch (err) {
                send500(res, err instanceof Error ? err.message : String(err));
            }
        },
    });

    // List raw Q&A files at a specific level
    routes.push({
        method: 'GET',
        pattern: '/api/memory/explore-cache/raw',
        handler: async (req, res) => {
            try {
                const config = readMemoryConfig(dataDir);
                const parsedUrl = url.parse(req.url ?? '', true);
                const level = ((parsedUrl.query.level as string) || 'system') as ToolCallCacheLevel;
                const hash = typeof parsedUrl.query.hash === 'string' ? parsedUrl.query.hash : undefined;

                if (!['system', 'git-remote', 'repo'].includes(level)) {
                    send400(res, `Invalid level: ${level}. Must be system, git-remote, or repo`);
                    return;
                }

                const store = getExploreCacheStore(config.storageDir, level, hash);
                const files = await store.listRaw();
                sendJson(res, { level, hash, files });
            } catch (err) {
                send500(res, err instanceof Error ? err.message : String(err));
            }
        },
    });

    // Read a single raw Q&A entry
    routes.push({
        method: 'GET',
        pattern: /^\/api\/memory\/explore-cache\/raw\/([^/]+)$/,
        handler: async (req, res, match) => {
            try {
                const config = readMemoryConfig(dataDir);
                const filename = decodeURIComponent(match![1]);
                const parsedUrl = url.parse(req.url ?? '', true);
                const level = ((parsedUrl.query.level as string) || 'system') as ToolCallCacheLevel;
                const hash = typeof parsedUrl.query.hash === 'string' ? parsedUrl.query.hash : undefined;

                if (!['system', 'git-remote', 'repo'].includes(level)) {
                    send400(res, `Invalid level: ${level}. Must be system, git-remote, or repo`);
                    return;
                }

                const store = getExploreCacheStore(config.storageDir, level, hash);
                const entry = await store.readRaw(filename);
                if (!entry) {
                    send404(res, `Explore-cache entry not found: ${filename}`);
                    return;
                }
                sendJson(res, entry);
            } catch (err) {
                send500(res, err instanceof Error ? err.message : String(err));
            }
        },
    });

    // List consolidated index entries at a specific level
    routes.push({
        method: 'GET',
        pattern: '/api/memory/explore-cache/consolidated',
        handler: async (req, res) => {
            try {
                const config = readMemoryConfig(dataDir);
                const parsedUrl = url.parse(req.url ?? '', true);
                const level = ((parsedUrl.query.level as string) || 'system') as ToolCallCacheLevel;
                const hash = typeof parsedUrl.query.hash === 'string' ? parsedUrl.query.hash : undefined;

                if (!['system', 'git-remote', 'repo'].includes(level)) {
                    send400(res, `Invalid level: ${level}. Must be system, git-remote, or repo`);
                    return;
                }

                const store = getExploreCacheStore(config.storageDir, level, hash);
                const entries = await store.readConsolidatedIndex();
                sendJson(res, { level, hash, entries });
            } catch (err) {
                send500(res, err instanceof Error ? err.message : String(err));
            }
        },
    });

    // Read a consolidated entry with its answer
    routes.push({
        method: 'GET',
        pattern: /^\/api\/memory\/explore-cache\/consolidated\/([^/]+)$/,
        handler: async (req, res, match) => {
            try {
                const config = readMemoryConfig(dataDir);
                const id = decodeURIComponent(match![1]);
                const parsedUrl = url.parse(req.url ?? '', true);
                const level = ((parsedUrl.query.level as string) || 'system') as ToolCallCacheLevel;
                const hash = typeof parsedUrl.query.hash === 'string' ? parsedUrl.query.hash : undefined;

                if (!['system', 'git-remote', 'repo'].includes(level)) {
                    send400(res, `Invalid level: ${level}. Must be system, git-remote, or repo`);
                    return;
                }

                const store = getExploreCacheStore(config.storageDir, level, hash);
                const [index, answer] = await Promise.all([
                    store.readConsolidatedIndex(),
                    store.readEntryAnswer(id),
                ]);
                const indexEntry = index.find(e => e.id === id);
                if (!indexEntry) {
                    send404(res, `Consolidated entry not found: ${id}`);
                    return;
                }
                sendJson(res, { ...indexEntry, answer: answer ?? '' });
            } catch (err) {
                send500(res, err instanceof Error ? err.message : String(err));
            }
        },
    });
}
