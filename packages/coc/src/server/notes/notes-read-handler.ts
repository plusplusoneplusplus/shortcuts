/**
 * Notes REST API Handler — read-only routes.
 *
 * HTTP API routes for reading notes hierarchy, content, and search
 * for a given workspace.
 *
 * No VS Code dependencies - uses only Node.js built-in modules.
 * Cross-platform compatible (Linux/Mac/Windows).
 */

import * as url from 'url';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import type { ProcessStore } from '@plusplusoneplusplus/forge';
import { isWithinDirectory } from '@plusplusoneplusplus/forge';
import { sendJSON, sendError } from '../core/api-handler';
import { resolveWorkspaceOrFail } from '../shared/handler-utils';
import type { Route } from '../types';
import { getRepoDataPath } from '../paths';
import type { ResolvedCLIConfig } from '../../config';
import { readOrderFile, applyOrder } from './notes-order';
import { SYSTEM_FOLDER_NAMES } from './notes-constants';
import { resolveNotesRoot, isRootResolveError, DEFAULT_ROOT_ID } from './notes-root-resolver';
import { readRepoPreferences } from '../preferences-handler';

// ============================================================================
// Types
// ============================================================================

interface TreeNode {
    name: string;
    path: string;
    type: 'notebook' | 'section' | 'page';
    children?: TreeNode[];
    lastModifiedAt?: string;
}

interface SearchMatch {
    line: number;
    text: string;
}

interface SearchResult {
    path: string;
    matches: SearchMatch[];
}

// ============================================================================
// Helpers
// ============================================================================

function getNotesRoot(dataDir: string, workspaceId: string): string {
    return getRepoDataPath(dataDir, workspaceId, 'notes');
}

function getWorkspaceDataDir(dataDir: string, workspaceId: string): string {
    return path.join(dataDir, 'repos', workspaceId);
}

function getCopilotDir(): string {
    return path.join(os.homedir(), '.copilot');
}

function isAllowedPath(resolved: string, wsDataDir: string, wsRootPath?: string): boolean {
    return isWithinDirectory(resolved, wsDataDir)
        || isWithinDirectory(resolved, getCopilotDir())
        || (!!wsRootPath && isWithinDirectory(resolved, wsRootPath));
}

async function ensureNotesRoot(notesRoot: string): Promise<void> {
    await fs.promises.mkdir(notesRoot, { recursive: true });
}

/**
 * Recursively scan the notes directory and build a tree.
 * Directories = notebooks (top-level) or sections (nested), .md files = pages.
 * Custom order from `.order.json` is applied per-directory; unlisted items fall
 * back to the default sort (directories first, then files, alphabetically within each group).
 */
async function buildTree(dir: string, basePath: string): Promise<TreeNode[]> {
    let entries: fs.Dirent[];
    try {
        entries = await fs.promises.readdir(dir, { withFileTypes: true });
    } catch {
        return [];
    }

    // Keep only non-hidden directories and .md files, with default dirs-first sort
    const relevant = entries
        .filter(e => {
            if (e.isDirectory()) return !e.name.startsWith('.');
            return e.name.endsWith('.md');
        })
        .sort((a, b) => {
            const aDir = a.isDirectory() ? 0 : 1;
            const bDir = b.isDirectory() ? 0 : 1;
            if (aDir !== bDir) return aDir - bDir;
            return a.name.localeCompare(b.name);
        });

    // Apply custom order when present; unlisted items keep their default sort position
    const explicitOrder = await readOrderFile(dir);
    const sorted = applyOrder(relevant, e => e.name, explicitOrder);

    const nodes: TreeNode[] = [];
    for (const entry of sorted) {
        const entryPath = basePath ? `${basePath}/${entry.name}` : entry.name;
        if (entry.isDirectory()) {
            const children = await buildTree(path.join(dir, entry.name), entryPath);
            // Top-level dirs are notebooks, nested dirs are sections
            const type = basePath ? 'section' : 'notebook';
            nodes.push({ name: entry.name, path: entryPath, type, children });
        } else {
            const filePath = path.join(dir, entry.name);
            const stat = await fs.promises.stat(filePath);
            nodes.push({ name: entry.name, path: entryPath, type: 'page', lastModifiedAt: stat.mtime.toISOString() });
        }
    }
    return nodes;
}

/**
 * Recursively search all .md files for a query string (case-insensitive).
 */
async function searchNotes(
    dir: string,
    basePath: string,
    query: string,
    results: SearchResult[],
    totalMatches: { count: number },
    maxFiles: number,
    maxMatches: number,
): Promise<void> {
    let entries: fs.Dirent[];
    try {
        entries = await fs.promises.readdir(dir, { withFileTypes: true });
    } catch {
        return;
    }

    const lowerQuery = query.toLowerCase();

    for (const entry of entries) {
        if (results.length >= maxFiles || totalMatches.count >= maxMatches) return;

        const entryPath = basePath ? `${basePath}/${entry.name}` : entry.name;
        if (entry.isDirectory()) {
            await searchNotes(path.join(dir, entry.name), entryPath, query, results, totalMatches, maxFiles, maxMatches);
        } else if (entry.name.endsWith('.md')) {
            const matches: SearchMatch[] = [];

            // Search filename
            if (entry.name.toLowerCase().includes(lowerQuery)) {
                matches.push({ line: 0, text: entry.name });
                totalMatches.count++;
            }

            // Search content
            if (totalMatches.count < maxMatches) {
                try {
                    const content = await fs.promises.readFile(path.join(dir, entry.name), 'utf-8');
                    const lines = content.split('\n');
                    for (let i = 0; i < lines.length; i++) {
                        if (totalMatches.count >= maxMatches) break;
                        if (lines[i].toLowerCase().includes(lowerQuery)) {
                            matches.push({ line: i + 1, text: lines[i] });
                            totalMatches.count++;
                        }
                    }
                } catch {
                    // Skip files that can't be read
                }
            }

            if (matches.length > 0) {
                results.push({ path: entryPath, matches });
            }
        }
    }
}

// ============================================================================
// Route Registration
// ============================================================================

/**
 * Register all notes read-only API routes on the given route table.
 * Mutates the `routes` array in-place.
 */
export function registerNotesRoutes(
    routes: Route[],
    store: ProcessStore,
    dataDir: string,
    resolvedConfig?: ResolvedCLIConfig,
): void {

    // ------------------------------------------------------------------
    // GET /api/workspaces/:id/notes/tree?root=... — Recursive tree scan
    // ------------------------------------------------------------------
    routes.push({
        method: 'GET',
        pattern: /^\/api\/workspaces\/([^/]+)\/notes\/tree$/,
        handler: async (req, res, match) => {
            const ws = await resolveWorkspaceOrFail(store, match!, res);
            if (!ws) return;

            const parsed = url.parse(req.url || '/', true);
            const rootParam = typeof parsed.query.root === 'string' ? parsed.query.root : undefined;

            const prefs = readRepoPreferences(dataDir, ws.id);
            const resolved = resolveNotesRoot(dataDir, ws.id, ws.rootPath, rootParam, prefs.additionalNotesRoots);
            if (isRootResolveError(resolved)) {
                return sendError(res, resolved.statusCode, resolved.error);
            }

            const notesRoot = resolved.absolutePath;
            await ensureNotesRoot(notesRoot);

            // Auto-create system folders only for the default managed root
            if (resolved.isDefault) {
                await Promise.all(
                    SYSTEM_FOLDER_NAMES.map(name =>
                        fs.promises.mkdir(path.join(notesRoot, name), { recursive: true }),
                    ),
                );
            }

            const tree = await buildTree(notesRoot, '');
            sendJSON(res, 200, {
                tree,
                notesRoot,
                rootId: resolved.rootId,
                systemFolders: resolved.isDefault ? SYSTEM_FOLDER_NAMES : [],
            });
        },
    });

    // ------------------------------------------------------------------
    // GET /api/workspaces/:id/notes/content?path=...&root=... — Read markdown
    // ------------------------------------------------------------------
    routes.push({
        method: 'GET',
        pattern: /^\/api\/workspaces\/([^/]+)\/notes\/content$/,
        handler: async (req, res, match) => {
            const ws = await resolveWorkspaceOrFail(store, match!, res);
            if (!ws) return;

            const parsed = url.parse(req.url || '/', true);
            const filePath = typeof parsed.query.path === 'string' ? parsed.query.path : '';
            if (!filePath) {
                return sendError(res, 400, 'Missing required query parameter: path');
            }

            const rootParam = typeof parsed.query.root === 'string' ? parsed.query.root : undefined;
            const prefs = readRepoPreferences(dataDir, ws.id);
            const rootResult = resolveNotesRoot(dataDir, ws.id, ws.rootPath, rootParam, prefs.additionalNotesRoots);
            if (isRootResolveError(rootResult)) {
                return sendError(res, rootResult.statusCode, rootResult.error);
            }

            const notesRoot = rootResult.absolutePath;
            const wsDataDir = getWorkspaceDataDir(dataDir, ws.id);

            // Absolute paths are used as-is (scratchpad / session-state files) — only for default root.
            // Relative paths are resolved against the active notesRoot.
            let resolved: string;
            if (path.isAbsolute(filePath) && rootResult.isDefault) {
                resolved = path.resolve(filePath);
            } else {
                resolved = path.resolve(notesRoot, filePath);
            }

            // For non-default roots, allow paths within the resolved root directory
            const allowed = rootResult.isDefault
                ? isAllowedPath(resolved, wsDataDir, ws.rootPath)
                : isWithinDirectory(resolved, notesRoot);
            if (!allowed) {
                return sendError(res, 403, 'Access denied: path is outside workspace data directory');
            }

            try {
                const [content, stat] = await Promise.all([
                    fs.promises.readFile(resolved, 'utf-8'),
                    fs.promises.stat(resolved),
                ]);
                sendJSON(res, 200, { content, path: filePath, mtime: stat.mtimeMs });
            } catch (err: any) {
                if (err.code === 'ENOENT') {
                    return sendError(res, 404, 'File not found');
                }
                return sendError(res, 500, 'Failed to read file: ' + (err.message || 'Unknown error'));
            }
        },
    });

    // ------------------------------------------------------------------
    // GET /api/workspaces/:id/notes/search?q=...&root=... — Full-text search
    // ------------------------------------------------------------------
    routes.push({
        method: 'GET',
        pattern: /^\/api\/workspaces\/([^/]+)\/notes\/search$/,
        handler: async (req, res, match) => {
            const ws = await resolveWorkspaceOrFail(store, match!, res);
            if (!ws) return;

            const parsed = url.parse(req.url || '/', true);
            const query = typeof parsed.query.q === 'string' ? parsed.query.q : '';
            if (!query) {
                return sendError(res, 400, 'Missing required query parameter: q');
            }

            const rootParam = typeof parsed.query.root === 'string' ? parsed.query.root : undefined;
            const prefs = readRepoPreferences(dataDir, ws.id);
            const rootResult = resolveNotesRoot(dataDir, ws.id, ws.rootPath, rootParam, prefs.additionalNotesRoots);
            if (isRootResolveError(rootResult)) {
                return sendError(res, rootResult.statusCode, rootResult.error);
            }

            const notesRoot = rootResult.absolutePath;

            const MAX_FILES = 50;
            const MAX_MATCHES = 100;
            const results: SearchResult[] = [];
            const totalMatches = { count: 0 };

            try {
                await fs.promises.access(notesRoot);
            } catch {
                return sendJSON(res, 200, { results: [], truncated: false });
            }

            await searchNotes(notesRoot, '', query, results, totalMatches, MAX_FILES, MAX_MATCHES);

            const truncated = results.length >= MAX_FILES || totalMatches.count >= MAX_MATCHES;
            sendJSON(res, 200, { results, truncated });
        },
    });
}
