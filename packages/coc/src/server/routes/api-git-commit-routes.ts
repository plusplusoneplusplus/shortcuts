/**
 * Git Commit REST API Routes
 *
 * Endpoints for listing commits, viewing commit details, files changed,
 * diffs, per-file diffs, and file content at a given commit.
 */

import * as url from 'url';
import * as path from 'path';
import { BranchService } from '@plusplusoneplusplus/forge';
import { sendJSON, execGitSync, readGitFileAtCommit } from '../api-handler';
import { handleAPIError, notFound, badRequest } from '../errors';
import { gitCache } from '../git-cache';
import { resolveWorkspaceOrFail } from '../shared/handler-utils';
import type { ApiRouteContext } from './api-shared';
import { truncateDiffIfNeeded } from './api-shared';

export function registerGitCommitRoutes(ctx: ApiRouteContext): void {
    const { routes, store } = ctx;

    // Lazy singleton for getBranchStatus
    let _branchService: BranchService | undefined;
    function getBranchService(): BranchService {
        if (!_branchService) { _branchService = new BranchService(); }
        return _branchService;
    }

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
        handler: async (req, res, match) => {
            const ws = await resolveWorkspaceOrFail(store, match!, res);
            if (!ws) return;
            const id = ws.id;
            const hash = match![2];
            const filePath = decodeURIComponent(match![3]);

            const parsed = url.parse(req.url || '/', true);
            const full = parsed.query.full === 'true';

            const cacheKey = `${id}:commit-file-diff:${hash}:${filePath}${full ? ':full' : ''}`;
            const cached = gitCache.get<{ diff: string; truncated?: boolean; totalLines?: number }>(cacheKey);
            if (cached) {
                return sendJSON(res, 200, cached);
            }

            try {
                const diff = execGitSync(`show --format="" --patch -U99999 ${hash} -- ${filePath}`, ws.rootPath);
                const result = truncateDiffIfNeeded(diff, full);
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
}
