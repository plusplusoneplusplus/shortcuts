/**
 * Tasks REST API Handler — read-only routes.
 *
 * HTTP API routes for exposing the Tasks Viewer folder hierarchy,
 * file content, and settings for a given workspace.
 *
 * No VS Code dependencies - uses only Node.js built-in modules.
 * Cross-platform compatible (Linux/Mac/Windows).
 */

import * as url from 'url';
import * as path from 'path';
import * as fs from 'fs';
import type { ProcessStore, TaskFolder, TaskDocument } from '@plusplusoneplusplus/forge';
import { getFullTaskHierarchy, isWithinDirectory } from '@plusplusoneplusplus/forge';
import { sendJSON, sendError } from './api-handler';
import { resolveWorkspaceOrFail } from './shared/handler-utils';
import type { Route } from './types';
import { resolveTaskRoot, resolveAllTaskRoots } from './task-root-resolver';
import { isWithinTrustedReadOnlyDir, DEFAULT_SETTINGS, buildArchiveFolderNode, mergeTaskFoldersAsVirtualRoot, readTasksSettings, writeTasksSettings } from './tasks-handler-utils';

/**
 * Recursively set `taskRootPath` on every folder and document in a TaskFolder tree.
 */
function annotateTaskRootPath(folder: TaskFolder, rootPath: string): void {
    folder.taskRootPath = rootPath;
    for (const doc of folder.singleDocuments) doc.taskRootPath = rootPath;
    for (const group of folder.documentGroups) {
        for (const doc of group.documents) doc.taskRootPath = rootPath;
    }
    const contextDocs: TaskDocument[] = (folder as any).contextDocuments ?? [];
    for (const doc of contextDocs) doc.taskRootPath = rootPath;
    for (const child of folder.children) annotateTaskRootPath(child, rootPath);
}

// ============================================================================
// Route Registration
// ============================================================================

/**
 * Register all task read-only API routes on the given route table.
 * Mutates the `routes` array in-place.
 */
export function registerTaskRoutes(routes: Route[], store: ProcessStore, dataDir: string, onTasksChanged?: (workspaceId: string) => void): void {

    // ------------------------------------------------------------------
    // GET /api/workspaces/:id/files/preview — File content preview
    // Returns first N lines (or full content) of a file within the workspace.
    // ------------------------------------------------------------------
    routes.push({
        method: 'GET',
        pattern: /^\/api\/workspaces\/([^/]+)\/files\/preview$/,
        handler: async (req, res, match) => {
            const ws = await resolveWorkspaceOrFail(store, match!, res);
            if (!ws) return;

            const parsed = url.parse(req.url || '/', true);
            const filePath = typeof parsed.query.path === 'string' ? parsed.query.path : '';
            if (!filePath) {
                return sendError(res, 400, 'Missing required query parameter: path');
            }

            // Resolve and validate path is within workspace, a trusted read-only directory, or the task root
            const resolvedPath = path.resolve(filePath);
            const wsRoot = path.resolve(ws.rootPath);
            const taskRoot = resolveTaskRoot({ dataDir, rootPath: ws.rootPath, workspaceId: ws.id });
            if (!isWithinDirectory(resolvedPath, wsRoot) && !isWithinTrustedReadOnlyDir(resolvedPath, dataDir) && !isWithinDirectory(resolvedPath, taskRoot.absolutePath)) {
                return sendError(res, 403, 'Access denied: path is outside workspace');
            }

            try {
                const stat = await fs.promises.stat(resolvedPath);

                // ── Directory listing ──────────────────────────────
                if (stat.isDirectory()) {
                    const MAX_DIR_ENTRIES = 30;
                    const dirents = await fs.promises.readdir(resolvedPath, { withFileTypes: true });
                    // Sort: directories first, then files, both alphabetical
                    dirents.sort((a, b) => {
                        const aDir = a.isDirectory() ? 0 : 1;
                        const bDir = b.isDirectory() ? 0 : 1;
                        if (aDir !== bDir) return aDir - bDir;
                        return a.name.localeCompare(b.name);
                    });
                    const totalEntries = dirents.length;
                    const truncated = totalEntries > MAX_DIR_ENTRIES;
                    const entries = dirents.slice(0, MAX_DIR_ENTRIES).map(d => ({
                        name: d.name,
                        isDirectory: d.isDirectory(),
                    }));
                    const dirName = path.basename(resolvedPath);
                    return sendJSON(res, 200, {
                        type: 'directory',
                        path: resolvedPath,
                        dirName,
                        entries,
                        totalEntries,
                        truncated,
                    });
                }

                // ── File preview ───────────────────────────────────
                // Binary file rejection by extension
                const BINARY_EXTS = new Set([
                    '.png', '.jpg', '.jpeg', '.gif', '.bmp', '.ico', '.webp', '.svg',
                    '.mp3', '.mp4', '.avi', '.mov', '.mkv', '.wav', '.flac',
                    '.zip', '.tar', '.gz', '.bz2', '.7z', '.rar',
                    '.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx',
                    '.exe', '.dll', '.so', '.dylib', '.bin', '.o', '.a',
                    '.woff', '.woff2', '.ttf', '.eot', '.otf',
                ]);
                const ext = path.extname(resolvedPath).toLowerCase();
                if (BINARY_EXTS.has(ext)) {
                    return sendError(res, 400, 'Binary files are not supported');
                }

                // Parse lines parameter (default 20, 0 = all, max 500)
                let maxLines = 20;
                const linesParam = parsed.query.lines;
                if (typeof linesParam === 'string' && linesParam !== '') {
                    maxLines = parseInt(linesParam, 10);
                    if (isNaN(maxLines) || maxLines < 0) maxLines = 20;
                    if (maxLines > 500 && maxLines !== 0) maxLines = 500;
                }

                if (!stat.isFile()) {
                    return sendError(res, 404, 'Not a file');
                }
                // File size cap: 2MB
                if (stat.size > 2 * 1024 * 1024) {
                    return sendError(res, 400, 'File too large (max 2MB)');
                }

                const content = await fs.promises.readFile(resolvedPath, 'utf-8');
                const allLines = content.split('\n');
                // Remove trailing empty line from split
                if (allLines.length > 0 && allLines[allLines.length - 1] === '') {
                    allLines.pop();
                }

                const truncated = maxLines > 0 && allLines.length > maxLines;
                const lines = maxLines === 0 ? allLines : allLines.slice(0, maxLines);

                const fileName = path.basename(resolvedPath);
                const language = ext ? ext.substring(1) : '';

                sendJSON(res, 200, {
                    type: 'file',
                    path: resolvedPath,
                    fileName,
                    lines,
                    totalLines: allLines.length,
                    truncated,
                    language,
                });
            } catch (err: any) {
                if (err.code === 'ENOENT') {
                    return sendError(res, 404, 'File not found');
                }
                return sendError(res, 500, 'Failed to read file: ' + (err.message || 'Unknown error'));
            }
        },
    });

    // GET /api/workspaces/:id/files/image — Serve local image file as raw binary.
    // Used to proxy local paths from LLM-generated ![alt](path) markdown in chat.
    // Security: restricted to image extensions only; relies on OS file permissions.
    routes.push({
        method: 'GET',
        pattern: /^\/api\/workspaces\/([^/]+)\/files\/image$/,
        handler: async (req, res, match) => {
            const ws = await resolveWorkspaceOrFail(store, match!, res);
            if (!ws) return;

            const parsed = url.parse(req.url || '/', true);
            const filePath = typeof parsed.query.path === 'string' ? parsed.query.path : '';
            if (!filePath) return sendError(res, 400, 'Missing required query parameter: path');

            const IMAGE_TYPES: Record<string, string> = {
                '.png': 'image/png',
                '.jpg': 'image/jpeg',
                '.jpeg': 'image/jpeg',
                '.gif': 'image/gif',
                '.webp': 'image/webp',
                '.svg': 'image/svg+xml',
                '.bmp': 'image/bmp',
                '.ico': 'image/x-icon',
            };
            const ext = path.extname(filePath).toLowerCase();
            const contentType = IMAGE_TYPES[ext];
            if (!contentType) return sendError(res, 415, 'Unsupported image type');

            try {
                const data = await fs.promises.readFile(filePath);
                res.writeHead(200, {
                    'Content-Type': contentType,
                    'Content-Length': data.length,
                    'Cache-Control': 'private, max-age=3600',
                });
                res.end(data);
            } catch (err: any) {
                if (err.code === 'ENOENT') return sendError(res, 404, 'Image not found');
                return sendError(res, 500, 'Failed to read image: ' + (err.message || 'Unknown error'));
            }
        },
    });

    // ------------------------------------------------------------------
    // GET /api/workspaces/:id/tasks/content — Raw markdown content
    // (must be registered before the general /tasks route)
    // ------------------------------------------------------------------
    routes.push({
        method: 'GET',
        pattern: /^\/api\/workspaces\/([^/]+)\/tasks\/content$/,
        handler: async (req, res, match) => {
            const ws = await resolveWorkspaceOrFail(store, match!, res);
            if (!ws) return;

            const parsed = url.parse(req.url || '/', true);
            const filePath = typeof parsed.query.path === 'string' ? parsed.query.path : '';
            if (!filePath) {
                return sendError(res, 400, 'Missing required query parameter: path');
            }

            const folderParam = typeof parsed.query.folder === 'string' && parsed.query.folder
                ? parsed.query.folder
                : undefined;
            const taskRoot = resolveTaskRoot({ dataDir, rootPath: ws.rootPath, workspaceId: ws.id });
            const tasksFolder = folderParam
                ? path.resolve(ws.rootPath, folderParam)
                : taskRoot.absolutePath;
            const resolvedPath = path.resolve(tasksFolder, filePath);
            if (!isWithinDirectory(resolvedPath, tasksFolder) && !isWithinTrustedReadOnlyDir(resolvedPath, dataDir) && !isWithinDirectory(resolvedPath, taskRoot.absolutePath)) {
                return sendError(res, 403, 'Access denied: path is outside tasks folder');
            }

            try {
                const stat = await fs.promises.stat(resolvedPath);
                if (!stat.isFile()) {
                    return sendError(res, 404, 'Not a file');
                }
                const content = await fs.promises.readFile(resolvedPath, 'utf-8');
                sendJSON(res, 200, { content, path: filePath });
            } catch (err: any) {
                if (err.code === 'ENOENT') {
                    return sendError(res, 404, 'File not found');
                }
                return sendError(res, 500, 'Failed to read file');
            }
        },
    });

    // ------------------------------------------------------------------
    // GET /api/workspaces/:id/tasks/settings — Default task settings
    // (must be registered before the general /tasks route)
    // ------------------------------------------------------------------
    routes.push({
        method: 'GET',
        pattern: /^\/api\/workspaces\/([^/]+)\/tasks\/settings$/,
        handler: async (_req, res, match) => {
            const ws = await resolveWorkspaceOrFail(store, match!, res);
            if (!ws) return;

            const taskRoot = resolveTaskRoot({ dataDir, rootPath: ws.rootPath, workspaceId: ws.id });
            const tasksSettings = await readTasksSettings(dataDir, ws.id);

            let folderPaths = tasksSettings.folderPaths;
            let hasDefaultFolderPaths = false;

            // When no settings file has been saved yet, inject .vscode/tasks
            // as a default additional folder — but only if the directory exists.
            if (!tasksSettings.persisted && folderPaths.length === 0) {
                const defaultDir = path.join(ws.rootPath, '.vscode', 'tasks');
                try {
                    const stat = await fs.promises.stat(defaultDir);
                    if (stat.isDirectory()) {
                        folderPaths = ['.vscode/tasks'];
                        hasDefaultFolderPaths = true;
                    }
                } catch { /* directory doesn't exist — leave empty */ }
            }

            sendJSON(res, 200, {
                ...DEFAULT_SETTINGS,
                folderPath: taskRoot.absolutePath,
                taskRootPath: taskRoot.absolutePath,
                folderPaths,
                hasDefaultFolderPaths,
            });
        },
    });

    // ------------------------------------------------------------------
    // PATCH /api/workspaces/:id/tasks/settings — Update task settings
    // (must be registered before the general /tasks route)
    // ------------------------------------------------------------------
    routes.push({
        method: 'PATCH',
        pattern: /^\/api\/workspaces\/([^/]+)\/tasks\/settings$/,
        handler: async (req, res, match) => {
            const ws = await resolveWorkspaceOrFail(store, match!, res);
            if (!ws) return;

            let body = '';
            req.on('data', (chunk: Buffer) => { body += chunk.toString(); });
            req.on('end', async () => {
                try {
                    const parsed = JSON.parse(body);
                    if (!parsed || !Array.isArray(parsed.folderPaths)) {
                        return sendError(res, 400, 'Body must contain folderPaths: string[]');
                    }
                    const folderPaths: string[] = parsed.folderPaths;

                    // Validate each path
                    for (const p of folderPaths) {
                        if (typeof p !== 'string' || p.trim() === '') {
                            return sendError(res, 400, 'Each folderPath must be a non-empty string');
                        }
                        const abs = path.isAbsolute(p) ? path.resolve(p) : path.resolve(ws.rootPath, p);
                        if (!isWithinDirectory(abs, ws.rootPath) && !isWithinTrustedReadOnlyDir(abs, dataDir)) {
                            return sendError(res, 403, `Path outside trusted directories: ${p}`);
                        }
                    }

                    await writeTasksSettings(dataDir, ws.id, { folderPaths });

                    // Notify UI via WebSocket
                    if (onTasksChanged) {
                        onTasksChanged(ws.id);
                    }

                    const tasksSettings = await readTasksSettings(dataDir, ws.id);
                    sendJSON(res, 200, { folderPaths: tasksSettings.folderPaths });
                } catch (err: any) {
                    if (err instanceof SyntaxError) {
                        return sendError(res, 400, 'Invalid JSON body');
                    }
                    return sendError(res, 500, 'Failed to save settings: ' + (err.message || 'Unknown error'));
                }
            });
        },
    });

    // ------------------------------------------------------------------
    // GET /api/workspaces/:id/tasks — Full task folder hierarchy
    // ------------------------------------------------------------------
    routes.push({
        method: 'GET',
        pattern: /^\/api\/workspaces\/([^/]+)\/tasks$/,
        handler: async (req, res, match) => {
            const ws = await resolveWorkspaceOrFail(store, match!, res);
            if (!ws) return;

            const parsed = url.parse(req.url || '/', true);
            const folder = (typeof parsed.query.folder === 'string' && parsed.query.folder)
                ? parsed.query.folder
                : undefined;
            const taskRootOpts = { dataDir, rootPath: ws.rootPath, workspaceId: ws.id };
            const resolvedFolder = folder
                ? path.resolve(ws.rootPath, folder)
                : resolveTaskRoot(taskRootOpts).absolutePath;
            const includeArchiveFolder= parsed.query.showArchived === 'true';

            try {
                // Read additional folder paths from settings
                const tasksSettings = await readTasksSettings(dataDir, ws.id);
                const additionalPaths = folder ? [] : tasksSettings.folderPaths;

                // Helper: scan a single folder and optionally append archive node
                const scanFolder = async (folderPath: string) => {
                    const hierarchy = await getFullTaskHierarchy(folderPath);
                    annotateTaskRootPath(hierarchy, folderPath);
                    if (includeArchiveFolder) {
                        const archiveDir = path.join(folderPath, 'archive');
                        try {
                            const stat = await fs.promises.stat(archiveDir);
                            if (stat.isDirectory()) {
                                const archiveNode = buildArchiveFolderNode(archiveDir);
                                annotateTaskRootPath(archiveNode, folderPath);
                                hierarchy.children = hierarchy.children || [];
                                hierarchy.children.push(archiveNode);
                            }
                        } catch { /* archive folder doesn't exist — skip */ }
                    }
                    return hierarchy;
                };

                if (additionalPaths.length > 0) {
                    // Multi-folder: resolve all roots and merge
                    const allRoots = resolveAllTaskRoots(taskRootOpts, additionalPaths);
                    const scanned = await Promise.all(
                        allRoots.map(async (root) => {
                            try {
                                // Skip folders that don't exist on disk
                                const stat = await fs.promises.stat(root.absolutePath);
                                if (!stat.isDirectory()) return null;
                                const folder = await scanFolder(root.absolutePath);
                                return { folder, label: root.label };
                            } catch {
                                return null;
                            }
                        }),
                    );
                    const validFolders = scanned.filter((s): s is NonNullable<typeof s> => s !== null);
                    if (validFolders.length === 1) {
                        sendJSON(res, 200, validFolders[0].folder);
                    } else {
                        sendJSON(res, 200, mergeTaskFoldersAsVirtualRoot(validFolders));
                    }
                } else {
                    // Single folder (default behaviour)
                    const hierarchy = await scanFolder(resolvedFolder);
                    sendJSON(res, 200, hierarchy);
                }
            } catch (err: any) {
                return sendError(res, 500, 'Failed to scan tasks: ' + (err.message || 'Unknown error'));
            }
        },
    });
}
