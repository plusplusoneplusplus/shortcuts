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
import * as os from 'os';
import type { ProcessStore } from '@plusplusoneplusplus/pipeline-core';
import { TaskManager, scanDocumentsRecursively, scanFoldersRecursively, groupTaskDocuments, isWithinDirectory } from '@plusplusoneplusplus/pipeline-core';
import type { TasksViewerSettings, TaskFolder } from '@plusplusoneplusplus/pipeline-core';
import { sendJSON, sendError, parseBody } from '@plusplusoneplusplus/coc-server';
import type { Route } from '@plusplusoneplusplus/coc-server';
import { resolveTaskRoot } from './task-root-resolver';

/**
 * Directories outside the workspace that are trusted for **read-only** access.
 * Writes to these directories are always denied.
 */
const TRUSTED_READ_ONLY_DIRS: string[] = [
    path.join(os.homedir(), '.copilot'),
];

/** Return true when `target` is inside any of the trusted read-only directories or the server data directory. */
function isWithinTrustedReadOnlyDir(target: string, dataDir?: string): boolean {
    if (TRUSTED_READ_ONLY_DIRS.some(dir => isWithinDirectory(target, dir))) {
        return true;
    }
    if (dataDir && isWithinDirectory(target, dataDir)) {
        return true;
    }
    return false;
}

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
export function registerTaskRoutes(routes: Route[], store: ProcessStore, dataDir: string): void {

    // ------------------------------------------------------------------
    // GET /api/workspaces/:id/files/preview — File content preview
    // Returns first N lines (or full content) of a file within the workspace.
    // ------------------------------------------------------------------
    routes.push({
        method: 'GET',
        pattern: /^\/api\/workspaces\/([^/]+)\/files\/preview$/,
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
                : undefined;
            const tasksFolder = folderParam
                ? path.resolve(ws.rootPath, folderParam)
                : resolveTaskRoot({ dataDir, rootPath: ws.rootPath, workspaceId: ws.id }).absolutePath;
            const resolvedPath = path.resolve(tasksFolder, filePath);
            const taskRoot = resolveTaskRoot({ dataDir, rootPath: ws.rootPath, workspaceId: ws.id });
            if (!isWithinDirectory(resolvedPath, tasksFolder) && !isWithinTrustedReadOnlyDir(resolvedPath) && !isWithinDirectory(resolvedPath, taskRoot.absolutePath)) {
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

            const taskRoot = resolveTaskRoot({ dataDir, rootPath: ws.rootPath, workspaceId: ws.id });
            sendJSON(res, 200, {
                ...DEFAULT_SETTINGS,
                folderPath: taskRoot.absolutePath,
                taskRootPath: taskRoot.absolutePath,
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
            const id = decodeURIComponent(match![1]);
            const ws = await resolveWorkspace(store, id);
            if (!ws) {
                return sendError(res, 404, 'Workspace not found');
            }

            const parsed = url.parse(req.url || '/', true);
            const folder = (typeof parsed.query.folder === 'string' && parsed.query.folder)
                ? parsed.query.folder
                : undefined;
            const resolvedFolder = folder
                ? path.resolve(ws.rootPath, folder)
                : resolveTaskRoot({ dataDir, rootPath: ws.rootPath, workspaceId: ws.id }).absolutePath;
            const includeArchiveFolder= parsed.query.showArchived === 'true';

            const manager = new TaskManager({
                workspaceRoot: ws.rootPath,
                settings: { ...DEFAULT_SETTINGS, folderPath: resolvedFolder },
            });

            try {
                const hierarchy = await manager.getTaskFolderHierarchy();

                // When showArchived=true, include archive/ as a visible subfolder
                if (includeArchiveFolder) {
                    const tasksFolder = resolvedFolder;
                    const archiveDir = path.join(tasksFolder, 'archive');
                    try {
                        const stat = await fs.promises.stat(archiveDir);
                        if (stat.isDirectory()) {
                            const archiveNode = buildArchiveFolderNode(archiveDir);
                            hierarchy.children = hierarchy.children || [];
                            hierarchy.children.push(archiveNode);
                        }
                    } catch { /* archive folder doesn't exist — skip */ }
                }

                sendJSON(res, 200, hierarchy);
            } catch (err: any) {
                return sendError(res, 500, 'Failed to scan tasks: ' + (err.message || 'Unknown error'));
            }
        },
    });
}

// ============================================================================
// Archive Folder Helper
// ============================================================================

/**
 * Build a TaskFolder node for the archive/ subfolder so it appears
 * as a navigable folder in the SPA's Miller columns.
 * Files inside get relativePath prefixed with 'archive/'.
 */
function buildArchiveFolderNode(archiveDir: string): TaskFolder {
    const docs = scanDocumentsRecursively(archiveDir, 'archive', true);
    const { groups, singles } = groupTaskDocuments(docs);

    const archiveNode: TaskFolder = {
        name: 'archive',
        folderPath: archiveDir,
        relativePath: 'archive',
        isArchived: true,
        children: [],
        tasks: [],
        documentGroups: groups,
        singleDocuments: singles,
    };

    // Scan sub-folders inside archive
    const folderMap = new Map<string, TaskFolder>();
    folderMap.set('archive', archiveNode);
    scanFoldersRecursively(archiveDir, 'archive', true, folderMap, archiveNode);

    return archiveNode;
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
    if (isWithinDirectory(resolved, tasksFolder)) {
        return resolved;
    }
    return null;
}

/**
 * Recursively copy a file or directory from `src` to `dest`.
 * Used as a fallback for cross-device moves (EXDEV).
 */
async function copyRecursive(src: string, dest: string): Promise<void> {
    const stat = await fs.promises.stat(src);
    if (stat.isDirectory()) {
        await fs.promises.mkdir(dest, { recursive: true });
        for (const entry of await fs.promises.readdir(src)) {
            await copyRecursive(path.join(src, entry), path.join(dest, entry));
        }
    } else {
        await fs.promises.copyFile(src, dest);
    }
}

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

            const tasksFolder = resolveTaskRoot({ dataDir, rootPath: ws.rootPath, workspaceId: ws.id }).absolutePath;

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
    // PATCH /api/workspaces/:id/tasks/content — Write task file content
    // ------------------------------------------------------------------
    routes.push({
        method: 'PATCH',
        pattern: /^\/api\/workspaces\/([^/]+)\/tasks\/content$/,
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

            const { path: filePath, content } = body || {};
            if (!filePath || typeof filePath !== 'string') {
                return sendError(res, 400, 'Missing required field: path');
            }
            if (typeof content !== 'string') {
                return sendError(res, 400, 'Missing required field: content');
            }

            const tasksFolder = resolveTaskRoot({ dataDir, rootPath: ws.rootPath, workspaceId: ws.id }).absolutePath;
            const resolvedPath = resolveAndValidatePath(tasksFolder, filePath);
            if (!resolvedPath) {
                return sendError(res, 403, 'Access denied: path is outside tasks folder');
            }

            // File must already exist — no creation via write-back
            try {
                const stat = await fs.promises.stat(resolvedPath);
                if (!stat.isFile()) {
                    return sendError(res, 400, 'Path is not a file');
                }
            } catch (err: any) {
                if (err.code === 'ENOENT') {
                    return sendError(res, 404, 'File not found');
                }
                return sendError(res, 500, 'Failed to access file');
            }

            try {
                await fs.promises.writeFile(resolvedPath, content, 'utf-8');
                sendJSON(res, 200, { path: filePath, updated: true });
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

            const tasksFolder = resolveTaskRoot({ dataDir, rootPath: ws.rootPath, workspaceId: ws.id }).absolutePath;
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

            const tasksFolder = resolveTaskRoot({ dataDir, rootPath: ws.rootPath, workspaceId: ws.id }).absolutePath;
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
    // POST /api/workspaces/:id/tasks/move — Move file or folder
    // ------------------------------------------------------------------
    routes.push({
        method: 'POST',
        pattern: /^\/api\/workspaces\/([^/]+)\/tasks\/move$/,
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
                const found = await resolveWorkspace(store, destinationWorkspaceId);
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

            // Handle name collision
            let finalTarget = targetPath;
            try {
                await fs.promises.access(finalTarget);
                const ext = path.extname(finalTarget);
                const base = finalTarget.slice(0, finalTarget.length - ext.length);
                finalTarget = `${base}-${Date.now()}${ext}`;
            } catch { /* no collision */ }

            try {
                await fs.promises.rename(resolvedSource, finalTarget);
                const newRelPath = path.relative(destTasksFolder, finalTarget);
                sendJSON(res, 200, { path: newRelPath, name: path.basename(finalTarget) });
            } catch (err: any) {
                // EXDEV: cross-device rename not supported — fallback to copy + delete
                if (err.code === 'EXDEV') {
                    try {
                        await copyRecursive(resolvedSource, finalTarget);
                        await fs.promises.rm(resolvedSource, { recursive: true, force: true });
                        const newRelPath = path.relative(destTasksFolder, finalTarget);
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

            const tasksFolder = resolveTaskRoot({ dataDir, rootPath: ws.rootPath, workspaceId: ws.id }).absolutePath;
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
