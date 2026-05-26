/**
 * Memory Routes
 *
 * Registers all /api/memory/* REST endpoints.
 *
 * GET  /api/memory/config          — read config
 * PUT  /api/memory/config          — write config
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
import {
    FileToolCallCacheStore,
    type ToolCallCacheLevel,
} from '@plusplusoneplusplus/forge';
import type { Route } from '../types';
import { sendJson, send400, send404, send500 } from '../router';
import { handleGetMemoryConfig, handlePutMemoryConfig, readMemoryConfig } from './memory-config-handler';

// ============================================================================
// Types
// ============================================================================

export interface MemoryRouteOptions {
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

                const systemStore = getExploreCacheStore(storageDir, 'system');
                const systemStats = await systemStore.getStats();

                const [remoteHashes, repoHashes] = await Promise.all([
                    findExploreCacheHashes(path.join(storageDir, 'git-remotes')),
                    findExploreCacheHashes(path.join(storageDir, 'repos')),
                ]);

                const gitRemotes = await Promise.all(
                    remoteHashes.map(async (hash) => {
                        const store = getExploreCacheStore(storageDir, 'git-remote', hash);
                        const stats = await store.getStats();
                        return { hash, ...stats };
                    }),
                );

                const repos = await Promise.all(
                    repoHashes.map(async (hash) => {
                        const store = getExploreCacheStore(storageDir, 'repo', hash);
                        const stats = await store.getStats();
                        return { hash, ...stats };
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