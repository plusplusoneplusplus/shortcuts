/**
 * Endpoints for listing commits, viewing commit details, files changed,
 * diffs, per-file diffs, and file content at a given commit.
 */

import * as path from 'path';
import { NativeAddonLoadError } from '@plusplusoneplusplus/coc-native';
import { BranchService, loadCommitShowPatch, loadCommitFiles, loadGitHistory } from '@plusplusoneplusplus/forge';
import type { NativeGitLogCommit } from '@plusplusoneplusplus/coc-native';
import { readGitFileAtCommit } from '../core/api-handler';
import { handleAPIError, notFound, badRequest, internalError } from '../errors';
import type { APIError } from '../errors';
import { gitCache } from '../git/git-cache';
import { loadCommitFileDiffContent } from '../git/ref-file-content';
import { gitStatusToChar, patchContentResponse } from '../git/git-response';
import { resolveWorkspaceOrFail } from '../shared/handler-utils';
import type { ApiRouteContext } from './api-shared';
import { createLocalPatchRoute, DIFF_LINE_LIMIT } from './api-shared';
import { createRoute, asString, asInt, asBool } from './route-utils';

/** Missing capabilities must surface their rebuild instruction, not empty history. */
function asLoadFailure(err: unknown): APIError | undefined {
    return err instanceof NativeAddonLoadError ? internalError(err.message) : undefined;
}

/** The 5 s budget the two `diff-tree` spawns this route used to make carried. */
const COMMIT_FILES_TIMEOUT_MS = 5_000;

function commitResponse(commit: NativeGitLogCommit) {
    return {
        hash: commit.hash, shortHash: commit.shortHash, subject: commit.subject,
        author: commit.authorName, authorEmail: commit.authorEmail, date: commit.date,
        parentHashes: commit.parentHashes.split(' ').filter(Boolean), body: commit.body,
    };
}

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
            const cached = gitCache.get<{ commits: ReturnType<typeof commitResponse>[]; unpushedCount: number }>(cacheKey);
            if (cached) {
                return cached;
            }

            try {
                const commits = (await loadGitHistory(ws.rootPath, {
                    maxCount: limit, skip, search: search || undefined,
                })).map(commitResponse);

                let unpushedCount = 0;
                const branchStatus = await getBranchService().getBranchStatus(ws.rootPath, false);
                if (branchStatus) {
                    unpushedCount = branchStatus.ahead;
                }

                const result = { commits, unpushedCount };
                gitCache.set(cacheKey, result);
                return result;
            } catch (err) {
                const loadFailure = asLoadFailure(err);
                if (loadFailure) { throw loadFailure; }
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
            const cached = gitCache.get<ReturnType<typeof commitResponse>>(cacheKey);
            if (cached) {
                return cached;
            }

            try {
                const [commit] = await loadGitHistory(ws.rootPath, { maxCount: 1, skip: 0 }, hash);
                if (!commit) {
                    return void handleAPIError(res, notFound('Commit'));
                }
                const result = commitResponse(commit);
                gitCache.set(cacheKey, result);
                return result;
            } catch (err) {
                const loadFailure = asLoadFailure(err);
                if (loadFailure) { throw loadFailure; }
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
            const hash = match[2];
            try {
                const files = await loadCommitFiles(ws.rootPath, hash, COMMIT_FILES_TIMEOUT_MS);
                return { files: files.map(({ status, originalPath, ...file }) => ({
                    ...file, status: gitStatusToChar(status),
                    ...(originalPath !== undefined && { oldPath: originalPath }),
                })) };
            } catch (err: any) {
                return void handleAPIError(res, asLoadFailure(err) ?? badRequest('Failed to get commit files: ' + (err.message || 'unknown error')));
            }
        },
    }));

    // GET /api/workspaces/:id/git/commits/:hash/diff — Full diff for a commit
    routes.push(createLocalPatchRoute({
        method: 'GET',
        pattern: /^\/api\/workspaces\/([^/]+)\/git\/commits\/([a-f0-9]{4,40})\/diff$/,
        handler: async ({ res, match, signal }) => {
            const ws = await resolveWorkspaceOrFail(store, match, res);
            if (!ws) return;
            const hash = match[2];

            try {
                const { content } = await loadCommitShowPatch(ws.rootPath, hash, undefined, { signal });
                return { diff: content.raw };
            } catch (err: any) {
                signal.throwIfAborted();
                return void handleAPIError(res, asLoadFailure(err) ?? badRequest('Failed to get commit diff: ' + (err.message || 'unknown error')));
            }
        },
    }));

    // GET /api/workspaces/:id/git/commits/:hash/files/*/diff — Per-file diff for a commit
    routes.push(createLocalPatchRoute({
        method: 'GET',
        pattern: /^\/api\/workspaces\/([^/]+)\/git\/commits\/([a-f0-9]{4,40})\/files\/(.+)\/diff$/,
        parseQuery: (q) => ({ full: asBool(q.full) }),
        handler: async ({ res, match, query, signal }) => {
            const ws = await resolveWorkspaceOrFail(store, match, res);
            if (!ws) return;
            const hash = match[2];
            const filePath = decodeURIComponent(match[3]);

            const full = query.full;

            try {
                const { content } = await loadCommitShowPatch(ws.rootPath, hash, filePath, {
                    contextLines: 99999, maxLines: full ? undefined : DIFF_LINE_LIMIT, signal,
                });
                return patchContentResponse(content);
            } catch (err: any) {
                signal.throwIfAborted();
                return void handleAPIError(res, asLoadFailure(err) ?? badRequest('Failed to get commit file diff: ' + (err.message || 'unknown error')));
            }
        },
    }));

    routes.push(createRoute({
        method: 'GET',
        pattern: /^\/api\/workspaces\/([^/]+)\/git\/commits\/([^/]+)\/files\/(.+)\/diff-content$/,
        handler: async ({ res, match }) => {
            const ws = await resolveWorkspaceOrFail(store, match, res);
            if (!ws) return;
            return loadCommitFileDiffContent(
                ws.rootPath, ws.id, decodeURIComponent(match[2]), decodeURIComponent(match[3]), gitCache,
            );
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
