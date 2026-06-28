/**
 * Notes REST API Handler — write/mutation routes.
 *
 * HTTP API routes for notes write operations (create, autosave, rename, delete)
 * for a given workspace.
 *
 * Pure Node.js; uses only built-in modules.
 * Cross-platform compatible (Linux/Mac/Windows).
 */

import * as url from 'url';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import type { ProcessStore } from '@plusplusoneplusplus/forge';
import { isWithinDirectory, SqliteProcessStore } from '@plusplusoneplusplus/forge';
import { sendJSON, sendError } from '../core/api-handler';
import { resolveWorkspaceOrFail, parseBodyOrReject } from '../shared/handler-utils';
import type { Route } from '../types';
import { writeOrderFile, removeFromOrder, updateOrderOnRename } from './notes-order';
import { SYSTEM_FOLDER_NAMES } from './notes-constants';
import { NoteChatBindingStore } from './note-chat-binding-store';
import { resolveNotesRoot, isRootResolveError } from './notes-root-resolver';
import { readRepoPreferences } from '../preferences-handler';

// ============================================================================
// Helpers
// ============================================================================

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

function isSystemFolder(notesRoot: string, resolvedPath: string): boolean {
    return SYSTEM_FOLDER_NAMES.some(name => resolvedPath === path.join(notesRoot, name));
}

function getFsErrorCode(err: unknown): string | undefined {
    if (typeof err !== 'object' || err === null || !('code' in err)) {
        return undefined;
    }
    const code = (err as { code?: unknown }).code;
    return typeof code === 'string' ? code : undefined;
}

function isMissingPathError(err: unknown): boolean {
    const code = getFsErrorCode(err);
    return code === 'ENOENT' || code === 'ENOTDIR';
}

async function pathExists(filePath: string): Promise<boolean> {
    try {
        await fs.promises.access(filePath);
        return true;
    } catch (err) {
        if (isMissingPathError(err)) {
            return false;
        }
        throw err;
    }
}

function ensureMarkdownExtension(notePath: string): string {
    return notePath.endsWith('.md') ? notePath : `${notePath}.md`;
}

function normalizePathForComparison(filePath: string): string {
    return path.normalize(filePath);
}

async function pathsReferToSameExistingEntry(left: string, right: string): Promise<boolean> {
    const [leftRealPath, rightRealPath] = await Promise.all([
        fs.promises.realpath(left),
        fs.promises.realpath(right),
    ]);
    if (normalizePathForComparison(leftRealPath) === normalizePathForComparison(rightRealPath)) {
        return true;
    }
    if (normalizePathForComparison(left).toLowerCase() !== normalizePathForComparison(right).toLowerCase()) {
        return false;
    }
    const [leftStat, rightStat] = await Promise.all([
        fs.promises.stat(left),
        fs.promises.stat(right),
    ]);
    return leftStat.dev === rightStat.dev && leftStat.ino === rightStat.ino;
}

// ============================================================================
// Write Route Registration
// ============================================================================

/**
 * Register notes write (mutation) API routes on the given route table.
 * Mutates the `routes` array in-place.
 */
export function registerNotesWriteRoutes(
    routes: Route[],
    store: ProcessStore,
    dataDir: string,
): void {
    // Resolve the per-note chat binding store once. Bindings live in the
    // shared `processes.db`, so the SQLite-backed process store exposes the
    // database handle we need. With other backends (or in tests without a
    // SQLite store) we leave the cascade disabled — rename/delete still
    // succeed for the filesystem operation; only the binding row is not
    // touched.
    let bindingStore: NoteChatBindingStore | null = null;
    if (store instanceof SqliteProcessStore) {
        try {
            bindingStore = new NoteChatBindingStore(store.getDatabase());
        } catch {
            bindingStore = null;
        }
    }

    /** Forward-slash normalize a relative-to-notes path. */
    function relNotePath(notesRoot: string, abs: string): string {
        return path.relative(notesRoot, abs).split(path.sep).join('/');
    }

    // ------------------------------------------------------------------
    // POST /api/workspaces/:id/notes/page — Create page/section/notebook
    // ------------------------------------------------------------------
    routes.push({
        method: 'POST',
        pattern: /^\/api\/workspaces\/([^/]+)\/notes\/page$/,
        handler: async (req, res, match) => {
            const ws = await resolveWorkspaceOrFail(store, match!, res);
            if (!ws) return;

            const body = await parseBodyOrReject(req, res);
            if (body === null) return;

            const { path: notePath, type, root: rootParam } = body || {};
            if (!notePath || typeof notePath !== 'string') {
                return sendError(res, 400, 'Missing required field: path');
            }
            if (!type || !['notebook', 'section', 'page'].includes(type)) {
                return sendError(res, 400, 'Missing or invalid field: type (must be notebook, section, or page)');
            }

            const prefs = readRepoPreferences(dataDir, ws.id);
            const rootResult = resolveNotesRoot(dataDir, ws.id, ws.rootPath, rootParam, prefs.additionalNotesRoots);
            if (isRootResolveError(rootResult)) {
                return sendError(res, rootResult.statusCode, rootResult.error);
            }

            const notesRoot = rootResult.absolutePath;
            await fs.promises.mkdir(notesRoot, { recursive: true });

            const resolved = path.resolve(notesRoot, notePath);
            if (!isWithinDirectory(resolved, notesRoot)) {
                return sendError(res, 403, 'Access denied: path is outside notes directory');
            }

            try {
                if (type === 'notebook' || type === 'section') {
                    await fs.promises.mkdir(resolved, { recursive: true });
                    sendJSON(res, 201, { path: notePath, type });
                } else {
                    // page — auto-append .md if missing, then create parent dir and empty file
                    const effectivePath = ensureMarkdownExtension(notePath);
                    const resolvedPage = path.resolve(notesRoot, effectivePath);
                    if (!isWithinDirectory(resolvedPage, notesRoot)) {
                        return sendError(res, 403, 'Access denied: path is outside notes directory');
                    }
                    await fs.promises.mkdir(path.dirname(resolvedPage), { recursive: true });
                    await fs.promises.writeFile(resolvedPage, '', 'utf-8');
                    sendJSON(res, 201, { path: effectivePath, type });
                }
            } catch (err: any) {
                return sendError(res, 500, 'Failed to create: ' + (err.message || 'Unknown error'));
            }
        },
    });

    // ------------------------------------------------------------------
    // PUT /api/workspaces/:id/notes/content — Autosave
    // ------------------------------------------------------------------
    routes.push({
        method: 'PUT',
        pattern: /^\/api\/workspaces\/([^/]+)\/notes\/content$/,
        handler: async (req, res, match) => {
            const ws = await resolveWorkspaceOrFail(store, match!, res);
            if (!ws) return;

            const body = await parseBodyOrReject(req, res);
            if (body === null) return;

            const { path: notePath, content, expectedMtime, root: rootParam } = body || {};
            if (!notePath || typeof notePath !== 'string') {
                return sendError(res, 400, 'Missing required field: path');
            }
            if (typeof content !== 'string') {
                return sendError(res, 400, 'Missing required field: content');
            }

            const prefs = readRepoPreferences(dataDir, ws.id);
            const rootResult = resolveNotesRoot(dataDir, ws.id, ws.rootPath, rootParam, prefs.additionalNotesRoots);
            if (isRootResolveError(rootResult)) {
                return sendError(res, rootResult.statusCode, rootResult.error);
            }

            const notesRoot = rootResult.absolutePath;
            const wsDataDir = getWorkspaceDataDir(dataDir, ws.id);

            // Absolute paths are used as-is (scratchpad / session-state files) — only for default root.
            // Relative paths are resolved against the active notesRoot.
            const resolved = (path.isAbsolute(notePath) && rootResult.isDefault)
                ? path.resolve(notePath)
                : path.resolve(notesRoot, notePath);

            // For non-default roots, allow paths within the resolved root directory
            const allowed = rootResult.isDefault
                ? isAllowedPath(resolved, wsDataDir, ws.rootPath)
                : isWithinDirectory(resolved, notesRoot);
            if (!allowed) {
                return sendError(res, 403, 'Access denied: path is outside workspace data directory');
            }

            // Optimistic locking: if expectedMtime is provided, verify the file
            // hasn't been modified since the client last read it.
            if (typeof expectedMtime === 'number') {
                try {
                    const stat = await fs.promises.stat(resolved);
                    if (Math.round(stat.mtimeMs) !== Math.round(expectedMtime)) {
                        const currentContent = await fs.promises.readFile(resolved, 'utf-8');
                        return sendJSON(res, 409, {
                            error: 'conflict',
                            reason: 'mtime_mismatch',
                            currentMtime: stat.mtimeMs,
                            currentContent,
                        });
                    }
                } catch (err: any) {
                    if (err.code !== 'ENOENT') throw err;
                    // New file — no conflict possible
                }
            }

            try {
                // Atomic write: write to temp file then rename
                const tmpPath = resolved + '.tmp';
                await fs.promises.mkdir(path.dirname(resolved), { recursive: true });
                await fs.promises.writeFile(tmpPath, content, 'utf-8');
                await fs.promises.rename(tmpPath, resolved);
                const writtenStat = await fs.promises.stat(resolved);
                sendJSON(res, 200, { path: notePath, updated: true, mtime: writtenStat.mtimeMs });
            } catch (err: any) {
                return sendError(res, 500, 'Failed to write file: ' + (err.message || 'Unknown error'));
            }
        },
    });

    // ------------------------------------------------------------------
    // PATCH /api/workspaces/:id/notes/path — Rename
    // ------------------------------------------------------------------
    routes.push({
        method: 'PATCH',
        pattern: /^\/api\/workspaces\/([^/]+)\/notes\/path$/,
        handler: async (req, res, match) => {
            const ws = await resolveWorkspaceOrFail(store, match!, res);
            if (!ws) return;

            const body = await parseBodyOrReject(req, res);
            if (body === null) return;

            const { oldPath, newPath, root: rootParam } = body || {};
            if (!oldPath || typeof oldPath !== 'string') {
                return sendError(res, 400, 'Missing required field: oldPath');
            }
            if (!newPath || typeof newPath !== 'string') {
                return sendError(res, 400, 'Missing required field: newPath');
            }

            const prefs = readRepoPreferences(dataDir, ws.id);
            const rootResult = resolveNotesRoot(dataDir, ws.id, ws.rootPath, rootParam, prefs.additionalNotesRoots);
            if (isRootResolveError(rootResult)) {
                return sendError(res, rootResult.statusCode, rootResult.error);
            }

            const notesRoot = rootResult.absolutePath;
            const resolvedOld = path.resolve(notesRoot, oldPath);

            if (!isWithinDirectory(resolvedOld, notesRoot)) {
                return sendError(res, 403, 'Access denied: path is outside notes directory');
            }

            // System folder protection only applies to the default managed root
            if (rootResult.isDefault && isSystemFolder(notesRoot, resolvedOld)) {
                return sendError(res, 403, 'Cannot rename a system folder');
            }

            // Check source exists
            let oldStat: fs.Stats;
            try {
                oldStat = await fs.promises.stat(resolvedOld);
            } catch {
                return sendError(res, 404, 'Source path not found');
            }

            const effectiveNewPath = oldStat.isFile() ? ensureMarkdownExtension(newPath) : newPath;
            const resolvedNew = path.resolve(notesRoot, effectiveNewPath);
            if (!isWithinDirectory(resolvedNew, notesRoot)) {
                return sendError(res, 403, 'Access denied: path is outside notes directory');
            }

            if (resolvedOld === resolvedNew) {
                return sendError(res, 409, 'Destination path already exists');
            }

            // Check collision. On case-insensitive filesystems, a case-only rename
            // makes the destination path appear to exist because it resolves to the
            // source entry. Permit that alias but keep rejecting separate entries.
            let destinationExists: boolean;
            try {
                destinationExists = await pathExists(resolvedNew);
                if (destinationExists && !(await pathsReferToSameExistingEntry(resolvedOld, resolvedNew))) {
                    return sendError(res, 409, 'Destination path already exists');
                }
            } catch (err: any) {
                return sendError(res, 500, 'Failed to check destination path: ' + (err.message || 'Unknown error'));
            }

            try {
                await fs.promises.mkdir(path.dirname(resolvedNew), { recursive: true });
                await fs.promises.rename(resolvedOld, resolvedNew);

                // Cascade: rename sidecar comments file when it exists
                const oldSidecar = resolvedOld + '.comments.json';
                const newSidecar = resolvedNew + '.comments.json';
                try {
                    await fs.promises.rename(oldSidecar, newSidecar);
                } catch (err: any) {
                    if (err.code !== 'ENOENT') throw err;
                }

                // Update .order.json in the parent directory when it's a same-parent rename
                const oldParentDir = path.dirname(resolvedOld);
                const newParentDir = path.dirname(resolvedNew);
                if (oldParentDir === newParentDir) {
                    const oldName = path.basename(resolvedOld);
                    const newName = path.basename(resolvedNew);
                    await updateOrderOnRename(oldParentDir, oldName, newName);
                } else {
                    // Cross-parent move: remove from old parent, the new parent order is untouched
                    await removeFromOrder(oldParentDir, path.basename(resolvedOld));
                }

                // Cascade: move per-note chat binding rows. Determine file vs
                // directory by inspecting the renamed entry.
                let bindingsMoved = 0;
                if (bindingStore) {
                    const oldRel = relNotePath(notesRoot, resolvedOld);
                    const newRel = relNotePath(notesRoot, resolvedNew);
                    try {
                        const renamedStat = await fs.promises.stat(resolvedNew);
                        if (renamedStat.isDirectory()) {
                            bindingsMoved = bindingStore.renamePrefix(ws.id, oldRel, newRel);
                        } else {
                            bindingsMoved = bindingStore.renamePath(ws.id, oldRel, newRel);
                        }
                    } catch {
                        // Renamed entry no longer reachable (race?). Skip cascade.
                    }
                }

                sendJSON(res, 200, { oldPath, newPath: effectiveNewPath, bindingsMoved });
            } catch (err: any) {
                return sendError(res, 500, 'Failed to rename: ' + (err.message || 'Unknown error'));
            }
        },
    });

    // ------------------------------------------------------------------
    // DELETE /api/workspaces/:id/notes/path?path=... — Delete
    // ------------------------------------------------------------------
    routes.push({
        method: 'DELETE',
        pattern: /^\/api\/workspaces\/([^/]+)\/notes\/path$/,
        handler: async (req, res, match) => {
            const ws = await resolveWorkspaceOrFail(store, match!, res);
            if (!ws) return;

            const parsed = url.parse(req.url || '/', true);
            const notePath = typeof parsed.query.path === 'string' ? parsed.query.path : '';
            if (!notePath) {
                return sendError(res, 400, 'Missing required query parameter: path');
            }

            const rootParam = typeof parsed.query.root === 'string' ? parsed.query.root : undefined;
            const prefs = readRepoPreferences(dataDir, ws.id);
            const rootResult = resolveNotesRoot(dataDir, ws.id, ws.rootPath, rootParam, prefs.additionalNotesRoots);
            if (isRootResolveError(rootResult)) {
                return sendError(res, rootResult.statusCode, rootResult.error);
            }

            const notesRoot = rootResult.absolutePath;
            const resolved = path.resolve(notesRoot, notePath);

            if (!isWithinDirectory(resolved, notesRoot)) {
                return sendError(res, 403, 'Access denied: path is outside notes directory');
            }

            // System folder protection only applies to the default managed root
            if (rootResult.isDefault && isSystemFolder(notesRoot, resolved)) {
                return sendError(res, 403, 'Cannot delete a system folder');
            }

            let stat: fs.Stats;
            try {
                stat = await fs.promises.stat(resolved);
            } catch {
                return sendError(res, 404, 'Path not found');
            }

            try {
                if (stat.isDirectory()) {
                    await fs.promises.rm(resolved, { recursive: true });
                } else {
                    await fs.promises.unlink(resolved);
                    // Cascade: remove sidecar comments file when it exists
                    const sidecarPath = resolved + '.comments.json';
                    try {
                        await fs.promises.unlink(sidecarPath);
                    } catch (err: any) {
                        if (err.code !== 'ENOENT') throw err;
                    }
                }
                // Remove the deleted entry from its parent's .order.json
                await removeFromOrder(path.dirname(resolved), path.basename(resolved));

                // Cascade: drop per-note chat binding rows for the deleted
                // entry. Chats themselves remain in the global Chat list.
                if (bindingStore) {
                    const rel = relNotePath(notesRoot, resolved);
                    if (stat.isDirectory()) {
                        bindingStore.deletePrefix(ws.id, rel);
                    } else {
                        bindingStore.unbind(ws.id, rel);
                    }
                }
                res.writeHead(204);
                res.end();
            } catch (err: any) {
                return sendError(res, 500, 'Failed to delete: ' + (err.message || 'Unknown error'));
            }
        },
    });

    // ------------------------------------------------------------------
    // PUT /api/workspaces/:id/notes/order — Persist custom sibling order
    // Body: { parentPath: string, order: string[] }
    // ------------------------------------------------------------------
    routes.push({
        method: 'PUT',
        pattern: /^\/api\/workspaces\/([^/]+)\/notes\/order$/,
        handler: async (req, res, match) => {
            const ws = await resolveWorkspaceOrFail(store, match!, res);
            if (!ws) return;

            const body = await parseBodyOrReject(req, res);
            if (body === null) return;

            const { parentPath, order, root: rootParam } = body || {};

            // parentPath can be '' (root) or a relative path
            if (typeof parentPath !== 'string') {
                return sendError(res, 400, 'Missing required field: parentPath');
            }
            if (!Array.isArray(order) || !order.every(n => typeof n === 'string')) {
                return sendError(res, 400, 'Missing or invalid field: order (must be string[])');
            }

            const prefs = readRepoPreferences(dataDir, ws.id);
            const rootResult = resolveNotesRoot(dataDir, ws.id, ws.rootPath, rootParam, prefs.additionalNotesRoots);
            if (isRootResolveError(rootResult)) {
                return sendError(res, rootResult.statusCode, rootResult.error);
            }

            const notesRoot = rootResult.absolutePath;
            const targetDir = parentPath
                ? path.resolve(notesRoot, parentPath)
                : notesRoot;

            if (!isWithinDirectory(targetDir, notesRoot) && targetDir !== notesRoot) {
                return sendError(res, 403, 'Access denied: parentPath is outside notes directory');
            }

            // Verify the target directory exists
            try {
                const stat = await fs.promises.stat(targetDir);
                if (!stat.isDirectory()) {
                    return sendError(res, 400, 'parentPath must be a directory');
                }
            } catch {
                return sendError(res, 404, 'parentPath directory not found');
            }

            try {
                await writeOrderFile(targetDir, order);
                sendJSON(res, 200, { parentPath, order });
            } catch (err: any) {
                return sendError(res, 500, 'Failed to write order: ' + (err.message || 'Unknown error'));
            }
        },
    });
}
