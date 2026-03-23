/**
 * Git REST API Routes
 *
 * All git-related endpoints: commits, branch-range, branches, push/pull/fetch/merge,
 * stash, reset, cherry-pick, amend, working-tree changes, and git-ops tracking.
 * Extracted from `api-handler.ts` to keep each route module focused on one domain.
 */

import * as url from 'url';
import * as path from 'path';
import { BranchService, GitRangeService, WorkingTreeService, GitOpsStore } from '@plusplusoneplusplus/forge';
import type { GitOpJob } from '@plusplusoneplusplus/forge';
import type { Route } from '../types';
import { sendJSON, parseBody, execGitSync, readGitFileAtCommit } from '../api-handler';
import { handleAPIError, missingFields, notFound, badRequest, conflict } from '../errors';
import { gitCache } from '../git-cache';
import { resolveWorkspaceOrFail, parseBodyOrReject } from '../shared/handler-utils';
import type { ProcessWebSocketServer } from '../websocket';
import type { ApiRouteContext } from './api-shared';

export function registerApiGitRoutes(ctx: ApiRouteContext): void {
    const { routes, store, getWsServer, gitOpsStore } = ctx;
    const branchService = new BranchService();
    const workingTreeService = new WorkingTreeService();

    // Lazy singleton services
    let _gitRangeService: GitRangeService | undefined;
    function getGitRangeService(): GitRangeService {
        if (!_gitRangeService) { _gitRangeService = new GitRangeService(); }
        return _gitRangeService;
    }
    let _branchService: BranchService | undefined;
    function getBranchService(): BranchService {
        if (!_branchService) { _branchService = new BranchService(); }
        return _branchService;
    }

    // ------------------------------------------------------------------
    // Commit endpoints
    // ------------------------------------------------------------------

    // GET /api/workspaces/:id/git/commits — List commits with pagination
    routes.push({
        method: 'GET',
        pattern: /^\/api\/workspaces\/([^/]+)\/git\/commits$/,
        handler: async (req, res, match) => {
            const ws = await resolveWorkspaceOrFail(store, match!, res);
            if (!ws) return;
            const id = ws.id;

            const parsed = url.parse(req.url || '/', true);
            const limit = Math.min(Math.max(parseInt(String(parsed.query.limit || '50'), 10) || 50, 1), 200);
            const skip = Math.max(parseInt(String(parsed.query.skip || '0'), 10) || 0, 0);
            const refresh = parsed.query.refresh === 'true';
            const search = parsed.query.search ? String(parsed.query.search).trim() : '';

            if (refresh) {
                gitCache.invalidateMutable(id);
            }

            const cacheKey = `${id}:commits:${limit}:${skip}${search ? `:search:${search}` : ''}`;
            const cached = gitCache.get<{ commits: any[]; unpushedCount: number }>(cacheKey);
            if (cached) {
                return sendJSON(res, 200, cached);
            }

            try {
                const format = '%H%n%h%n%s%n%an%n%ae%n%aI%n%P%n%b';
                const isHashLookup = search ? /^[0-9a-f]{7,40}$/i.test(search) : false;
                let raw: string;
                if (isHashLookup) {
                    try {
                        raw = execGitSync(`log --format="${format}" -z ${search}^!`, ws.rootPath);
                    } catch {
                        raw = '';
                    }
                } else {
                    const searchFlags = search
                        ? ` --grep=${JSON.stringify(search)} --regexp-ignore-case`
                        : '';
                    raw = execGitSync(
                        `log --format="${format}" --skip=${skip} --max-count=${limit} -z${searchFlags}`,
                        ws.rootPath
                    );
                }

                const commits: Array<{
                    hash: string; shortHash: string; subject: string;
                    author: string; authorEmail: string; date: string; parentHashes: string[];
                    body: string;
                }> = [];

                if (raw.trim()) {
                    const entries = raw.split('\0').filter(Boolean);
                    for (const entry of entries) {
                        const lines = entry.split('\n');
                        if (lines.length >= 6) {
                            commits.push({
                                hash: lines[0],
                                shortHash: lines[1],
                                subject: lines[2],
                                author: lines[3],
                                authorEmail: lines[4],
                                date: lines[5],
                                parentHashes: lines[6] ? lines[6].split(' ').filter(Boolean) : [],
                                body: lines.slice(7).join('\n').trim(),
                            });
                        }
                    }
                }

                let unpushedCount = 0;
                const branchStatus = getBranchService().getBranchStatus(ws.rootPath, false);
                if (branchStatus) {
                    unpushedCount = branchStatus.ahead;
                }

                const result = { commits, unpushedCount };
                gitCache.set(cacheKey, result);
                sendJSON(res, 200, result);
            } catch {
                sendJSON(res, 200, { commits: [], unpushedCount: 0 });
            }
        },
    });

    // GET /api/workspaces/:id/git/commits/:hash — Single commit details
    routes.push({
        method: 'GET',
        pattern: /^\/api\/workspaces\/([^/]+)\/git\/commits\/([a-f0-9]{4,40})$/,
        handler: async (_req, res, match) => {
            const ws = await resolveWorkspaceOrFail(store, match!, res);
            if (!ws) return;
            const id = ws.id;
            const hash = match![2];

            const cacheKey = `${id}:commit:${hash}`;
            const cached = gitCache.get<Record<string, string>>(cacheKey);
            if (cached) {
                return sendJSON(res, 200, cached);
            }

            try {
                const format = '%H%n%h%n%s%n%an%n%ae%n%aI%n%P%n%b';
                const raw = execGitSync(`log -1 --format="${format}" ${hash}`, ws.rootPath);
                const lines = raw.trim().split('\n');
                if (lines.length < 6) {
                    return handleAPIError(res, notFound('Commit'));
                }
                const result = {
                    hash: lines[0],
                    shortHash: lines[1],
                    subject: lines[2],
                    author: lines[3],
                    authorEmail: lines[4],
                    date: lines[5],
                    parentHashes: lines[6] ? lines[6].split(' ').filter(Boolean) : [],
                    body: lines.slice(7).join('\n').trim(),
                };
                gitCache.set(cacheKey, result);
                sendJSON(res, 200, result);
            } catch {
                return handleAPIError(res, notFound('Commit'));
            }
        },
    });

    // GET /api/workspaces/:id/git/commits/:hash/files — Files changed in a commit
    routes.push({
        method: 'GET',
        pattern: /^\/api\/workspaces\/([^/]+)\/git\/commits\/([a-f0-9]{4,40})\/files$/,
        handler: async (_req, res, match) => {
            const ws = await resolveWorkspaceOrFail(store, match!, res);
            if (!ws) return;
            const id = ws.id;
            const hash = match![2];

            const cacheKey = `${id}:commit-files:${hash}`;
            const cached = gitCache.get<{ files: any[] }>(cacheKey);
            if (cached) {
                return sendJSON(res, 200, cached);
            }

            try {
                const raw = execGitSync(`diff-tree --no-commit-id -r --name-status ${hash}`, ws.rootPath);
                const files: Array<{ status: string; path: string }> = [];
                for (const line of raw.split('\n').filter(Boolean)) {
                    const [status, ...pathParts] = line.split('\t');
                    if (status && pathParts.length > 0) {
                        files.push({ status: status.charAt(0), path: pathParts.join('\t') });
                    }
                }
                const result = { files };
                gitCache.set(cacheKey, result);
                sendJSON(res, 200, result);
            } catch (err: any) {
                return handleAPIError(res, badRequest('Failed to get commit files: ' + (err.message || 'unknown error')));
            }
        },
    });

    // GET /api/workspaces/:id/git/commits/:hash/diff — Full diff for a commit
    routes.push({
        method: 'GET',
        pattern: /^\/api\/workspaces\/([^/]+)\/git\/commits\/([a-f0-9]{4,40})\/diff$/,
        handler: async (_req, res, match) => {
            const ws = await resolveWorkspaceOrFail(store, match!, res);
            if (!ws) return;
            const id = ws.id;
            const hash = match![2];

            const cacheKey = `${id}:commit-diff:${hash}`;
            const cached = gitCache.get<{ diff: string }>(cacheKey);
            if (cached) {
                return sendJSON(res, 200, cached);
            }

            try {
                const diff = execGitSync(`show --format="" --patch ${hash}`, ws.rootPath);
                const result = { diff };
                gitCache.set(cacheKey, result);
                sendJSON(res, 200, result);
            } catch (err: any) {
                return handleAPIError(res, badRequest('Failed to get commit diff: ' + (err.message || 'unknown error')));
            }
        },
    });

    // GET /api/workspaces/:id/git/commits/:hash/files/*/diff — Per-file diff for a commit
    routes.push({
        method: 'GET',
        pattern: /^\/api\/workspaces\/([^/]+)\/git\/commits\/([a-f0-9]{4,40})\/files\/(.+)\/diff$/,
        handler: async (_req, res, match) => {
            const ws = await resolveWorkspaceOrFail(store, match!, res);
            if (!ws) return;
            const id = ws.id;
            const hash = match![2];
            const filePath = decodeURIComponent(match![3]);

            const cacheKey = `${id}:commit-file-diff:${hash}:${filePath}`;
            const cached = gitCache.get<{ diff: string }>(cacheKey);
            if (cached) {
                return sendJSON(res, 200, cached);
            }

            try {
                const diff = execGitSync(`show --format="" --patch -U99999 ${hash} -- ${filePath}`, ws.rootPath);
                const result = { diff };
                gitCache.set(cacheKey, result);
                sendJSON(res, 200, result);
            } catch (err: any) {
                return handleAPIError(res, badRequest('Failed to get commit file diff: ' + (err.message || 'unknown error')));
            }
        },
    });

    // GET /api/workspaces/:id/git/commits/:hash/files/*/content — Full file content for a commit file
    routes.push({
        method: 'GET',
        pattern: /^\/api\/workspaces\/([^/]+)\/git\/commits\/([a-f0-9]{4,40})\/files\/(.+)\/content$/,
        handler: async (_req, res, match) => {
            const ws = await resolveWorkspaceOrFail(store, match!, res);
            if (!ws) return;
            const id = ws.id;
            const hash = match![2];
            const filePath = decodeURIComponent(match![3]);

            const cacheKey = `${id}:commit-file-content:${hash}:${filePath}`;
            const cached = gitCache.get<{
                path: string;
                fileName: string;
                lines: string[];
                totalLines: number;
                truncated: boolean;
                language: string;
                resolvedRef: string;
            }>(cacheKey);
            if (cached) {
                return sendJSON(res, 200, cached);
            }

            try {
                const { content, resolvedRef } = readGitFileAtCommit(hash, filePath, ws.rootPath);
                if (Buffer.byteLength(content, 'utf-8') > 2 * 1024 * 1024) {
                    return handleAPIError(res, badRequest('Commit file is too large (max 2MB)'));
                }

                const allLines = content.split('\n');
                if (allLines.length > 0 && allLines[allLines.length - 1] === '') {
                    allLines.pop();
                }

                const ext = path.extname(filePath).toLowerCase();
                const result = {
                    path: filePath,
                    fileName: path.basename(filePath),
                    lines: allLines,
                    totalLines: allLines.length,
                    truncated: false,
                    language: ext.startsWith('.') ? ext.slice(1) : ext,
                    resolvedRef,
                };
                gitCache.set(cacheKey, result);
                sendJSON(res, 200, result);
            } catch (err: any) {
                return handleAPIError(res, badRequest('Failed to get commit file content: ' + (err.message || 'unknown error')));
            }
        },
    });

    // ------------------------------------------------------------------
    // Branch range endpoints
    // ------------------------------------------------------------------

    // GET /api/workspaces/:id/git/branch-range — Detect feature branch commit range
    routes.push({
        method: 'GET',
        pattern: /^\/api\/workspaces\/([^/]+)\/git\/branch-range$/,
        handler: async (req, res, match) => {
            const ws = await resolveWorkspaceOrFail(store, match!, res);
            if (!ws) return;
            const id = ws.id;

            const parsed = url.parse(req.url || '/', true);
            const refresh = parsed.query.refresh === 'true';

            if (refresh) {
                gitCache.invalidateMutable(id);
            }

            const cacheKey = `${id}:branch-range`;
            const cached = gitCache.get(cacheKey);
            if (cached) {
                return sendJSON(res, 200, cached);
            }

            try {
                const rangeService = getGitRangeService();
                const range = rangeService.detectCommitRange(ws.rootPath);
                if (!range) {
                    const result = { onDefaultBranch: true };
                    gitCache.set(cacheKey, result);
                    return sendJSON(res, 200, result);
                }
                gitCache.set(cacheKey, range);
                sendJSON(res, 200, range);
            } catch {
                sendJSON(res, 200, { onDefaultBranch: true });
            }
        },
    });

    // GET /api/workspaces/:id/git/branch-range/files — List changed files in branch range
    routes.push({
        method: 'GET',
        pattern: /^\/api\/workspaces\/([^/]+)\/git\/branch-range\/files$/,
        handler: async (_req, res, match) => {
            const ws = await resolveWorkspaceOrFail(store, match!, res);
            if (!ws) return;

            try {
                const rangeService = getGitRangeService();
                const range = rangeService.detectCommitRange(ws.rootPath);
                if (!range) {
                    return sendJSON(res, 200, { files: [] });
                }
                sendJSON(res, 200, { files: range.files });
            } catch {
                sendJSON(res, 200, { files: [] });
            }
        },
    });

    // GET /api/workspaces/:id/git/branch-range/diff — Full range diff
    routes.push({
        method: 'GET',
        pattern: /^\/api\/workspaces\/([^/]+)\/git\/branch-range\/diff$/,
        handler: async (_req, res, match) => {
            const ws = await resolveWorkspaceOrFail(store, match!, res);
            if (!ws) return;

            try {
                const rangeService = getGitRangeService();
                const range = rangeService.detectCommitRange(ws.rootPath);
                if (!range) {
                    return sendJSON(res, 200, { diff: '' });
                }
                const diff = rangeService.getRangeDiff(ws.rootPath, range.baseRef, 'HEAD');
                sendJSON(res, 200, { diff });
            } catch {
                sendJSON(res, 200, { diff: '' });
            }
        },
    });

    // GET /api/workspaces/:id/git/branch-range/files/*/diff — Per-file diff
    routes.push({
        method: 'GET',
        pattern: /^\/api\/workspaces\/([^/]+)\/git\/branch-range\/files\/(.+)\/diff$/,
        handler: async (_req, res, match) => {
            const ws = await resolveWorkspaceOrFail(store, match!, res);
            if (!ws) return;
            const filePath = decodeURIComponent(match![2]);

            try {
                const rangeService = getGitRangeService();
                const range = rangeService.detectCommitRange(ws.rootPath);
                if (!range) {
                    return sendJSON(res, 200, { diff: '', path: filePath });
                }
                const diff = rangeService.getFileDiff(ws.rootPath, range.baseRef, 'HEAD', filePath);
                sendJSON(res, 200, { diff, path: filePath });
            } catch {
                sendJSON(res, 200, { diff: '', path: filePath });
            }
        },
    });

    // ------------------------------------------------------------------
    // Branch management endpoints
    // ------------------------------------------------------------------

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
    // Working-tree endpoints
    // ------------------------------------------------------------------

    // GET /api/workspaces/:id/git/changes — All working-tree changes
    routes.push({
        method: 'GET',
        pattern: /^\/api\/workspaces\/([^/]+)\/git\/changes$/,
        handler: async (req, res, match) => {
            const ws = await resolveWorkspaceOrFail(store, match!, res);
            if (!ws) return;

            const changes = await workingTreeService.getAllChanges(ws.rootPath);
            sendJSON(res, 200, { changes });
        },
    });

    // POST /api/workspaces/:id/git/changes/stage — Stage a file
    routes.push({
        method: 'POST',
        pattern: /^\/api\/workspaces\/([^/]+)\/git\/changes\/stage$/,
        handler: async (req, res, match) => {
            const ws = await resolveWorkspaceOrFail(store, match!, res);
            if (!ws) return;
            const id = ws.id;

            const body = await parseBodyOrReject(req, res);
            if (body === null) return;
            if (typeof body.filePath !== 'string') return handleAPIError(res, missingFields(['filePath']));

            const result = await workingTreeService.stageFile(ws.rootPath, body.filePath);
            getWsServer?.()?.broadcastGitChanged(id, 'stage');
            sendJSON(res, 200, result);
        },
    });

    // POST /api/workspaces/:id/git/changes/unstage — Unstage a file
    routes.push({
        method: 'POST',
        pattern: /^\/api\/workspaces\/([^/]+)\/git\/changes\/unstage$/,
        handler: async (req, res, match) => {
            const ws = await resolveWorkspaceOrFail(store, match!, res);
            if (!ws) return;
            const id = ws.id;

            const body = await parseBodyOrReject(req, res);
            if (body === null) return;
            if (typeof body.filePath !== 'string') return handleAPIError(res, missingFields(['filePath']));

            const result = await workingTreeService.unstageFile(ws.rootPath, body.filePath);
            getWsServer?.()?.broadcastGitChanged(id, 'unstage');
            sendJSON(res, 200, result);
        },
    });

    // POST /api/workspaces/:id/git/changes/discard — Discard unstaged changes
    routes.push({
        method: 'POST',
        pattern: /^\/api\/workspaces\/([^/]+)\/git\/changes\/discard$/,
        handler: async (req, res, match) => {
            const ws = await resolveWorkspaceOrFail(store, match!, res);
            if (!ws) return;
            const id = ws.id;

            const body = await parseBodyOrReject(req, res);
            if (body === null) return;
            if (typeof body.filePath !== 'string') return handleAPIError(res, missingFields(['filePath']));

            const result = await workingTreeService.discardChanges(ws.rootPath, body.filePath);
            getWsServer?.()?.broadcastGitChanged(id, 'discard');
            sendJSON(res, 200, result);
        },
    });

    // POST /api/workspaces/:id/git/changes/stage-batch — Stage multiple files at once
    routes.push({
        method: 'POST',
        pattern: /^\/api\/workspaces\/([^/]+)\/git\/changes\/stage-batch$/,
        handler: async (req, res, match) => {
            const ws = await resolveWorkspaceOrFail(store, match!, res);
            if (!ws) return;
            const id = ws.id;

            const body = await parseBodyOrReject(req, res);
            if (body === null) return;
            if (!Array.isArray(body.filePaths)) return handleAPIError(res, missingFields(['filePaths']));

            const result = await workingTreeService.stageFiles(ws.rootPath, body.filePaths);
            getWsServer?.()?.broadcastGitChanged(id, 'stage-batch');
            sendJSON(res, 200, result);
        },
    });

    // POST /api/workspaces/:id/git/changes/unstage-batch — Unstage multiple files at once
    routes.push({
        method: 'POST',
        pattern: /^\/api\/workspaces\/([^/]+)\/git\/changes\/unstage-batch$/,
        handler: async (req, res, match) => {
            const ws = await resolveWorkspaceOrFail(store, match!, res);
            if (!ws) return;
            const id = ws.id;

            const body = await parseBodyOrReject(req, res);
            if (body === null) return;
            if (!Array.isArray(body.filePaths)) return handleAPIError(res, missingFields(['filePaths']));

            const result = await workingTreeService.unstageFiles(ws.rootPath, body.filePaths);
            getWsServer?.()?.broadcastGitChanged(id, 'unstage-batch');
            sendJSON(res, 200, result);
        },
    });

    // DELETE /api/workspaces/:id/git/changes/untracked — Delete an untracked file
    routes.push({
        method: 'DELETE',
        pattern: /^\/api\/workspaces\/([^/]+)\/git\/changes\/untracked$/,
        handler: async (req, res, match) => {
            const ws = await resolveWorkspaceOrFail(store, match!, res);
            if (!ws) return;

            const body = await parseBodyOrReject(req, res);
            if (body === null) return;
            if (typeof body.filePath !== 'string') return handleAPIError(res, missingFields(['filePath']));

            const result = await workingTreeService.deleteUntrackedFile(ws.rootPath, body.filePath);
            sendJSON(res, 200, result);
        },
    });

    // GET /api/workspaces/:id/git/changes/files/*/diff — Per-file working-tree diff
    routes.push({
        method: 'GET',
        pattern: /^\/api\/workspaces\/([^/]+)\/git\/changes\/files\/(.+)\/diff$/,
        handler: async (req, res, match) => {
            const ws = await resolveWorkspaceOrFail(store, match!, res);
            if (!ws) return;
            const filePath = decodeURIComponent(match![2]);

            const parsed = url.parse(req.url!, true).query;
            const stage = parsed.stage as string | undefined;
            const staged = stage === 'staged';

            try {
                const diff = await workingTreeService.getFileDiff(ws.rootPath, filePath, staged);
                sendJSON(res, 200, { diff, path: filePath });
            } catch {
                sendJSON(res, 200, { diff: '', path: filePath });
            }
        },
    });
}
