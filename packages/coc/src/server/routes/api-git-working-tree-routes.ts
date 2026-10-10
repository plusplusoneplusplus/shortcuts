/**
 * Endpoints for listing working-tree changes, staging, unstaging, discarding,
 * batch stage/unstage, deleting untracked files, per-file working-tree diffs, and
 * both full-text sides of a working-tree file.
 */

import { WorkingTreeService, BranchService, loadWorkingTreePatch } from '@plusplusoneplusplus/forge';
import { NativeAddonLoadError } from '@plusplusoneplusplus/coc-native';
import { internalError, badRequest, handleAPIError, missingFields, notFound } from '../errors';
import { gitCache } from '../git/git-cache';
import { gitStatusToChar, patchContentResponse } from '../git/git-response';
import {
    WORKING_TREE_CONTENT_STAGES,
    createWorkingTreeContentIO,
    loadWorkingTreeFileContent,
    resolveWorkingTreePath,
} from '../git/working-tree-file-content';
import type { WorkingTreeContentStage } from '../git/working-tree-file-content';
import { resolveWorkspaceOrFail, parseBodyOrReject } from '../shared/handler-utils';
import type { ApiRouteContext } from './api-shared';
import { createLocalPatchRoute, DIFF_LINE_LIMIT } from './api-shared';
import { createRoute, asBool } from './route-utils';

export function registerGitWorkingTreeRoutes(ctx: ApiRouteContext): void {
    const { routes, store, getWsServer } = ctx;
    const workingTreeService = new WorkingTreeService();
    const branchService = new BranchService();

    // Cap the number of untracked files returned to keep the /git/changes payload
    // bounded even when `git status --porcelain --untracked-files=all` expands a
    // large untracked directory into thousands of lines. Staged/unstaged changes
    // are inherently bounded by real edits and are never capped.
    const MAX_UNTRACKED_FILES = 500;

    function normalizeChanges(changes: Array<{ filePath: string; originalPath?: string; status: string; stage: string; repositoryRoot: string; repositoryName: string }>) {
        return changes.map(c => ({
            ...c,
            status: gitStatusToChar(c.status),
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

            const allChanges = await workingTreeService.getAllChanges(ws.rootPath);
            const repoState = await branchService.getRepoState(ws.rootPath);

            // Cap only the untracked entries. If there are more untracked files than
            // MAX_UNTRACKED_FILES, sort by path for determinism and keep the first N;
            // surface the full count so the UI can state how many were omitted.
            const untracked = allChanges.filter(c => c.stage === 'untracked');
            const nonUntracked = allChanges.filter(c => c.stage !== 'untracked');
            const untrackedTotal = untracked.length;
            const untrackedTruncated = untrackedTotal > MAX_UNTRACKED_FILES;
            const keptUntracked = untrackedTruncated
                ? [...untracked]
                    .sort((a, b) => a.filePath.localeCompare(b.filePath))
                    .slice(0, MAX_UNTRACKED_FILES)
                : untracked;

            const changes = [...nonUntracked, ...keptUntracked];
            return {
                changes: normalizeChanges(changes),
                repoState,
                ...(untrackedTruncated ? { untrackedTotal, untrackedTruncated: true } : {}),
            };
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

    // POST /api/workspaces/:id/git/changes/discard-all — Discard ALL working-tree changes
    routes.push(createRoute({
        method: 'POST',
        pattern: /^\/api\/workspaces\/([^/]+)\/git\/changes\/discard-all$/,
        handler: async ({ res, match }) => {
            const ws = await resolveWorkspaceOrFail(store, match, res);
            if (!ws) return;
            const id = ws.id;

            const result = await workingTreeService.discardAll(ws.rootPath);
            getWsServer?.()?.broadcastGitChanged(id, 'discard-all');
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
    routes.push(createLocalPatchRoute({
        method: 'GET',
        pattern: /^\/api\/workspaces\/([^/]+)\/git\/changes\/files\/(.+)\/diff$/,
        parseQuery: (q) => ({ stage: q.stage as string | undefined, full: asBool(q.full) }),
        handler: async ({ res, match, query, signal }) => {
            const ws = await resolveWorkspaceOrFail(store, match, res);
            if (!ws) return;
            const filePath = decodeURIComponent(match[2]);

            const staged = query.stage === 'staged';
            const full = query.full;

            try {
                const { content } = await loadWorkingTreePatch(ws.rootPath, staged ? 'staged' : 'unstaged', filePath, {
                    contextLines: 99999, maxLines: full ? undefined : DIFF_LINE_LIMIT, signal,
                });
                return { ...patchContentResponse(content), path: filePath };
            } catch (error) {
                signal.throwIfAborted();
                if (error instanceof NativeAddonLoadError) {
                    return void handleAPIError(res, internalError(error.message));
                }
                return { diff: '', path: filePath };
            }
        },
    }));

    // GET /api/workspaces/:id/git/changes/files/*/content?stage=staged|unstaged|untracked
    // Both full-text sides of one working-tree file. A staged rename reads its
    // base from the original path; the caller always passes the new path.
    routes.push(createRoute({
        method: 'GET',
        pattern: /^\/api\/workspaces\/([^/]+)\/git\/changes\/files\/(.+)\/content$/,
        parseQuery: (q) => ({ stage: q.stage as string | undefined }),
        handler: async ({ res, match, query }) => {
            const ws = await resolveWorkspaceOrFail(store, match, res);
            if (!ws) return;
            const filePath = decodeURIComponent(match[2]);

            const stage = query.stage as WorkingTreeContentStage | undefined;
            if (!stage || !WORKING_TREE_CONTENT_STAGES.includes(stage)) {
                return void handleAPIError(res, badRequest(`Invalid stage: expected one of ${WORKING_TREE_CONTENT_STAGES.join(', ')}`));
            }
            const absPath = resolveWorkingTreePath(ws.rootPath, filePath);
            if (!absPath) {
                return void handleAPIError(res, badRequest(`Path is outside the workspace: ${filePath}`));
            }

            const changes = await workingTreeService.getAllChanges(ws.rootPath);
            const change = changes.find(c => c.stage === stage && resolveWorkingTreePath(ws.rootPath, c.filePath) === absPath);
            if (!change) {
                return void handleAPIError(res, notFound(`Working-tree change (${stage}) for ${filePath}`));
            }
            const baseAbsPath = change.originalPath
                ? resolveWorkingTreePath(ws.rootPath, change.originalPath) ?? absPath
                : absPath;

            try {
                return await loadWorkingTreeFileContent(
                    createWorkingTreeContentIO(ws.rootPath),
                    { requestPath: filePath, absPath, baseAbsPath, repoRoot: ws.rootPath, stage },
                    { service: gitCache, workspaceId: ws.id },
                );
            } catch (err: any) {
                return void handleAPIError(res, badRequest('Failed to read working-tree file content: ' + (err?.message || 'unknown error')));
            }
        },
    }));
}
