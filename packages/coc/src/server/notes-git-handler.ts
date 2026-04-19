/**
 * Notes Git REST API Handler
 *
 * HTTP API routes for notes git operations (init, status, log, diff, commit)
 * for a given workspace's notes directory.
 *
 * No VS Code dependencies — uses only Node.js built-in modules.
 * Cross-platform compatible (Linux/Mac/Windows).
 */

import * as url from 'url';
import * as fs from 'fs';
import type { ProcessStore } from '@plusplusoneplusplus/forge';
import { sendJSON, sendError } from './api-handler';
import { resolveWorkspaceOrFail, parseBodyOrReject } from './shared/handler-utils';
import type { Route } from './types';
import { getRepoDataPath } from './paths';
import { NotesGitService } from './notes-git-service';

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
}
