/**
 * HTTP Router
 *
 * Main server router using shared Router implementation.
 * Routes requests to API handlers, static files, or SPA fallback.
 *
 * Cross-platform compatible (Linux/Mac/Windows).
 */

import * as http from 'http';
import * as path from 'path';
import type { ProcessStore } from '@plusplusoneplusplus/pipeline-core';
import type { Route } from './types';
import {
    createRouter,
    serveStaticFile,
    sendJson,
    readJsonBody,
    send404,
    send400,
    send500,
} from './shared/router';

// ============================================================================
// Router Options
// ============================================================================

/**
 * Options for the main server router.
 */
export interface RouterOptions {
    /** Route table — health route is prepended automatically. */
    routes: Route[];
    /** SPA HTML content or factory (served for non-API, non-static paths). A function is called on each request to support hot-reloading. */
    spaHtml: string | (() => string);
    /** Optional directory for static assets. */
    staticDir?: string;
    /** Injected process store so /api/health can read count. */
    store: ProcessStore;
    /** Optional lookup function to resolve a wiki ID to its filesystem directory. */
    getWikiDir?: (wikiId: string) => string | undefined;
}

// ============================================================================
// Router Factory
// ============================================================================

/**
 * Create a request handler (listener) for the HTTP server.
 *
 * Routes:
 *   OPTIONS *        → 204 (CORS preflight)
 *   GET /api/health  → health JSON
 *   GET/POST /api/*  → route table match or 404 JSON
 *   GET /static/*    → static files from staticDir
 *   GET /wiki/:id/static/* → static files from wiki dir
 *   GET /*           → SPA fallback (client-side routing)
 */
export function createRequestHandler(
    options: RouterOptions
): (req: http.IncomingMessage, res: http.ServerResponse) => void {
    const { spaHtml, staticDir, store, getWikiDir } = options;

    // Prepend built-in health route
    const routes: Route[] = [
        {
            method: 'GET',
            pattern: '/api/health',
            handler: async (_req, res) => {
                const processes = await store.getAllProcesses();
                sendJson(res, {
                    status: 'ok',
                    uptime: process.uptime(),
                    processCount: processes.length,
                });
            },
        },
        ...options.routes,
    ];

    // Static file handlers
    const staticHandlers = [];

    // Main static directory
    if (staticDir) {
        staticHandlers.push({
            resolve: (pathname: string) => {
                if (pathname === '/' || pathname === '/index.html') {
                    return undefined; // SPA handles root
                }
                return path.join(staticDir, pathname);
            },
        });
    }

    // Build the base router (handles API routes, static dir, SPA fallback)
    const baseHandler = createRouter({
        routes,
        spaHtml,
        staticHandlers,
    });

    // Wrap with wiki static file handling (needs explicit 404 responses)
    return (req: http.IncomingMessage, res: http.ServerResponse) => {
        const pathname = decodeURIComponent(
            (req.url || '/').split('?')[0]
        );

        // Wiki static files: /wiki/:wikiId/static/*
        const wikiStaticMatch = pathname.match(/^\/wiki\/([^/]+)\/static\/(.+)$/);
        if (wikiStaticMatch) {
            const wikiId = wikiStaticMatch[1];
            const fileSuffix = wikiStaticMatch[2];
            const wikiDir = getWikiDir?.(wikiId);
            if (!wikiDir) {
                // CORS headers for consistency
                res.setHeader('Access-Control-Allow-Origin', '*');
                res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
                res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
                send404(res, `Wiki not found: ${wikiId}`);
                return;
            }
            const resolved = path.resolve(wikiDir, fileSuffix);
            // Security: prevent directory traversal
            if (!resolved.startsWith(path.resolve(wikiDir) + path.sep) && resolved !== path.resolve(wikiDir)) {
                res.setHeader('Access-Control-Allow-Origin', '*');
                res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
                res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
                send404(res, 'Invalid path');
                return;
            }
            if (serveStaticFile(resolved, res)) {
                return;
            }
            res.setHeader('Access-Control-Allow-Origin', '*');
            res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
            res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
            send404(res, `File not found: ${fileSuffix}`);
            return;
        }

        // Delegate to base router
        baseHandler(req, res);
    };
}

// Re-export helpers for backward compatibility
export { readJsonBody, sendJson, send404, send400, send500 } from './shared/router';
