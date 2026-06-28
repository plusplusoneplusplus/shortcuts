/**
 * Tasks REST API Handler — read-only routes.
 *
 * HTTP API routes for exposing the Tasks Viewer folder hierarchy,
 * file content, and settings for a given workspace.
 *
 * Pure Node.js; uses only built-in modules.
 * Cross-platform compatible (Linux/Mac/Windows).
 */

import * as url from 'url';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import type { ProcessStore, TaskFolder } from '@plusplusoneplusplus/forge';
import { isWithinDirectory } from '@plusplusoneplusplus/forge';
import { sendJSON, sendError } from '../core/api-handler';
import { resolveWorkspaceOrFail } from '../shared/handler-utils';
import type { Route } from '../types';
import { resolveTaskRoot } from './task-root-resolver';
import { isWithinTrustedReadOnlyDir, DEFAULT_SETTINGS, readTasksSettings, writeTasksSettings } from './tasks-handler-utils';
import { taskCache } from './task-cache';
import { getRepoDataPath } from '../paths';

const HTML_EMBED_MAX_BYTES = 4 * 1024 * 1024;
const HTML_EMBED_TYPES = new Set(['.html', '.htm']);

function htmlEmbedContentSecurityPolicy(): string {
    return [
        'sandbox allow-scripts',
        "default-src 'self' 'unsafe-inline' 'unsafe-eval' data: blob: https:",
        'img-src * data: blob:',
        "style-src * 'unsafe-inline'",
        "script-src * 'unsafe-inline' 'unsafe-eval'",
    ].join('; ');
}

async function realpathIfExists(p: string): Promise<string | null> {
    try {
        return await fs.promises.realpath(p);
    } catch (err: any) {
        if (err?.code === 'ENOENT') return null;
        throw err;
    }
}

function stripFileScheme(input: string): { path?: string; status?: number; message?: string } {
    if (!input.toLowerCase().startsWith('file://')) {
        return { path: input };
    }

    try {
        return { path: url.fileURLToPath(input) };
    } catch {
        return { status: 400, message: 'Invalid path' };
    }
}

async function resolveAllowedHtmlPath(filePath: string, ws: { id: string; rootPath: string }, dataDir: string): Promise<{ path?: string; status?: number; message?: string }> {
    const parsedPath = stripFileScheme(filePath);
    if (!parsedPath.path) {
        return { status: parsedPath.status, message: parsedPath.message };
    }

    const requestedPath = parsedPath.path.split(/[?#]/, 1)[0];
    if (!HTML_EMBED_TYPES.has(path.extname(requestedPath).toLowerCase())) {
        return { status: 415, message: 'Unsupported HTML type' };
    }

    const wsRoot = path.resolve(ws.rootPath);
    const outputsRoot = getRepoDataPath(dataDir, ws.id, 'outputs');
    const candidate = path.isAbsolute(requestedPath)
        ? path.resolve(requestedPath)
        : path.resolve(wsRoot, requestedPath);

    if (!path.isAbsolute(requestedPath) && !isWithinDirectory(candidate, wsRoot)) {
        return { status: 403, message: 'Access denied: path is outside workspace' };
    }

    const realCandidate = await realpathIfExists(candidate);
    if (!realCandidate) {
        return { status: 404, message: 'HTML file not found' };
    }
    if (!HTML_EMBED_TYPES.has(path.extname(realCandidate).toLowerCase())) {
        return { status: 415, message: 'Unsupported HTML type' };
    }

    const realWsRoot = await fs.promises.realpath(wsRoot);
    if (isWithinDirectory(realCandidate, realWsRoot)) {
        return { path: realCandidate };
    }

    const realOutputsRoot = await realpathIfExists(outputsRoot);
    if (realOutputsRoot && isWithinDirectory(realCandidate, realOutputsRoot)) {
        return { path: realCandidate };
    }

    const realTmpRoot = await fs.promises.realpath(os.tmpdir());
    if (isWithinDirectory(realCandidate, realTmpRoot)) {
        return { path: realCandidate };
    }

    const copilotCliRoot = path.join(os.homedir(), '.copilot');
    const realCopilotCliRoot = await realpathIfExists(copilotCliRoot);
    if (realCopilotCliRoot && isWithinDirectory(realCandidate, realCopilotCliRoot)) {
        return { path: realCandidate };
    }

    return { status: 403, message: 'Access denied: path is outside allowed HTML roots' };
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

            // Resolve and validate path is within workspace, a trusted read-only directory, or the task root.
            // Relative paths resolve against the workspace root (mirrors resolveAllowedHtmlPath), not process.cwd().
            const wsRoot = path.resolve(ws.rootPath);
            const resolvedPath = path.isAbsolute(filePath)
                ? path.resolve(filePath)
                : path.resolve(wsRoot, filePath);
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
                const ext = path.extname(resolvedPath).toLowerCase();

                // Image file preview — return base64-encoded content
                const IMAGE_PREVIEW_TYPES: Record<string, string> = {
                    '.svg': 'image/svg+xml',
                    '.png': 'image/png',
                    '.jpg': 'image/jpeg',
                    '.jpeg': 'image/jpeg',
                    '.gif': 'image/gif',
                    '.webp': 'image/webp',
                    '.bmp': 'image/bmp',
                    '.ico': 'image/x-icon',
                };
                const imageMime = IMAGE_PREVIEW_TYPES[ext];
                if (imageMime) {
                    if (!stat.isFile()) {
                        return sendError(res, 404, 'Not a file');
                    }
                    const MAX_IMAGE_SIZE = 2 * 1024 * 1024;
                    if (stat.size > MAX_IMAGE_SIZE) {
                        return sendJSON(res, 200, {
                            type: 'image-too-large' as const,
                            fileName: path.basename(resolvedPath),
                            size: stat.size,
                        });
                    }
                    const buffer = await fs.promises.readFile(resolvedPath);
                    return sendJSON(res, 200, {
                        type: 'image' as const,
                        path: resolvedPath,
                        fileName: path.basename(resolvedPath),
                        mimeType: imageMime,
                        content: buffer.toString('base64'),
                        size: stat.size,
                    });
                }

                // Binary file rejection by extension (non-image binaries)
                const BINARY_EXTS = new Set([
                    '.mp3', '.mp4', '.avi', '.mov', '.mkv', '.wav', '.flac',
                    '.zip', '.tar', '.gz', '.bz2', '.7z', '.rar',
                    '.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx',
                    '.exe', '.dll', '.so', '.dylib', '.bin', '.o', '.a',
                    '.woff', '.woff2', '.ttf', '.eot', '.otf',
                ]);
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
                // File size cap: 4MB
                if (stat.size > 4 * 1024 * 1024) {
                    return sendError(res, 400, 'File too large (max 4MB)');
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
                    mtime: stat.mtimeMs,
                    // Include full text content when caller requested all lines
                    // (lines=0). Enables the NoteEditor IO adapter to reconstruct
                    // exact content (including trailing newline / blank lines) and
                    // to use mtime for optimistic-concurrency saves.
                    ...(maxLines === 0 ? { content } : {}),
                });
            } catch (err: any) {
                if (err.code === 'ENOENT') {
                    return sendError(res, 404, 'File not found');
                }
                return sendError(res, 500, 'Failed to read file: ' + (err.message || 'Unknown error'));
            }
        },
    });

    // GET /api/workspaces/:id/files/html — Serve opted-in local HTML previews in sandboxed iframes.
    routes.push({
        method: 'GET',
        pattern: /^\/api\/workspaces\/([^/]+)\/files\/html$/,
        handler: async (req, res, match) => {
            const ws = await resolveWorkspaceOrFail(store, match!, res);
            if (!ws) return;

            const parsed = url.parse(req.url || '/', true);
            const filePath = typeof parsed.query.path === 'string' ? parsed.query.path : '';
            if (!filePath) return sendError(res, 400, 'Missing required query parameter: path');

            try {
                const resolved = await resolveAllowedHtmlPath(filePath, ws, dataDir);
                if (!resolved.path) {
                    return sendError(res, resolved.status ?? 403, resolved.message ?? 'Access denied');
                }

                const stat = await fs.promises.stat(resolved.path);
                if (!stat.isFile()) return sendError(res, 404, 'Not a file');
                if (stat.size > HTML_EMBED_MAX_BYTES) {
                    return sendError(res, 413, 'HTML file too large (max 4MB)');
                }

                const data = await fs.promises.readFile(resolved.path);
                res.writeHead(200, {
                    'Content-Type': 'text/html; charset=utf-8',
                    'Content-Length': data.length,
                    'Content-Security-Policy': htmlEmbedContentSecurityPolicy(),
                    'Cache-Control': 'private, max-age=60',
                    'X-Content-Type-Options': 'nosniff',
                    'Referrer-Policy': 'no-referrer',
                });
                res.end(data);
            } catch (err: any) {
                if (err.code === 'ENOENT') return sendError(res, 404, 'HTML file not found');
                return sendError(res, 500, 'Failed to read HTML file: ' + (err.message || 'Unknown error'));
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
                if (stat.size > 4 * 1024 * 1024) {
                    return sendError(res, 400, 'File too large (max 4MB)');
                }
                const content = await fs.promises.readFile(resolvedPath, 'utf-8');
                sendJSON(res, 200, { content, path: filePath, mtime: stat.mtimeMs });
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
                    taskCache.invalidateWorkspace(ws.id);

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

}
