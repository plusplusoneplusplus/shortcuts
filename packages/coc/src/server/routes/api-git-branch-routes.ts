/**
 * Git Branch Management REST API Routes
 *
 * Endpoints for listing, creating, switching, renaming, deleting branches,
 * push, pull, rebase-autosquash, fetch, merge, stash, stash-pop, reset,
 * cherry-pick, git-ops tracking, and amending commit messages.
 */

import { BranchService, detectRemoteUrl, normalizeRemoteUrl } from '@plusplusoneplusplus/forge';
import type { GitOpJob, GitOpMetadata, ProcessStore, WorkspaceInfo } from '@plusplusoneplusplus/forge';
import { sendJSON, parseBody, execGitArgsSync } from '../core/api-handler';
import { handleAPIError, missingFields, notFound, badRequest, conflict } from '../errors';
import { gitCache } from '../git/git-cache';
import { resolveWorkspaceOrFail, parseBodyOrReject } from '../shared/handler-utils';
import type { ApiRouteContext } from './api-shared';
import { createRoute, asString, asInt, asBool } from './route-utils';

export function registerGitBranchRoutes(ctx: ApiRouteContext): void {
    const { routes, store, getWsServer, gitOpsStore, bridge } = ctx;
    const branchService = new BranchService();

    // GET /api/workspaces/:id/git/branches — List branches with pagination
    routes.push(createRoute({
        method: 'GET',
        pattern: /^\/api\/workspaces\/([^/]+)\/git\/branches$/,
        parseQuery: (q) => ({
            type: asString(q.type, 'all'),
            limit: asInt(q.limit, 100, 500),
            offset: asInt(q.offset, 0),
            search: asString(q.search),
        }),
        handler: async ({ query, match, res }) => {
            const ws = await resolveWorkspaceOrFail(store, match, res);
            if (!ws) return;
            const { type, limit, offset, search: searchPattern } = query;
            const options = { limit, offset, searchPattern };
            if (type === 'local') {
                return { local: branchService.getLocalBranchesPaginated(ws.rootPath, options) };
            } else if (type === 'remote') {
                return { remote: branchService.getRemoteBranchesPaginated(ws.rootPath, options) };
            } else {
                return {
                    local: branchService.getLocalBranchesPaginated(ws.rootPath, options),
                    remote: branchService.getRemoteBranchesPaginated(ws.rootPath, options),
                };
            }
        },
    }));

    // GET /api/workspaces/:id/git/branch-status — Current branch status
    routes.push(createRoute({
        method: 'GET',
        pattern: /^\/api\/workspaces\/([^/]+)\/git\/branch-status$/,
        handler: async ({ match, res }) => {
            const ws = await resolveWorkspaceOrFail(store, match, res);
            if (!ws) return;
            const uncommitted = await branchService.hasUncommittedChanges(ws.rootPath);
            return branchService.getBranchStatus(ws.rootPath, uncommitted);
        },
    }));

    // POST /api/workspaces/:id/git/branches — Create a new branch
    routes.push(createRoute({
        method: 'POST',
        pattern: /^\/api\/workspaces\/([^/]+)\/git\/branches$/,
        handler: async ({ match, res, req }) => {
            const ws = await resolveWorkspaceOrFail(store, match, res);
            if (!ws) return;
            const body = await parseBodyOrReject(req, res);
            if (body === null) return;
            if (!body.name) return void handleAPIError(res, missingFields(['name']));
            const checkout = body.checkout ?? false;
            return branchService.createBranch(ws.rootPath, body.name, checkout);
        },
    }));

    // POST /api/workspaces/:id/git/branches/switch — Switch to a branch
    routes.push(createRoute({
        method: 'POST',
        pattern: /^\/api\/workspaces\/([^/]+)\/git\/branches\/switch$/,
        handler: async ({ match, res, req }) => {
            const ws = await resolveWorkspaceOrFail(store, match, res);
            if (!ws) return;
            const body = await parseBodyOrReject(req, res);
            if (body === null) return;
            if (!body.name) return void handleAPIError(res, missingFields(['name']));
            const result = await branchService.switchBranch(ws.rootPath, body.name, { force: body.force ?? false });
            getWsServer?.()?.broadcastGitChanged(ws.id, 'branch-switch');
            return result;
        },
    }));

    // POST /api/workspaces/:id/git/branches/rename — Rename a branch
    routes.push(createRoute({
        method: 'POST',
        pattern: /^\/api\/workspaces\/([^/]+)\/git\/branches\/rename$/,
        handler: async ({ match, res, req }) => {
            const ws = await resolveWorkspaceOrFail(store, match, res);
            if (!ws) return;
            const body = await parseBodyOrReject(req, res);
            if (body === null) return;
            if (!body.oldName || !body.newName) return void handleAPIError(res, missingFields(['oldName', 'newName']));
            return branchService.renameBranch(ws.rootPath, body.oldName, body.newName);
        },
    }));

    // DELETE /api/workspaces/:id/git/branches/:name — Delete a branch
    routes.push(createRoute({
        method: 'DELETE',
        pattern: /^\/api\/workspaces\/([^/]+)\/git\/branches\/(.+)$/,
        parseQuery: (q) => ({ force: asBool(q.force) }),
        handler: async ({ query, match, res }) => {
            const ws = await resolveWorkspaceOrFail(store, match, res);
            if (!ws) return;
            const branchName = decodeURIComponent(match[2]);
            return branchService.deleteBranch(ws.rootPath, branchName, query.force);
        },
    }));

    // POST /api/workspaces/:id/git/push — Push to remote
    routes.push(createRoute({
        method: 'POST',
        pattern: /^\/api\/workspaces\/([^/]+)\/git\/push$/,
        handler: async ({ match, res, req }) => {
            const ws = await resolveWorkspaceOrFail(store, match, res);
            if (!ws) return;
            let body: any = {};
            try { body = await parseBody(req); } catch { body = {}; }
            const result = await branchService.push(ws.rootPath, body.setUpstream === true);
            getWsServer?.()?.broadcastGitChanged(ws.id, 'push');
            return result;
        },
    }));

    // POST /api/workspaces/:id/git/push-to — Push up to a specific commit
    routes.push(createRoute({
        method: 'POST',
        pattern: /^\/api\/workspaces\/([^/]+)\/git\/push-to$/,
        handler: async ({ match, res, req }) => {
            const ws = await resolveWorkspaceOrFail(store, match, res);
            if (!ws) return;
            let body: any = {};
            try { body = await parseBody(req); } catch { body = {}; }
            const { commitHash } = body;
            if (!commitHash || typeof commitHash !== 'string') {
                return void handleAPIError(res, badRequest('Missing or invalid commitHash'));
            }
            const result = await branchService.pushUpTo(ws.rootPath, commitHash);
            getWsServer?.()?.broadcastGitChanged(ws.id, 'push');
            return result;
        },
    }));

    // POST /api/workspaces/:id/git/pull — Pull from remote (async background job)
    routes.push(createRoute({
        method: 'POST',
        pattern: /^\/api\/workspaces\/([^/]+)\/git\/pull$/,
        statusCode: 202,
        handler: async ({ match, res, req }) => {
            const ws = await resolveWorkspaceOrFail(store, match, res);
            if (!ws) return;
            const id = ws.id;
            const running = await gitOpsStore.getRunning(id, 'pull');
            if (running.length > 0) return void handleAPIError(res, conflict('A pull operation is already running'));
            let body: any = {};
            try { body = await parseBody(req); } catch { body = {}; }
            const rebase = body.rebase === true;
            const jobId = `pull-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
            const job: GitOpJob = {
                id: jobId, workspaceId: id, op: 'pull',
                status: 'running', startedAt: new Date().toISOString(), pid: process.pid,
            };
            await gitOpsStore.create(job);
            void branchService.pull(ws.rootPath, rebase).then(async (result) => {
                await gitOpsStore.update(id, jobId, {
                    status: result.success ? 'success' : 'failed',
                    finishedAt: new Date().toISOString(), error: result.error,
                });
                getWsServer?.()?.broadcastGitChanged(id, 'pull');
            }).catch(async (err) => {
                await gitOpsStore.update(id, jobId, {
                    status: 'failed', finishedAt: new Date().toISOString(),
                    error: err instanceof Error ? err.message : 'Unknown error',
                });
                getWsServer?.()?.broadcastGitChanged(id, 'pull');
            });
            return { jobId };
        },
    }));

    // POST /api/workspaces/:id/git/rebase-autosquash — Non-interactive rebase --autosquash (async background job)
    routes.push(createRoute({
        method: 'POST',
        pattern: /^\/api\/workspaces\/([^/]+)\/git\/rebase-autosquash$/,
        statusCode: 202,
        handler: async ({ match, res }) => {
            const ws = await resolveWorkspaceOrFail(store, match, res);
            if (!ws) return;
            const id = ws.id;
            const running = await gitOpsStore.getRunning(id, 'rebase-autosquash');
            if (running.length > 0) return void handleAPIError(res, conflict('A rebase-autosquash operation is already running'));
            const jobId = `rebase-autosquash-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
            const job: GitOpJob = {
                id: jobId, workspaceId: id, op: 'rebase-autosquash',
                status: 'running', startedAt: new Date().toISOString(), pid: process.pid,
            };
            await gitOpsStore.create(job);
            void branchService.rebaseAutosquash(ws.rootPath).then(async (result) => {
                await gitOpsStore.update(id, jobId, {
                    status: result.success ? 'success' : 'failed',
                    finishedAt: new Date().toISOString(), error: result.error,
                });
                getWsServer?.()?.broadcastGitChanged(id, 'rebase-autosquash');
            }).catch(async (err) => {
                await gitOpsStore.update(id, jobId, {
                    status: 'failed', finishedAt: new Date().toISOString(),
                    error: err instanceof Error ? err.message : 'Unknown error',
                });
                getWsServer?.()?.broadcastGitChanged(id, 'rebase-autosquash');
            });
            return { jobId };
        },
    }));

    // GET /api/workspaces/:id/git/ops/latest — Most recent git op job (supports ?op=pull)
    routes.push(createRoute({
        pattern: /^\/api\/workspaces\/([^/]+)\/git\/ops\/latest$/,
        parseQuery: (q) => ({ op: asString(q.op) as any }),
        handler: async ({ query, match, res }) => {
            const id = decodeURIComponent(match[1]);
            const job = await gitOpsStore.getLatest(id, query.op);
            if (!job) { sendJSON(res, 200, null); return; }
            return job;
        },
    }));

    // GET /api/workspaces/:id/git/ops/:jobId — Specific git op job by ID
    routes.push(createRoute({
        pattern: /^\/api\/workspaces\/([^/]+)\/git\/ops\/([^/]+)$/,
        handler: async ({ match, res }) => {
            const wsId = decodeURIComponent(match[1]);
            const jobId = decodeURIComponent(match[2]);
            const job = await gitOpsStore.getById(wsId, jobId);
            if (!job) return void handleAPIError(res, notFound('Git operation'));
            return job;
        },
    }));

    // POST /api/workspaces/:id/git/fetch — Fetch from remote(s)
    routes.push(createRoute({
        method: 'POST',
        pattern: /^\/api\/workspaces\/([^/]+)\/git\/fetch$/,
        handler: async ({ match, res, req }) => {
            const ws = await resolveWorkspaceOrFail(store, match, res);
            if (!ws) return;
            let body: any = {};
            try { body = await parseBody(req); } catch { body = {}; }
            const remote: string | undefined = typeof body.remote === 'string' ? body.remote : undefined;
            const result = await branchService.fetch(ws.rootPath, remote);
            getWsServer?.()?.broadcastGitChanged(ws.id, 'fetch');
            return result;
        },
    }));

    // POST /api/workspaces/:id/git/merge — Merge a branch
    routes.push(createRoute({
        method: 'POST',
        pattern: /^\/api\/workspaces\/([^/]+)\/git\/merge$/,
        handler: async ({ match, res, req }) => {
            const ws = await resolveWorkspaceOrFail(store, match, res);
            if (!ws) return;
            const body = await parseBodyOrReject(req, res);
            if (body === null) return;
            if (!body.branch || typeof body.branch !== 'string') return void handleAPIError(res, missingFields(['branch']));
            const result = await branchService.mergeBranch(ws.rootPath, body.branch);
            getWsServer?.()?.broadcastGitChanged(ws.id, 'merge');
            return result;
        },
    }));

    // POST /api/workspaces/:id/git/stash — Stash changes
    routes.push(createRoute({
        method: 'POST',
        pattern: /^\/api\/workspaces\/([^/]+)\/git\/stash$/,
        handler: async ({ match, res, req }) => {
            const ws = await resolveWorkspaceOrFail(store, match, res);
            if (!ws) return;
            const body = await parseBodyOrReject(req, res);
            if (body === null) return;
            const message: string | undefined = typeof body.message === 'string' ? body.message : undefined;
            const result = await branchService.stashChanges(ws.rootPath, message);
            getWsServer?.()?.broadcastGitChanged(ws.id, 'stash');
            return result;
        },
    }));

    // POST /api/workspaces/:id/git/stash/pop — Pop stash
    routes.push(createRoute({
        method: 'POST',
        pattern: /^\/api\/workspaces\/([^/]+)\/git\/stash\/pop$/,
        handler: async ({ match, res }) => {
            const ws = await resolveWorkspaceOrFail(store, match, res);
            if (!ws) return;
            const result = await branchService.popStash(ws.rootPath);
            getWsServer?.()?.broadcastGitChanged(ws.id, 'stash-pop');
            return result;
        },
    }));

    // POST /api/workspaces/:id/git/reset — Reset HEAD to a commit
    routes.push(createRoute({
        method: 'POST',
        pattern: /^\/api\/workspaces\/([^/]+)\/git\/reset$/,
        handler: async ({ match, res, req }) => {
            const ws = await resolveWorkspaceOrFail(store, match, res);
            if (!ws) return;
            const body = await parseBodyOrReject(req, res);
            if (body === null) return;
            if (!body.hash || typeof body.hash !== 'string') return void handleAPIError(res, missingFields(['hash']));
            const allowedModes = ['hard', 'soft', 'mixed'];
            const mode = typeof body.mode === 'string' && allowedModes.includes(body.mode) ? body.mode : 'hard';
            try {
                execGitArgsSync(['reset', `--${mode}`, body.hash], ws.rootPath);
            } catch (err: any) {
                throw badRequest('Failed to reset: ' + (err.message || 'unknown error'));
            }
            gitCache.invalidateMutable(ws.id);
            getWsServer?.()?.broadcastGitChanged(ws.id, 'reset');
            return { success: true };
        },
    }));

    // POST /api/workspaces/:id/git/cherry-pick — Cherry-pick a commit onto the current branch
    routes.push(createRoute({
        method: 'POST',
        pattern: /^\/api\/workspaces\/([^/]+)\/git\/cherry-pick$/,
        handler: async ({ match, res, req }) => {
            const ws = await resolveWorkspaceOrFail(store, match, res);
            if (!ws) return;
            const body = await parseBodyOrReject(req, res);
            if (body === null) return;
            if (!body.hash || typeof body.hash !== 'string') return void handleAPIError(res, missingFields(['hash']));
            const result = await branchService.cherryPick(ws.rootPath, body.hash);
            if (result.success) {
                gitCache.invalidateMutable(ws.id);
                getWsServer?.()?.broadcastGitChanged(ws.id, 'cherry-pick');
                return { success: true };
            }
            if (result.conflicts) {
                sendJSON(res, 409, { error: result.message, conflicts: true });
                return;
            }
            throw badRequest('Cherry-pick failed: ' + result.message);
        },
    }));

    // POST /api/workspaces/:id/git/patch/export — Export one commit as a format-patch payload
    routes.push(createRoute({
        method: 'POST',
        pattern: /^\/api\/workspaces\/([^/]+)\/git\/patch\/export$/,
        handler: async ({ match, res, req }) => {
            const ws = await resolveWorkspaceOrFail(store, match, res);
            if (!ws) return;
            const body = await parseBodyOrReject(req, res);
            if (body === null) return;
            if (!body.hash || typeof body.hash !== 'string') return void handleAPIError(res, missingFields(['hash']));
            const hash = body.hash.trim();
            if (!/^[a-fA-F0-9]{4,40}$/.test(hash)) return void handleAPIError(res, badRequest('Missing or invalid hash'));

            const result = await branchService.exportCommitPatch(ws.rootPath, hash);
            if (!result.success) return void handleAPIError(res, notFound('Commit'));

            const remoteUrl = await resolveWorkspaceRemoteUrl(ws, store);
            const normalizedSourceRemoteUrl = remoteUrl ? normalizeRemoteUrl(remoteUrl) || null : null;
            return {
                sourceWorkspace: {
                    id: ws.id,
                    name: ws.name,
                },
                sourceCommit: {
                    hash: result.commitHash,
                    subject: result.subject,
                    author: {
                        name: result.authorName,
                        email: result.authorEmail,
                        date: result.authorDate,
                    },
                },
                normalizedSourceRemoteUrl,
                patch: {
                    format: 'format-patch',
                    body: result.patch,
                },
            };
        },
    }));

    // POST /api/workspaces/:id/git/patch/apply — Apply a format-patch payload to the target workspace
    routes.push(createRoute({
        method: 'POST',
        pattern: /^\/api\/workspaces\/([^/]+)\/git\/patch\/apply$/,
        handler: async ({ match, res, req }) => {
            const ws = await resolveWorkspaceOrFail(store, match, res);
            if (!ws) return;
            const body = await parseBodyOrReject(req, res);
            if (body === null) return;

            const patchFormat = body.patch?.format;
            const patchBody = typeof body.patch?.body === 'string' ? body.patch.body : undefined;
            if (patchFormat !== 'format-patch' || !patchBody || !patchBody.trim()) {
                return void handleAPIError(res, badRequest('Missing or invalid format-patch payload'));
            }

            const repoState = branchService.getRepoState(ws.rootPath);
            if (repoState.operation !== 'none') {
                sendJSON(res, 409, {
                    error: `Target workspace already has a ${repoState.gitOperation ?? repoState.operation} operation in progress`,
                    operation: repoState.operation,
                    gitOperation: repoState.gitOperation,
                    conflictFiles: repoState.conflictFiles,
                });
                return;
            }

            const hasUncommittedChanges = await branchService.hasUncommittedChanges(ws.rootPath);
            const branchStatus = await branchService.getBranchStatus(ws.rootPath, hasUncommittedChanges);
            if (!branchStatus) return void handleAPIError(res, badRequest('Target workspace is not a usable git repository'));
            if (branchStatus.isDetached) {
                sendJSON(res, 409, {
                    error: 'Target workspace is in detached HEAD state',
                    targetBranch: null,
                    detachedHash: branchStatus.detachedHash,
                });
                return;
            }

            const operationStartedAt = new Date().toISOString();
            const result = await branchService.applyCommitPatch(ws.rootPath, patchBody, {
                stashAndContinue: body.stashAndContinue === true,
                stashMessage: 'CoC patch-transfer cherry-pick',
            });
            if (result.success) {
                const operation: GitOpJob = {
                    id: `cherry-pick-transfer-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
                    workspaceId: ws.id,
                    op: 'cherry-pick-transfer',
                    status: 'success',
                    startedAt: operationStartedAt,
                    finishedAt: new Date().toISOString(),
                    pid: process.pid,
                    metadata: buildPatchTransferMetadata(body, ws, branchStatus.name, result.headHash, result.stashed === true),
                };
                await gitOpsStore.create(operation);
                gitCache.invalidateMutable(ws.id);
                getWsServer?.()?.broadcastGitChanged(ws.id, 'patch-apply');
                return {
                    success: true,
                    targetWorkspace: { id: ws.id, name: ws.name },
                    targetBranch: branchStatus.name,
                    targetHead: result.headHash,
                    newCommitHash: result.headHash,
                    stashed: result.stashed === true,
                    operation,
                };
            }
            if (result.dirty) {
                sendJSON(res, 409, {
                    error: result.message,
                    dirty: true,
                    stashed: result.stashed === true,
                });
                return;
            }
            if (result.conflicts) {
                sendJSON(res, 409, {
                    error: result.message,
                    conflicts: true,
                    stashed: result.stashed === true,
                    gitState: result.gitState,
                });
                return;
            }
            throw badRequest('Patch apply failed: ' + result.message);
        },
    }));

    // POST /api/workspaces/:id/git/amend — Amend the HEAD commit message
    routes.push(createRoute({
        method: 'POST',
        pattern: /^\/api\/workspaces\/([^/]+)\/git\/amend$/,
        handler: async ({ match, res, req }) => {
            const ws = await resolveWorkspaceOrFail(store, match, res);
            if (!ws) return;
            const body = await parseBodyOrReject(req, res);
            if (body === null) return;
            if (!body.title || typeof body.title !== 'string' || !body.title.trim()) return void handleAPIError(res, missingFields(['title']));
            const result = await branchService.amendCommitMessage(
                ws.rootPath, body.title,
                typeof body.body === 'string' ? body.body : undefined,
            );
            if (!result.success) throw badRequest(result.error || 'Failed to amend commit message');
            gitCache.invalidateMutable(ws.id);
            getWsServer?.()?.broadcastGitChanged(ws.id, 'amend');
            return { hash: result.hash };
        },
    }));

    // GET /api/workspaces/:id/git/repo-state — Detect in-progress operations
    routes.push(createRoute({
        pattern: /^\/api\/workspaces\/([^/]+)\/git\/repo-state$/,
        handler: async ({ match, res }) => {
            const ws = await resolveWorkspaceOrFail(store, match, res);
            if (!ws) return;
            return branchService.getRepoState(ws.rootPath);
        },
    }));

    // POST /api/workspaces/:id/git/rebase-continue
    routes.push(createRoute({
        method: 'POST',
        pattern: /^\/api\/workspaces\/([^/]+)\/git\/rebase-continue$/,
        statusCode: 202,
        handler: async ({ match, res }) => {
            const ws = await resolveWorkspaceOrFail(store, match, res);
            if (!ws) return;
            const id = ws.id;
            const jobId = `rebase-continue-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
            const job: GitOpJob = {
                id: jobId, workspaceId: id, op: 'rebase-continue',
                status: 'running', startedAt: new Date().toISOString(), pid: process.pid,
            };
            await gitOpsStore.create(job);
            void branchService.rebaseContinue(ws.rootPath).then(async (result) => {
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
            return { jobId };
        },
    }));

    // POST /api/workspaces/:id/git/rebase-abort
    routes.push(createRoute({
        method: 'POST',
        pattern: /^\/api\/workspaces\/([^/]+)\/git\/rebase-abort$/,
        handler: async ({ match, res }) => {
            const ws = await resolveWorkspaceOrFail(store, match, res);
            if (!ws) return;
            const result = await branchService.rebaseAbort(ws.rootPath);
            if (!result.success) throw badRequest(result.error || 'Failed to abort rebase');
            gitCache.invalidateMutable(ws.id);
            getWsServer?.()?.broadcastGitChanged(ws.id, 'rebase-abort');
            return { success: true };
        },
    }));

    // POST /api/workspaces/:id/git/merge-continue
    routes.push(createRoute({
        method: 'POST',
        pattern: /^\/api\/workspaces\/([^/]+)\/git\/merge-continue$/,
        statusCode: 202,
        handler: async ({ match, res }) => {
            const ws = await resolveWorkspaceOrFail(store, match, res);
            if (!ws) return;
            const id = ws.id;
            const jobId = `merge-continue-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
            const job: GitOpJob = {
                id: jobId, workspaceId: id, op: 'merge-continue',
                status: 'running', startedAt: new Date().toISOString(), pid: process.pid,
            };
            await gitOpsStore.create(job);
            void branchService.mergeContinue(ws.rootPath).then(async (result) => {
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
            return { jobId };
        },
    }));

    // POST /api/workspaces/:id/git/merge-abort
    routes.push(createRoute({
        method: 'POST',
        pattern: /^\/api\/workspaces\/([^/]+)\/git\/merge-abort$/,
        handler: async ({ match, res }) => {
            const ws = await resolveWorkspaceOrFail(store, match, res);
            if (!ws) return;
            const result = await branchService.mergeAbort(ws.rootPath);
            if (!result.success) throw badRequest(result.error || 'Failed to abort merge');
            gitCache.invalidateMutable(ws.id);
            getWsServer?.()?.broadcastGitChanged(ws.id, 'merge-abort');
            return { success: true };
        },
    }));

    // POST /api/workspaces/:id/git/reword — Reword a non-HEAD commit's title
    routes.push(createRoute({
        method: 'POST',
        pattern: /^\/api\/workspaces\/([^/]+)\/git\/reword$/,
        statusCode: 202,
        handler: async ({ match, res, req }) => {
            const ws = await resolveWorkspaceOrFail(store, match, res);
            if (!ws) return;
            const id = ws.id;
            const body = await parseBodyOrReject(req, res);
            if (body === null) return;
            if (!body.hash || typeof body.hash !== 'string') return void handleAPIError(res, missingFields(['hash']));
            if (!body.title || typeof body.title !== 'string' || !body.title.trim()) return void handleAPIError(res, missingFields(['title']));
            const running = await gitOpsStore.getRunning(id, 'reword');
            if (running.length > 0) return void handleAPIError(res, conflict('A reword operation is already running'));
            const jobId = `reword-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
            const job: GitOpJob = {
                id: jobId, workspaceId: id, op: 'reword',
                status: 'running', startedAt: new Date().toISOString(), pid: process.pid,
            };
            await gitOpsStore.create(job);
            void branchService.rewordCommit(ws.rootPath, body.hash, body.title).then(async (result) => {
                await gitOpsStore.update(id, jobId, {
                    status: result.success ? 'success' : 'failed',
                    finishedAt: new Date().toISOString(), error: result.error,
                });
                gitCache.invalidateMutable(id);
                getWsServer?.()?.broadcastGitChanged(id, 'reword');
            }).catch(async (err) => {
                await gitOpsStore.update(id, jobId, {
                    status: 'failed', finishedAt: new Date().toISOString(),
                    error: err instanceof Error ? err.message : 'Unknown error',
                });
                getWsServer?.()?.broadcastGitChanged(id, 'reword');
            });
            return { jobId };
        },
    }));

    // POST /api/workspaces/:id/git/rebase-reorder
    routes.push(createRoute({
        method: 'POST',
        pattern: /^\/api\/workspaces\/([^/]+)\/git\/rebase-reorder$/,
        statusCode: 202,
        handler: async ({ match, res, req }) => {
            const ws = await resolveWorkspaceOrFail(store, match, res);
            if (!ws) return;
            const id = ws.id;
            const body = await parseBodyOrReject(req, res);
            if (body === null) return;
            if (!Array.isArray(body.commits) || body.commits.length === 0) return void handleAPIError(res, missingFields(['commits']));
            if (!bridge?.enqueue) return void handleAPIError(res, conflict('Queue bridge is not available for rebase-reorder'));
            const running = await gitOpsStore.getRunning(id, 'rebase-reorder');
            if (running.length > 0) return void handleAPIError(res, conflict('A rebase-reorder operation is already running'));
            const commits: string[] = body.commits;
            const displayName = `Reorder ${commits.length} commit${commits.length !== 1 ? 's' : ''}`;
            const jobId = `rebase-reorder-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
            const job: GitOpJob = {
                id: jobId, workspaceId: id, op: 'rebase-reorder',
                status: 'running', startedAt: new Date().toISOString(), pid: process.pid,
            };
            await gitOpsStore.create(job);
            const taskId = await bridge.enqueue({
                type: 'chat',
                priority: 'normal',
                displayName,
                payload: {
                    kind: 'chat',
                    mode: 'autopilot',
                    prompt: buildRebaseReorderPrompt(ws.rootPath, commits),
                    workingDirectory: ws.rootPath,
                    workspaceId: id,
                },
                config: { retryOnFailure: false },
            });
            const onQueueChange = (event: Record<string, unknown>) => {
                const eventTaskId = (event.taskId ?? (event.task as any)?.id) as string | undefined;
                if (eventTaskId !== taskId) return;
                if (event.type !== 'updated') return;
                const status = (event.task as any)?.status as string | undefined;
                if (status !== 'completed' && status !== 'failed') return;
                bridge.off?.('queueChange', onQueueChange);
                gitOpsStore.update(id, jobId, {
                    status: status === 'completed' ? 'success' : 'failed',
                    finishedAt: new Date().toISOString(),
                }).catch(() => {});
                gitCache.invalidateMutable(id);
                getWsServer?.()?.broadcastGitChanged(id, 'rebase-reorder');
            };
            bridge.on?.('queueChange', onQueueChange);
            return { taskId, jobId };
        },
    }));
}

async function resolveWorkspaceRemoteUrl(ws: WorkspaceInfo, store: ProcessStore): Promise<string | undefined> {
    if (ws.remoteUrl?.trim()) return ws.remoteUrl;
    const remoteUrl = await detectRemoteUrl(ws.rootPath);
    if (remoteUrl && remoteUrl !== ws.remoteUrl) {
        await store.updateWorkspace(ws.id, { remoteUrl });
    }
    return remoteUrl;
}

function buildRebaseReorderPrompt(repoRoot: string, commits: string[]): string {
    const firstCommit = commits[0];
    const pickLines = commits.map(h => `pick ${h}`).join('\n');
    const isWindows = process.platform === 'win32';

    return `You are performing a git commit reorder operation in the repository at: ${repoRoot}

## Objective
Reorder the following commits into this exact sequence (oldest first):
${commits.map((h, i) => `  ${i + 1}. ${h}`).join('\n')}

## Step-by-step Instructions

### 1. Find the base commit
Run: \`git rev-parse ${firstCommit}~1\`
This gives the parent commit to use as the rebase base. Save this value as BASE_COMMIT.

### 2. Prepare the rebase sequence file
Create a temporary directory (e.g. under the OS temp folder) and write a file named \`todo\` containing:
\`\`\`
${pickLines}
\`\`\`

### 3. Create the sequence editor helper script
${isWindows ? `On Windows, create a batch script \`seq-editor.cmd\`:
\`\`\`
@copy /Y "C:\\path\\to\\todo" %1 >nul
\`\`\`
Replace \`C:\\path\\to\\todo\` with the actual absolute path to the todo file.` : `On Unix/Mac, create a shell script \`seq-editor.sh\`:
\`\`\`
#!/bin/sh
cp "/path/to/todo" "$1"
\`\`\`
Replace \`/path/to/todo\` with the actual absolute path to the todo file.
Make it executable: \`chmod +x seq-editor.sh\``}

### 4. Run the interactive rebase
Execute from the repo root (${repoRoot}):
${isWindows ? `\`set GIT_SEQUENCE_EDITOR=C:\\path\\to\\seq-editor.cmd && git -C "${repoRoot}" rebase -i BASE_COMMIT\`` : `\`GIT_SEQUENCE_EDITOR=/path/to/seq-editor.sh git -C "${repoRoot}" rebase -i BASE_COMMIT\``}
Replace BASE_COMMIT with the value from Step 1.

### 5. Check for conflicts
After the rebase command completes, run:
\`git -C "${repoRoot}" status\`

Look for output containing "both modified" or "conflict" to detect merge conflicts.

### 6. Handle conflicts
If conflicts are detected:
- Run \`git -C "${repoRoot}" diff\` to inspect the conflict markers.
- **TRIVIAL conflict** (whitespace-only differences, or non-overlapping hunks where both sides add distinct lines):
  Resolve it automatically: remove conflict markers, keeping both sides' content, then run:
  \`git -C "${repoRoot}" add .\`
  \`git -C "${repoRoot}" rebase --continue\`
  (If prompted for a commit message, accept the default.)
- **NON-TRIVIAL conflict** (meaningful code changes in the same lines conflict):
  Abort immediately: \`git -C "${repoRoot}" rebase --abort\`
  Then verify the repo is clean: \`git -C "${repoRoot}" status\`
  Report what conflicted and why the rebase was aborted.

### 7. Clean up
Remove the temporary directory you created in Step 2.

### 8. Report the result
State clearly one of:
- ✅ Reorder completed successfully — all ${commits.length} commits reordered.
- ✅ Trivial conflict resolved — reorder completed after auto-resolution.
- ❌ Non-trivial conflict detected — rebase aborted, repository restored to original state. (Describe the conflict.)

## Important constraints
- Work in: ${repoRoot}
- Always end with the repository in a clean state (no REBASE_HEAD, no staged conflict markers).
- If \`git rebase --abort\` was run, confirm with \`git status\` that the working tree is clean.
- Do NOT push any changes — only local commit reordering.`;
}

function buildPatchTransferMetadata(
    body: Record<string, unknown>,
    targetWorkspace: WorkspaceInfo,
    targetBranch: string,
    targetHead: string | undefined,
    stashed: boolean,
): GitOpMetadata {
    const metadata: GitOpMetadata = {
        kind: 'patch-transfer',
        targetWorkspace: sanitizeTargetWorkspace(targetWorkspace),
        targetBranch: sanitizeMetadataString(targetBranch) ?? null,
        stashed,
    };
    const safeTargetHead = sanitizeHash(targetHead);
    if (safeTargetHead) {
        metadata.targetHead = safeTargetHead;
        metadata.newCommitHash = safeTargetHead;
    }
    const sourceServer = sanitizeServerMetadata(body.sourceServer);
    if (sourceServer) metadata.sourceServer = sourceServer;
    const sourceWorkspace = sanitizeWorkspaceMetadata(body.sourceWorkspace);
    if (sourceWorkspace) metadata.sourceWorkspace = sourceWorkspace;
    const sourceCommit = sanitizeCommitMetadata(body.sourceCommit);
    if (sourceCommit) metadata.sourceCommit = sourceCommit;
    if (body.normalizedSourceRemoteUrl === null) {
        metadata.normalizedSourceRemoteUrl = null;
    } else {
        const normalizedSourceRemoteUrl = sanitizeNormalizedRemoteUrl(body.normalizedSourceRemoteUrl);
        if (normalizedSourceRemoteUrl) metadata.normalizedSourceRemoteUrl = normalizedSourceRemoteUrl;
    }
    return metadata;
}

function sanitizeTargetWorkspace(ws: WorkspaceInfo): { id: string; name?: string } {
    const name = sanitizeMetadataString(ws.name);
    return name ? { id: ws.id, name } : { id: ws.id };
}

function sanitizeWorkspaceMetadata(value: unknown): { id: string; name?: string } | undefined {
    if (!isRecord(value)) return undefined;
    const id = sanitizeMetadataString(value.id);
    if (!id) return undefined;
    const name = sanitizeMetadataString(value.name);
    return name ? { id, name } : { id };
}

function sanitizeServerMetadata(value: unknown): { id: string; label?: string } | undefined {
    if (!isRecord(value)) return undefined;
    const id = sanitizeMetadataString(value.id);
    if (!id) return undefined;
    const label = sanitizeMetadataString(value.label);
    return label ? { id, label } : { id };
}

function sanitizeCommitMetadata(value: unknown): { hash: string; subject?: string; author?: { name?: string; email?: string; date?: string } } | undefined {
    if (!isRecord(value)) return undefined;
    const hash = sanitizeHash(value.hash);
    if (!hash) return undefined;
    const subject = sanitizeMetadataString(value.subject, 500);
    const author = sanitizeAuthorMetadata(value.author);
    return {
        hash,
        ...(subject ? { subject } : {}),
        ...(author ? { author } : {}),
    };
}

function sanitizeAuthorMetadata(value: unknown): { name?: string; email?: string; date?: string } | undefined {
    if (!isRecord(value)) return undefined;
    const name = sanitizeMetadataString(value.name);
    const email = sanitizeMetadataString(value.email);
    const date = sanitizeMetadataString(value.date);
    if (!name && !email && !date) return undefined;
    return {
        ...(name ? { name } : {}),
        ...(email ? { email } : {}),
        ...(date ? { date } : {}),
    };
}

function sanitizeNormalizedRemoteUrl(value: unknown): string | undefined {
    const raw = typeof value === 'string' ? value.trim() : '';
    if (!raw || looksLikeLocalAbsolutePath(raw)) return undefined;
    const normalized = normalizeRemoteUrl(raw).trim();
    if (!normalized || looksLikeLocalAbsolutePath(normalized)) return undefined;
    return normalized.slice(0, 500);
}

function sanitizeHash(value: unknown): string | undefined {
    const hash = sanitizeMetadataString(value, 40);
    return hash && /^[a-fA-F0-9]{4,40}$/.test(hash) ? hash.toLowerCase() : undefined;
}

function sanitizeMetadataString(value: unknown, maxLength = 200): string | undefined {
    if (typeof value !== 'string') return undefined;
    const trimmed = value.trim().replace(/[\r\n\t]+/g, ' ');
    if (!trimmed || looksLikeLocalAbsolutePath(trimmed)) return undefined;
    return trimmed.slice(0, maxLength);
}

function looksLikeLocalAbsolutePath(value: string): boolean {
    return value.startsWith('/') || /^[A-Za-z]:[\\/]/.test(value) || value.startsWith('\\\\');
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}
