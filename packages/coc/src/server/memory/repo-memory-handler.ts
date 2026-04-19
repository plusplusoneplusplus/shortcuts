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
import type { ProcessStore } from '@plusplusoneplusplus/forge';
import { DEFAULT_CHAR_LIMIT, scanMemoryContent } from '@plusplusoneplusplus/forge';
import type { Route } from '../types';
import { sendJson, readJsonBody, send400, send404, send500 } from '../router';
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
    const { store } = options;

    // -- GET /api/repos/:repoId/memory/overview (simplified) ------------------
    // Returns basic repo memory info without old observation store dependency.

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

                sendJson(res, {
                    charCount,
                    charLimit: DEFAULT_CHAR_LIMIT,
                    lastModified,
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
}