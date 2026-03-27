/**
 * Git Branch Management REST API Routes
 *
 * Endpoints for listing, creating, switching, renaming, deleting branches,
 * push, pull, rebase-autosquash, fetch, merge, stash, stash-pop, reset,
 * cherry-pick, git-ops tracking, and amending commit messages.
 */

import * as url from 'url';
import { BranchService } from '@plusplusoneplusplus/forge';
import type { GitOpJob } from '@plusplusoneplusplus/forge';
import { sendJSON, parseBody, execGitSync } from '../api-handler';
import { handleAPIError, missingFields, notFound, badRequest, conflict } from '../errors';
import { gitCache } from '../git-cache';
import { resolveWorkspaceOrFail, parseBodyOrReject } from '../shared/handler-utils';
import type { ApiRouteContext } from './api-shared';

export function registerGitBranchRoutes(ctx: ApiRouteContext): void {
    const { routes, store, getWsServer, gitOpsStore } = ctx;
    const branchService = new BranchService();

    // GET /api/workspaces/:id/git/branches — List branches with pagination
    routes.push({
        method: 'GET',
        pattern: /^\/api\/workspaces\/([^/]+)\/git\/branches$/,
        handler: async (req, res, match) => {
            const ws = await resolveWorkspaceOrFail(store, match!, res);
            if (!ws) return;

            try {
                const parsed = url.parse(req.url!, true).query;
                const type = (parsed.type as string) || 'all';
                const limit = Math.min(parseInt(parsed.limit as string) || 100, 500);
                const offset = parseInt(parsed.offset as string) || 0;
                const searchPattern = (parsed.search as string) || undefined;
                const options = { limit, offset, searchPattern };

                let result: Record<string, unknown> = {};
                if (type === 'local') {
                    result = { local: branchService.getLocalBranchesPaginated(ws.rootPath, options) };
                } else if (type === 'remote') {
                    result = { remote: branchService.getRemoteBranchesPaginated(ws.rootPath, options) };
                } else {
                    result = {
                        local: branchService.getLocalBranchesPaginated(ws.rootPath, options),
                        remote: branchService.getRemoteBranchesPaginated(ws.rootPath, options),
                    };
                }
                sendJSON(res, 200, result);
            } catch (err) {
                return handleAPIError(res, err);
            }
        },
    });

    // GET /api/workspaces/:id/git/branch-status — Current branch status
    routes.push({
        method: 'GET',
        pattern: /^\/api\/workspaces\/([^/]+)\/git\/branch-status$/,
        handler: async (_req, res, match) => {
            const ws = await resolveWorkspaceOrFail(store, match!, res);
            if (!ws) return;

            try {
                const uncommitted = branchService.hasUncommittedChanges(ws.rootPath);
                const status = branchService.getBranchStatus(ws.rootPath, uncommitted);
                sendJSON(res, 200, status);
            } catch (err) {
                return handleAPIError(res, err);
            }
        },
    });

    // POST /api/workspaces/:id/git/branches — Create a new branch
    routes.push({
        method: 'POST',
        pattern: /^\/api\/workspaces\/([^/]+)\/git\/branches$/,
        handler: async (req, res, match) => {
            const ws = await resolveWorkspaceOrFail(store, match!, res);
            if (!ws) return;

            const body = await parseBodyOrReject(req, res);
            if (body === null) return;

            if (!body.name) {
                return handleAPIError(res, missingFields(['name']));
            }

            const checkout = body.checkout ?? false;
            const result = await branchService.createBranch(ws.rootPath, body.name, checkout);
            sendJSON(res, 200, result);
        },
    });

    // POST /api/workspaces/:id/git/branches/switch — Switch to a branch
    routes.push({
        method: 'POST',
        pattern: /^\/api\/workspaces\/([^/]+)\/git\/branches\/switch$/,
        handler: async (req, res, match) => {
            const ws = await resolveWorkspaceOrFail(store, match!, res);
            if (!ws) return;
            const id = ws.id;

            const body = await parseBodyOrReject(req, res);
            if (body === null) return;

            if (!body.name) {
                return handleAPIError(res, missingFields(['name']));
            }

            const result = await branchService.switchBranch(ws.rootPath, body.name, { force: body.force ?? false });
            getWsServer?.()?.broadcastGitChanged(id, 'branch-switch');
            sendJSON(res, 200, result);
        },
    });

    // POST /api/workspaces/:id/git/branches/rename — Rename a branch
    routes.push({
        method: 'POST',
        pattern: /^\/api\/workspaces\/([^/]+)\/git\/branches\/rename$/,
        handler: async (req, res, match) => {
            const ws = await resolveWorkspaceOrFail(store, match!, res);
            if (!ws) return;

            const body = await parseBodyOrReject(req, res);
            if (body === null) return;

            if (!body.oldName || !body.newName) {
                return handleAPIError(res, missingFields(['oldName', 'newName']));
            }

            const result = await branchService.renameBranch(ws.rootPath, body.oldName, body.newName);
            sendJSON(res, 200, result);
        },
    });

    // DELETE /api/workspaces/:id/git/branches/:name — Delete a branch
    routes.push({
        method: 'DELETE',
        pattern: /^\/api\/workspaces\/([^/]+)\/git\/branches\/(.+)$/,
        handler: async (req, res, match) => {
            const ws = await resolveWorkspaceOrFail(store, match!, res);
            if (!ws) return;

            const branchName = decodeURIComponent(match![2]);
            const parsed = url.parse(req.url!, true).query;
            const force = parsed.force === 'true';
            const result = await branchService.deleteBranch(ws.rootPath, branchName, force);
            sendJSON(res, 200, result);
        },
    });

    // POST /api/workspaces/:id/git/push — Push to remote
    routes.push({
        method: 'POST',
        pattern: /^\/api\/workspaces\/([^/]+)\/git\/push$/,
        handler: async (req, res, match) => {
            const ws = await resolveWorkspaceOrFail(store, match!, res);
            if (!ws) return;
            const id = ws.id;

            let body: any = {};
            try {
                body = await parseBody(req);
            } catch {
                body = {};
            }

            const setUpstream = body.setUpstream === true;
            const result = await branchService.push(ws.rootPath, setUpstream);
            getWsServer?.()?.broadcastGitChanged(id, 'push');
            sendJSON(res, 200, result);
        },
    });

    // POST /api/workspaces/:id/git/pull — Pull from remote (async background job)
    routes.push({
        method: 'POST',
        pattern: /^\/api\/workspaces\/([^/]+)\/git\/pull$/,
        handler: async (req, res, match) => {
            const ws = await resolveWorkspaceOrFail(store, match!, res);
            if (!ws) return;
            const id = ws.id;

            const running = await gitOpsStore.getRunning(id, 'pull');
            if (running.length > 0) {
                return handleAPIError(res, conflict('A pull operation is already running'));
            }

            let body: any = {};
            try {
                body = await parseBody(req);
            } catch {
                body = {};
            }

            const rebase = body.rebase === true;
            const jobId = `pull-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
            const job: GitOpJob = {
                id: jobId,
                workspaceId: id,
                op: 'pull',
                status: 'running',
                startedAt: new Date().toISOString(),
                pid: process.pid,
            };
            await gitOpsStore.create(job);
            sendJSON(res, 202, { jobId });

            branchService.pull(ws.rootPath, rebase).then(async (result) => {
                await gitOpsStore.update(id, jobId, {
                    status: result.success ? 'success' : 'failed',
                    finishedAt: new Date().toISOString(),
                    error: result.error,
                });
                getWsServer?.()?.broadcastGitChanged(id, 'pull');
            }).catch(async (err) => {
                await gitOpsStore.update(id, jobId, {
                    status: 'failed',
                    finishedAt: new Date().toISOString(),
                    error: err instanceof Error ? err.message : 'Unknown error',
                });
                getWsServer?.()?.broadcastGitChanged(id, 'pull');
            });
        },
    });

    // POST /api/workspaces/:id/git/rebase-autosquash — Non-interactive rebase --autosquash (async background job)
    routes.push({
        method: 'POST',
        pattern: /^\/api\/workspaces\/([^/]+)\/git\/rebase-autosquash$/,
        handler: async (req, res, match) => {
            const ws = await resolveWorkspaceOrFail(store, match!, res);
            if (!ws) return;
            const id = ws.id;

            const running = await gitOpsStore.getRunning(id, 'rebase-autosquash');
            if (running.length > 0) {
                return handleAPIError(res, conflict('A rebase-autosquash operation is already running'));
            }

            const jobId = `rebase-autosquash-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
            const job: GitOpJob = {
                id: jobId,
                workspaceId: id,
                op: 'rebase-autosquash',
                status: 'running',
                startedAt: new Date().toISOString(),
                pid: process.pid,
            };
            await gitOpsStore.create(job);
            sendJSON(res, 202, { jobId });

            branchService.rebaseAutosquash(ws.rootPath).then(async (result) => {
                await gitOpsStore.update(id, jobId, {
                    status: result.success ? 'success' : 'failed',
                    finishedAt: new Date().toISOString(),
                    error: result.error,
                });
                getWsServer?.()?.broadcastGitChanged(id, 'rebase-autosquash');
            }).catch(async (err) => {
                await gitOpsStore.update(id, jobId, {
                    status: 'failed',
                    finishedAt: new Date().toISOString(),
                    error: err instanceof Error ? err.message : 'Unknown error',
                });
                getWsServer?.()?.broadcastGitChanged(id, 'rebase-autosquash');
            });
        },
    });

    // GET /api/workspaces/:id/git/ops/latest — Most recent git op job (supports ?op=pull)
    routes.push({
        pattern: /^\/api\/workspaces\/([^/]+)\/git\/ops\/latest$/,
        handler: async (req, res, match) => {
            const id = decodeURIComponent(match![1]);
            const parsed = url.parse(req.url || '', true);
            const opFilter = typeof parsed.query.op === 'string' ? parsed.query.op as any : undefined;
            const job = await gitOpsStore.getLatest(id, opFilter);
            if (!job) {
                return sendJSON(res, 200, null);
            }
            sendJSON(res, 200, job);
        },
    });

    // GET /api/workspaces/:id/git/ops/:jobId — Specific git op job by ID
    routes.push({
        pattern: /^\/api\/workspaces\/([^/]+)\/git\/ops\/([^/]+)$/,
        handler: async (req, res, match) => {
            const wsId = decodeURIComponent(match![1]);
            const jobId = decodeURIComponent(match![2]);
            const job = await gitOpsStore.getById(wsId, jobId);
            if (!job) {
                return handleAPIError(res, notFound('Git operation'));
            }
            sendJSON(res, 200, job);
        },
    });

    // POST /api/workspaces/:id/git/fetch — Fetch from remote(s)
    routes.push({
        method: 'POST',
        pattern: /^\/api\/workspaces\/([^/]+)\/git\/fetch$/,
        handler: async (req, res, match) => {
            const ws = await resolveWorkspaceOrFail(store, match!, res);
            if (!ws) return;
            const id = ws.id;

            let body: any = {};
            try {
                body = await parseBody(req);
            } catch {
                body = {};
            }

            const remote: string | undefined = typeof body.remote === 'string' ? body.remote : undefined;
            const result = await branchService.fetch(ws.rootPath, remote);
            getWsServer?.()?.broadcastGitChanged(id, 'fetch');
            sendJSON(res, 200, result);
        },
    });

    // POST /api/workspaces/:id/git/merge — Merge a branch
    routes.push({
        method: 'POST',
        pattern: /^\/api\/workspaces\/([^/]+)\/git\/merge$/,
        handler: async (req, res, match) => {
            const ws = await resolveWorkspaceOrFail(store, match!, res);
            if (!ws) return;
            const id = ws.id;

            const body = await parseBodyOrReject(req, res);
            if (body === null) return;

            if (!body.branch || typeof body.branch !== 'string') {
                return handleAPIError(res, missingFields(['branch']));
            }

            const result = await branchService.mergeBranch(ws.rootPath, body.branch);
            getWsServer?.()?.broadcastGitChanged(id, 'merge');
            sendJSON(res, 200, result);
        },
    });

    // POST /api/workspaces/:id/git/stash — Stash changes
    routes.push({
        method: 'POST',
        pattern: /^\/api\/workspaces\/([^/]+)\/git\/stash$/,
        handler: async (req, res, match) => {
            const ws = await resolveWorkspaceOrFail(store, match!, res);
            if (!ws) return;
            const id = ws.id;

            const body = await parseBodyOrReject(req, res);
            if (body === null) return;

            const message: string | undefined = typeof body.message === 'string' ? body.message : undefined;
            const result = await branchService.stashChanges(ws.rootPath, message);
            getWsServer?.()?.broadcastGitChanged(id, 'stash');
            sendJSON(res, 200, result);
        },
    });

    // POST /api/workspaces/:id/git/stash/pop — Pop stash
    routes.push({
        method: 'POST',
        pattern: /^\/api\/workspaces\/([^/]+)\/git\/stash\/pop$/,
        handler: async (req, res, match) => {
            const ws = await resolveWorkspaceOrFail(store, match!, res);
            if (!ws) return;
            const id = ws.id;

            const result = await branchService.popStash(ws.rootPath);
            getWsServer?.()?.broadcastGitChanged(id, 'stash-pop');
            sendJSON(res, 200, result);
        },
    });

    // POST /api/workspaces/:id/git/reset — Reset HEAD to a commit
    routes.push({
        method: 'POST',
        pattern: /^\/api\/workspaces\/([^/]+)\/git\/reset$/,
        handler: async (req, res, match) => {
            const ws = await resolveWorkspaceOrFail(store, match!, res);
            if (!ws) return;
            const id = ws.id;

            const body = await parseBodyOrReject(req, res);
            if (body === null) return;

            if (!body.hash || typeof body.hash !== 'string') {
                return handleAPIError(res, missingFields(['hash']));
            }

            const allowedModes = ['hard', 'soft', 'mixed'];
            const mode: string = typeof body.mode === 'string' && allowedModes.includes(body.mode)
                ? body.mode
                : 'hard';

            try {
                execGitSync(`reset --${mode} ${body.hash}`, ws.rootPath);
                gitCache.invalidateMutable(id);
                getWsServer?.()?.broadcastGitChanged(id, 'reset');
                sendJSON(res, 200, { success: true });
            } catch (err: any) {
                return handleAPIError(res, badRequest('Failed to reset: ' + (err.message || 'unknown error')));
            }
        },
    });

    // POST /api/workspaces/:id/git/cherry-pick — Cherry-pick a commit onto the current branch
    routes.push({
        method: 'POST',
        pattern: /^\/api\/workspaces\/([^/]+)\/git\/cherry-pick$/,
        handler: async (req, res, match) => {
            const ws = await resolveWorkspaceOrFail(store, match!, res);
            if (!ws) return;
            const id = ws.id;

            const body = await parseBodyOrReject(req, res);
            if (body === null) return;

            if (!body.hash || typeof body.hash !== 'string') {
                return handleAPIError(res, missingFields(['hash']));
            }

            const result = await branchService.cherryPick(ws.rootPath, body.hash);
            if (result.success) {
                gitCache.invalidateMutable(id);
                getWsServer?.()?.broadcastGitChanged(id, 'cherry-pick');
                return sendJSON(res, 200, { success: true });
            }
            if (result.conflicts) {
                return sendJSON(res, 409, { error: result.message, conflicts: true });
            }
            return handleAPIError(res, badRequest('Cherry-pick failed: ' + result.message));
        },
    });

    // ------------------------------------------------------------------
    // Amend commit message
    // ------------------------------------------------------------------

    // POST /api/workspaces/:id/git/amend — Amend the HEAD commit message
    routes.push({
        method: 'POST',
        pattern: /^\/api\/workspaces\/([^/]+)\/git\/amend$/,
        handler: async (req, res, match) => {
            const ws = await resolveWorkspaceOrFail(store, match!, res);
            if (!ws) return;
            const id = ws.id;

            const body = await parseBodyOrReject(req, res);
            if (body === null) return;

            if (!body.title || typeof body.title !== 'string' || !body.title.trim()) {
                return handleAPIError(res, missingFields(['title']));
            }

            const result = await branchService.amendCommitMessage(
                ws.rootPath,
                body.title,
                typeof body.body === 'string' ? body.body : undefined
            );
            if (!result.success) {
                return handleAPIError(res, badRequest(result.error || 'Failed to amend commit message'));
            }
            gitCache.invalidateMutable(id);
            getWsServer?.()?.broadcastGitChanged(id, 'amend');
            sendJSON(res, 200, { hash: result.hash });
        },
    });

    // ------------------------------------------------------------------
    // Repo state (merge/rebase/cherry-pick detection)
    // ------------------------------------------------------------------

    // GET /api/workspaces/:id/git/repo-state — Detect in-progress operations
    routes.push({
        pattern: /^\/api\/workspaces\/([^/]+)\/git\/repo-state$/,
        handler: async (_req, res, match) => {
            const ws = await resolveWorkspaceOrFail(store, match!, res);
            if (!ws) return;
            const repoState = branchService.getRepoState(ws.rootPath);
            sendJSON(res, 200, repoState);
        },
    });

    // ------------------------------------------------------------------
    // Rebase continue / abort
    // ------------------------------------------------------------------

    // POST /api/workspaces/:id/git/rebase-continue
    routes.push({
        method: 'POST',
        pattern: /^\/api\/workspaces\/([^/]+)\/git\/rebase-continue$/,
        handler: async (_req, res, match) => {
            const ws = await resolveWorkspaceOrFail(store, match!, res);
            if (!ws) return;
            const id = ws.id;

            const jobId = `rebase-continue-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
            const job: GitOpJob = {
                id: jobId, workspaceId: id, op: 'rebase-continue',
                status: 'running', startedAt: new Date().toISOString(), pid: process.pid,
            };
            await gitOpsStore.create(job);
            sendJSON(res, 202, { jobId });

            branchService.rebaseContinue(ws.rootPath).then(async (result) => {
                await gitOpsStore.update(id, jobId, {
                    status: result.success ? 'success' : 'failed',
                    finishedAt: new Date().toISOString(), error: result.error,
                });
                gitCache.invalidateMutable(id);
                getWsServer?.()?.broadcastGitChanged(id, 'rebase-continue');
            }).catch(async (err) => {
                await gitOpsStore.update(id, jobId, {
                    status: 'failed', finishedAt: new Date().toISOString(),
                    error: err instanceof Error ? err.message : 'Unknown error',
                });
                getWsServer?.()?.broadcastGitChanged(id, 'rebase-continue');
            });
        },
    });

    // POST /api/workspaces/:id/git/rebase-abort
    routes.push({
        method: 'POST',
        pattern: /^\/api\/workspaces\/([^/]+)\/git\/rebase-abort$/,
        handler: async (_req, res, match) => {
            const ws = await resolveWorkspaceOrFail(store, match!, res);
            if (!ws) return;
            const id = ws.id;
            const result = await branchService.rebaseAbort(ws.rootPath);
            if (!result.success) {
                return handleAPIError(res, badRequest(result.error || 'Failed to abort rebase'));
            }
            gitCache.invalidateMutable(id);
            getWsServer?.()?.broadcastGitChanged(id, 'rebase-abort');
            sendJSON(res, 200, { success: true });
        },
    });

    // ------------------------------------------------------------------
    // Merge continue / abort
    // ------------------------------------------------------------------

    // POST /api/workspaces/:id/git/merge-continue
    routes.push({
        method: 'POST',
        pattern: /^\/api\/workspaces\/([^/]+)\/git\/merge-continue$/,
        handler: async (_req, res, match) => {
            const ws = await resolveWorkspaceOrFail(store, match!, res);
            if (!ws) return;
            const id = ws.id;

            const jobId = `merge-continue-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
            const job: GitOpJob = {
                id: jobId, workspaceId: id, op: 'merge-continue',
                status: 'running', startedAt: new Date().toISOString(), pid: process.pid,
            };
            await gitOpsStore.create(job);
            sendJSON(res, 202, { jobId });

            branchService.mergeContinue(ws.rootPath).then(async (result) => {
                await gitOpsStore.update(id, jobId, {
                    status: result.success ? 'success' : 'failed',
                    finishedAt: new Date().toISOString(), error: result.error,
                });
                gitCache.invalidateMutable(id);
                getWsServer?.()?.broadcastGitChanged(id, 'merge-continue');
            }).catch(async (err) => {
                await gitOpsStore.update(id, jobId, {
                    status: 'failed', finishedAt: new Date().toISOString(),
                    error: err instanceof Error ? err.message : 'Unknown error',
                });
                getWsServer?.()?.broadcastGitChanged(id, 'merge-continue');
            });
        },
    });

    // POST /api/workspaces/:id/git/merge-abort
    routes.push({
        method: 'POST',
        pattern: /^\/api\/workspaces\/([^/]+)\/git\/merge-abort$/,
        handler: async (_req, res, match) => {
            const ws = await resolveWorkspaceOrFail(store, match!, res);
            if (!ws) return;
            const id = ws.id;
            const result = await branchService.mergeAbort(ws.rootPath);
            if (!result.success) {
                return handleAPIError(res, badRequest(result.error || 'Failed to abort merge'));
            }
            gitCache.invalidateMutable(id);
            getWsServer?.()?.broadcastGitChanged(id, 'merge-abort');
            sendJSON(res, 200, { success: true });
        },
    });

    // ------------------------------------------------------------------
    // Rebase reorder (drag-and-drop commit reorder)
    // ------------------------------------------------------------------

    // POST /api/workspaces/:id/git/rebase-reorder
    routes.push({
        method: 'POST',
        pattern: /^\/api\/workspaces\/([^/]+)\/git\/rebase-reorder$/,
        handler: async (req, res, match) => {
            const ws = await resolveWorkspaceOrFail(store, match!, res);
            if (!ws) return;
            const id = ws.id;

            const body = await parseBodyOrReject(req, res);
            if (body === null) return;
            if (!Array.isArray(body.commits) || body.commits.length === 0) {
                return handleAPIError(res, missingFields(['commits']));
            }

            const running = await gitOpsStore.getRunning(id, 'rebase-reorder');
            if (running.length > 0) {
                return handleAPIError(res, conflict('A rebase-reorder operation is already running'));
            }

            const jobId = `rebase-reorder-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
            const job: GitOpJob = {
                id: jobId, workspaceId: id, op: 'rebase-reorder',
                status: 'running', startedAt: new Date().toISOString(), pid: process.pid,
            };
            await gitOpsStore.create(job);
            sendJSON(res, 202, { jobId });

            branchService.rebaseReorder(ws.rootPath, body.commits).then(async (result) => {
                await gitOpsStore.update(id, jobId, {
                    status: result.success ? 'success' : 'failed',
                    finishedAt: new Date().toISOString(), error: result.error,
                });
                gitCache.invalidateMutable(id);
                getWsServer?.()?.broadcastGitChanged(id, 'rebase-reorder');
            }).catch(async (err) => {
                await gitOpsStore.update(id, jobId, {
                    status: 'failed', finishedAt: new Date().toISOString(),
                    error: err instanceof Error ? err.message : 'Unknown error',
                });
                getWsServer?.()?.broadcastGitChanged(id, 'rebase-reorder');
            });
        },
    });
}
