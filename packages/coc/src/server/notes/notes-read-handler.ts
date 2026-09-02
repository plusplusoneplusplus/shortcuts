/**
 * HTTP API routes for reading notes hierarchy, content, and search
 * for a given workspace.
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
import { readOrderFile, applyOrder } from './notes-order';
import { SYSTEM_FOLDER_NAMES } from './notes-constants';
import { resolveNotesRoot, isRootResolveError } from './notes-root-resolver';
import { resolveSafeNotesPath, isNotesPathSafetyError } from './notes-path-safety';
import { readRepoPreferences } from '../preferences-handler';
import type { NotesSearchService } from './notes-search-service';

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
async function buildTree(dir: string, basePath: string, safeRoot?: string): Promise<TreeNode[]> {
    let entries: fs.Dirent[];
    try {
        entries = await fs.promises.readdir(dir, { withFileTypes: true });
    } catch {
        return [];
    }

    // Keep only non-hidden directories and .md files, with default dirs-first sort
    const relevant = entries
        .filter(e => {
            if (safeRoot && e.isSymbolicLink()) {
                return false;
            }
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
    let explicitOrder: string[] = [];
    if (!safeRoot) {
        explicitOrder = await readOrderFile(dir);
    } else {
        const orderPath = basePath ? `${basePath}/.order.json` : '.order.json';
        const safeOrderPath = await resolveSafeNotesPath(safeRoot, orderPath);
        if (!isNotesPathSafetyError(safeOrderPath)) {
            explicitOrder = await readOrderFile(dir);
        }
    }
    const sorted = applyOrder(relevant, e => e.name, explicitOrder);

    const nodes: TreeNode[] = [];
    for (const entry of sorted) {
        const entryPath = basePath ? `${basePath}/${entry.name}` : entry.name;
        if (entry.isDirectory()) {
            const children = await buildTree(path.join(dir, entry.name), entryPath, safeRoot);
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
    notesSearchService: NotesSearchService,
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

            const tree = await buildTree(notesRoot, '', resolved.isDefault ? undefined : notesRoot);
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
            } else if (!rootResult.isDefault) {
                const safePath = await resolveSafeNotesPath(notesRoot, filePath);
                if (isNotesPathSafetyError(safePath)) {
                    return sendError(res, safePath.statusCode, safePath.error);
                }
                resolved = safePath.absolutePath;
            } else {
                resolved = path.resolve(notesRoot, filePath);
            }

            if (rootResult.isDefault && !isAllowedPath(resolved, wsDataDir, ws.rootPath)) {
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

            try {
                const result = await notesSearchService.search({
                    workspaceId: ws.id,
                    rootId: rootResult.rootId,
                    absolutePath: rootResult.absolutePath,
                    isDefault: rootResult.isDefault,
                    isTaskDerived: rootResult.isTaskDerived,
                }, query);
                sendJSON(res, 200, result);
            } catch (err: unknown) {
                const message = err instanceof Error ? err.message : 'Unknown error';
                return sendError(res, 500, 'Failed to search notes: ' + message);
            }
        },
    });
}
