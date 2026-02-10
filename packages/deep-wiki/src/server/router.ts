/**
 * HTTP Router
 *
 * Simple request routing for the deep-wiki server.
 * Routes requests to static file serving or API handlers.
 * Uses only Node.js built-in modules (http, fs, path, url).
 *
 * Cross-platform compatible (Linux/Mac/Windows).
 */

import * as http from 'http';
import * as fs from 'fs';
import * as path from 'path';
import * as url from 'url';
import type { WikiData } from './wiki-data';
import { handleApiRequest } from './api-handlers';
import type { ContextBuilder } from './context-builder';
import type { AskAIFunction } from './ask-handler';
import type { ConversationSessionManager } from './conversation-session-manager';

// ============================================================================
// Constants
// ============================================================================

/** MIME types for static file serving */
const MIME_TYPES: Record<string, string> = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'application/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.svg': 'image/svg+xml',
    '.ico': 'image/x-icon',
    '.woff': 'font/woff',
    '.woff2': 'font/woff2',
    '.ttf': 'font/ttf',
    '.md': 'text/markdown; charset=utf-8',
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
    /** Wiki data layer */
    wikiData: WikiData;
    /** SPA HTML content (served at / and for SPA fallback) */
    spaHtml: string;
    /** Whether AI features are enabled */
    aiEnabled: boolean;
    /** Repo path (needed for AI features) */
    repoPath?: string;
    /** Context builder for AI Q&A (only when AI is enabled) */
    contextBuilder?: ContextBuilder;
    /** AI SDK send function (only when AI is enabled) */
    aiSendMessage?: AskAIFunction;
    /** AI model override */
    aiModel?: string;
    /** Working directory for AI sessions */
    aiWorkingDirectory?: string;
    /** Session manager for multi-turn conversations */
    sessionManager?: ConversationSessionManager;
}

/**
 * Create a request handler (listener) for the HTTP server.
 *
 * Routes:
 *   GET /            → SPA shell (modified index.html)
 *   GET /api/*       → API handlers
 *   GET /static/*    → Static files from wiki dir
 *   GET /*           → SPA fallback (for client-side routing)
 */
export function createRequestHandler(
    options: RouterOptions
): (req: http.IncomingMessage, res: http.ServerResponse) => void {
    const { wikiData, spaHtml, aiEnabled, repoPath, contextBuilder, aiSendMessage, aiModel, aiWorkingDirectory, sessionManager } = options;

    return (req: http.IncomingMessage, res: http.ServerResponse) => {
        const parsedUrl = url.parse(req.url || '/', true);
        const pathname = decodeURIComponent(parsedUrl.pathname || '/');
        const method = req.method?.toUpperCase() || 'GET';

        // CORS headers for API requests
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

        // Handle CORS preflight
        if (method === 'OPTIONS') {
            res.writeHead(204);
            res.end();
            return;
        }

        // API routes
        if (pathname.startsWith('/api/')) {
            handleApiRequest(req, res, pathname, method, {
                wikiData,
                aiEnabled,
                repoPath,
                contextBuilder,
                aiSendMessage,
                aiModel,
                aiWorkingDirectory,
                sessionManager,
            });
            return;
        }

        // Static files from wiki directory (embedded-data.js, etc.)
        if (pathname !== '/' && pathname !== '/index.html') {
            const filePath = path.join(wikiData.dir, pathname);
            if (serveStaticFile(filePath, res)) {
                return;
            }
        }

        // SPA shell (index page or fallback for client-side routing)
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
    // Security: prevent directory traversal
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
// Helpers
// ============================================================================

/**
 * Send a JSON response.
 */
export function sendJson(res: http.ServerResponse, data: unknown, statusCode = 200): void {
    const body = JSON.stringify(data);
    res.writeHead(statusCode, {
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Length': Buffer.byteLength(body),
    });
    res.end(body);
}

/**
 * Send a 404 Not Found response.
 */
export function send404(res: http.ServerResponse, message = 'Not Found'): void {
    sendJson(res, { error: message }, 404);
}

/**
 * Send a 400 Bad Request response.
 */
export function send400(res: http.ServerResponse, message = 'Bad Request'): void {
    sendJson(res, { error: message }, 400);
}

/**
 * Send a 500 Internal Server Error response.
 */
export function send500(res: http.ServerResponse, message = 'Internal Server Error'): void {
    sendJson(res, { error: message }, 500);
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
