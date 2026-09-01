/**
 * HTTP adapter over the git operation kernel in `../git`:
 * - `GitOperationRunner` owns background-job lifecycle, cache invalidation, and broadcasts
 * - `GitPatchTransferService` owns patch export/apply and provenance metadata
 * - `GitRebaseReorderService` owns the queue-backed AI reorder operation
 * - `git-request-validators` owns input validation and the dirty/conflict result taxonomy
 *
 * Handlers here resolve the workspace, parse input, call the kernel, and return
 * the payload. Validators and services throw `APIError`s, which `createRoute`
 * converts into responses.
 *
 * Route order is significant: the `DELETE /branches/:name` catch-all must stay
 * after the specific branch endpoints it would otherwise shadow.
 */

import { BranchService } from '@plusplusoneplusplus/forge';
import { sendJSON, execGitArgsAsync } from '../core/api-handler';
import { handleAPIError, missingFields, notFound, badRequest } from '../errors';
import { GitOperationRunner } from '../git/git-operation-runner';
import { GitPatchTransferService } from '../git/git-patch-transfer-service';
import { GitRebaseReorderService } from '../git/git-rebase-reorder-service';
import {
    collectStrings,
    conflictResponseFor,
    optionalTrimmedString,
    parseOptionalBody,
    pickEnum,
    requireNonBlankString,
    requireString,
} from '../git/git-request-validators';
import { resolveWorkspaceOrFail, parseBodyOrReject } from '../shared/handler-utils';
import type { ApiRouteContext } from './api-shared';
import { createRoute, asString, asInt, asBool } from './route-utils';

const RESET_MODES = ['hard', 'soft', 'mixed'] as const;

export function registerGitBranchRoutes(ctx: ApiRouteContext): void {
    const { routes, store, getWsServer, gitOpsStore, bridge } = ctx;
    const branchService = new BranchService();
    const runner = new GitOperationRunner({ gitOpsStore, getWsServer });
    const patchTransfer = new GitPatchTransferService({ branchService, store, runner });
    const rebaseReorder = new GitRebaseReorderService({ runner, bridge });

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
                return { local: await branchService.getLocalBranchesPaginated(ws.rootPath, options) };
            } else if (type === 'remote') {
                return { remote: await branchService.getRemoteBranchesPaginated(ws.rootPath, options) };
            } else {
                const [local, remote] = await Promise.all([
                    branchService.getLocalBranchesPaginated(ws.rootPath, options),
                    branchService.getRemoteBranchesPaginated(ws.rootPath, options),
                ]);
                return { local, remote };
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
            const name = requireString(body, 'name');
            return branchService.createBranch(ws.rootPath, name, body.checkout ?? false);
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
            const name = requireString(body, 'name');
            const result = await branchService.switchBranch(ws.rootPath, name, { force: body.force ?? false });
            runner.broadcast(ws.id, 'branch-switch');
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
            const body = await parseOptionalBody(req);
            const result = await branchService.push(ws.rootPath, body.setUpstream === true);
            runner.broadcast(ws.id, 'push');
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
            const body = await parseOptionalBody(req);
            const { commitHash } = body;
            if (!commitHash || typeof commitHash !== 'string') {
                return void handleAPIError(res, badRequest('Missing or invalid commitHash'));
            }
            const result = await branchService.pushUpTo(ws.rootPath, commitHash);
            runner.broadcast(ws.id, 'push');
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
            const body = await parseOptionalBody(req);
            const rebase = body.rebase === true;
            return runner.start({
                workspaceId: ws.id,
                op: 'pull',
                rejectIfRunning: 'A pull operation is already running',
                run: () => body.currentBranchOnly === true
                    ? branchService.pullCurrentBranch(ws.rootPath, rebase)
                    : branchService.pull(ws.rootPath, rebase),
            });
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
            return runner.start({
                workspaceId: ws.id,
                op: 'rebase-autosquash',
                rejectIfRunning: 'A rebase-autosquash operation is already running',
                run: () => branchService.rebaseAutosquash(ws.rootPath),
            });
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
            const body = await parseOptionalBody(req);
            const remote = typeof body.remote === 'string' ? body.remote : undefined;
            const result = body.currentBranchOnly === true
                ? await branchService.fetchCurrentBranch(ws.rootPath)
                : await branchService.fetch(ws.rootPath, remote);
            runner.broadcast(ws.id, 'fetch');
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
            const result = await branchService.mergeBranch(ws.rootPath, requireString(body, 'branch'));
            runner.broadcast(ws.id, 'merge');
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
            const message = typeof body.message === 'string' ? body.message : undefined;
            const result = await branchService.stashChanges(ws.rootPath, message);
            runner.broadcast(ws.id, 'stash');
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
            runner.broadcast(ws.id, 'stash-pop');
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
            const hash = requireString(body, 'hash');
            const mode = pickEnum(body.mode, RESET_MODES, 'hard');
            try {
                await execGitArgsAsync(['reset', `--${mode}`, hash], ws.rootPath);
            } catch (err: any) {
                throw badRequest('Failed to reset: ' + (err.message || 'unknown error'));
            }
            runner.invalidateCache(ws.id);
            runner.broadcast(ws.id, 'reset');
            return { success: true };
        },
    }));

    // POST /api/workspaces/:id/git/cherry-pick — Cherry-pick commit(s), optionally onto a local branch
    routes.push(createRoute({
        method: 'POST',
        pattern: /^\/api\/workspaces\/([^/]+)\/git\/cherry-pick$/,
        handler: async ({ match, res, req }) => {
            const ws = await resolveWorkspaceOrFail(store, match, res);
            if (!ws) return;
            const body = await parseBodyOrReject(req, res);
            if (body === null) return;
            const hashes = collectStrings(body.hashes);
            const hash = optionalTrimmedString(body.hash) ?? hashes[0];
            if (!hash) return void handleAPIError(res, missingFields(['hash']));
            const targetBranch = optionalTrimmedString(body.targetBranch);
            if (targetBranch) {
                const localBranches = await branchService.getLocalBranches(ws.rootPath);
                if (!localBranches.some(branch => branch.name === targetBranch)) {
                    return void handleAPIError(res, badRequest('Target branch must be a local branch'));
                }
            }
            const result = await branchService.cherryPick(ws.rootPath, hash, {
                hashes: hashes.length > 0 ? hashes : undefined,
                targetBranch,
            });
            if (result.success) {
                runner.invalidateCache(ws.id);
                runner.broadcast(ws.id, 'cherry-pick');
                return {
                    success: true,
                    targetBranch: result.targetBranch,
                    originalBranch: result.originalBranch,
                    appliedHashes: result.appliedHashes,
                };
            }
            const conflictResponse = conflictResponseFor(result);
            if (conflictResponse) {
                sendJSON(res, conflictResponse.status, conflictResponse.payload);
                return;
            }
            throw badRequest('Cherry-pick failed: ' + result.message);
        },
    }));

    // POST /api/workspaces/:id/git/patch/export — Export commit(s) as a format-patch payload
    routes.push(createRoute({
        method: 'POST',
        pattern: /^\/api\/workspaces\/([^/]+)\/git\/patch\/export$/,
        handler: async ({ match, res, req }) => {
            const ws = await resolveWorkspaceOrFail(store, match, res);
            if (!ws) return;
            const body = await parseBodyOrReject(req, res);
            if (body === null) return;
            return patchTransfer.exportPatch(ws, body);
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
            const { status, payload } = await patchTransfer.applyPatch(ws, body);
            if (status === 200) return payload;
            sendJSON(res, status, payload);
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
            const title = requireNonBlankString(body, 'title');
            const result = await branchService.amendCommitMessage(
                ws.rootPath, title,
                typeof body.body === 'string' ? body.body : undefined,
            );
            if (!result.success) throw badRequest(result.error || 'Failed to amend commit message');
            runner.invalidateCache(ws.id);
            runner.broadcast(ws.id, 'amend');
            return { hash: result.hash };
        },
    }));

    // GET /api/workspaces/:id/git/repo-state — Detect in-progress operations
    routes.push(createRoute({
        pattern: /^\/api\/workspaces\/([^/]+)\/git\/repo-state$/,
        handler: async ({ match, res }) => {
            const ws = await resolveWorkspaceOrFail(store, match, res);
            if (!ws) return;
            return await branchService.getRepoState(ws.rootPath);
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
            return runner.start({
                workspaceId: ws.id,
                op: 'rebase-continue',
                invalidateCache: true,
                run: () => branchService.rebaseContinue(ws.rootPath),
            });
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
            runner.invalidateCache(ws.id);
            runner.broadcast(ws.id, 'rebase-abort');
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
            return runner.start({
                workspaceId: ws.id,
                op: 'merge-continue',
                invalidateCache: true,
                run: () => branchService.mergeContinue(ws.rootPath),
            });
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
            runner.invalidateCache(ws.id);
            runner.broadcast(ws.id, 'merge-abort');
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
            const body = await parseBodyOrReject(req, res);
            if (body === null) return;
            const hash = requireString(body, 'hash');
            const title = requireNonBlankString(body, 'title');
            return runner.start({
                workspaceId: ws.id,
                op: 'reword',
                rejectIfRunning: 'A reword operation is already running',
                invalidateCache: true,
                run: () => branchService.rewordCommit(ws.rootPath, hash, title),
            });
        },
    }));

    // POST /api/workspaces/:id/git/drop-commit — Drop a single unpushed commit via interactive rebase
    routes.push(createRoute({
        method: 'POST',
        pattern: /^\/api\/workspaces\/([^/]+)\/git\/drop-commit$/,
        statusCode: 202,
        handler: async ({ match, res, req }) => {
            const ws = await resolveWorkspaceOrFail(store, match, res);
            if (!ws) return;
            const body = await parseBodyOrReject(req, res);
            if (body === null) return;
            const hash = requireString(body, 'hash');
            return runner.start({
                workspaceId: ws.id,
                op: 'drop-commit',
                rejectIfRunning: 'A drop-commit operation is already running',
                invalidateCache: true,
                run: () => branchService.dropCommit(ws.rootPath, hash),
            });
        },
    }));

    // POST /api/workspaces/:id/git/rebase-reorder — AI-driven interactive reorder via the queue
    routes.push(createRoute({
        method: 'POST',
        pattern: /^\/api\/workspaces\/([^/]+)\/git\/rebase-reorder$/,
        statusCode: 202,
        handler: async ({ match, res, req }) => {
            const ws = await resolveWorkspaceOrFail(store, match, res);
            if (!ws) return;
            const body = await parseBodyOrReject(req, res);
            if (body === null) return;
            return rebaseReorder.start(ws, body.commits);
        },
    }));
}
