/**
 * Review Editor Image Handler
 *
 * Serves images referenced in markdown files via `GET /review/images/*`.
 * Resolves relative paths against a configurable base directory and
 * guards against directory traversal attacks.
 *
 * Cross-platform compatible (Linux/Mac/Windows).
 */

import * as fs from 'fs';
import * as path from 'path';

import type { Route } from '../types';

const IMAGE_MIME: Record<string, string> = {
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.svg': 'image/svg+xml',
    '.webp': 'image/webp',
    '.bmp': 'image/bmp',
    '.ico': 'image/x-icon',
};

/**
 * Create a route that serves image files from `baseDir`.
 *
 * Route: `GET /review/images/<relative-path>`
 *
 * Security: the resolved path must start with `baseDir` to prevent
 * directory traversal. Returns 403 if the path escapes the base.
 */
export function createImageRoute(baseDir: string): Route {
    const resolvedBase = path.resolve(baseDir);

    return {
        method: 'GET',
        pattern: /^\/review\/images\/(.+)$/,
        handler: (req, res, match) => {
            const relativePath = decodeURIComponent(match![1]);
            const resolved = path.resolve(resolvedBase, relativePath);

            // Prevent directory traversal
            if (!resolved.startsWith(resolvedBase + path.sep) && resolved !== resolvedBase) {
                res.writeHead(403, { 'Content-Type': 'text/plain' });
                res.end('Forbidden');
                return;
            }

            // Check file exists and is a regular file
            let stat: fs.Stats;
            try {
                stat = fs.statSync(resolved);
            } catch {
                res.writeHead(404, { 'Content-Type': 'text/plain' });
                res.end('Not Found');
                return;
            }

            if (!stat.isFile()) {
                res.writeHead(404, { 'Content-Type': 'text/plain' });
                res.end('Not Found');
                return;
            }

            // Determine MIME type
            const ext = path.extname(resolved).toLowerCase();
            const mime = IMAGE_MIME[ext] || 'application/octet-stream';

            res.writeHead(200, {
                'Content-Type': mime,
                'Cache-Control': 'public, max-age=3600',
            });
            fs.createReadStream(resolved).pipe(res);
        },
    };
}
