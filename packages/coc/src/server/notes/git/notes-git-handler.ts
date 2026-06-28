/**
 * Notes Git REST API Handler
 *
 * HTTP API routes for notes git operations (init, status, log, diff, commit)
 * for a given workspace's notes directory.
 *
 * Pure Node.js; uses only built-in modules.
 * Cross-platform compatible (Linux/Mac/Windows).
 */

import * as url from 'url';
import * as fs from 'fs';
import * as path from 'path';
import type { ProcessStore } from '@plusplusoneplusplus/forge';
import { isWithinDirectory } from '@plusplusoneplusplus/forge';
import { execGitAsync } from '@plusplusoneplusplus/forge/git';
import { sendJSON, sendError } from '../../core/api-handler';
import { resolveWorkspaceOrFail, parseBodyOrReject } from '../../shared/handler-utils';
import type { Route } from '../../types';
import { getRepoDataPath } from '../../paths';
import { NotesGitService } from './notes-git-service';
import { readRepoPreferences, writeRepoPreferences } from '../../preferences-handler';
import type { NotesGitTimerManager } from './notes-git-timer-manager';

function getNotesRoot(dataDir: string, workspaceId: string): string {
    return getRepoDataPath(dataDir, workspaceId, 'notes');
}

/**
 * Register notes git API routes on the given route table.
 * Mutates the `routes` array in-place.
 */
export function registerNotesGitRoutes(
    routes: Route[],
    store: ProcessStore,
    dataDir: string,
    timerManager?: NotesGitTimerManager,
): void {

    // ------------------------------------------------------------------
    // POST /api/workspaces/:id/notes/git/init
    // ------------------------------------------------------------------
    routes.push({
        method: 'POST',
        pattern: /^\/api\/workspaces\/([^/]+)\/notes\/git\/init$/,
        handler: async (_req, res, match) => {
            const ws = await resolveWorkspaceOrFail(store, match!, res);
            if (!ws) return;

            const notesRoot = getNotesRoot(dataDir, ws.id);
            await fs.promises.mkdir(notesRoot, { recursive: true });

            try {
                const service = new NotesGitService(notesRoot);
                await service.init();
                sendJSON(res, 200, { initialized: true });
            } catch (err: any) {
                sendError(res, 500, 'Failed to initialize notes git: ' + err.message);
            }
        },
    });

    // ------------------------------------------------------------------
    // DELETE /api/workspaces/:id/notes/git — Disable git tracking
    // Stops auto-commit (if running), clears the autocommit preference,
    // and removes the `.git` directory from the notes folder. Notes files
    // themselves are preserved.
    // ------------------------------------------------------------------
    routes.push({
        method: 'DELETE',
        pattern: /^\/api\/workspaces\/([^/]+)\/notes\/git$/,
        handler: async (_req, res, match) => {
            const ws = await resolveWorkspaceOrFail(store, match!, res);
            if (!ws) return;
            const wsId = ws.id;

            const notesRoot = getNotesRoot(dataDir, wsId);

            try {
                if (timerManager) {
                    timerManager.stopForWorkspace(wsId);
                }

                const prefs = readRepoPreferences(dataDir, wsId);
                if (prefs.notesGit?.autoCommit?.enabled) {
                    writeRepoPreferences(dataDir, wsId, {
                        ...prefs,
                        notesGit: {
                            ...prefs.notesGit,
                            enabled: prefs.notesGit?.enabled ?? false,
                            autoCommit: { enabled: false },
                        },
                    });
                }

                const service = new NotesGitService(notesRoot);
                await service.deinit();
                sendJSON(res, 200, { deinitialized: true });
            } catch (err: any) {
                sendError(res, 500, 'Failed to disable notes git: ' + err.message);
            }
        },
    });

    // ------------------------------------------------------------------
    // GET /api/workspaces/:id/notes/git/status
    // ------------------------------------------------------------------
    routes.push({
        method: 'GET',
        pattern: /^\/api\/workspaces\/([^/]+)\/notes\/git\/status$/,
        handler: async (_req, res, match) => {
            const ws = await resolveWorkspaceOrFail(store, match!, res);
            if (!ws) return;

            const notesRoot = getNotesRoot(dataDir, ws.id);

            // If directory doesn't exist, return uninitialized status
            try {
                await fs.promises.access(notesRoot);
            } catch {
                sendJSON(res, 200, {
                    initialized: false,
                    branch: '',
                    clean: true,
                    staged: [],
                    unstaged: [],
                    untracked: [],
                    totalChanges: 0,
                });
                return;
            }

            try {
                const service = new NotesGitService(notesRoot);
                const status = await service.getStatus();
                sendJSON(res, 200, status);
            } catch (err: any) {
                sendError(res, 500, 'Failed to get notes git status: ' + err.message);
            }
        },
    });

    // ------------------------------------------------------------------
    // GET /api/workspaces/:id/notes/git/log
    // ------------------------------------------------------------------
    routes.push({
        method: 'GET',
        pattern: /^\/api\/workspaces\/([^/]+)\/notes\/git\/log$/,
        handler: async (req, res, match) => {
            const ws = await resolveWorkspaceOrFail(store, match!, res);
            if (!ws) return;

            const parsed = url.parse(req.url || '/', true);
            let limit = parseInt(parsed.query.limit as string, 10);
            let offset = parseInt(parsed.query.offset as string, 10);

            if (isNaN(limit) || limit < 0) limit = 20;
            if (isNaN(offset) || offset < 0) offset = 0;
            if (limit > 100) limit = 100;

            const notesRoot = getNotesRoot(dataDir, ws.id);

            try {
                const service = new NotesGitService(notesRoot);
                const entries = await service.getLog(limit, offset);
                sendJSON(res, 200, { entries, limit, offset });
            } catch (err: any) {
                sendError(res, 500, 'Failed to get notes git log: ' + err.message);
            }
        },
    });

    // ------------------------------------------------------------------
    // GET /api/workspaces/:id/notes/git/diff/:hash
    // ------------------------------------------------------------------
    routes.push({
        method: 'GET',
        pattern: /^\/api\/workspaces\/([^/]+)\/notes\/git\/diff\/([a-f0-9]+)$/,
        handler: async (_req, res, match) => {
            const ws = await resolveWorkspaceOrFail(store, match!, res);
            if (!ws) return;

            const hash = match![2];
            if (hash.length < 4 || hash.length > 40) {
                return sendError(res, 400, 'Invalid commit hash: must be 4-40 hex characters');
            }

            const notesRoot = getNotesRoot(dataDir, ws.id);

            try {
                const service = new NotesGitService(notesRoot);
                const diff = await service.getDiff(hash);
                sendJSON(res, 200, diff);
            } catch (err: any) {
                const msg = err.message || '';
                if (msg.includes('unknown revision') || msg.includes('bad object') ||
                    msg.includes('not a valid object') || msg.includes('bad file')) {
                    return sendError(res, 404, 'Commit not found: ' + hash);
                }
                sendError(res, 500, 'Failed to get notes git diff: ' + msg);
            }
        },
    });

    // ------------------------------------------------------------------
    // GET /api/workspaces/:id/notes/git/diff
    // ------------------------------------------------------------------
    routes.push({
        method: 'GET',
        pattern: /^\/api\/workspaces\/([^/]+)\/notes\/git\/diff$/,
        handler: async (_req, res, match) => {
            const ws = await resolveWorkspaceOrFail(store, match!, res);
            if (!ws) return;

            const notesRoot = getNotesRoot(dataDir, ws.id);

            try {
                const service = new NotesGitService(notesRoot);
                const diff = await service.getDiff();
                sendJSON(res, 200, diff);
            } catch (err: any) {
                sendError(res, 500, 'Failed to get notes git diff: ' + err.message);
            }
        },
    });

    // ------------------------------------------------------------------
    // POST /api/workspaces/:id/notes/git/commit
    // ------------------------------------------------------------------
    routes.push({
        method: 'POST',
        pattern: /^\/api\/workspaces\/([^/]+)\/notes\/git\/commit$/,
        handler: async (req, res, match) => {
            const ws = await resolveWorkspaceOrFail(store, match!, res);
            if (!ws) return;

            const body = await parseBodyOrReject(req, res);
            if (body === null) return;

            const message = body.message;
            if (message !== undefined) {
                if (typeof message !== 'string' || message.trim().length === 0) {
                    return sendError(res, 400, 'Commit message must be a non-empty string');
                }
                if (message.length > 500) {
                    return sendError(res, 400, 'Commit message must be at most 500 characters');
                }
            }

            const notesRoot = getNotesRoot(dataDir, ws.id);

            try {
                const service = new NotesGitService(notesRoot);
                const result = await service.commit(message);
                sendJSON(res, 200, result);
            } catch (err: any) {
                if (err.message.includes('not initialized')) {
                    return sendError(res, 409, 'Notes git repository is not initialized');
                }
                sendError(res, 500, 'Failed to commit notes: ' + err.message);
            }
        },
    });

    // ------------------------------------------------------------------
    // GET /api/workspaces/:id/notes/git/file-log?path=<relPath>&limit=<n>
    // ------------------------------------------------------------------
    routes.push({
        method: 'GET',
        pattern: /^\/api\/workspaces\/([^/]+)\/notes\/git\/file-log$/,
        handler: async (req, res, match) => {
            const ws = await resolveWorkspaceOrFail(store, match!, res);
            if (!ws) return;

            const parsed = url.parse(req.url || '/', true);
            const relPath = parsed.query.path as string | undefined;
            if (!relPath || typeof relPath !== 'string' || !relPath.trim()) {
                return sendError(res, 400, 'Missing required query param: path');
            }

            let limit = parseInt(parsed.query.limit as string, 10);
            if (isNaN(limit) || limit < 1) limit = 50;
            if (limit > 200) limit = 200;

            const notesRoot = getNotesRoot(dataDir, ws.id);
            const resolved = path.resolve(notesRoot, relPath);
            if (!isWithinDirectory(resolved, notesRoot)) {
                return sendError(res, 403, 'Access denied: path is outside notes directory');
            }

            try {
                const service = new NotesGitService(notesRoot);
                const entries = await service.getFileLog(relPath, limit);
                sendJSON(res, 200, { entries, path: relPath, limit });
            } catch (err: any) {
                sendError(res, 500, 'Failed to get file log: ' + err.message);
            }
        },
    });

    // ------------------------------------------------------------------
    // GET /api/workspaces/:id/notes/git/file-content?hash=<hash>&path=<relPath>
    // ------------------------------------------------------------------
    routes.push({
        method: 'GET',
        pattern: /^\/api\/workspaces\/([^/]+)\/notes\/git\/file-content$/,
        handler: async (req, res, match) => {
            const ws = await resolveWorkspaceOrFail(store, match!, res);
            if (!ws) return;

            const parsed = url.parse(req.url || '/', true);
            const hash = parsed.query.hash as string | undefined;
            const relPath = parsed.query.path as string | undefined;

            if (!hash || typeof hash !== 'string' || !/^[a-f0-9]{4,40}$/.test(hash)) {
                return sendError(res, 400, 'Missing or invalid query param: hash (must be 4–40 hex chars)');
            }
            if (!relPath || typeof relPath !== 'string' || !relPath.trim()) {
                return sendError(res, 400, 'Missing required query param: path');
            }

            const notesRoot = getNotesRoot(dataDir, ws.id);
            const resolved = path.resolve(notesRoot, relPath);
            if (!isWithinDirectory(resolved, notesRoot)) {
                return sendError(res, 403, 'Access denied: path is outside notes directory');
            }

            try {
                const service = new NotesGitService(notesRoot);
                const content = await service.getFileContentAtRevision(hash, relPath);
                sendJSON(res, 200, { content, hash, path: relPath });
            } catch (err: any) {
                const msg = err.message || '';
                if (msg.includes('does not exist') || msg.includes('bad object') ||
                    msg.includes('unknown revision') || msg.includes('Path') ||
                    msg.includes('not in \'')) {
                    return sendError(res, 404, `File not found at revision ${hash}`);
                }
                sendError(res, 500, 'Failed to get file content at revision: ' + msg);
            }
        },
    });

    // ------------------------------------------------------------------
    // POST /api/workspaces/:id/notes/git/save-checkpoint
    // body: { path: string, name: string }
    // ------------------------------------------------------------------
    routes.push({
        method: 'POST',
        pattern: /^\/api\/workspaces\/([^/]+)\/notes\/git\/save-checkpoint$/,
        handler: async (req, res, match) => {
            const ws = await resolveWorkspaceOrFail(store, match!, res);
            if (!ws) return;

            const body = await parseBodyOrReject(req, res);
            if (body === null) return;

            const { path: relPath, name } = body || {};
            if (!relPath || typeof relPath !== 'string' || !relPath.trim()) {
                return sendError(res, 400, 'Missing required field: path');
            }
            if (!name || typeof name !== 'string' || !name.trim()) {
                return sendError(res, 400, 'Missing required field: name');
            }
            if (name.trim().length > 200) {
                return sendError(res, 400, 'Checkpoint name must be at most 200 characters');
            }

            const notesRoot = getNotesRoot(dataDir, ws.id);
            const resolved = path.resolve(notesRoot, relPath);
            if (!isWithinDirectory(resolved, notesRoot)) {
                return sendError(res, 403, 'Access denied: path is outside notes directory');
            }

            try {
                const service = new NotesGitService(notesRoot);
                if (!(await service.isInitialized())) {
                    return sendError(res, 409, 'Notes git repository is not initialized');
                }

                // Stage only the specified file
                await execGitAsync(['add', '--', relPath], notesRoot);

                // Check if this file has staged changes
                const staged = await execGitAsync(['diff', '--cached', '--name-only', '--', relPath], notesRoot);
                if (!staged.trim()) {
                    return sendError(res, 400, 'No changes to checkpoint for this file');
                }

                const commitMsg = `[v] ${name.trim()}`;
                await execGitAsync(['commit', '-m', commitMsg], notesRoot);
                const hash = await execGitAsync(['rev-parse', 'HEAD'], notesRoot);

                sendJSON(res, 200, { hash: hash.trim(), message: commitMsg });
            } catch (err: any) {
                sendError(res, 500, 'Failed to save checkpoint: ' + err.message);
            }
        },
    });

    // ------------------------------------------------------------------
    // POST /api/workspaces/:id/notes/git/restore-version
    // body: { path: string, hash: string }
    // ------------------------------------------------------------------
    routes.push({
        method: 'POST',
        pattern: /^\/api\/workspaces\/([^/]+)\/notes\/git\/restore-version$/,
        handler: async (req, res, match) => {
            const ws = await resolveWorkspaceOrFail(store, match!, res);
            if (!ws) return;

            const body = await parseBodyOrReject(req, res);
            if (body === null) return;

            const { path: relPath, hash } = body || {};
            if (!relPath || typeof relPath !== 'string' || !relPath.trim()) {
                return sendError(res, 400, 'Missing required field: path');
            }
            if (!hash || typeof hash !== 'string' || !/^[a-f0-9]{4,40}$/.test(hash)) {
                return sendError(res, 400, 'Missing or invalid field: hash (must be 4–40 hex chars)');
            }

            const notesRoot = getNotesRoot(dataDir, ws.id);
            const resolved = path.resolve(notesRoot, relPath);
            if (!isWithinDirectory(resolved, notesRoot)) {
                return sendError(res, 403, 'Access denied: path is outside notes directory');
            }

            try {
                const service = new NotesGitService(notesRoot);
                if (!(await service.isInitialized())) {
                    return sendError(res, 409, 'Notes git repository is not initialized');
                }

                const content = await service.getFileContentAtRevision(hash, relPath);

                // Atomic write: temp file + rename (same pattern as notes-write-handler)
                const tmpPath = resolved + '.tmp';
                await fs.promises.mkdir(path.dirname(resolved), { recursive: true });
                await fs.promises.writeFile(tmpPath, content, 'utf-8');
                await fs.promises.rename(tmpPath, resolved);

                const stat = await fs.promises.stat(resolved);
                sendJSON(res, 200, { mtime: stat.mtimeMs });
            } catch (err: any) {
                const msg = err.message || '';
                if (msg.includes('does not exist') || msg.includes('bad object') ||
                    msg.includes('unknown revision') || msg.includes('Path') ||
                    msg.includes('not in \'')) {
                    return sendError(res, 404, `File not found at revision ${hash}`);
                }
                sendError(res, 500, 'Failed to restore version: ' + msg);
            }
        },
    });
}
