/**
 * Tasks REST API Handler — write/mutation routes.
 *
 * HTTP API routes for task write operations (create, rename, delete,
 * move, archive) for a given workspace.
 *
 * No VS Code dependencies - uses only Node.js built-in modules.
 * Cross-platform compatible (Linux/Mac/Windows).
 */

import * as path from 'path';
import * as fs from 'fs';
import type { ProcessStore } from '@plusplusoneplusplus/forge';
import { ARCHIVE_UNDO_FILE, isWithinDirectory, VALID_TASK_STATUSES } from '@plusplusoneplusplus/forge';
import { sendJSON, sendError } from '../core/api-handler';
import { resolveWorkspaceOrFail, parseBodyOrReject } from '../shared/handler-utils';
import { resolveCollision, getErrorMessage } from '../shared/fs-utils';
import type { Route } from '../types';
import { resolveTaskRoot, resolveAllTaskRoots } from './task-root-resolver';
import { resolveAndValidatePath, copyRecursive, readTasksSettings } from './tasks-handler-utils';
import { taskCache } from './task-cache';

// ============================================================================
// Write Route Registration
// ============================================================================

/**
 * Register task write (mutation) API routes on the given route table.
 * Mutates the `routes` array in-place.
 */
export function registerTaskWriteRoutes(routes: Route[], store: ProcessStore, dataDir: string): void {

    // ------------------------------------------------------------------
    // POST /api/workspaces/:id/tasks — Create task file or folder
    // ------------------------------------------------------------------
    routes.push({
        method: 'POST',
        pattern: /^\/api\/workspaces\/([^/]+)\/tasks$/,
        handler: async (req, res, match) => {
            const ws = await resolveWorkspaceOrFail(store, match!, res);
            if (!ws) return;

            const body = await parseBodyOrReject(req, res);
            if (body === null) return;

            const { name, type, folder, parent, docType } = body || {};
            if (!name || typeof name !== 'string' || !name.trim()) {
                return sendError(res, 400, 'Missing required field: name');
            }

            const tasksFolder = resolveTaskRoot({ dataDir, rootPath: ws.rootPath, workspaceId: ws.id }).absolutePath;

            if (type === 'folder') {
                // Create folder
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
                    taskCache.invalidateWorkspace(ws.id);
                    sendJSON(res, 201, { path: relPath, name: name.trim(), type: 'folder' });
                } catch (err: any) {
                    return sendError(res, 500, 'Failed to create folder: ' + (err.message || 'Unknown error'));
                }
            } else {
                // Create task file
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
                    taskCache.invalidateWorkspace(ws.id);
                    sendJSON(res, 201, { path: relPath, name: sanitizedName, type: 'file' });
                } catch (err: any) {
                    return sendError(res, 500, 'Failed to create task: ' + (err.message || 'Unknown error'));
                }
            }
        },
    });

    // ------------------------------------------------------------------
    // PATCH /api/workspaces/:id/tasks/content — Write task file content
    // ------------------------------------------------------------------
    routes.push({
        method: 'PATCH',
        pattern: /^\/api\/workspaces\/([^/]+)\/tasks\/content$/,
        handler: async (req, res, match) => {
            const ws = await resolveWorkspaceOrFail(store, match!, res);
            if (!ws) return;

            const body = await parseBodyOrReject(req, res);
            if (body === null) return;

            const { path: filePath, content, expectedMtime, folderPath: clientFolderPath } = body || {};
            if (!filePath || typeof filePath !== 'string') {
                return sendError(res, 400, 'Missing required field: path');
            }
            if (typeof content !== 'string') {
                return sendError(res, 400, 'Missing required field: content');
            }

            // Resolve the task root: prefer client-supplied folderPath, fall back to primary root,
            // then check additional configured roots before the workspace fallback.
            let resolvedPath: string | null = null;
            if (clientFolderPath && typeof clientFolderPath === 'string') {
                const settings = await readTasksSettings(dataDir, ws.id);
                const allRoots = resolveAllTaskRoots({ dataDir, rootPath: ws.rootPath, workspaceId: ws.id }, settings.folderPaths);
                const rootMatch = allRoots.find(r => path.resolve(r.absolutePath) === path.resolve(clientFolderPath));
                if (rootMatch) {
                    resolvedPath = resolveAndValidatePath(rootMatch.absolutePath, filePath);
                }
            }
            if (!resolvedPath) {
                const tasksFolder = resolveTaskRoot({ dataDir, rootPath: ws.rootPath, workspaceId: ws.id }).absolutePath;
                const candidate = resolveAndValidatePath(tasksFolder, filePath);
                if (candidate && fs.existsSync(candidate)) {
                    resolvedPath = candidate;
                }
            }
            if (!resolvedPath) {
                // Check all additional configured roots before falling back to workspace root.
                const settings = await readTasksSettings(dataDir, ws.id);
                const allRoots = resolveAllTaskRoots({ dataDir, rootPath: ws.rootPath, workspaceId: ws.id }, settings.folderPaths);
                for (const root of allRoots) {
                    const candidate = resolveAndValidatePath(root.absolutePath, filePath);
                    if (candidate && fs.existsSync(candidate)) {
                        resolvedPath = candidate;
                        break;
                    }
                }
            }
            if (!resolvedPath) {
                // Allow writing arbitrary workspace markdown files
                // (mirrors the PATCH /tasks fallback). Used by the
                // floating markdown dialog when the file lives outside
                // the tasks folder.
                const wsResolved = resolveAndValidatePath(ws.rootPath, filePath);
                if (!wsResolved || !wsResolved.toLowerCase().endsWith('.md')) {
                    return sendError(res, 403, 'Access denied: path is outside tasks folder');
                }
                resolvedPath = wsResolved;
            }

            // File must already exist — no creation via write-back
            try {
                const stat = await fs.promises.stat(resolvedPath);
                if (!stat.isFile()) {
                    return sendError(res, 400, 'Path is not a file');
                }
                // Optimistic locking: if expectedMtime is provided, verify the file
                // hasn't been modified since the client last read it.
                if (typeof expectedMtime === 'number') {
                    if (Math.round(stat.mtimeMs) !== Math.round(expectedMtime)) {
                        const currentContent = await fs.promises.readFile(resolvedPath, 'utf-8');
                        return sendJSON(res, 409, {
                            error: 'conflict',
                            reason: 'mtime_mismatch',
                            currentMtime: stat.mtimeMs,
                            currentContent,
                        });
                    }
                }
            } catch (err: any) {
                if (err.code === 'ENOENT') {
                    return sendError(res, 404, 'File not found');
                }
                return sendError(res, 500, 'Failed to access file');
            }

            try {
                await fs.promises.writeFile(resolvedPath, content, 'utf-8');
                taskCache.invalidateWorkspace(ws.id);
                const writtenStat = await fs.promises.stat(resolvedPath);
                sendJSON(res, 200, { path: filePath, updated: true, mtime: writtenStat.mtimeMs });
            } catch (err: any) {
                return sendError(res, 500, 'Failed to write file: ' + (err.message || 'Unknown error'));
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
            const ws = await resolveWorkspaceOrFail(store, match!, res);
            if (!ws) return;

            const body = await parseBodyOrReject(req, res);
            if (body === null) return;

            const tasksFolder = resolveTaskRoot({ dataDir, rootPath: ws.rootPath, workspaceId: ws.id }).absolutePath;
            const { path: itemPath } = body || {};

            if (!itemPath || typeof itemPath !== 'string') {
                return sendError(res, 400, 'Missing required field: path');
            }

            let resolvedPath = resolveAndValidatePath(tasksFolder, itemPath);
            if (!resolvedPath) {
                // Allow workspace .md files (plain md files use absolute paths)
                const wsResolved = resolveAndValidatePath(ws.rootPath, itemPath);
                if (!wsResolved || !wsResolved.endsWith('.md')) {
                    return sendError(res, 403, 'Access denied: path is outside workspace');
                }
                resolvedPath = wsResolved;
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
                    taskCache.invalidateWorkspace(ws.id);
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

                // Reject names containing characters invalid in file/folder names
                // Note: double quotes are sanitized to single quotes rather than rejected
                const INVALID_NAME_CHARS = /[/\\:*?<>|]/;
                if (INVALID_NAME_CHARS.test(newName.trim())) {
                    return sendError(res, 400, 'New name contains invalid characters: / \\ : * ? < > |');
                }

                // Replace double quotes (invalid on Windows) with single quotes
                const sanitizedName = newName.trim().replace(/"/g, "'");

                try {
                    const stat = await fs.promises.stat(resolvedPath);
                    const dir = path.dirname(resolvedPath);

                    if (stat.isDirectory()) {
                        // Rename directory
                        const newPath = path.join(dir, sanitizedName);
                        if (!resolveAndValidatePath(tasksFolder, path.relative(tasksFolder, newPath))) {
                            return sendError(res, 403, 'Access denied: path is outside tasks folder');
                        }
                        try {
                            await fs.promises.access(newPath);
                            return sendError(res, 409, 'A file or folder with that name already exists');
                        } catch { /* expected */ }

                        await fs.promises.rename(resolvedPath, newPath);
                        const relPath = path.relative(tasksFolder, newPath);
                        taskCache.invalidateWorkspace(ws.id);
                        sendJSON(res, 200, { path: relPath, name: sanitizedName });
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
                                e.startsWith(sanitizedName + '.') && e.endsWith('.md')
                            );
                            if (newGroupFiles.length > 0) {
                                return sendError(res, 409, 'A document group with that name already exists');
                            }

                            // Rename all files in the group
                            for (const file of groupFiles) {
                                const suffix = file.slice(baseGroupName.length); // e.g., ".plan.md"
                                const newFileName = sanitizedName + suffix;
                                const oldFilePath = path.join(dir, file);
                                const newFilePath = path.join(dir, newFileName);
                                await fs.promises.rename(oldFilePath, newFilePath);
                            }

                            const relPath = path.relative(tasksFolder, path.join(dir, sanitizedName + docTypeParts.slice(1).map(p => '.' + p).join('') + ext));
                            taskCache.invalidateWorkspace(ws.id);
                            sendJSON(res, 200, { path: relPath, name: sanitizedName });
                        } else {
                            // Single file rename
                            const newFileName = sanitizedName + ext;
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
                            taskCache.invalidateWorkspace(ws.id);
                            sendJSON(res, 200, { path: relPath, name: sanitizedName });
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
            const ws = await resolveWorkspaceOrFail(store, match!, res);
            if (!ws) return;

            const body = await parseBodyOrReject(req, res);
            if (body === null) return;

            const { path: itemPath, folderPath: clientFolderPath } = body || {};
            if (!itemPath || typeof itemPath !== 'string') {
                return sendError(res, 400, 'Missing required field: path');
            }

            // Resolve the task root: prefer client-supplied folderPath, fall back to primary root.
            let tasksFolder: string;
            if (clientFolderPath && typeof clientFolderPath === 'string') {
                const settings = await readTasksSettings(dataDir, ws.id);
                const allRoots = resolveAllTaskRoots({ dataDir, rootPath: ws.rootPath, workspaceId: ws.id }, settings.folderPaths);
                const rootMatch = allRoots.find(r => path.resolve(r.absolutePath) === path.resolve(clientFolderPath));
                if (!rootMatch) {
                    return sendError(res, 403, 'Access denied: folderPath is not a configured task root');
                }
                tasksFolder = rootMatch.absolutePath;
            } else {
                tasksFolder = resolveTaskRoot({ dataDir, rootPath: ws.rootPath, workspaceId: ws.id }).absolutePath;
            }
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
                taskCache.invalidateWorkspace(ws.id);
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
    // POST /api/workspaces/:id/tasks/move — Move file or folder
    // ------------------------------------------------------------------
    routes.push({
        method: 'POST',
        pattern: /^\/api\/workspaces\/([^/]+)\/tasks\/move$/,
        handler: async (req, res, match) => {
            const ws = await resolveWorkspaceOrFail(store, match!, res);
            if (!ws) return;
            const id = ws.id;

            const body = await parseBodyOrReject(req, res);
            if (body === null) return;

            const { sourcePath, destinationFolder, destinationWorkspaceId } = body || {};
            if (!sourcePath || typeof sourcePath !== 'string') {
                return sendError(res, 400, 'Missing required field: sourcePath');
            }
            if (typeof destinationFolder !== 'string') {
                return sendError(res, 400, 'Missing required field: destinationFolder');
            }

            // Resolve destination workspace (cross-workspace move)
            const isCrossWorkspace = typeof destinationWorkspaceId === 'string' && destinationWorkspaceId !== id;
            let destWs = ws;
            if (isCrossWorkspace) {
                const destWorkspaces = await store.getWorkspaces();
                const found = destWorkspaces.find(w => w.id === destinationWorkspaceId);
                if (!found) {
                    return sendError(res, 404, 'Destination workspace not found');
                }
                destWs = found;
            }

            const sourceTasksFolder = resolveTaskRoot({ dataDir, rootPath: ws.rootPath, workspaceId: ws.id }).absolutePath;
            const destTasksFolder = resolveTaskRoot({ dataDir, rootPath: destWs.rootPath, workspaceId: destWs.id }).absolutePath;

            const resolvedSource = resolveAndValidatePath(sourceTasksFolder, sourcePath);
            if (!resolvedSource) {
                return sendError(res, 403, 'Access denied: source path is outside tasks folder');
            }

            const resolvedDest = destinationFolder
                ? resolveAndValidatePath(destTasksFolder, destinationFolder)
                : destTasksFolder;
            if (!resolvedDest) {
                return sendError(res, 403, 'Access denied: destination path is outside tasks folder');
            }

            // Verify source exists
            try {
                await fs.promises.stat(resolvedSource);
            } catch (err: any) {
                if (err.code === 'ENOENT') {
                    return sendError(res, 404, 'Source file or folder not found');
                }
                return sendError(res, 500, 'Failed to access source');
            }

            // Verify destination is a directory (create tasks folder if cross-workspace and missing)
            try {
                const destStat = await fs.promises.stat(resolvedDest);
                if (!destStat.isDirectory()) {
                    return sendError(res, 400, 'Destination is not a directory');
                }
            } catch (err: any) {
                if (err.code === 'ENOENT') {
                    if (isCrossWorkspace && resolvedDest === destTasksFolder) {
                        await fs.promises.mkdir(resolvedDest, { recursive: true });
                    } else {
                        return sendError(res, 404, 'Destination folder not found');
                    }
                } else {
                    return sendError(res, 500, 'Failed to access destination');
                }
            }

            // Prevent moving into itself or a descendant (same-workspace only)
            const sourceName = path.basename(resolvedSource);
            const targetPath = path.join(resolvedDest, sourceName);

            if (!isCrossWorkspace) {
                if (resolvedDest === path.dirname(resolvedSource)) {
                    return sendError(res, 400, 'Source is already in the destination folder');
                }

                if (isWithinDirectory(resolvedDest, resolvedSource)) {
                    return sendError(res, 400, 'Cannot move a folder into itself or its descendant');
                }
            }

            if (!resolveAndValidatePath(destTasksFolder, path.relative(destTasksFolder, targetPath))) {
                return sendError(res, 403, 'Access denied: target path is outside tasks folder');
            }

            let finalTarget = await resolveCollision(targetPath);

            try {
                await fs.promises.rename(resolvedSource, finalTarget);
                const newRelPath = path.relative(destTasksFolder, finalTarget);
                taskCache.invalidateWorkspace(ws.id);
                sendJSON(res, 200, { path: newRelPath, name: path.basename(finalTarget) });
            } catch (err: any) {
                // EXDEV: cross-device rename not supported — fallback to copy + delete
                if (err.code === 'EXDEV') {
                    try {
                        await copyRecursive(resolvedSource, finalTarget);
                        await fs.promises.rm(resolvedSource, { recursive: true, force: true });
                        const newRelPath = path.relative(destTasksFolder, finalTarget);
                        taskCache.invalidateWorkspace(ws.id);
                        sendJSON(res, 200, { path: newRelPath, name: path.basename(finalTarget) });
                    } catch (copyErr: any) {
                        return sendError(res, 500, 'Failed to move (cross-device): ' + (copyErr.message || 'Unknown error'));
                    }
                } else {
                    return sendError(res, 500, 'Failed to move: ' + (err.message || 'Unknown error'));
                }
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
            const ws = await resolveWorkspaceOrFail(store, match!, res);
            if (!ws) return;

            const body = await parseBodyOrReject(req, res);
            if (body === null) return;

            const { path: itemPath, action, folderPath: clientFolderPath } = body || {};
            if (!itemPath || typeof itemPath !== 'string') {
                return sendError(res, 400, 'Missing required field: path');
            }
            if (action !== 'archive' && action !== 'unarchive') {
                return sendError(res, 400, 'Invalid action. Must be "archive" or "unarchive"');
            }

            // Resolve the task root: prefer client-supplied folderPath, fall back to primary root.
            let tasksFolder: string;
            if (clientFolderPath && typeof clientFolderPath === 'string') {
                const settings = await readTasksSettings(dataDir, ws.id);
                const allRoots = resolveAllTaskRoots({ dataDir, rootPath: ws.rootPath, workspaceId: ws.id }, settings.folderPaths);
                const match = allRoots.find(r => path.resolve(r.absolutePath) === path.resolve(clientFolderPath));
                if (!match) {
                    return sendError(res, 403, 'Access denied: folderPath is not a configured task root');
                }
                tasksFolder = match.absolutePath;
            } else {
                tasksFolder = resolveTaskRoot({ dataDir, rootPath: ws.rootPath, workspaceId: ws.id }).absolutePath;
            }
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
                    let destPath = await resolveCollision(path.join(archiveFolder, relFromTasks));

                    await fs.promises.mkdir(path.dirname(destPath), { recursive: true });
                    await fs.promises.rename(resolvedPath, destPath);
                    const newRelPath = path.relative(tasksFolder, destPath);

                    // Determine if this is a file or folder
                    let itemType: 'file' | 'folder';
                    try {
                        const s = await fs.promises.stat(destPath);
                        itemType = s.isDirectory() ? 'folder' : 'file';
                    } catch {
                        itemType = 'file';
                    }

                    // Write undo record (overwrite any existing)
                    const undoRecord = {
                        timestamp: new Date().toISOString(),
                        type: itemType,
                        tasksFolder,
                        originalPath: relFromTasks.replace(/\\/g, '/'),
                        archivedPath: newRelPath.replace(/\\/g, '/'),
                    };
                    const undoFile = path.join(tasksFolder, ARCHIVE_UNDO_FILE);
                    await fs.promises.writeFile(undoFile, JSON.stringify(undoRecord, null, 2), 'utf-8');

                    taskCache.invalidateWorkspace(ws.id);
                    sendJSON(res, 200, { path: newRelPath });
                } else {
                    // Unarchive: move from archive/ back to tasks root
                    const relFromArchive = path.relative(archiveFolder, resolvedPath);
                    if (relFromArchive.startsWith('..')) {
                        return sendError(res, 400, 'Path is not inside the archive folder');
                    }
                    let destPath = await resolveCollision(path.join(tasksFolder, relFromArchive));

                    await fs.promises.mkdir(path.dirname(destPath), { recursive: true });
                    await fs.promises.rename(resolvedPath, destPath);
                    const newRelPath = path.relative(tasksFolder, destPath);

                    // Clear undo record on manual unarchive
                    const undoFile = path.join(tasksFolder, ARCHIVE_UNDO_FILE);
                    try { await fs.promises.unlink(undoFile); } catch { /* ignore if absent */ }

                    taskCache.invalidateWorkspace(ws.id);
                    sendJSON(res, 200, { path: newRelPath });
                }
            } catch (err: any) {
                return sendError(res, 500, 'Failed to ' + action + ': ' + getErrorMessage(err));
            }
        },
    });

    // ------------------------------------------------------------------
    // GET /api/workspaces/:id/tasks/undo-archive — Undo status
    // ------------------------------------------------------------------
    routes.push({
        method: 'GET',
        pattern: /^\/api\/workspaces\/([^/]+)\/tasks\/undo-archive$/,
        handler: async (req, res, match) => {
            const ws = await resolveWorkspaceOrFail(store, match!, res);
            if (!ws) return;

            // Scan all task roots for the undo file
            const settings = await readTasksSettings(dataDir, ws.id);
            const allRoots = resolveAllTaskRoots({ dataDir, rootPath: ws.rootPath, workspaceId: ws.id }, settings.folderPaths);
            for (const root of allRoots) {
                const undoFile = path.join(root.absolutePath, ARCHIVE_UNDO_FILE);
                try {
                    const raw = await fs.promises.readFile(undoFile, 'utf-8');
                    const record = JSON.parse(raw);
                    sendJSON(res, 200, { available: true, record: { type: record.type, originalPath: record.originalPath, timestamp: record.timestamp } });
                    return;
                } catch { /* continue to next root */ }
            }
            sendJSON(res, 200, { available: false });
        },
    });

    // ------------------------------------------------------------------
    // POST /api/workspaces/:id/tasks/undo-archive — Perform undo
    // ------------------------------------------------------------------
    routes.push({
        method: 'POST',
        pattern: /^\/api\/workspaces\/([^/]+)\/tasks\/undo-archive$/,
        handler: async (req, res, match) => {
            const ws = await resolveWorkspaceOrFail(store, match!, res);
            if (!ws) return;

            // Scan all task roots for the undo file
            const settings = await readTasksSettings(dataDir, ws.id);
            const allRoots = resolveAllTaskRoots({ dataDir, rootPath: ws.rootPath, workspaceId: ws.id }, settings.folderPaths);

            let tasksFolder: string | undefined;
            let undoFile: string | undefined;
            let record: { originalPath: string; archivedPath: string; tasksFolder?: string } | undefined;
            for (const root of allRoots) {
                const candidate = path.join(root.absolutePath, ARCHIVE_UNDO_FILE);
                try {
                    const raw = await fs.promises.readFile(candidate, 'utf-8');
                    record = JSON.parse(raw);
                    undoFile = candidate;
                    // Use tasksFolder from the record if available, otherwise the root where the file was found
                    tasksFolder = (record!.tasksFolder && typeof record!.tasksFolder === 'string')
                        ? record!.tasksFolder
                        : root.absolutePath;
                    break;
                } catch { /* continue to next root */ }
            }

            if (!record || !undoFile || !tasksFolder) {
                return sendError(res, 404, 'Nothing to undo');
            }

            if (!record.originalPath || !record.archivedPath) {
                return sendError(res, 400, 'Invalid undo record');
            }

            const archivedAbsPath = path.join(tasksFolder, record.archivedPath);
            const originalAbsPath = path.join(tasksFolder, record.originalPath);

            // Validate paths are inside tasksFolder
            if (!resolveAndValidatePath(tasksFolder, record.archivedPath) || !resolveAndValidatePath(tasksFolder, record.originalPath)) {
                return sendError(res, 403, 'Access denied: undo record contains paths outside tasks folder');
            }

            // Ensure source still exists
            try {
                await fs.promises.stat(archivedAbsPath);
            } catch {
                return sendError(res, 404, 'Archived path no longer exists');
            }

            // Check for collision at original path
            try {
                await fs.promises.stat(originalAbsPath);
                return sendError(res, 409, 'Original path already exists — cannot undo');
            } catch (err: any) {
                if (err.code !== 'ENOENT') {
                    return sendError(res, 500, 'Failed to check original path');
                }
            }

            try {
                await fs.promises.mkdir(path.dirname(originalAbsPath), { recursive: true });
                await fs.promises.rename(archivedAbsPath, originalAbsPath);
                await fs.promises.unlink(undoFile);
                taskCache.invalidateWorkspace(ws.id);
                sendJSON(res, 200, { success: true, restoredPath: record.originalPath });
            } catch (err: any) {
                return sendError(res, 500, 'Failed to undo archive: ' + (err.message || 'Unknown error'));
            }
        },
    });
}
