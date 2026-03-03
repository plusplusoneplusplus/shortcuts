/**
 * Shared HTTP Router
 *
 * Base router implementation used by both main server and wiki server.
 * Handles route matching, static file serving, and SPA fallback.
 * Uses only Node.js built-in modules (http, fs, path, url).
 *
 * Cross-platform compatible (Linux/Mac/Windows).
 */

import * as http from 'http';
import * as fs from 'fs';
import * as path from 'path';
import * as url from 'url';

// ============================================================================
// Constants
// ============================================================================

/** MIME look-up table */
const MIME_TYPES: Record<string, string> = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'application/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.png': 'image/png',
    '.svg': 'image/svg+xml',
    '.ico': 'image/x-icon',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.woff': 'font/woff',
    '.woff2': 'font/woff2',
    '.ttf': 'font/ttf',
    '.md': 'text/markdown; charset=utf-8',
};

/** Default MIME type for unknown extensions */
const DEFAULT_MIME = 'application/octet-stream';

// ============================================================================
// Types
// ============================================================================

/**
 * Route handler function.
 * @param req - HTTP request
 * @param res - HTTP response
 * @param match - Regex capture groups (if pattern is RegExp)
 */
export type RouteHandler = (
    req: http.IncomingMessage,
    res: http.ServerResponse,
    match?: RegExpMatchArray
) => void | Promise<void>;

/**
 * Route definition.
 */
export interface Route {
    method?: string;
    pattern: string | RegExp;
    handler: RouteHandler;
}

/**
 * Static file handler options.
 */
export interface StaticFileHandler {
    /**
     * Custom path resolution logic.
     * @param pathname - Request pathname
     * @returns Filesystem path to serve, or undefined to skip
     */
    resolve: (pathname: string) => string | undefined;
}

/**
 * Router options.
 */
export interface SharedRouterOptions {
    /** Route table */
    routes: Route[];
    /** SPA HTML content or factory (served for non-API, non-static paths). A function is called on each request to support hot-reloading. */
    spaHtml: string | (() => string);
    /** Static file handlers (evaluated in order) */
    staticHandlers?: StaticFileHandler[];
}

// ============================================================================
// Router
// ============================================================================

/**
 * Create a request handler (listener) for the HTTP server.
 *
 * Routes:
 *   OPTIONS *        → 204 (CORS preflight)
 *   GET/POST /api/*  → route table match or 404 JSON
 *   GET /*           → static handlers, then SPA fallback
 */
export function createRouter(options: SharedRouterOptions): (req: http.IncomingMessage, res: http.ServerResponse) => void {
    const { routes, spaHtml, staticHandlers = [] } = options;

    return (req: http.IncomingMessage, res: http.ServerResponse) => {
        const parsedUrl = url.parse(req.url || '/', true);
        // Keep raw (percent-encoded) pathname for API route matching so that
        // workspace IDs containing '/' (encoded as %2F) don't corrupt the path
        // segments used by [^/]+ capture groups. Handlers decode their own
        // capture groups via decodeURIComponent().
        const rawPathname = parsedUrl.pathname || '/';
        const pathname = decodeURIComponent(rawPathname);
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

        // API routes — match against raw (encoded) pathname so that percent-
        // encoded slashes in workspace IDs (e.g. %2F) are not decoded before
        // matching and do not corrupt [^/]+ capture groups.
        if (rawPathname.startsWith('/api/')) {
            for (const route of routes) {
                const routeMethod = (route.method || 'GET').toUpperCase();
                if (routeMethod !== method) {
                    continue;
                }

                if (typeof route.pattern === 'string') {
                    if (route.pattern === rawPathname) {
                        Promise.resolve(route.handler(req, res)).catch(() => {
                            if (!res.headersSent) {
                                send500(res);
                            }
                        });
                        return;
                    }
                } else {
                    const match = rawPathname.match(route.pattern);
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

        // Static file handlers
        for (const handler of staticHandlers) {
            const filePath = handler.resolve(pathname);
            if (filePath && serveStaticFile(filePath, res)) {
                return;
            }
        }

        // SPA fallback (index page or client-side routing)
        const html = typeof spaHtml === 'function' ? spaHtml() : spaHtml;
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(html);
    };
}

// ============================================================================
// Static File Server
// ============================================================================

/**
 * Serve a static file from the given path.
 * Returns true if the file was served, false if not found.
 */
export function serveStaticFile(filePath: string, res: http.ServerResponse): boolean {
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

/**
 * Read the request body as a string.
 */
export function readBody(req: http.IncomingMessage): Promise<string> {
    return new Promise((resolve, reject) => {
        const chunks: Buffer[] = [];
        req.on('data', (chunk: Buffer) => chunks.push(chunk));
        req.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')));
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
