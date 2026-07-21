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
import * as zlib from 'zlib';
import { getServerLogger } from '../logging/server-logger';
import { applyCorsHeaders, getDefaultCorsPolicy } from './cors';
export type { CorsPolicy } from './cors';
export { getDefaultCorsPolicy } from './cors';

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
    '.webp': 'image/webp',
    '.pdf': 'application/pdf',
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
    /** Optional ETag for the SPA HTML response. Enables conditional caching (304 Not Modified). */
    spaETag?: string | (() => string | undefined);
    /** CORS policy. Defaults to {@link getDefaultCorsPolicy} when omitted. */
    corsPolicy?: import('./cors').CorsPolicy;
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
    const { routes, spaHtml, staticHandlers = [], spaETag } = options;
    const corsPolicy = options.corsPolicy ?? getDefaultCorsPolicy();

    return (req: http.IncomingMessage, res: http.ServerResponse) => {
        const startTime = Date.now();
        const parsedUrl = url.parse(req.url || '/', true);
        // Keep raw (percent-encoded) pathname for API route matching so that
        // workspace IDs containing '/' (encoded as %2F) don't corrupt the path
        // segments used by [^/]+ capture groups. Handlers decode their own
        // capture groups via decodeURIComponent().
        const rawPathname = parsedUrl.pathname || '/';
        const pathname = decodeURIComponent(rawPathname);
        const method = req.method?.toUpperCase() || 'GET';

        // CORS headers for every request
        applyCorsHeaders(req, res, corsPolicy);

        res.on('finish', () => {
            const durationMs = Date.now() - startTime;
            const log = getServerLogger();
            // Promote slow requests to warn level so they surface without enabling
            // debug logs. The hot dashboard endpoints should be < ~200ms warm.
            if (durationMs >= 500 && rawPathname.startsWith('/api/')) {
                log.warn({ method, path: rawPathname, status: res.statusCode, durationMs }, 'slow request');
            } else {
                log.debug({ method, path: rawPathname, status: res.statusCode, durationMs }, 'request');
            }
        });

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
                        Promise.resolve(route.handler(req, res)).catch((err) => {
                            getServerLogger().error({ method: req.method, url: pathname, err }, 'Route handler error');
                            if (!res.headersSent) {
                                send500(res);
                            }
                        });
                        return;
                    }
                } else {
                    const match = rawPathname.match(route.pattern);
                    if (match) {
                        Promise.resolve(route.handler(req, res, match)).catch((err) => {
                            getServerLogger().error({ method: req.method, url: pathname, err }, 'Route handler error');
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
        const etag = typeof spaETag === 'function' ? spaETag() : spaETag;
        if (etag) {
            const ifNoneMatch = req.headers['if-none-match'];
            if (ifNoneMatch === etag) {
                res.writeHead(304, {
                    'ETag': etag,
                    'Cache-Control': 'no-cache',
                });
                res.end();
                return;
            }
        }
        const html = typeof spaHtml === 'function' ? spaHtml() : spaHtml;
        const headers: Record<string, string> = { 'Content-Type': 'text/html; charset=utf-8' };
        if (etag) {
            headers['ETag'] = etag;
            headers['Cache-Control'] = 'no-cache';
        }
        res.writeHead(200, headers);
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
    const bodyBuf = Buffer.from(body);

    // gzip large JSON payloads when the client advertised support. Chat detail
    // responses can be many MB (large `timeline` / `tool_calls` blobs); raw JSON
    // gzips to ~10% of the wire size, and the savings (network + browser parse)
    // dwarf the compression cost on localhost.
    const req = (res as any).req as http.IncomingMessage | undefined;
    const acceptEnc = (req?.headers?.['accept-encoding'] || '') as string;
    if (bodyBuf.length >= 1024 && /\bgzip\b/i.test(acceptEnc)) {
        try {
            const gzipped = zlib.gzipSync(bodyBuf);
            res.writeHead(statusCode, {
                'Content-Type': 'application/json; charset=utf-8',
                'Content-Encoding': 'gzip',
                'Content-Length': gzipped.length,
                'Vary': 'Accept-Encoding',
            });
            res.end(gzipped);
            return;
        } catch {
            // Fall through to uncompressed on any gzip failure.
        }
    }

    res.writeHead(statusCode, {
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Length': bodyBuf.length,
    });
    res.end(bodyBuf);
}

/**
 * Short-lived TTL (seconds) for the static provider/workspace config endpoints
 * (`models`, `reasoning-efforts`, `effort-tiers`, `llm-tools-config`). These
 * change rarely and are also invalidated client-side on mutation, so 60s is a
 * conservative window: a cold page reload within it can skip the round-trip
 * entirely while a settings edit still shows within at most a minute even
 * without the client-side invalidate-on-mutate.
 */
export const STATIC_CONFIG_CACHE_MAX_AGE_SECONDS = 60;

/** Cache-Control value for the static config endpoints. `private` keeps it out
 * of shared proxy caches (responses are per-provider/per-workspace). */
export const STATIC_CONFIG_CACHE_CONTROL = `private, max-age=${STATIC_CONFIG_CACHE_MAX_AGE_SECONDS}`;

/**
 * Tag a response as short-lived private cache for static config. Call this
 * BEFORE the success `sendJson`/`sendJSON` so the header survives `writeHead`'s
 * merge, and only on the 200 path — never cache a 4xx/5xx.
 */
export function setStaticConfigCacheHeaders(res: http.ServerResponse): void {
    res.setHeader('Cache-Control', STATIC_CONFIG_CACHE_CONTROL);
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

/** Send a JSON error response with a given status code. */
export function sendError(res: http.ServerResponse, statusCode: number, message: string): void {
    sendJson(res, { error: message }, statusCode);
}
