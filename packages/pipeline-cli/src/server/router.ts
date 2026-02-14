/**
 * HTTP Router
 *
 * Simple request routing for the pipeline execution server.
 * Routes requests to API handlers, static files, or SPA fallback.
 * Uses only Node.js built-in modules (http, fs, path, url).
 *
 * Mirrors packages/deep-wiki/src/server/router.ts pattern.
 * Cross-platform compatible (Linux/Mac/Windows).
 */

import * as http from 'http';
import * as fs from 'fs';
import * as path from 'path';
import * as url from 'url';
import type { ProcessStore } from '@plusplusoneplusplus/pipeline-core';
import type { Route } from './types';

// ============================================================================
// Constants
// ============================================================================

/** MIME look-up table — same set as deep-wiki router. */
const MIME_TYPES: Record<string, string> = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'application/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.png': 'image/png',
    '.svg': 'image/svg+xml',
    '.ico': 'image/x-icon',
};

/** Default MIME type for unknown extensions */
const DEFAULT_MIME = 'application/octet-stream';

// ============================================================================
// Router
// ============================================================================

/**
 * Options for the router.
 */
export interface RouterOptions {
    /** Route table — health route is prepended automatically. */
    routes: Route[];
    /** SPA HTML content (served for non-API, non-static paths). */
    spaHtml: string;
    /** Optional directory for static assets. */
    staticDir?: string;
    /** Injected process store so /api/health can read count. */
    store: ProcessStore;
}

/**
 * Create a request handler (listener) for the HTTP server.
 *
 * Routes:
 *   OPTIONS *        → 204 (CORS preflight)
 *   GET /api/health  → health JSON
 *   GET/POST /api/*  → route table match or 404 JSON
 *   GET /static/*    → static files from staticDir
 *   GET /*           → SPA fallback (client-side routing)
 */
export function createRequestHandler(
    options: RouterOptions
): (req: http.IncomingMessage, res: http.ServerResponse) => void {
    const { spaHtml, staticDir, store } = options;

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

    return (req: http.IncomingMessage, res: http.ServerResponse) => {
        const parsedUrl = url.parse(req.url || '/', true);
        const pathname = decodeURIComponent(parsedUrl.pathname || '/');
        const method = req.method?.toUpperCase() || 'GET';

        // CORS headers for every request
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

        // Handle CORS preflight
        if (method === 'OPTIONS') {
            res.writeHead(204);
            res.end();
            return;
        }

        // API routes
        if (pathname.startsWith('/api/')) {
            for (const route of routes) {
                const routeMethod = (route.method || 'GET').toUpperCase();
                if (routeMethod !== method) {
                    continue;
                }

                if (typeof route.pattern === 'string') {
                    if (route.pattern === pathname) {
                        Promise.resolve(route.handler(req, res)).catch(() => {
                            if (!res.headersSent) {
                                send500(res);
                            }
                        });
                        return;
                    }
                } else {
                    const match = pathname.match(route.pattern);
                    if (match) {
                        Promise.resolve(route.handler(req, res, match)).catch(() => {
                            if (!res.headersSent) {
                                send500(res);
                            }
                        });
                        return;
                    }
                }
            }

            // No route matched
            send404(res, `API route not found: ${pathname}`);
            return;
        }

        // Static files from staticDir
        if (staticDir && pathname !== '/' && pathname !== '/index.html') {
            const filePath = path.join(staticDir, pathname);
            if (serveStaticFile(filePath, res)) {
                return;
            }
        }

        // SPA fallback (index page or client-side routing)
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(spaHtml);
    };
}

// ============================================================================
// Static File Server
// ============================================================================

/**
 * Serve a static file from the given path.
 * Returns true if the file was served, false if not found.
 */
function serveStaticFile(filePath: string, res: http.ServerResponse): boolean {
    const normalizedPath = path.normalize(filePath);

    if (!fs.existsSync(normalizedPath)) {
        return false;
    }

    try {
        const stat = fs.statSync(normalizedPath);
        if (!stat.isFile()) {
            return false;
        }

        const ext = path.extname(normalizedPath).toLowerCase();
        const contentType = MIME_TYPES[ext] || DEFAULT_MIME;

        res.writeHead(200, {
            'Content-Type': contentType,
            'Content-Length': stat.size,
            'Cache-Control': 'public, max-age=3600',
        });

        const stream = fs.createReadStream(normalizedPath);
        stream.pipe(res);
        stream.on('error', () => {
            if (!res.headersSent) {
                res.writeHead(500);
            }
            res.end();
        });

        return true;
    } catch {
        return false;
    }
}

// ============================================================================
// JSON Body Parser
// ============================================================================

/**
 * Read the full request body and parse as JSON.
 * Rejects on invalid JSON.
 */
export async function readJsonBody<T = unknown>(req: http.IncomingMessage): Promise<T> {
    return new Promise<T>((resolve, reject) => {
        const chunks: Buffer[] = [];
        req.on('data', (chunk: Buffer) => chunks.push(chunk));
        req.on('end', () => {
            try {
                const body = Buffer.concat(chunks).toString('utf-8');
                resolve(JSON.parse(body) as T);
            } catch (err) {
                reject(err);
            }
        });
        req.on('error', reject);
    });
}

// ============================================================================
// Response Helpers
// ============================================================================

/** Send a JSON response. */
export function sendJson(res: http.ServerResponse, data: unknown, statusCode = 200): void {
    const body = JSON.stringify(data);
    res.writeHead(statusCode, {
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Length': Buffer.byteLength(body),
    });
    res.end(body);
}

/** Send a 404 Not Found response. */
export function send404(res: http.ServerResponse, message = 'Not Found'): void {
    sendJson(res, { error: message }, 404);
}

/** Send a 400 Bad Request response. */
export function send400(res: http.ServerResponse, message = 'Bad Request'): void {
    sendJson(res, { error: message }, 400);
}

/** Send a 500 Internal Server Error response. */
export function send500(res: http.ServerResponse, message = 'Internal Server Error'): void {
    sendJson(res, { error: message }, 500);
}
