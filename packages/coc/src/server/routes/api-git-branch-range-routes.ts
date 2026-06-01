/**
 * Git Branch-Range REST API Routes
 *
 * Endpoints for detecting the feature-branch commit range, listing changed files
 * in the range, full range diff, and per-file range diff.
 */

import * as url from 'url';
import { GitRangeService } from '@plusplusoneplusplus/forge';
import { sendJSON } from '../core/api-handler';
import { handleAPIError, badRequest } from '../errors';
import { gitCache } from '../git/git-cache';
import { resolveWorkspaceOrFail } from '../shared/handler-utils';
import type { ApiRouteContext } from './api-shared';
import { truncateDiffIfNeeded } from './api-shared';

export function registerGitBranchRangeRoutes(ctx: ApiRouteContext): void {
    const { routes, store } = ctx;

    const STATUS_WORD_TO_CHAR: Record<string, string> = {
        added: 'A', modified: 'M', deleted: 'D', renamed: 'R', copied: 'C', conflict: 'U', untracked: '?',
    };

    function normalizeRangeFiles(files: Array<{ path: string; status: string; additions: number; deletions: number; oldPath?: string; repositoryRoot: string }>) {
        return files.map(f => ({
            path: f.path,
            status: STATUS_WORD_TO_CHAR[f.status] ?? f.status,
            additions: f.additions,
            deletions: f.deletions,
            ...(f.oldPath && { oldPath: f.oldPath }),
        }));
    }

    // Lazy singleton
    let _gitRangeService: GitRangeService | undefined;
    function getGitRangeService(): GitRangeService {
        if (!_gitRangeService) { _gitRangeService = new GitRangeService(); }
        return _gitRangeService;
    }

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
                const range = await rangeService.detectCommitRange(ws.rootPath);
                if (!range) {
                    const branchName = await rangeService.getCurrentBranch(ws.rootPath);
                    const result = { onDefaultBranch: true as const, branchName };
                    gitCache.set(cacheKey, result);
                    return sendJSON(res, 200, result);
                }
                const result = {
                    ...range,
                    ...(range.files && { files: normalizeRangeFiles(range.files) }),
                };
                gitCache.set(cacheKey, result);
                sendJSON(res, 200, result);
            } catch {
                const branchName = await getGitRangeService().getCurrentBranch(ws.rootPath).catch(() => 'HEAD');
                sendJSON(res, 200, { onDefaultBranch: true, branchName });
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
                const range = await rangeService.detectCommitRange(ws.rootPath);
                if (!range) {
                    return sendJSON(res, 200, { files: [] });
                }
                const files = normalizeRangeFiles(range.files ?? []);
                sendJSON(res, 200, { files });
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
                const range = await rangeService.detectCommitRange(ws.rootPath);
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
        handler: async (req, res, match) => {
            const ws = await resolveWorkspaceOrFail(store, match!, res);
            if (!ws) return;
            const filePath = decodeURIComponent(match![2]);

            const parsed = url.parse(req.url || '/', true);
            const full = parsed.query.full === 'true';

            try {
                const rangeService = getGitRangeService();
                const range = await rangeService.detectCommitRange(ws.rootPath);
                if (!range) {
                    return sendJSON(res, 200, { diff: '', path: filePath });
                }
                const diff = rangeService.getFileDiff(ws.rootPath, range.baseRef, 'HEAD', filePath);
                const result = { ...truncateDiffIfNeeded(diff, full), path: filePath };
                sendJSON(res, 200, result);
            } catch {
                sendJSON(res, 200, { diff: '', path: filePath });
            }
        },
    });
}
