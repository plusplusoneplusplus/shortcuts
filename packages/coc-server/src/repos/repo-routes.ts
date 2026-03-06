/**
 * Repo Routes
 *
 * Registers all /api/repos/* REST endpoints for browsing
 * registered workspace repositories.
 *
 * GET  /api/repos                      — list all repos
 * GET  /api/repos/:repoId/tree         — list directory entries
 * GET  /api/repos/:repoId/blob         — read file content
 *
 * Cross-platform compatible (Linux/Mac/Windows).
 */

import * as url from 'url';
import type { Route } from '../types';
import { sendJson, send400, send404, send500 } from '../router';
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
                const result = await service.listDirectory(parsed.repoId, parsed.path, { showIgnored });
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

                if (blob.encoding === 'base64') {
                    const buf = Buffer.from(blob.content, 'base64');
                    res.writeHead(200, {
                        'Content-Type': blob.mimeType,
                        'Content-Length': buf.length,
                    });
                    res.end(buf);
                } else {
                    res.writeHead(200, { 'Content-Type': blob.mimeType });
                    res.end(blob.content);
                }
            } catch (err) {
                if (err instanceof Error && (err.message.includes('not found') || err.message.includes('File not found'))) {
                    send404(res, `Path not found: ${err.message}`);
                } else {
                    send500(res, err instanceof Error ? err.message : String(err));
                }
            }
        },
    });
}
