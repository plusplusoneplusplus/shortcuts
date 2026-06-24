/**
 * Git Commit REST API Routes
 *
 * Endpoints for listing commits, viewing commit details, files changed,
 * diffs, per-file diffs, and file content at a given commit.
 */

import * as path from 'path';
import { BranchService } from '@plusplusoneplusplus/forge';
import { execGitArgsAsync, readGitFileAtCommit } from '../core/api-handler';
import { handleAPIError, notFound, badRequest } from '../errors';
import { gitCache } from '../git/git-cache';
import { resolveWorkspaceOrFail } from '../shared/handler-utils';
import type { ApiRouteContext } from './api-shared';
import { truncateDiffIfNeeded } from './api-shared';
import { createRoute, asString, asInt, asBool } from './route-utils';

export function registerGitCommitRoutes(ctx: ApiRouteContext): void {
    const { routes, store } = ctx;

    // Lazy singleton for getBranchStatus
    let _branchService: BranchService | undefined;
    function getBranchService(): BranchService {
        if (!_branchService) { _branchService = new BranchService(); }
        return _branchService;
    }

    // GET /api/workspaces/:id/git/commits — List commits with pagination
    routes.push(createRoute({
        method: 'GET',
        pattern: /^\/api\/workspaces\/([^/]+)\/git\/commits$/,
        parseQuery: (q) => ({
            limit: Math.min(Math.max(asInt(q.limit, 50), 1), 200),
            skip: Math.max(asInt(q.skip, 0), 0),
            refresh: asBool(q.refresh),
            search: asString(q.search, '').trim(),
        }),
        handler: async ({ res, match, query }) => {
            const ws = await resolveWorkspaceOrFail(store, match, res);
            if (!ws) return;
            const id = ws.id;

            const { limit, skip, refresh, search } = query;

            if (refresh) {
                gitCache.invalidateMutable(id);
            }

            const cacheKey = `${id}:commits:${limit}:${skip}${search ? `:search:${search}` : ''}`;
            const cached = gitCache.get<{ commits: any[]; unpushedCount: number }>(cacheKey);
            if (cached) {
                return cached;
            }

            try {
                const format = '%H%n%h%n%s%n%an%n%ae%n%aI%n%P%n%b';
                const isHashLookup = search ? /^[0-9a-f]{7,40}$/i.test(search) : false;
                let raw: string;
                if (isHashLookup) {
                    try {
                        raw = await execGitArgsAsync(['log', `--format=${format}`, '-z', `${search}^!`], ws.rootPath);
                    } catch {
                        raw = '';
                    }
                } else {
                    const searchArgs = search ? [`--grep=${search}`, '--regexp-ignore-case'] : [];
                    raw = await execGitArgsAsync(
                        ['log', `--format=${format}`, `--skip=${skip}`, `--max-count=${limit}`, '-z', ...searchArgs],
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
                const branchStatus = await getBranchService().getBranchStatus(ws.rootPath, false);
                if (branchStatus) {
                    unpushedCount = branchStatus.ahead;
                }

                const result = { commits, unpushedCount };
                gitCache.set(cacheKey, result);
                return result;
            } catch {
                return { commits: [], unpushedCount: 0 };
            }
        },
    }));

    // GET /api/workspaces/:id/git/commits/:hash — Single commit details
    routes.push(createRoute({
        method: 'GET',
        pattern: /^\/api\/workspaces\/([^/]+)\/git\/commits\/([a-f0-9]{4,40})$/,
        handler: async ({ res, match }) => {
            const ws = await resolveWorkspaceOrFail(store, match, res);
            if (!ws) return;
            const id = ws.id;
            const hash = match[2];

            const cacheKey = `${id}:commit:${hash}`;
            const cached = gitCache.get<Record<string, string>>(cacheKey);
            if (cached) {
                return cached;
            }

            try {
                const format = '%H%n%h%n%s%n%an%n%ae%n%aI%n%P%n%b';
                const raw = await execGitArgsAsync(['log', '-1', `--format=${format}`, hash], ws.rootPath);
                const lines = raw.trim().split('\n');
                if (lines.length < 6) {
                    return void handleAPIError(res, notFound('Commit'));
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
                return result;
            } catch {
                return void handleAPIError(res, notFound('Commit'));
            }
        },
    }));

    // GET /api/workspaces/:id/git/commits/:hash/files — Files changed in a commit
    routes.push(createRoute({
        method: 'GET',
        pattern: /^\/api\/workspaces\/([^/]+)\/git\/commits\/([a-f0-9]{4,40})\/files$/,
        handler: async ({ res, match }) => {
            const ws = await resolveWorkspaceOrFail(store, match, res);
            if (!ws) return;
            const id = ws.id;
            const hash = match[2];

            const cacheKey = `${id}:commit-files:${hash}`;
            const cached = gitCache.get<{ files: any[] }>(cacheKey);
            if (cached) {
                return cached;
            }

            try {
                // name-status with rename/copy detection
                const nameStatusRaw = await execGitArgsAsync(['diff-tree', '--no-commit-id', '-r', '--name-status', '-M', '-C', hash], ws.rootPath);
                // numstat for additions/deletions
                const numstatRaw = await execGitArgsAsync(['diff-tree', '--no-commit-id', '-r', '--numstat', '-M', '-C', hash], ws.rootPath);

                // Parse numstat: "additions\tdeletions\tpath" (renames: "old\tnew")
                const numstatMap = new Map<string, { additions: number; deletions: number }>();
                for (const line of numstatRaw.split('\n').filter(Boolean)) {
                    const parts = line.split('\t');
                    if (parts.length < 3) continue;
                    const additions = parts[0] === '-' ? 0 : parseInt(parts[0], 10) || 0;
                    const deletions = parts[1] === '-' ? 0 : parseInt(parts[1], 10) || 0;
                    // For renames, numstat shows "old => new" or "{old => new}" — use the resolved path
                    let filePath = parts.slice(2).join('\t');
                    if (filePath.includes(' => ')) {
                        const m = filePath.match(/(?:{[^}]*? => ([^}]+)}|.* => (.+))/);
                        if (m) filePath = m[1] || m[2];
                    }
                    numstatMap.set(filePath, { additions, deletions });
                }

                const files: Array<{ status: string; path: string; additions?: number; deletions?: number; oldPath?: string }> = [];
                for (const line of nameStatusRaw.split('\n').filter(Boolean)) {
                    const [status, ...pathParts] = line.split('\t');
                    if (!status || pathParts.length === 0) continue;
                    const statusChar = status.charAt(0);
                    let filePath: string;
                    let oldPath: string | undefined;

                    if ((statusChar === 'R' || statusChar === 'C') && pathParts.length >= 2) {
                        oldPath = pathParts[0];
                        filePath = pathParts[1];
                    } else {
                        filePath = pathParts.join('\t');
                    }

                    const stats = numstatMap.get(filePath);
                    files.push({
                        status: statusChar,
                        path: filePath,
                        ...(stats && { additions: stats.additions, deletions: stats.deletions }),
                        ...(oldPath && { oldPath }),
                    });
                }
                const result = { files };
                gitCache.set(cacheKey, result);
                return result;
            } catch (err: any) {
                return void handleAPIError(res, badRequest('Failed to get commit files: ' + (err.message || 'unknown error')));
            }
        },
    }));

    // GET /api/workspaces/:id/git/commits/:hash/diff — Full diff for a commit
    routes.push(createRoute({
        method: 'GET',
        pattern: /^\/api\/workspaces\/([^/]+)\/git\/commits\/([a-f0-9]{4,40})\/diff$/,
        handler: async ({ res, match }) => {
            const ws = await resolveWorkspaceOrFail(store, match, res);
            if (!ws) return;
            const id = ws.id;
            const hash = match[2];

            const cacheKey = `${id}:commit-diff:${hash}`;
            const cached = gitCache.get<{ diff: string }>(cacheKey);
            if (cached) {
                return cached;
            }

            try {
                const diff = await execGitArgsAsync(['show', '--format=', '--patch', hash], ws.rootPath);
                const result = { diff };
                gitCache.set(cacheKey, result);
                return result;
            } catch (err: any) {
                return void handleAPIError(res, badRequest('Failed to get commit diff: ' + (err.message || 'unknown error')));
            }
        },
    }));

    // GET /api/workspaces/:id/git/commits/:hash/files/*/diff — Per-file diff for a commit
    routes.push(createRoute({
        method: 'GET',
        pattern: /^\/api\/workspaces\/([^/]+)\/git\/commits\/([a-f0-9]{4,40})\/files\/(.+)\/diff$/,
        parseQuery: (q) => ({ full: asBool(q.full) }),
        handler: async ({ res, match, query }) => {
            const ws = await resolveWorkspaceOrFail(store, match, res);
            if (!ws) return;
            const id = ws.id;
            const hash = match[2];
            const filePath = decodeURIComponent(match[3]);

            const full = query.full;

            const cacheKey = `${id}:commit-file-diff:${hash}:${filePath}${full ? ':full' : ''}`;
            const cached = gitCache.get<{ diff: string; truncated?: boolean; totalLines?: number }>(cacheKey);
            if (cached) {
                return cached;
            }

            try {
                const diff = await execGitArgsAsync(['show', '--format=', '--patch', '-U99999', hash, '--', filePath], ws.rootPath);
                const result = truncateDiffIfNeeded(diff, full);
                gitCache.set(cacheKey, result);
                return result;
            } catch (err: any) {
                return void handleAPIError(res, badRequest('Failed to get commit file diff: ' + (err.message || 'unknown error')));
            }
        },
    }));

    // GET /api/workspaces/:id/git/commits/:hash/files/*/content — Full file content for a commit file
    routes.push(createRoute({
        method: 'GET',
        pattern: /^\/api\/workspaces\/([^/]+)\/git\/commits\/([a-f0-9]{4,40})\/files\/(.+)\/content$/,
        handler: async ({ res, match }) => {
            const ws = await resolveWorkspaceOrFail(store, match, res);
            if (!ws) return;
            const id = ws.id;
            const hash = match[2];
            const filePath = decodeURIComponent(match[3]);

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
                return cached;
            }

            try {
                const { content, resolvedRef } = await readGitFileAtCommit(hash, filePath, ws.rootPath);
                if (Buffer.byteLength(content, 'utf-8') > 10 * 1024 * 1024) {
                    return void handleAPIError(res, badRequest('Commit file is too large (max 10MB)'));
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
                return result;
            } catch (err: any) {
                return void handleAPIError(res, badRequest('Failed to get commit file content: ' + (err.message || 'unknown error')));
            }
        },
    }));
}
