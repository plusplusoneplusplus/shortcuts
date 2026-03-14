/**
 * Repo Routes
 *
 * Registers all /api/repos/* REST endpoints for browsing
 * registered workspace repositories.
 *
 * GET  /api/repos                      — list all repos
 * GET  /api/repos/:repoId/tree         — list directory entries
 * GET  /api/repos/:repoId/files        — list all files recursively
 * GET  /api/repos/:repoId/search       — fuzzy file-path search
 * GET  /api/repos/:repoId/blob         — read file content
 * PUT  /api/repos/:repoId/blob         — write file content
 *
 * Cross-platform compatible (Linux/Mac/Windows).
 */

import * as url from 'url';
import type { Route } from '../types';
import { sendJson, send400, send404, send500, readJsonBody } from '../router';
import { RepoTreeService } from './tree-service';

// ============================================================================
// Helpers
// ============================================================================

interface ParsedRepoRequest {
    repoId: string;
    path: string;
}

/**
 * Extract and validate repoId + path from an incoming request.
 * Returns undefined and sends an error response if validation fails.
 */
function parseRepoRequest(
    res: import('http').ServerResponse,
    match: RegExpMatchArray | undefined,
    query: url.UrlWithParsedQuery['query'],
    options: { pathRequired: boolean; pathDefault?: string },
): ParsedRepoRequest | undefined {
    const repoId = decodeURIComponent(match![1]);

    const rawPath = typeof query.path === 'string' ? query.path : undefined;

    if (options.pathRequired && !rawPath) {
        send400(res, 'Missing required query parameter: path');
        return undefined;
    }

    const resolvedPath = rawPath ?? options.pathDefault ?? '.';

    if (resolvedPath.split('/').includes('..') || resolvedPath.split('\\').includes('..')) {
        send400(res, 'Invalid path: directory traversal not allowed');
        return undefined;
    }

    return { repoId, path: resolvedPath };
}

// ============================================================================
// Registration
// ============================================================================

/**
 * Register all repo API routes on the given route table.
 * Mutates the `routes` array in-place.
 *
 * @param routes  - Shared route table
 * @param dataDir - CoC data directory (e.g. ~/.coc)
 */
export function registerRepoRoutes(routes: Route[], dataDir: string): void {

    // -- List repos ----------------------------------------------------------

    routes.push({
        method: 'GET',
        pattern: '/api/repos',
        handler: async (_req, res) => {
            try {
                const service = new RepoTreeService(dataDir);
                const repos = await service.listRepos();
                sendJson(res, repos);
            } catch (err) {
                send500(res, err instanceof Error ? err.message : String(err));
            }
        },
    });

    // -- List directory -------------------------------------------------------

    routes.push({
        method: 'GET',
        pattern: /^\/api\/repos\/([^/]+)\/tree$/,
        handler: async (req, res, match) => {
            try {
                const parsedUrl = url.parse(req.url ?? '', true);
                const parsed = parseRepoRequest(res, match, parsedUrl.query, {
                    pathRequired: false,
                    pathDefault: '.',
                });
                if (!parsed) return;

                const service = new RepoTreeService(dataDir);
                const repo = await service.resolveRepo(parsed.repoId);
                if (!repo) {
                    send404(res, `Unknown repo: ${parsed.repoId}`);
                    return;
                }

                const showIgnored = parsedUrl.query.showIgnored === 'true';
                const rawDepth = parseInt(String(parsedUrl.query.depth ?? '1'), 10);
                const depth = Math.min(Math.max(isNaN(rawDepth) ? 1 : rawDepth, 1), 5);
                const result = depth > 1
                    ? await service.listDirectoryDeep(parsed.repoId, parsed.path, depth, { showIgnored })
                    : await service.listDirectory(parsed.repoId, parsed.path, { showIgnored });
                sendJson(res, result);
            } catch (err) {
                if (err instanceof Error && (err.message.includes('does not exist') || err.message.includes('not found'))) {
                    send404(res, `Path not found: ${err.message}`);
                } else {
                    send500(res, err instanceof Error ? err.message : String(err));
                }
            }
        },
    });

    // -- List all files (recursive) -------------------------------------------

    routes.push({
        method: 'GET',
        pattern: /^\/api\/repos\/([^/]+)\/files$/,
        handler: async (req, res, match) => {
            try {
                const parsedUrl = url.parse(req.url ?? '', true);
                const parsed = parseRepoRequest(res, match, parsedUrl.query, {
                    pathRequired: false,
                    pathDefault: '.',
                });
                if (!parsed) return;

                const service = new RepoTreeService(dataDir);
                const repo = await service.resolveRepo(parsed.repoId);
                if (!repo) {
                    send404(res, `Unknown repo: ${parsed.repoId}`);
                    return;
                }

                const showIgnored = parsedUrl.query.showIgnored === 'true';
                const result = await service.listFilesRecursive(parsed.repoId, parsed.path, { showIgnored });
                sendJson(res, result);
            } catch (err) {
                if (err instanceof Error && (err.message.includes('does not exist') || err.message.includes('not found'))) {
                    send404(res, `Path not found: ${err.message}`);
                } else {
                    send500(res, err instanceof Error ? err.message : String(err));
                }
            }
        },
    });

    // -- Search files (fuzzy) -------------------------------------------------

    routes.push({
        method: 'GET',
        pattern: /^\/api\/repos\/([^/]+)\/search$/,
        handler: async (req, res, match) => {
            try {
                const parsedUrl = url.parse(req.url ?? '', true);
                const repoId = decodeURIComponent(match![1]);

                const q = typeof parsedUrl.query.q === 'string' ? parsedUrl.query.q : '';
                if (!q) {
                    send400(res, 'Missing required query parameter: q');
                    return;
                }

                const rawLimit = parseInt(String(parsedUrl.query.limit ?? '50'), 10);
                const limit = isNaN(rawLimit) ? 50 : Math.min(Math.max(rawLimit, 1), 200);
                const showIgnored = parsedUrl.query.showIgnored === 'true';

                const service = new RepoTreeService(dataDir);
                const repo = await service.resolveRepo(repoId);
                if (!repo) {
                    send404(res, `Unknown repo: ${repoId}`);
                    return;
                }

                const result = await service.searchFiles(repoId, q, { limit, showIgnored });
                sendJson(res, result);
            } catch (err) {
                send500(res, err instanceof Error ? err.message : String(err));
            }
        },
    });

    // -- Read blob ------------------------------------------------------------

    routes.push({
        method: 'GET',
        pattern: /^\/api\/repos\/([^/]+)\/blob$/,
        handler: async (req, res, match) => {
            try {
                const parsedUrl = url.parse(req.url ?? '', true);
                const parsed = parseRepoRequest(res, match, parsedUrl.query, {
                    pathRequired: true,
                });
                if (!parsed) return;

                const service = new RepoTreeService(dataDir);
                const repo = await service.resolveRepo(parsed.repoId);
                if (!repo) {
                    send404(res, `Unknown repo: ${parsed.repoId}`);
                    return;
                }

                const blob = await service.readBlob(parsed.repoId, parsed.path);

                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify(blob));
            } catch (err) {
                if (err instanceof Error && (err.message.includes('not found') || err.message.includes('File not found'))) {
                    send404(res, `Path not found: ${err.message}`);
                } else {
                    send500(res, err instanceof Error ? err.message : String(err));
                }
            }
        },
    });

    // -- Write blob -----------------------------------------------------------

    routes.push({
        method: 'PUT',
        pattern: /^\/api\/repos\/([^/]+)\/blob$/,
        handler: async (req, res, match) => {
            try {
                const parsedUrl = url.parse(req.url ?? '', true);
                const parsed = parseRepoRequest(res, match, parsedUrl.query, {
                    pathRequired: true,
                });
                if (!parsed) return;

                let body: { content?: string };
                try {
                    body = await readJsonBody<{ content?: string }>(req);
                } catch {
                    send400(res, 'Invalid JSON body');
                    return;
                }

                if (body.content === undefined || body.content === null) {
                    send400(res, 'Missing required field: content');
                    return;
                }

                if (typeof body.content !== 'string') {
                    send400(res, 'Field "content" must be a string');
                    return;
                }

                const service = new RepoTreeService(dataDir);
                const repo = await service.resolveRepo(parsed.repoId);
                if (!repo) {
                    send404(res, `Unknown repo: ${parsed.repoId}`);
                    return;
                }

                await service.writeBlob(parsed.repoId, parsed.path, body.content);
                sendJson(res, { success: true });
            } catch (err) {
                if (err instanceof Error && err.message.includes('Path traversal')) {
                    send400(res, err.message);
                } else {
                    send500(res, err instanceof Error ? err.message : String(err));
                }
            }
        },
    });
}
