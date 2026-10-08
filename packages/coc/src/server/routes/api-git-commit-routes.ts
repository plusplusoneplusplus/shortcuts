/**
 * Endpoints for listing commits, viewing commit details, files changed,
 * diffs, per-file diffs, and file content at a given commit.
 */

import * as path from 'path';
import { NativeAddonLoadError } from '@plusplusoneplusplus/coc-native';
import { BranchService, loadCommitShowPatch, loadCommitFiles } from '@plusplusoneplusplus/forge';
import { execGitArgsAsync, readGitFileAtCommit } from '../core/api-handler';
import { handleAPIError, notFound, badRequest, internalError } from '../errors';
import type { APIError } from '../errors';
import { gitCache } from '../git/git-cache';
import { loadCommitFileDiffContent } from '../git/ref-file-content';
import { resolveWorkspaceOrFail } from '../shared/handler-utils';
import type { ApiRouteContext } from './api-shared';
import { DIFF_LINE_LIMIT } from './api-shared';
import { createRoute, asString, asInt, asBool } from './route-utils';

/**
 * Re-dress a `NativeAddonLoadError` so its words reach the caller.
 *
 * The two commit-log routes answer a git failure with silence — an empty list
 * and a 404 — which is the right answer for a directory that is not a
 * repository and the wrong one for a binary that is missing or too old, where
 * the commits are right there and nobody can read them. The Git tab would show
 * an empty history for a repository with a thousand commits in it.
 *
 * `handleAPIError` only carries the message of an `APIError`; anything else
 * becomes a bare "Internal server error" and the sentence naming the rebuild
 * lands in the server log alone. So the load failure comes back as a 500 that
 * says what to do, the way the clone route already does. Every other failure
 * returns `undefined` and the caller keeps handling it as it did.
 */
function asLoadFailure(err: unknown): APIError | undefined {
    return err instanceof NativeAddonLoadError ? internalError(err.message) : undefined;
}

/** The 5 s budget the two `diff-tree` spawns this route used to make carried. */
const COMMIT_FILES_TIMEOUT_MS = 5_000;

/**
 * `GitChangeStatus` word back to the porcelain letter the wire carries.
 *
 * The addon reports a status as the word the rest of the codebase uses, and
 * this route's JSON has always been the letter. Mapping here rather than
 * widening the response keeps every consumer — the Git tab, the work-item
 * commit pane — reading exactly what it read before.
 *
 * A `T` (typechange) arrives as `modified`, because that is what the shared
 * parser makes of every letter it does not know; the UI has no `T` label, so
 * a typechange now renders as a modification instead of a blank badge.
 */
const STATUS_WORD_TO_CHAR: Record<string, string> = {
    modified: 'M',
    added: 'A',
    deleted: 'D',
    renamed: 'R',
    copied: 'C',
    conflict: 'U',
    untracked: '?',
    ignored: '!',
};

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
                    } catch (err) {
                        // "That hash names nothing" is the answer here; a broken
                        // addon is not, and this catch would otherwise eat it
                        // before the outer one could speak.
                        if (err instanceof NativeAddonLoadError) { throw err; }
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
                return { files: files.map(file => ({
                    status: STATUS_WORD_TO_CHAR[file.status] ?? 'M',
                    path: file.path,
                    ...(file.additions !== undefined && { additions: file.additions }),
                    ...(file.deletions !== undefined && { deletions: file.deletions }),
                    ...(file.originalPath !== undefined && { oldPath: file.originalPath }),
                })) };
            } catch (err: any) {
                return void handleAPIError(res, asLoadFailure(err) ?? badRequest('Failed to get commit files: ' + (err.message || 'unknown error')));
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
            const hash = match[2];

            try {
                const { content } = await loadCommitShowPatch(ws.rootPath, hash);
                return { diff: content.raw };
            } catch (err: any) {
                return void handleAPIError(res, asLoadFailure(err) ?? badRequest('Failed to get commit diff: ' + (err.message || 'unknown error')));
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
            const hash = match[2];
            const filePath = decodeURIComponent(match[3]);

            const full = query.full;

            try {
                const { content } = await loadCommitShowPatch(ws.rootPath, hash, filePath, {
                    contextLines: 99999, maxLines: full ? undefined : DIFF_LINE_LIMIT,
                });
                return {
                    diff: content.raw,
                    ...(content.truncated ? { truncated: true, totalLines: content.totalLines } : {}),
                };
            } catch (err: any) {
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
