/**
 * Tasks REST API Handler
 *
 * HTTP API routes for exposing the Tasks Viewer folder hierarchy,
 * file content, and write operations (create, rename, delete, archive)
 * for a given workspace. Uses the shared TaskManager from pipeline-core.
 *
 * No VS Code dependencies - uses only Node.js built-in modules.
 * Cross-platform compatible (Linux/Mac/Windows).
 */

import * as url from 'url';
import * as path from 'path';
import * as fs from 'fs';
import type { ProcessStore } from '@plusplusoneplusplus/pipeline-core';
import { TaskManager } from '@plusplusoneplusplus/pipeline-core';
import type { TasksViewerSettings } from '@plusplusoneplusplus/pipeline-core';
import { sendJSON, sendError, parseBody } from './api-handler';
import type { Route } from './types';

// ============================================================================
// Default Settings
// ============================================================================

const DEFAULT_SETTINGS: TasksViewerSettings = {
    enabled: true,
    folderPath: '.vscode/tasks',
    showArchived: false,
    showFuture: false,
    sortBy: 'name',
    groupRelatedDocuments: true,
    discovery: {
        enabled: false,
        defaultScope: {
            includeSourceFiles: true,
            includeDocs: true,
            includeConfigFiles: false,
            includeGitHistory: false,
            maxCommits: 50,
        },
        showRelatedInTree: true,
        groupByCategory: true,
    },
};

// ============================================================================
// Workspace resolution helper
// ============================================================================

async function resolveWorkspace(store: ProcessStore, id: string) {
    const workspaces = await store.getWorkspaces();
    return workspaces.find(w => w.id === id);
}

// ============================================================================
// Route Registration
// ============================================================================

/**
 * Register all task read-only API routes on the given route table.
 * Mutates the `routes` array in-place.
 */
export function registerTaskRoutes(routes: Route[], store: ProcessStore): void {

    // ------------------------------------------------------------------
    // GET /api/workspaces/:id/tasks/content — Raw markdown content
    // (must be registered before the general /tasks route)
    // ------------------------------------------------------------------
    routes.push({
        method: 'GET',
        pattern: /^\/api\/workspaces\/([^/]+)\/tasks\/content$/,
        handler: async (req, res, match) => {
            const id = decodeURIComponent(match![1]);
            const ws = await resolveWorkspace(store, id);
            if (!ws) {
                return sendError(res, 404, 'Workspace not found');
            }

            const parsed = url.parse(req.url || '/', true);
            const filePath = typeof parsed.query.path === 'string' ? parsed.query.path : '';
            if (!filePath) {
                return sendError(res, 400, 'Missing required query parameter: path');
            }

            const folderParam = typeof parsed.query.folder === 'string' && parsed.query.folder
                ? parsed.query.folder
                : '.vscode/tasks';
            const tasksFolder = path.resolve(ws.rootPath, folderParam);

            // Path-traversal guard
            const resolvedPath = path.resolve(tasksFolder, filePath);
            if (!resolvedPath.startsWith(tasksFolder + path.sep) && resolvedPath !== tasksFolder) {
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
            const id = decodeURIComponent(match![1]);
            const ws = await resolveWorkspace(store, id);
            if (!ws) {
                return sendError(res, 404, 'Workspace not found');
            }

            sendJSON(res, 200, DEFAULT_SETTINGS);
        },
    });

    // ------------------------------------------------------------------
    // GET /api/workspaces/:id/tasks — Full task folder hierarchy
    // ------------------------------------------------------------------
    routes.push({
        method: 'GET',
        pattern: /^\/api\/workspaces\/([^/]+)\/tasks$/,
        handler: async (req, res, match) => {
            const id = decodeURIComponent(match![1]);
            const ws = await resolveWorkspace(store, id);
            if (!ws) {
                return sendError(res, 404, 'Workspace not found');
            }

            const parsed = url.parse(req.url || '/', true);
            const folder = (typeof parsed.query.folder === 'string' && parsed.query.folder)
                ? parsed.query.folder
                : DEFAULT_SETTINGS.folderPath;

            const manager = new TaskManager({
                workspaceRoot: ws.rootPath,
                settings: { ...DEFAULT_SETTINGS, folderPath: folder },
            });

            try {
                const hierarchy = await manager.getTaskFolderHierarchy();
                sendJSON(res, 200, hierarchy);
            } catch (err: any) {
                return sendError(res, 500, 'Failed to scan tasks: ' + (err.message || 'Unknown error'));
            }
        },
    });
}

// ============================================================================
// Valid task statuses
// ============================================================================

const VALID_TASK_STATUSES = ['pending', 'in-progress', 'done', 'future'];

// ============================================================================
// Path Security Helper
// ============================================================================

/**
 * Resolve a user-supplied path against a tasks folder and validate
 * that the result is inside (or equal to) the tasks folder.
 * Returns the resolved absolute path, or null if the check fails.
 */
function resolveAndValidatePath(tasksFolder: string, userPath: string): string | null {
    const resolved = path.resolve(tasksFolder, userPath);
    if (resolved === tasksFolder || resolved.startsWith(tasksFolder + path.sep)) {
        return resolved;
    }
    return null;
}

// ============================================================================
// Write Route Registration
// ============================================================================

/**
 * Register task write (mutation) API routes on the given route table.
 * Mutates the `routes` array in-place.
 */
export function registerTaskWriteRoutes(routes: Route[], store: ProcessStore): void {

    // ------------------------------------------------------------------
    // POST /api/workspaces/:id/tasks — Create task file or folder
    // ------------------------------------------------------------------
    routes.push({
        method: 'POST',
        pattern: /^\/api\/workspaces\/([^/]+)\/tasks$/,
        handler: async (req, res, match) => {
            const id = decodeURIComponent(match![1]);
            const ws = await resolveWorkspace(store, id);
            if (!ws) {
                return sendError(res, 404, 'Workspace not found');
            }

            let body: any;
            try {
                body = await parseBody(req);
            } catch {
                return sendError(res, 400, 'Invalid JSON body');
            }

            const { name, type, folder, parent, docType } = body || {};
            if (!name || typeof name !== 'string' || !name.trim()) {
                return sendError(res, 400, 'Missing required field: name');
            }

            const tasksFolder = path.resolve(ws.rootPath, DEFAULT_SETTINGS.folderPath);

            if (type === 'folder') {
                // Create folder
                const parentDir = parent ? path.resolve(tasksFolder, parent) : tasksFolder;
                const resolvedParent = resolveAndValidatePath(tasksFolder, parent || '');
                if (!resolvedParent) {
                    return sendError(res, 403, 'Access denied: path is outside tasks folder');
                }
                const folderPath = path.join(resolvedParent, name.trim());
                if (!resolveAndValidatePath(tasksFolder, path.relative(tasksFolder, folderPath))) {
                    return sendError(res, 403, 'Access denied: path is outside tasks folder');
                }

                try {
                    await fs.promises.mkdir(folderPath, { recursive: true });
                    const relPath = path.relative(tasksFolder, folderPath);
                    sendJSON(res, 201, { path: relPath, name: name.trim(), type: 'folder' });
                } catch (err: any) {
                    return sendError(res, 500, 'Failed to create folder: ' + (err.message || 'Unknown error'));
                }
            } else {
                // Create task file
                const targetDir = folder
                    ? path.resolve(tasksFolder, folder)
                    : tasksFolder;
                const resolvedDir = resolveAndValidatePath(tasksFolder, folder || '');
                if (!resolvedDir) {
                    return sendError(res, 403, 'Access denied: path is outside tasks folder');
                }

                const sanitizedName = name.trim();
                const fileName = docType
                    ? `${sanitizedName}.${docType}.md`
                    : `${sanitizedName}.md`;
                const filePath = path.join(resolvedDir, fileName);

                if (!resolveAndValidatePath(tasksFolder, path.relative(tasksFolder, filePath))) {
                    return sendError(res, 403, 'Access denied: path is outside tasks folder');
                }

                // Check for collision
                try {
                    await fs.promises.access(filePath);
                    return sendError(res, 409, 'File already exists');
                } catch {
                    // Expected: file does not exist
                }

                const frontmatter = '---\nstatus: pending\n---\n\n# ' + sanitizedName + '\n';
                try {
                    await fs.promises.mkdir(resolvedDir, { recursive: true });
                    await fs.promises.writeFile(filePath, frontmatter, 'utf-8');
                    const relPath = path.relative(tasksFolder, filePath);
                    sendJSON(res, 201, { path: relPath, name: sanitizedName, type: 'file' });
                } catch (err: any) {
                    return sendError(res, 500, 'Failed to create task: ' + (err.message || 'Unknown error'));
                }
            }
        },
    });

    // ------------------------------------------------------------------
    // PATCH /api/workspaces/:id/tasks — Rename or update status
    // ------------------------------------------------------------------
    routes.push({
        method: 'PATCH',
        pattern: /^\/api\/workspaces\/([^/]+)\/tasks$/,
        handler: async (req, res, match) => {
            const id = decodeURIComponent(match![1]);
            const ws = await resolveWorkspace(store, id);
            if (!ws) {
                return sendError(res, 404, 'Workspace not found');
            }

            let body: any;
            try {
                body = await parseBody(req);
            } catch {
                return sendError(res, 400, 'Invalid JSON body');
            }

            const tasksFolder = path.resolve(ws.rootPath, DEFAULT_SETTINGS.folderPath);
            const { path: itemPath } = body || {};

            if (!itemPath || typeof itemPath !== 'string') {
                return sendError(res, 400, 'Missing required field: path');
            }

            const resolvedPath = resolveAndValidatePath(tasksFolder, itemPath);
            if (!resolvedPath) {
                return sendError(res, 403, 'Access denied: path is outside tasks folder');
            }

            // Distinguish rename vs status update
            if (body.status !== undefined) {
                // Status update
                const { status } = body;
                if (!VALID_TASK_STATUSES.includes(status)) {
                    return sendError(res, 400, 'Invalid status. Must be one of: ' + VALID_TASK_STATUSES.join(', '));
                }

                try {
                    const stat = await fs.promises.stat(resolvedPath);
                    if (!stat.isFile()) {
                        return sendError(res, 400, 'Status can only be set on files');
                    }
                } catch (err: any) {
                    if (err.code === 'ENOENT') {
                        return sendError(res, 404, 'File not found');
                    }
                    return sendError(res, 500, 'Failed to access file');
                }

                try {
                    let content = await fs.promises.readFile(resolvedPath, 'utf-8');
                    const fmRegex = /^---\n([\s\S]*?)\n---/;
                    const fmMatch = content.match(fmRegex);

                    if (fmMatch) {
                        let frontmatter = fmMatch[1];
                        if (/^status:\s*.+$/m.test(frontmatter)) {
                            frontmatter = frontmatter.replace(/^status:\s*.+$/m, `status: ${status}`);
                        } else {
                            frontmatter += `\nstatus: ${status}`;
                        }
                        content = content.replace(fmRegex, `---\n${frontmatter}\n---`);
                    } else {
                        // No frontmatter: prepend it
                        content = `---\nstatus: ${status}\n---\n${content}`;
                    }

                    await fs.promises.writeFile(resolvedPath, content, 'utf-8');
                    sendJSON(res, 200, { path: itemPath, status });
                } catch (err: any) {
                    return sendError(res, 500, 'Failed to update status: ' + (err.message || 'Unknown error'));
                }
            } else if (body.newName !== undefined) {
                // Rename
                const { newName } = body;
                if (!newName || typeof newName !== 'string' || !newName.trim()) {
                    return sendError(res, 400, 'Missing required field: newName');
                }

                try {
                    const stat = await fs.promises.stat(resolvedPath);
                    const dir = path.dirname(resolvedPath);

                    if (stat.isDirectory()) {
                        // Rename directory
                        const newPath = path.join(dir, newName.trim());
                        if (!resolveAndValidatePath(tasksFolder, path.relative(tasksFolder, newPath))) {
                            return sendError(res, 403, 'Access denied: path is outside tasks folder');
                        }
                        try {
                            await fs.promises.access(newPath);
                            return sendError(res, 409, 'A file or folder with that name already exists');
                        } catch { /* expected */ }

                        await fs.promises.rename(resolvedPath, newPath);
                        const relPath = path.relative(tasksFolder, newPath);
                        sendJSON(res, 200, { path: relPath, name: newName.trim() });
                    } else {
                        // Check if this is part of a document group
                        const basename = path.basename(resolvedPath);
                        const ext = path.extname(basename); // .md
                        const nameWithoutExt = basename.slice(0, -ext.length); // e.g., "task1.plan"

                        // Detect document group: name.docType.md pattern
                        const docTypeParts = nameWithoutExt.split('.');
                        const isDocGroup = docTypeParts.length >= 2;
                        const baseGroupName = isDocGroup ? docTypeParts[0] : nameWithoutExt;

                        if (isDocGroup) {
                            // Find all files matching the document group
                            const entries = await fs.promises.readdir(dir);
                            const groupFiles = entries.filter(e =>
                                e.startsWith(baseGroupName + '.') && e.endsWith('.md')
                            );

                            // Check for collision on new name
                            const newGroupFiles = entries.filter(e =>
                                e.startsWith(newName.trim() + '.') && e.endsWith('.md')
                            );
                            if (newGroupFiles.length > 0) {
                                return sendError(res, 409, 'A document group with that name already exists');
                            }

                            // Rename all files in the group
                            for (const file of groupFiles) {
                                const suffix = file.slice(baseGroupName.length); // e.g., ".plan.md"
                                const newFileName = newName.trim() + suffix;
                                const oldFilePath = path.join(dir, file);
                                const newFilePath = path.join(dir, newFileName);
                                await fs.promises.rename(oldFilePath, newFilePath);
                            }

                            const relPath = path.relative(tasksFolder, path.join(dir, newName.trim() + docTypeParts.slice(1).map(p => '.' + p).join('') + ext));
                            sendJSON(res, 200, { path: relPath, name: newName.trim() });
                        } else {
                            // Single file rename
                            const newFileName = newName.trim() + ext;
                            const newPath = path.join(dir, newFileName);
                            if (!resolveAndValidatePath(tasksFolder, path.relative(tasksFolder, newPath))) {
                                return sendError(res, 403, 'Access denied: path is outside tasks folder');
                            }
                            try {
                                await fs.promises.access(newPath);
                                return sendError(res, 409, 'A file with that name already exists');
                            } catch { /* expected */ }

                            await fs.promises.rename(resolvedPath, newPath);
                            const relPath = path.relative(tasksFolder, newPath);
                            sendJSON(res, 200, { path: relPath, name: newName.trim() });
                        }
                    }
                } catch (err: any) {
                    if (err.code === 'ENOENT') {
                        return sendError(res, 404, 'File or folder not found');
                    }
                    // If already sent a response (409), don't send again
                    if (res.writableEnded) return;
                    return sendError(res, 500, 'Failed to rename: ' + (err.message || 'Unknown error'));
                }
            } else {
                return sendError(res, 400, 'Body must contain either "status" or "newName"');
            }
        },
    });

    // ------------------------------------------------------------------
    // DELETE /api/workspaces/:id/tasks — Delete task file or folder
    // ------------------------------------------------------------------
    routes.push({
        method: 'DELETE',
        pattern: /^\/api\/workspaces\/([^/]+)\/tasks$/,
        handler: async (req, res, match) => {
            const id = decodeURIComponent(match![1]);
            const ws = await resolveWorkspace(store, id);
            if (!ws) {
                return sendError(res, 404, 'Workspace not found');
            }

            let body: any;
            try {
                body = await parseBody(req);
            } catch {
                return sendError(res, 400, 'Invalid JSON body');
            }

            const { path: itemPath } = body || {};
            if (!itemPath || typeof itemPath !== 'string') {
                return sendError(res, 400, 'Missing required field: path');
            }

            const tasksFolder = path.resolve(ws.rootPath, DEFAULT_SETTINGS.folderPath);
            const resolvedPath = resolveAndValidatePath(tasksFolder, itemPath);
            if (!resolvedPath) {
                return sendError(res, 403, 'Access denied: path is outside tasks folder');
            }

            try {
                const stat = await fs.promises.stat(resolvedPath);
                if (stat.isDirectory()) {
                    await fs.promises.rm(resolvedPath, { recursive: true });
                } else {
                    await fs.promises.unlink(resolvedPath);
                }
                res.writeHead(204);
                res.end();
            } catch (err: any) {
                if (err.code === 'ENOENT') {
                    return sendError(res, 404, 'File or folder not found');
                }
                return sendError(res, 500, 'Failed to delete: ' + (err.message || 'Unknown error'));
            }
        },
    });

    // ------------------------------------------------------------------
    // POST /api/workspaces/:id/tasks/archive — Archive or unarchive
    // ------------------------------------------------------------------
    routes.push({
        method: 'POST',
        pattern: /^\/api\/workspaces\/([^/]+)\/tasks\/archive$/,
        handler: async (req, res, match) => {
            const id = decodeURIComponent(match![1]);
            const ws = await resolveWorkspace(store, id);
            if (!ws) {
                return sendError(res, 404, 'Workspace not found');
            }

            let body: any;
            try {
                body = await parseBody(req);
            } catch {
                return sendError(res, 400, 'Invalid JSON body');
            }

            const { path: itemPath, action } = body || {};
            if (!itemPath || typeof itemPath !== 'string') {
                return sendError(res, 400, 'Missing required field: path');
            }
            if (action !== 'archive' && action !== 'unarchive') {
                return sendError(res, 400, 'Invalid action. Must be "archive" or "unarchive"');
            }

            const tasksFolder = path.resolve(ws.rootPath, DEFAULT_SETTINGS.folderPath);
            const archiveFolder = path.join(tasksFolder, 'archive');
            const resolvedPath = resolveAndValidatePath(tasksFolder, itemPath);
            if (!resolvedPath) {
                return sendError(res, 403, 'Access denied: path is outside tasks folder');
            }

            try {
                await fs.promises.stat(resolvedPath);
            } catch (err: any) {
                if (err.code === 'ENOENT') {
                    return sendError(res, 404, 'File or folder not found');
                }
                return sendError(res, 500, 'Failed to access path');
            }

            try {
                if (action === 'archive') {
                    // Move from tasks folder to archive/, preserving relative structure
                    const relFromTasks = path.relative(tasksFolder, resolvedPath);
                    let destPath = path.join(archiveFolder, relFromTasks);

                    // Handle name collision
                    try {
                        await fs.promises.access(destPath);
                        // Collision: append timestamp
                        const ext = path.extname(destPath);
                        const base = destPath.slice(0, destPath.length - ext.length);
                        destPath = `${base}-${Date.now()}${ext}`;
                    } catch { /* no collision */ }

                    await fs.promises.mkdir(path.dirname(destPath), { recursive: true });
                    await fs.promises.rename(resolvedPath, destPath);
                    const newRelPath = path.relative(tasksFolder, destPath);
                    sendJSON(res, 200, { path: newRelPath });
                } else {
                    // Unarchive: move from archive/ back to tasks root
                    const relFromArchive = path.relative(archiveFolder, resolvedPath);
                    if (relFromArchive.startsWith('..')) {
                        return sendError(res, 400, 'Path is not inside the archive folder');
                    }
                    let destPath = path.join(tasksFolder, relFromArchive);

                    // Handle name collision
                    try {
                        await fs.promises.access(destPath);
                        const ext = path.extname(destPath);
                        const base = destPath.slice(0, destPath.length - ext.length);
                        destPath = `${base}-${Date.now()}${ext}`;
                    } catch { /* no collision */ }

                    await fs.promises.mkdir(path.dirname(destPath), { recursive: true });
                    await fs.promises.rename(resolvedPath, destPath);
                    const newRelPath = path.relative(tasksFolder, destPath);
                    sendJSON(res, 200, { path: newRelPath });
                }
            } catch (err: any) {
                return sendError(res, 500, 'Failed to ' + action + ': ' + (err.message || 'Unknown error'));
            }
        },
    });
}
