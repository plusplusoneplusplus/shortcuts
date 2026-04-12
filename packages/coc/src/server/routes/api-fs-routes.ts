/**
 * Filesystem REST API Routes
 *
 * Directory browsing and trusted-path blob reading for the dashboard UI.
 * Extracted from `api-handler.ts` to keep each route module focused on one domain.
 */

import * as url from 'url';
import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs';
import type { Route } from '../types';
import { sendJSON } from '../api-handler';
import { handleAPIError, notFound } from '../errors';
import { isWithinTrustedReadOnlyDir } from '../tasks-handler-utils';

/** Enumerate available Windows drive roots (e.g., C:\, D:\). */
function listWindowsDrives(): string[] {
    if (process.platform !== 'win32') {
        return [];
    }
    const drives: string[] = [];
    for (let code = 65; code <= 90; code++) {
        const drive = `${String.fromCharCode(code)}:\\`;
        if (fs.existsSync(drive)) {
            drives.push(drive);
        }
    }
    return drives;
}

/** Browse a directory and return its entries (directories only) for repo path selection. */
export function browseDirectory(dirPath: string, showHidden = false): {
    path: string;
    parent: string | null;
    entries: Array<{ name: string; type: 'directory'; isGitRepo: boolean }>;
} | null {
    try {
        if (!fs.existsSync(dirPath) || !fs.statSync(dirPath).isDirectory()) {
            return null;
        }

        const parentDir = path.dirname(dirPath);
        const parent = parentDir !== dirPath ? parentDir : null;

        const rawEntries = fs.readdirSync(dirPath, { withFileTypes: true });
        const entries: Array<{ name: string; type: 'directory'; isGitRepo: boolean }> = [];

        for (const entry of rawEntries) {
            let isDir = entry.isDirectory();

            // Symlinks report isDirectory()=false; resolve the target to check.
            if (!isDir && entry.isSymbolicLink()) {
                try {
                    const realStat = fs.statSync(path.join(dirPath, entry.name));
                    isDir = realStat.isDirectory();
                } catch {
                    // Broken symlink — skip gracefully
                    continue;
                }
            }

            if (!isDir) continue;
            if (!showHidden && entry.name.startsWith('.')) continue;

            const fullPath = path.join(dirPath, entry.name);
            const isGitRepo = fs.existsSync(path.join(fullPath, '.git'));

            entries.push({ name: entry.name, type: 'directory', isGitRepo });
        }

        entries.sort((a, b) => a.name.localeCompare(b.name));

        return { path: dirPath, parent, entries };
    } catch {
        return null;
    }
}

/** Extension → MIME type map for common file types (subset used by blob endpoint). */
const MIME_MAP: Record<string, string> = {
    '.js': 'application/javascript', '.mjs': 'application/javascript', '.cjs': 'application/javascript',
    '.ts': 'application/typescript', '.tsx': 'application/typescript', '.jsx': 'application/javascript',
    '.json': 'application/json', '.html': 'text/html', '.htm': 'text/html', '.css': 'text/css',
    '.md': 'text/markdown', '.markdown': 'text/markdown', '.txt': 'text/plain',
    '.xml': 'application/xml', '.yaml': 'application/x-yaml', '.yml': 'application/x-yaml',
    '.toml': 'application/toml', '.sh': 'application/x-sh', '.bash': 'application/x-sh',
    '.py': 'text/x-python', '.rb': 'text/x-ruby', '.go': 'text/x-go', '.rs': 'text/x-rust',
    '.java': 'text/x-java', '.c': 'text/x-c', '.cpp': 'text/x-c++', '.h': 'text/x-c',
    '.hpp': 'text/x-c++', '.cs': 'text/x-csharp', '.swift': 'text/x-swift',
    '.kt': 'text/x-kotlin', '.scala': 'text/x-scala', '.php': 'text/x-php',
    '.sql': 'application/sql', '.graphql': 'application/graphql',
    '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
    '.gif': 'image/gif', '.webp': 'image/webp', '.ico': 'image/x-icon',
    '.pdf': 'application/pdf', '.zip': 'application/zip', '.gz': 'application/gzip',
    '.env': 'text/plain', '.log': 'text/plain', '.csv': 'text/csv', '.lock': 'text/plain',
};

const FS_BLOB_MAX_SIZE = 1 * 1024 * 1024; // 1 MB
const BINARY_PROBE_SIZE = 8192;

function fsBlobGetMime(filePath: string): string {
    const ext = path.extname(filePath).toLowerCase();
    return MIME_MAP[ext] ?? 'application/octet-stream';
}

function fsBlobIsBinary(buffer: Buffer): boolean {
    const limit = Math.min(buffer.length, BINARY_PROBE_SIZE);
    for (let i = 0; i < limit; i++) {
        if (buffer[i] === 0) return true;
    }
    return false;
}

export interface RegisterApiFsRoutesOptions {
    dataDir?: string;
}

export function registerApiFsRoutes(routes: Route[], options?: RegisterApiFsRoutesOptions): void {
    // GET /api/fs/browse — Browse directories for repo path selection
    routes.push({
        method: 'GET',
        pattern: '/api/fs/browse',
        handler: async (req, res) => {
            const parsed = url.parse(req.url || '/', true);
            const rawPath = typeof parsed.query.path === 'string' && parsed.query.path
                ? parsed.query.path
                : os.homedir();
            const showHidden = parsed.query.showHidden === 'true';

            const resolved = path.resolve(rawPath.replace(/^~/, os.homedir()));

            const result = browseDirectory(resolved, showHidden);
            if (!result) {
                return handleAPIError(res, notFound('Directory'));
            }

            const payload: {
                path: string;
                parent: string | null;
                entries: Array<{ name: string; type: 'directory'; isGitRepo: boolean }>;
                drives?: string[];
            } = { ...result };

            if (process.platform === 'win32') {
                payload.drives = listWindowsDrives();
            }

            sendJSON(res, 200, payload);
        },
    });

    // GET /api/fs/blob — Read file content from trusted directories (read-only)
    routes.push({
        method: 'GET',
        pattern: '/api/fs/blob',
        handler: async (req, res) => {
            const parsed = url.parse(req.url || '/', true);
            const rawPath = typeof parsed.query.path === 'string' ? parsed.query.path : '';
            if (!rawPath) {
                return handleAPIError(res, notFound('File'));
            }

            const resolved = path.resolve(rawPath.replace(/^~(\/|\\|$)/, os.homedir() + path.sep));

            if (!isWithinTrustedReadOnlyDir(resolved, options?.dataDir)) {
                res.writeHead(403, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: 'Path is outside trusted directories' }));
                return;
            }

            let stat: fs.Stats;
            try {
                stat = await fs.promises.stat(resolved);
            } catch {
                return handleAPIError(res, notFound('File'));
            }

            if (!stat.isFile()) {
                return handleAPIError(res, notFound('File'));
            }

            if (stat.size > FS_BLOB_MAX_SIZE) {
                res.writeHead(413, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: `File exceeds maximum size of ${FS_BLOB_MAX_SIZE} bytes` }));
                return;
            }

            const buffer = await fs.promises.readFile(resolved);
            const mimeType = fsBlobGetMime(resolved);

            if (fsBlobIsBinary(buffer)) {
                sendJSON(res, 200, { content: buffer.toString('base64'), encoding: 'base64', mimeType });
            } else {
                sendJSON(res, 200, { content: buffer.toString('utf-8'), encoding: 'utf-8', mimeType });
            }
        },
    });
}
