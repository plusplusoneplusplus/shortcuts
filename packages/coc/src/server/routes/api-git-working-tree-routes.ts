/**
 * Git Working-Tree REST API Routes
 *
 * Endpoints for listing working-tree changes, staging, unstaging, discarding,
 * batch stage/unstage, deleting untracked files, and per-file working-tree diffs.
 */

import { WorkingTreeService, BranchService } from '@plusplusoneplusplus/forge';
import { handleAPIError, missingFields } from '../errors';
import { resolveWorkspaceOrFail, parseBodyOrReject } from '../shared/handler-utils';
import type { ApiRouteContext } from './api-shared';
import { truncateDiffIfNeeded } from './api-shared';
import { createRoute, asBool } from './route-utils';

export function registerGitWorkingTreeRoutes(ctx: ApiRouteContext): void {
    const { routes, store, getWsServer } = ctx;
    const workingTreeService = new WorkingTreeService();
    const branchService = new BranchService();

    const STATUS_WORD_TO_CHAR: Record<string, string> = {
        added: 'A', modified: 'M', deleted: 'D', renamed: 'R', copied: 'C', conflict: 'U', untracked: '?',
    };

    function normalizeChanges(changes: Array<{ filePath: string; originalPath?: string; status: string; stage: string; repositoryRoot: string; repositoryName: string }>) {
        return changes.map(c => ({
            ...c,
            status: STATUS_WORD_TO_CHAR[c.status] ?? c.status,
            ...(c.originalPath ? { oldPath: c.originalPath } : {}),
        }));
    }

    // GET /api/workspaces/:id/git/changes — All working-tree changes + repo state
    routes.push(createRoute({
        method: 'GET',
        pattern: /^\/api\/workspaces\/([^/]+)\/git\/changes$/,
        handler: async ({ res, match }) => {
            const ws = await resolveWorkspaceOrFail(store, match, res);
            if (!ws) return;

            const changes = await workingTreeService.getAllChanges(ws.rootPath);
            const repoState = branchService.getRepoState(ws.rootPath);
            return { changes: normalizeChanges(changes), repoState };
        },
    }));

    // POST /api/workspaces/:id/git/changes/stage — Stage a file
    routes.push(createRoute({
        method: 'POST',
        pattern: /^\/api\/workspaces\/([^/]+)\/git\/changes\/stage$/,
        handler: async ({ req, res, match }) => {
            const ws = await resolveWorkspaceOrFail(store, match, res);
            if (!ws) return;
            const id = ws.id;

            const body = await parseBodyOrReject(req, res);
            if (body === null) return;
            if (typeof body.filePath !== 'string') return void handleAPIError(res, missingFields(['filePath']));

            const result = await workingTreeService.stageFile(ws.rootPath, body.filePath);
            getWsServer?.()?.broadcastGitChanged(id, 'stage');
            return result;
        },
    }));

    // POST /api/workspaces/:id/git/changes/unstage — Unstage a file
    routes.push(createRoute({
        method: 'POST',
        pattern: /^\/api\/workspaces\/([^/]+)\/git\/changes\/unstage$/,
        handler: async ({ req, res, match }) => {
            const ws = await resolveWorkspaceOrFail(store, match, res);
            if (!ws) return;
            const id = ws.id;

            const body = await parseBodyOrReject(req, res);
            if (body === null) return;
            if (typeof body.filePath !== 'string') return void handleAPIError(res, missingFields(['filePath']));

            const result = await workingTreeService.unstageFile(ws.rootPath, body.filePath);
            getWsServer?.()?.broadcastGitChanged(id, 'unstage');
            return result;
        },
    }));

    // POST /api/workspaces/:id/git/changes/discard — Discard unstaged changes
    routes.push(createRoute({
        method: 'POST',
        pattern: /^\/api\/workspaces\/([^/]+)\/git\/changes\/discard$/,
        handler: async ({ req, res, match }) => {
            const ws = await resolveWorkspaceOrFail(store, match, res);
            if (!ws) return;
            const id = ws.id;

            const body = await parseBodyOrReject(req, res);
            if (body === null) return;
            if (typeof body.filePath !== 'string') return void handleAPIError(res, missingFields(['filePath']));

            const result = await workingTreeService.discardChanges(ws.rootPath, body.filePath);
            getWsServer?.()?.broadcastGitChanged(id, 'discard');
            return result;
        },
    }));

    // POST /api/workspaces/:id/git/changes/stage-batch — Stage multiple files at once
    routes.push(createRoute({
        method: 'POST',
        pattern: /^\/api\/workspaces\/([^/]+)\/git\/changes\/stage-batch$/,
        handler: async ({ req, res, match }) => {
            const ws = await resolveWorkspaceOrFail(store, match, res);
            if (!ws) return;
            const id = ws.id;

            const body = await parseBodyOrReject(req, res);
            if (body === null) return;
            if (!Array.isArray(body.filePaths)) return void handleAPIError(res, missingFields(['filePaths']));

            const result = await workingTreeService.stageFiles(ws.rootPath, body.filePaths);
            getWsServer?.()?.broadcastGitChanged(id, 'stage-batch');
            return result;
        },
    }));

    // POST /api/workspaces/:id/git/changes/unstage-batch — Unstage multiple files at once
    routes.push(createRoute({
        method: 'POST',
        pattern: /^\/api\/workspaces\/([^/]+)\/git\/changes\/unstage-batch$/,
        handler: async ({ req, res, match }) => {
            const ws = await resolveWorkspaceOrFail(store, match, res);
            if (!ws) return;
            const id = ws.id;

            const body = await parseBodyOrReject(req, res);
            if (body === null) return;
            if (!Array.isArray(body.filePaths)) return void handleAPIError(res, missingFields(['filePaths']));

            const result = await workingTreeService.unstageFiles(ws.rootPath, body.filePaths);
            getWsServer?.()?.broadcastGitChanged(id, 'unstage-batch');
            return result;
        },
    }));

    // DELETE /api/workspaces/:id/git/changes/untracked — Delete an untracked file
    routes.push(createRoute({
        method: 'DELETE',
        pattern: /^\/api\/workspaces\/([^/]+)\/git\/changes\/untracked$/,
        handler: async ({ req, res, match }) => {
            const ws = await resolveWorkspaceOrFail(store, match, res);
            if (!ws) return;

            const body = await parseBodyOrReject(req, res);
            if (body === null) return;
            if (typeof body.filePath !== 'string') return void handleAPIError(res, missingFields(['filePath']));

            return await workingTreeService.deleteUntrackedFile(ws.rootPath, body.filePath);
        },
    }));

    // GET /api/workspaces/:id/git/changes/files/*/diff — Per-file working-tree diff
    routes.push(createRoute({
        method: 'GET',
        pattern: /^\/api\/workspaces\/([^/]+)\/git\/changes\/files\/(.+)\/diff$/,
        parseQuery: (q) => ({ stage: q.stage as string | undefined, full: asBool(q.full) }),
        handler: async ({ res, match, query }) => {
            const ws = await resolveWorkspaceOrFail(store, match, res);
            if (!ws) return;
            const filePath = decodeURIComponent(match[2]);

            const staged = query.stage === 'staged';
            const full = query.full;

            try {
                const diff = await workingTreeService.getFileDiff(ws.rootPath, filePath, staged);
                return { ...truncateDiffIfNeeded(diff, full), path: filePath };
            } catch {
                return { diff: '', path: filePath };
            }
        },
    }));
}
