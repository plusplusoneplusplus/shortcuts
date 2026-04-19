/**
 * Bounded Memory Routes
 *
 * REST endpoints for bounded MEMORY.md CRUD:
 *   GET    /api/memory/bounded/levels    — overview of all levels with char usage stats
 *   GET    /api/memory/bounded/:level    — read MEMORY.md content for a level
 *   PUT    /api/memory/bounded/:level    — write MEMORY.md content (security scanned)
 *   DELETE /api/memory/bounded/:level    — delete MEMORY.md (admin-only)
 *
 * Cross-platform compatible (Linux/Mac/Windows).
 */

import * as fs from 'fs';
import * as path from 'path';
import * as url from 'url';
import {
    DEFAULT_CHAR_LIMIT,
    scanMemoryContent,
} from '@plusplusoneplusplus/forge';
import type { Route } from '../types';
import { sendJson, readJsonBody, send400, send500, sendError } from '../router';
import { readMemoryConfig } from './memory-config-handler';

// ============================================================================
// Types
// ============================================================================

type BoundedLevel = 'system' | 'repo' | 'git-remote';

export interface BoundedMemoryRouteOptions {
    /** Optional admin token validator. */
    validateAdminToken?: (token: string) => boolean;
}

// ============================================================================
// Helpers
// ============================================================================

function resolveMemoryPath(dataDir: string, level: BoundedLevel, hash?: string): string {
    const config = readMemoryConfig(dataDir);
    const baseDir = config.storageDir;

    switch (level) {
        case 'system':
            return path.join(baseDir, 'system', 'MEMORY.md');
        case 'repo':
            if (!hash) throw new Error('hash is required for repo level');
            return path.join(baseDir, 'repos', hash, 'MEMORY.md');
        case 'git-remote':
            if (!hash) throw new Error('hash is required for git-remote level');
            return path.join(baseDir, 'git-remotes', hash, 'MEMORY.md');
    }
}

function getLastModified(filePath: string): string | null {
    try {
        const stat = fs.statSync(filePath);
        return stat.mtime.toISOString();
    } catch {
        return null;
    }
}

function readMemoryFile(filePath: string): string {
    try {
        return fs.readFileSync(filePath, 'utf-8');
    } catch {
        return '';
    }
}

interface LevelCharStats {
    charCount: number;
    charLimit: number;
    lastModified: string | null;
}

function getLevelStats(filePath: string, charLimit: number): LevelCharStats {
    const content = readMemoryFile(filePath);
    return {
        charCount: content.length,
        charLimit,
        lastModified: getLastModified(filePath),
    };
}

interface LevelsOverviewEntry extends LevelCharStats {
    hash: string;
}

function scanDirectory(dirPath: string, charLimit: number): LevelsOverviewEntry[] {
    const entries: LevelsOverviewEntry[] = [];
    try {
        const dirs = fs.readdirSync(dirPath, { withFileTypes: true });
        for (const d of dirs) {
            if (!d.isDirectory()) continue;
            const memPath = path.join(dirPath, d.name, 'MEMORY.md');
            const stats = getLevelStats(memPath, charLimit);
            entries.push({ hash: d.name, ...stats });
        }
    } catch {
        // Directory doesn't exist yet
    }
    return entries;
}

// ============================================================================
// Route Registration
// ============================================================================

/**
 * Register bounded memory REST endpoints on the given route table.
 * Mutates the `routes` array in-place.
 */
export function registerBoundedMemoryRoutes(
    routes: Route[],
    dataDir: string,
    options?: BoundedMemoryRouteOptions,
): void {
    const charLimit = DEFAULT_CHAR_LIMIT;

    // -- GET /api/memory/bounded/levels ----------------------------------------

    routes.push({
        method: 'GET',
        pattern: '/api/memory/bounded/levels',
        handler: async (_req, res) => {
            try {
                const config = readMemoryConfig(dataDir);
                const baseDir = config.storageDir;

                const systemPath = path.join(baseDir, 'system', 'MEMORY.md');
                const systemStats = getLevelStats(systemPath, charLimit);

                const repos = scanDirectory(path.join(baseDir, 'repos'), charLimit);
                const gitRemotes = scanDirectory(path.join(baseDir, 'git-remotes'), charLimit);

                sendJson(res, {
                    system: systemStats,
                    repos,
                    gitRemotes,
                });
            } catch (err) {
                send500(res, err instanceof Error ? err.message : String(err));
            }
        },
    });

    // -- GET /api/memory/bounded/:level ----------------------------------------

    routes.push({
        method: 'GET',
        pattern: /^\/api\/memory\/bounded\/(system|repo|git-remote)$/,
        handler: async (req, res, match) => {
            try {
                const level = match![1] as BoundedLevel;
                const parsedUrl = url.parse(req.url ?? '', true);
                const hash = typeof parsedUrl.query.hash === 'string' ? parsedUrl.query.hash : undefined;

                if ((level === 'repo' || level === 'git-remote') && !hash) {
                    send400(res, `Query parameter 'hash' is required for ${level} level`);
                    return;
                }

                const filePath = resolveMemoryPath(dataDir, level, hash);
                const content = readMemoryFile(filePath);
                const lastModified = getLastModified(filePath);

                sendJson(res, {
                    content,
                    charCount: content.length,
                    charLimit,
                    lastModified,
                });
            } catch (err) {
                send500(res, err instanceof Error ? err.message : String(err));
            }
        },
    });

    // -- PUT /api/memory/bounded/:level ----------------------------------------

    routes.push({
        method: 'PUT',
        pattern: /^\/api\/memory\/bounded\/(system|repo|git-remote)$/,
        handler: async (req, res, match) => {
            try {
                const level = match![1] as BoundedLevel;
                const parsedUrl = url.parse(req.url ?? '', true);
                const hash = typeof parsedUrl.query.hash === 'string' ? parsedUrl.query.hash : undefined;

                if ((level === 'repo' || level === 'git-remote') && !hash) {
                    send400(res, `Query parameter 'hash' is required for ${level} level`);
                    return;
                }

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
                if (content.length > charLimit) {
                    sendJson(res, {
                        error: 'Content exceeds character limit',
                        charCount: content.length,
                        charLimit,
                    }, 413);
                    return;
                }

                const filePath = resolveMemoryPath(dataDir, level, hash);
                fs.mkdirSync(path.dirname(filePath), { recursive: true });
                fs.writeFileSync(filePath, content, 'utf-8');

                const lastModified = getLastModified(filePath);
                sendJson(res, {
                    charCount: content.length,
                    charLimit,
                    lastModified,
                });
            } catch (err) {
                send500(res, err instanceof Error ? err.message : String(err));
            }
        },
    });

    // -- DELETE /api/memory/bounded/:level -------------------------------------

    routes.push({
        method: 'DELETE',
        pattern: /^\/api\/memory\/bounded\/(system|repo|git-remote)$/,
        handler: async (req, res, match) => {
            try {
                const level = match![1] as BoundedLevel;
                const parsedUrl = url.parse(req.url ?? '', true);
                const hash = typeof parsedUrl.query.hash === 'string' ? parsedUrl.query.hash : undefined;
                const token = typeof parsedUrl.query.token === 'string' ? parsedUrl.query.token : undefined;

                if ((level === 'repo' || level === 'git-remote') && !hash) {
                    send400(res, `Query parameter 'hash' is required for ${level} level`);
                    return;
                }

                // Admin token required for delete
                if (!token || (options?.validateAdminToken && !options.validateAdminToken(token))) {
                    sendError(res, 403, 'Admin token required for delete operations');
                    return;
                }

                const filePath = resolveMemoryPath(dataDir, level, hash);
                try {
                    fs.unlinkSync(filePath);
                } catch (err: any) {
                    if (err.code !== 'ENOENT') throw err;
                }

                sendJson(res, { success: true });
            } catch (err) {
                send500(res, err instanceof Error ? err.message : String(err));
            }
        },
    });
}
